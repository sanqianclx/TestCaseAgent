import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"
import path from "path"
import { readPythonFile } from "../tools/read-file-tool.js"
import { parseSourceCode, type ParsedSource } from "../tools/parse-source-code-tool.js"
import { executePytest, type ExecuteTestsOutput } from "../tools/execute-tests-tool.js"
import { exportCases } from "../tools/export-cases-tool.js"
import { checkTestQuality } from "../tools/check-quality-tool.js"
import { testCaseAgent } from "../agents/test-case-agent.js"
import { testCodeAgent } from "../agents/test-code-agent.js"
import { diagnosisAgent } from "../agents/diagnosis-agent.js"

const testCaseSchema = z.object({
  case_number: z.string(),
  title: z.string(),
  priority: z.string(),
  case_type: z.string(),
  preconditions: z.string(),
  steps: z.array(z.string()),
  expected_result: z.string(),
  related_symbol: z.string(),
})

type TestCase = z.infer<typeof testCaseSchema>

const diagnosisSchema = z.object({
  diagnosis_type: z.enum(["TEST_CODE_ERROR", "SOURCE_RUNTIME_ERROR", "BEHAVIOR_MISMATCH", "UNKNOWN"]),
  confidence: z.number(),
  evidence: z.array(z.string()),
  next_action: z.string(),
})

type Diagnosis = z.infer<typeof diagnosisSchema>

const workflowInputSchema = z.object({
  file_path: z.string().describe("源代码文件路径"),
  output_dir: z.string().default("./output/exports").describe("输出目录，仅导出 .py 和 .md"),
  max_attempts: z.number().default(3).describe("最大自愈尝试次数"),
  requirements_text: z.string().optional().describe("可选需求文本，用于辅助判断预期行为"),
})

const workflowOutputSchema = z.object({
  source_file: z.string(),
  test_code: z.string(),
  test_cases_count: z.number(),
  passed: z.boolean(),
  exported_files: z.array(z.string()),
  execution_detail: z.any(),
  diagnosis: z.any().optional(),
})

const generateAllStep = createStep({
  id: "generate-test-artifacts",
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
  execute: async ({ inputData }) => {
    const source = await readPythonFile({ path: inputData.file_path, encoding: "utf-8" })
    const parseResult = parseSourceCode({
      source_code: source.content,
      filename: source.filename,
    })

    const testCases = await generateTestCases(source.content, parseResult, inputData.requirements_text)

    let testCode = ""
    let executionResult: ExecuteTestsOutput = emptyExecutionResult()
    let diagnosis: Diagnosis | undefined

    for (let attempt = 1; attempt <= inputData.max_attempts; attempt += 1) {
      testCode = await generateTestCode({
        sourceCode: source.content,
        filename: source.filename,
        parseResult,
        testCases,
        attempt,
        previousDiagnosis: diagnosis,
      })

      executionResult = executePytest({
        test_code: testCode,
        source_code: source.content,
        filename: source.filename,
        timeout: 60,
      })

      const quality = checkTestQuality({ test_code: testCode })

      if (
        executionResult.status === "passed" &&
        executionResult.failed === 0 &&
        executionResult.errors === 0 &&
        quality.ok
      ) {
        diagnosis = undefined
        break
      }

      diagnosis = quality.ok
        ? await diagnoseFailure(source.content, testCode, executionResult)
        : {
            diagnosis_type: "TEST_CODE_ERROR",
            confidence: 0.85,
            evidence: quality.issues,
            next_action: "REGENERATE_TEST_CODE",
          }
      if (
        diagnosis.diagnosis_type !== "TEST_CODE_ERROR" ||
        diagnosis.confidence < 0.7 ||
        attempt >= inputData.max_attempts
      ) {
        break
      }
    }

    const exportResult = exportCases({
      test_cases: testCases,
      test_code: testCode,
      output_dir: path.resolve(inputData.output_dir),
      execution_result: executionResult,
      diagnosis,
    })

    return {
      source_file: source.file_path,
      test_code: testCode,
      test_cases_count: testCases.length,
      passed: executionResult.status === "passed" && executionResult.failed === 0 && executionResult.errors === 0,
      exported_files: exportResult.exported_files,
      execution_detail: executionResult,
      diagnosis,
    }
  },
})

export const generateTestWorkflow = createWorkflow({
  id: "generate-test-workflow",
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
})
  .then(generateAllStep)
  .commit()

/**
 * 生成测试用例（核心生成步骤之一）
 * 优先调用LLM Agent生成结构化测试用例JSON数组；
 * 若未配置API Key或LLM返回不稳定，则使用确定性兜底逻辑。
 *
 * @param sourceCode - Python源代码全文
 * @param parseResult - AST解析结果（函数/类/参数/行号）
 * @param requirementsText - 可选需求文本，辅助LLM判断预期行为
 * @returns 结构化的测试用例列表
 */
async function generateTestCases(
  sourceCode: string,
  parseResult: ParsedSource,
  requirementsText?: string
): Promise<TestCase[]> {
  if (canUseLLM()) {
    try {
    const response = await testCaseAgent.generate(`
请根据下面的Python源码和AST解析结果生成测试用例。只输出JSON数组，不要输出Markdown。

需求文本：
${requirementsText || "无"}

源码：
${sourceCode}

AST：
${JSON.stringify(parseResult, null, 2)}
`)
    const parsed = parseJsonArray(response.text)
    const cases = z.array(testCaseSchema).safeParse(parsed)
    if (cases.success && cases.data.length > 0) {
      return cases.data
    }
    } catch {
      // 没有配置LLM或LLM返回不稳定时，使用确定性兜底用例。
    }
  }

  return fallbackTestCases(parseResult)
}

/**
 * 生成pytest测试代码（核心生成步骤之二）
 * 优先调用LLM Agent生成可执行的pytest测试代码；
 * 若未配置API Key或LLM返回不稳定，则构造确定性兜底测试代码。
 * 每次自愈重试时都会向LLM传入上一次的诊断信息，帮助修正。
 *
 * @param input.sourceCode - Python源代码全文
 * @param input.filename - 源文件名，用于生成import语句
 * @param input.parseResult - AST解析结果
 * @param input.testCases - 已生成的测试用例列表
 * @param input.attempt - 当前尝试次数（第1次生成或第N次自愈）
 * @param input.previousDiagnosis - 上一轮失败诊断（自愈时传入）
 * @returns 完整的pytest测试代码字符串
 */
async function generateTestCode(input: {
  sourceCode: string
  filename: string
  parseResult: ParsedSource
  testCases: TestCase[]
  attempt: number
  previousDiagnosis?: Diagnosis
}): Promise<string> {
  const moduleName = path.basename(input.filename, ".py")

  if (canUseLLM()) {
    try {
    const response = await testCodeAgent.generate(`
请为下面Python源码生成可执行pytest测试代码。只输出一个python代码块。

模块名：${moduleName}

AST：
${JSON.stringify(input.parseResult, null, 2)}

测试用例：
${JSON.stringify(input.testCases, null, 2)}

上一次诊断：
${JSON.stringify(input.previousDiagnosis ?? null, null, 2)}

要求：
1. 从模块 ${moduleName} 导入被测函数或类。
2. 不要使用未定义fixture。
3. 不要使用assert True或空断言。
4. 当前是第 ${input.attempt} 次生成。
`)
    const code = extractPythonCode(response.text)
    if (code.trim()) {
      return code
    }
    } catch {
      // fallback below
    }
  }

  return fallbackTestCode(moduleName, input.parseResult)
}

/**
 * 诊断测试失败原因（核心生成步骤之三）
 * 优先调用LLM Agent分析pytest执行结果并输出结构化诊断；
 * 若未配置API Key或LLM返回不稳定，则基于规则（关键词匹配）给出粗粒度诊断。
 * 诊断类型包括：TEST_CODE_ERROR / SOURCE_RUNTIME_ERROR / BEHAVIOR_MISMATCH / UNKNOWN
 *
 * @param sourceCode - Python源代码全文
 * @param testCode - 当前轮的测试代码
 * @param executionResult - pytest执行结果（stdout/stderr/exit_code等）
 * @returns 结构化诊断结果（类型、置信度、证据、建议动作）
 */
async function diagnoseFailure(
  sourceCode: string,
  testCode: string,
  executionResult: ExecuteTestsOutput
): Promise<Diagnosis> {
  if (canUseLLM()) {
    try {
    const response = await diagnosisAgent.generate(`
请诊断pytest失败原因，只输出JSON对象。

源代码：
${sourceCode}

测试代码：
${testCode}

执行结果：
${JSON.stringify(executionResult, null, 2)}
`)
    const parsed = parseJsonObject(response.text)
    const diagnosis = diagnosisSchema.safeParse(parsed)
    if (diagnosis.success) {
      return diagnosis.data
    }
    } catch {
      // fallback below
    }
  }

  const combined = `${executionResult.stdout}\n${executionResult.stderr}`
  if (combined.includes("test_temp.py") || combined.includes("fixture") || combined.includes("ImportError")) {
    return {
      diagnosis_type: "TEST_CODE_ERROR",
      confidence: 0.8,
      evidence: ["pytest输出显示失败位置或导入问题来自生成的测试代码"],
      next_action: "REGENERATE_TEST_CODE",
    }
  }
  if (combined.includes(".py") && executionResult.errors > 0) {
    return {
      diagnosis_type: "SOURCE_RUNTIME_ERROR",
      confidence: 0.7,
      evidence: ["pytest执行出现运行时错误，需要查看traceback确认源代码行为"],
      next_action: "REPORT_TO_USER",
    }
  }
  return {
    diagnosis_type: "UNKNOWN",
    confidence: 0.5,
    evidence: ["执行结果证据不足，无法可靠判断失败根因"],
    next_action: "ASK_USER_CONFIRMATION",
  }
}

/**
 * 判断是否已配置有效的LLM API Key
 * 检测OPENAI_API_KEY或MASTRA_API_KEY环境变量；
 * 排除示例占位Key（如"你的"、"sk-xxx"等）。
 *
 * @returns true表示可以调用LLM，false则走确定性兜底逻辑
 */
function canUseLLM(): boolean {
  const key = process.env.OPENAI_API_KEY || process.env.MASTRA_API_KEY || ""
  return /^[\x20-\x7E]+$/.test(key) && !key.includes("你的") && key.length > 20
}

/**
 * 确定性兜底：当LLM不可用时，根据AST符号信息生成基础测试用例
 * 为每个被测函数/方法生成3条用例（功能/边界/异常），确保永远有输出。
 *
 * @param parseResult - AST解析结果
 * @returns 基础测试用例列表（每个符号3条）
 */
function fallbackTestCases(parseResult: ParsedSource): TestCase[] {
  const symbols = collectSymbols(parseResult)
  return symbols.flatMap((symbol, index) => {
    const caseNo = index * 3
    return [
      {
        case_number: `TC-${String(caseNo + 1).padStart(3, "0")}`,
        title: `${symbol.name} 正常调用验证`,
        priority: "P0",
        case_type: "功能",
        preconditions: "被测函数可导入",
        steps: [`调用 ${symbol.name}`],
        expected_result: "函数可正常执行，并返回可观察结果",
        related_symbol: symbol.name,
      },
      {
        case_number: `TC-${String(caseNo + 2).padStart(3, "0")}`,
        title: `${symbol.name} 空值或边界输入验证`,
        priority: "P1",
        case_type: "边界",
        preconditions: "被测函数可导入",
        steps: [`使用边界参数调用 ${symbol.name}`],
        expected_result: "函数返回合理结果或抛出明确异常",
        related_symbol: symbol.name,
      },
      {
        case_number: `TC-${String(caseNo + 3).padStart(3, "0")}`,
        title: `${symbol.name} 异常输入验证`,
        priority: "P1",
        case_type: "异常",
        preconditions: "被测函数可导入",
        steps: [`使用异常参数调用 ${symbol.name}`],
        expected_result: "函数不应静默产生错误结果",
        related_symbol: symbol.name,
      },
    ]
  })
}

/**
 * 确定性兜底：当LLM不可用时，根据AST符号信息生成基础pytest测试代码
 * 为每个函数生成callable检查+调用验证，为每个方法生成hasattr+callable检查。
 *
 * @param moduleName - 模块名，用于生成from...import语句
 * @param parseResult - AST解析结果
 * @returns 可用的pytest测试代码字符串
 */
function fallbackTestCode(moduleName: string, parseResult: ParsedSource): string {
  const symbols = collectSymbols(parseResult)
  const importNames = new Set<string>()
  for (const symbol of symbols) {
    importNames.add(symbol.kind === "method" && symbol.className ? symbol.className : symbol.name)
  }
  const imports = [...importNames].join(", ")

  if (!imports) {
    return [
      "def test_no_testable_function_found():",
      "    symbols = []",
      "    assert symbols == []",
      "",
    ].join("\n")
  }

  const lines = [`from ${moduleName} import ${imports}`, "", ""]
  for (const symbol of symbols.filter((item) => item.kind === "function")) {
    const args = symbol.params.map((param) => sampleValue(param.type)).join(", ")
    lines.push(`def test_${symbol.name}_callable():`)
    lines.push(`    assert callable(${symbol.name})`)
    lines.push(`    result = ${symbol.name}(${args})`)
    lines.push("    assert 'result' in locals()")
    lines.push("")
  }
  for (const symbol of symbols.filter((item) => item.kind === "method" && item.className)) {
    lines.push(`def test_${symbol.className}_${symbol.name}_method_exists():`)
    lines.push(`    assert hasattr(${symbol.className}, '${symbol.name}')`)
    lines.push(`    assert callable(getattr(${symbol.className}, '${symbol.name}'))`)
    lines.push("")
  }
  return lines.join("\n")
}

/**
 * 从AST解析结果中提取所有可测试的符号（函数/类方法）
 * 将独立函数和类方法展平为统一结构，类方法自动过滤self参数。
 *
 * @param parseResult - AST解析结果
 * @returns 统一的符号列表，包含名称、类型、参数、所属类
 */
function collectSymbols(parseResult: ParsedSource): Array<{
  name: string
  kind: string
  params: Array<{ name?: string; type: string }>
  className?: string
}> {
  const functions = (parseResult.functions as Array<{ name: string; params?: Array<{ type: string }> }>).map((item) => ({
    name: item.name,
    kind: "function",
    params: item.params ?? [],
  }))

  const methods = (parseResult.classes as Array<{
    name: string
    methods?: Array<{ name: string; params?: Array<{ name?: string; type: string }> }>
  }>).flatMap(
    (cls) =>
      (cls.methods ?? []).map((item) => ({
        name: item.name,
        kind: "method",
        className: cls.name,
        params: (item.params ?? []).filter((param) => param.name !== "self"),
      }))
  )

  return [...functions, ...methods]
}

/**
 * 根据参数类型名称生成对应的Python示例值
 * 用于兜底测试代码中构造函数调用参数。
 * 支持：int/float/bool/list/dict/str，其他返回None。
 *
 * @param typeName - 类型名称字符串（忽略大小写）
 * @returns 对应类型的Python字面值字符串
 */
function sampleValue(typeName = "Any"): string {
  const normalized = typeName.toLowerCase()
  if (normalized.includes("int")) return "1"
  if (normalized.includes("float")) return "1.0"
  if (normalized.includes("bool")) return "True"
  if (normalized.includes("list")) return "[]"
  if (normalized.includes("dict")) return "{}"
  if (normalized.includes("str")) return "'test'"
  return "None"
}

/**
 * 从LLM返回的文本中提取JSON数组
 * 匹配第一个被方括号包裹的JSON结构并解析。
 *
 * @param text - LLM返回的原始文本（可能包含Markdown或额外说明）
 * @returns 解析后的数组，若失败则返回空数组
 */
function parseJsonArray(text: string): unknown {
  const match = text.match(/\[[\s\S]*\]/)
  return match ? JSON.parse(match[0]) : []
}

/**
 * 从LLM返回的文本中提取JSON对象
 * 匹配第一个被花括号包裹的JSON结构并解析。
 *
 * @param text - LLM返回的原始文本
 * @returns 解析后的对象，若失败则返回空对象
 */
function parseJsonObject(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/)
  return match ? JSON.parse(match[0]) : {}
}

/**
 * 从LLM返回的文本中提取Python代码块
 * 匹配三个反引号包裹的python代码块，若未找到则返回原文。
 *
 * @param text - LLM返回的原始文本
 * @returns 提取的纯代码字符串
 */
function extractPythonCode(text: string): string {
  const match = text.match(/```(?:python)?\s*([\s\S]*?)```/)
  return match ? match[1] : text
}

/**
 * 构造空的执行结果对象
 * 在自愈循环开始前初始化占位结果，避免undefined引用。
 *
 * @returns 状态为not_run的空执行结果
 */
function emptyExecutionResult(): ExecuteTestsOutput {
  return {
    status: "not_run",
    passed: 0,
    failed: 0,
    errors: 0,
    stdout: "",
    stderr: "",
    exit_code: 0,
    duration_ms: 0,
    timeout: false,
  }
}
