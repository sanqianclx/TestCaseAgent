/**
 * 自主 Agent 模式的本地类型定义
 *
 * 这些类型仅在 `src/autonomous/` 内部使用，刻意不与 `src/mastra/` 下的任何类型
 * 共享，以保证自主 Agent 模式与现有工作流完全解耦。
 */

/**
 * 一个待审批的工具调用
 *
 * 当 Mastra Agent 在 `requireToolApproval: true` 模式下产出 `finishReason: "suspended"`
 * 时，框架会在 `output.suspendPayload` 给出当前挂起的工具调用信息。
 * CLI 把它转成本地结构以便后续展示、审批和恢复。
 */
export interface PendingToolCall {
  /** Mastra 内部 run ID，用于 `approveToolCallGenerate` / `declineToolCallGenerate` */
  runId: string
  /** 当前挂起的工具调用 ID */
  toolCallId: string
  /** 工具名（与 Agent 注册时的 key 对应） */
  toolName: string
  /** 工具入参（已尽量转成普通对象） */
  args: Record<string, unknown>
}

/**
 * 会话级自动放行/拒绝名单
 *
 * - `shellAutoApprovePrefixes`：以命令首词作为前缀匹配（大小写不敏感），命中后无需 y/n 直接放行
 * - `shellDenyPrefixes`：以命令首词作为前缀匹配，命中后直接拒绝
 * - 两者都是会话级有效，进程退出即丢
 */
export interface SessionFlags {
  shellAutoApprovePrefixes: string[]
  shellDenyPrefixes: string[]
  /** 本会话累计调用的 `ask-user` 工具次数，用于防止嵌套死循环 */
  askUserCount: number
}

/**
 * REPL 状态机的所有可能形态
 *
 * `lastStepCount` 字段在 idle 状态下保存 Mastra 累积 step 数；
 * 进入 awaiting_tool_approval 状态时携带，便于 resume 后计算"本轮新 step"的 delta，
 * 避免把"好的，我先读取源文件..."这类开场白在每次工具调用后重复打印。
 */
export type AutonomousState =
  | { mode: "idle"; lastStepCount: number }
  | { mode: "awaiting_tool_approval"; pending: PendingToolCall; lastStepCount: number }
  | {
      mode: "awaiting_user_question"
      pending: PendingToolCall
      question: string
      options?: string[]
      lastStepCount: number
    }
  | { mode: "exit" }

/**
 * `ask-user` 工具的入参载荷
 */
export interface AskUserPayload {
  /** 给用户的问题 */
  question: string
  /** 可选的多选项（如 ["A","B","C"]），存在时按选项展示 */
  options?: string[]
  /** 用户在哪些情况下可以选 free-form 输入而不是选项（默认 always） */
  allow_free_text?: boolean
}

/**
 * 审批用户回复
 *
 * V2.6.3 新增 `{ kind: "exit" }`：用户在 y/n 框里输入 exit / quit 时
 * CLI 直接退出 REPL(不调 framework 的 approve/decline 工具,因为
 * 工具还没执行,根本不需要 resume)。
 */
export type ApprovalDecision =
  | { kind: "approve" }
  | { kind: "decline" }
  | { kind: "approve_always"; prefix: string }
  | { kind: "decline_always"; prefix: string }
  | { kind: "rejected"; reason: string }
  | { kind: "exit" }
