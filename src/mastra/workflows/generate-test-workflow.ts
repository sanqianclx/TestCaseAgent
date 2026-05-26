import { copyFileSync, mkdirSync } from "fs"
import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"
import path from "path"
import { readPythonFile } from "../tools/read-file-tool.js"
import { parseSourceCode, type ParsedSource } from "../tools/parse-source-code-tool.js"
import { executePytest, type ExecuteTestsOutput } from "../tools/execute-tests-tool.js"
import { exportCases } from "../tools/export-cases-tool.js"
import { checkTestQuality, type QualityCheckResult } from "../tools/check-quality-tool.js"
import { testCaseAgent } from "../agents/test-case-agent.js"
import { testCodeAgent, testCodeAgentPro } from "../agents/test-code-agent.js"
import { diagnosisAgent, diagnosisAgentPro } from "../agents/diagnosis-agent.js"

const testCaseSchema = z.object({
  case_number: z.string(),
  title: z.string(),
  case_type: z.string(),
  preconditions: z.string(),
  steps: z.union([z.string(), z.array(z.string())]),
  input_params: z.record(z.unknown()).optional().describe("条用例的输入参数，键名为形参名，值为测试输入值"),
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

const testCodeVersionSchema = z.object({
  version_no: z.number(),
  attempt: z.number(),
  test_code: z.string(),
  execution_result: z.any().optional(),
  quality: z.any().optional(),
  diagnosis: diagnosisSchema.optional(),
  note: z.string().optional(),
  created_at: z.string(),
})

type TestCodeVersion = z.infer<typeof testCodeVersionSchema>

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
  quality: z.any().optional(),
  versions: z.array(testCodeVersionSchema).optional(),
})

/* ================================================================
 * 逐步递进的 Schema 定义
 * ================================================================ */

/** Step 1：源码 + AST */
const step1OutputSchema = workflowInputSchema.extend({
  source_file: z.string(),
  source_code: z.string(),
  filename: z.string(),
  parsed: z.any(),
})

/** Step 2：+ 测试用例 */
const step2OutputSchema = step1OutputSchema.extend({
  test_cases: z.array(testCaseSchema),
})

/** Step 3：+ 生成的首版测试代码 + 当前尝试次数 */
const step3OutputSchema = step2OutputSchema.extend({
  test_code: z.string(),
  attempt: z.number().default(1),
})

/** Step 4：+ pytest 执行结果 */
const step4OutputSchema = step3OutputSchema.extend({
  execution_result: z.any(),
})

/** Step 5：自愈后输出中间结构，携带 output_dir 和 test_cases 供导出步骤使用 */
const step5OutputSchema = workflowOutputSchema.extend({
  output_dir: z.string(),
  test_cases: z.array(testCaseSchema),
})

/* ================================================================
 * Step 1: 读取源代码 & AST 解析
 * ================================================================ */
const readParseStep = createStep({
  id: "read-parse-source",
  inputSchema: workflowInputSchema,
  outputSchema: step1OutputSchema,
  execute: async ({ inputData }) => {
    const source = await readPythonFile({ path: inputData.file_path, encoding: "utf-8" })
    const parseResult = parseSourceCode({
      source_code: source.content,
      filename: source.filename,
    })

    return {
      file_path: inputData.file_path,
      output_dir: path.resolve(inputData.output_dir),
      max_attempts: inputData.max_attempts,
      requirements_text: inputData.requirements_text,
      source_file: source.file_path,
      source_code: source.content,
      filename: source.filename,
      parsed: parseResult,
    }
  },
})

/* ================================================================
 * Step 2: 设计测试用例
 * ================================================================ */
const designCasesStep = createStep({
  id: "design-test-cases",
  inputSchema: step1OutputSchema,
  outputSchema: step2OutputSchema,
  execute: async ({ inputData }) => {
    const testCases = await generateTestCases(
      inputData.source_code,
      inputData.parsed,
      inputData.requirements_text
    )

    return {
      file_path: inputData.file_path,
      output_dir: inputData.output_dir,
      max_attempts: inputData.max_attempts,
      requirements_text: inputData.requirements_text,
      source_file: inputData.source_file,
      source_code: inputData.source_code,
      filename: inputData.filename,
      parsed: inputData.parsed,
      test_cases: testCases,
    }
  },
})

/* ================================================================
 * Step 3: 导出测试用例预案
 * 生成测试代码与执行测试的耗时不可控（LLM调用 + pytest超时），
 * 而测试用例本身在 Step 2 完成后已是稳定的交付物。
 * 此步骤在进入代码生成前立即将测试用例落盘，确保：
 *   1. 即使后续步骤失败，用户已拥有可查阅的测试用例文档
 *   2. 用户无需等待全流程结束即可预览用例计划
 *
 * 导出耗时 < 100ms（纯文件 I/O），不显著影响主流程。
 * ================================================================ */
const exportCasesPlanStep = createStep({
  id: "export-cases-plan",
  inputSchema: step2OutputSchema,
  outputSchema: step2OutputSchema,
  execute: async ({ inputData }) => {
    exportCases({
      test_cases: inputData.test_cases,
      test_code: "",
      output_dir: path.resolve(inputData.output_dir),
      execution_result: undefined,
      diagnosis: undefined,
      quality: undefined,
      versions: undefined,
      artifact_prefix: "plan",
      skip_py: true,
    })

    return {
      file_path: inputData.file_path,
      output_dir: inputData.output_dir,
      max_attempts: inputData.max_attempts,
      requirements_text: inputData.requirements_text,
      source_file: inputData.source_file,
      source_code: inputData.source_code,
      filename: inputData.filename,
      parsed: inputData.parsed,
      test_cases: inputData.test_cases,
    }
  },
})

/* ================================================================
 * Step 4: 生成测试代码（首次，使用 deepseek-chat 快速生成）
 * 纯 LLM 调用，不涉及执行或诊断，返回生成的首版 pytest 代码。
 * ================================================================ */
const generateCodeStep = createStep({
  id: "generate-test-code",
  inputSchema: step2OutputSchema,
  outputSchema: step3OutputSchema,
  execute: async ({ inputData }) => {
    const testCode = await generateTestCode({
      sourceCode: inputData.source_code,
      filename: inputData.filename,
      parseResult: inputData.parsed,
      testCases: inputData.test_cases,
      attempt: 1,
      previousDiagnosis: undefined,
      outputDir: inputData.output_dir,
    })

    return {
      file_path: inputData.file_path,
      output_dir: inputData.output_dir,
      max_attempts: inputData.max_attempts,
      requirements_text: inputData.requirements_text,
      source_file: inputData.source_file,
      source_code: inputData.source_code,
      filename: inputData.filename,
      parsed: inputData.parsed,
      test_cases: inputData.test_cases,
      test_code: testCode,
      attempt: 1,
    }
  },
})

/* ================================================================
 * Step 5: 执行 pytest & 质量检查
 * 纯 Python 运行时调用，无 LLM 依赖。执行快（~3-5秒），
 * 失败时进入下一步自愈修复。
 * ================================================================ */
const executeVerifyStep = createStep({
  id: "execute-verify",
  inputSchema: step3OutputSchema,
  outputSchema: step4OutputSchema,
  execute: async ({ inputData }) => {
    const executionResult = executePytest({
      test_code: inputData.test_code,
      source_code: inputData.source_code,
      filename: runtimeFilename(inputData.filename),
      timeout: 60,
    })

    return {
      file_path: inputData.file_path,
      output_dir: inputData.output_dir,
      max_attempts: inputData.max_attempts,
      requirements_text: inputData.requirements_text,
      source_file: inputData.source_file,
      source_code: inputData.source_code,
      filename: inputData.filename,
      parsed: inputData.parsed,
      test_cases: inputData.test_cases,
      test_code: inputData.test_code,
      attempt: inputData.attempt,
      execution_result: executionResult,
    }
  },
})

/* ================================================================
 * Step 6: 自愈修复
 * 仅在上一步失败时执行。先诊断失败原因，再用 v4-pro 深度推理
 * 重新生成代码 → 再执行，最多重试 max_attempts-1 次。
 * 首次诊断用 chat 快速判断，若仍不明确则换 v4-pro 深度诊断。
 * ================================================================ */
const selfHealingStep = createStep({
  id: "self-healing",
  inputSchema: step4OutputSchema,
  outputSchema: step5OutputSchema,
  execute: async ({ inputData }) => {
    let testCode = inputData.test_code
    let executionResult = inputData.execution_result
    let diagnosis: Diagnosis | undefined

    let quality = checkTestQuality({ test_code: inputData.test_code })
    const versions: TestCodeVersion[] = [
      createVersionRecord({
        versionNo: 1,
        attempt: inputData.attempt,
        testCode,
        executionResult,
        quality,
        note: "首次生成",
      }),
    ]

    const passed =
      executionResult.status === "passed" &&
      executionResult.failed === 0 &&
      executionResult.errors === 0 &&
      quality.ok

    if (passed) {
      return finalizeOutput(inputData, testCode, executionResult, undefined, quality, versions)
    }

    for (let attempt = 2; attempt <= inputData.max_attempts; attempt += 1) {
      diagnosis = isExecutionPassed(executionResult) && !quality.ok
        ? qualityFailureDiagnosis(quality)
        : await diagnoseFailure(
          inputData.source_code,
          testCode,
          executionResult,
          attempt,
          quality.ok ? undefined : quality.issues
        )

      versions[versions.length - 1] = {
        ...versions[versions.length - 1],
        diagnosis,
      }

      if (
        diagnosis.diagnosis_type !== "TEST_CODE_ERROR" ||
        diagnosis.confidence < 0.7
      ) {
        return finalizeOutput(inputData, testCode, executionResult, diagnosis, quality, versions)
      }

      testCode = await generateTestCode({
        sourceCode: inputData.source_code,
        filename: inputData.filename,
        parseResult: inputData.parsed,
        testCases: inputData.test_cases,
        attempt,
        previousDiagnosis: diagnosis,
        outputDir: inputData.output_dir,
      })

      executionResult = executePytest({
        test_code: testCode,
        source_code: inputData.source_code,
        filename: runtimeFilename(inputData.filename),
        timeout: 60,
      })

      quality = checkTestQuality({ test_code: testCode })
      versions.push(createVersionRecord({
        versionNo: versions.length + 1,
        attempt,
        testCode,
        executionResult,
        quality,
        note: "自愈重生成",
      }))

      if (
        executionResult.status === "passed" &&
        executionResult.failed === 0 &&
        executionResult.errors === 0 &&
        quality.ok
      ) {
        diagnosis = undefined
        return finalizeOutput(inputData, testCode, executionResult, undefined, quality, versions)
      }
    }

    return finalizeOutput(inputData, testCode, executionResult, diagnosis, quality, versions)
  },
})

/* ================================================================
 * Step 7: 导出最终完整结果
 * 将最终的测试代码、用例和执行结果导出为 .py / .md，
 * 同时将源代码文件复制到输出目录，便于用户直接运行 pytest。
 * ================================================================ */
const exportResultsStep = createStep({
  id: "export-results",
  inputSchema: step5OutputSchema,
  outputSchema: workflowOutputSchema,
  execute: async ({ inputData }) => {
    const resolvedOutputDir = path.resolve(inputData.output_dir)

    const exportResult = exportCases({
      test_cases: inputData.test_cases,
      test_code: inputData.test_code,
      output_dir: resolvedOutputDir,
      execution_result: inputData.execution_detail,
      diagnosis: inputData.diagnosis,
      quality: inputData.quality,
      versions: inputData.versions,
    })

    /* 将源代码复制到输出目录，方便用户直接 cd 进去跑 pytest */
    try {
      mkdirSync(resolvedOutputDir, { recursive: true })
      const sourceFilename = path.basename(inputData.source_file)
      copyFileSync(inputData.source_file, path.join(resolvedOutputDir, sourceFilename))
    } catch (copyErr) {
      console.error("[export-results] 复制源文件失败:", copyErr)
    }

    return {
      source_file: inputData.source_file,
      test_code: inputData.test_code,
      test_cases_count: inputData.test_cases_count,
      passed: inputData.passed,
      exported_files: exportResult.exported_files,
      execution_detail: inputData.execution_detail,
      diagnosis: inputData.diagnosis,
      quality: inputData.quality,
      versions: inputData.versions,
    }
  },
})

/* ================================================================
 * 工作流串联
 * 读解析 → 设用例 → 导出预案 → 生成代码 → 执行验证 → 自愈修复 → 导出最终结果
 * ================================================================ */
export const generateTestWorkflow = createWorkflow({
  id: "generate-test-workflow",
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
})
  .then(readParseStep)
  .then(designCasesStep)
  .then(exportCasesPlanStep)
  .then(generateCodeStep)
  .then(executeVerifyStep)
  .then(selfHealingStep)
  .then(exportResultsStep)
  .commit()

/* ================================================================
 * 辅助函数
 * ================================================================ */

/**
 * 将中间状态转换为工作流最终输出结构
 * 提取 runPayload 中累积的字段，统一计算 passed 标记。
 */
function finalizeOutput(
  runPayload: {
    source_file: string
    output_dir: string
    test_cases: TestCase[]
    diagnosis?: Diagnosis
  },
  finalTestCode: string,
  finalExec: ExecuteTestsOutput,
  finalDiagnosis?: Diagnosis,
  finalQuality?: QualityCheckResult,
  versions: TestCodeVersion[] = []
) {
  const passed =
    finalExec.status === "passed" &&
    finalExec.failed === 0 &&
    finalExec.errors === 0 &&
    finalQuality?.ok !== false

  return {
    source_file: runPayload.source_file,
    test_code: finalTestCode,
    test_cases_count: runPayload.test_cases.length,
    passed,
    exported_files: [],
    execution_detail: finalExec,
    diagnosis: finalDiagnosis,
    quality: finalQuality,
    versions,
    output_dir: runPayload.output_dir,
    test_cases: runPayload.test_cases,
  }
}

function createVersionRecord(input: {
  versionNo: number
  attempt: number
  testCode: string
  executionResult?: ExecuteTestsOutput
  quality?: QualityCheckResult
  diagnosis?: Diagnosis
  note?: string
}): TestCodeVersion {
  return {
    version_no: input.versionNo,
    attempt: input.attempt,
    test_code: input.testCode,
    execution_result: input.executionResult,
    quality: input.quality,
    diagnosis: input.diagnosis,
    note: input.note,
    created_at: new Date().toISOString(),
  }
}

function isExecutionPassed(executionResult: ExecuteTestsOutput): boolean {
  return (
    executionResult.status === "passed" &&
    executionResult.failed === 0 &&
    executionResult.errors === 0
  )
}

function qualityFailureDiagnosis(quality: QualityCheckResult): Diagnosis {
  return {
    diagnosis_type: "TEST_CODE_ERROR",
    confidence: 0.86,
    evidence: [
      "pytest已经通过，但静态质量检查未通过，说明测试代码可能存在弱断言或空测试",
      ...quality.issues,
    ],
    next_action: "REGENERATE_TEST_CODE",
  }
}

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
请分析下面的Python源码和AST解析结果，为每个函数/方法设计针对性的测试用例。

必须输出纯JSON数组，不要任何Markdown标记、不要代码块、不要额外解释。

每一条测试用例的JSON格式如下：
{
  "case_number": "TC-001",
  "title": "用一句话描述这个测试验证什么（如"传入正常参数应返回正确和"或"除数为0时应抛出ZeroDivisionError"）",
  "case_type": "功能/边界/异常",
  "preconditions": "测试执行的前提条件（如"被测函数可导入"或"被测类已实例化"）",
  "steps": ["具体的测试步骤1", "步骤2"],
  "input_params": {"a": 3, "b": 5},
  "expected_result": "具体的预期结果，必须包含具体数值或异常信息。例如：'返回 8' 或 '抛出 ZeroDivisionError'",
  "related_symbol": "被测的函数名或类名"
}

设计策略（非常重要）：
- 仔细阅读每个函数的 docstring 和参数类型，生成贴合实际逻辑的用例
- 例如 divide_zero(a,b) 应该设计"b=0时抛出ZeroDivisionError"的异常用例，而不是笼统的"异常输入验证"
- 例如 faulty_logic 的 docstring 说>=60返回"通过"，应设计"score=60时返回'通过'"的功能用例
- 每个函数/方法至少3条用例，复杂函数可适当增加
- 用例之间要有区分度，不要三件套模板

需求文本：
${requirementsText || "无"}

源码：
${sourceCode}

AST：
${JSON.stringify(parseResult, null, 2)}
`)
      console.error("[generateTestCases] LLM raw response length:", response.text?.length ?? 0)
      const parsed = parseJsonArray(response.text)
      if (!parsed || !Array.isArray(parsed) || parsed.length === 0) {
        console.error("[generateTestCases] parseJsonArray failed or empty, raw:", response.text?.slice(0, 200))
        return fallbackTestCases(parseResult)
      }
      const casesResult = z.array(testCaseSchema).safeParse(parsed)
      if (casesResult.success && casesResult.data.length > 0) {
        return casesResult.data
      }
      console.error("[generateTestCases] zod validation failed:", JSON.stringify(casesResult.error?.issues?.slice(0, 5)))
      // Zod 校验失败时，逐条保留合法的用例
      const validCases: TestCase[] = []
      for (const item of parsed) {
        if (typeof item === "object" && item !== null) {
          const single = testCaseSchema.safeParse(item)
          if (single.success) validCases.push(single.data)
        }
      }
      if (validCases.length > 0) return validCases
    } catch (err) {
      console.error("[generateTestCases] exception:", err)
      // 没有配置LLM或LLM返回不稳定时，使用确定性兜底用例。
    }
  }

  return fallbackTestCases(parseResult)
}

/**
 * 生成pytest测试代码（核心生成步骤之二）
 * 首次用 deepseek-chat 快速生成，重试时换用 deepseek-v4-pro 深度推理。
 * 每次重试传入上一次的诊断信息帮助精准修复。
 *
 * @param input.sourceCode - Python源代码全文
 * @param input.filename - 源文件名，用于生成import语句
 * @param input.parseResult - AST解析结果
 * @param input.testCases - 已生成的测试用例列表
 * @param input.attempt - 当前尝试次数（1=chat, >1=v4-pro）
 * @param input.previousDiagnosis - 上一轮失败诊断（重试时传入）
 * @param input.outputDir - 用户指定的输出目录，Agent 调用 exportCasesTool 时需使用此路径
 * @returns 完整的pytest测试代码字符串
 */
async function generateTestCode(input: {
  sourceCode: string
  filename: string
  parseResult: ParsedSource
  testCases: TestCase[]
  attempt: number
  previousDiagnosis?: Diagnosis
  outputDir: string
}): Promise<string> {
  const moduleName = toPythonModuleName(input.filename)

  if (canUseLLM()) {
    try {
      const agent = input.attempt > 1 ? testCodeAgentPro : testCodeAgent
      const response = await agent.generate(`
请为下面Python源码生成可执行pytest测试代码。只输出一个python代码块。

输出目录：${path.resolve(input.outputDir)}

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
5. 若需调用 exportCasesTool 导出结果，output_dir 必须使用"${path.resolve(input.outputDir)}"。
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
 * 首次用 chat 快速诊断，重试时换用 v4-pro 深度推理。
 * 质量检查问题作为附加上下文传入 LLM，辅助判断失败根因，
 * 避免因弱断言等质量问题误杀实际是源代码 Bug 的情况。
 *
 * @param sourceCode - Python源代码全文
 * @param testCode - 当前轮的测试代码
 * @param executionResult - pytest执行结果（stdout/stderr/exit_code等）
 * @param attempt - 当前尝试次数，>1 时启用 v4-pro 深度推理模式
 * @param qualityIssues - 可选的质量检查问题列表，作为诊断辅助上下文
 * @returns 结构化诊断结果（类型、置信度、证据、建议动作）
 */
async function diagnoseFailure(
  sourceCode: string,
  testCode: string,
  executionResult: ExecuteTestsOutput,
  attempt: number,
  qualityIssues?: string[]
): Promise<Diagnosis> {
  if (canUseLLM()) {
    try {
      const agent = attempt > 1 ? diagnosisAgentPro : diagnosisAgent
      const qualityCtx = qualityIssues?.length
        ? `\n质量检查发现问题（仅作参考，不代表根因就是测试代码错误）：\n${qualityIssues.join("\n")}`
        : ""
      const response = await agent.generate(`
请诊断pytest失败原因，只输出JSON对象。

重要提示：质量检查发现的问题不代表一定就是测试代码的错误。请仔细分析 traceback 和退出码，判断失败的真实根因——是源代码的 bug、运行时异常，还是测试代码确实写错了。

源代码：
${sourceCode}

测试代码：
${testCode}

执行结果：
${JSON.stringify(executionResult, null, 2)}
${qualityCtx}
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
  if (executionResult.timeout) {
    return {
      diagnosis_type: "UNKNOWN",
      confidence: 0.6,
      evidence: ["pytest执行超时，可能是源代码死循环、测试输入不当或环境阻塞"],
      next_action: "ASK_USER_CONFIRMATION",
    }
  }

  if (
    /fixture .* not found/i.test(combined) ||
    /ImportError|ModuleNotFoundError/.test(combined) ||
    (/NameError/.test(combined) && combined.includes("test_temp.py")) ||
    (/SyntaxError/.test(combined) && combined.includes("test_temp.py"))
  ) {
    return {
      diagnosis_type: "TEST_CODE_ERROR",
      confidence: 0.82,
      evidence: ["pytest输出显示导入、fixture、名称或语法问题来自生成的测试代码"],
      next_action: "REGENERATE_TEST_CODE",
    }
  }

  if (/AssertionError|E\s+assert\b/.test(combined) || executionResult.failed > 0) {
    return {
      diagnosis_type: "BEHAVIOR_MISMATCH",
      confidence: 0.66,
      evidence: ["pytest断言失败，说明实际行为与测试预期不一致，需要结合需求或docstring确认"],
      next_action: "ASK_USER_CONFIRMATION",
    }
  }

  if (executionResult.errors > 0) {
    return {
      diagnosis_type: "SOURCE_RUNTIME_ERROR",
      confidence: 0.7,
      evidence: ["pytest执行出现运行时错误，需要查看traceback确认是否源代码异常或依赖缺失"],
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
  const key = process.env.OPENAI_API_KEY || process.env.MASTRA_API_KEY || process.env.DEEPSEEK_API_KEY || ""
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
        case_type: "功能",
        preconditions: "被测函数可导入",
        steps: [`调用 ${symbol.name}`],
        input_params: undefined,
        expected_result: "函数可正常执行，并返回可观察结果",
        related_symbol: symbol.name,
      },
      {
        case_number: `TC-${String(caseNo + 2).padStart(3, "0")}`,
        title: `${symbol.name} 边界输入验证`,
        case_type: "边界",
        preconditions: "被测函数可导入",
        steps: [`使用边界参数调用 ${symbol.name}`],
        input_params: undefined,
        expected_result: "函数返回合理结果或抛出明确异常",
        related_symbol: symbol.name,
      },
      {
        case_number: `TC-${String(caseNo + 3).padStart(3, "0")}`,
        title: `${symbol.name} 异常输入验证`,
        case_type: "异常",
        preconditions: "被测函数可导入",
        steps: [`使用异常参数调用 ${symbol.name}`],
        input_params: undefined,
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

function runtimeFilename(filename: string): string {
  return `${toPythonModuleName(filename)}.py`
}

function toPythonModuleName(filename: string): string {
  const baseName = path.basename(filename, ".py")
  const sanitized = baseName.replace(/[^A-Za-z0-9_]/g, "_")
  if (!sanitized) return "source_temp"
  return /^[A-Za-z_]/.test(sanitized) ? sanitized : `m_${sanitized}`
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
 * 兼容多种LLM常见输出格式：纯JSON、Markdown代码块包裹、文字前后缀。
 *
 * @param text - LLM返回的原始文本（可能包含Markdown或额外说明）
 * @returns 解析后的数组，若失败则返回空数组
 */
function parseJsonArray(text: string): unknown {
  // 1. 优先从 ```json ... ``` 代码块提取
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1]) } catch { /* ignore */ }
  }
  // 2. 从第一个 [ 到最后一个 ] 提取
  const firstBracket = text.indexOf("[")
  const lastBracket = text.lastIndexOf("]")
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try { return JSON.parse(text.slice(firstBracket, lastBracket + 1)) } catch { /* ignore */ }
  }
  // 3. 兜底：贪婪正则
  const match = text.match(/\[[\s\S]*\]/)
  try { return match ? JSON.parse(match[0]) : [] } catch { return [] }
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
