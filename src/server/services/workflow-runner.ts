import fs from 'fs/promises';
import path from 'path';
import { generateTestWorkflow } from '../../mastra/workflows/generate-test-workflow.js';

export interface WorkflowRunParams {
  sourceCode: string;
  sourceFile: string;
  language?: string;
  requirements?: string;
  maxAttempts?: number;
  llmRetries?: number;
  outputDir?: string;
  onTrace?: (event: {
    step: string;
    message: string;
    progress?: number;
    data?: Record<string, unknown>;
  }) => void;
}

export interface WorkflowRunResult {
  source_file: string;
  language: string;
  test_code: string;
  test_cases_count?: number;
  passed?: boolean;
  exported_files?: string[];
  execution_detail?: {
    status: string;
    passed: number;
    failed: number;
    errors: number;
    duration_ms: number;
    [key: string]: unknown;
  };
  coverage?: {
    line_rate?: number;
    branch_rate?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function normalizeLanguage(language?: string): 'python' | 'java' | 'cpp' | 'auto' {
  if (language === 'python' || language === 'java' || language === 'cpp') {
    return language;
  }
  return 'auto';
}

function resolveFileName(sourceFile: string, language?: string): string {
  const basename = path.basename(sourceFile || '').trim();
  if (basename) {
    return basename;
  }

  const extMap: Record<string, string> = {
    python: '.py',
    java: '.java',
    cpp: '.cpp',
  };
  const ext = extMap[language || ''] || '.txt';
  return `input${ext}`;
}

async function materializeWorkflowInputFile(params: WorkflowRunParams): Promise<string> {
  const outputDir = path.resolve(params.outputDir || `./output/workflow-${Date.now()}`);
  const inputDir = path.join(outputDir, '_workflow_input');
  await fs.mkdir(inputDir, { recursive: true });

  const fileName = resolveFileName(params.sourceFile, params.language);
  const filePath = path.join(inputDir, fileName);
  await fs.writeFile(filePath, params.sourceCode, 'utf-8');
  return filePath;
}

export async function runGenerateTestWorkflow(params: WorkflowRunParams): Promise<WorkflowRunResult> {
  const outputDir = path.resolve(params.outputDir || `./output/workflow-${Date.now()}`);
  const filePath = await materializeWorkflowInputFile({ ...params, outputDir });
  const workflowInput = {
    file_path: filePath,
    output_dir: outputDir,
    max_attempts: params.maxAttempts ?? 3,
    llm_retries: params.llmRetries ?? 2,
    requirements_text: params.requirements || undefined,
    language: normalizeLanguage(params.language),
  };

  params.onTrace?.({
    step: 'input',
    message: `源文件已准备：${path.basename(filePath)}，${params.sourceCode.split(/\r?\n/).length} 行`,
    progress: 5,
    data: {
      sourceFile: filePath,
      outputDir,
      language: workflowInput.language,
      sourceLines: params.sourceCode.split(/\r?\n/).length,
      requirementsLength: params.requirements?.length || 0,
    },
  });

  const run = await (generateTestWorkflow as any).createRun();
  params.onTrace?.({
    step: 'workflow-start',
    message: 'Mastra workflow run 已创建，开始按 7 步流水线执行',
    progress: 10,
  });
  const result = await run.start({ inputData: workflowInput });

  if (result.status !== 'success') {
    const errorMessage =
      result.status === 'failed'
        ? result.error?.message || 'Workflow 执行失败'
        : JSON.stringify(result);
    throw new Error(errorMessage);
  }

  const output = result.result as WorkflowRunResult;
  params.onTrace?.({
    step: 'workflow-result',
    message: `工作流完成：生成 ${output.test_cases_count ?? 0} 个测试用例，导出 ${output.exported_files?.length ?? 0} 个文件`,
    progress: 92,
    data: {
      language: output.language,
      testCasesCount: output.test_cases_count,
      testCodeLength: output.test_code?.length || 0,
      passed: output.passed,
      exportedFiles: output.exported_files || [],
      execution: output.execution_detail,
      coverage: output.coverage,
    },
  });

  return output;
}
