/**
 * LLM 服务
 *
 * 使用用户自己的 DeepSeek API Key 调用 LLM。
 * 集成两种独立的测试生成模式：
 * 1. Agent 模式（autonomous）- LLM 自主规划和执行
 * 2. Workflow 模式 - 7 步串行流水线
 */

import prisma from '../config/database.js';
import { generateUUID } from '../utils/crypto.js';
import { getActiveApiKey } from './llmKey.service.js';
import { executeAgentNonInteractive } from './agent-executor.js';
import { executeWorkflow } from './workflow-executor.js';
import { registerGeneratedFile } from './file.service.js';

/**
 * 任务模式
 */
export type TaskMode = 'workflow' | 'autonomous';

/**
 * 执行任务参数
 */
export interface ExecuteTaskParams {
  userId: number;
  sessionId?: number;
  workspaceId?: number;
  sourceFile?: string;
  sourceContent?: string;
  language?: string;
  requirements?: string;
  mode: TaskMode;
  maxAttempts?: number;
  outputDir?: string;
}

/**
 * 执行结果
 */
export interface TaskResult {
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: string;
}

/**
 * 更新任务状态
 */
async function updateTaskStatus(
  taskId: string,
  status: string,
  data?: Record<string, any>
) {
  const updateData: any = { status: status.toLowerCase() };

  if (status === 'running') {
    updateData.startedAt = new Date();
  } else if (status === 'completed' || status === 'failed') {
    updateData.completedAt = new Date();
  }

  if (data) {
    Object.assign(updateData, data);
  }

  await prisma.task.update({
    where: { taskId },
    data: updateData,
  });
}

/**
 * 添加任务日志
 */
async function addTaskLog(
  taskId: string,
  level: string,
  message: string,
  step?: string,
  metadata?: Record<string, any>
) {
  const normalizedLevel = ['info', 'warn', 'error', 'debug', 'step'].includes(level.toLowerCase())
    ? level.toLowerCase()
    : 'info';
  await prisma.taskLog.create({
    data: {
      taskId,
      level: normalizedLevel as any,
      step,
      message,
      metadata: metadata ? JSON.stringify(metadata) : undefined,
    },
  });
}

/**
 * 检查用户是否有可用的 API Key
 */
async function checkApiKey(userId: number): Promise<string> {
  const apiKey = await getActiveApiKey(userId);
  if (!apiKey) {
    throw new Error('未配置 DeepSeek API Key，请先在设置页面添加');
  }
  return apiKey;
}

/**
 * 执行 Workflow 模式
 */
async function executeWorkflowTask(taskId: string, params: ExecuteTaskParams): Promise<void> {
  const {
    userId,
    sourceFile = '',
    sourceContent = '',
    language = 'python',
    requirements = '',
    maxAttempts = 3,
    outputDir,
  } = params;

  try {
    // 检查 API Key
    const apiKey = await checkApiKey(userId);
    await addTaskLog(taskId, 'info', '已加载 API Key', 'init');

    await updateTaskStatus(taskId, 'running');
    await addTaskLog(taskId, 'info', '开始 Workflow 模式执行', 'start');

    // 把 outputDir 持久化到任务（用户指定的目录优先，否则用默认 ./output/<taskId>）
    const finalOutputDir = outputDir || `./output/${taskId}`;
    await prisma.task.update({
      where: { taskId },
      data: { outputDir: finalOutputDir },
    });

    // 调用 Workflow 执行器，传入 API Key
    const result = await executeWorkflow(
      sourceContent,
      sourceFile,
      language,
      requirements,
      {
        maxAttempts,
        outputDir: finalOutputDir,
        apiKey,
        onLog: (message) => addTaskLog(taskId, 'info', message),
        onStep: (step, progress) => addTaskLog(taskId, 'info', `步骤: ${step}`, step),
      }
    );

    if (result.success) {
      // 把生成的测试代码入库，便于前端预览
      let previewFileId: number | null = null;
      if (result.testCode) {
        try {
          const reg = await registerGeneratedFile({
            userId,
            sessionId: params.sessionId,
            workspaceId: params.workspaceId,
            filename: result.testFile || `test_output_${Date.now()}.${language === 'python' ? 'py' : language === 'java' ? 'java' : 'txt'}`,
            content: result.testCode,
            purpose: 'test_output',
            metadata: { sourceTaskId: taskId, language, sourceFile, kind: 'unit_test' },
          });
          previewFileId = reg.id;
        } catch (regErr: any) {
          // 入库失败不影响任务完成
          await addTaskLog(taskId, 'warn', `测试代码入库失败: ${regErr.message}`, 'register');
        }
      }

      await addTaskLog(taskId, 'info', '工作流执行完成', 'complete', {
        testFile: result.testFile,
        previewFileId,
      });

      await updateTaskStatus(taskId, 'completed', {
        result: JSON.stringify({
          testCode: result.testCode,
          testFile: result.testFile,
          coverage: result.coverage,
          execution: result.execution,
          previewFileId,
          outputDir: finalOutputDir,
        }),
        executionTime: result.executionTime,
      });
    } else {
      throw new Error(result.error || '工作流执行失败');
    }

  } catch (error: any) {
    await addTaskLog(taskId, 'error', `执行失败: ${error.message}`, 'error');
    await updateTaskStatus(taskId, 'failed', {
      errorMessage: error.message,
    });
  }
}

/**
 * 执行 Agent 模式
 */
async function executeAgentTask(taskId: string, params: ExecuteTaskParams): Promise<void> {
  const {
    userId,
    sourceFile = '',
    sourceContent = '',
    language = 'python',
    requirements = '',
    outputDir,
  } = params;

  try {
    // 检查 API Key
    const apiKey = await checkApiKey(userId);
    await addTaskLog(taskId, 'info', '已加载 API Key', 'init');

    await updateTaskStatus(taskId, 'running');
    await addTaskLog(taskId, 'info', '开始 Agent 自主模式执行', 'start');

    // 持久化 outputDir
    const finalOutputDir = outputDir || `./output/agent-${taskId}`;
    await prisma.task.update({
      where: { taskId },
      data: { outputDir: finalOutputDir },
    });

    // 构建 Agent 输入
    const agentInput = `
请为以下源代码生成单元测试：

## 源文件
${sourceFile}

## 源代码
\`\`\`${language}
${sourceContent}
\`\`\`

## 额外要求
${requirements || '无'}

请分析代码并生成完整的单元测试。
`;

    await addTaskLog(taskId, 'info', 'Agent 正在自主规划...', 'plan');

    // 调用 Agent 执行器，传入 API Key
    const result = await executeAgentNonInteractive(agentInput, language, {
      maxSteps: 25,
      timeout: 300000,
      apiKey,
      onLog: (message) => addTaskLog(taskId, 'info', message),
    });

    if (result.success) {
      // 把生成的测试代码入库，便于前端预览
      let previewFileId: number | null = null;
      if (result.testCode) {
        try {
          const reg = await registerGeneratedFile({
            userId,
            sessionId: params.sessionId,
            workspaceId: params.workspaceId,
            filename: result.testFile || `test_output_${Date.now()}.${language === 'python' ? 'py' : language === 'java' ? 'java' : 'txt'}`,
            content: result.testCode,
            purpose: 'test_output',
            metadata: { sourceTaskId: taskId, language, sourceFile, kind: 'unit_test' },
          });
          previewFileId = reg.id;
        } catch (regErr: any) {
          await addTaskLog(taskId, 'warn', `测试代码入库失败: ${regErr.message}`, 'register');
        }
      }

      await addTaskLog(taskId, 'info', 'Agent 执行完成', 'complete', {
        testFile: result.testFile,
        previewFileId,
        toolCallCount: result.toolCalls?.length || 0,
      });

      await updateTaskStatus(taskId, 'completed', {
        result: JSON.stringify({
          testCode: result.testCode,
          testFile: result.testFile,
          testFilePath: result.testFilePath,
          previewFileId,
          outputDir: finalOutputDir,
          coverage: result.coverage,
          execution: result.execution,
          toolCalls: result.toolCalls,
        }),
        executionTime: result.executionTime,
      });
    } else {
      throw new Error(result.error || 'Agent 执行失败');
    }

  } catch (error: any) {
    await addTaskLog(taskId, 'error', `Agent 执行失败: ${error.message}`, 'error');
    await updateTaskStatus(taskId, 'failed', {
      errorMessage: error.message,
    });
  }
}

/**
 * 执行任务
 */
export async function executeTask(params: ExecuteTaskParams): Promise<string> {
  const { userId, sessionId, workspaceId, sourceFile, sourceContent, language, requirements, mode, maxAttempts, outputDir } = params;

  const taskId = generateUUID();

  // 创建任务记录
  await prisma.task.create({
    data: {
      userId,
      workspaceId,
      sessionId,
      taskId,
      status: 'pending',
      mode: mode.toLowerCase() as any,
      sourceFile: sourceFile || '',
      sourceContent: sourceContent || '',
      language: language || 'unknown',
      requirements,
      outputDir,
      attemptCount: 0,
    },
  });

  // 异步执行任务
  if (mode === 'workflow') {
    executeWorkflowTask(taskId, params).catch(console.error);
  } else {
    executeAgentTask(taskId, params).catch(console.error);
  }

  return taskId;
}

/**
 * 获取任务执行状态
 */
export async function getTaskStatus(taskId: string): Promise<TaskResult> {
  const task = await prisma.task.findUnique({
    where: { taskId },
    select: {
      taskId: true,
      status: true,
      result: true,
      errorMessage: true,
    },
  });

  if (!task) {
    throw new Error('任务不存在');
  }

  return {
    taskId: task.taskId,
    status: task.status.toLowerCase() as any,
    result: task.result ? JSON.parse(task.result as string) : undefined,
    error: task.errorMessage || undefined,
  };
}
