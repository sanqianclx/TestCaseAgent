import fs from "fs"
import path from "path"
import readline from "readline/promises"
import { stdin as input, stdout as output } from "process"
import { canUseLLM, formatError, getLlmUnavailableReason, loadProjectEnv } from "./mastra/runtime/env.js"
import { cliConversationAgent, cliIntentAgent } from "./mastra/agents/cli-conversation-agent.js"
import { generateTestWorkflow, setLlmRetriesExhaustedHandler } from "./mastra/workflows/generate-test-workflow.js"
import { detectLanguage, type SupportedLanguage } from "./mastra/languages/registry.js"
import { assessCommandRisk, runCommandInVisibleTerminal } from "./mastra/runtime/command-runner.js"
import { memoryStore } from "./mastra/memory/in-memory-store.js"
import { getSessionState, updateSessionState } from "./mastra/memory/session-state.js"

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
}

type PendingCommand = {
  command: string
  cwd: string
  reason: string
  plan?: PendingPlan
}

type PendingRetry = {
  plan: PendingPlan
  nextMaxAttempts: number
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

type ConversationState =
  | { mode: "idle" }
  | { mode: "awaiting_plan_confirmation"; plan: PendingPlan }
  | { mode: "awaiting_command_confirmation"; command: PendingCommand }
  | { mode: "awaiting_retry_confirmation"; retry: PendingRetry }
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
  memoryStore.addMessage(sessionId, "system", "natural language CLI session started")

  console.log("Unit-test generation Agent started. You can say: generate tests for output\\sources\\test_source.py")
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
      const line = (await rl.question("User: ")).trim()
      if (!line) continue
      memoryStore.addMessage(sessionId, "user", line)

      if (state.mode === "awaiting_command_confirmation") {
        const intent = await askPendingIntent(line, sessionId, state, args)
        if (intent.intent === "exit") {
          console.log("Agent: bye.")
          break
        }
        if (intent.intent === "confirm") {
          const commandResult = await runVisibleCommand(state.command, sessionId)
          if (state.command.plan && commandResult.exitCode === 0) {
            console.log("Agent: command finished successfully. Continuing the same workflow now.")
            const result = await runGeneration({ ...state.command.plan, sessionId, interactive: true })
            state = await maybeAskNextAction(result, state.command.plan, sessionId)
            continue
          }
          if (state.command.plan) {
            console.log("Agent: the command did not finish successfully. I will keep the plan blocked here; confirm again after you fix the environment.")
            state = { mode: "awaiting_plan_confirmation", plan: state.command.plan }
            continue
          }
        } else if (intent.intent === "cancel") {
          console.log("Agent: command skipped. The diagnosis is already written to the report.")
        } else {
          console.log(`Agent: ${intent.reply ?? "I need your decision before running the command."}`)
          continue
        }
        state = { mode: "idle" }
        continue
      }

      if (state.mode === "awaiting_retry_confirmation") {
        const intent = await askPendingIntent(line, sessionId, state, args)
        if (intent.intent === "exit") {
          console.log("Agent: bye.")
          break
        }
        if (intent.intent === "confirm") {
          const retryPlan = { ...state.retry.plan, maxAttempts: state.retry.nextMaxAttempts }
          const result = await runGeneration({ ...retryPlan, sessionId, interactive: true })
          state = await maybeAskNextAction(result, retryPlan, sessionId)
        } else if (intent.intent === "cancel") {
          console.log("Agent: okay, I will stop retrying and keep the current report.")
          state = { mode: "idle" }
        } else {
          console.log(`Agent: ${intent.reply ?? "I need your decision on whether to continue retrying."}`)
        }
        continue
      }

      if (state.mode === "awaiting_plan_confirmation") {
        const intent = await askPendingIntent(line, sessionId, state, args)
        if (intent.intent === "exit") {
          console.log("Agent: bye.")
          break
        }
        if (intent.intent === "confirm") {
          const result = await runGeneration({ ...state.plan, sessionId, interactive: true })
          state = await maybeAskNextAction(result, state.plan, sessionId)
          continue
        }
        if (intent.intent === "cancel") {
          console.log("Agent: cancelled. Tell me another source file when you are ready.")
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
      reply: `LLM is not connected, so I cannot understand requests or generate tests. Reason: ${getLlmUnavailableReason()}`,
    }
  }

  const sessionState = getSessionState(sessionId)
  try {
    return await withRetries("CLI conversation", args.llmRetries, async () => {
      const response = await cliConversationAgent.generate(`
You are a command-line unit-test generation agent.
Only handle unit-test generation tasks.
If required information is missing, ask one concise follow-up question.
If enough information is available, propose an execution plan and wait for confirmation.
Preserve user scope constraints in requirements_text, including requests to generate only a limited number of tests.

Return only valid JSON:
{
  "action": "answer" | "ask" | "propose_plan" | "cancel" | "exit",
  "reply": "natural language reply for the user",
  "plan": {
    "file_path": "source file path, optional",
    "output_dir": "output directory, optional",
    "language": "auto|python|java|cpp, optional",
    "max_attempts": 3,
    "llm_retries": 2,
    "requirements_text": "extra requirements, optional"
  }
}

Current working directory: ${process.cwd()}
Conversation memory: ${memoryStore.summarize(sessionId)}
Current CLI state: ${JSON.stringify(state, null, 2)}
Startup args and remembered context:
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

Latest user message:
${userMessage}
`, { modelSettings: { temperature: 0.2, maxOutputTokens: 2048 } })
      return parseDecisionStrict(response.text)
    })
  } catch (error) {
    return {
      action: "answer",
      reply: `LLM call failed and no local fallback will be used. Reason: ${formatError(error)}`,
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
      reply: `LLM is not connected, so I cannot understand this reply. Reason: ${getLlmUnavailableReason()}`,
    }
  }

  return await withRetries("pending intent classification", args.llmRetries, async () => {
    const response = await cliIntentAgent.generate(`
Classify the user's latest reply for the pending CLI state.
Do not execute anything. Only classify the user's intent.

Return only valid JSON:
{
  "intent": "confirm" | "cancel" | "exit" | "other",
  "reply": "short message to show if intent is other, optional otherwise"
}

Pending state:
${JSON.stringify(state, null, 2)}

Conversation memory:
${memoryStore.summarize(sessionId)}

Latest user reply:
${userMessage}
`, { modelSettings: { temperature: 0, maxOutputTokens: 1024 } })
    return parsePendingIntentStrict(response.text)
  })
}

async function applyDecision(
  decision: AgentDecision,
  sessionId: string,
  state: ConversationState
): Promise<ConversationState> {
  if (decision.action === "answer" || decision.action === "ask") {
    console.log(`Agent: ${decision.reply}`)
    memoryStore.addMessage(sessionId, "agent", decision.reply)
    return state.mode === "awaiting_plan_confirmation" ? state : { mode: "idle" }
  }

  if (decision.action === "cancel") {
    console.log(`Agent: ${decision.reply || "Cancelled."}`)
    return { mode: "idle" }
  }

  if (decision.action === "exit") {
    console.log(`Agent: ${decision.reply || "bye."}`)
    return { mode: "exit" }
  }

  if (decision.action === "propose_plan") {
    try {
      const plan = resolvePlan(decision.plan ?? {}, sessionId)
      printPlan(decision.reply, plan)
      return { mode: "awaiting_plan_confirmation", plan }
    } catch (error) {
      console.log(`Agent: I cannot start yet because ${formatError(error)}`)
      return state
    }
  }

  console.log("Agent: I did not understand that. Tell me a source file path or ask what I can do.")
  return state
}

async function runGeneration(inputData: {
  filePath: string
  outputDir: string
  maxAttempts: number
  llmRetries: number
  requirementsText?: string
  language?: string
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

  console.log("Agent: confirmed. Starting test generation and printing each step.")

  if (inputData.interactive) {
    setLlmRetriesExhaustedHandler(async (label: string, errorText: string) => {
      const ql = readline.createInterface({ input, output })
      console.log(`\nLLM 调用 "${label}" 的重试次数已耗尽。`)
      console.log(`最后一次错误：${errorText}`)
      const answer = await ql.question("要额外增加 3 次重试吗？输入 yes/no：")
      ql.close()
      if (/^(yes|y|是|好|继续|确认)$/i.test(answer.trim())) return 3
      console.log("好的，不再重试，生成将结束并报错。")
      return 0
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
      console.log(`Agent: generation failed: ${message}`)
      memoryStore.addMessage(inputData.sessionId, "agent", `generation failed: ${message}`)
      process.exitCode = 1
      return undefined
    }

    const outputData = result.result
    updateSessionState(inputData.sessionId, {
      lastRunSummary: {
        passed: outputData.passed,
        exportedFiles: outputData.exported_files,
        message: `${outputData.language} workflow passed=${outputData.passed}`,
      },
    })
    memoryStore.addMessage(inputData.sessionId, "agent", "generation finished", {
      language: outputData.language,
      passed: outputData.passed,
      diagnosis: outputData.diagnosis,
      exportedFiles: outputData.exported_files,
    })

    console.log("Agent: task finished.")
    console.log(`- Language: ${outputData.language}`)
    console.log(`- Tests passed: ${outputData.passed ? "yes" : "no"}`)
    console.log(`- Test cases: ${outputData.test_cases_count}`)
    if (outputData.quality) console.log(`- Quality: ${outputData.quality.ok ? "passed" : "failed"}`)
    if (outputData.coverage) {
      console.log(`- Coverage: ${outputData.coverage.symbol_coverage}% symbols (${outputData.coverage.covered_symbols.length}/${outputData.coverage.total_symbols})`)
    }
    if (outputData.diagnosis) {
      console.log("- AI diagnosis:")
      console.log(outputData.diagnosis.report_text ?? outputData.diagnosis.summary ?? "Diagnosis written to report.")
    }
    console.log("- Exported files:")
    for (const file of outputData.exported_files) console.log(`  - ${file}`)

    return outputData
  } finally {
    setLlmRetriesExhaustedHandler(null)
  }
}

async function maybeAskNextAction(
  result: Awaited<ReturnType<typeof runGeneration>>,
  plan: PendingPlan,
  sessionId: string
): Promise<ConversationState> {
  const diagnosis = result?.diagnosis
  const command = diagnosis?.suggested_commands?.[0]

  if (diagnosis?.next_action === "INSTALL_DEPENDENCY" && command) {
    if (!looksExecutableCommand(command)) {
      console.log("Agent: AI diagnosis says an environment action is needed, but it is not a shell command.")
      console.log(`Manual action: ${command}`)
      console.log("After you finish it, type confirm and I will continue the same plan.")
      return { mode: "awaiting_plan_confirmation", plan }
    }

    const risk = assessCommandRisk(command)
    console.log("Agent: AI diagnosis says an environment or dependency command is needed.")
    console.log(`Command: ${command}`)
    console.log(`Evidence: ${diagnosis.evidence.join("; ")}`)
    console.log(`Risk: ${risk.level}`)
    for (const reason of risk.reasons) console.log(`- ${reason}`)
    console.log("Allow me to open a new PowerShell window to run it?")
    memoryStore.addMessage(sessionId, "agent", `waiting command confirmation: ${command}`)

    return {
      mode: "awaiting_command_confirmation",
      command: {
        command,
        cwd: path.dirname(plan.filePath),
        reason: diagnosis.evidence.join("; "),
        plan,
      },
    }
  }

  if (result && !result.passed && diagnosis?.next_action === "REGENERATE_TEST_CODE") {
    const nextMaxAttempts = plan.maxAttempts + 2
    console.log(`Agent: retry limit reached at ${plan.maxAttempts}. AI still thinks the generated test code is wrong.`)
    console.log(`Do you want me to continue with ${nextMaxAttempts} total attempts?`)
    return {
      mode: "awaiting_retry_confirmation",
      retry: { plan, nextMaxAttempts },
    }
  }

  return { mode: "idle" }
}

async function runVisibleCommand(command: PendingCommand, sessionId: string) {
  console.log("Agent: opening a new PowerShell window so you can watch the command.")
  const result = runCommandInVisibleTerminal({ command: command.command, cwd: command.cwd, keepOpen: true })
  memoryStore.addMessage(sessionId, "tool", `command executed: ${command.command}`, { ...result })
  console.log(`Agent: command finished, exit code: ${result.exitCode}, log file: ${result.logFile}`)
  return result
}

function resolvePlan(plan: AgentDecision["plan"], sessionId: string): PendingPlan {
  const sessionState = getSessionState(sessionId)
  const filePath = plan?.file_path ?? sessionState.lastSourceFile
  if (!filePath) throw new Error("source file path is missing")
  const sourceFile = path.resolve(filePath)
  if (!fs.existsSync(sourceFile)) throw new Error(`source file does not exist: ${sourceFile}`)

  const outputDir = path.resolve(plan?.output_dir ?? sessionState.lastOutputDir ?? "./output/exports")
  const language = detectLanguage(sourceFile, plan?.language ?? sessionState.lastLanguage ?? "auto")
  const maxAttempts = normalizeAttempts(plan?.max_attempts)
  const llmRetries = normalizeLlmRetries(plan?.llm_retries ?? sessionState.lastLlmRetries)
  const requirementsText = plan?.requirements_text ?? sessionState.lastRequirements
  return { filePath: sourceFile, outputDir, language, maxAttempts, llmRetries, requirementsText }
}

function printPlan(reply: string, plan: PendingPlan): void {
  console.log(`Agent: ${reply}`)
  console.log("Plan:")
  console.log(`1. Read source: ${plan.filePath}`)
  console.log(`2. Detect language: ${plan.language}`)
  console.log("3. Parse source and call LLM to design test cases")
  console.log("4. Call LLM to generate unit test code")
  console.log("5. Execute tests and run quality checks")
  console.log("6. If failing, send source, tests, cases, and execution output to LLM for diagnosis")
  console.log("7. If AI says test code is wrong, regenerate until the retry limit")
  console.log(`8. Export tests, report, and version records to: ${plan.outputDir}`)
  console.log(`Max attempts: ${plan.maxAttempts}`)
  console.log(`LLM retries per call: ${plan.llmRetries}`)
  if (plan.requirementsText) console.log(`Extra requirements: ${plan.requirementsText}`)
  console.log("Confirm when you want me to start.")
}

function parseDecision(text: string): AgentDecision {
  const raw = parseJsonObject(text)
  if (!raw || typeof raw !== "object") {
    return { action: "answer", reply: text.trim() || "I did not understand. Please say it again." }
  }
  const item = raw as Partial<AgentDecision>
  const action = item.action && ["answer", "ask", "propose_plan", "cancel", "exit"].includes(item.action)
    ? item.action
    : "answer"
  return {
    action,
    reply: typeof item.reply === "string" ? item.reply : "",
    plan: item.plan,
  }
}

function parseDecisionStrict(text: string): AgentDecision {
  const raw = parseJsonObject(text)
  if (!raw || typeof raw !== "object") {
    throw new Error(`CLI agent returned non-JSON output. Preview: ${preview(text)}`)
  }
  const item = raw as Partial<AgentDecision>
  if (!item.action || !["answer", "ask", "propose_plan", "cancel", "exit"].includes(item.action)) {
    throw new Error(`CLI agent returned invalid action. Preview: ${preview(text)}`)
  }
  if (typeof item.reply !== "string") {
    throw new Error(`CLI agent returned missing reply. Preview: ${preview(text)}`)
  }
  return {
    action: item.action,
    reply: item.reply,
    plan: item.plan,
  }
}

function parsePendingIntentStrict(text: string): PendingIntent {
  const raw = parseJsonObject(text)
  if (!raw || typeof raw !== "object") {
    throw new Error(`CLI intent agent returned non-JSON output. Preview: ${preview(text)}`)
  }
  const item = raw as Partial<PendingIntent>
  if (!item.intent || !["confirm", "cancel", "exit", "other"].includes(item.intent)) {
    throw new Error(`CLI intent agent returned invalid intent. Preview: ${preview(text)}`)
  }
  return {
    intent: item.intent,
    reply: typeof item.reply === "string" ? item.reply : undefined,
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
        console.log(`Agent: ${label} failed on attempt ${attempt}/${attempts}; retrying. Reason: ${formatError(error)}`)
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
  console.log(`Unit-test generation Agent

Usage:
  npm run generate -- --interactive
  npm run generate -- --input <source-file> --output <output-dir>
  npm run generate -- <source-file> <output-dir>

Options:
  --input, -i            source file, supports .py/.java/.cpp/.cc/.hpp/.h
  --output, -o           output directory, default ./output/exports
  --language, -l         python/java/cpp
  --max-attempts         max self-healing attempts, default 3
  --llm-retries          retries for each LLM request, default 2
  --requirements         extra requirements text
  --requirements-file    read extra requirements from file
  --interactive, -I      natural language interaction
  --help, -h             show help
`)
}

main().catch((error) => {
  console.error(`Agent startup failed: ${formatError(error)}`)
  process.exitCode = 1
})
