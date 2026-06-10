import path from "path"
import { executePytest } from "../tools/execute-tests-tool.js"
import { exportCases } from "../tools/export-cases-tool.js"
import { parseSourceCode, type ParsedSource } from "../tools/parse-source-code-tool.js"
import type {
  Diagnosis,
  ExecutionResult,
  LanguageAdapter,
  QualityResult,
  SourceAnalysis,
  SourceSymbol,
} from "./types.js"

export const pythonAdapter: LanguageAdapter = {
  language: "python",
  displayName: "Python",
  extensions: [".py"],
  testFramework: "pytest",
  codeFence: "python",

  parseSource({ sourceCode, filename }) {
    const parsed = parseSourceCode({ source_code: sourceCode, filename })
    return normalizePythonAnalysis(parsed, sourceCode, filename)
  },

  buildGenerationContext({ analysis, sourceFile }) {
    const runtimeModuleName = toPythonModuleName(path.basename(sourceFile))
    return [
      "语言：Python",
      "测试框架：pytest",
      `模块名：${analysis.moduleName}`,
      `运行时导入模块：${runtimeModuleName}`,
      `pytest 必须从 ${runtimeModuleName} 导入被测符号；不要导入 source，除非源文件真的叫 source.py。`,
      "可测试符号：",
      ...analysis.symbols.map((symbol) => {
        const owner = symbol.className ? `${symbol.className}.` : ""
        const params = symbol.params.map((param) => `${param.name ?? ""}: ${param.type ?? "Any"}`).join(", ")
        return `- ${owner}${symbol.name}(${params}) -> ${symbol.returnType ?? "Any"}`
      }),
    ].join("\n")
  },

  executeTests({ sourceCode, filename, testCode, timeoutSeconds }) {
    return executePytest({
      test_code: testCode,
      source_code: sourceCode,
      filename: `${toPythonModuleName(filename)}.py`,
      timeout: timeoutSeconds,
    }) as ExecutionResult
  },

  diagnose({ executionResult, quality }) {
    return diagnosePythonFailure(executionResult, quality)
  },

  exportArtifacts(input) {
    return exportCases({
      test_cases: input.testCases,
      test_code: input.testCode,
      output_dir: input.outputDir,
      execution_result: input.executionResult,
      diagnosis: input.diagnosis,
      quality: input.quality,
      coverage: input.coverage,
      versions: input.versions,
      artifact_prefix: input.artifactPrefix,
      skip_py: input.skipTestCode,
    })
  },
}

function normalizePythonAnalysis(parsed: ParsedSource, sourceCode: string, filename: string): SourceAnalysis {
  const functions = (parsed.functions as Array<{
    name: string
    params?: Array<{ name?: string; type?: string }>
    return_type?: string
    docstring?: string
    start_line?: number
    end_line?: number
  }>).map((item): SourceSymbol => ({
    name: item.name,
    kind: "function",
    params: (item.params ?? []).map((param) => ({ name: param.name, type: param.type })),
    returnType: item.return_type,
    returnExpression: extractPythonReturnExpression(sourceCode, item.name),
    docstring: item.docstring,
    startLine: item.start_line,
    endLine: item.end_line,
  }))

  const methods = (parsed.classes as Array<{
    name: string
    methods?: Array<{
      name: string
      params?: Array<{ name?: string; type?: string }>
      return_type?: string
      docstring?: string
      start_line?: number
      end_line?: number
    }>
  }>).flatMap((cls) =>
    (cls.methods ?? []).map((item): SourceSymbol => ({
      name: item.name,
      kind: "method",
      className: cls.name,
      params: (item.params ?? [])
        .filter((param) => param.name !== "self")
        .map((param) => ({ name: param.name, type: param.type })),
      returnType: item.return_type,
      docstring: item.docstring,
      startLine: item.start_line,
      endLine: item.end_line,
    }))
  )

  const analysis: SourceAnalysis = {
    language: "python",
    moduleName: toPythonModuleName(filename),
    imports: parsed.imports,
    symbols: [...functions, ...methods],
    raw: parsed,
    warnings: parsed.warnings ?? [],
  }
  return analysis
}

function diagnosePythonFailure(executionResult: ExecutionResult, quality: QualityResult): Diagnosis {
  const combined = `${executionResult.stdout}\n${executionResult.stderr}`

  if (quality.issues.length > 0 && executionResult.status === "passed") {
    return {
      diagnosis_type: "TEST_CODE_ERROR",
      confidence: 0.86,
      evidence: ["测试通过了但质量检查未通过", ...quality.issues],
      next_action: "REGENERATE_TEST_CODE",
    }
  }

  if (/No module named pytest|ModuleNotFoundError: No module named 'pytest'/.test(combined)) {
    return {
      diagnosis_type: "ENVIRONMENT_ERROR",
      confidence: 0.92,
      evidence: ["执行输出表明缺少 pytest"],
      next_action: "INSTALL_DEPENDENCY",
      suggested_commands: ["python -m pip install pytest"],
    }
  }

  if (/fixture .* not found|ImportError|ModuleNotFoundError|NameError|SyntaxError/i.test(combined)) {
    return {
      diagnosis_type: "TEST_CODE_ERROR",
      confidence: 0.8,
      evidence: ["失败原因指向生成的测试代码存在导入、名称、固件或语法问题"],
      next_action: "REGENERATE_TEST_CODE",
    }
  }

  if (executionResult.failed > 0 || /AssertionError|E\s+assert\b/.test(combined)) {
    return {
      diagnosis_type: "BEHAVIOR_MISMATCH",
      confidence: 0.68,
      evidence: ["断言失败；实际行为与预期行为不符"],
      next_action: "ASK_USER_CONFIRMATION",
    }
  }

  if (executionResult.timeout) {
    return {
      diagnosis_type: "UNKNOWN",
      confidence: 0.6,
      evidence: ["测试执行超时"],
      next_action: "ASK_USER_CONFIRMATION",
    }
  }

  return {
    diagnosis_type: executionResult.errors > 0 ? "SOURCE_RUNTIME_ERROR" : "UNKNOWN",
    confidence: 0.62,
    evidence: ["执行结果不足以进行自动修复"],
    next_action: "REPORT_TO_USER",
  }
}

function samplePythonValue(typeName = "Any"): string {
  const normalized = typeName.toLowerCase()
  if (normalized.includes("int")) return "1"
  if (normalized.includes("float")) return "1.0"
  if (normalized.includes("bool")) return "True"
  if (normalized.includes("list")) return "[]"
  if (normalized.includes("dict")) return "{}"
  if (normalized.includes("str")) return "'test'"
  return "None"
}

function toPythonModuleName(filename: string): string {
  const baseName = path.basename(filename, ".py")
  const sanitized = baseName.replace(/[^A-Za-z0-9_]/g, "_")
  if (!sanitized) return "source_temp"
  return /^[A-Za-z_]/.test(sanitized) ? sanitized : `m_${sanitized}`
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, "_")
}

function extractPythonReturnExpression(sourceCode: string, name: string): string | undefined {
  const pattern = new RegExp(`^def\\s+${escapeRegExp(name)}\\s*\\([^)]*\\)\\s*(?:->\\s*[^:]+)?\\s*:`, "m")
  const match = pattern.exec(sourceCode)
  if (!match || match.index === undefined) return undefined
  const rest = sourceCode.slice(match.index + match[0].length)
  const nextTopLevel = rest.search(/\n(?:def|class)\s+/)
  const body = nextTopLevel >= 0 ? rest.slice(0, nextTopLevel) : rest
  return body.match(/^\s*return\s+(.+)$/m)?.[1]?.trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
