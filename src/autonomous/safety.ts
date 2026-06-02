import path from "path"

/**
 * 安全与脱敏工具
 *
 * 提供三件事：
 * 1. `assertPathInsideCwd` —— 路径越界检查，阻止 Agent 把文件写到 CWD 之外
 * 2. `redactSecrets` —— 把 process.env 中形如 KEY/TOKEN/SECRET/PASSWORD 的值在日志里替换掉
 * 3. `truncateForLog` —— 长字符串截断，避免撑爆日志和 LLM 上下文
 *
 * 所有函数都是纯函数，无副作用，便于在任意上下文使用。
 */

/**
 * 校验目标路径是否落在 CWD 之内（Windows 大小写不敏感）
 *
 * 解析为绝对路径后比较前缀。返回规范化后的绝对路径（成功）或抛出错误（失败）。
 * 主要供 `write-file` / `export-cases.output_dir` / `read-file` 在执行前把关。
 *
 * @param targetPath 用户/Agent 给出的目标路径（相对或绝对均可）
 * @param root 根目录，默认 `process.cwd()`
 * @returns 规范化后的绝对路径
 * @throws 路径解析到 CWD 之外时抛出
 */
export function assertPathInsideCwd(targetPath: string, root: string = process.cwd()): string {
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(targetPath)
  const rootLower = process.platform === "win32" ? resolvedRoot.toLowerCase() : resolvedRoot
  const targetLower = process.platform === "win32" ? resolved.toLowerCase() : resolved
  if (targetLower !== rootLower && !targetLower.startsWith(rootLower + path.sep)) {
    throw new Error(
      `路径越界：目标 ${resolved} 不在工作目录 ${resolvedRoot} 之内。` +
      `如确需写到 CWD 之外，请用户主动确认。`,
    )
  }
  return resolved
}

/**
 * 在一段文本里把 process.env 中所有看起来是密钥的值替换成 `<redacted>`
 *
 * 仅替换值，不替换键名。匹配大小写敏感。
 * 用法：日志写入前过一遍 `redactSecrets(text)`。
 */
export function redactSecrets(text: string): string {
  if (!text) return text
  let result = text
  for (const [key, value] of Object.entries(process.env)) {
    if (!value || value.length < 4) continue
    if (!/(KEY|TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE)/i.test(key)) continue
    let masked = result
    let pos = masked.indexOf(value)
    while (pos !== -1) {
      masked = masked.slice(0, pos) + "<redacted>" + masked.slice(pos + value.length)
      pos = masked.indexOf(value, pos + "<redacted>".length)
    }
    result = masked
  }
  return result
}

/**
 * 截断长字符串用于日志或 LLM 上下文
 *
 * - 超过 `maxChars` 时保留前 `headChars` + 中间省略标记 + 后 `tailChars`
 * - 不足时原样返回
 *
 * @param text 原始字符串
 * @param maxChars 触发截断的阈值
 * @param headChars 截断后保留的头部长度
 * @param tailChars 截断后保留的尾部长度
 */
export function truncateForLog(text: string, maxChars: number, headChars = 4000, tailChars = 1000): string {
  if (!text) return text
  if (text.length <= maxChars) return text
  const head = text.slice(0, headChars)
  const tail = text.slice(-tailChars)
  const dropped = text.length - headChars - tailChars
  return `${head}\n...[truncated ${dropped} chars]...\n${tail}`
}

/**
 * 提取命令的首词（去掉前导空白和引号），用于 `always` / `never` 匹配
 *
 * 例子：
 * - "pip install pytest" → "pip"
 * - "  npm  test" → "npm"
 * - '"C:\\Program Files\\Git\\bin\\git.exe" status' → "C:\\Program Files\\Git\\bin\\git.exe"
 */
export function firstToken(command: string): string {
  const trimmed = command.trim()
  if (!trimmed) return ""
  // 去掉首字符如果是引号，整体作为首词
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quote = trimmed[0]
    const end = trimmed.indexOf(quote, 1)
    if (end > 0) return trimmed.slice(1, end)
  }
  const space = trimmed.indexOf(" ")
  return space === -1 ? trimmed : trimmed.slice(0, space)
}
