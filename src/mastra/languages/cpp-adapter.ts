import { spawnSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { exportCases } from "../tools/export-cases-tool.js"
import type {
  Diagnosis,
  ExecutionResult,
  LanguageAdapter,
  QualityResult,
  SourceAnalysis,
  SourceSymbol,
  TestCase,
} from "./types.js"

const FUNCTION_PATTERN =
  /^\s*(?:inline\s+|static\s+|constexpr\s+)?([A-Za-z_][\w:<>\s*&]+?)\s+([A-Za-z_]\w*)\s*\(([^;{}]*)\)\s*(?:const\s*)?\{/gm
const CLASS_PATTERN = /^\s*(?:class|struct)\s+([A-Za-z_]\w*)/m

export const cppAdapter: LanguageAdapter = {
  language: "cpp",
  displayName: "C++",
  extensions: [".cpp", ".cc", ".cxx", ".hpp", ".h"],
  testFramework: "GoogleTest",
  codeFence: "cpp",

  parseSource({ sourceCode, filename }) {
    const moduleName = path.basename(filename, path.extname(filename))
    const className = CLASS_PATTERN.exec(sourceCode)?.[1]
    const symbols: SourceSymbol[] = []

    for (const match of sourceCode.matchAll(FUNCTION_PATTERN)) {
      const name = match[2]
      if (["if", "for", "while", "switch", "catch", "main"].includes(name)) continue
      const body = extractBlock(sourceCode, (match.index ?? 0) + match[0].length - 1)
      symbols.push({
        name,
        kind: className && sourceCode.slice(0, match.index ?? 0).includes(`class ${className}`) ? "method" : "function",
        className,
        returnType: match[1].trim(),
        returnExpression: extractSimpleReturnExpression(body),
        params: parseCppParams(match[3]),
        startLine: lineOf(sourceCode, match.index ?? 0),
      })
    }

    return {
      language: "cpp",
      moduleName,
      imports: [...sourceCode.matchAll(/^\s*#include\s+[<"]([^>"]+)[>"]/gm)].map((item) => item[1]),
      symbols,
      raw: { className },
      warnings: symbols.length === 0 ? ["NO_TESTABLE_SYMBOL: 未检测到 C++ 函数"] : [],
    }
  },

  buildGenerationContext({ analysis, sourceFile }) {
    return [
      "Language: C++",
      "Test framework: GoogleTest",
      `Module name: ${analysis.moduleName}`,
      `Source filename available beside the generated test: ${sourceFile.split(/[\\/]/).pop()}`,
      "Runtime layout: the source file and generated test file are copied into the same temporary directory before compilation.",
      "Import rule: include the source file by its basename when needed, for example #include \"example.cpp\". Do not include unavailable project paths.",
      "Testable symbols:",
      ...analysis.symbols.map((symbol) => {
        const params = symbol.params.map((param) => param.raw ?? `${param.type ?? ""} ${param.name ?? ""}`).join(", ")
        const owner = symbol.className ? `${symbol.className}::` : ""
        return `- ${symbol.returnType ?? "void"} ${owner}${symbol.name}(${params})`
      }),
    ].join("\n")
  },

  executeTests(input) {
    return executeCppTests(input)
  },

  checkQuality({ testCode }) {
    return checkCppQuality(testCode)
  },

  diagnose({ executionResult, quality }) {
    return diagnoseCppFailure(executionResult, quality)
  },

  exportArtifacts(input) {
    return exportCppArtifacts(input)
  },
}

function executeCppTests(input: {
  sourceCode: string
  sourceFile: string
  filename: string
  testCode: string
  timeoutSeconds: number
  analysis: SourceAnalysis
}): ExecutionResult {
  if (!commandAvailable("g++", ["--version"])) {
    return {
      status: "error",
      passed: 0,
      failed: 0,
      errors: 1,
      stdout: "",
      stderr: "g++ 不在 PATH 中，请安装 MinGW 或 MSYS2",
      exit_code: -1,
      duration_ms: 0,
      timeout: false,
      command: "g++ --version",
      missing_dependencies: ["g++"],
    }
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "testgenerate-cpp-"))
  const sourcePath = path.join(tempDir, path.basename(input.sourceFile))
  const testPath = path.join(tempDir, `test_${input.analysis.moduleName}.cpp`)
  const exePath = path.join(tempDir, process.platform === "win32" ? "generated_tests.exe" : "generated_tests")
  fs.writeFileSync(sourcePath, input.sourceCode, "utf-8")
  fs.writeFileSync(testPath, input.testCode, "utf-8")

  const gtest = resolveGtestCompileConfig(input.testCode)
  const compileArgs = [
    path.basename(testPath),
    "-std=c++17",
    ...gtest.args,
    "-pthread",
    "-o",
    exePath,
  ]
  const compile = runRaw("g++", compileArgs, tempDir, input.timeoutSeconds)
  if (compile.timeout) {
    return baseExecution("timeout", compile.stdout, compile.stderr || "C++ 编译超时", compile.exitCode, compile.durationMs, true, compile.command, tempDir)
  }
  if (compile.exitCode !== 0) {
    const missing = inferCppMissingDependencies(`${compile.stdout}\n${compile.stderr}`)
    return {
      ...baseExecution(missing.length ? "error" : "error", compile.stdout, compile.stderr, compile.exitCode, compile.durationMs, false, compile.command, tempDir),
      missing_dependencies: missing.length ? missing : undefined,
    }
  }

  const run = runRaw(exePath, [], tempDir, input.timeoutSeconds)
  if (run.timeout) {
    return baseExecution("timeout", run.stdout, run.stderr || "C++ 测试执行超时", run.exitCode, compile.durationMs + run.durationMs, true, run.command, tempDir)
  }
  if (run.exitCode === 0) {
    const report = parseGtestOutput(run.stdout)
    return baseExecution("passed", run.stdout, run.stderr, 0, compile.durationMs + run.durationMs, false, run.command, tempDir, report.passed, report.failed, 0, report.testResults)
  }
  const report = parseGtestOutput(run.stdout)
  return baseExecution("failed", run.stdout, run.stderr, run.exitCode, compile.durationMs + run.durationMs, false, run.command, tempDir, report.passed, report.failed || countGtestFailed(run.stdout), 0, report.testResults)
}

function checkCppQuality(testCode: string): QualityResult {
  const issues: string[] = []
  const checkedTests = (testCode.match(/\bTEST(?:_F|_P)?\s*\(/g) ?? []).length
  if (checkedTests === 0) issues.push("NO_TEST_FUNCTION: 未发现 GoogleTest TEST 宏")
  if (!/\b(EXPECT|ASSERT)_[A-Z_]+\s*\(/.test(testCode) && !/\bFAIL\s*\(/.test(testCode)) {
    issues.push("NO_ASSERTION: 未发现 GoogleTest 断言")
  }
  if (/\bFAIL\s*\(\)\s*<<\s*"No testable C\+\+ functions/.test(testCode)) {
    issues.push("NO_TESTABLE_SYMBOL: 仅生成了兜底的失败测试")
  }
  if (/\bEXPECT_TRUE\s*\(\s*true\s*\)/.test(testCode)) {
    issues.push("TRIVIAL_ASSERTION: EXPECT_TRUE(true) 不验证任何行为")
  }
  const strong = /\b(EXPECT|ASSERT)_(EQ|NE|LT|LE|GT|GE|STREQ|THROW|TRUE|FALSE)\s*\(/.test(testCode)
  const onlyNoThrow = /\b(EXPECT|ASSERT)_NO_THROW\s*\(/.test(testCode) && !strong
  if (checkedTests > 0 && onlyNoThrow) issues.push("WEAK_ASSERTION: 仅包含无抛出检查，未验证核心行为")
  return { ok: issues.length === 0, issues, checked_tests: checkedTests }
}

function diagnoseCppFailure(executionResult: ExecutionResult, quality: QualityResult): Diagnosis {
  const combined = `${executionResult.stdout}\n${executionResult.stderr}`
  if (quality.issues.length > 0 && executionResult.status === "passed") {
    return {
      diagnosis_type: "TEST_CODE_ERROR",
      confidence: 0.86,
      evidence: ["测试通过了但质量检查未通过", ...quality.issues],
      next_action: "REGENERATE_TEST_CODE",
    }
  }
  if (executionResult.missing_dependencies?.length || /gtest\/gtest\.h|cannot find -lgtest|g\+\+ is not available|std::mutex|Thread model:\s*win32/i.test(combined)) {
    const commands = /mingw posix\/ucrt64 thread model compiler|std::mutex/i.test(combined)
      ? ["Install MSYS2 UCRT64/MinGW64 g++ and use its bin directory in PATH"]
      : /g\+\+ is not available/i.test(combined)
      ? ["winget install MSYS2.MSYS2"]
      : ["vcpkg install gtest"]
    return {
      diagnosis_type: "ENVIRONMENT_ERROR",
      confidence: 0.88,
      evidence: ["C++ 测试执行缺少编译器或 GoogleTest", ...(executionResult.missing_dependencies ?? [])],
      next_action: "INSTALL_DEPENDENCY",
      suggested_commands: commands,
    }
  }
  if (/error:|undefined reference|no matching function|not declared/i.test(combined)) {
    return {
      diagnosis_type: "TEST_CODE_ERROR",
      confidence: 0.78,
      evidence: ["编译错误表明生成的测试与源代码 API 不匹配"],
      next_action: "REGENERATE_TEST_CODE",
    }
  }
  if (executionResult.failed > 0 || /\[\s*FAILED\s*\]/.test(combined)) {
    return {
      diagnosis_type: "BEHAVIOR_MISMATCH",
      confidence: 0.68,
      evidence: ["GoogleTest 断言失败；实际行为与预期行为不符"],
      next_action: "ASK_USER_CONFIRMATION",
    }
  }
  return {
    diagnosis_type: "UNKNOWN",
    confidence: 0.55,
    evidence: ["C++ 执行结果不足以进行自动诊断"],
    next_action: "REPORT_TO_USER",
  }
}

function exportCppArtifacts(input: {
  testCases: TestCase[]
  testCode: string
  outputDir: string
  sourceFile: string
  executionResult?: ExecutionResult
  diagnosis?: Diagnosis
  quality?: QualityResult
  coverage?: unknown
  versions?: unknown[]
  artifactPrefix?: string
  skipTestCode?: boolean
  analysis: SourceAnalysis
}) {
  fs.mkdirSync(input.outputDir, { recursive: true })
  const files: string[] = []
  const suffix = input.artifactPrefix ? `_${input.artifactPrefix}` : ""
  if (!input.skipTestCode) {
    const testPath = path.join(input.outputDir, `test_${input.analysis.moduleName}${suffix}.cpp`)
    fs.writeFileSync(testPath, input.testCode, "utf-8")
    files.push(testPath)
  }
  const report = exportCases({
    test_cases: input.testCases,
    test_code: input.testCode,
    output_dir: input.outputDir,
    execution_result: input.executionResult,
    diagnosis: input.diagnosis,
    quality: input.quality,
    coverage: input.coverage,
    versions: input.versions,
    artifact_prefix: input.artifactPrefix,
    skip_py: true,
  })
  files.push(...report.exported_files)
  try {
    const sourceCopy = path.join(input.outputDir, path.basename(input.sourceFile))
    fs.copyFileSync(input.sourceFile, sourceCopy)
    files.push(sourceCopy)
  } catch {
    // 忽略复制失败；导出的测试和报告仍可使用
  }
  return { exported_files: files }
}

function parseCppParams(raw: string): SourceSymbol["params"] {
  return raw.split(",").map((item) => item.trim()).filter(Boolean).map((item) => {
    const cleaned = item.replace(/=.*/, "").trim()
    const parts = cleaned.split(/\s+/)
    const name = parts.at(-1)?.replace(/[&*]/g, "")
    const type = parts.slice(0, -1).join(" ")
    return { name, type: type || cleaned, raw: item }
  })
}

function sampleCppValue(typeName: string): string {
  const normalized = typeName.toLowerCase()
  if (normalized.includes("std::string") || normalized.includes("string")) return "\"test\""
  if (normalized.includes("bool")) return "true"
  if (normalized.includes("double") || normalized.includes("float")) return "1.0"
  if (normalized.includes("int") || normalized.includes("long") || normalized.includes("short")) return "1"
  if (normalized.includes("vector")) return "{}"
  return "{}"
}

function runRaw(command: string, args: string[], cwd: string, timeoutSeconds: number) {
  const started = Date.now()
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf-8",
    timeout: timeoutSeconds * 1000,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  })
  return {
    command: [command, ...args].join(" "),
    stdout: result.stdout ?? "",
    stderr: result.error?.message ?? result.stderr ?? "",
    exitCode: typeof result.status === "number" ? result.status : -1,
    durationMs: Date.now() - started,
    timeout: Boolean(result.error && result.error.name === "TimeoutError"),
  }
}

function baseExecution(
  status: ExecutionResult["status"],
  stdout: string,
  stderr: string,
  exitCode: number,
  duration: number,
  timeout: boolean,
  command: string,
  cwd: string,
  passed = 0,
  failed = 0,
  errors = status === "error" ? 1 : 0,
  testResults?: unknown[]
): ExecutionResult {
  return { status, passed, failed, errors, stdout, stderr, exit_code: exitCode, duration_ms: duration, timeout, command, cwd, test_results: testResults }
}

function commandAvailable(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, { encoding: "utf-8", windowsHide: true })
  return !result.error
}

function inferCppMissingDependencies(output: string): string[] {
  const missing = new Set<string>()
  if (/gtest\/gtest\.h/.test(output)) missing.add("googletest")
  if (/cannot find -lgtest/.test(output)) missing.add("libgtest")
  if (/std::mutex|<mutex>|enable-threads=win32|Thread model:\s*win32/i.test(output)) {
    missing.add("mingw posix/ucrt64 thread model compiler")
  }
  if (/No such file or directory/.test(output)) missing.add("header or source dependency")
  return [...missing]
}

function extractBlock(sourceCode: string, openBraceIndex: number): string {
  let depth = 0
  for (let index = openBraceIndex; index < sourceCode.length; index += 1) {
    const char = sourceCode[index]
    if (char === "{") depth += 1
    if (char === "}") depth -= 1
    if (depth === 0) return sourceCode.slice(openBraceIndex + 1, index)
  }
  return ""
}

function extractSimpleReturnExpression(body: string): string | undefined {
  return body.match(/\breturn\s+([^;]+);/)?.[1]?.trim()
}

function isCppLiteral(expression: string): boolean {
  return /^".*"$/.test(expression) || /^'.*'$/.test(expression) || /^-?\d+(?:\.\d+)?[fFlLuU]*$/.test(expression) || /^(true|false|nullptr)$/.test(expression)
}

function countGtestPassed(output: string): number {
  const match = output.match(/\[\s*PASSED\s*\]\s*(\d+)\s*test/)
  return match ? Number(match[1]) : 0
}

function countGtestFailed(output: string): number {
  const match = output.match(/\[\s*FAILED\s*\]\s*(\d+)\s*test/)
  return match ? Number(match[1]) : 0
}

function parseGtestOutput(output: string): { passed: number; failed: number; testResults: unknown[] } {
  const lines = output.split(/\r?\n/)
  const results: Array<Record<string, unknown>> = []
  const testNames = new Map<string, number>()

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()

    const runMatch = trimmed.match(/^\[\s*RUN\s*\]\s+(.+)/)
    if (runMatch) {
      testNames.set(runMatch[1].trim(), index)
      continue
    }

    const okHeader = /^\[\s*OK\s*\]\s+/
    if (okHeader.test(trimmed)) {
      const raw = trimmed.replace(okHeader, "")
      const name = raw.replace(/\s*\(\d+\s*ms\)\s*$/, "").trim()
      const duration = raw.match(/\((\d+)\s*ms\)\s*$/)?.[1]
      addGtestResult(results, testNames, name, "passed", duration ?? "0")
      continue
    }

    const failedHeader = /^\[\s*FAILED\s*\]\s+/
    if (failedHeader.test(trimmed)) {
      const raw = trimmed.replace(failedHeader, "")
      const name = raw.replace(/\s*\(\d+\s*ms\)\s*$/, "").trim()
      const duration = raw.match(/\((\d+)\s*ms\)\s*$/)?.[1]
      const runLine = testNames.get(name)
      const failureText = runLine !== undefined
        ? lines.slice(runLine + 1, index)
            .map((item) => item.trim())
            .filter((item) => item && !/^\[/.test(item))
            .join(" ")
            .replace(/\s+/g, " ")
            .slice(0, 800)
        : ""
      addGtestResult(results, testNames, name, "failed", duration ?? "0", failureText)
    }
  }

  const parsedPassed = results.filter((item) => item.result === "passed").length
  const parsedFailed = results.filter((item) => item.result === "failed").length

  const passed = parsedPassed || countGtestPassed(output)
  const failed = parsedFailed || countGtestFailed(output)

  return { passed, failed, testResults: results }
}

function addGtestResult(
  results: Array<Record<string, unknown>>,
  testNames: Map<string, number>,
  fullName: string,
  result: string,
  durationMs: string,
  failureReason?: string
) {
  const lastDot = fullName.lastIndexOf(".")
  const entry: Record<string, unknown> = {
    test_class: lastDot >= 0 ? fullName.slice(0, lastDot) : "",
    test_name: lastDot >= 0 ? fullName.slice(lastDot + 1) : fullName,
    result,
    duration_ms: Number(durationMs) || 0,
    failure_reason: failureReason || "",
  }
  results.push(entry)
  testNames.delete(fullName)
}

function resolveGtestCompileConfig(testCode: string): { args: string[]; mode: "source" | "installed" } {
  const root = findGtestSourceRoot()
  if (root) {
    const gtestDir = path.join(root, "googletest")
    const args = [
      "-I" + path.join(gtestDir, "include"),
      "-I" + gtestDir,
      path.join(gtestDir, "src", "gtest-all.cc"),
    ]
    if (!/\bmain\s*\(/.test(testCode)) {
      args.push(path.join(gtestDir, "src", "gtest_main.cc"))
    }
    return { args, mode: "source" }
  }
  return { args: ["-lgtest", "-lgtest_main"], mode: "installed" }
}

function findGtestSourceRoot(): string | undefined {
  const candidates = [
    process.env.GTEST_ROOT,
    process.env.GOOGLETEST_ROOT,
    process.env.GTEST_HOME,
    process.env.GOOGLETEST_HOME,
    "D:\\gtest\\googletest-1.17.0",
  ].filter((item): item is string => Boolean(item))

  for (const candidate of candidates) {
    const root = path.resolve(candidate)
    if (
      fs.existsSync(path.join(root, "googletest", "include", "gtest", "gtest.h")) &&
      fs.existsSync(path.join(root, "googletest", "src", "gtest-all.cc"))
    ) {
      return root
    }
  }
  return undefined
}

function lineOf(sourceCode: string, index: number): number {
  return sourceCode.slice(0, index).split(/\r?\n/).length
}

function safeName(value: string): string {
  const result = value.replace(/[^A-Za-z0-9_]/g, "_")
  return /^[A-Za-z_]/.test(result) ? result : `Generated_${result}`
}
