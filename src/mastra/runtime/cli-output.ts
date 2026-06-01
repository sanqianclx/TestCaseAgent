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

// ============================================================
// 进度条辅助(内嵌 renderProgressBar)
// ============================================================

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