/**
 * 任务服务
 *
 * 处理测试生成任务的创建、查询、取消等业务逻辑。
 * 集成现有的测试生成工作流。
 */

import prisma from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { ErrorCode, createPagination } from '../utils/response.js';
import { generateUUID } from '../utils/crypto.js';

/**
 * 创建任务参数
 */
export interface CreateTaskParams {
  sourceFile?: string;
  sourceContent?: string;
  fileId?: number;
  language?: string;
  workspaceId?: number;
  sessionId?: number;
  mode?: 'workflow' | 'autonomous';
  requirements?: string;
  maxAttempts?: number;
  llmRetries?: number;
}

/**
 * 任务查询参数
 */
export interface TaskQueryParams {
  page?: number;
  pageSize?: number;
  status?: string;
  workspaceId?: number;
  sessionId?: number;
  language?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * 创建任务
 *
 * @param userId 用户 ID
 * @param params 创建参数
 * @returns 创建的任务
 */
export async function createTask(userId: number, params: CreateTaskParams) {
  const {
    sourceFile,
    sourceContent,
    fileId,
    language,
    workspaceId,
    sessionId,
    mode = 'workflow',
    requirements,
    maxAttempts = 3,
  } = params;

  // 如果指定了文件 ID，获取文件信息
  let resolvedSourceFile = sourceFile || '';
  let resolvedSourceContent = sourceContent || '';
  let resolvedLanguage = language || '';

  if (fileId) {
    const file = await prisma.uploadedFile.findFirst({
      where: { id: fileId, userId },
    });

    if (!file) {
      throw new AppError(ErrorCode.FILE_NOT_FOUND, '文件不存在');
    }

    resolvedSourceFile = file.originalName;

    // 获取文件内容
    const content = await prisma.fileContent.findFirst({
      where: { fileId },
    });

    if (content) {
      resolvedSourceContent = content.content.toString('utf-8');
    }

    // 从元数据获取语言
    if (file.metadata) {
      const metadata = JSON.parse(file.metadata as string);
      resolvedLanguage = metadata.language || '';
    }
  }

  // 如果没有指定语言，尝试自动检测
  if (!resolvedLanguage && resolvedSourceFile) {
    const ext = resolvedSourceFile.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      py: 'python',
      java: 'java',
      cpp: 'cpp',
      cc: 'cpp',
      c: 'cpp',
    };
    resolvedLanguage = languageMap[ext || ''] || 'unknown';
  }

  // 生成任务 ID
  const taskId = generateUUID();

  // 创建任务
  const task = await prisma.task.create({
    data: {
      userId,
      workspaceId,
      sessionId,
      taskId,
      status: 'pending',
      mode: mode.toUpperCase() as any,
      sourceFile: resolvedSourceFile,
      sourceContent: resolvedSourceContent,
      language: resolvedLanguage,
      requirements,
      attemptCount: 0,
    },
    select: {
      id: true,
      taskId: true,
      status: true,
      mode: true,
      sourceFile: true,
      language: true,
      createdAt: true,
    },
  });

  // TODO: 异步启动测试生成任务
  // 这里应该调用现有的工作流或自主 Agent
  // 例如：startTestGeneration(taskId, params);

  return task;
}

/**
 * 获取任务列表
 *
 * @param userId 用户 ID
 * @param params 查询参数
 * @returns 任务列表和分页信息
 */
export async function getTasks(userId: number, params: TaskQueryParams) {
  const {
    page = 1,
    pageSize = 20,
    status,
    workspaceId,
    sessionId,
    language,
    startDate,
    endDate,
  } = params;

  const { skip, take } = createPagination(page, pageSize);

  const where: any = { userId };
  if (status) where.status = status.toUpperCase();
  if (workspaceId) where.workspaceId = workspaceId;
  if (sessionId) where.sessionId = sessionId;
  if (language) where.language = language;

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  const [items, total] = await Promise.all([
    prisma.task.findMany({
      where,
      select: {
        id: true,
        taskId: true,
        status: true,
        mode: true,
        sourceFile: true,
        language: true,
        executionTime: true,
        tokenUsage: true,
        attemptCount: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.task.count({ where }),
  ]);

  return {
    items: items.map(item => ({
      ...item,
      id: Number(item.id),
      executionTime: item.executionTime ? Number(item.executionTime) : null,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * 获取任务详情
 *
 * @param userId 用户 ID
 * @param taskId 任务 UUID
 * @returns 任务详情
 */
export async function getTaskById(userId: number, taskId: string) {
  const task = await prisma.task.findFirst({
    where: {
      taskId,
      userId,
    },
    select: {
      id: true,
      taskId: true,
      status: true,
      mode: true,
      sourceFile: true,
      sourceContent: true,
      language: true,
      requirements: true,
      outputDir: true,
      result: true,
      errorMessage: true,
      executionTime: true,
      tokenUsage: true,
      attemptCount: true,
      createdAt: true,
      updatedAt: true,
      startedAt: true,
      completedAt: true,
      workspace: {
        select: {
          id: true,
          name: true,
        },
      },
      session: {
        select: {
          id: true,
          title: true,
        },
      },
    },
  });

  if (!task) {
    throw new AppError(ErrorCode.TASK_NOT_FOUND, '任务不存在');
  }

  return task;
}

/**
 * 获取任务日志
 *
 * @param userId 用户 ID
 * @param taskId 任务 UUID
 * @param level 日志级别
 * @param step 步骤
 * @param limit 限制数量
 * @param offset 偏移量
 * @returns 任务日志
 */
export async function getTaskLogs(
  userId: number,
  taskId: string,
  level?: string,
  step?: string,
  limit: number = 100,
  offset: number = 0
) {
  // 验证任务是否存在
  const task = await prisma.task.findFirst({
    where: { taskId, userId },
  });

  if (!task) {
    throw new AppError(ErrorCode.TASK_NOT_FOUND, '任务不存在');
  }

  const where: any = { taskId };
  if (level) where.level = level.toUpperCase();
  if (step) where.step = step;

  const [logs, total] = await Promise.all([
    prisma.taskLog.findMany({
      where,
      select: {
        id: true,
        level: true,
        step: true,
        message: true,
        metadata: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    }),
    prisma.taskLog.count({ where }),
  ]);

  return {
    logs: logs.reverse(),
    total,
  };
}

/**
 * 取消任务
 *
 * @param userId 用户 ID
 * @param taskId 任务 UUID
 */
export async function cancelTask(userId: number, taskId: string): Promise<void> {
  const task = await prisma.task.findFirst({
    where: { taskId, userId },
  });

  if (!task) {
    throw new AppError(ErrorCode.TASK_NOT_FOUND, '任务不存在');
  }

  if (task.status !== 'pending' && task.status !== 'running') {
    throw new AppError(ErrorCode.TASK_CANCELLED, '任务已完成或已取消');
  }

  await prisma.task.update({
    where: { taskId },
    data: {
      status: 'cancelled',
      completedAt: new Date(),
    },
  });

  // 添加日志
  await prisma.taskLog.create({
    data: {
      taskId,
      level: 'INFO',
      message: '任务已取消',
    },
  });
}

/**
 * 重试任务
 *
 * @param userId 用户 ID
 * @param taskId 任务 UUID
 * @returns 新任务
 */
export async function retryTask(userId: number, taskId: string) {
  const task = await prisma.task.findFirst({
    where: { taskId, userId },
  });

  if (!task) {
    throw new AppError(ErrorCode.TASK_NOT_FOUND, '任务不存在');
  }

  if (task.status !== 'failed' && task.status !== 'cancelled') {
    throw new AppError(ErrorCode.TASK_ALREADY_RUNNING, '任务正在运行或已完成');
  }

  // 创建新任务
  const newTaskId = generateUUID();

  const newTask = await prisma.task.create({
    data: {
      userId: task.userId,
      workspaceId: task.workspaceId,
      sessionId: task.sessionId,
      taskId: newTaskId,
      status: 'pending',
      mode: task.mode,
      sourceFile: task.sourceFile,
      sourceContent: task.sourceContent,
      language: task.language,
      requirements: task.requirements,
      attemptCount: 0,
    },
    select: {
      id: true,
      taskId: true,
      status: true,
      mode: true,
      sourceFile: true,
      language: true,
      createdAt: true,
    },
  });

  return newTask;
}

/**
 * 获取任务结果
 *
 * @param userId 用户 ID
 * @param taskId 任务 UUID
 * @returns 任务结果
 */
export async function getTaskResult(userId: number, taskId: string) {
  const task = await prisma.task.findFirst({
    where: { taskId, userId },
    select: {
      taskId: true,
      status: true,
      result: true,
      errorMessage: true,
      executionTime: true,
      tokenUsage: true,
      completedAt: true,
    },
  });

  if (!task) {
    throw new AppError(ErrorCode.TASK_NOT_FOUND, '任务不存在');
  }

  if (task.status !== 'completed') {
    throw new AppError(ErrorCode.TASK_FAILED, '任务未完成');
  }

  return task;
}

/**
 * 获取任务统计
 *
 * @param userId 用户 ID
 * @returns 统计信息
 */
export async function getTaskStats(userId: number) {
  const [total, pending, running, completed, failed, cancelled] = await Promise.all([
    prisma.task.count({ where: { userId } }),
    prisma.task.count({ where: { userId, status: 'pending' } }),
    prisma.task.count({ where: { userId, status: 'running' } }),
    prisma.task.count({ where: { userId, status: 'completed' } }),
    prisma.task.count({ where: { userId, status: 'failed' } }),
    prisma.task.count({ where: { userId, status: 'cancelled' } }),
  ]);

  const tokenUsage = await prisma.task.aggregate({
    where: { userId, status: 'completed' },
    _sum: { executionTime: true },
  });

  return {
    total,
    pending,
    running,
    completed,
    failed,
    cancelled,
    totalExecutionTime: tokenUsage._sum.executionTime || 0,
  };
}
