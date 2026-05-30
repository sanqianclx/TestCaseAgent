import fs from "fs"
import path from "path"

const loadedEnvFiles = new Set<string>()

export function loadProjectEnv(startDir = process.cwd()): void {
  const candidates = [
    startDir,
    process.env.INIT_CWD,
    process.env.PWD,
    process.cwd(),
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    const envPath = findUp(".env", path.resolve(candidate))
    if (envPath) loadEnvFile(envPath)
  }
}

export function getLlmUnavailableReason(): string | undefined {
  loadProjectEnv()

  const forcedOff = (process.env.TESTGENERATE_LLM ?? "").toLowerCase()
  if (["0", "false", "off"].includes(forcedOff)) {
    return "TESTGENERATE_LLM 已被禁用。"
  }

  const key = process.env.OPENAI_API_KEY || process.env.MASTRA_API_KEY || process.env.DEEPSEEK_API_KEY || ""
  if (!key) {
    return "未找到 API Key。请在 .env 文件或环境变量中设置 DEEPSEEK_API_KEY、OPENAI_API_KEY 或 MASTRA_API_KEY。"
  }
  if (!/^[\x20-\x7E]+$/.test(key)) {
    return "API Key 包含非 ASCII 或隐藏字符。请重新以纯文本形式复制到 .env 中。"
  }
  if (key.length <= 20 || key.includes("your") || key.includes("xxx")) {
    return "API Key 看起来像是占位符或太短。"
  }

  return undefined
}

export function canUseLLM(): boolean {
  return getLlmUnavailableReason() === undefined
}

export function assertLlmAvailable(stage: string): void {
  const reason = getLlmUnavailableReason()
  if (reason) {
    throw new Error(`LLM 未连接，无法执行${stage}。${reason}`)
  }
}

export function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function loadEnvFile(envPath: string): void {
  if (loadedEnvFiles.has(envPath) || !fs.existsSync(envPath)) return
  loadedEnvFiles.add(envPath)

  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const separator = trimmed.indexOf("=")
    if (separator <= 0) continue

    const key = trimmed.slice(0, separator).trim()
    let value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "")
    value = value.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => process.env[varName] ?? "")
    process.env[key] ??= value
  }
}

function findUp(fileName: string, startDir: string): string | undefined {
  let current = fs.existsSync(startDir) && fs.statSync(startDir).isFile()
    ? path.dirname(startDir)
    : startDir

  while (true) {
    const candidate = path.join(current, fileName)
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

loadProjectEnv()
