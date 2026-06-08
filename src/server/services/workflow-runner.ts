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

  return await (generateTestWorkflow as any).execute(workflowInput) as WorkflowRunResult;
}
