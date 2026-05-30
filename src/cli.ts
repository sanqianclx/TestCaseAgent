import fs from "fs"
import path from "path"
import readline from "readline/promises"
import { stdin as input, stdout as output } from "process"
import { canUseLLM, formatError, getLlmUnavailableReason, loadProjectEnv } from "./mastra/runtime/env.js"
import { cliAgent } from "./mastra/agents/cli-conversation-agent.js"
import { generateTestWorkflow, resumeGeneratedTests, setLlmRetriesExhaustedHandler } from "./mastra/workflows/generate-test-workflow.js"
import { detectLanguage, type SupportedLanguage } from "./mastra/languages/registry.js"
import { assessCommandRisk, runCommandInVisibleTerminal } from "./mastra/runtime/command-runner.js"
import { memoryStore } from "./mastra/memory/in-memory-store.js"
import { getSessionState, updateSessionState } from "./mastra/memory/session-state.js"

/**
 * 拦截全局 console.log，项目中所有以 "Agent" 或 "User" 开头的消息自动着色
 * Agent → 亮黄色加粗  |  User → 亮青色加粗
 */
const originalLog = console.log
console.log = (...args: unknown[]) => {
  const first = args[0]
  if (typeof first === "string") {
    if (first.startsWith("Agent")) {
      return originalLog("\x1b[1;93m" + first + "\x1b[0m", ...args.slice(1))
    }
    if (first.startsWith("User")) {
      return originalLog("\x1b[1;96m" + first + "\x1b[0m", ...args.slice(1))
    }
  }
  originalLog(...args)
}
const USER_PROMPT = "\x1b[1;96mUser：\x1b[0m"

type WorkflowResult = {
  source_file: string
  language: SupportedLanguage
  test_code: string
  test_cases?: unknown[]
  test_cases_count: number
  diagnosis?: { next_action?: string; report_text?: string; summary?: string; suggested_commands?: string[] }
  [key: string]: unknown
}

type CliArgs = {
  input?: string
  output?: string
  maxAttempts: number
  llmRetries: number
  requirementsText?: string
  language?: string
  interactive: boolean
  help: boolean
}

type PendingPlan = {
  filePath: string
  outputDir: string
  language: SupportedLanguage
  maxAttempts: number
  llmRetries: number
  requirementsText?: string
  env?: Record<string, string>
}

type PendingCommand = {
  command: string
  cwd: string
  reason: string
  plan?: PendingPlan
  pausedResult?: WorkflowResult
}

type PendingFollowup = {
  plan: PendingPlan
  reason: string
  diagnosis?: unknown
  suggestedCommand?: string
  nextMaxAttempts?: number
  pausedResult?: WorkflowResult
}

type AgentDecision = {
  action: "answer" | "ask" | "propose_plan" | "cancel" | "exit"
  reply: string
  plan?: {
    file_path?: string
    output_dir?: string
    language?: string
    max_attempts?: number
    llm_retries?: number
    requirements_text?: string
  }
}

type PendingIntent = {
  intent: "confirm" | "cancel" | "exit" | "other"
  reply?: string
}

type FollowupDecision = {
  action: "answer" | "continue" | "run_command" | "update_env" | "update_plan" | "cancel" | "exit"
  reply?: string
  command?: string
  env?: Record<string, string>
  plan?: AgentDecision["plan"]
}

/**
 * 统一 Agent 的输出类型，根据 mode 决定哪些字段有效
 */
type UnifiedCliDecision = {
  mode: "conversation" | "intent" | "followup"
  action?: string
  reply?: string
  intent?: string
  command?: string
  env?: Record<string, string>
  plan?: AgentDecision["plan"]
}

type ConversationState =
  | { mode: "idle" }
  | { mode: "awaiting_plan_confirmation"; plan: PendingPlan }
  | { mode: "awaiting_command_confirmation"; command: PendingCommand }
  | { mode: "awaiting_followup"; followup: PendingFollowup }
  | { mode: "exit" }

async function main(): Promise<void> {
  loadProjectEnv()
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printHelp()
    return
  }

  if (args.input && !args.interactive) {
    await runGeneration({
      filePath: args.input,
      outputDir: args.output ?? "./output/exports",
      maxAttempts: args.maxAttempts,
      llmRetries: args.llmRetries,
      requirementsText: args.requirementsText,
      language: args.language,
      sessionId: "cli",
    })
    return
  }

  await runInteractive(args)
}

async function runInteractive(args: CliArgs): Promise<void> {
  const sessionId = `cli-${Date.now()}`
  let state: ConversationState = { mode: "idle" }
  memoryStore.addMessage(sessionId, "system", "自然语言 CLI 会话已启动")

  console.log("单元测试生成 Agent 已启动。你可以说：为 output\\sources\\test_source.py 生成测试")
  const rl = readline.createInterface({ input, output })

  try {
    if (args.input) {
      const plan = resolvePlan({
        file_path: args.input,
        output_dir: args.output,
        language: args.language,
        max_attempts: args.maxAttempts,
        llm_retries: args.llmRetries,
        requirements_text: args.requirementsText,
      }, sessionId)
      printPlan("I prepared a plan from startup arguments.", plan)
      state = { mode: "awaiting_plan_confirmation", plan }
    }

    while (true) {
      const line = (await rl.question(USER_PROMPT)).trim()
      if (!line) continue
      memoryStore.addMessage(sessionId, "user", line)

      if (state.mode === "awaiting_followup") {
        const decision = await askFollowupAgent(line, sessionId, state.followup, args)
        state = await applyFollowupDecision(decision, state.followup, sessionId)
        if (state.mode === "exit") break
        continue
      }

      if (state.mode === "awaiting_command_confirmation") {
        const intent = await askPendingIntent(line, sessionId, state, args)
        if (intent.intent === "exit") {
          console.log("Agent：再见。")
          break
        }
        if (intent.intent === "confirm") {
          const commandResult = await runVisibleCommand(state.command, sessionId)
          if (state.command.plan && commandResult.exitCode === 0) {
            console.log("Agent：命令执行成功。现在继续已暂停的工作流。")
            state = state.command.pausedResult
              ? await resumePausedWorkflow(state.command.pausedResult, state.command.plan, sessionId)
              : await maybeAskNextAction(await runGeneration({ ...state.command.plan, sessionId, interactive: true }), state.command.plan, sessionId)
            continue
          }
          if (state.command.plan) {
            console.log("Agent：命令未成功执行。我将保持计划挂起状态；修复环境后请再次确认。")
            state = { mode: "awaiting_plan_confirmation", plan: state.command.plan }
            continue
          }
        } else if (intent.intent === "cancel") {
          console.log("Agent：命令已跳过。诊断结果已写入报告。")
        } else {
          console.log(`Agent：${intent.reply ?? "我需要你的决定后才能执行命令。"}`)
          continue
        }
        state = { mode: "idle" }
        continue
      }

      if (state.mode === "awaiting_plan_confirmation") {
        const intent = await askPendingIntent(line, sessionId, state, args)
        if (intent.intent === "exit") {
          console.log("Agent：再见。")
          break
        }
        if (intent.intent === "confirm") {
          const result = await runGeneration({ ...state.plan, sessionId, interactive: true })
          state = await maybeAskNextAction(result, state.plan, sessionId)
          continue
        }
        if (intent.intent === "cancel") {
          console.log("Agent：已取消。准备好后告诉我另一个源文件路径。")
          state = { mode: "idle" }
          continue
        }
      }

      const decision = await askConversationAgent(line, sessionId, state, args)
      state = await applyDecision(decision, sessionId, state)
      if (state.mode === "exit") break
    }
  } finally {
    rl.close()
  }
}

async function askConversationAgent(
  userMessage: string,
  sessionId: string,
  state: ConversationState,
  args: CliArgs
): Promise<AgentDecision> {
  if (!canUseLLM()) {
    return {
      action: "answer",
      reply: `LLM 未连接，无法理解请求或生成测试。原因：${getLlmUnavailableReason()}`,
    }
  }

  const sessionState = getSessionState(sessionId)
  try {
      return await withRetries("CLI 对话", args.llmRetries, async () => {
      const response = await cliAgent.generate(`
mode=conversation

当前工作目录：${process.cwd()}
对话记忆：${memoryStore.summarize(sessionId)}
当前 CLI 状态：${JSON.stringify(state, null, 2)}
启动参数和上下文记忆：
${JSON.stringify({
  output: args.output,
  maxAttempts: args.maxAttempts,
  llmRetries: args.llmRetries,
  requirementsText: args.requirementsText,
  language: args.language,
  lastSourceFile: sessionState.lastSourceFile,
  lastOutputDir: sessionState.lastOutputDir,
  lastLanguage: sessionState.lastLanguage,
  lastLlmRetries: sessionState.lastLlmRetries,
}, null, 2)}

用户最新消息：
${userMessage}
`, { modelSettings: { temperature: 0.2, maxOutputTokens: 2048 } })
      return parseConversationDecision(response.text)
    })
  } catch (error) {
    return {
      action: "answer",
      reply: `LLM 调用失败，不会使用本地回退。原因：${formatError(error)}`,
    }
  }
}

async function askPendingIntent(
  userMessage: string,
  sessionId: string,
  state: Exclude<ConversationState, { mode: "idle" } | { mode: "exit" }>,
  args: CliArgs
): Promise<PendingIntent> {
  if (!canUseLLM()) {
    return {
      intent: "other",
      reply: `LLM 未连接，无法理解此回复。原因：${getLlmUnavailableReason()}`,
    }
  }

  return await withRetries("待定意图分类", args.llmRetries, async () => {
    const response = await cliAgent.generate(`
mode=intent

待定状态：
${JSON.stringify(state, null, 2)}

对话记忆：
${memoryStore.summarize(sessionId)}

用户最新回复：
${userMessage}
`, { modelSettings: { temperature: 0, maxOutputTokens: 1024 } })
    return parseIntentDecision(response.text)
  })
}

async function askFollowupAgent(
  userMessage: string,
  sessionId: string,
  followup: PendingFollowup,
  args: CliArgs
): Promise<FollowupDecision> {
  if (!canUseLLM()) {
    return {
      action: "answer",
      reply: `LLM 未连接，无法理解此回复。原因：${getLlmUnavailableReason()}`,
    }
  }

  return await withRetries("工作流跟进", args.llmRetries, async () => {
    const response = await cliAgent.generate(`
mode=followup

已暂停的工作流上下文：
${JSON.stringify(followup, null, 2)}

对话记忆：
${memoryStore.summarize(sessionId)}

用户最新回复：
${userMessage}
`, { modelSettings: { temperature: 0, maxOutputTokens: 2048 } })
    return parseFollowupDecision(response.text)
  })
}

async function askRetryExtensionWithAI(label: string, errorText: string, llmRetries: number): Promise<number> {
  const ql = readline.createInterface({ input, output })
  try {
    while (true) {
      console.log(`\nLLM 调用"${label}"已耗尽重试次数。`)
      console.log(`最后错误：${errorText}`)
      const answer = await ql.question("是否要增加 3 次重试？")
      const intent = await withRetries("重试扩展意图分类", llmRetries, async () => {
        const response = await cliAgent.generate([
          "mode=intent",
          "",
          "待定问题：为 " + label + " 增加 3 次重试",
          "最后错误：" + errorText,
          "用户回复：" + answer,
        ].join("\n"), { modelSettings: { temperature: 0, maxOutputTokens: 512 } })
        return parseIntentDecision(response.text)
      })
      if (intent.intent === "confirm") return 3
      if (intent.intent === "cancel" || intent.intent === "exit") {
        console.log("Agent：好的，我将停止重试并报告失败。")
        return 0
      }
      console.log(`Agent：${intent.reply ?? "增加重试前我需要一个明确的决定。"}`)
    }
  } finally {
    ql.close()
  }
}

async function applyDecision(
  decision: AgentDecision,
  sessionId: string,
  state: ConversationState
): Promise<ConversationState> {
  if (decision.action === "answer" || decision.action === "ask") {
    console.log(`Agent：${decision.reply}`)
    memoryStore.addMessage(sessionId, "agent", decision.reply)
    return state.mode === "awaiting_plan_confirmation" ? state : { mode: "idle" }
  }

  if (decision.action === "cancel") {
    console.log(`Agent：${decision.reply ?? "已取消。"}`)
    return { mode: "idle" }
  }

  if (decision.action === "exit") {
    console.log(`Agent：${decision.reply ?? "再见。"}`)
    return { mode: "exit" }
  }

  if (decision.action === "propose_plan") {
    try {
      const plan = resolvePlan(decision.plan ?? {}, sessionId)
      printPlan(decision.reply, plan)
      return { mode: "awaiting_plan_confirmation", plan }
    } catch (error) {
      console.log(`Agent：暂时无法启动，因为 ${formatError(error)}`)
      return state
    }
  }

  console.log("Agent：我没理解。请告诉我源文件路径或问我能做什么。")
  return state
}

async function runGeneration(inputData: {
  filePath: string
  outputDir: string
  maxAttempts: number
  llmRetries: number
  requirementsText?: string
  language?: string
  env?: Record<string, string>
  sessionId: string
  interactive?: boolean
}) {
  const sourceFile = path.resolve(inputData.filePath)
  const language = detectLanguage(sourceFile, inputData.language)
  const outputDir = path.resolve(inputData.outputDir)

  updateSessionState(inputData.sessionId, {
    lastSourceFile: sourceFile,
    lastOutputDir: outputDir,
    lastLanguage: language,
    lastRequirements: inputData.requirementsText,
    lastLlmRetries: inputData.llmRetries,
  })

  console.log("Agent：已确认。开始测试生成，逐步打印进度。")

  const restoreEnv = applyTemporaryEnv(inputData.env)
  if (inputData.interactive) {
    setLlmRetriesExhaustedHandler(async (label: string, errorText: string) => {
      return askRetryExtensionWithAI(label, errorText, inputData.llmRetries)
    })
  }

  try {
    const run = await generateTestWorkflow.createRun()
    const result = await run.start({
      inputData: {
        file_path: sourceFile,
        output_dir: outputDir,
        max_attempts: inputData.maxAttempts,
        llm_retries: inputData.llmRetries,
        requirements_text: inputData.requirementsText,
        language,
      },
    })

    if (result.status !== "success") {
      const message = result.status === "failed" ? result.error.message : JSON.stringify(result, null, 2)
      console.log(`Agent：生成失败：${message}`)
      memoryStore.addMessage(inputData.sessionId, "agent", `生成失败：${message}`)
      process.exitCode = 1
      return undefined
    }

    const outputData = result.result
    updateSessionState(inputData.sessionId, {
      lastRunSummary: {
        passed: outputData.passed,
        exportedFiles: outputData.exported_files,
        message: `${outputData.language} 工作流通过=${outputData.passed}`,
      },
    })
    memoryStore.addMessage(inputData.sessionId, "agent", "生成完成", {
      language: outputData.language,
      passed: outputData.passed,
      diagnosis: outputData.diagnosis,
      exportedFiles: outputData.exported_files,
    })

    if (inputData.interactive && outputData.diagnosis?.next_action === "INSTALL_DEPENDENCY") {
      console.log("Agent：工作流在测试执行期间暂停。")
      console.log(`- 语言：${outputData.language}`)
      console.log(`- 设计的测试用例数：${outputData.test_cases_count}`)
      console.log("- AI 诊断：")
      console.log(outputData.diagnosis.report_text ?? outputData.diagnosis.summary ?? "需要环境或依赖操作。")
      return outputData
    }

    console.log("Agent：任务完成。")
    console.log(`- 语言：${outputData.language}`)
    console.log(`- 测试是否通过：${outputData.passed ? "是" : "否"}`)
    console.log(`- 测试用例数：${outputData.test_cases_count}`)
    if (outputData.quality) console.log(`- 质量检查：${outputData.quality.ok ? "通过" : "未通过"}`)
    if (outputData.coverage) {
      console.log(`- 覆盖率：${outputData.coverage.symbol_coverage}% 符号（${outputData.coverage.covered_symbols.length}/${outputData.coverage.total_symbols}）`)
    }
    if (outputData.diagnosis) {
      console.log("- AI 诊断：")
      console.log(outputData.diagnosis.report_text ?? outputData.diagnosis.summary ?? "诊断结果已写入报告。")
    }
    console.log("- 导出文件列表：")
    for (const file of outputData.exported_files) console.log(`  - ${file}`)

    return outputData
  } finally {
    setLlmRetriesExhaustedHandler(null)
    restoreEnv()
  }
}

async function maybeAskNextAction(
  result: Awaited<ReturnType<typeof runGeneration>>,
  plan: PendingPlan,
  sessionId: string
): Promise<ConversationState> {
  const diagnosis = result?.diagnosis
  const command = diagnosis?.suggested_commands?.[0]

  if (diagnosis?.next_action === "INSTALL_DEPENDENCY") {
    console.log("Agent：工作流已暂停，因为 AI 诊断认为需要环境或依赖操作。")
    if (command) console.log(`建议操作：${command}`)
    console.log("你可以提供工具路径、让我运行命令、说已经修复了、修改计划或取消。")
    memoryStore.addMessage(sessionId, "agent", "工作流暂停，等待用户跟进", { diagnosis, command })
    return {
      mode: "awaiting_followup",
      followup: {
        plan,
        reason: "environment_or_dependency_action_needed",
        diagnosis,
        suggestedCommand: command,
        pausedResult: result,
      },
    }
  }

  if (result && !result.passed && diagnosis?.next_action === "REGENERATE_TEST_CODE") {
    const nextMaxAttempts = plan.maxAttempts + 2
    console.log(`Agent：工作流在重试上限 ${plan.maxAttempts} 处暂停。AI 仍然认为生成的测试代码需要修复。`)
    console.log("你可以继续更多次尝试、修改计划或取消。")
    return {
      mode: "awaiting_followup",
      followup: {
        plan,
        reason: "self_healing_retry_limit_reached",
        diagnosis,
        nextMaxAttempts,
        pausedResult: result,
      },
    }
  }

  return { mode: "idle" }
}

async function applyFollowupDecision(
  decision: FollowupDecision,
  followup: PendingFollowup,
  sessionId: string
): Promise<ConversationState> {
  if (decision.action === "answer") {
    console.log(`Agent：${decision.reply ?? "我正等待你的下一步指示。"}`)
    return { mode: "awaiting_followup", followup }
  }

  if (decision.action === "cancel") {
    console.log(`Agent：${decision.reply ?? "好的，我将停止这个暂停的工作流。"}`)
    return { mode: "idle" }
  }

  if (decision.action === "exit") {
    console.log(`Agent：${decision.reply ?? "再见。"}`)
    return { mode: "exit" }
  }

  if (decision.action === "run_command") {
    const command = decision.command?.trim()
    if (!command || !looksExecutableCommand(command)) {
      console.log(`Agent：${decision.reply ?? "我需要一个具体的 shell 命令才能请求执行权限。"}`)
      return { mode: "awaiting_followup", followup }
    }
    const risk = assessCommandRisk(command)
    console.log(`Agent：${decision.reply ?? "我可以在一个可见的 PowerShell 窗口中运行此命令。"}`)
    console.log(`命令：${command}`)
    console.log(`风险等级：${risk.level}`)
    for (const reason of risk.reasons) console.log(`- ${reason}`)
    console.log("允许我打开一个新的 PowerShell 窗口来运行它吗？")
    return {
      mode: "awaiting_command_confirmation",
      command: {
        command,
        cwd: path.dirname(followup.plan.filePath),
        reason: followup.reason,
        plan: followup.plan,
        pausedResult: followup.pausedResult,
      },
    }
  }

  const updatedPlan = decision.action === "update_plan"
    ? applyPlanDelta(followup.plan, decision.plan)
    : decision.action === "update_env"
      ? { ...followup.plan, env: mergeEnv(followup.plan.env, decision.env) }
      : followup.nextMaxAttempts && followup.reason === "self_healing_retry_limit_reached"
        ? { ...followup.plan, maxAttempts: followup.nextMaxAttempts }
        : followup.plan

  console.log(`Agent：${decision.reply ?? "现在我将继续执行同一个工作流。"}`)
  if (followup.pausedResult && followup.reason === "environment_or_dependency_action_needed" && decision.action !== "update_plan") {
    return await resumePausedWorkflow(followup.pausedResult, updatedPlan, sessionId)
  }
  const result = await runGeneration({ ...updatedPlan, sessionId, interactive: true })
  return await maybeAskNextAction(result, updatedPlan, sessionId)
}

async function resumePausedWorkflow(
  pausedResult: WorkflowResult,
  plan: PendingPlan,
  sessionId: string
): Promise<ConversationState> {
  if (!pausedResult.test_cases?.length) {
    console.log("Agent：内存中没有已生成的测试用例，因此需要重新启动工作流。")
    const result = await runGeneration({ ...plan, sessionId, interactive: true })
    return await maybeAskNextAction(result, plan, sessionId)
  }

  const restoreEnv = applyTemporaryEnv(plan.env)
  try {
    const result = await resumeGeneratedTests({
      sourceFile: pausedResult.source_file,
      outputDir: plan.outputDir,
      language: plan.language,
      testCode: pausedResult.test_code,
      testCases: pausedResult.test_cases as Parameters<typeof resumeGeneratedTests>[0]["testCases"],
      maxAttempts: plan.maxAttempts,
      llmRetries: plan.llmRetries,
    })

    if (result.diagnosis?.next_action === "INSTALL_DEPENDENCY") {
      console.log("Agent：工作流在测试执行期间仍然暂停。")
      console.log(`- 语言：${result.language}`)
      console.log(`- 内存中的测试用例数：${result.test_cases_count}`)
      console.log("- AI 诊断：")
      console.log(result.diagnosis.report_text ?? result.diagnosis.summary ?? "仍然需要环境或依赖操作。")
      return await maybeAskNextAction(result, plan, sessionId)
    }

    console.log("Agent：恢复的工作流已完成。")
    console.log(`- 语言：${result.language}`)
    console.log(`- 测试是否通过：${result.passed ? "是" : "否"}`)
    console.log(`- 测试用例数：${result.test_cases_count}`)
    if (result.quality) console.log(`- 质量检查：${result.quality.ok ? "通过" : "未通过"}`)
    if (result.coverage) {
      console.log(`- 覆盖率：${result.coverage.symbol_coverage}% 符号（${result.coverage.covered_symbols.length}/${result.coverage.total_symbols}）`)
    }
    if (result.diagnosis) {
      console.log("- AI 诊断：")
      console.log(result.diagnosis.report_text ?? result.diagnosis.summary ?? "诊断结果已写入报告。")
    }
    console.log("- 导出文件列表：")
    for (const file of result.exported_files) console.log(`  - ${file}`)

    return await maybeAskNextAction(result, plan, sessionId)
  } finally {
    restoreEnv()
  }
}

async function runVisibleCommand(command: PendingCommand, sessionId: string) {
  console.log("Agent：正在打开一个新的 PowerShell 窗口，你可以观察命令执行情况。")
  const result = runCommandInVisibleTerminal({ command: command.command, cwd: command.cwd, keepOpen: true })
  memoryStore.addMessage(sessionId, "tool", `已执行命令：${command.command}`, { ...result })
  console.log(`Agent：命令执行完毕，退出码：${result.exitCode}，日志文件：${result.logFile}`)
  return result
}

function resolvePlan(plan: AgentDecision["plan"], sessionId: string): PendingPlan {
  const sessionState = getSessionState(sessionId)
  const filePath = plan?.file_path ?? sessionState.lastSourceFile
  if (!filePath) throw new Error("缺少源文件路径")
  const sourceFile = path.resolve(filePath)
  if (!fs.existsSync(sourceFile)) throw new Error(`源文件不存在：${sourceFile}`)

  const outputDir = path.resolve(plan?.output_dir ?? sessionState.lastOutputDir ?? "./output/exports")
  const language = detectLanguage(sourceFile, plan?.language ?? sessionState.lastLanguage ?? "auto")
  const maxAttempts = normalizeAttempts(plan?.max_attempts)
  const llmRetries = normalizeLlmRetries(plan?.llm_retries ?? sessionState.lastLlmRetries)
  const requirementsText = plan?.requirements_text ?? sessionState.lastRequirements
  return { filePath: sourceFile, outputDir, language, maxAttempts, llmRetries, requirementsText }
}

function applyPlanDelta(base: PendingPlan, delta?: AgentDecision["plan"]): PendingPlan {
  if (!delta) return base
  const filePath = delta.file_path ? path.resolve(delta.file_path) : base.filePath
  if (!fs.existsSync(filePath)) throw new Error(`源文件不存在：${filePath}`)
  return {
    filePath,
    outputDir: delta.output_dir ? path.resolve(delta.output_dir) : base.outputDir,
    language: detectLanguage(filePath, delta.language ?? base.language),
    maxAttempts: normalizeAttempts(delta.max_attempts ?? base.maxAttempts),
    llmRetries: normalizeLlmRetries(delta.llm_retries ?? base.llmRetries),
    requirementsText: delta.requirements_text ?? base.requirementsText,
    env: base.env,
  }
}

function mergeEnv(base?: Record<string, string>, update?: Record<string, string>): Record<string, string> | undefined {
  if (!update || Object.keys(update).length === 0) return base
  return { ...(base ?? {}), ...update }
}

function applyTemporaryEnv(env?: Record<string, string>): () => void {
  if (!env || Object.keys(env).length === 0) return () => {}
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(env)) {
    if (key === "PATH_PREPEND") continue
    previous.set(key, process.env[key])
    process.env[key] = value
  }
  if (env.PATH_PREPEND) {
    previous.set("PATH", process.env.PATH)
    process.env.PATH = `${env.PATH_PREPEND}${path.delimiter}${process.env.PATH ?? ""}`
  }
  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function printPlan(reply: string, plan: PendingPlan): void {
  console.log(`Agent：${reply}`)
  console.log("执行计划：")
  console.log(`1. 读取源文件：${plan.filePath}`)
  console.log(`2. 检测语言：${plan.language}`)
  console.log("3. 解析源代码并调用 LLM 设计测试用例")
  console.log("4. 调用 LLM 生成单元测试代码")
  console.log("5. 执行测试并进行质量检查")
  console.log("6. 如果失败，将源代码、测试代码、用例和执行输出发送给 LLM 进行诊断")
  console.log("7. 如果 AI 认为测试代码有误，重新生成直到达到重试上限")
  console.log(`8. 导出测试代码、报告和版本记录到：${plan.outputDir}`)
  console.log(`最大尝试次数：${plan.maxAttempts}`)
  console.log(`每次 LLM 调用的重试次数：${plan.llmRetries}`)
  if (plan.requirementsText) console.log(`额外需求：${plan.requirementsText}`)
  console.log("确认后我将开始执行。")
}

/**
 * 统一解析函数：先 parse JSON，再根据 mode 校验字段
 */
function parseCliDecision(text: string): UnifiedCliDecision {
  const raw = parseJsonObject(text)
  if (!raw || typeof raw !== "object") {
    throw new Error(`CLI Agent 返回了非 JSON 输出。预览：${preview(text)}`)
  }
  const item = raw as Record<string, unknown>
  if (typeof item.mode !== "string" || !["conversation", "intent", "followup"].includes(item.mode)) {
    throw new Error(`CLI Agent 返回了无效的 mode。预览：${preview(text)}`)
  }
  return {
    mode: item.mode as UnifiedCliDecision["mode"],
    action: typeof item.action === "string" ? item.action : undefined,
    reply: typeof item.reply === "string" ? item.reply : undefined,
    intent: typeof item.intent === "string" ? item.intent : undefined,
    command: typeof item.command === "string" ? item.command : undefined,
    env: item.env && typeof item.env === "object" ? item.env as Record<string, string> : undefined,
    plan: item.plan && typeof item.plan === "object" ? item.plan as AgentDecision["plan"] : undefined,
  }
}

function parseConversationDecision(text: string): AgentDecision {
  const decision = parseCliDecision(text)
  if (decision.mode !== "conversation") {
    throw new Error(`期望 conversation 模式，但返回了 ${decision.mode}。预览：${preview(text)}`)
  }
  const action = decision.action as AgentDecision["action"]
  if (!action || !["answer", "ask", "propose_plan", "cancel", "exit"].includes(action)) {
    throw new Error(`CLI Agent 返回了无效的 action（${action}）。预览：${preview(text)}`)
  }
  if (typeof decision.reply !== "string") {
    throw new Error(`CLI Agent 返回缺少 reply。预览：${preview(text)}`)
  }
  return { action, reply: decision.reply, plan: decision.plan }
}

function parseIntentDecision(text: string): PendingIntent {
  const decision = parseCliDecision(text)
  if (decision.mode !== "intent") {
    throw new Error(`期望 intent 模式，但返回了 ${decision.mode}。预览：${preview(text)}`)
  }
  const intent = decision.intent as PendingIntent["intent"]
  if (!intent || !["confirm", "cancel", "exit", "other"].includes(intent)) {
    throw new Error(`CLI Agent 返回了无效的 intent（${intent}）。预览：${preview(text)}`)
  }
  return { intent, reply: decision.reply }
}

function parseFollowupDecision(text: string): FollowupDecision {
  const decision = parseCliDecision(text)
  if (decision.mode !== "followup") {
    throw new Error(`期望 followup 模式，但返回了 ${decision.mode}。预览：${preview(text)}`)
  }
  const action = decision.action as FollowupDecision["action"]
  if (!action || !["answer", "continue", "run_command", "update_env", "update_plan", "cancel", "exit"].includes(action)) {
    throw new Error(`CLI Agent 返回了无效的 action（${action}）。预览：${preview(text)}`)
  }
  return {
    action,
    reply: decision.reply,
    command: decision.command,
    env: decision.env,
    plan: decision.plan,
  }
}

function parseJsonObject(text: string): unknown {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1]) } catch { /* ignore */ }
  }
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return undefined
  try { return JSON.parse(match[0]) } catch { return undefined }
}

function normalizeAttempts(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value < 1) return 3
  return Math.min(Math.floor(value), 20)
}

function normalizeLlmRetries(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value < 0) return 2
  return Math.min(Math.floor(value), 10)
}

async function withRetries<T>(label: string, retries: number, task: () => Promise<T>): Promise<T> {
  const retryCount = Number.isFinite(retries) ? Math.max(0, Math.floor(retries)) : 0
  const attempts = retryCount + 1
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task()
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        console.log(`Agent：${label} 在第 ${attempt}/${attempts} 次尝试中失败，正在重试。原因：${formatError(error)}`)
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(formatError(lastError))
}

function preview(text: string, length = 300): string {
  const normalized = text.replace(/\s+/g, " ").trim()
  return normalized.length > length ? `${normalized.slice(0, length)}...` : normalized
}

function looksExecutableCommand(command: string): boolean {
  return /^(python|py|pip|conda|npm|npx|node|mvn|gradle|cmake|make|g\+\+|gcc|clang|javac|java|dotnet|powershell|pwsh|winget|choco)\b/i.test(command.trim())
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { maxAttempts: 3, llmRetries: 2, interactive: false, help: false }
  const positional: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    const next = argv[index + 1]
    if (current === "--help" || current === "-h") args.help = true
    else if (current === "--interactive" || current === "-I") args.interactive = true
    else if (current === "--input" || current === "-i") { args.input = next; index += 1 }
    else if (current === "--output" || current === "-o") { args.output = next; index += 1 }
    else if (current === "--max-attempts") { args.maxAttempts = Number(next ?? "3"); index += 1 }
    else if (current === "--llm-retries") { args.llmRetries = Number(next ?? "2"); index += 1 }
    else if (current === "--requirements") { args.requirementsText = next; index += 1 }
    else if (current === "--requirements-file") { args.requirementsText = fs.readFileSync(path.resolve(next ?? ""), "utf-8"); index += 1 }
    else if (current === "--language" || current === "-l") { args.language = next; index += 1 }
    else positional.push(current)
  }
  args.input ??= positional[0]
  args.output ??= positional[1]
  args.maxAttempts = normalizeAttempts(args.maxAttempts)
  args.llmRetries = normalizeLlmRetries(args.llmRetries)
  return args
}

function printHelp(): void {
  console.log(`单元测试生成 Agent

使用方法：
  npm run generate -- --interactive
  npm run generate -- --input <源文件> --output <输出目录>
  npm run generate -- <源文件> <输出目录>

选项：
  --input, -i            源文件路径，支持 .py/.java/.cpp/.cc/.hpp/.h
  --output, -o           输出目录，默认为 ./output/exports
  --language, -l         语言：python/java/cpp
  --max-attempts         最大自愈尝试次数，默认为 3
  --llm-retries          每次 LLM 请求的重试次数，默认为 2
  --requirements         额外需求文本
  --requirements-file    从文件读取额外需求
  --interactive, -I      自然语言交互模式
  --help, -h             显示帮助信息
`)
}

main().catch((error) => {
  console.error(`Agent 启动失败：${formatError(error)}`)
  process.exitCode = 1
})
