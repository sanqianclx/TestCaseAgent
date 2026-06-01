import { spawnSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { parseSourceCode, type ParsedSource } from "../tools/parse-source-code-tool.js"
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

export const javaAdapter: LanguageAdapter = {
  language: "java",
  displayName: "Java",
  extensions: [".java"],
  testFramework: "JUnit 5",
  codeFence: "java",

  parseSource({ sourceCode, filename }) {
    const parsed = parseSourceCode({ source_code: sourceCode, filename, language: "java" })
    return normalizeJavaAnalysis(parsed, sourceCode)
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
    // 使用 `mvn verify` 而非 `mvn test`,这样 jacoco-maven-plugin 的 `report` goal
    // 会在 verify 阶段自动触发,确保 jacoco.exec 与 jacoco.xml 在同一次调用内生成。
    // `-Djacoco.skip=false` 防止任何外部配置意外禁用 jacoco 收集。
    // 超时提升到 180s,给首次冷启动下载 Maven 依赖留足时间。
    const commandText = `${maven} verify -Dmaven.test.failure.ignore=true -Djacoco.skip=false`

    const result = spawnSync(maven, ["verify", "-Dmaven.test.failure.ignore=true", "-Djacoco.skip=false"], {
      cwd: tempDir,
      encoding: "utf-8",
      timeout: 180_000,
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
    return baseExecution("timeout", stdout, stderr || "Maven verify execution timed out", exitCode, duration, true, commandText, tempDir)
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

/**
 * 将统一 ParsedSource 转换为 Java SourceAnalysis
 * 关键字段：moduleName（类名）、packageName、symbols（每个方法一个 SourceSymbol）
 */
function normalizeJavaAnalysis(parsed: ParsedSource, sourceCode: string): SourceAnalysis {
  const packageName = extractJavaPackageName(sourceCode)
  const symbols: SourceSymbol[] = []

  const classes = (parsed.classes as Array<{
    name?: string; methods?: Array<{
      name: string; params: Array<{ name?: string; type?: string; raw?: string }>
      return_type: string; start_line: number; end_line: number
    }>
  }>)

  for (const cls of classes) {
    const className = cls.name ?? parsed.module_name
    for (const method of (cls.methods ?? [])) {
      symbols.push({
        name: method.name,
        kind: "method",
        className,
        returnType: method.return_type,
        returnExpression: extractReturnExpr(sourceCode, method.start_line, method.end_line),
        params: method.params.map(p => ({ name: p.name, type: p.type, raw: p.raw })),
        startLine: method.start_line,
        endLine: method.end_line,
      })
    }
  }

  // 顶层函数（非类内方法）
  const functions = (parsed.functions as Array<{
    name: string; params: Array<{ name?: string; type?: string; raw?: string }>
    return_type: string; start_line: number; end_line: number
  }>)

  for (const fn of functions) {
    symbols.push({
      name: fn.name,
      kind: "function",
      returnType: fn.return_type,
      returnExpression: extractReturnExpr(sourceCode, fn.start_line, fn.end_line),
      params: fn.params.map(p => ({ name: p.name, type: p.type, raw: p.raw })),
      startLine: fn.start_line,
      endLine: fn.end_line,
    })
  }

  const warnings = parsed.warnings ?? []
  if (symbols.length === 0 && (!warnings.some(w => w.includes("NO_TESTABLE_SYMBOL")))) {
    warnings.push("NO_TESTABLE_SYMBOL: 未检测到 Java 方法")
  }

  return {
    language: "java",
    moduleName: parsed.module_name,
    packageName,
    imports: parsed.imports,
    symbols,
    raw: { className: parsed.module_name },
    warnings,
  }
}

/**
 * 从源代码中提取 package 声明
 */
function extractJavaPackageName(sourceCode: string): string | undefined {
  const match = sourceCode.match(/^\s*package\s+([A-Za-z_][\w.]*);/m)
  return match ? match[1] : undefined
}

/**
 * 从源代码的行号区间提取 return 表达式
 */
function extractReturnExpr(sourceCode: string, startLine: number, endLine: number): string | undefined {
  const lines = sourceCode.split(/\r?\n/)
  for (let i = startLine - 1; i < Math.min(endLine, lines.length); i += 1) {
    const match = lines[i].match(/\breturn\s+([^;]+);/)
    if (match) return match[1].trim()
  }
  return undefined
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
      <plugin>
        <groupId>org.jacoco</groupId>
        <artifactId>jacoco-maven-plugin</artifactId>
        <version>0.8.12</version>
        <configuration>
          <dataFile>\${project.build.directory}/jacoco.exec</dataFile>
        </configuration>
        <executions>
          <execution>
            <id>prepare-agent</id>
            <goals><goal>prepare-agent</goal></goals>
          </execution>
          <execution>
            <id>report</id>
            <goals><goal>report</goal></goals>
          </execution>
        </executions>
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
    // Surefire 3.x 输出多行 XML,属性可能跨行,使用 `[\s\S]*?` 替代 `[^>]*`
    // 拆成两条独立正则,避免单条复合正则中两个分支互相回溯干扰:
    // 1) `<testcase ...>...</testcase>` — 用于 failed/errored 用例(failure 块跨行)
    // 2) `<testcase .../>` — 用于 passed/skipped 用例(自闭合)
    // 旧正则 `[^>]*` 不跨行,新合并正则存在最小匹配回溯,均会导致漏匹配
    for (const match of xml.matchAll(/<testcase\b([\s\S]*?)>([\s\S]*?)<\/testcase>/g)) {
      const attrs = parseXmlAttributes(match[1] ?? "")
      const body = match[2] ?? ""
      const failure = body.match(/<(failure|error)\b([\s\S]*?)>([\s\S]*?)<\/\1>/)
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
    for (const match of xml.matchAll(/<testcase\b([\s\S]*?)\/>/g)) {
      const attrs = parseXmlAttributes(match[1] ?? "")
      passed += 1
      testResults.push({
        test_class: attrs.classname ?? "",
        test_name: attrs.name ?? "",
        result: "passed",
        duration_ms: Math.round(Number(attrs.time ?? 0) * 1000),
        failure_reason: "",
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
