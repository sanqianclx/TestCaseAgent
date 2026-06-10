/**
 * CLI 语义化输出工具
 *
 * 提供角色感知的输出 API,以显式函数调用替代旧版 monkey-patch 全局
 * `console.log` 的做法,从根本上消除副作用、避免对 Studio 进程的污染,
 * 并支持 TTY / NO_COLOR / CI 等环境自动降级。
 *
 * 设计动机:
 * 1. 旧版 `cli.ts:17-29` 直接改写全局 console.log,任何 import cli.ts 的模块
 *    都会受到污染;Studio 进程虽不加载 cli.ts,但与 CLI 共享同一份 node_modules,
 *    调试时容易混淆。
 * 2. 旧版依赖字符串前缀("Agent"、"User")做角色判断,属于隐式契约,IDE 无
 *    法跳转、关键字重命名易断裂。
 * 3. 旧版无开关:管道 / 重定向到日志文件时仍会喷 ANSI 转义码。
 *
 * 用法示例:
 *   import { logAgent, promptUser, logWarn } from "./cli-output.js"
 *   logAgent("任务完成。")                // 亮黄加粗输出 "Agent：任务完成。"
 *   const answer = await rl.question(promptUser())   // 亮青加粗 "User："
 *   logWarn("覆盖率未达标")               // 黄色 ⚠ 前缀
 *
 * 颜色控制:
 * - NO_COLOR 存在 → 无色
 * - FORCE_COLOR=0 → 无色
 * - CI 存在 → 无色
 * - stdout 不是 TTY → 无色
 * - 其余情况 → 有色
 *
 * 注意:本模块仅做输出格式化,不持有任何状态,可在任意上下文安全使用。
 * Studio / 测试 / 子进程内调用不会产生跨进程污染。
 */

import { env } from "process"

// ============================================================
// 颜色启用判断
// ============================================================

/**
 * 计算当前进程是否应启用 ANSI 颜色
 *
 * 判定顺序(自上而下短路):
 * 1. NO_COLOR 存在(非空)→ 无色 —— https://no-color.org 标准
 * 2. FORCE_COLOR=0 → 无色 —— 用户显式禁用
 * 3. CI 环境变量存在 → 无色 —— 避免 CI 日志被 ANSI 污染
 * 4. stdout 不是 TTY → 无色 —— 管道/重定向场景
 * 5. 其余 → 有色
 */
function computeColorEnabled(): boolean {
  if (env.NO_COLOR && env.NO_COLOR.length > 0) return false
  if (env.FORCE_COLOR === "0") return false
  if (env.CI) return false
  return Boolean(process.stdout.isTTY)
}

/** 当前进程是否启用颜色(只读,模块加载时确定一次) */
export const COLOR_ENABLED: boolean = computeColorEnabled()

// ============================================================
// ANSI 控制码常量
// ============================================================

const RESET = "\x1b[0m"
const BOLD = "\x1b[1m"
const DIM = "\x1b[2m"
const RED = "\x1b[31m"
const GREEN = "\x1b[32m"
const YELLOW = "\x1b[33m"
const CYAN = "\x1b[36m"

/**
 * 给定文本加颜色壳
 *
 * 当颜色被禁用时直接返回原文本,避免在日志文件里残留 `[1;33m` 这类乱码。
 *
 * @param open ANSI 起始控制码,可叠加(如 `${BOLD}${YELLOW}`)
 * @param text 原始文本
 * @returns 加色后的文本或原文本
 */
function paint(open: string, text: string): string {
  return COLOR_ENABLED ? `${open}${text}${RESET}` : text
}

// ============================================================
// 语义化输出 API
// ============================================================

/**
 * 输出 Agent 角色的话语
 *
 * 用于 Agent 主动陈述、确认、计划等场景,等价于旧版
 * `console.log("\x1b[1;93mAgent：...\x1b[0m")`。
 *
 * @param message Agent 要说的话(不含 "Agent：" 前缀,函数自动追加)
 */
export function logAgent(message: string): void {
  console.log(paint(`${BOLD}${YELLOW}`, `Agent：${message}`))
}

/**
 * 输出工作流阶段的进度提示
 *
 * 用于 `generateTestWorkflow` 内部的 `logProgress` 等场景,等价于
 * 旧版 `console.log("Agent 进度：...")` 在被 monkey-patch 拦截时
 * 产生的染色效果。统一前缀,方便日志 grep。
 *
 * @param message 进度描述(不含 "Agent 进度：" 前缀)
 */
export function logAgentProgress(message: string): void {
  console.log(paint(`${BOLD}${YELLOW}`, `Agent 进度：${message}`))
}

/**
 * 获取用户输入提示符
 *
 * 返回含 ANSI 的字符串,直接传给 readline.question。等价于旧版
 * `const USER_PROMPT = "\x1b[1;96mUser：\x1b[0m"`。
 *
 * @returns 亮青加粗的 "User：" 字符串(无色环境为纯文本)
 */
export function promptUser(): string {
  return paint(`${BOLD}${CYAN}`, "User：")
}

/**
 * 输出普通信息(无角色着色)
 *
 * 用于元数据、计划清单、文件路径等不需要强调角色的信息。直接走
 * `console.log`,不加工。
 *
 * @param message 任意文本
 */
export function logInfo(message: string): void {
  console.log(message)
}

/**
 * 输出警告(黄色 + ⚠ 前缀)
 *
 * 用于不阻塞流程但需要提示用户的场景。
 *
 * @param message 警告内容
 */
export function logWarn(message: string): void {
  console.log(paint(YELLOW, `⚠ ${message}`))
}

/**
 * 输出错误(红色 + ✗ 前缀,走 stderr)
 *
 * 用于失败场景,与普通日志区分。`main()` 顶层 catch 通常会调用此函数。
 *
 * @param message 错误内容
 */
export function logError(message: string): void {
  console.error(paint(RED, `✗ ${message}`))
}

/**
 * 输出成功(绿色 + ✓ 前缀)
 *
 * 用于阶段性成功提示,如工作流完成、命令执行成功。
 *
 * @param message 成功内容
 */
export function logSuccess(message: string): void {
  console.log(paint(GREEN, `✓ ${message}`))
}

/**
 * 输出调试信息(暗色,仅在 DEBUG 开启时输出)
 *
 * 默认静默;当 `process.env.DEBUG` 非空时才输出,适合临时排查问题。
 *
 * @param message 调试内容
 */
export function logDebug(message: string): void {
  if (env.DEBUG) {
    console.log(paint(DIM, `[debug] ${message}`))
  }
}

/**
 * 输出 LLM 思维链(暗灰色,缩进 2 空格,接收完整句子)
 *
 * 与 `logAgent` 区别:这是 LLM 的内部推理,不是给用户的最终答案。
 * 选用 DIM(暗灰)+ 2 空格缩进,让用户能区分"这是 LLM 在想"和"这是 LLM 在答"。
 *
 * V2.7.7 改动:
 * - 去掉 💭 emoji(用户偏好,减少视觉噪音)
 * - 接收完整句子而非逐 token(autonomous-loop 端做聚合后整句传过来)
 * - 句末强制 \n,避免多句连成一段"用户要求X。让我看Y。让我看Z"难读
 * - DEBUG 控制由调用方(autonomous-loop)决定是否调用本函数
 *
 * @param sentence 完整句子(autonomous-loop 端攒到句末标点再传)
 */
export function logReasoning(sentence: string): void {
  if (typeof sentence !== "string" || sentence.length === 0) return
  process.stdout.write(paint(DIM, `  ${sentence}\n`))
}

// ============================================================
// 进度条辅助(内嵌 renderProgressBar)
// ============================================================

// ============================================================
// 流式 Agent 输出(V2.6):保持 `Agent：` 前缀开着,逐字追加 delta
// ============================================================

/**
 * 流式输出状态机标记
 *
 * true:已写 `Agent：` 前缀,后续 writeAgentStream 直接追加 delta
 * false:未开,下一次 writeAgentStream 会先写前缀
 *
 * 模块级状态在 REPL 多 turn 场景下需要正确重置——endAgentStream 把它置回 false,
 * 审批 y/n 期间不调 writeAgentStream 即可(readline 接管了 stdin 输出)。
 */
let agentStreamOpen = false

/**
 * 开启一段流式 Agent 文本(写 `Agent：` 黄色加粗前缀)
 *
 * 多次调用是幂等的:只在未开时写前缀。
 */
export function startAgentStream(): void {
  if (!agentStreamOpen) {
    const prefix = COLOR_ENABLED ? `${BOLD}${YELLOW}Agent：${RESET}` : "Agent："
    process.stdout.write(prefix)
    agentStreamOpen = true
  }
}

/**
 * 追加一段 LLM 流式文本到 stdout
 *
 * 内部保证前缀已开,直接 write delta,不换行;Node TTY 默认 line-buffered,
 * 不带 `\n` 的 write 也会立即 flush 字符,达到"逐字"效果。
 *
 * @param delta LLM 这一 chunk 的文本增量(可能为空串)
 */
export function writeAgentStream(delta: string): void {
  if (typeof delta !== "string" || delta.length === 0) return
  startAgentStream()
  process.stdout.write(delta)
}

/**
 * 结束流式段(补一个换行并重置状态)
 *
 * 必须在每段 LLM 文本结束(无论是正常 text-end 还是异常跳出)时调用一次,
 * 否则下一次 startAgentStream 会接到上一段尾部。
 */
export function endAgentStream(): void {
  if (agentStreamOpen) {
    process.stdout.write("\n")
    agentStreamOpen = false
  }
}

/**
 * 在终端当前行打印一行进度条,使用 CR(\r) 覆盖之前内容
 *
 * 调用方应负责配套调用 `finishProgressBar()` 换行收尾,否则下一次
 * 同行打印会覆盖进度条。
 *
 * @param label 阶段名,如 "设计测试用例"
 * @param current 当前进度(>=0)
 * @param total 总数(>0)
 */
export function renderProgressBar(label: string, current: number, total: number): void {
  const safeTotal = Math.max(total, 1)
  const safeCurrent = Math.min(Math.max(current, 0), safeTotal)
  const width = 24
  const filled = Math.round((safeCurrent / safeTotal) * width)
  const bar = "#".repeat(filled) + "-".repeat(width - filled)
  const percent = Math.round((safeCurrent / safeTotal) * 100)
  const prefix = COLOR_ENABLED ? `${BOLD}${YELLOW}Agent 进度：${RESET}` : "Agent 进度："
  process.stdout.write(`\r${prefix}${label} [${bar}] ${safeCurrent}/${safeTotal} ${percent}%`)
}

/**
 * 结束进度条:补一个换行,让后续日志另起一行
 */
export function finishProgressBar(): void {
  process.stdout.write("\n")
}

// ============================================================
// Framework 噪音过滤(V2.6.2):拦截 Mastra 框架主动打到 console 的内部错误
// ============================================================

/**
 * 框架内部打 console 时包含的"已知噪音"关键词
 *
 * 这些是 Mastra 1.0 框架在以下情况会主动 console.error / console.log 的内容:
 * 1. LLM 工具入参 JSON parse 失败(框架重试时打印)
 * 2. 工具入参 schema 校验失败(把 error 当 tool-result 回灌给 LLM)
 * 3. 工具输出 schema 校验失败
 *
 * 这些都是**框架内部自纠**的标志,LLM 会看到完整 tool-result 并自动重试。
 * 对用户而言,看到这堆 JSON 噪音只会怀疑 Agent 出了问题。
 *
 * 过滤策略:在 `console.error` / `console.log` 上 monkey-patch,
 * 如果首个参数(可能是 string 或 object)含这些关键词,就**静默掉**,不再打到终端。
 * 其他 console.error / console.log 行为不变。
 */
const FRAMEWORK_NOISE_KEYWORDS = [
  "Error converting tool call input to JSON",
  // V2.7.3 取消过滤:这个错误意味着 LLM 工具入参构造错误(必填字段缺失/类型不对)
  // 静默掉会让 LLM 看不到反馈、用户也看不到,导致死循环(LLM 反复调同工具但入参依然错)
  // "Tool input validation failed",
  "Tool output validation failed",
  "Tool suspension data validation failed",
] as const

/**
 * 检查首个参数是否是 framework 已知噪音
 *
 * - string:包含任一关键词
 * - object:序列化后含任一关键词
 */
function isFrameworkNoise(firstArg: unknown): boolean {
  if (typeof firstArg === "string") {
    return FRAMEWORK_NOISE_KEYWORDS.some((kw) => firstArg.includes(kw))
  }
  if (firstArg && typeof firstArg === "object") {
    try {
      const serialized = JSON.stringify(firstArg)
      return FRAMEWORK_NOISE_KEYWORDS.some((kw) => serialized.includes(kw))
    } catch {
      return false
    }
  }
  return false
}

/**
 * 已安装标记
 *
 * 模块级状态,避免重复 patch 同一个 console 方法。
 */
let filterInstalled = false

/**
 * 安装 framework 噪音过滤器
 *
 * 在 cli 启动早期调用一次即可。会影响所有 console.error / console.log 调用,
 * 建议**只在 CLI 进程**调用,不要在 Studio / 测试进程里调用(避免吞掉业务日志)。
 *
 * 实现:
 * - 保留原始 console.error / console.log 引用
 * - patch 后如果检测到 framework 噪音,**直接 return**,不调原始方法
 * - 其他情况正常转发到原始方法
 *
 * 关闭方式:`process.env.DEBUG_NOISE=1` 时跳过过滤,framework 噪音会恢复显示。
 */
export function installFrameworkLogFilter(): void {
  if (filterInstalled) return
  if (env.DEBUG_NOISE) return
  filterInstalled = true

  const originalError = console.error.bind(console)
  const originalLog = console.log.bind(console)
  // 用 unknown[] 兼容 console.error(...args) 的 rest 参数
  console.error = (...args: unknown[]) => {
    if (args.length > 0 && isFrameworkNoise(args[0])) return
    originalError(...(args as Parameters<typeof originalError>))
  }
  console.log = (...args: unknown[]) => {
    if (args.length > 0 && isFrameworkNoise(args[0])) return
    originalLog(...(args as Parameters<typeof originalLog>))
  }
}