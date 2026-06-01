export type SupportedLanguage = "python" | "java" | "cpp"

export type DiagnosisType =
  | "TEST_CODE_ERROR"
  | "SOURCE_RUNTIME_ERROR"
  | "BEHAVIOR_MISMATCH"
  | "ENVIRONMENT_ERROR"
  | "UNKNOWN"

export interface SourceSymbol {
  name: string
  kind: "function" | "method" | "class"
  className?: string
  params: Array<{ name?: string; type?: string; raw?: string }>
  returnType?: string
  returnExpression?: string
  isStatic?: boolean
  startLine?: number
  endLine?: number
  docstring?: string
}

export interface SourceAnalysis {
  language: SupportedLanguage
  moduleName: string
  packageName?: string
  imports: string[]
  symbols: SourceSymbol[]
  raw: unknown
  warnings: string[]
}

export interface TestCase {
  case_number: string
  title: string
  case_type: string
  preconditions: string
  steps: string | string[]
  input_params?: Record<string, unknown>
  expected_result: string
  related_symbol: string
}

export interface ExecutionResult {
  status: "passed" | "failed" | "error" | "timeout" | "not_run"
  passed: number
  failed: number
  errors: number
  stdout: string
  stderr: string
  exit_code: number
  duration_ms: number
  timeout: boolean
  command?: string
  cwd?: string
  test_results?: unknown[]
  missing_dependencies?: string[]
}

export interface QualityResult {
  ok: boolean
  issues: string[]
  checked_tests: number
}

export interface CoverageResult {
  /** 符号覆盖率（用例设计阶段） */
  symbol_coverage: number
  covered_symbols: string[]
  uncovered_symbols: string[]
  case_type_coverage: Record<string, number>
  total_symbols: number
  total_cases: number
  /** 真实行覆盖率（coverage.py / JaCoCo / gcov 测量结果） */
  line_rate: number
  branch_rate: number
  covered_lines: number
  total_lines: number
  missing_lines: number
  /** 覆盖率工具名称 */
  coverage_tool: string
}

export interface Diagnosis {
  diagnosis_type: DiagnosisType
  confidence: number
  summary?: string
  evidence: string[]
  report_text?: string
  next_action:
    | "REGENERATE_TEST_CODE"
    | "ASK_USER_CONFIRMATION"
    | "INSTALL_DEPENDENCY"
    | "REPORT_TO_USER"
  suggested_commands?: string[]
  per_error_diagnoses?: Array<{
    id?: string
    failing_test?: string
    related_symbol?: string
    diagnosis_type: DiagnosisType
    summary: string
    evidence: string[]
    recommendation: string
  }>
}

export interface TestCodeVersion {
  version_no: number
  attempt: number
  test_code: string
  execution_result?: ExecutionResult
  quality?: QualityResult
  coverage?: CoverageResult
  diagnosis?: Diagnosis
  note?: string
  created_at: string
}

export interface ExportResult {
  exported_files: string[]
}

export interface GenerateCodeInput {
  sourceCode: string
  sourceFile: string
  filename: string
  outputDir: string
  analysis: SourceAnalysis
  testCases: TestCase[]
  attempt: number
  previousDiagnosis?: Diagnosis
}

export interface LanguageAdapter {
  language: SupportedLanguage
  displayName: string
  extensions: string[]
  testFramework: string
  codeFence: string
  parseSource(input: { sourceCode: string; filename: string; sourceFile: string }): SourceAnalysis
  buildGenerationContext(input: { analysis: SourceAnalysis; sourceFile: string }): string
  executeTests(input: {
    sourceCode: string
    sourceFile: string
    filename: string
    testCode: string
    outputDir: string
    timeoutSeconds: number
    analysis: SourceAnalysis
  }): ExecutionResult
  diagnose(input: {
    sourceCode: string
    testCode: string
    executionResult: ExecutionResult
    quality: QualityResult
    analysis: SourceAnalysis
  }): Diagnosis
  exportArtifacts(input: {
    testCases: TestCase[]
    testCode: string
    outputDir: string
    sourceFile: string
    executionResult?: ExecutionResult
    diagnosis?: Diagnosis
    quality?: QualityResult
    coverage?: CoverageResult
    versions?: TestCodeVersion[]
    artifactPrefix?: string
    skipTestCode?: boolean
    analysis: SourceAnalysis
  }): ExportResult
}
