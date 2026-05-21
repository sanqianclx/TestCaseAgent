import { generateTestWorkflow } from "./mastra/workflows/generate-test-workflow.js"
import fs from "fs"
import path from "path"

type CliArgs = {
  input?: string
  output?: string
  maxAttempts: number
  requirementsText?: string
  help: boolean
}

async function main(): Promise<void> {
  loadDotEnv()
  const args = parseArgs(process.argv.slice(2))

  if (args.help || !args.input) {
    printHelp()
    process.exit(args.help ? 0 : 1)
  }

  const run = await generateTestWorkflow.createRun()
  const result = await run.start({
    inputData: {
      file_path: args.input,
      output_dir: args.output ?? "./output/exports",
      max_attempts: args.maxAttempts,
      requirements_text: args.requirementsText,
    },
  })

  if (result.status !== "success") {
    console.error("生成失败：")
    if (result.status === "failed") {
      console.error(result.error.message)
    } else {
      console.error(JSON.stringify(result, null, 2))
    }
    process.exit(1)
  }

  console.log("生成完成")
  console.log(`源文件：${result.result.source_file}`)
  console.log(`用例数量：${result.result.test_cases_count}`)
  console.log(`测试通过：${result.result.passed ? "是" : "否"}`)
  console.log("导出文件：")
  for (const file of result.result.exported_files) {
    console.log(`- ${file}`)
  }
}

function loadDotEnv(): void {
  const envPath = path.resolve(".env")
  if (!fs.existsSync(envPath)) {
    return
  }

  const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }

    const separator = trimmed.indexOf("=")
    if (separator <= 0) {
      continue
    }

    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "")
    process.env[key] ??= value
  }
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { maxAttempts: 3, help: false }
  const positional: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    const next = argv[index + 1]

    if (current === "--help" || current === "-h") {
      args.help = true
    } else if (current === "--input" || current === "-i") {
      args.input = next
      index += 1
    } else if (current === "--output" || current === "-o") {
      args.output = next
      index += 1
    } else if (current === "--max-attempts") {
      args.maxAttempts = Number(next ?? "3")
      index += 1
    } else if (current === "--requirements") {
      args.requirementsText = next
      index += 1
    } else {
      positional.push(current)
    }
  }

  args.input ??= positional[0]
  args.output ??= positional[1]
  if (positional[2] && Number.isFinite(Number(positional[2]))) {
    args.maxAttempts = Number(positional[2])
  }

  return args
}

function printHelp(): void {
  console.log(`测试用例生成Agent

用法：
  npm run generate -- --input <源文件.py> --output <输出目录>
  npm run generate -- <源文件.py> <输出目录>

参数：
  --input, -i        Python源文件路径，必填
  --output, -o       输出目录，默认 ./output/exports
  --max-attempts     最大自愈尝试次数，默认 3
  --requirements     可选需求文本
  --help, -h         显示帮助
`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
