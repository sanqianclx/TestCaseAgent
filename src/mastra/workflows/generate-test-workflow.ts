import fs from "fs"
import fsp from "fs/promises"
import path from "path"
import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"
import { diagnosisAgent, diagnosisAgentPro, diagnosisDecisionAgent } from "../agents/diagnosis-agent.js"
import { testCaseAgent } from "../agents/test-case-agent.js"
import { testCodeAgent, testCodeAgentPro } from "../agents/test-code-agent.js"
import { detectLanguage, getLanguageAdapter } from "../languages/registry.js"
import { assertLlmAvailable, formatError } from "../runtime/env.js"
import { logAgentProgress, renderProgressBar, finishProgressBar } from "../runtime/cli-output.js"
import { logger } from "../runtime/logger.js"
import { measureCoverage } from "../tools/coverage-tool.js"
import type {
  Diagnosis,
  CoverageResult,
  ExecutionResult,
  LanguageAdapter,
  QualityResult,
  SourceAnalysis,
  SupportedLanguage,
  TestCase,
  TestCodeVersion,
} from "../languages/types.js"

const supportedLanguageSchema = z.enum(["python", "java", "cpp"])

const testCaseSchema = z.object({
  case_number: z.string(),
  title: z.string(),
  case_type: z.string(),
  preconditions: z.string(),
  steps: z.union([z.string(), z.array(z.string())]),
  input_params: z.record(z.unknown()).optional(),
  expected_result: z.unknown().transform(toText),
  related_symbol: z.string(),
})

const testCaseBatchSchema = z.object({
  cases: z.array(testCaseSchema),
})

const perErrorDiagnosisSchema = z.object({
  id: z.string().optional(),
  failing_test: z.string().optional(),
  related_symbol: z.string().optional(),
  diagnosis_type: z.enum(["TEST_CODE_ERROR", "SOURCE_RUNTIME_ERROR", "BEHAVIOR_MISMATCH", "ENVIRONMENT_ERROR", "UNKNOWN"]),
  summary: z.string(),
  evidence: z.array(z.string()),
  recommendation: z.string(),
})

const diagnosisSchema = z.object({
  diagnosis_type: z.enum(["TEST_CODE_ERROR", "SOURCE_RUNTIME_ERROR", "BEHAVIOR_MISMATCH", "ENVIRONMENT_ERROR", "UNKNOWN"]),
  confidence: z.number(),
  summary: z.string().optional(),
  evidence: z.array(z.string()),
  report_text: z.string().optional(),
  next_action: z.enum(["REGENERATE_TEST_CODE", "ASK_USER_CONFIRMATION", "INSTALL_DEPENDENCY", "REPORT_TO_USER"]),
  suggested_commands: z.array(z.string()).optional(),
  per_error_diagnoses: z.array(perErrorDiagnosisSchema).optional(),
})

const coverageSchema = z.object({
  symbol_coverage: z.number(),
  covered_symbols: z.array(z.string()),
  uncovered_symbols: z.array(z.string()),
  case_type_coverage: z.record(z.number()),
  total_symbols: z.number(),
  total_cases: z.number(),
  line_rate: z.number().default(0),
  branch_rate: z.number().default(0),
  covered_lines: z.number().default(0),
  total_lines: z.number().default(0),
  missing_lines: z.number().default(0),
  coverage_tool: z.string().default("symbol-only"),
})

const executionSchema = z.object({
  status: z.enum(["passed", "failed", "error", "timeout", "not_run"]),
  passed: z.number(),
  failed: z.number(),
  errors: z.number(),
  stdout: z.string(),
  stderr: z.string(),
  exit_code: z.number(),
  duration_ms: z.number(),
  timeout: z.boolean(),
  command: z.string().optional(),
  cwd: z.string().optional(),
  test_results: z.array(z.unknown()).optional(),
  missing_dependencies: z.array(z.string()).optional(),
})

const qualitySchema = z.object({
  ok: z.boolean(),
  issues: z.array(z.string()),
  checked_tests: z.number(),
})

const versionSchema = z.object({
  version_no: z.number(),
  attempt: z.number(),
  test_code: z.string(),
  execution_result: executionSchema.optional(),
  quality: qualitySchema.optional(),
  diagnosis: diagnosisSchema.optional(),
  note: z.string().optional(),
  created_at: z.string(),
})

const workflowInputSchema = z.object({
  file_path: z.string(),
  output_dir: z.string().default("./output/exports"),
  max_attempts: z.number().default(3),
  llm_retries: z.number().default(2),
  requirements_text: z.string().optional(),
  language: z.union([supportedLanguageSchema, z.literal("auto")]).default("auto"),
})

const workflowOutputSchema = z.object({
  source_file: z.string(),
  language: supportedLanguageSchema,
  test_code: z.string(),
  test_cases: z.array(testCaseSchema).optional(),
  analysis: z.any().optional(),
  test_cases_count: z.number(),
  passed: z.boolean(),
  exported_files: z.array(z.string()),
  execution_detail: executionSchema,
  diagnosis: diagnosisSchema.optional(),
  quality: qualitySchema.optional(),
  coverage: coverageSchema.optional(),
  versions: z.array(versionSchema).optional(),
})

const sourceStepOutputSchema = workflowInputSchema.extend({
  source_file: z.string(),
  source_code: z.string(),
  filename: z.string(),
  language: supportedLanguageSchema,
  analysis: z.any(),
})

const casesStepOutputSchema = sourceStepOutputSchema.extend({
  test_cases: z.array(testCaseSchema),
})

const codeStepOutputSchema = casesStepOutputSchema.extend({
  test_code: z.string(),
  attempt: z.number(),
})

const executionStepOutputSchema = codeStepOutputSchema.extend({
  execution_result: executionSchema,
})

const finalStepOutputSchema = workflowOutputSchema.extend({
  output_dir: z.string(),
  test_cases: z.array(testCaseSchema),
  analysis: z.any(),
  coverage: coverageSchema.optional(),
})

const readParseStep = createStep({
  id: "read-parse-source",
  inputSchema: workflowInputSchema,
  outputSchema: sourceStepOutputSchema,
  execute: async ({ inputData }) => {
    logAgentProgress("正在读取源代码并检测语言")
    const sourceFile = path.resolve(inputData.file_path)
    const sourceCode = await fsp.readFile(sourceFile, "utf-8")
    const language = detectLanguage(sourceFile, inputData.language)
    const adapter = getLanguageAdapter(language)
    const filename = path.basename(sourceFile)
    logAgentProgress(`正在使用 ${adapter.displayName} 适配器解析源代码结构`)
    const analysis = adapter.parseSource({ sourceCode, filename, sourceFile })

    return {
      file_path: inputData.file_path,
      output_dir: path.resolve(inputData.output_dir),
      max_attempts: inputData.max_attempts,
      llm_retries: inputData.llm_retries,
      requirements_text: inputData.requirements_text,
      language,
      source_file: sourceFile,
      source_code: sourceCode,
      filename,
      analysis,
    }
  },
})

const designCasesStep = createStep({
  id: "design-test-cases",
  inputSchema: sourceStepOutputSchema,
  outputSchema: casesStepOutputSchema,
  execute: async ({ inputData }) => {
    const adapter = adapterFor(inputData.language)
    logAgentProgress(`正在调用 LLM 测试用例 Agent（${adapter.displayName}）`)
    const testCases = await generateTestCases({
      adapter,
      sourceCode: inputData.source_code,
      sourceFile: inputData.source_file,
      analysis: inputData.analysis as SourceAnalysis,
      requirementsText: inputData.requirements_text,
      llmRetries: inputData.llm_retries,
    })
    return { ...inputData, test_cases: testCases }
  },
})

const exportPlanStep = createStep({
  id: "export-cases-plan",
  inputSchema: casesStepOutputSchema,
  outputSchema: casesStepOutputSchema,
  execute: async ({ inputData }) => {
    const adapter = adapterFor(inputData.language)
    logAgentProgress("正在导出测试用例计划")
    adapter.exportArtifacts({
      testCases: inputData.test_cases,
      testCode: "",
      outputDir: inputData.output_dir,
      sourceFile: inputData.source_file,
      analysis: inputData.analysis as SourceAnalysis,
      artifactPrefix: "plan",
      skipTestCode: true,
    })
    return inputData
  },
})

const generateCodeStep = createStep({
  id: "generate-test-code",
  inputSchema: casesStepOutputSchema,
  outputSchema: codeStepOutputSchema,
  execute: async ({ inputData }) => {
    const adapter = adapterFor(inputData.language)
    logAgentProgress(`正在调用 LLM 测试代码 Agent 生成 ${adapter.testFramework} 测试`)
    const testCode = await generateTestCode({
      adapter,
      sourceCode: inputData.source_code,
      sourceFile: inputData.source_file,
      filename: inputData.filename,
      outputDir: inputData.output_dir,
      analysis: inputData.analysis as SourceAnalysis,
      testCases: inputData.test_cases,
      attempt: 1,
      llmRetries: inputData.llm_retries,
    })
    return { ...inputData, test_code: testCode, attempt: 1 }
  },
})

const executeStep = createStep({
  id: "execute-tests",
  inputSchema: codeStepOutputSchema,
  outputSchema: executionStepOutputSchema,
  execute: async ({ inputData }) => {
    const adapter = adapterFor(inputData.language)
    logAgentProgress(`正在使用 ${adapter.displayName} 适配器执行测试`)
    const executionResult = adapter.executeTests({
      sourceCode: inputData.source_code,
      sourceFile: inputData.source_file,
      filename: inputData.filename,
      testCode: inputData.test_code,
      outputDir: inputData.output_dir,
      timeoutSeconds: 60,
      analysis: inputData.analysis as SourceAnalysis,
    })
    return { ...inputData, execution_result: executionResult }
  },
})

const selfHealingStep = createStep({
  id: "self-healing",
  inputSchema: executionStepOutputSchema,
  outputSchema: finalStepOutputSchema,
  execute: async ({ inputData }) => {
    return await runSelfHealing(inputData, "initial generation")
  },
})

const exportResultsStep = createStep({
  id: "export-results",
  inputSchema: finalStepOutputSchema,
  outputSchema: workflowOutputSchema,
  execute: async ({ inputData }) => {
    const adapter = adapterFor(inputData.language)
    const diagnosis = inputData.diagnosis as Diagnosis | undefined
    if (diagnosis?.next_action === "INSTALL_DEPENDENCY") {
      logAgentProgress("工作流在最终导出前暂停，因为需要环境或依赖操作")
      return {
        source_file: inputData.source_file,
        language: inputData.language,
        test_code: inputData.test_code,
        test_cases: inputData.test_cases,
        analysis: inputData.analysis,
        test_cases_count: inputData.test_cases_count,
        passed: inputData.passed,
        exported_files: [],
        execution_detail: inputData.execution_detail,
        diagnosis: inputData.diagnosis,
        quality: inputData.quality,
        coverage: inputData.coverage,
        versions: inputData.versions,
      }
    }

    logAgentProgress("正在导出最终的测试代码、报告和版本记录")
    const exportResult = adapter.exportArtifacts({
      testCases: inputData.test_cases,
      testCode: inputData.test_code,
      outputDir: inputData.output_dir,
      sourceFile: inputData.source_file,
      executionResult: inputData.execution_detail as ExecutionResult,
      diagnosis,
      quality: inputData.quality as QualityResult | undefined,
      coverage: inputData.coverage as CoverageResult | undefined,
      versions: inputData.versions as TestCodeVersion[] | undefined,
      analysis: inputData.analysis as SourceAnalysis,
    })
    copySourceToOutput(inputData.source_file, inputData.output_dir)
    return {
      source_file: inputData.source_file,
      language: inputData.language,
      test_code: inputData.test_code,
      test_cases: inputData.test_cases,
      analysis: inputData.analysis,
      test_cases_count: inputData.test_cases_count,
      passed: inputData.passed,
      exported_files: unique(exportResult.exported_files),
      execution_detail: inputData.execution_detail,
      diagnosis: inputData.diagnosis,
      quality: inputData.quality,
      coverage: inputData.coverage,
      versions: inputData.versions,
    }
  },
})

export const generateTestWorkflow = createWorkflow({
  id: "generate-test-workflow",
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
})
  .then(readParseStep)
  .then(designCasesStep)
  .then(exportPlanStep)
  .then(generateCodeStep)
  .then(executeStep)
  .then(selfHealingStep)
  .then(exportResultsStep)
  .commit()

export async function resumeGeneratedTests(input: {
  sourceFile: string
  outputDir: string
  language: SupportedLanguage
  testCode: string
  testCases: TestCase[]
  maxAttempts: number
  llmRetries: number
}): Promise<z.infer<typeof workflowOutputSchema>> {
  const adapter = adapterFor(input.language)
  const sourceFile = path.resolve(input.sourceFile)
  const outputDir = path.resolve(input.outputDir)
  logAgentProgress("从已生成的测试代码恢复工作流；跳过源代码解析、测试用例设计和测试代码生成")
  const sourceCode = await fsp.readFile(sourceFile, "utf-8")
  const filename = path.basename(sourceFile)
  const analysis = adapter.parseSource({ sourceCode, filename, sourceFile })
  logAgentProgress(`正在使用 ${adapter.displayName} 适配器重新执行测试`)
  const executionResult = adapter.executeTests({
    sourceCode,
    sourceFile,
    filename,
    testCode: input.testCode,
    outputDir,
    timeoutSeconds: 60,
    analysis,
  })
  const finalData = await runSelfHealing({
    file_path: sourceFile,
    output_dir: outputDir,
    max_attempts: input.maxAttempts,
    llm_retries: input.llmRetries,
    language: input.language,
    source_file: sourceFile,
    source_code: sourceCode,
    filename,
    analysis,
    test_cases: input.testCases,
    test_code: input.testCode,
    attempt: 1,
    execution_result: executionResult,
  }, "resumed generated test code")

  if (finalData.diagnosis?.next_action === "INSTALL_DEPENDENCY") {
    logAgentProgress("工作流在最终导出前仍然暂停，因为仍然需要环境或依赖操作")
    return {
      source_file: sourceFile,
      language: input.language,
      test_code: finalData.test_code,
      test_cases: input.testCases,
      analysis,
      test_cases_count: input.testCases.length,
      passed: false,
      exported_files: [],
      execution_detail: finalData.execution_detail,
      diagnosis: finalData.diagnosis,
      quality: finalData.quality,
      coverage: finalData.coverage,
      versions: finalData.versions,
    }
  }

  logAgentProgress("Exporting final test code, report, and version records")
  const exportResult = adapter.exportArtifacts({
    testCases: input.testCases,
    testCode: finalData.test_code,
    outputDir,
    sourceFile,
    executionResult: finalData.execution_detail as ExecutionResult,
    diagnosis: finalData.diagnosis as Diagnosis | undefined,
    quality: finalData.quality as QualityResult | undefined,
    coverage: finalData.coverage as CoverageResult | undefined,
    versions: finalData.versions as TestCodeVersion[] | undefined,
    analysis,
  })
  copySourceToOutput(sourceFile, outputDir)
  return {
    source_file: sourceFile,
    language: input.language,
    test_code: finalData.test_code,
    test_cases: input.testCases,
    analysis,
    test_cases_count: input.testCases.length,
    passed: finalData.passed,
    exported_files: unique(exportResult.exported_files),
    execution_detail: finalData.execution_detail,
    diagnosis: finalData.diagnosis,
    quality: finalData.quality,
    coverage: finalData.coverage,
    versions: finalData.versions,
  }
}

async function runSelfHealing(
  inputData: z.infer<typeof executionStepOutputSchema>,
  initialNote: string
) {
  const adapter = adapterFor(inputData.language)
  logAgentProgress("正在运行 AI 诊断和自愈决策")
  let testCode = inputData.test_code
  let executionResult = inputData.execution_result as ExecutionResult
  let quality: QualityResult = { ok: true, issues: [], checked_tests: 0 }
  const symbolCoverage = calculateCoverage(inputData.test_cases, inputData.analysis as SourceAnalysis)
  let coverage = symbolCoverage
  let diagnosis: Diagnosis | undefined
  const versions: TestCodeVersion[] = [
    createVersionRecord({
      versionNo: 1,
      attempt: inputData.attempt,
      testCode,
      executionResult,
      quality,
      note: initialNote,
    }),
  ]

  coverage = await measureRealCoverage(inputData, testCode)

  if (isPassed(executionResult, quality)) {
    return finalize(inputData, testCode, executionResult, undefined, quality, coverage, versions)
  }

  for (let attempt = 2; attempt <= inputData.max_attempts; attempt += 1) {
    diagnosis = await diagnoseFailure({
      adapter,
      sourceCode: inputData.source_code,
      testCode,
      testCases: inputData.test_cases,
      executionResult,
      quality,
      analysis: inputData.analysis as SourceAnalysis,
      sourceFile: inputData.source_file,
      attempt,
      llmRetries: inputData.llm_retries,
    })

    // 校正 next_action：LLM 给出的 next_action 经常与 diagnosis_type 不一致（例如把源代码缺陷
    // 归类为 REGENERATE_TEST_CODE）。这里以 diagnosis_type 为准重新映射一次，保证下游 CLI
    // 提示与诊断语义一致。
    diagnosis = reconcileNextAction(diagnosis)
    versions[versions.length - 1] = { ...versions[versions.length - 1], diagnosis }
    if (diagnosis.diagnosis_type !== "TEST_CODE_ERROR" || diagnosis.confidence < 0.7) {
      logAgentProgress(
        `AI 诊断为 ${describeDiagnosisType(diagnosis.diagnosis_type)}（置信度 ${diagnosis.confidence.toFixed(2)}），不是测试代码缺陷，跳过自愈。`
      )
      coverage = await measureRealCoverage(inputData, testCode)
      return finalize(inputData, testCode, executionResult, diagnosis, quality, coverage, versions)
    }

    logAgentProgress(`自愈尝试第 ${attempt} 次：根据 AI 诊断重新生成测试代码`)
    testCode = await generateTestCode({
      adapter,
      sourceCode: inputData.source_code,
      sourceFile: inputData.source_file,
      filename: inputData.filename,
      outputDir: inputData.output_dir,
      analysis: inputData.analysis as SourceAnalysis,
      testCases: inputData.test_cases,
      attempt,
      previousDiagnosis: diagnosis,
      llmRetries: inputData.llm_retries,
    })

    executionResult = adapter.executeTests({
      sourceCode: inputData.source_code,
      sourceFile: inputData.source_file,
      filename: inputData.filename,
      testCode,
      outputDir: inputData.output_dir,
      timeoutSeconds: 60,
      analysis: inputData.analysis as SourceAnalysis,
    })
    quality = { ok: true, issues: [], checked_tests: 0 }
    versions.push(createVersionRecord({
      versionNo: versions.length + 1,
      attempt,
      testCode,
      executionResult,
      quality,
      note: "self-healing regeneration",
    }))

    if (isPassed(executionResult, quality)) {
      coverage = await measureRealCoverage(inputData, testCode)
      return finalize(inputData, testCode, executionResult, undefined, quality, coverage, versions)
    }
  }

  diagnosis ??= await diagnoseFailure({
    adapter,
    sourceCode: inputData.source_code,
    testCode,
    testCases: inputData.test_cases,
    executionResult,
    quality,
    analysis: inputData.analysis as SourceAnalysis,
    sourceFile: inputData.source_file,
    attempt: inputData.max_attempts,
    llmRetries: inputData.llm_retries,
  })
  diagnosis = reconcileNextAction(diagnosis)
  versions[versions.length - 1] = { ...versions[versions.length - 1], diagnosis }
  logAgentProgress(
    `自愈尝试上限（${inputData.max_attempts - 1} 次）已用完，最后一次诊断为 ${describeDiagnosisType(diagnosis.diagnosis_type)}。`
  )
  coverage = await measureRealCoverage(inputData, testCode)
  return finalize(inputData, testCode, executionResult, diagnosis, quality, coverage, versions)
}

async function generateTestCases(input: {
  adapter: LanguageAdapter
  sourceCode: string
  sourceFile: string
  analysis: SourceAnalysis
  requirementsText?: string
  llmRetries: number
}): Promise<TestCase[]> {
  assertLlmAvailable("generate structured test cases")
  try {
    const batches = chunk(input.analysis.symbols, 1)
    const effectiveBatches = batches.length > 0 ? batches : [input.analysis.symbols]
    const allCases: TestCase[] = []
    const requestedCaseLimit = extractRequestedCaseLimit(input.requirementsText)

    for (const [batchIndex, symbols] of effectiveBatches.entries()) {
      if (requestedCaseLimit !== undefined && allCases.length >= requestedCaseLimit) break
      const remainingGlobalLimit = requestedCaseLimit === undefined ? undefined : Math.max(0, requestedCaseLimit - allCases.length)
      const batchAnalysis: SourceAnalysis = { ...input.analysis, symbols }
      renderProgressBar("设计测试用例", batchIndex, effectiveBatches.length)
      const batchCases = await withLlmRetries("测试用例批次 " + (batchIndex + 1) + "/" + effectiveBatches.length, input.llmRetries, async () => {
        const fence = String.fromCharCode(96).repeat(3)
        const prompt = [
          "为列出的每个符号生成具体的单元测试用例。",
          "只返回以下格式的有效 JSON：{ \"cases\": [...] }。",
          "所有字符串使用双引号。不要使用 Markdown。",
          "",
          "规则：",
          "- 每个符号优先包含一个功能用例、边界用例和异常/错误用例（如果适用）。",
          "- 边界值应覆盖 0、空字符串/集合、负值、None/null 和极值（如果相关）。",
          "- 除法/取模代码必须包含除数为零的用例。",
          "- 递归代码必须包含基本情况和无效输入用例。",
          "- 包含 safe 的函数名应在不安全/错误输入下进行测试。",
          "- 生成足够多的用例以达到有意义的覆盖率；不要为了缩短响应而减少覆盖率。",
          "- 使用紧凑的 JSON 和简洁的字符串，以便长批次仍能完整接收。",
          "- 不要因为源代码能运行就假设它是正确的。",
          "- input_params 的键必须与参数名完全匹配。",
          "- expected_result 必须是具体的。",
          "- 保持标题、步骤和 expected_result 简洁，以便 JSON 保持完整。",
          "- 省略可选字段而不是写 null。",
          "- 全局测试用例限制：" + (requestedCaseLimit ?? "无") + "。",
          "- 本批次剩余全局用例限制：" + (remainingGlobalLimit ?? "无") + "。",
          "- 如果没有全局限制，为列出的符号生成所有有用的用例。",
          "",
          "预期的 JSON 示例：",
          JSON.stringify({ cases: [{ case_number: "TC-001", title: "specific title", case_type: "functional|boundary|exception", preconditions: "setup", steps: ["step"], input_params: { param: "value" }, expected_result: "specific expected behavior", related_symbol: "symbol name" }] }, null, 2),
          "",
          "符号上下文：",
          input.adapter.buildGenerationContext({ analysis: batchAnalysis, sourceFile: input.sourceFile }),
          "",
          "额外需求：",
          input.requirementsText ?? "无",
          "",
          "相关源代码：",
          fence + input.adapter.codeFence,
          sourceExcerptForSymbols(input.sourceCode, symbols),
          fence,
        ].join("\n")
        const response = await testCaseAgent.generate(prompt, { modelSettings: { temperature: 0.1, maxOutputTokens: 12000 } })
        logger.info("llm.response", {
          scope: "workflow.generateTestCases",
          stage: `test-case-batch-${batchIndex + 1}-of-${effectiveBatches.length}`,
          text: response.text,
          model: response.response?.model,
          usage: response.usage,
        })
        return await parseTestCaseBatch(response.text, input.llmRetries, prompt)
      })
      const acceptedCases = remainingGlobalLimit === undefined ? batchCases : batchCases.slice(0, remainingGlobalLimit)
      allCases.push(...acceptedCases)
      renderProgressBar("设计测试用例", batchIndex + 1, effectiveBatches.length)
    }
    finishProgressBar()

    if (allCases.length === 0) {
      throw new Error("LLM 未返回任何测试用例。")
    }
    return renumberCases(allCases)
  } catch (error) {
    finishProgressBar()
    throw new Error("LLM 测试用例生成失败，已停止而非使用回退。" + formatError(error))
  }
}

async function generateTestCode(input: {
  adapter: LanguageAdapter
  sourceCode: string
  sourceFile: string
  filename: string
  outputDir: string
  analysis: SourceAnalysis
  testCases: TestCase[]
  attempt: number
  previousDiagnosis?: Diagnosis
  llmRetries: number
}): Promise<string> {
  assertLlmAvailable("generate test code")
  try {
    const agent = input.attempt > 1 ? testCodeAgentPro : testCodeAgent
    return await withLlmRetries("测试代码生成尝试 " + input.attempt, input.llmRetries, async () => {
      const fence = String.fromCharCode(96).repeat(3)
      const prompt = [
        "生成可执行的 " + input.adapter.testFramework + " 单元测试代码。",
        "只返回源代码。不要使用 Markdown 代码块或解释性文字。",
        "",
        "规则：",
        "- 每个测试用例必须映射到一个真实的测试函数，除非用户需求限制了范围。",
        "- 使用真实的断言；不要使用 assert true、assert 1 == 1、空测试或仅 callable/hasattr 检查。",
        "- 对于预期异常，使用该框架的精确断言风格。",
        "- 精确遵循运行时/导入指令。",
        "- 如果之前的诊断指出生成的测试代码有错误，修复该具体问题并且不要重复犯同类错误。",
        "",
        "语言和符号上下文：",
        input.adapter.buildGenerationContext({ analysis: input.analysis, sourceFile: input.sourceFile }),
        "",
        "输出目录：" + path.resolve(input.outputDir),
        "尝试次数：" + input.attempt,
        "之前的 AI 诊断：",
        JSON.stringify(input.previousDiagnosis?.report_text ?? input.previousDiagnosis ?? null, null, 2),
        "",
        "测试用例：",
        JSON.stringify(input.testCases, null, 2),
        "",
        "源代码：",
        fence + input.adapter.codeFence,
        input.sourceCode,
        fence,
      ].join("\n")
      const response = await agent.generate(prompt, { modelSettings: { temperature: 0.1, maxOutputTokens: 8192 } })
      logger.info("llm.response", {
        scope: "workflow.generateTestCode",
        stage: `test-code-attempt-${input.attempt}`,
        text: response.text,
        model: response.response?.model,
        usage: response.usage,
      })
      const code = extractCode(response.text, input.adapter.codeFence)
      if (code.trim()) return code
      throw new Error("LLM 返回了空的测试代码。预览：" + preview(response.text))
    })
  } catch (error) {
    throw new Error("LLM 测试代码生成失败，已停止而非使用回退。" + formatError(error))
  }
}

async function diagnoseFailure(input: {
  adapter: LanguageAdapter
  sourceCode: string
  testCode: string
  testCases: TestCase[]
  executionResult: ExecutionResult
  quality: QualityResult
  analysis: SourceAnalysis
  sourceFile: string
  attempt: number
  llmRetries: number
}): Promise<Diagnosis> {
  assertLlmAvailable("diagnose failed tests")
  try {
    const agent = input.attempt > 1 ? diagnosisAgentPro : diagnosisAgent
    const reportText = await withLlmRetries("失败诊断尝试 " + input.attempt, input.llmRetries, async () => {
      const fence = String.fromCharCode(96).repeat(3)
      const prompt = [
        "你是一名高级单元测试失败诊断 Agent。",
        "阅读源代码、设计的测试用例、生成的测试代码和执行错误输出。",
        "撰写一份直接的自然语言诊断，描述根本原因。",
        "",
        "重要：",
        "- 不要输出 JSON。",
        "- 不要输出分类模板。",
        "- 不要重复完整日志；只在必要时引用关键的报错行。",
        "- 关注失败是揭示了源代码缺陷、生成的测试错误还是环境/运行时问题。",
        "- 如果源代码有缺陷，解释具体的源代码 bug 和预期的正确行为。",
        "- 如果生成的测试有缺陷，精确解释测试代码中什么错了。",
        "- 如果需要环境命令，用纯语言说出该命令。",
        "",
        "语言：" + input.adapter.displayName,
        "测试框架：" + input.adapter.testFramework,
        "运行时操作系统：" + process.platform,
        "尝试次数：" + input.attempt,
        "",
        "源代码/测试上下文：",
        input.adapter.buildGenerationContext({ analysis: input.analysis, sourceFile: input.sourceFile }),
        "",
        "设计的测试用例：",
        JSON.stringify(input.testCases, null, 2),
        "",
        "生成的测试代码：",
        fence + input.adapter.codeFence,
        input.testCode,
        fence,
        "",
        "执行结果和错误：",
        fence + "json",
        JSON.stringify(input.executionResult, null, 2),
        fence,
        "",
        "质量检查结果：",
        fence + "json",
        JSON.stringify(input.quality, null, 2),
        fence,
        "",
        "源代码：",
        fence + input.adapter.codeFence,
        input.sourceCode,
        fence,
      ].join("\n")
      const response = await agent.generate(prompt, { modelSettings: { temperature: 0.1, maxOutputTokens: 8192 } })
      logger.info("llm.response", {
        scope: "workflow.diagnoseFailure",
        stage: `diagnose-attempt-${input.attempt}`,
        text: response.text,
        model: response.response?.model,
        usage: response.usage,
      })
      const text = response.text.trim()
      if (!text) throw new Error("LLM 返回了空的诊断。")
      return text
    })
    const decision = await classifyDiagnosisDecision(reportText, input)
    return { ...decision, report_text: reportText }
  } catch (error) {
    throw new Error("LLM 失败诊断失败，已停止而非使用回退。" + formatError(error))
  }
}

async function classifyDiagnosisDecision(
  reportText: string,
  input: {
    adapter: LanguageAdapter
    executionResult: ExecutionResult
    quality: QualityResult
    analysis: SourceAnalysis
    sourceFile: string
    attempt: number
    llmRetries: number
  }
): Promise<Diagnosis> {
  const prompt = [
    "将此单元测试失败诊断转换为所需的内部 JSON 决策。",
    "只返回有效的 JSON。不要添加 Markdown。",
    "",
    "自然语言诊断：",
    reportText,
    "",
    "执行结果：",
    JSON.stringify(input.executionResult, null, 2),
    "",
    "质量检查结果：",
    JSON.stringify(input.quality, null, 2),
    "",
    "语言：" + input.adapter.displayName,
    "测试框架：" + input.adapter.testFramework,
    "运行时操作系统：" + process.platform,
    "尝试次数：" + input.attempt,
    "源代码/测试上下文：",
    input.adapter.buildGenerationContext({ analysis: input.analysis, sourceFile: input.sourceFile }),
  ].join("\n")

  return await withLlmRetries("失败诊断决策尝试 " + input.attempt, input.llmRetries, async () => {
    const response = await diagnosisDecisionAgent.generate(prompt, {
      modelSettings: { temperature: 0, maxOutputTokens: 2048 },
    })
    const parsed = diagnosisSchema.safeParse(parseJsonValue(response.text))
    if (!parsed.success) {
      throw new Error("无效的诊断决策 JSON：" + parsed.error.message + "。预览：" + preview(response.text))
    }
    return parsed.data as Diagnosis
  })
}

/**
 * 将 LLM 给出的 diagnosis 校正一次，让 next_action 与 diagnosis_type 语义一致。
 *
 * LLM 经常在 next_action 上"偷懒"：无论诊断类型是什么，都倾向于返回 REGENERATE_TEST_CODE。
 * 但语义上：
 * - TEST_CODE_ERROR + 置信度足够 → 重新生成测试代码
 * - SOURCE_RUNTIME_ERROR / BEHAVIOR_MISMATCH → 报告给用户（自愈不会修复源代码）
 * - ENVIRONMENT_ERROR → 建议安装依赖
 * - 其他 / 置信度不足 → 询问用户
 */
function reconcileNextAction(diagnosis: Diagnosis): Diagnosis {
  const type = diagnosis.diagnosis_type
  const confidence = Number(diagnosis.confidence) || 0
  let nextAction: Diagnosis["next_action"]

  if (type === "TEST_CODE_ERROR" && confidence >= 0.7) {
    nextAction = "REGENERATE_TEST_CODE"
  } else if (type === "SOURCE_RUNTIME_ERROR" || type === "BEHAVIOR_MISMATCH") {
    nextAction = "REPORT_TO_USER"
  } else if (type === "ENVIRONMENT_ERROR") {
    nextAction = "INSTALL_DEPENDENCY"
  } else {
    nextAction = "ASK_USER_CONFIRMATION"
  }

  if (nextAction === diagnosis.next_action) return diagnosis
  return { ...diagnosis, next_action: nextAction }
}

/**
 * 给诊断类型起一个中文名，用于在控制台/日志中提示用户。
 */
function describeDiagnosisType(type: Diagnosis["diagnosis_type"]): string {
  switch (type) {
    case "TEST_CODE_ERROR":
      return "测试代码缺陷"
    case "SOURCE_RUNTIME_ERROR":
      return "源代码运行错误"
    case "BEHAVIOR_MISMATCH":
      return "源代码行为与预期不符"
    case "ENVIRONMENT_ERROR":
      return "环境或依赖问题"
    case "UNKNOWN":
    default:
      return "未知原因"
  }
}



function finalize(
  inputData: z.infer<typeof executionStepOutputSchema>,
  testCode: string,
  executionResult: ExecutionResult,
  diagnosis: Diagnosis | undefined,
  quality: QualityResult,
  coverage: CoverageResult,
  versions: TestCodeVersion[]
) {
  return {
    source_file: inputData.source_file,
    language: inputData.language,
    test_code: testCode,
    test_cases_count: inputData.test_cases.length,
    passed: isPassed(executionResult, quality),
    exported_files: [],
    execution_detail: executionResult,
    diagnosis,
    quality,
    coverage,
    versions,
    output_dir: inputData.output_dir,
    test_cases: inputData.test_cases,
    analysis: inputData.analysis,
  }
}

function createVersionRecord(input: {
  versionNo: number
  attempt: number
  testCode: string
  executionResult?: ExecutionResult
  quality?: QualityResult
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

function adapterFor(language: SupportedLanguage): LanguageAdapter {
  return getLanguageAdapter(language)
}

function isPassed(executionResult: ExecutionResult, quality: QualityResult): boolean {
  return executionResult.status === "passed" && executionResult.failed === 0 && executionResult.errors === 0 && quality.ok
}

async function withLlmRetries<T>(
  label: string,
  retries: number,
  task: () => Promise<T>
): Promise<T> {
  const retryCount = Number.isFinite(retries) ? Math.max(0, Math.floor(retries)) : 0
  let remaining = retryCount + 1
  let lastError: unknown

  while (remaining > 0) {
    try {
      return await task()
    } catch (error) {
      lastError = error
      remaining -= 1
      if (remaining > 0) {
        const total = retryCount + 1
        logger.warn("llm.retry", {
          scope: "workflow.withLlmRetries",
          stage: label,
          attempt: total - remaining,
          total_attempts: total,
          error: formatError(error),
        })
        continue
      }
      logger.error("llm.failed", {
        scope: "workflow.withLlmRetries",
        stage: label,
        attempt: retryCount + 1,
        total_attempts: retryCount + 1,
        error: formatError(error),
      })
    }

    if (llmRetriesExhaustedHandler) {
      const additional = await llmRetriesExhaustedHandler(
        label,
        formatError(lastError)
      )
      if (additional > 0) {
        remaining = additional
        continue
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(formatError(lastError))
}

export function setLlmRetriesExhaustedHandler(
  handler: null | ((label: string, errorText: string) => Promise<number>)
): void {
  llmRetriesExhaustedHandler = handler
}

let llmRetriesExhaustedHandler: null | ((label: string, errorText: string) => Promise<number>) = null

async function parseTestCaseBatch(text: string, llmRetries: number, originalPrompt?: string): Promise<TestCase[]> {
  try {
    return validateTestCaseBatch(text)
  } catch (error) {
    if (originalPrompt && isIncompleteJsonError(error)) {
      logAgentProgress("测试用例 JSON 看起来被截断了；请求 LLM 从中断处继续。")
      logger.warn("llm.retry", {
        scope: "workflow.parseTestCaseBatch",
        stage: "json-truncated-continue",
        error: formatError(error),
      })
      try {
        const continued = await continueTestCaseJson(text, originalPrompt, llmRetries)
        return validateTestCaseBatch(continued)
      } catch (continuationError) {
        logAgentProgress("续写未能生成完整的 JSON；回退到 JSON 修复。")
        logger.warn("llm.retry", {
          scope: "workflow.parseTestCaseBatch",
          stage: "json-continue-failed-fallback",
          error: formatError(continuationError),
        })
      }
    }

    logAgentProgress("正在用 LLM 修复无效的测试用例 JSON。")
    logger.warn("llm.retry", {
      scope: "workflow.parseTestCaseBatch",
      stage: "json-repair",
      error: formatError(error),
    })
    return await withLlmRetries("测试用例 JSON 修复", Math.min(llmRetries, 1), async () => {
        const repairPrompt = [
          "之前的响应本应为单元测试用例的 JSON，但无效或不完整。",
          "将其修复为一个紧凑、有效的 JSON 对象。",
          "不要添加 Markdown。不要添加解释。",
          "每个用例必须包含：case_number、title、case_type、preconditions、steps、input_params、expected_result、related_symbol。",
          "如果缺少 preconditions，使用 \"无\"。",
          "如果缺少 steps，从输入参数推断一个简短步骤。",
          "保持原始意图，不要发明无关的符号。",
          "",
          "所需格式：",
          JSON.stringify({ cases: [{ case_number: "TC-001", title: "specific title", case_type: "functional", preconditions: "none", steps: ["call function"], input_params: {}, expected_result: "specific expected behavior", related_symbol: "symbol" }] }, null, 2),
          "",
          "无效或不完整的响应：",
          text,
        ].join("\n")
      const response = await testCaseAgent.generate(repairPrompt, { modelSettings: { temperature: 0, maxOutputTokens: 12000 } })
      logger.info("llm.response", {
        scope: "workflow.repairTestCaseJson",
        stage: "json-repair",
        text: response.text,
        model: response.response?.model,
        usage: response.usage,
      })
      return validateTestCaseBatch(response.text)
    })
  }
}

function validateTestCaseBatch(text: string): TestCase[] {
  const parsed = parseJsonValue(text)
  const result = testCaseBatchSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error("无效的测试用例 JSON：" + formatZodIssues(result.error.issues) + "。预览：" + preview(text))
  }
  if (result.data.cases.length === 0) {
    throw new Error("LLM 返回了空的用例列表。预览：" + preview(text))
  }
  return result.data.cases
}

async function continueTestCaseJson(partialText: string, originalPrompt: string, llmRetries: number): Promise<string> {
  let combined = partialText
  const rounds = Math.max(2, Math.min(6, llmRetries + 3))

  for (let round = 1; round <= rounds; round += 1) {
    const continuation = await withLlmRetries("测试用例 JSON 续写 " + round + "/" + rounds, Math.min(llmRetries, 1), async () => {
      const prompt = [
        "你之前的单元测试 JSON 响应在 JSON 值完成之前被截断了。",
        "从确切的截断点继续，使最终拼接的文本成为一个有效的 JSON 对象。",
        "除非你选择返回整个修正后的 JSON 对象，否则不要从头重新开始。",
        "不要使用 Markdown。不要解释。",
        "",
        "原始任务：",
        originalPrompt,
        "",
        "目前已收到的部分响应：",
        combined,
      ].join("\n")
      const response = await testCaseAgent.generate(prompt, {
        modelSettings: { temperature: 0, maxOutputTokens: 12000 },
      })
      logger.info("llm.response", {
        scope: "workflow.continueTestCaseJson",
        stage: `continuation-round-${round}-of-${rounds}`,
        text: response.text,
        model: response.response?.model,
        usage: response.usage,
      })
      return response.text
    })

    for (const candidate of continuationCandidates(combined, continuation)) {
      try {
        validateTestCaseBatch(candidate)
        return candidate
      } catch {
        // try next candidate
      }
    }

    combined = appendWithOverlap(combined, stripMarkdownFence(continuation))
    try {
      validateTestCaseBatch(combined)
      return combined
    } catch (error) {
      if (!isIncompleteJsonError(error)) throw error
    }
  }

  return combined
}

function continuationCandidates(prefix: string, suffix: string): string[] {
  const cleanSuffix = stripMarkdownFence(suffix)
  return unique([
    appendWithOverlap(prefix, cleanSuffix),
    prefix + cleanSuffix,
    prefix + "\n" + cleanSuffix,
    cleanSuffix,
  ])
}

function stripMarkdownFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  return fenced ? fenced[1] : text
}

function appendWithOverlap(prefix: string, suffix: string): string {
  const max = Math.min(prefix.length, suffix.length, 4000)
  for (let size = max; size > 0; size -= 1) {
    if (prefix.endsWith(suffix.slice(0, size))) {
      return prefix + suffix.slice(size)
    }
  }
  return prefix + suffix
}

function isIncompleteJsonError(error: unknown): boolean {
  return formatError(error).includes("No complete JSON value found")
}

function calculateCoverage(testCases: TestCase[], analysis: SourceAnalysis): CoverageResult {
  const normalizedSymbols = new Map<string, string>()
  for (const symbol of analysis.symbols) {
    const fullName = symbol.className ? symbol.className + "." + symbol.name : symbol.name
    normalizedSymbols.set(normalizeSymbolName(fullName), fullName)
    normalizedSymbols.set(normalizeSymbolName(symbol.name), fullName)
  }

  const covered = new Set<string>()
  const caseTypeCounts: Record<string, number> = {}
  for (const testCase of testCases) {
    const caseType = String(testCase.case_type || "unknown").toLowerCase()
    caseTypeCounts[caseType] = (caseTypeCounts[caseType] ?? 0) + 1
    const related = normalizeSymbolName(testCase.related_symbol)
    const direct = normalizedSymbols.get(related)
    if (direct) {
      covered.add(direct)
      continue
    }
    for (const [normalized, fullName] of normalizedSymbols) {
      if (related && (related.includes(normalized) || normalized.includes(related))) covered.add(fullName)
    }
  }

  const allSymbols = [...new Set([...normalizedSymbols.values()])]
  const uncovered = allSymbols.filter((symbol) => !covered.has(symbol))
  const denominator = allSymbols.length || 1
  return {
    symbol_coverage: round2((covered.size / denominator) * 100),
    covered_symbols: [...covered].sort(),
    uncovered_symbols: uncovered.sort(),
    case_type_coverage: Object.fromEntries(Object.entries(caseTypeCounts).map(([key, value]) => [key, round2((value / Math.max(testCases.length, 1)) * 100)])),
    total_symbols: allSymbols.length,
    total_cases: testCases.length,
    line_rate: 0,
    branch_rate: 0,
    covered_lines: 0,
    total_lines: 0,
    missing_lines: 0,
    coverage_tool: "symbol-only",
  }
}

function normalizeSymbolName(value: string): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9_.:]/g, "").replace(/::/g, ".")
}

/**
 * 运行真实的代码行覆盖率测量
 * Python 用 coverage.py，Java 解析 jacoco.xml，C++ 预留
 */
async function measureRealCoverage(
  inputData: z.infer<typeof executionStepOutputSchema>,
  testCode: string
): Promise<CoverageResult> {
  const base = calculateCoverage(inputData.test_cases, inputData.analysis as SourceAnalysis)
  const lang = inputData.language

  if (lang !== "python" && lang !== "java") {
    return { ...base, coverage_tool: "not-available-for-language" }
  }

  const toolLabel = lang === "python" ? "coverage.py" : "JaCoCo"

  try {
    logAgentProgress("正在测量真实代码覆盖率（" + toolLabel + "）")
    const result = measureCoverage({
      test_code: testCode,
      source_code: inputData.source_code,
      filename: inputData.filename,
      language: lang,
      timeout: 60,
      cwd: (inputData.execution_result as ExecutionResult).cwd,
    })

    if (!result.ok) {
      logAgentProgress("覆盖率测量失败，回退到符号覆盖率。")
      logger.warn("llm.failed", {
        scope: "workflow.measureCoverage",
        stage: "coverage-tool-failed",
        language: lang,
        tool: toolLabel,
        error: result.error?.message ?? "未知错误",
      })
      return { ...base, coverage_tool: "symbol-only (measurement failed)" }
    }

    return {
      ...base,
      line_rate: result.line_rate,
      branch_rate: result.branch_rate,
      covered_lines: result.covered_lines,
      total_lines: result.total_lines,
      missing_lines: result.missing_lines,
      coverage_tool: result.tool,
    }
  } catch (error) {
    logAgentProgress("覆盖率测量异常，回退到符号覆盖率。")
    logger.error("llm.failed", {
      scope: "workflow.measureCoverage",
      stage: "coverage-threw",
      language: lang,
      tool: toolLabel,
      error: formatError(error),
    })
    return { ...base, coverage_tool: "symbol-only (error)" }
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function parseJsonValue(text: string): unknown {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1]) } catch { /* try below */ }
  }

  try {
    return JSON.parse(text)
  } catch {
    // try below
  }

  const objectStart = text.indexOf("{")
  const arrayStart = text.indexOf("[")
  const starts = [objectStart, arrayStart].filter((value) => value >= 0)
  if (starts.length === 0) {
    throw new Error(`在 LLM 响应中未找到 JSON 对象或数组。预览：${preview(text)}`)
  }

  const start = Math.min(...starts)
  const opener = text[start]
  const closer = opener === "{" ? "}" : "]"
  const end = findMatchingJsonEnd(text, start, opener, closer)
  if (end < 0) {
    throw new Error(`在 LLM 响应中未找到完整的 JSON 值。预览：${preview(text)}`)
  }

  return JSON.parse(text.slice(start, end + 1))
}

function findMatchingJsonEnd(text: string, start: number, opener: string, closer: string): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    if (char === "\"") {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === opener) depth += 1
    if (char === closer) depth -= 1
    if (depth === 0) return index
  }
  return -1
}

function extractCode(text: string, fence: string): string {
  const match = text.match(new RegExp(`\`\`\`(?:${fence}|[A-Za-z0-9+#-]+)?\\s*([\\s\\S]*?)\`\`\``))
  return match ? match[1].trim() : text.trim()
}

function preview(text: string, length = 500): string {
  const normalized = text.replace(/\s+/g, " ").trim()
  return normalized.length > length ? `${normalized.slice(0, length)}...` : normalized
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

function renumberCases(testCases: TestCase[]): TestCase[] {
  return testCases.map((testCase, index) => ({
    ...testCase,
    case_number: `TC-${String(index + 1).padStart(3, "0")}`,
  }))
}

function extractRequestedCaseLimit(requirementsText?: string): number | undefined {
  if (!requirementsText) return undefined
  const normalized = requirementsText.trim()
  const arabic = normalized.match(/(?:only|first|top|limit|up to|at most|max|generate|cases?|tests?|unit tests?)[^\d]{0,16}(\d{1,3})/i)
  if (arabic) return clampCaseLimit(Number(arabic[1]))

  const chineseDigits: Record<string, number> = {
    "\u4e00": 1,
    "\u4e8c": 2,
    "\u4e24": 2,
    "\u4e09": 3,
    "\u56db": 4,
    "\u4e94": 5,
    "\u516d": 6,
    "\u4e03": 7,
    "\u516b": 8,
    "\u4e5d": 9,
    "\u5341": 10,
  }
  const chinese = normalized.match(/(?:\u53ea\u8981|\u53ea\u751f\u6210|\u524d|\u6700\u591a|\u4e0d\u8d85\u8fc7).{0,8}?([\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341])/)
  if (chinese) return clampCaseLimit(chineseDigits[chinese[1]])
  return undefined
}

function clampCaseLimit(value: number | undefined): number | undefined {
  if (!Number.isFinite(value) || !value || value < 1) return undefined
  return Math.min(Math.floor(value), 100)
}

function sourceExcerptForSymbols(sourceCode: string, symbols: SourceAnalysis["symbols"]): string {
  const lines = sourceCode.split(/\r?\n/)
  const starts = symbols.map((symbol) => symbol.startLine).filter((line): line is number => Number.isFinite(line))
  if (starts.length === 0) return sourceCode

  const start = Math.max(Math.min(...starts) - 1, 0)
  const explicitEnds = symbols.map((symbol) => symbol.endLine).filter((line): line is number => Number.isFinite(line))
  const end = explicitEnds.length > 0
    ? Math.min(Math.max(...explicitEnds), lines.length)
    : Math.min(start + 80, lines.length)

  return lines.slice(start, end).join("\n")
}

function formatZodIssues(issues: z.ZodIssue[]): string {
  return issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ")
}

function toText(value: unknown): string {
  if (typeof value === "string") return value
  if (value === undefined || value === null) return String(value)
  try { return JSON.stringify(value) } catch { return String(value) }
}

function copySourceToOutput(sourceFile: string, outputDir: string): void {
  try {
    fs.mkdirSync(outputDir, { recursive: true })
    const target = path.join(outputDir, path.basename(sourceFile))
    if (!fs.existsSync(target)) fs.copyFileSync(sourceFile, target)
  } catch {
    // ignore
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
