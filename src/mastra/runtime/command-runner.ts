import { spawnSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"

export type CommandRiskLevel = "low" | "medium" | "high"

export interface CommandRisk {
  level: CommandRiskLevel
  reasons: string[]
}

export interface VisibleCommandResult {
  command: string
  cwd: string
  exitCode: number | null
  logFile: string
  risk: CommandRisk
}

const highRiskPatterns = [
  /\brm\s+-rf\b/i,
  /\bRemove-Item\b.*\s-Recurse\b/i,
  /\bdel\s+\/[sq]\b/i,
  /\bformat\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-fd\b/i,
]

const mediumRiskPatterns = [
  /\bnpm\s+(i|install|ci)\b/i,
  /\bpip\s+install\b/i,
  /\bpython\s+-m\s+pip\s+install\b/i,
  /\bconda\s+(install|create|remove)\b/i,
  /\bmvn\s+test\b/i,
  /\bgradle\s+test\b/i,
  /\bcmake\b/i,
]

export function assessCommandRisk(command: string): CommandRisk {
  if (highRiskPatterns.some((pattern) => pattern.test(command))) {
    return { level: "high", reasons: ["该命令可能删除文件、重置仓库或修改系统状态。"] }
  }
  if (mediumRiskPatterns.some((pattern) => pattern.test(command))) {
    return { level: "medium", reasons: ["该命令可能安装依赖、创建环境或运行项目构建。"] }
  }
  return { level: "low", reasons: ["该命令看起来像是普通的检查或测试命令。"] }
}

export function runCommandInVisibleTerminal(input: {
  command: string
  cwd?: string
  keepOpen?: boolean
}): VisibleCommandResult {
  const cwd = path.resolve(input.cwd ?? process.cwd())
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "testgenerate-agent-"))
  const scriptPath = path.join(tempDir, "run-command.ps1")
  const logFile = path.join(tempDir, "command.log")
  const keepOpen = input.keepOpen ?? true

  const script = [
    "$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8",
    "$ErrorActionPreference = \"Continue\"",
    `Set-Location -LiteralPath ${psString(cwd)}`,
    `Write-Host "工作目录：${cwd}"`,
    `Write-Host "命令：${input.command.replace(/"/g, '\\"')}"`,
    "Write-Host \"\"",
    "$__cmd = @'",
    input.command.replace(/'@/g, "' + '@' + '"),
    "'@",
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $__cmd *>&1 | Tee-Object -FilePath ${psString(logFile)}`,
    "$__exit = if ($LASTEXITCODE -ne $null) { $LASTEXITCODE } else { 0 }",
    "Write-Host \"\"",
    "Write-Host \"Exit code: $__exit\"",
    keepOpen ? "Write-Host \"窗口保持打开以供检查。按 Enter 关闭。\"; Read-Host | Out-Null" : "",
    "exit $__exit",
  ].filter(Boolean).join("\r\n")

  fs.writeFileSync(scriptPath, script, "utf-8")

  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `$p = Start-Process powershell.exe -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',${psString(scriptPath)} -Wait -PassThru; exit $p.ExitCode`,
    ],
    {
      cwd,
      encoding: "utf-8",
      windowsHide: false,
    }
  )

  return {
    command: input.command,
    cwd,
    exitCode: result.status,
    logFile,
    risk: assessCommandRisk(input.command),
  }
}

function psString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}
