import fs from "fs"
import os from "os"
import path from "path"

/**
 * 日志系统
 *
 * 提供 LLM 调用、Workflow 步骤、Tool 调用的全量可观测能力。所有事件以
 * JSONL 格式追加写入 `output/logs/agent.log`，包含 LLM 原始请求与原始回复，
 * 便于事后回放失败原因与诊断 prompt 质量。
 *
 * 设计目标：
 * - 不污染控制台：重试失败、LLM 错误一律落盘而非打印
 * - 进程内单例：所有调用点共享一个写入流
 * - 优雅降级：日志写入失败不影响主流程
 * - 大小轮转：单文件超过上限后切到归档文件，避免磁盘无限增长
 *
 * 使用示例：
 * ```ts
 * import { logger } from "./logger.js"
 * logger.info("llm.request", { stage: "generate-test-code", attempt: 1 })
 * const response = await agent.generate(prompt)
 * logger.info("llm.response", { stage: "generate-test-code", text: response.text })
 * ```
 */

/** 日志级别 */
export type LogLevel = "debug" | "info" | "warn" | "error"

/** 预定义事件类型 */
export type LogEvent =
  | "llm.request"      // 发起 LLM 调用（仅记录 prompt 摘要）
  | "llm.response"     // 收到 LLM 原始回复（完整 text 落盘）
  | "llm.retry"        // LLM 重试
  | "llm.failed"       // LLM 失败且不再重试
  | "llm.stream.error" // LLM 流式 chunk 报告的内部错误(框架会内部重试,仅审计)
  | "workflow.step"    // Workflow 步骤迁移
  | "tool.invoke"      // 工具调用
  | "agent.run"        // Agent 决策结果
  | "system"           // 系统级事件

/** 一条日志记录 */
export interface LogRecord {
  /** ISO 8601 时间戳，例如 "2026-06-02T15:30:45.123Z" */
  timestamp: string
  /** 日志级别 */
  level: LogLevel
  /** 事件类型 */
  event: LogEvent
  /** 自由扩展字段，例如 stage / attempt / agent / duration_ms */
  [key: string]: unknown
}

/** 日志配置 */
export interface LoggerConfig {
  /** 日志目录 */
  dir: string
  /** 日志主文件名 */
  file: string
  /** 单文件字节上限,默认 10MB */
  maxBytes: number
  /** 归档文件保留数,默认 5（含 .1, .2, ... .N） */
  maxFiles: number
}

const DEFAULT_LOG_DIR = path.join(process.cwd(), "output", "logs")
const DEFAULT_LOG_FILE = "agent.log"
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024
const DEFAULT_MAX_FILES = 5

/**
 * 解析日志配置,支持环境变量覆盖：
 * - TESTGENERATE_LOG_DIR：日志目录
 * - TESTGENERATE_LOG_FILE：日志文件名
 * - TESTGENERATE_LOG_MAX_BYTES：单文件字节上限
 * - TESTGENERATE_LOG_MAX_FILES：归档保留数
 */
function resolveConfig(): LoggerConfig {
  const envDir = process.env.TESTGENERATE_LOG_DIR
  const envFile = process.env.TESTGENERATE_LOG_FILE
  const envMaxBytes = process.env.TESTGENERATE_LOG_MAX_BYTES
  const envMaxFiles = process.env.TESTGENERATE_LOG_MAX_FILES
  return {
    dir: envDir && envDir.trim() ? envDir : DEFAULT_LOG_DIR,
    file: envFile && envFile.trim() ? envFile : DEFAULT_LOG_FILE,
    maxBytes: parsePositiveInt(envMaxBytes, DEFAULT_MAX_BYTES),
    maxFiles: parsePositiveInt(envMaxFiles, DEFAULT_MAX_FILES),
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return n
}

/**
 * 日志写入器
 *
 * 单例模式：模块加载时初始化一次配置与写入流。所有 logger 调用复用同一文件句柄。
 * 进程退出时通过 `flushLogger()` 关闭流。
 */
class Logger {
  private config: LoggerConfig
  private stream: fs.WriteStream | null = null
  private currentSize = 0
  private writeQueue: Promise<void> = Promise.resolve()
  /** 轮转锁：防止并发轮转 */
  private rotating = false

  constructor() {
    this.config = resolveConfig()
    this.refreshCurrentSize()
    this.ensureStream()
  }

  /** 当前活跃日志文件绝对路径 */
  get path(): string {
    return path.join(this.config.dir, this.config.file)
  }

  /** 当前配置（只读） */
  get options(): Readonly<LoggerConfig> {
    return this.config
  }

  /**
   * 启动时扫描当前文件大小,作为后续轮转判断的基线
   */
  private refreshCurrentSize(): void {
    try {
      const stat = fs.statSync(this.path)
      this.currentSize = stat.size
    } catch {
      this.currentSize = 0
    }
  }

  /**
   * 初始化写入流。目录不存在则创建。
   * 写入流初始化失败时降级为静默模式，不影响主流程。
   */
  private ensureStream(): void {
    if (this.stream) return
    try {
      fs.mkdirSync(this.config.dir, { recursive: true })
      this.stream = fs.createWriteStream(this.path, { flags: "a" })
      this.stream.on("error", () => {
        // 静默吞掉写入错误,不污染控制台
        this.stream = null
      })
    } catch {
      this.stream = null
    }
  }

  /**
   * 写入一条日志记录
   * @param level 日志级别
   * @param event 事件类型
   * @param payload 自由扩展字段
   */
  log(level: LogLevel, event: LogEvent, payload: Record<string, unknown> = {}): void {
    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...payload,
    }
    this.writeQueue = this.writeQueue.then(() => this.writeRecord(record))
  }

  /** 写入一行 JSONL,必要时先轮转 */
  private async writeRecord(record: LogRecord): Promise<void> {
    this.ensureStream()
    if (!this.stream) return
    const line = JSON.stringify(record, replaceCircular) + os.EOL
    const byteSize = Buffer.byteLength(line, "utf8")

    // 写入前检查：单条事件大于 maxBytes 时也要写（不能丢事件），但写完立即轮转
    const shouldRotateBeforeWrite = this.currentSize + byteSize > this.config.maxBytes
    if (shouldRotateBeforeWrite) {
      await this.rotate()
      this.ensureStream()
      if (!this.stream) return
    }

    await this.writeLine(line)
    this.currentSize += byteSize

    // 写完后,如果单条事件本身就超过 maxBytes（例如超长 LLM 回复）,立即轮转
    if (this.currentSize > this.config.maxBytes && this.stream) {
      await this.rotate()
    }
  }

  /** 写入单行（带背压处理） */
  private async writeLine(line: string): Promise<void> {
    if (!this.stream) return
    return new Promise((resolve) => {
      const ok = this.stream!.write(line, () => resolve())
      if (!ok) {
        this.stream!.once("drain", () => resolve())
      }
    })
  }

  /**
   * 轮转：关闭当前流 → 重命名归档 → 删除最旧 → 重新打开
   *
   * 流程：
   * 1. 关闭当前 agent.log
   * 2. 把 agent.log 重命名为 agent.log.1（如果 .1 已存在,先 .1 → .2）
   * 3. 超出 maxFiles 的最旧文件直接删除
   * 4. 重新创建 agent.log
   *
   * 任何一步失败都降级为静默：不重试,不污染主流程,但下次写入会触发重新 ensureStream。
   */
  private async rotate(): Promise<void> {
    if (this.rotating) return
    this.rotating = true
    try {
      // 1. 关闭当前流
      if (this.stream) {
        await new Promise<void>((resolve) => {
          this.stream!.end(() => resolve())
        })
        this.stream = null
      }

      // 2. 滚动归档：maxFiles=5 时归档名为 .1 .2 .3 .4 .5
      //    从最旧的开始处理,把 N → 删除、N-1 → N、...、1 → 2
      for (let i = this.config.maxFiles; i >= 1; i -= 1) {
        const source = this.archivedPath(i)
        if (!fs.existsSync(source)) continue
        if (i === this.config.maxFiles) {
          // 最旧文件超过保留数,删除
          safeUnlink(source)
        } else {
          // 上一级重命名为下一级
          const target = this.archivedPath(i + 1)
          safeRename(source, target)
        }
      }

      // 3. 当前 agent.log 移动到 .1
      if (fs.existsSync(this.path)) {
        safeRename(this.path, this.archivedPath(1))
      }

      // 4. 重置大小,下次 ensureStream 会创建新文件
      this.currentSize = 0
    } catch {
      // 静默降级
      this.currentSize = 0
    } finally {
      this.rotating = false
    }
  }

  /** 归档文件路径,例如 agent.log.3 */
  private archivedPath(index: number): string {
    return `${this.path}.${index}`
  }

  /** 关闭写入流（仅在进程退出时调用） */
  async flush(): Promise<void> {
    await this.writeQueue
    return new Promise((resolve) => {
      if (this.stream) {
        this.stream.end(() => resolve())
        this.stream = null
      } else {
        resolve()
      }
    })
  }

  // ===== 便捷方法 =====

  debug(event: LogEvent, payload?: Record<string, unknown>): void {
    this.log("debug", event, payload)
  }

  info(event: LogEvent, payload?: Record<string, unknown>): void {
    this.log("info", event, payload)
  }

  warn(event: LogEvent, payload?: Record<string, unknown>): void {
    this.log("warn", event, payload)
  }

  error(event: LogEvent, payload?: Record<string, unknown>): void {
    this.log("error", event, payload)
  }
}

/**
 * 替换循环引用,防止 JSON.stringify 抛错
 */
function replaceCircular(_key: string, value: unknown): unknown {
  return value
}

/** 静默删除文件,失败不抛错 */
function safeUnlink(filePath: string): void {
  try {
    fs.unlinkSync(filePath)
  } catch {
    // 静默
  }
}

/** 静默重命名,失败不抛错 */
function safeRename(from: string, to: string): void {
  try {
    fs.renameSync(from, to)
  } catch {
    // 静默
  }
}

/** 全局单例 logger */
export const logger = new Logger()

/**
 * 关闭 logger（通常在 main() 顶层 catch 之后调用）
 */
export async function flushLogger(): Promise<void> {
  await logger.flush()
}

/**
 * 创建命名 logger,给同一调用栈或同一阶段的所有日志打上 `scope` 标签
 *
 * 使用示例：
 * ```ts
 * const log = scopedLogger("cli-conversation")
 * log.info("llm.response", { text: response.text })
 * ```
 */
export function scopedLogger(scope: string): {
  debug: (event: LogEvent, payload?: Record<string, unknown>) => void
  info: (event: LogEvent, payload?: Record<string, unknown>) => void
  warn: (event: LogEvent, payload?: Record<string, unknown>) => void
  error: (event: LogEvent, payload?: Record<string, unknown>) => void
} {
  return {
    debug: (event, payload = {}) => logger.debug(event, { scope, ...payload }),
    info: (event, payload = {}) => logger.info(event, { scope, ...payload }),
    warn: (event, payload = {}) => logger.warn(event, { scope, ...payload }),
    error: (event, payload = {}) => logger.error(event, { scope, ...payload }),
  }
}
