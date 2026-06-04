import readline from "readline/promises"
import { stdin as input, stdout as output } from "process"
import path from "path"
import { logInfo, logWarn, logAgent, promptUser } from "../mastra/runtime/cli-output.js"
import { firstToken } from "./safety.js"
import { assessCommandRisk } from "../mastra/runtime/command-runner.js"
import type { ApprovalDecision, PendingToolCall, SessionFlags } from "./types.js"

/**
 * 工具调用审批
 *
 * CLI 拦截到 Agent 挂起的工具调用后调用本函数：
 * 1. 把工具名、入参摘要、风险等级以多行形式打印
 * 2. 读取用户一行输入
 * 3. 解析为 approve / decline / approve_always / decline_always / rejected
 *
 * 对于 ask-user 工具调用，会把问题打印为提示并等待用户输入回答。
 *
 * 输入接受（不区分大小写、去前后空格）：
 *   y / yes / 是 / 确认 / ok / allow       → approve
 *   n / no / 否 / 取消 / cancel / deny     → decline
 *   always / auto / 总是                    → approve_always（按命令首词记住）
 *   never / block / 拒绝                    → decline_always（按命令首词记住）
 *   其他                                    → rejected（让外层重新提示）
 */

const APPROVE_WORDS = new Set(["y", "yes", "是", "确认", "ok", "allow", "approve"])
const DECLINE_WORDS = new Set(["n", "no", "否", "取消", "cancel", "deny", "decline"])
const ALWAYS_WORDS = new Set(["always", "auto", "总是", "all"])
const NEVER_WORDS = new Set(["never", "block", "拒绝", "denyall"])

/**
 * V2.4：双轨解析"待显示的风险等级 + 原因"
 *
 * - 第一优先：LLM 调用工具时在 `args.risk` 字段里自评（推荐路径）
 * - 第二优先：未传时调 `assessCommandRisk`（基于正则的硬编码兜底）
 * - 都拿不到：显示 "unknown / （未评估）"（极少出现）
 *
 * 兜底的 `assessCommandRisk` 原来在 `shell-runner.ts` 命令执行**之后**才被调，
 * 时序晚于审批；这里在审批前调一次，让 risk 字段在 y/n 框里就能显示。
 */
function resolveRiskForDisplay(
  pending: PendingToolCall,
  command: string | null
): { level: string; reasons: string } {
  // 第一优先：LLM 自评
  const llmRisk = pending.args.risk as { level?: string; reasons?: string[] } | undefined
  if (llmRisk?.level && Array.isArray(llmRisk.reasons) && llmRisk.reasons.length > 0) {
    return { level: llmRisk.level, reasons: llmRisk.reasons.join("；") }
  }
  // 第二优先：assessCommandRisk 兜底（仅 shell 命令可用）
  if (command) {
    try {
      const fallback = assessCommandRisk(command)
      return { level: fallback.level, reasons: fallback.reasons.join("；") }
    } catch {
      return { level: "unknown", reasons: "（未评估）" }
    }
  }
  return { level: "unknown", reasons: "（未评估）" }
}

/**
 * 把工具入参格式化为可读摘要
 *
 * V2.7.2 改动：所有内容字段全部折叠为单行
 * - 原因:之前长 content(8000字符)会展开 600 字符到 y/n 框,糊脸;
 *   writeFile 一次审批就喷一坨,用户看花了眼,体验很差
 * - 策略:
 *   - 大字段(content / message / payload)完全折叠为 `<N 字符>` 单行,不展开
 *   - 其他长字符串(>120 或含 \n)只取前 80 字符 + 总数,不再 6 空格缩进展开
 *   - 短字符串原样
 *   - 数字/布尔原样
 *   - 对象/数组 JSON 化后按上述规则
 *
 * 用户要查看完整内容:审批后 LLM 会把结果流式显示(text-delta),
 * 或者用户去 output/exports/agent/java2/ 目录看实际写入的文件。
 */
function formatArgsSummary(args: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue

    // 风险字段放在最后显示（CLI approval.ts 后面对它另有 y/n 框），这里简化处理
    if (key === "risk") continue

    let display: string
    if (typeof value === "string") {
      display = value
    } else if (typeof value === "number" || typeof value === "boolean") {
      display = String(value)
    } else {
      try {
        display = JSON.stringify(value)
      } catch {
        display = "[unserializable]"
      }
    }

    // V2.7.2: 大字段(content / message / payload)完全折叠为字符数,不展开
    if (key === "content" || key === "message" || key === "payload") {
      parts.push(`  ${key}=<${display.length} 字符>`)
      continue
    }

    const isLong = display.length > 120 || display.includes("\n")
    if (isLong) {
      // 改为前 80 字符 + 总数,不再 6 空格缩进展开
      const head = display.slice(0, 80).replace(/\s+/g, " ").trim()
      parts.push(`  ${key}=${head}... [共 ${display.length} 字符]`)
    } else {
      parts.push(`  ${key}=${display}`)
    }
  }
  return parts.join("\n") || "  (无参数)"
}

/**
 * 评估路径类工具的越界风险
 *
 * 仅当目标是 CWD 内的绝对路径时返回 null；
 * 否则返回一个 reason 字符串。
 */
function checkPathArgs(toolName: string, args: Record<string, unknown>): string | null {
  const pathKeys: Record<string, string[]> = {
    readFile: ["path"],
    writeFile: ["path"],
    exportCases: ["output_dir"],
  }
  const keys = pathKeys[toolName]
  if (!keys) return null
  const cwd = process.cwd()
  for (const key of keys) {
    const value = args[key]
    if (typeof value !== "string") continue
    const resolved = path.resolve(value)
    const root = process.platform === "win32" ? cwd.toLowerCase() : cwd
    const target = process.platform === "win32" ? resolved.toLowerCase() : resolved
    if (target !== root && !target.startsWith(root + path.sep)) {
      return `目标路径 ${resolved} 不在 CWD (${cwd}) 之内`
    }
  }
  return null
}

/**
 * V2.6.2: 根据工具名 + 入参生成"Agent 准备做什么"的可读摘要
 *
 * 解决痛点:LLM 经常在工具调用前懒得说 text-delta,直接调工具,
 * 用户在 CLI 上看不到任何"分析 → 决策"的过程。
 *
 * 策略:为每个工具类型写一个简短的中文意图模板,把关键参数填进去。
 * 不追求完美,只求"用户能立即看出 Agent 准备干什么"。
 *
 * @param toolName 工具名
 * @param args 工具入参
 * @returns 形如"读取源文件 output/sources/x.cpp"的中文短语;不适用时返回 null
 */
function describeAgentIntent(toolName: string, args: Record<string, unknown>): string | null {
  switch (toolName) {
    case "readFile": {
      const p = typeof args.path === "string" ? args.path : ""
      return p ? `读取源文件 ${p}` : "读取源文件"
    }
    case "writeFile": {
      const p = typeof args.path === "string" ? args.path : ""
      return p ? `写入文件 ${p}` : "写入文件"
    }
    case "parseSourceCode": {
      const p = typeof args.path === "string" ? args.path : ""
      return p ? `解析源码结构 ${p}` : "解析源码结构"
    }
    case "executeTests": {
      const filename = typeof args.filename === "string" ? args.filename : ""
      return filename ? `执行 ${filename} 的测试用例` : "执行测试用例"
    }
    case "measureCoverage": {
      const filename = typeof args.filename === "string" ? args.filename : ""
      return filename ? `测量 ${filename} 的测试覆盖率` : "测量测试覆盖率"
    }
    case "exportCases": {
      const dir = typeof args.output_dir === "string" ? args.output_dir : ""
      return dir ? `导出测试代码到 ${dir}` : "导出测试代码"
    }
    case "logger": {
      const msg = typeof args.message === "string" ? args.message : ""
      return msg ? `记录日志: ${msg.slice(0, 80)}` : "记录日志"
    }
    case "shellRun": {
      const cmd = typeof args.command === "string" ? args.command : ""
      if (!cmd) return "执行 shell 命令"
      // 截前 80 字符,避免太长
      return `执行 shell: ${cmd.length > 80 ? cmd.slice(0, 80) + "..." : cmd}`
    }
    case "askUser": {
      const q = typeof args.question === "string" ? args.question : ""
      return q ? `向用户提问: ${q.slice(0, 80)}` : "向用户提问"
    }
    default:
      return null
  }
}

/**
 * 显示工具调用信息并等待用户审批
 *
 * @param pending 待审批的工具调用
 * @param sessionFlags 会话级放行/拒绝名单
 * @param rl readline 接口（由调用方注入，便于测试与复用）
 * @returns 审批决策
 */
export async function promptForApproval(
  pending: PendingToolCall,
  sessionFlags: SessionFlags,
  rl: readline.Interface
): Promise<ApprovalDecision> {
  const isShell = pending.toolName === "shellRun"
  const command = isShell && typeof pending.args.command === "string" ? pending.args.command : null
  const token = command ? firstToken(command).toLowerCase() : ""

  // 自动命中放行名单
  if (isShell && command && token && sessionFlags.shellAutoApprovePrefixes.includes(token)) {
    logInfo(`→ 已在会话中自动放行（命令首词匹配：${token}）`)
    return { kind: "approve" }
  }
  // 自动命中拒绝名单
  if (isShell && command && token && sessionFlags.shellDenyPrefixes.includes(token)) {
    logWarn(`→ 已在会话中自动拒绝（命令首词在黑名单中：${token}）`)
    return { kind: "decline" }
  }

  // V2.5: LLM 自评 risk=low 且不是写文件工具 → 自动放行，不弹 y/n
  // 设计意图：写文件（writeFile/exportCases）哪怕 LLM 标 low，也走 y/n 给用户最后确认；
  //          其他工具（shellRun/readFile/...）如果 LLM 已经判定 low，直接放行。
  // shell 工具的风险信息用 resolveRiskForDisplay 双轨解析：LLM 自评优先，未传则降级 assessCommandRisk
  const isWriteTool = pending.toolName === "writeFile" || pending.toolName === "exportCases"
  const llmRiskForAuto = pending.args.risk as { level?: string; reasons?: string[] } | undefined
  if (!isWriteTool && llmRiskForAuto?.level === "low") {
    const reasonText = Array.isArray(llmRiskForAuto.reasons) && llmRiskForAuto.reasons.length > 0
      ? llmRiskForAuto.reasons.join("；")
      : "（无具体原因）"
    logInfo(`→ LLM 自评 risk=low，自动放行（${pending.toolName}）：${reasonText}`)
    return { kind: "approve" }
  }
  // shell-run 特殊：未传 risk 时降级到 assessCommandRisk；若降到 low 也自动放行
  if (pending.toolName === "shellRun" && command) {
    try {
      const fallback = assessCommandRisk(command)
      if (fallback.level === "low" && !llmRiskForAuto?.level) {
        logInfo(`→ 命令风险兜底评估=low，自动放行（shell-run）：${fallback.reasons.join("；")}`)
        return { kind: "approve" }
      }
    } catch {
      // 兜底失败不影响主流程
    }
  }

  // 路径越界检查（非 shell 工具）
  const pathRisk = checkPathArgs(pending.toolName, pending.args)
  if (pathRisk) {
    logWarn(`⚠ 工具 ${pending.toolName} 目标越界：${pathRisk}`)
  }

  // V2.7.2: 视觉分离"LLM 真实的话"与"系统自动提示"
  //
  // 之前:用 logAgent("Agent 准备...") 会被喷成 "Agent：Agent 准备..."
  //      跟 LLM 自己的 text-delta("Agent：xxx") 长一样,用户分不清
  //      以为 LLM 在解释,其实系统在冒充 LLM。
  // 现在:用 [系统] 前缀 + logInfo(无色) 跟 LLM 的"Agent：黄色文本流"
  //      视觉上立刻区分 —— 黄色 + Agent: = LLM 自己的话;[系统] = CLI 生成。
  //
  // 副作用:用户能立刻看出"LLM 调工具前有没有真的说话"
  //      (如果 LLM 沉默,只有 [系统] 那行;如果 LLM 说话,会有 黄色 Agent: 行 + [系统] 行)

  // V2.6.2: 自动动作摘要(不依赖 LLM 主动说 text-delta)
  // 设计原因:LLM 经常"懒得说",直接调工具,导致用户看不到 Agent 在准备做什么。
  // 这里根据 toolName + args 自动生成一行可读的"准备做什么"摘要,
  // 放在 y/n 框之前,让用户始终有反馈。
  const intent = describeAgentIntent(pending.toolName, pending.args)
  if (intent) {
    // 注意:这里用 logInfo(无色)而非 logAgent(黄色),与 LLM 文本流视觉差异最大化
    logInfo(`[系统] 准备调用 ${pending.toolName}: ${intent}`)
  }

  // 显示审批面板
  logInfo(`[系统] 工具: ${pending.toolName}`)
  logInfo(`  参数：${formatArgsSummary(pending.args)}`)
  if (isShell && command) {
    // V2.4 双轨风险显示：LLM 自评优先；未传则降级到 assessCommandRisk 兜底
    const resolved = resolveRiskForDisplay(pending, command)
    if (resolved.level === "high") {
      logWarn(`  风险等级：${resolved.level}`)
      logWarn(`  风险原因：${resolved.reasons}`)
    } else {
      logInfo(`  风险等级：${resolved.level}`)
      logInfo(`  风险原因：${resolved.reasons}`)
    }
    logInfo(`  工作目录：${process.cwd()}`)
  }
  logInfo("  允许执行？[y/n/always/never/exit]：")

  while (true) {
    const line = (await rl.question(promptUser())).trim().toLowerCase()
    if (!line) {
      logInfo("  请输入 y / n / always / never / exit：")
      continue
    }
    // V2.6.3: 在 y/n 框里输入 exit 也能退出 REPL(用户误输入或想中止)
    if (line === "exit" || line === "quit") {
      logInfo("  用户在审批框里输入 exit，退出 REPL。")
      return { kind: "exit" }
    }
    if (APPROVE_WORDS.has(line)) return { kind: "approve" }
    if (DECLINE_WORDS.has(line)) return { kind: "decline" }
    if (ALWAYS_WORDS.has(line)) {
      if (!isShell || !token) {
        logInfo("  'always' 仅对 shell-run 有效；按一次放行处理。")
        return { kind: "approve" }
      }
      return { kind: "approve_always", prefix: token }
    }
    if (NEVER_WORDS.has(line)) {
      if (!isShell || !token) {
        logInfo("  'never' 仅对 shell-run 有效；按一次拒绝处理。")
        return { kind: "decline" }
      }
      return { kind: "decline_always", prefix: token }
    }
    logInfo("  无效输入。请输入 y / n / always / never / exit：")
    return { kind: "rejected", reason: line }
  }
}

/**
 * 显示 ask-user 工具的问题并等待用户回答
 */
export async function promptForAskUser(
  question: string,
  options: string[] | undefined,
  allowFreeText: boolean,
  rl: readline.Interface
): Promise<string> {
  logAgent("Agent 询问：")
  logInfo(`  ${question}`)
  if (options && options.length > 0) {
    options.forEach((opt, index) => {
      const label = String.fromCharCode(65 + index) // A, B, C, ...
      logInfo(`  (${label}) ${opt}`)
    })
    logInfo(`  请输入选项${allowFreeText ? "或自由文本" : ""}：`)
  } else {
    logInfo("  请输入回答：")
  }

  while (true) {
    const line = (await rl.question(promptUser())).trim()
    if (line) return line
    logInfo("  请输入有效内容：")
  }
}

/**
 * 默认 readline 接口，方便主流程调用
 */
export function createDefaultReadline(): readline.Interface {
  return readline.createInterface({ input, output })
}
