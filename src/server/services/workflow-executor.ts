/**
 * Workflow 执行器
 *
 * 接入现有的 generateTestWorkflow（7 步串行流水线）。
 */

import { logger } from '../../mastra/runtime/logger.js';
import { generateTestWorkflow } from '../../mastra/workflows/generate-test-workflow.js';

/**
 * 执行结果
 */
export interface WorkflowExecutionResult {
  success: boolean;
  testCode?: string;
  testFile?: string;
  coverage?: {
    line: number;
    branch: number;
    function: number;
  };
  execution?: {
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
  };
  executionTime: number;
  error?: string;
  logs: string[];
}

/**
 * 执行选项
 */
export interface WorkflowExecuteOptions {
  maxAttempts?: number;
  outputDir?: string;
  apiKey?: string;
  onLog?: (message: string) => void;
  onStep?: (step: string, progress: number) => void;
}

/**
 * 执行 Workflow
 *
 * 调用现有的 generateTestWorkflow：
 * 1. readParseSource - 读取并解析源文件
 * 2. designTestCases - 设计测试用例
 * 3. exportPlan - 导出测试计划
 * 4. generateTestCode - 生成测试代码
 * 5. executeTests - 执行测试
 * 6. selfHealing - 自愈循环
 * 7. exportResults - 导出最终结果
 */
export async function executeWorkflow(
  sourceCode: string,
  sourceFile: string,
  language: string,
  requirements: string = '',
  options: WorkflowExecuteOptions = {}
): Promise<WorkflowExecutionResult> {
  const {
    maxAttempts = 3,
    outputDir = `./output/workflow-${Date.now()}`,
    apiKey,
    onLog,
    onStep,
  } = options;

  const startTime = Date.now();
  const logs: string[] = [];

  const addLog = (message: string, step?: string) => {
    const logEntry = `[${new Date().toISOString()}] ${step ? `[${step}] ` : ''}${message}`;
    logs.push(logEntry);
    onLog?.(message);
    logger.info('system', { scope: 'workflow-executor', message, step });
  };

  try {
    if (!apiKey) {
      throw new Error('未提供 API Key');
    }

    // 设置 API Key
    process.env.DEEPSEEK_API_KEY = apiKey;
    addLog('已设置用户 API Key', 'init');

    onStep?.('init', 0);
    addLog('开始执行 Workflow...', 'init');

    // 准备工作流输入
    const workflowInput = {
      sourceCode,
      sourceFile: sourceFile || 'input',
      language: language || 'python',
      requirements,
      maxAttempts,
      outputDir,
    };

    addLog(`输入: ${sourceFile} (${language})`, 'init');

    // 调用工作流
    addLog('调用 generateTestWorkflow...', 'start');
    onStep?.('start', 5);

    const result = await (generateTestWorkflow as any).execute(workflowInput) as any;

    addLog('工作流执行完成', 'complete');
    onStep?.('complete', 100);

    const executionTime = Date.now() - startTime;

    return {
      success: true,
      testCode: result.testCode || result.test_code,
      testFile: result.testFile || result.test_file,
      coverage: result.coverage,
      execution: result.execution,
      executionTime,
      logs,
    };
  } catch (error: any) {
    const executionTime = Date.now() - startTime;
    addLog(`Workflow 执行失败: ${error.message}`, 'error');
    logger.error('system', { scope: 'workflow-executor', error: error.message, stack: error.stack });

    return {
      success: false,
      executionTime,
      error: error.message,
      logs,
    };
  }
}
