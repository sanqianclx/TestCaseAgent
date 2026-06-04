import readline from "readline/promises"
import { getWiredAutonomousAgent, AUTONOMOUS_TOOL_NAMES } from "./autonomous-agent.js"
import { createDefaultReadline, promptForApproval, promptForAskUser } from "./approval.js"
import { memoryStore } from "../mastra/memory/in-memory-store.js"
import { logger } from "../mastra/runtime/logger.js"
import {
  logAgent,
  logInfo,
  logError,
  logWarn,
  logDebug,
  logReasoning,
  promptUser,
  writeAgentStream,
  endAgentStream,
} from "../mastra/runtime/cli-output.js"
import { redactSecrets } from "./safety.js"
import { formatError } from "../mastra/runtime/env.js"
import type { AskUserPayload, AutonomousState, PendingToolCall, SessionFlags } from "./types.js"
import type { Agent } from "@mastra/core/agent"

/**
 * 自主 Agent REPL 驱动
 *
 * 状态机：
 *   idle → user message → driveAgentTurn
 *     ├─ finishReason=stop / end_turn → idle
 *     ├─ finishReason=suspended（askUser 工具）→ awaiting_user_question
 *     └─ finishReason=suspended（其他工具）→ awaiting_tool_approval
 *   awaiting_tool_approval → approve/decline → driveAgentTurn
 *   awaiting_user_question → user answer → driveAgentTurn
 *
 * 设计要点：
 * - 不持有 agent.generate() 的 promise，反应式处理
 * - 每次调 generate 时都重传整个 session.messages → 框架会负责消息合并
 * - 长历史保护：> 80 条时只保留最近 60 + 一个 system 摘要
 * - LLM 重试：复用现有 `withLlmRetries` 包装层
 *
 */

const MAX_STEPS = 25
const MAX_HISTORY = 80
const KEEP_HISTORY = 60
const MAX_ASK_USER_PER_TURN = 3
const SHELL_AUTONOMOUS_PROMPT_PREVIEW_CHARS = 200
/**
 * V2.7.3 循环保护:同一工具连续 N 次入参校验失败,强制结束本轮
 *
 * 场景:LLM 反复调 shellRun 但不传 command,框架每次打回 "command: Required",
 *      LLM 收到错误依然构造空入参,陷入死循环。本机制在第 3 次同错误时强制 abort。
 */
const MAX_CONSECUTIVE_VALIDATION_FAILURES = 3

/**
 * 模块级 wired agent 引用（带 storage 的 Mastra 实例上的 Agent）
 *
 * 之所以提到模块级，是因为 `resolveApproval` / `resumeAfterAskUser` 是独立的
 * 顶层函数，需要在 `driveAgentTurn` 之外的恢复路径上也能拿到同一个 agent
 * —— 否则新 run 的工具调用会找不到对应的 run snapshot。
 */
let moduleWiredAgent: Agent | null = null
function getModuleAgent(): Agent {
  if (!moduleWiredAgent) {
    moduleWiredAgent = getWiredAutonomousAgent().agent
  }
  return moduleWiredAgent
}

interface CliArgs {
  llmRetries?: number
}

/**
 * 启动自主 Agent REPL
 */
export async function runAutonomousRepl(args: CliArgs = {}): Promise<void> {
  const sessionId = `autonomous-${Date.now()}`
  const sessionFlags: SessionFlags = {
    shellAutoApprovePrefixes: [],
    shellDenyPrefixes: [],
    askUserCount: 0,
  }
  memoryStore.getOrCreate(sessionId)
  memoryStore.addMessage(sessionId, "system", "Autonomous agent session started")

  const llmRetries = Number.isFinite(args.llmRetries) ? Math.max(0, Math.floor(args.llmRetries as number)) : 2
  const rl = createDefaultReadline()
  let state: AutonomousState = { mode: "idle", lastStepCount: 0 }

  logAgent("测试代码 Agent 已启动,有什么我可以帮你的吗。")
  logInfo("  - 日志文件：" + logger.path)
  logInfo("  - 当前工作目录：" + process.cwd())
  logInfo("  - 输入 exit 退出")

  try {
    while (true) {
      if (state.mode === "exit") break

      if (state.mode === "idle") {
        const line = (await rl.question(promptUser())).trim()
        if (!line) continue
        if (line === "exit" || line === "quit") {
          state = { mode: "exit" }
          break
        }
        memoryStore.addMessage(sessionId, "user", line)
        sessionFlags.askUserCount = 0 // 新一轮从 0 开始计数
        state = await driveAgentTurn({ sessionId, sessionFlags, llmRetries, rl, lastStepCount: state.lastStepCount })
        continue
      }

      if (state.mode === "awaiting_tool_approval") {
        const decision = await promptForApproval(state.pending, sessionFlags, rl)
        state = await resolveApproval({
          sessionId,
          sessionFlags,
          llmRetries,
          rl,
          pending: state.pending,
          decision,
          lastStepCount: state.lastStepCount,
        })
        continue
      }

      if (state.mode === "awaiting_user_question") {
        const answer = await promptForAskUser(
          state.question,
          state.options,
          true,
          rl
        )
        memoryStore.addMessage(sessionId, "user", answer)
        state = await resumeAfterAskUser({
          sessionId,
          sessionFlags,
          llmRetries,
          rl,
          pending: state.pending,
          answer,
          lastStepCount: state.lastStepCount,
        })
        continue
      }
    }
  } finally {
    rl.close()
    logger.info("system", { scope: "autonomous", event: "session_end", session_id: sessionId })
    logAgent("Bye.")
  }
}

/**
 * 驱动 Agent 完成一个 turn
 *
 * 一次 turn 可能产出 0~N 个工具调用，循环结束条件是 finishReason 不是 suspended。
 *
 * 关键改动（V2.4）：不再传 `requireToolApproval: true`（agent 级），
 * 改为在 shellRun / writeFile / exportCases 工具的 createTool({...}) 上声明
 * `requireApproval: true`，让 Mastra 框架按工具粒度拦截。
 */
async function driveAgentTurn(ctx: {
  sessionId: string
  sessionFlags: SessionFlags
  llmRetries: number
  rl: readline.Interface
  /** 上一轮结束时 Mastra 累积的 step 数；本轮第一次 generate 后会更新 */
  lastStepCount: number
}): Promise<AutonomousState> {
  let currentState: AutonomousState = { mode: "idle", lastStepCount: ctx.lastStepCount }

  const wiredAgent = getModuleAgent()
  while (true) {
    const messages = buildMessagesForAgent(ctx.sessionId)
    const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null
    const lastUser = extractLastUserText(lastMsg)

    logger.info("llm.request", {
      scope: "autonomous.driveAgentTurn",
      session_id: ctx.sessionId,
      messages_count: messages.length,
      last_user_text: redactSecrets(lastUser).slice(0, SHELL_AUTONOMOUS_PROMPT_PREVIEW_CHARS),
    })

    // V2.6: 流式 LLM 调用（替代 V2.5 的 generate()）
    // - 迭代 stream.fullStream,text-delta 实时 stdout.write(逐字)
    // - error chunk 走 logDebug 静默(框架内部重试,JSON 解析失败不喷噪音)
    // - 流式结束后 await stream.getFullOutput() 拿累积全量(用于 memory / 挂起)
    logDebug(`[llm] 调起 LLM（消息数=${messages.length}，重试上限=${ctx.llmRetries}）`)

    const stream = await withLlmRetries(
      "autonomous.turn",
      ctx.llmRetries,
      async () => {
        return await (wiredAgent as unknown as {
          stream: (
            m: unknown,
            o: { maxSteps: number; modelSettings: { temperature: number; maxOutputTokens: number } }
          ) => Promise<{
            fullStream: AsyncIterable<Record<string, unknown>>
            getFullOutput: () => Promise<Record<string, unknown>>
          }>
        }).stream(messages, {
          maxSteps: MAX_STEPS,
          // V2.4: 不再在 agent 级开 requireToolApproval；
          // 改为在 shellRunTool / writeFileTool / exportCasesTool 的 createTool({...})
          // 上声明 `requireApproval: true`，让 Mastra 框架按工具粒度拦截。
          // 这样 readFile / parseSourceCode / executeTests / measureCoverage / logger
          // 这些纯只读工具会自动放行，不再弹 y/n 框。
          modelSettings: { temperature: 0, maxOutputTokens: 4096 },
        })
      }
    )

    // 流式迭代 + 累积全量
    let accText = ""
    let accSteps: Array<{ text?: string }> = []
    let stepTextBuffer = "" // 当前 step 的累积文本
    let lastFinishReason: string | null = null
    let lastRunId: string | null = null
    let suspendPayloadFromChunk: Record<string, unknown> | null = null
    let firstToolCallNames: string[] = []
    // V2.7.5 reasoning 聚合缓冲:攒到句末标点再整句喷,避免逐 token 流时每个字都被 💭 围住
    // 触发 flush 的标点:中文句号"。"、英文句号". "、问号"?"、感叹号"!"、换行"\n"
    let reasoningBuffer = ""
    const REASONING_FLUSH_PATTERN = /[。.!?！?\n]/
    // V2.7.3 循环保护状态:key=toolName,value=连续失败次数
    const consecutiveValidationFailures = new Map<string, { count: number; lastError: string }>()
    let errorChunksSeen = 0

    for await (const chunk of stream.fullStream) {
      const t = (chunk as { type?: string }).type
      const pl = (chunk as { payload?: Record<string, unknown> }).payload ?? {}
      // 诊断:把未识别的 chunk 类型打到 logDebug,DEBUG=1 时可看到完整事件流
      // 已知类型(text-delta/tool-call*/step-*/finish 等)不进这里

      if (t === "text-delta") {
        // V2.6.3 修正:真实字段是 payload.text(不是 chunk.delta)
        const text = (pl as { text?: string }).text
        if (typeof text === "string" && text.length > 0) {
          accText += text
          stepTextBuffer += text
          // 逐字喷到 stdout
          writeAgentStream(text)
        }
      } else if (t === "text-end" || t === "finish-step") {
        // 文本段/step 结束:刷新换行
        endAgentStream()
        if (t === "finish-step" && stepTextBuffer.length > 0) {
          accSteps.push({ text: stepTextBuffer })
          stepTextBuffer = ""
        }
      } else if (t === "reasoning-delta") {
        // 思维链(DeepSeek v4-flash / Anthropic 都有,OpenAI 兼容协议下逐 token 流)
        // V2.7.6: 默认显示,聚合后整句喷(避免逐 token 流时每个字都被 💭 围住的视觉霾)
        // - 开关:HIDE_REASONING=1 才折叠(默认显示)
        // - 聚合:把 delta 累加到 reasoningBuffer,攒到句末标点(。/!/?. / 换行)再整句 flush
        //        没攒够时静默(不喷)——避免半句话被截断
        const text = (pl as { text?: string }).text
        if (typeof text === "string" && text.length > 0) {
          reasoningBuffer += text
          if (process.env.HIDE_REASONING !== "1") {
            // 默认显示:检测是否有完整句子结束;有则 flush,无则继续攒
            const match = reasoningBuffer.match(REASONING_FLUSH_PATTERN)
            if (match && match.index !== undefined) {
              const flushEnd = match.index + 1
              const toFlush = reasoningBuffer.slice(0, flushEnd).trim()
              reasoningBuffer = reasoningBuffer.slice(flushEnd)
              if (toFlush.length > 0) {
                logReasoning(toFlush)
              }
            }
            // 还没攒够:不喷
          } else {
            // 用户主动隐藏:整段 reasoning 在 memoryStore 里,这里只 logDebug
            logDebug(`[reasoning] ${text.slice(0, 200)}`)
          }
        }
      } else if (t === "error") {
        // 框架内部错误:静默到 logDebug(框架会内部重试)
        const errText = ((pl as { errorText?: string }).errorText ?? "").slice(0, 200)
        errorChunksSeen += 1
        logDebug(`[llm] 流式错误（框架内部重试）：${errText}`)
        logger.warn("llm.stream.error", { scope: "autonomous.driveAgentTurn", error: errText, session_id: ctx.sessionId })
      } else if (t === "tool-call-input-streaming-start") {
        // 工具入参开始流式 —— 不喷提示(LLM 自己会说"接下来要 X"),
        // 避免和 LLM 文本流重复;只留 logDebug 供 DEBUG=1 时排查
        const name = (pl as { toolName?: string }).toolName
        if (typeof name === "string") {
          logDebug(`[llm] 工具入参流式开始: ${name}`)
        }
      } else if (t === "tool-call-input-streaming-end") {
        // 工具入参流式结束
        // do nothing;真正的 tool-call chunk 会有完整 args
      } else if (t === "tool-call-delta") {
        // 工具入参 JSON 字符片段:不打印(会很吵);完整 args 见 tool-call chunk
        // 保留 case 占位,以后如需拼装完整 args 可以在此累积
      } else if (t === "tool-call") {
        // 工具调用完整(对应 createTool 工具的入参已就绪)
        const name = (pl as { toolName?: string }).toolName
        if (typeof name === "string") {
          if (firstToolCallNames.length < 10) {
            firstToolCallNames.push(name)
          }
          // V2.7.1 极简: 只打一行 "→ ${toolName} (N字符)"
          // - 工具名 + 入参大小足够让用户判断"系统在跑什么"
          // - 不喷 "框架开始执行"、不喷 "LLM 正在决策" 这类废话
          // - 完整 args 走 logger 记录(供 DEBUG=1 / 审计用)
          const args = (pl as { args?: unknown }).args
          const argsLen = args !== undefined ? JSON.stringify(args).length : 0
          logInfo(`→ ${name} (${argsLen} 字符)`)
          logger.debug("system", {
            scope: "autonomous.driveAgentTurn",
            sub_kind: "tool_call_args_captured",
            tool: name,
            args: redactSecrets(JSON.stringify(args ?? {})).slice(0, SHELL_AUTONOMOUS_PROMPT_PREVIEW_CHARS),
            session_id: ctx.sessionId,
          })
        }
      } else if (t === "tool-result") {
        // 工具执行结果 chunk —— 完全静默
        // (工具自己的 execute 已经通过 logInfo 打了 ✓/✗ 行,这里不重复)
        logDebug(`[llm] 工具结果已返回`)

        // V2.7.3 循环保护:同一工具连续 N 次入参校验失败 → 强制 abort
        // 检测方式:序列化整个 payload,grep "validation failed" / "validation_error" / "Required"
        // 命中即累计;连续 3 次同 tool → 强制结束本轮,避免 LLM 卡死在工具调用上
        const outputStr = JSON.stringify(pl)
        const isValidationError =
          outputStr.includes("validation failed") ||
          outputStr.includes("validation_error") ||
          (outputStr.includes("Required") && outputStr.includes("Tool input"))
        if (isValidationError) {
          const plForName = pl as { toolName?: string }
          const toolName = typeof plForName.toolName === "string" ? plForName.toolName : "unknown"
          const prev = consecutiveValidationFailures.get(toolName) ?? { count: 0, lastError: "" }
          const next = {
            count: prev.count + 1,
            lastError: outputStr.slice(0, 300),
          }
          consecutiveValidationFailures.set(toolName, next)
          // 完整错误直接喷给用户看(V2.7.3 已取消 framework 噪音过滤)
          logWarn(`[系统] 工具 ${toolName} 入参校验失败 (连续 ${next.count} 次): ${next.lastError.slice(0, 200)}`)
          if (next.count >= MAX_CONSECUTIVE_VALIDATION_FAILURES) {
            logError(
              `✗ LLM 在 ${toolName} 工具上反复构造错误入参(连续 ${next.count} 次),强制结束本轮,避免死循环。`
            )
            logError(`  最近一次错误: ${next.lastError.slice(0, 400)}`)
            logError(`  建议:重启 session,或在 prompt 里明确该工具的必填字段`)
            // 直接结束本 turn,不再让 LLM 继续尝试
            currentState = { mode: "idle", lastStepCount: ctx.lastStepCount }
            return currentState
          }
        } else {
          // 正常结果:重置所有工具的失败计数(避免之前累积的计数污染后续调用)
          if (consecutiveValidationFailures.size > 0) {
            consecutiveValidationFailures.clear()
          }
        }
      } else if (t === "step-start") {
        // step 开始
      } else if (t === "start") {
        // run 整体开始
      } else if (t === "finish") {
        // run 整体结束
        const fr = (pl as { finishReason?: string }).finishReason
        if (fr) {
          lastFinishReason = fr
        }
        const rid = (chunk as { runId?: string }).runId
        if (typeof rid === "string") {
          lastRunId = rid
        }
        // V2.7.1: 智能补空行 —— 只在"LLM 说过话 + 上一次输出不是 \n"时才补
        // (解决"Agent 的话紧贴工具事件 / 有时换两行有时不换"的脏乱问题)
        // 注:这里用 accText.length > 0 而不是 LLM 自己的 \n 字符判断,
        //     避免 LLM 输出 \n\n 引发叠加换行
        if (accText.length > 0) {
          process.stdout.write("\n")
        }
        // V2.7.6: turn 结束 flush 剩余 reasoning buffer(防止半句话被吞掉)
        // 默认显示 reasoning;HIDE_REASONING=1 才跳过
        if (reasoningBuffer.length > 0 && process.env.HIDE_REASONING !== "1") {
          const tail = reasoningBuffer.trim()
          if (tail.length > 0) {
            logReasoning(tail)
          }
          reasoningBuffer = ""
        }
      } else {
        // 未知 chunk:仅 debug 记录
        logDebug(`[chunk] 未处理类型=${t} keys=${Object.keys(pl).join(",")}`)
      }
    }

    // 兜底:流式未触发 text-end 也要补一个换行
    endAgentStream()

    // 拉取累积全量(框架提供的 final state),用于挂起信息 / runId
    let fullOutput: Record<string, unknown> | null = null
    try {
      fullOutput = await stream.getFullOutput()
    } catch (error) {
      logDebug(`[llm] stream.getFullOutput 失败：${formatError(error)}`)
    }

    // 优先级:fullOutput > chunk 累积
    const text = (fullOutput?.text as string | undefined) ?? accText
    const finishReason =
      (fullOutput?.finishReason as string | undefined) ?? lastFinishReason ?? "unknown"
    const runId = (fullOutput?.runId as string | undefined) ?? lastRunId ?? "unknown"
    const stepsArr = (fullOutput?.steps as Array<{ text?: string }> | undefined) ?? accSteps
    const stepCount = stepsArr.length > 0 ? stepsArr.length : ctx.lastStepCount
    const toolCallsRaw = (fullOutput?.toolCalls as Array<Record<string, unknown>> | undefined) ?? []
    const toolCalls =
      toolCallsRaw.length > 0
        ? toolCallsRaw.map((tc) => {
            const name = tc.toolName ?? (tc as { payload?: { toolName?: string } }).payload?.toolName ?? "unknown"
            return typeof name === "string" ? name : "unknown"
          })
        : firstToolCallNames

    if (toolCalls.length > 0) {
      logDebug(`[llm] LLM 想调用工具：${toolCalls.join(", ")}（step ${ctx.lastStepCount}→${stepCount}）`)
    }
    if (finishReason === "suspended") {
      logDebug(`[llm] LLM 挂起（等待工具审批），finishReason=${finishReason}，errorChunks=${errorChunksSeen}`)
    } else {
      logDebug(`[llm] LLM 完成，finishReason=${finishReason}，text 长度=${text.length}字符`)
    }

    logger.info("llm.response", {
      scope: "autonomous.driveAgentTurn",
      session_id: ctx.sessionId,
      run_id: runId,
      finish_reason: finishReason,
      tool_calls: toolCalls,
      text_chars: text.length,
      step_count: stepCount,
      error_chunks: errorChunksSeen,
      usage: fullOutput?.usage,
    })

    // 始终把 agent 的最终文本记入记忆
    if (text) {
      memoryStore.addMessage(ctx.sessionId, "agent", text, {
        finishReason,
        runId,
        toolCount: toolCalls.length,
      })
    }

    // 完成（stop / end_turn / 其它非 suspended）→ 结束本轮
    // V2.5: text 已经在上面 `extractNewStepText` 实时打过增量了，这里只更新 stepCount，不再重复打全量
    if (finishReason !== "suspended") {
      currentState = { mode: "idle", lastStepCount: stepCount }
      return currentState
    }

    // 取出挂起信息
    // V2.6: 优先取 chunk 里捕获的 suspendPayload,fullOutput 兜底
    const suspendPayload =
      suspendPayloadFromChunk ??
      ((fullOutput?.suspendPayload as Record<string, unknown> | undefined) ?? {})
    const toolCallId = (suspendPayload.toolCallId as string) ?? ""
    const toolName = (suspendPayload.toolName as string) ?? ""
    const args = ((suspendPayload.args as Record<string, unknown>) ?? {})

    if (!toolCallId || !toolName) {
      logError("Mastra 挂起信息缺少 toolCallId / toolName，结束本轮。")
      currentState = { mode: "idle", lastStepCount: stepCount }
      return currentState
    }

    // ask-user 走专门通道
    if (toolName === "askUser") {
      ctx.sessionFlags.askUserCount += 1
      if (ctx.sessionFlags.askUserCount > MAX_ASK_USER_PER_TURN) {
        logError(`Agent 在本 turn 内连续调用 ask-user 超过 ${MAX_ASK_USER_PER_TURN} 次，强制结束。`)
        currentState = { mode: "idle", lastStepCount: stepCount }
        return currentState
      }
      const payload = args as Partial<AskUserPayload>
      const question = typeof payload.question === "string" ? payload.question : "（无问题文本）"
      const options = Array.isArray(payload.options) ? payload.options.map(String) : undefined
      currentState = {
        mode: "awaiting_user_question",
        pending: { runId, toolCallId, toolName, args },
        question,
        options,
        lastStepCount: stepCount,
      }
      return currentState
    }

    // 其他工具走通用审批通道
    const pending: PendingToolCall = { runId, toolCallId, toolName, args }
    currentState = { mode: "awaiting_tool_approval", pending, lastStepCount: stepCount }
    return currentState
  }
}

/**
 * 处理审批结果
 *
 * V2.4 关键改动：resume 后只打印 `fromLastStepCount` 之后的新 step 的 text，
 * 避免把首轮 LLM 已经说过的"好的，我先读取源文件..."这类开场白重复打印。
 */
async function resolveApproval(ctx: {
  sessionId: string
  sessionFlags: SessionFlags
  llmRetries: number
  rl: readline.Interface
  pending: PendingToolCall
  decision: import("./types.js").ApprovalDecision
  /** resume 前累积的 step 数；resume 后只打印 fromIndex 之后的新 step */
  lastStepCount: number
}): Promise<AutonomousState> {
  const { pending, decision, sessionFlags, lastStepCount } = ctx

  // V2.6.3: 用户在 y/n 框里输入 exit → 直接退出 REPL,不调 framework
  if (decision.kind === "exit") {
    logInfo("→ 用户在审批框里选择 exit，结束本轮并退出 REPL。")
    return { mode: "exit" }
  }

  // 更新会话级名单
  if (decision.kind === "approve_always") {
    if (!sessionFlags.shellAutoApprovePrefixes.includes(decision.prefix)) {
      sessionFlags.shellAutoApprovePrefixes.push(decision.prefix)
    }
  } else if (decision.kind === "decline_always") {
    if (!sessionFlags.shellDenyPrefixes.includes(decision.prefix)) {
      sessionFlags.shellDenyPrefixes.push(decision.prefix)
    }
  }

  if (decision.kind === "rejected") {
    // 让用户重新输入
    const newDecision = await promptForApproval(pending, sessionFlags, ctx.rl)
    return resolveApproval({ ...ctx, decision: newDecision })
  }

  // 调用 approveToolCallGenerate / declineToolCallGenerate 恢复 Agent
  // 把"放行/拒绝"也作为一条 tool 消息记入记忆，便于后续 Agent 看到决策
  memoryStore.addMessage(
    ctx.sessionId,
    "tool",
    JSON.stringify({ tool: pending.toolName, decision: decision.kind, args: redactSecrets(JSON.stringify(pending.args)).slice(0, 1000) }),
    { toolName: pending.toolName, toolCallId: pending.toolCallId, decision: decision.kind }
  )

  const approve = decision.kind === "approve" || decision.kind === "approve_always"
  const agent = getModuleAgent()
  // V2.6: resume 后流式输出新文本(text-delta 实时喷,避免重复打印)
  // V2.6.1: 改用 approveToolCall / declineToolCall(返回 stream 对象,带 fullStream)
  //         之前用的 approveToolCallGenerate / declineToolCallGenerate 走 generate 路径,
  //         返回的是 fullOutput 对象(没有 fullStream 字段),导致 for await 报 undefined。
  const resumeStream = approve
    ? await (agent as unknown as {
        approveToolCall: (o: { runId: string; toolCallId: string }) => Promise<{
          fullStream: AsyncIterable<Record<string, unknown>>
          getFullOutput: () => Promise<Record<string, unknown>>
        }>
      }).approveToolCall({
        runId: pending.runId,
        toolCallId: pending.toolCallId,
      })
    : await (agent as unknown as {
        declineToolCall: (o: { runId: string; toolCallId: string }) => Promise<{
          fullStream: AsyncIterable<Record<string, unknown>>
          getFullOutput: () => Promise<Record<string, unknown>>
        }>
      }).declineToolCall({
        runId: pending.runId,
        toolCallId: pending.toolCallId,
      })

  // 流式迭代 + 累积全量
  let accText = ""
  let accSteps: Array<{ text?: string }> = []
  let stepTextBuffer = ""
  let lastFinishReason: string | null = null
  let lastRunId: string | null = null
  let suspendPayloadFromChunk: Record<string, unknown> | null = null

  for await (const chunk of resumeStream.fullStream) {
    const t = (chunk as { type?: string }).type
    if (t === "text-delta") {
      const delta = (chunk as { delta?: string }).delta
      if (typeof delta === "string" && delta.length > 0) {
        accText += delta
        stepTextBuffer += delta
        writeAgentStream(delta)
      }
    } else if (t === "text-end" || t === "finish-step") {
      endAgentStream()
      if (t === "finish-step" && stepTextBuffer.length > 0) {
        accSteps.push({ text: stepTextBuffer })
        stepTextBuffer = ""
      }
    } else if (t === "reasoning-delta") {
      const delta = (chunk as { delta?: string }).delta
      if (typeof delta === "string" && delta.length > 0) {
        logDebug(`[reasoning] ${delta}`)
      }
    } else if (t === "error") {
      const errText = ((chunk as { errorText?: string }).errorText ?? "").slice(0, 200)
      logDebug(`[llm] resume 流式错误：${errText}`)
      logger.warn("llm.stream.error", { scope: "autonomous.resolveApproval", error: errText, session_id: ctx.sessionId })
    } else if (t === "tool-call-suspended") {
      const sp = (chunk as { payload?: { suspendPayload?: Record<string, unknown> } }).payload?.suspendPayload
      if (sp && typeof sp === "object") {
        suspendPayloadFromChunk = sp
      }
    } else if (t === "finish") {
      const payload = (chunk as { payload?: { finishReason?: string } }).payload
      if (payload?.finishReason) {
        lastFinishReason = payload.finishReason
      }
      const rid = (chunk as { runId?: string }).runId
      if (typeof rid === "string") {
        lastRunId = rid
      }
    }
  }
  endAgentStream()

  let fullOutput: Record<string, unknown> | null = null
  try {
    fullOutput = await resumeStream.getFullOutput()
  } catch (error) {
    logDebug(`[llm] resume.getFullOutput 失败：${formatError(error)}`)
  }

  const finishReason = (fullOutput?.finishReason as string | undefined) ?? lastFinishReason ?? "unknown"
  const outputRunId = (fullOutput?.runId as string | undefined) ?? lastRunId ?? pending.runId
  const stepsArr = (fullOutput?.steps as Array<{ text?: string }> | undefined) ?? accSteps
  const newStepCount = stepsArr.length > 0 ? stepsArr.length : lastStepCount
  const newText = (fullOutput?.text as string | undefined) ?? accText

  // V2.6: 把"恢复"事件降到 logDebug,不再喷到 CLI
  logDebug(`[llm] Agent 工具审批后恢复，decision=${decision.kind}，step ${lastStepCount}→${newStepCount}`)

  // 流式 chunk 已实时打过了,这里只把累积文本存进 memory,不再 echo 到 CLI
  if (newText) {
    memoryStore.addMessage(ctx.sessionId, "agent", newText, { finishReason, source: "resume" })
  }
  if (finishReason !== "suspended") {
    logDebug(`[llm] LLM 完成，finishReason=${finishReason}，text 长度=${newText.length}字符`)
  }

  // 如果 resume 后又挂起，回到审批流程；否则 idle
  if (finishReason === "suspended") {
    const sp =
      suspendPayloadFromChunk ??
      ((fullOutput?.suspendPayload as Record<string, unknown> | undefined) ?? {})
    const next: PendingToolCall = {
      runId: outputRunId,
      toolCallId: (sp.toolCallId as string) ?? "",
      toolName: (sp.toolName as string) ?? "",
      args: (sp.args as Record<string, unknown>) ?? {},
    }
    if (next.toolName === "askUser") {
      const payload = next.args as Partial<AskUserPayload>
      return {
        mode: "awaiting_user_question",
        pending: next,
        question: typeof payload.question === "string" ? payload.question : "",
        options: Array.isArray(payload.options) ? payload.options.map(String) : undefined,
        lastStepCount: newStepCount,
      }
    }
    return { mode: "awaiting_tool_approval", pending: next, lastStepCount: newStepCount }
  }
  return { mode: "idle", lastStepCount: newStepCount }
}

/**
 * 处理 ask-user 工具的恢复（用户回答后）
 *
 * V2.4 关键改动：同上，用 extractNewStepText 取本轮新增 step 的 text。
 */
async function resumeAfterAskUser(ctx: {
  sessionId: string
  sessionFlags: SessionFlags
  llmRetries: number
  rl: readline.Interface
  pending: PendingToolCall
  answer: string
  lastStepCount: number
}): Promise<AutonomousState> {
  // 关键技巧：ask-user 工具挂起时，suspendPayload.args 里有 question；
  // CLI 拿到用户回答后，调用 approveToolCallGenerate，框架会把
  // `context`（这里我们用 args.context）作为工具结果反馈给 Agent。
  memoryStore.addMessage(ctx.sessionId, "tool", JSON.stringify({ tool: "askUser", answer: ctx.answer }), {
    toolName: "askUser",
    toolCallId: ctx.pending.toolCallId,
  })

  // V2.6: 流式 resume(同 resolveApproval 思路)
  // V2.6.1: 改用 approveToolCall(返回 stream 对象)
  const resumeStream = await (getModuleAgent() as unknown as {
    approveToolCall: (o: { runId: string; toolCallId: string }) => Promise<{
      fullStream: AsyncIterable<Record<string, unknown>>
      getFullOutput: () => Promise<Record<string, unknown>>
    }>
  }).approveToolCall({
    runId: ctx.pending.runId,
    toolCallId: ctx.pending.toolCallId,
  })

  let accText = ""
  let accSteps: Array<{ text?: string }> = []
  let stepTextBuffer = ""
  let lastFinishReason: string | null = null
  let lastRunId: string | null = null
  let suspendPayloadFromChunk: Record<string, unknown> | null = null

  for await (const chunk of resumeStream.fullStream) {
    const t = (chunk as { type?: string }).type
    if (t === "text-delta") {
      const delta = (chunk as { delta?: string }).delta
      if (typeof delta === "string" && delta.length > 0) {
        accText += delta
        stepTextBuffer += delta
        writeAgentStream(delta)
      }
    } else if (t === "text-end" || t === "finish-step") {
      endAgentStream()
      if (t === "finish-step" && stepTextBuffer.length > 0) {
        accSteps.push({ text: stepTextBuffer })
        stepTextBuffer = ""
      }
    } else if (t === "reasoning-delta") {
      const delta = (chunk as { delta?: string }).delta
      if (typeof delta === "string" && delta.length > 0) {
        logDebug(`[reasoning] ${delta}`)
      }
    } else if (t === "error") {
      const errText = ((chunk as { errorText?: string }).errorText ?? "").slice(0, 200)
      logDebug(`[llm] ask-user resume 流式错误：${errText}`)
      logger.warn("llm.stream.error", { scope: "autonomous.resumeAfterAskUser", error: errText, session_id: ctx.sessionId })
    } else if (t === "tool-call-suspended") {
      const sp = (chunk as { payload?: { suspendPayload?: Record<string, unknown> } }).payload?.suspendPayload
      if (sp && typeof sp === "object") {
        suspendPayloadFromChunk = sp
      }
    } else if (t === "finish") {
      const payload = (chunk as { payload?: { finishReason?: string } }).payload
      if (payload?.finishReason) {
        lastFinishReason = payload.finishReason
      }
      const rid = (chunk as { runId?: string }).runId
      if (typeof rid === "string") {
        lastRunId = rid
      }
    }
  }
  endAgentStream()

  let fullOutput: Record<string, unknown> | null = null
  try {
    fullOutput = await resumeStream.getFullOutput()
  } catch (error) {
    logDebug(`[llm] ask-user resume.getFullOutput 失败：${formatError(error)}`)
  }

  const finishReason = (fullOutput?.finishReason as string | undefined) ?? lastFinishReason ?? "unknown"
  const outputRunId = (fullOutput?.runId as string | undefined) ?? lastRunId ?? ctx.pending.runId
  const stepsArr = (fullOutput?.steps as Array<{ text?: string }> | undefined) ?? accSteps
  const newStepCount = stepsArr.length > 0 ? stepsArr.length : ctx.lastStepCount
  const newText = (fullOutput?.text as string | undefined) ?? accText

  // V2.6: 调试行降级
  logDebug(`[llm] ask-user 工具恢复，step ${ctx.lastStepCount}→${newStepCount}`)
  if (newText) {
    memoryStore.addMessage(ctx.sessionId, "agent", newText, { source: "ask_user_resume" })
    // 不再二次打全量:text-delta 已实时喷过
  }
  if (finishReason !== "suspended") {
    logDebug(`[llm] LLM 完成，finishReason=${finishReason}，text 长度=${newText.length}字符`)
  }

  if (finishReason === "suspended") {
    const sp =
      suspendPayloadFromChunk ??
      ((fullOutput?.suspendPayload as Record<string, unknown> | undefined) ?? {})
    const next: PendingToolCall = {
      runId: outputRunId,
      toolCallId: (sp.toolCallId as string) ?? "",
      toolName: (sp.toolName as string) ?? "",
      args: (sp.args as Record<string, unknown>) ?? {},
    }
    if (next.toolName === "askUser") {
      const payload = next.args as Partial<AskUserPayload>
      return {
        mode: "awaiting_user_question",
        pending: next,
        question: typeof payload.question === "string" ? payload.question : "",
        options: Array.isArray(payload.options) ? payload.options.map(String) : undefined,
        lastStepCount: newStepCount,
      }
    }
    return { mode: "awaiting_tool_approval", pending: next, lastStepCount: newStepCount }
  }
  return { mode: "idle", lastStepCount: newStepCount }
}

/**
 * 从 memoryStore 构造 Mastra Agent 的 messages 数组
 *
 * 由于 `MessageListInput` 接受 `string | UIMessage[] | ModelMessage[] | MastraDBMessage[]`，
 * 这里把所有 MemoryMessage 转成最简的 `MastraDBMessage` 形式。
 */
function buildMessagesForAgent(sessionId: string): unknown[] {
  let session = memoryStore.getOrCreate(sessionId)
  let messages = session.messages

  // 长历史保护
  if (messages.length > MAX_HISTORY) {
    const summary = memoryStore.summarize(sessionId, KEEP_HISTORY)
    const headCount = messages.length - KEEP_HISTORY
    messages = [
      {
        role: "system",
        content: `[Earlier context summary, ${headCount} messages compacted]\n${summary}`,
        createdAt: new Date().toISOString(),
      } as unknown as typeof messages[number],
      ...messages.slice(headCount),
    ]
    // 写回
    session.messages = messages
  }

  return messages.map(toAgentMessage)
}

function toAgentMessage(m: { role: string; content: string; createdAt: string; metadata?: Record<string, unknown> }): unknown {
  const id = `${m.role}-${m.createdAt}-${Math.random().toString(36).slice(2, 6)}`
  if (m.role === "tool") {
    return {
      id,
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: (m.metadata?.toolCallId as string) ?? "unknown",
          toolName: (m.metadata?.toolName as string) ?? "unknown",
          output: m.content,
        },
      ],
      createdAt: new Date(m.createdAt),
    }
  }
  if (m.role === "agent") {
    return {
      id,
      role: "assistant",
      content: [{ type: "text", text: m.content }],
      createdAt: new Date(m.createdAt),
    }
  }
  if (m.role === "system") {
    return {
      id,
      role: "system",
      content: [{ type: "text", text: m.content }],
      createdAt: new Date(m.createdAt),
    }
  }
  return {
    id,
    role: "user",
    content: [{ type: "text", text: m.content }],
    createdAt: new Date(m.createdAt),
  }
}

/**
 * 从最后一条 message 抽出可读的文本（用于日志预览）
 *
 * 输入是 `MastraDBMessage` 形态的 unknown，content 是分段数组
 * （可能是 text 段，也可能是 tool-result 段）。
 */
function extractLastUserText(message: unknown): string {
  if (!message || typeof message !== "object") return ""
  const m = message as { role?: string; content?: unknown }
  if (m.role !== "user") return ""
  if (typeof m.content === "string") return m.content
  if (!Array.isArray(m.content)) return ""
  return m.content
    .map((part) => {
      if (!part || typeof part !== "object") return ""
      const p = part as { type?: string; text?: string }
      return p.type === "text" && typeof p.text === "string" ? p.text : ""
    })
    .filter(Boolean)
    .join(" ")
}

/** 给 cli.ts 用于在帮助文本里列工具名 */
export { AUTONOMOUS_TOOL_NAMES }

/**
 * 本地实现的 withLlmRetries（与工作流的同名函数行为一致，但完全独立）
 *
 * 重试 N+1 次：
 * 1. 每次失败时**实时在 CLI 打印**错误（不仅是 logger），并显示"第 N/T 次失败，等待 Xs 后重试..."
 * 2. 中间尝试退避 200ms * 2^attempt + 随机抖动；最后一次不等待
 * 3. 仅对**可重试**错误（网络抖动 / 5xx）重试；明确的 4xx（鉴权、配额）直接抛
 * 4. 把 attempt / error 写到 logger.warn（中间）或 logger.error（最后一次）
 * 5. 全部失败后抛出最后一次的 error
 *
 * V2.5 改动原因：之前 ECONNRESET 失败时用户看不到任何信息，进程直接退出。
 * 现在加 CLI 实时反馈 + 退避，让"网络抖动"类错误可自愈。
 */
async function withLlmRetries<T>(
  label: string,
  retries: number,
  task: () => Promise<T>
): Promise<T> {
  const retryCount = Number.isFinite(retries) ? Math.max(0, Math.floor(retries)) : 0
  const total = retryCount + 1
  let lastError: unknown
  for (let attempt = 1; attempt <= total; attempt += 1) {
    try {
      return await task()
    } catch (error) {
      lastError = error
      const errMsg = formatError(error)
      const isLast = attempt >= total
      // CLI 实时提示：用户能在终端直接看到 LLM 调用失败的原因
      if (isLast) {
        logError(`LLM 调用失败（${label}）：${errMsg}`)
        logError(`  已重试 ${attempt - 1} 次仍失败。请检查网络或 API Key。`)
      } else {
        // 指数退避：200ms / 400ms / 800ms / 1600ms... + 0~200ms 抖动
        const baseMs = 200 * Math.pow(2, attempt - 1)
        const jitter = Math.floor(Math.random() * 200)
        const waitMs = Math.min(baseMs + jitter, 5_000)
        logWarn(`LLM 调用失败（${label}，第 ${attempt}/${total} 次）：${errMsg}`)
        logInfo(`  等待 ${waitMs}ms 后重试...`)
        logger.warn("llm.retry", {
          scope: "autonomous.withLlmRetries",
          stage: label,
          attempt,
          total_attempts: total,
          wait_ms: waitMs,
          error: errMsg,
        })
        await sleep(waitMs)
      }
    }
  }
  if (!lastError) {
    // 走到这里说明 total=0 但 task() 没抛错——上面 return 过了，不应到这里
    throw new Error("withLlmRetries: unreachable")
  }
  logger.error("llm.failed", {
    scope: "autonomous.withLlmRetries",
    stage: label,
    total_attempts: total,
    error: formatError(lastError),
  })
  throw lastError instanceof Error ? lastError : new Error(formatError(lastError))
}

/**
 * 简单 sleep（setTimeout 的 Promise 包装）
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
