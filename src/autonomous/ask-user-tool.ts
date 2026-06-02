import { createTool } from "@mastra/core/tools"
import { z } from "zod"
import { logger } from "../mastra/runtime/logger.js"
import { redactSecrets } from "./safety.js"

/**
 * `ask-user` 工具
 *
 * 让 Agent 主动向用户提问（多选项或自由文本）。
 *
 * 实现策略：execute() 内部 **永远抛错**。Mastra 在 `requireToolApproval: true` 模式下
 * 会把这次工具调用挂起（`finishReason: "suspended"`），CLI 拦截后读取 `suspendPayload.args`
 * 中的 question/options 并展示给用户，回复后通过 `approveToolCallGenerate` 恢复 Agent。
 * 恢复时 CLI 把用户回答以 `context` 形式注入到工具结果中；本函数的 execute 因此不需
 * 实际执行任何工作。
 *
 * 设计动机：把"人机交互"建模成工具调用，能让 Agent 在多步推理中自然插入"澄清"环节，
 * 而不需要 CLI 实现一个复杂的子协议。
 */

const SUSPENSION_MARKER = "ASK_USER_SUSPENDED"

export const askUserTool = createTool({
  id: "ask-user",
  description:
    "向用户发起一个澄清问题并等待回答。" +
    "用于在执行前确认缺失的参数、行为选择或破坏性意图。" +
    "传入一个问题文本和（可选的）选项数组，CLI 会暂停 Agent 并把问题展示给用户，" +
    "用户输入后 Agent 自动继续。",
  inputSchema: z.object({
    question: z.string().min(1).describe("给用户的问题文本"),
    options: z.array(z.string()).optional()
      .describe("可选项；存在时按编号展示，用户可输入 A/B/C 或 free text"),
    allow_free_text: z.boolean().default(true)
      .describe("当提供 options 时，是否允许用户输入 free text（默认 true）"),
  }),
  outputSchema: z.object({
    answer: z.string(),
  }),
  execute: async (inputData) => {
    // 走到这里说明没被 requireToolApproval 拦截（不应该发生），做兜底处理
    logger.warn("tool.invoke", {
      scope: "autonomous.askUser",
      tool: "ask-user",
      note: "execute() 被直接调用而非被挂起；属异常路径",
      question: redactSecrets(inputData.question).slice(0, 200),
    })
    throw new Error(SUSPENSION_MARKER)
  },
})

/** 给 CLI 用来识别 ask-user 挂起的常量 */
export const ASK_USER_SUSPENSION_MARKER = SUSPENSION_MARKER
