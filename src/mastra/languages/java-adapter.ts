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

const PACKAGE_PATTERN = /^\s*package\s+([A-Za-z_][\w.]*);/m
const CLASS_PATTERN = /^\s*(?:public\s+)?(?:final\s+)?class\s+([A-Za-z_]\w*)/m
const METHOD_PATTERN =
  /(?:^|[\n\r{;])\s*(?:public|protected|private)?\s*(static\s+)?(?:final\s+)?([A-Za-z_][\w<>\[\], ?]*)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:throws\s+[^{]+)?\{/gm

export const javaAdapter: LanguageAdapter = {
  language: "java",
  displayName: "Java",
  extensions: [".java"],
  testFramework: "JUnit 5",
  codeFence: "java",

  parseSource({ sourceCode, filename }) {
    const className = CLASS_PATTERN.exec(sourceCode)?.[1] ?? path.basename(filename, ".java")
    const symbols: SourceSymbol[] = []

    for (const match of sourceCode.matchAll(METHOD_PATTERN)) {
      const name = match[3]
      if (["if", "for", "while", "switch", "catch", "main"].includes(name)) continue
      const body = extractBlock(sourceCode, (match.index ?? 0) + match[0].length - 1)
      symbols.push({
        name,
        kind: "method",
        className,
        returnType: match[2].trim(),
        returnExpression: extractSimpleReturnExpression(body),
        isStatic: Boolean(match[1]),
        params: parseJavaParams(match[4]),
        startLine: lineOf(sourceCode, match.index ?? 0),
      })
    }

    return {
      language: "java",
      moduleName: className,
      packageName: PACKAGE_PATTERN.exec(sourceCode)?.[1],
      imports: [...sourceCode.matchAll(/^\s*import\s+([^;]+);/gm)].map((item) => item[1]),
      symbols,
      raw: { className },
      warnings: symbols.length === 0 ? ["NO_TESTABLE_SYMBOL: 未检测到 Java 方法"] : [],
    }
  },

  buildGenerationContext({ analysis }) {
    return [
      "Language: Java",
      "Test framework: JUnit 5",
      `Class name: ${analysis.moduleName}`,
      analysis.packageName ? `Package name: ${analysis.packageName}` : "Package name: default package",
      "Runtime layout: source is copied to src/main/java and the generated test is copied to src/test/java using the same package path.",
      `Import rule: generate tests for class ${analysis.moduleName}; use the package declaration only when Package name is not default package.`,
      "Testable methods:",
      ...analysis.symbols.map((symbol) => {
        const params = symbol.params.map((param) => param.raw ?? `${param.type ?? ""} ${param.name ?? ""}`).join(", ")
        return `- ${symbol.isStatic ? "static " : ""}${symbol.returnType ?? "void"} ${symbol.name}(${params})`
      }),
    ].filter(Boolean).join("\n")
  },

  executeTests(input) {
    return executeJavaTests(input)
  },

  checkQuality({ testCode }) {
    return checkJavaQuality(testCode)
  },

  diagnose({ executionResult, quality }) {
    return diagnoseJavaFailure(executionResult, quality)
  },

  exportArtifacts(input) {
    return exportJavaArtifacts(input)
  },
}

function executeJavaTests(input: {
  sourceCode: string
  sourceFile: string
  filename: string
  testCode: string
  timeoutSeconds: number
  analysis: SourceAnalysis
}): ExecutionResult {
  const maven = resolveMavenCommand()
  if (!maven) {
    return {
      status: "error",
      passed: 0,
      failed: 0,
      errors: 1,
      stdout: "",
      stderr: "Maven 不可用。请设置 MAVEN_HOME 或将 Maven bin 目录添加到 PATH。",
      exit_code: -1,
      duration_ms: 0,
      timeout: false,
      command: "mvn -q test",
      missing_dependencies: ["maven"],
    }
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "testgenerate-java-"))
  const packagePath = input.analysis.packageName?.replace(/\./g, path.sep) ?? ""
  const mainDir = path.join(tempDir, "src", "main", "java", packagePath)
  const testDir = path.join(tempDir, "src", "test", "java", packagePath)
  fs.mkdirSync(mainDir, { recursive: true })
  fs.mkdirSync(testDir, { recursive: true })
  fs.writeFileSync(path.join(mainDir, path.basename(input.sourceFile)), input.sourceCode, "utf-8")
  fs.writeFileSync(path.join(testDir, `${input.analysis.moduleName}Test.java`), input.testCode, "utf-8")
  fs.writeFileSync(path.join(tempDir, "pom.xml"), renderPom(), "utf-8")

  const started = Date.now()
  const commandText = `${maven} -q test`
  const result = spawnSync(maven, ["-q", "test"], {
    cwd: tempDir,
    encoding: "utf-8",
    timeout: input.timeoutSeconds * 1000,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
    shell: shouldUseShell(maven),
  })
  const duration = Date.now() - started
  const stdout = result.stdout ?? ""
  const stderr = result.error?.message ?? result.stderr ?? ""
  const combined = `${stdout}\n${stderr}`
  const timeout = Boolean(result.error && result.error.name === "TimeoutError")
  const exitCode = typeof result.status === "number" ? result.status : -1

  if (timeout) {
    return baseExecution("timeout", stdout, stderr || "Maven test execution timed out", exitCode, duration, true, commandText, tempDir)
  }

  if (exitCode === 0) {
    const report = parseSurefireReports(tempDir)
    return baseExecution("passed", stdout, stderr, exitCode, duration, false, commandText, tempDir, report.passed || 1, report.failed, report.errors, report.testResults)
  }

  const missing = inferJavaMissingDependencies(combined)
  const report = parseSurefireReports(tempDir)
  const failures = Number(combined.match(/Failures:\s*(\d+)/)?.[1] ?? 0)
  const errors = Number(combined.match(/Errors:\s*(\d+)/)?.[1] ?? (missing.length ? 1 : 0))
  return {
    ...baseExecution(
      (report.failed || failures) > 0 ? "failed" : "error",
      stdout,
      stderr,
      exitCode,
      duration,
      false,
      commandText,
      tempDir,
      report.passed,
      report.failed || failures,
      report.errors || errors || 1,
      report.testResults
    ),
    missing_dependencies: missing.length ? missing : undefined,
  }
}

function checkJavaQuality(testCode: string): QualityResult {
  const issues: string[] = []
  const checkedTests = (testCode.match(/@Test\b/g) ?? []).length
  if (checkedTests === 0) issues.push("NO_TEST_FUNCTION: 未发现 JUnit @Test 注解")
  if (!/\bassert[A-Za-z]*\s*\(/.test(testCode) && !/\bfail\s*\(/.test(testCode)) {
    issues.push("NO_ASSERTION: 未发现 JUnit 断言")
  }
  if (/\bfail\s*\(\s*"No testable Java methods/.test(testCode)) {
    issues.push("NO_TESTABLE_SYMBOL: 仅生成了兜底的失败测试")
  }
  if (/\bassertTrue\s*\(\s*true\s*\)/.test(testCode)) {
    issues.push("TRIVIAL_ASSERTION: assertTrue(true) 不验证任何行为")
  }
  const strong = (testCode.match(/\b(assertEquals|assertThrows|assertArrayEquals|assertIterableEquals|assertFalse|assertTrue)\s*\(/g) ?? []).length
  const weak = (testCode.match(/\b(assertNotNull|assertDoesNotThrow)\s*\(/g) ?? []).length
  if (checkedTests > 0 && strong === 0 && weak > 0) {
    issues.push("WEAK_ASSERTION: 仅包含空值/无抛出检查，未验证核心行为")
  }
  return { ok: issues.length === 0, issues, checked_tests: checkedTests }
}

function diagnoseJavaFailure(executionResult: ExecutionResult, quality: QualityResult): Diagnosis {
  const combined = `${executionResult.stdout}\n${executionResult.stderr}`
  if (quality.issues.length > 0 && executionResult.status === "passed") {
    return {
      diagnosis_type: "TEST_CODE_ERROR",
      confidence: 0.86,
      evidence: ["测试通过了但质量检查未通过", ...quality.issues],
      next_action: "REGENERATE_TEST_CODE",
    }
  }
  if (executionResult.missing_dependencies?.length || /Maven is not available|Could not resolve dependencies|package .* does not exist/i.test(combined)) {
    const commands = /Maven is not available/i.test(combined)
      ? ["winget install Apache.Maven"]
      : ["mvn -q test"]
    return {
      diagnosis_type: "ENVIRONMENT_ERROR",
      confidence: 0.88,
      evidence: ["Java 测试执行缺少构建工具或依赖", ...(executionResult.missing_dependencies ?? [])],
      next_action: "INSTALL_DEPENDENCY",
      suggested_commands: commands,
    }
  }
  if (/cannot find symbol|compilation failure|Compilation failure|NoSuchMethod|method .* cannot be applied/i.test(combined)) {
    return {
      diagnosis_type: "TEST_CODE_ERROR",
      confidence: 0.78,
      evidence: ["编译错误表明生成的测试与源代码 API 不匹配"],
      next_action: "REGENERATE_TEST_CODE",
    }
  }
  if (executionResult.failed > 0 || /AssertionFailedError|expected:|but was:/i.test(combined)) {
    return {
      diagnosis_type: "BEHAVIOR_MISMATCH",
      confidence: 0.68,
      evidence: ["JUnit 断言失败；实际行为与预期行为不符"],
      next_action: "ASK_USER_CONFIRMATION",
    }
  }
  return {
    diagnosis_type: "UNKNOWN",
    confidence: 0.55,
    evidence: ["Java 执行结果不足以进行自动诊断"],
    next_action: "REPORT_TO_USER",
  }
}

function exportJavaArtifacts(input: {
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
    const testPath = path.join(input.outputDir, `${input.analysis.moduleName}Test${suffix}.java`)
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

function parseJavaParams(raw: string): SourceSymbol["params"] {
  return raw.split(",").map((item) => item.trim()).filter(Boolean).map((item) => {
    const parts = item.split(/\s+/)
    const name = parts.at(-1)?.replace(/\[\]$/, "")
    const type = parts.slice(0, -1).join(" ")
    return { name, type, raw: item }
  })
}

function sampleJavaValue(typeName: string): string {
  const normalized = typeName.toLowerCase()
  if (normalized.includes("string[]") || normalized.includes("string...")) return "new String[]{}"
  if (normalized.includes("string")) return "\"test\""
  if (normalized.includes("boolean")) return "true"
  if (normalized.includes("double") || normalized.includes("float")) return "1.0"
  if (normalized.includes("long")) return "1L"
  if (normalized.includes("int") || normalized.includes("short") || normalized.includes("byte")) return "1"
  if (normalized.includes("list")) return "java.util.List.of()"
  if (normalized.includes("map")) return "java.util.Map.of()"
  return "null"
}

function renderPom(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>generated</groupId>
  <artifactId>testgenerate-agent-temp</artifactId>
  <version>1.0.0</version>
  <properties>
    <maven.compiler.source>17</maven.compiler.source>
    <maven.compiler.target>17</maven.compiler.target>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.10.2</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>3.2.5</version>
      </plugin>
    </plugins>
  </build>
</project>`
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

function resolveMavenCommand(): string | undefined {
  const candidates = [
    "mvn",
    process.env.MAVEN_HOME ? path.join(process.env.MAVEN_HOME, "bin", process.platform === "win32" ? "mvn.cmd" : "mvn") : undefined,
    process.env.M2_HOME ? path.join(process.env.M2_HOME, "bin", process.platform === "win32" ? "mvn.cmd" : "mvn") : undefined,
  ].filter((item): item is string => Boolean(item))

  for (const candidate of candidates) {
    if (commandAvailable(candidate, ["--version"])) return candidate
  }
  return undefined
}

function parseSurefireReports(tempDir: string): { passed: number; failed: number; errors: number; testResults: unknown[] } {
  const reportDir = path.join(tempDir, "target", "surefire-reports")
  if (!fs.existsSync(reportDir)) return { passed: 0, failed: 0, errors: 0, testResults: [] }

  let passed = 0
  let failed = 0
  let errors = 0
  const testResults: Array<Record<string, unknown>> = []

  for (const file of fs.readdirSync(reportDir).filter((name) => name.endsWith(".xml"))) {
    const xml = fs.readFileSync(path.join(reportDir, file), "utf-8")
    for (const match of xml.matchAll(/<testcase\b([^>]*)>([\s\S]*?)<\/testcase>|<testcase\b([^>]*)\/>/g)) {
      const attrs = parseXmlAttributes(match[1] ?? match[3] ?? "")
      const body = match[2] ?? ""
      const failure = body.match(/<(failure|error)\b([^>]*)>([\s\S]*?)<\/\1>/)
      const skipped = /<skipped\b/.test(body)
      const result = failure ? (failure[1] === "error" ? "error" : "failed") : skipped ? "skipped" : "passed"
      if (result === "passed") passed += 1
      else if (result === "failed") failed += 1
      else if (result === "error") errors += 1
      testResults.push({
        test_class: attrs.classname ?? "",
        test_name: attrs.name ?? "",
        result,
        duration_ms: Math.round(Number(attrs.time ?? 0) * 1000),
        failure_reason: failure ? cleanXml(failure[3] || failure[2] || "") : "",
      })
    }
  }

  return { passed, failed, errors, testResults }
}

function parseXmlAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const match of raw.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)="([^"]*)"/g)) {
    attrs[match[1]] = cleanXml(match[2])
  }
  return attrs
}

function cleanXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
}

function commandAvailable(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, { encoding: "utf-8", windowsHide: true, shell: shouldUseShell(command) })
  return !result.error
}

function shouldUseShell(command: string): boolean {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command)
}

function inferJavaMissingDependencies(output: string): string[] {
  const missing = new Set<string>()
  for (const match of output.matchAll(/package\s+([A-Za-z_][\w.]*)\s+does not exist/g)) missing.add(match[1])
  if (/Could not resolve dependencies|Could not find artifact/i.test(output)) missing.add("maven dependency")
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

function isJavaLiteral(expression: string): boolean {
  return /^".*"$/.test(expression) || /^'.*'$/.test(expression) || /^-?\d+(?:\.\d+)?[dDfFlL]?$/.test(expression) || /^(true|false|null)$/.test(expression)
}

function lineOf(sourceCode: string, index: number): number {
  return sourceCode.slice(0, index).split(/\r?\n/).length
}

function safeName(value: string): string {
  const result = value.replace(/[^A-Za-z0-9_]/g, "_")
  return /^[A-Za-z_]/.test(result) ? result : `test_${result}`
}
