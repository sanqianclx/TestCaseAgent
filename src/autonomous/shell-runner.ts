import { spawnSync } from "child_process"
import { createTool } from "@mastra/core/tools"
import { z } from "zod"
import path from "path"
import { assessCommandRisk, type CommandRisk } from "../mastra/runtime/command-runner.js"
import { logger } from "../mastra/runtime/logger.js"
import { firstToken, redactSecrets, truncateForLog } from "./safety.js"

/**
 * 同步 shell 命令执行器
 *
 * 与现有 `runCommandInVisibleTerminal`（开新 PowerShell 窗口）不同，本函数是同步阻塞的，
 * 把 stdout/stderr 直接返回给调用方，**适合被 Agent 在工具循环里同步调用**。
 *
 * 关键设计：
 * - Windows 上必须 `shell: true` 才能解析 `.cmd` / `.bat`（如 npm、npx、pnpm、conda）
 * - 超时由 `timeoutMs` 控制，超时后进程被 SIGTERM 杀，结果标记 `timedOut: true`
 * - 输出超过 `maxOutputBytes` 时截断，避免 LLM 上下文爆掉
 * - 不接管 stdin，避免 Agent 误传交互式输入卡死
 */

export interface CommandSyncOptions {
  /** 待执行的单行命令（不支持多行脚本） */
  command: string
  /** 工作目录；默认 process.cwd() */
  cwd?: string
  /** 超时毫秒数；默认 30_000 */
  timeoutMs?: number
  /** 单流最大字节数（stdout/stderr 各算一次）；默认 1_000_000 */
  maxOutputBytes?: number
}

export interface CommandSyncResult {
  command: string
  cwd: string
  /** 进程退出码；超时或异常时为 null */
  exitCode: number | null
  /** 标准输出（已截断） */
  stdout: string
  /** 标准错误（已截断） */
  stderr: string
  /** 合并输出，供 LLM 一次性阅读；限前 4000 字符 */
  combinedOutput: string
  /** 实际执行毫秒 */
  durationMs: number
  /** 是否因超时被 kill */
  timedOut: boolean
  /** 是否发生截断 */
  truncated: boolean
  /** 复用现有 `assessCommandRisk` 的风险评估 */
  risk: CommandRisk
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_BYTES = 1_000_000
const LLM_COMBINED_LIMIT = 4_000

/**
 * 同步执行一条 shell 命令并返回结构化结果
 *
 * @throws 不抛错。异常会作为 `{ exitCode: null, stderr, timedOut: false }` 返回。
 */
export function runCommandSync(options: CommandSyncOptions): CommandSyncResult {
  const startedAt = Date.now()
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_BYTES
  const risk = assessCommandRisk(options.command)

  let result: ReturnType<typeof spawnSync>
  try {
    result = spawnSync(options.command, {
      cwd,
      encoding: "utf-8",
      timeout: timeoutMs,
      maxBuffer: maxOutputBytes,
      windowsHide: true,
      // Windows 必须 shell:true 才能跑 npm/npx 这种 .cmd
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      command: options.command,
      cwd,
      exitCode: null,
      stdout: "",
      stderr: redactSecrets(message),
      combinedOutput: redactSecrets(message).slice(0, LLM_COMBINED_LIMIT),
      durationMs: Date.now() - startedAt,
      timedOut: false,
      truncated: false,
      risk,
    }
  }

  const timedOut = result.signal === "SIGTERM" || (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT"
  const rawStdout = typeof result.stdout === "string" ? result.stdout : ""
  const rawStderr = typeof result.stderr === "string" ? result.stderr : ""
  const stdout = truncateStream(rawStdout, maxOutputBytes)
  const stderr = truncateStream(rawStderr, maxOutputBytes)
  const truncated = stdout.truncated || stderr.truncated
  const combined = (stdout.text + (stderr.text ? "\n[stderr]\n" + stderr.text : "")).slice(0, LLM_COMBINED_LIMIT)

  return {
    command: options.command,
    cwd,
    exitCode: result.status,
    stdout: stdout.text,
    stderr: stderr.text,
    combinedOutput: combined,
    durationMs: Date.now() - startedAt,
    timedOut,
    truncated,
    risk,
  }
}

function truncateStream(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (!text) return { text: "", truncated: false }
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return { text, truncated: false }
  const head = text.slice(0, Math.floor(maxBytes / 2))
  const tail = text.slice(-Math.floor(maxBytes / 2))
  return {
    text: `${head}\n...[truncated]...\n${tail}`,
    truncated: true,
  }
}

/**
 * `shell-run` 工具（Mastra Tool）
 *
 * 允许 Agent 执行任意 shell 命令并拿到 stdout/stderr/exit code。
 * V2.4 起在 createTool 上声明 `requireApproval: true`（agent 级开关已关闭），
 * CLI 在 execute() 运行前会做一次 y/n 审批 + 风险评估；这里只负责真正执行并返回结果。
 *
 * 风险字段：
 * - LLM 调用时应同时提供 `risk: { level, reasons }`（V2.4 推荐）。
 * - 不传时 CLI 会降级调 `assessCommandRisk` 兜底评估（基于正则的硬编码规则）。
 */
export const shellRunTool = createTool({
  id: "shell-run",
  // V2.4: 工具级 requireApproval 替代 agent 级开关
  requireApproval: true,
  description:
    "在当前工作目录执行一条 shell 命令并返回 stdout/stderr/退出码。" +
    "仅在专用工具（read-file、write-file、execute-tests、measure-coverage、export-cases）" +
    "做不到时使用，例如运行 mvn clean、git diff、pytest 单文件等。" +
    "每次调用都会在 CLI 上弹出 y/n 审批对话框；高危命令仍可被用户主动批准。" +
    "避免在单次调用里跑交互式 REPL（如 python 不带 -c），命令会在等待 stdin 时超时。" +
    "【风险自评】调用前请评估该命令的风险等级，并通过 risk 字段传递评估结果：\n" +
    "  - low：只读 / 查询操作（如 ls、cat、grep）\n" +
    "  - medium：本地写文件 / 编译 / 安装依赖\n" +
    "  - high：删除 / 格式化 / git reset --hard / 删目录等不可逆操作\n" +
    "reasons 写 1-3 条具体原因。不传 risk 会被 CLI 降级为「未评估」。",
  inputSchema: z.object({
    command: z.string().min(1).describe("一条 shell 命令（单行），不写 shell 脚本"),
    cwd: z.string().optional().describe("工作目录；默认当前项目根目录"),
    timeout_ms: z.number().int().min(1_000).max(180_000).default(DEFAULT_TIMEOUT_MS)
      .describe("最长执行毫秒；默认 30000，上限 180000"),
    // V2.4 新增：LLM 调用前自评的风险，CLI 优先显示这里；未传降级到 assessCommandRisk 兜底
    risk: z.object({
      level: z.enum(["low", "medium", "high"])
        .describe("你评估的命令风险等级：low=只读/查询，medium=本地修改，high=删/格式化/重置"),
      reasons: z.array(z.string())
        .describe("1-3 条具体风险原因，例如'删除 build/ 目录下的中间产物'"),
    }).optional(),
  }),
  outputSchema: z.object({
    command: z.string(),
    cwd: z.string(),
    exit_code: z.number().nullable(),
    stdout: z.string(),
    stderr: z.string(),
    duration_ms: z.number(),
    timed_out: z.boolean(),
    risk: z.object({
      level: z.enum(["low", "medium", "high"]),
      reasons: z.array(z.string()),
    }),
  }),
  execute: async (inputData) => {
    const startedAt = Date.now()
    const result = runCommandSync({
      command: inputData.command,
      cwd: inputData.cwd,
      timeoutMs: inputData.timeout_ms,
    })
    logger.info("tool.invoke", {
      scope: "autonomous.shellRun",
      tool: "shell-run",
      command: redactSecrets(inputData.command).slice(0, 200),
      cwd: result.cwd,
      exit_code: result.exitCode,
      timed_out: result.timedOut,
      risk: result.risk.level,
      duration_ms: Date.now() - startedAt,
    })
    return {
      command: result.command,
      cwd: result.cwd,
      exit_code: result.exitCode,
      stdout: truncateForLog(result.stdout, 8_000, 6_000, 2_000),
      stderr: truncateForLog(result.stderr, 4_000, 3_000, 1_000),
      duration_ms: result.durationMs,
      timed_out: result.timedOut,
      risk: result.risk,
    }
  },
})

export { firstToken }
