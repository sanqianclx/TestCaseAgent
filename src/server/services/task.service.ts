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
import { cancelTaskRun } from './task-runtime-registry.js';
import { executeTask } from './llm.service.js';

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
  outputDir?: string;
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
  const taskId = await executeTask({
    userId,
    sessionId,
    workspaceId,
    sourceFile: resolvedSourceFile,
    sourceContent: resolvedSourceContent,
    language: resolvedLanguage,
    requirements,
    mode,
    maxAttempts,
    outputDir: params.outputDir,
  });

  const task = await prisma.task.findUnique({
    where: { taskId },
    select: {
      id: true,
      taskId: true,
      status: true,
      mode: true,
      sourceFile: true,
      language: true,
      outputDir: true,
      createdAt: true,
    },
  });

  if (!task) {
    throw new AppError(ErrorCode.TASK_NOT_FOUND, '任务创建后未找到记录');
  }

  return {
    ...task,
    id: Number(task.id),
  };
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
  if (status) where.status = status.toLowerCase();
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
        outputDir: true,
        result: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        session: {
          select: {
            id: true,
            title: true,
          },
        },
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
      session: item.session ? { id: Number(item.session.id), title: item.session.title } : null,
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
  if (level) where.level = level.toLowerCase();
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
      errorMessage: '任务已取消',
      completedAt: new Date(),
    },
  });

  cancelTaskRun(taskId);

  // 添加日志
  await prisma.taskLog.create({
    data: {
      taskId,
      level: 'info',
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

  const newTaskId = await executeTask({
    userId: Number(task.userId),
    sessionId: task.sessionId ? Number(task.sessionId) : undefined,
    workspaceId: task.workspaceId ? Number(task.workspaceId) : undefined,
    sourceFile: task.sourceFile || undefined,
    sourceContent: task.sourceContent || undefined,
    language: task.language || undefined,
    requirements: task.requirements || undefined,
    mode: task.mode as 'workflow' | 'autonomous',
    outputDir: task.outputDir || undefined,
  });

  const newTask = await prisma.task.findUnique({
    where: { taskId: newTaskId },
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

  if (!newTask) {
    throw new AppError(ErrorCode.TASK_NOT_FOUND, '重试任务创建后未找到记录');
  }

  return {
    ...newTask,
    id: Number(newTask.id),
  };
}

/**
 * 物理删除任务
 *
 * 级联删除：任务的 logs 会被 prisma onDelete: Cascade 一起删掉。
 * 如果任务正在运行（pending/running），先标记为 cancelled 再删。
 *
 * @param userId 用户 ID
 * @param taskId 任务 UUID
 */
export async function deleteTask(userId: number, taskId: string): Promise<void> {
  const task = await prisma.task.findFirst({
    where: { taskId, userId },
  });

  if (!task) {
    throw new AppError(ErrorCode.TASK_NOT_FOUND, '任务不存在');
  }

  // 正在运行的任务不允许直接删（必须先取消）
  if (task.status === 'pending' || task.status === 'running') {
    throw new AppError(ErrorCode.TASK_ALREADY_RUNNING, '运行中的任务请先取消');
  }

  await prisma.task.delete({
    where: { taskId },
  });
}

/**
 * 获取任务结果
 *
 * @param userId 用户 ID
 * @param taskId 任务 UUID
 * @returns 任务结果（已解析 result JSON，顶层补 outputDir/sourceFile 等）
 */
export async function getTaskResult(userId: number, taskId: string) {
  const task = await prisma.task.findFirst({
    where: { taskId, userId },
    select: {
      taskId: true,
      status: true,
      mode: true,
      sourceFile: true,
      language: true,
      outputDir: true,
      result: true,
      errorMessage: true,
      executionTime: true,
      tokenUsage: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      sessionId: true,
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

  // 解析 result JSON 字符串为对象（Prisma Json 字段在读取时已解析，但兼容字符串）
  let parsedResult: any = null;
  if (task.result != null) {
    if (typeof task.result === 'string') {
      try {
        parsedResult = JSON.parse(task.result);
      } catch {
        parsedResult = { raw: task.result };
      }
    } else {
      parsedResult = task.result;
    }
  }

  // 顶层补 outputDir / sourceFile / language / mode / session
  return {
    taskId: task.taskId,
    status: task.status,
    mode: task.mode,
    sourceFile: task.sourceFile,
    language: task.language,
    outputDir: task.outputDir,
    errorMessage: task.errorMessage,
    executionTime: task.executionTime ? Number(task.executionTime) : null,
    tokenUsage: task.tokenUsage,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    sessionId: task.sessionId ? Number(task.sessionId) : null,
    session: task.session
      ? { id: Number(task.session.id), title: task.session.title }
      : null,
    result: parsedResult,
  };
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

  const executionTimeAggregate = await prisma.task.aggregate({
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
    totalExecutionTime: executionTimeAggregate._sum.executionTime || 0,
  };
}
