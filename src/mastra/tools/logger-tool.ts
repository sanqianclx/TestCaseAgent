import { createTool } from "@mastra/core/tools"
import { z } from "zod"
import { logger, type LogEvent, type LogLevel } from "../runtime/logger.js"

/**
 * Logger Tool
 *
 * 供 Mastra Agent 和 Workflow 显式调用的日志工具。所有调用结果以
 * JSONL 格式追加写入 `output/logs/agent.log`，包含 LLM 原始回复、
 * Workflow 步骤迁移、工具调用结果等。
 *
 * 典型用法：
 * - Agent 在收到 LLM 回复后调用本工具记录原始文本
 * - Workflow 在每一步迁移时调用本工具记录上下文
 * - 工具调用方在执行前后调用本工具记录参数与结果摘要
 *
 * 风险等级：低（仅追加文件，不影响主流程）
 */

/**
 * Logger 工具输入
 */
export interface LoggerToolInput {
  /** 日志级别 */
  level: LogLevel
  /** 事件类型 */
  event: LogEvent
  /** 调用方标识（Agent 名 / Workflow Step 名 / Tool 名） */
  scope: string
  /** 阶段描述 */
  stage?: string
  /** 尝试次数 */
  attempt?: number
  /** 耗时（毫秒） */
  duration_ms?: number
  /** 任意扩展字段，最终以 JSON 落盘 */
  payload?: Record<string, unknown>
}

/**
 * Logger 工具输出
 */
export interface LoggerToolOutput {
  /** 是否成功落盘 */
  ok: boolean
  /** 日志文件绝对路径 */
  log_path: string
  /** 时间戳 */
  timestamp: string
}

export const loggerTool = createTool({
  id: "logger",
  description:
    "记录 Agent / Workflow / Tool 任意时刻的日志到 `output/logs/agent.log`。" +
    "所有 LLM 原始回复、Workflow 步骤迁移、工具调用结果应通过本工具落盘，" +
    "便于事后回放失败原因与诊断 prompt 质量。",
  inputSchema: z.object({
    level: z
      .enum(["debug", "info", "warn", "error"])
      .default("info")
      .describe("日志级别：debug / info / warn / error"),
    event: z
      .enum([
        "llm.request",
        "llm.response",
        "llm.retry",
        "llm.failed",
        "workflow.step",
        "tool.invoke",
        "agent.run",
        "system",
      ])
      .describe("事件类型"),
    scope: z.string().describe("调用方标识（Agent 名 / Workflow Step 名 / Tool 名）"),
    stage: z.string().optional().describe("阶段描述，例如 generate-test-code / diagnose-failure"),
    attempt: z.number().int().min(0).optional().describe("尝试次数（1, 2, 3, ...）"),
    duration_ms: z.number().nonnegative().optional().describe("耗时（毫秒）"),
    payload: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("任意扩展字段，最终以 JSON 落盘；常用字段：text（LLM 原始回复）、prompt（LLM 原始 prompt）、error（错误信息）"),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    log_path: z.string(),
    timestamp: z.string(),
  }),
  execute: async (inputData) => {
    return writeLog({
      level: inputData.level as LogLevel,
      event: inputData.event as LogEvent,
      scope: inputData.scope,
      stage: inputData.stage,
      attempt: inputData.attempt,
      duration_ms: inputData.duration_ms,
      payload: inputData.payload,
    })
  },
})

/**
 * 落盘一条日志
 */
function writeLog(input: LoggerToolInput): LoggerToolOutput {
  const timestamp = new Date().toISOString()
  logger.log(input.level, input.event, {
    scope: input.scope,
    stage: input.stage,
    attempt: input.attempt,
    duration_ms: input.duration_ms,
    ...(input.payload ?? {}),
  })
  return {
    ok: true,
    log_path: logger.path,
    timestamp,
  }
}
