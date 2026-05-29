import fs from "fs"
import fsp from "fs/promises"
import path from "path"
import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"
import { diagnosisAgent, diagnosisAgentPro } from "../agents/diagnosis-agent.js"
import { testCaseAgent } from "../agents/test-case-agent.js"
import { testCodeAgent, testCodeAgentPro } from "../agents/test-code-agent.js"
import { detectLanguage, getLanguageAdapter } from "../languages/registry.js"
import { assertLlmAvailable, formatError } from "../runtime/env.js"
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
    logProgress("Reading source code and detecting language")
    const sourceFile = path.resolve(inputData.file_path)
    const sourceCode = await fsp.readFile(sourceFile, "utf-8")
    const language = detectLanguage(sourceFile, inputData.language)
    const adapter = getLanguageAdapter(language)
    const filename = path.basename(sourceFile)
    logProgress(`Parsing source structure with ${adapter.displayName} adapter`)
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
    logProgress(`Calling LLM test-case agent for ${adapter.displayName}`)
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
    logProgress("Exporting test-case plan")
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
    logProgress(`Calling LLM test-code agent to generate ${adapter.testFramework} tests`)
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
    logProgress(`Executing tests with ${adapter.displayName} adapter`)
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
    const adapter = adapterFor(inputData.language)
    logProgress("Running quality check, AI diagnosis, and self-healing decision")
    let testCode = inputData.test_code
    let executionResult = inputData.execution_result as ExecutionResult
    let quality = adapter.checkQuality({ testCode, analysis: inputData.analysis as SourceAnalysis })
    const coverage = calculateCoverage(inputData.test_cases, inputData.analysis as SourceAnalysis)
    let diagnosis: Diagnosis | undefined
    const versions: TestCodeVersion[] = [
      createVersionRecord({
        versionNo: 1,
        attempt: inputData.attempt,
        testCode,
        executionResult,
        quality,
        note: "initial generation",
      }),
    ]

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

      versions[versions.length - 1] = { ...versions[versions.length - 1], diagnosis }
      if (diagnosis.diagnosis_type !== "TEST_CODE_ERROR" || diagnosis.confidence < 0.7) {
        return finalize(inputData, testCode, executionResult, diagnosis, quality, coverage, versions)
      }

      logProgress(`Self-healing attempt ${attempt}: regenerating test code from AI diagnosis`)
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
      quality = adapter.checkQuality({ testCode, analysis: inputData.analysis as SourceAnalysis })
      versions.push(createVersionRecord({
        versionNo: versions.length + 1,
        attempt,
        testCode,
        executionResult,
        quality,
        note: "self-healing regeneration",
      }))

      if (isPassed(executionResult, quality)) {
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
    versions[versions.length - 1] = { ...versions[versions.length - 1], diagnosis }
    return finalize(inputData, testCode, executionResult, diagnosis, quality, coverage, versions)
  },
})

const exportResultsStep = createStep({
  id: "export-results",
  inputSchema: finalStepOutputSchema,
  outputSchema: workflowOutputSchema,
  execute: async ({ inputData }) => {
    const adapter = adapterFor(inputData.language)
    logProgress("Exporting final test code, report, and version records")
    const exportResult = adapter.exportArtifacts({
      testCases: inputData.test_cases,
      testCode: inputData.test_code,
      outputDir: inputData.output_dir,
      sourceFile: inputData.source_file,
      executionResult: inputData.execution_detail as ExecutionResult,
      diagnosis: inputData.diagnosis as Diagnosis | undefined,
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
      const batchAnalysis: SourceAnalysis = { ...input.analysis, symbols }
      renderProgressBar("Designing test cases", batchIndex, effectiveBatches.length)
      const batchCases = await withLlmRetries("test-case batch " + (batchIndex + 1) + "/" + effectiveBatches.length, input.llmRetries, async () => {
        const fence = String.fromCharCode(96).repeat(3)
        const prompt = [
          "Generate concrete unit test cases for every listed symbol.",
          "Return only valid JSON in this shape: { \"cases\": [...] }.",
          "Use double quotes for all strings. Do not use Markdown.",
          "",
          "Rules:",
          "- Prefer one functional case, boundary cases, and exception/error cases when useful.",
          "- Boundary values should cover 0, empty strings/collections, negative values, None/null, and extreme values when relevant.",
          "- Division/modulo code must include a zero divisor case.",
          "- Recursive code must include base-case and invalid-input cases.",
          "- A function name containing safe should be tested under unsafe/error inputs.",
          "- Do not assume the source is correct only because it runs.",
          "- input_params keys must exactly match parameter names.",
          "- expected_result must be concrete.",
          "- Omit optional fields instead of writing null.",
          "- Global test case limit: " + (requestedCaseLimit ?? "none") + ".",
          "",
          "Expected JSON example:",
          JSON.stringify({ cases: [{ case_number: "TC-001", title: "specific title", case_type: "functional|boundary|exception", preconditions: "setup", steps: ["step"], input_params: { param: "value" }, expected_result: "specific expected behavior", related_symbol: "symbol name" }] }, null, 2),
          "",
          "Symbol context:",
          input.adapter.buildGenerationContext({ analysis: batchAnalysis, sourceFile: input.sourceFile }),
          "",
          "Extra requirements:",
          input.requirementsText ?? "None",
          "",
          "Relevant source code:",
          fence + input.adapter.codeFence,
          sourceExcerptForSymbols(input.sourceCode, symbols),
          fence,
        ].join("\n")
        const response = await testCaseAgent.generate(prompt, { modelSettings: { temperature: 0.1, maxOutputTokens: 4096 } })

        const parsed = parseJsonValue(response.text)
        const result = testCaseBatchSchema.safeParse(parsed)
        if (!result.success) {
          throw new Error("Invalid test-case JSON: " + formatZodIssues(result.error.issues) + ". Preview: " + preview(response.text))
        }
        if (result.data.cases.length === 0) {
          throw new Error("LLM returned an empty case list. Preview: " + preview(response.text))
        }
        return result.data.cases
      })
      const remaining = requestedCaseLimit === undefined ? batchCases.length : requestedCaseLimit - allCases.length
      allCases.push(...batchCases.slice(0, Math.max(0, remaining)))
      renderProgressBar("Designing test cases", batchIndex + 1, effectiveBatches.length)
    }
    finishProgressBar()

    if (allCases.length === 0) {
      throw new Error("LLM returned no test cases.")
    }
    return renumberCases(allCases)
  } catch (error) {
    finishProgressBar()
    throw new Error("LLM test case generation failed; stopped instead of using fallback. " + formatError(error))
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
    return await withLlmRetries("test-code generation attempt " + input.attempt, input.llmRetries, async () => {
      const fence = String.fromCharCode(96).repeat(3)
      const prompt = [
        "Generate executable " + input.adapter.testFramework + " unit test code.",
        "Return only source code. Do not use Markdown fences or explanations.",
        "",
        "Rules:",
        "- Every test case must map to a real test function unless user requirements limit the scope.",
        "- Use real assertions; do not use assert true, assert 1 == 1, empty tests, or only callable/hasattr checks.",
        "- For expected exceptions, use the precise assertion style for the framework.",
        "- Follow runtime/import instructions exactly.",
        "- If previous diagnosis says the generated test code is wrong, fix that specific problem and do not repeat it.",
        "",
        "Language and symbol context:",
        input.adapter.buildGenerationContext({ analysis: input.analysis, sourceFile: input.sourceFile }),
        "",
        "Output directory: " + path.resolve(input.outputDir),
        "Attempt: " + input.attempt,
        "Previous AI diagnosis:",
        JSON.stringify(input.previousDiagnosis?.report_text ?? input.previousDiagnosis ?? null, null, 2),
        "",
        "Test cases:",
        JSON.stringify(input.testCases, null, 2),
        "",
        "Source code:",
        fence + input.adapter.codeFence,
        input.sourceCode,
        fence,
      ].join("\n")
      const response = await agent.generate(prompt, { modelSettings: { temperature: 0.1, maxOutputTokens: 8192 } })
      const code = extractCode(response.text, input.adapter.codeFence)
      if (code.trim()) return code
      throw new Error("LLM returned empty test code. Preview: " + preview(response.text))
    })
  } catch (error) {
    throw new Error("LLM test code generation failed; stopped instead of using fallback. " + formatError(error))
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
    const reportText = await withLlmRetries("failure diagnosis attempt " + input.attempt, input.llmRetries, async () => {
      const fence = String.fromCharCode(96).repeat(3)
      const prompt = [
        "You are a senior unit-test failure diagnosis agent.",
        "Read the source code, the designed test cases, the generated test code, and the execution error output.",
        "Write a direct natural-language diagnosis of the root cause.",
        "",
        "Important:",
        "- Do not output JSON.",
        "- Do not output a classification template.",
        "- Do not repeat full logs; quote only the key error lines when useful.",
        "- Focus on whether the failure reveals a source-code defect, a wrong generated test, or an environment/runtime problem.",
        "- If the source code is defective, explain the concrete source bug and the expected correct behavior.",
        "- If the generated test is defective, explain exactly what is wrong with the test code.",
        "- If an environment command is needed, say the command in plain language.",
        "",
        "Language: " + input.adapter.displayName,
        "Test framework: " + input.adapter.testFramework,
        "Attempt: " + input.attempt,
        "",
        "Source/test context:",
        input.adapter.buildGenerationContext({ analysis: input.analysis, sourceFile: input.sourceFile }),
        "",
        "Designed test cases:",
        JSON.stringify(input.testCases, null, 2),
        "",
        "Generated test code:",
        fence + input.adapter.codeFence,
        input.testCode,
        fence,
        "",
        "Execution result and errors:",
        fence + "json",
        JSON.stringify(input.executionResult, null, 2),
        fence,
        "",
        "Quality result:",
        fence + "json",
        JSON.stringify(input.quality, null, 2),
        fence,
        "",
        "Source code:",
        fence + input.adapter.codeFence,
        input.sourceCode,
        fence,
      ].join("\n")
      const response = await agent.generate(prompt, { modelSettings: { temperature: 0.1, maxOutputTokens: 8192 } })
      const text = response.text.trim()
      if (!text) throw new Error("LLM returned an empty diagnosis.")
      return text
    })
    return makeDiagnosisDecision(reportText, input.executionResult, input.quality)
  } catch (error) {
    throw new Error("LLM failure diagnosis failed; stopped instead of using fallback. " + formatError(error))
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
        logProgress(`LLM ${label} failed on attempt ${total - remaining}/${total}; retrying. Reason: ${formatError(error)}`)
        continue
      }
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
  }
}

function normalizeSymbolName(value: string): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9_.:]/g, "").replace(/::/g, ".")
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function makeDiagnosisDecision(reportText: string, executionResult: ExecutionResult, quality: QualityResult): Diagnosis {
  const combined = (reportText + "\n" + executionResult.stdout + "\n" + executionResult.stderr).toLowerCase()
  if (/pytest|junit|maven|g\+\+|compiler|dependency|not installed|missing package|no module named ['"]pytest/.test(combined)) {
    return {
      diagnosis_type: "ENVIRONMENT_ERROR",
      confidence: 0.75,
      summary: firstLine(reportText),
      evidence: ["The natural-language diagnosis indicates a missing tool, framework, or dependency."],
      report_text: reportText,
      next_action: "INSTALL_DEPENDENCY",
      suggested_commands: extractLikelyCommands(reportText),
    }
  }
  if (/generated test|test code|wrong import|import path|fixture|syntax error|cannot find symbol|no matching function|not declared/.test(combined) || quality.issues.length > 0) {
    return {
      diagnosis_type: "TEST_CODE_ERROR",
      confidence: 0.78,
      summary: firstLine(reportText),
      evidence: ["The natural-language diagnosis points to generated test code or test quality problems."],
      report_text: reportText,
      next_action: "REGENERATE_TEST_CODE",
    }
  }
  if (/source bug|source code|implementation bug|division by zero|index error|recursion|infinite|null pointer|overflow|defect/.test(combined)) {
    return {
      diagnosis_type: "SOURCE_RUNTIME_ERROR",
      confidence: 0.78,
      summary: firstLine(reportText),
      evidence: ["The natural-language diagnosis points to a source-code defect."],
      report_text: reportText,
      next_action: "REPORT_TO_USER",
    }
  }
  if (executionResult.failed > 0) {
    return {
      diagnosis_type: "BEHAVIOR_MISMATCH",
      confidence: 0.65,
      summary: firstLine(reportText),
      evidence: ["Tests executed but assertions failed; the report should be reviewed against requirements."],
      report_text: reportText,
      next_action: "ASK_USER_CONFIRMATION",
    }
  }
  return {
    diagnosis_type: "UNKNOWN",
    confidence: 0.5,
    summary: firstLine(reportText),
    evidence: ["The natural-language diagnosis did not provide enough evidence for an automatic action."],
    report_text: reportText,
    next_action: "REPORT_TO_USER",
  }
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 220) ?? "AI diagnosis completed."
}

function extractLikelyCommands(text: string): string[] | undefined {
  const pattern = new RegExp("\\x60([^\\x60]*(?:pip|npm|mvn|gradle|conda|winget|choco|vcpkg|apt|brew|g\\+\\+|javac)[^\\x60]*)\\x60", "gi")
  const commands = [...text.matchAll(pattern)].map((match) => match[1].trim()).filter(Boolean)
  return commands.length ? [...new Set(commands)].slice(0, 3) : undefined
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
    throw new Error(`No JSON object or array found in LLM response. Preview: ${preview(text)}`)
  }

  const start = Math.min(...starts)
  const opener = text[start]
  const closer = opener === "{" ? "}" : "]"
  const end = findMatchingJsonEnd(text, start, opener, closer)
  if (end < 0) {
    throw new Error(`No complete JSON value found in LLM response. Preview: ${preview(text)}`)
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

function renderProgressBar(label: string, current: number, total: number): void {
  const safeTotal = Math.max(total, 1)
  const safeCurrent = Math.min(Math.max(current, 0), safeTotal)
  const width = 24
  const filled = Math.round((safeCurrent / safeTotal) * width)
  const bar = "#".repeat(filled) + "-".repeat(width - filled)
  const percent = Math.round((safeCurrent / safeTotal) * 100)
  process.stdout.write("\rAgent progress: " + label + " [" + bar + "] " + safeCurrent + "/" + safeTotal + " " + percent + "%")
}

function finishProgressBar(): void {
  process.stdout.write("\n")
}

function logProgress(message: string): void {
  console.log("Agent progress: " + message)
}
