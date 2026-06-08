/**
 * 会话服务
 *
 * 处理会话的创建、查询、更新、删除以及消息管理等业务逻辑。
 */

import prisma from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { ErrorCode, createPagination } from '../utils/response.js';

/**
 * 创建会话参数
 */
export interface CreateSessionParams {
  title?: string;
  workspaceId?: number;
  mode?: 'workflow' | 'autonomous';
  modelConfig?: Record<string, any>;
  /** 用户指定的测试代码输出目录（不绑定工作空间，作为"会话级默认目录"持久化） */
  outputDir?: string;
}

/**
 * 更新会话参数
 */
export interface UpdateSessionParams {
  title?: string;
  status?: 'active' | 'archived';
  modelConfig?: Record<string, any>;
  workspaceId?: number;
}

/**
 * 发送消息参数
 */
export interface SendMessageParams {
  content: string;
  messageType?: 'text' | 'code' | 'file';
  metadata?: Record<string, any>;
  fileIds?: number[];
  taskMode?: 'workflow' | 'autonomous';
}

/**
 * 创建会话
 *
 * @param userId 用户 ID
 * @param params 创建参数
 * @returns 创建的会话
 */
export async function createSession(userId: number, params: CreateSessionParams) {
  const { title = '新会话', workspaceId, mode = 'autonomous', modelConfig, outputDir } = params;

  // 如果指定了工作空间，检查是否存在
  if (workspaceId) {
    const workspace = await prisma.workspace.findFirst({
      where: { id: workspaceId, userId },
    });
    if (!workspace) {
      throw new AppError(ErrorCode.WORKSPACE_NOT_FOUND, '工作空间不存在');
    }
  }

  // 把 outputDir 写到 session.context JSON（不动 schema）
  const contextValue = outputDir ? JSON.stringify({ outputDir }) : undefined;

  const session = await prisma.session.create({
    data: {
      userId,
      workspaceId,
      title,
      mode: mode as any,
      modelConfig: modelConfig ? JSON.stringify(modelConfig) : undefined,
      context: contextValue as any,
    },
    select: {
      id: true,
      title: true,
      status: true,
      workspaceId: true,
      modelConfig: true,
      messageCount: true,
      totalTokens: true,
      createdAt: true,
      context: true,
      workspace: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return {
    ...session,
    id: Number(session.id),
    workspaceId: session.workspaceId ? Number(session.workspaceId) : null,
    messageCount: Number(session.messageCount),
    totalTokens: Number(session.totalTokens || 0),
    workspace: session.workspace ? { id: Number(session.workspace.id), name: session.workspace.name } : null,
  };
}

/**
 * 获取会话列表
 *
 * @param userId 用户 ID
 * @param page 页码
 * @param pageSize 每页大小
 * @param status 会话状态
 * @param workspaceId 工作空间 ID
 * @returns 会话列表和分页信息
 */
export async function getSessions(
  userId: number,
  page: number = 1,
  pageSize: number = 20,
  status?: string,
  workspaceId?: number
) {
  const { skip, take } = createPagination(page, pageSize);

  const where: any = {
    userId,
    status: { not: 'deleted' }, // 排除已删除的会话
  };
  if (status) where.status = status.toLowerCase();
  if (workspaceId) where.workspaceId = workspaceId;

  const [items, total] = await Promise.all([
    prisma.session.findMany({
      where,
      select: {
        id: true,
        title: true,
        status: true,
        mode: true,
        messageCount: true,
        totalTokens: true,
        lastMessageAt: true,
        createdAt: true,
        workspace: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            messages: true,
            tasks: true,
          },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
      skip,
      take,
    }),
    prisma.session.count({ where }),
  ]);

  return {
    items: items.map(item => ({
      ...item,
      id: Number(item.id),
      messageCount: Number(item.messageCount),
      totalTokens: Number(item.totalTokens || 0),
      workspace: item.workspace ? { id: Number(item.workspace.id), name: item.workspace.name } : null,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * 获取会话详情
 *
 * @param userId 用户 ID
 * @param sessionId 会话 ID
 * @returns 会话详情
 */
export async function getSessionById(userId: number, sessionId: number) {
  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      userId,
    },
    select: {
      id: true,
      title: true,
      status: true,
      context: true,
      modelConfig: true,
      messageCount: true,
      totalTokens: true,
      createdAt: true,
      updatedAt: true,
      lastMessageAt: true,
      workspace: {
        select: {
          id: true,
          name: true,
          basePath: true,
        },
      },
      _count: {
        select: {
          messages: true,
          tasks: true,
        },
      },
    },
  });

  if (!session) {
    throw new AppError(ErrorCode.SESSION_NOT_FOUND, '会话不存在');
  }

  return {
    ...session,
    id: Number(session.id),
    messageCount: Number(session.messageCount),
    totalTokens: Number(session.totalTokens || 0),
    workspace: session.workspace
      ? { ...session.workspace, id: Number(session.workspace.id) }
      : null,
  };
}

/**
 * 更新会话
 *
 * @param userId 用户 ID
 * @param sessionId 会话 ID
 * @param params 更新参数
 * @returns 更新后的会话
 */
export async function updateSession(
  userId: number,
  sessionId: number,
  params: UpdateSessionParams
) {
  const existing = await prisma.session.findFirst({
    where: {
      id: sessionId,
      userId,
    },
  });

  if (!existing) {
    throw new AppError(ErrorCode.SESSION_NOT_FOUND, '会话不存在');
  }

  const updateData: any = {};
  if (params.title !== undefined) updateData.title = params.title;
  if (params.status !== undefined) updateData.status = params.status.toLowerCase();
  if (params.modelConfig !== undefined) updateData.modelConfig = JSON.stringify(params.modelConfig);
  if (params.workspaceId !== undefined) {
    if (existing.workspaceId && Number(existing.workspaceId) !== params.workspaceId) {
      throw new AppError(ErrorCode.WORKSPACE_NO_PERMISSION, '会话已绑定工作空间，不能更换');
    }
    const workspace = await prisma.workspace.findFirst({
      where: { id: params.workspaceId, userId },
    });
    if (!workspace) {
      throw new AppError(ErrorCode.WORKSPACE_NOT_FOUND, '工作空间不存在');
    }
    updateData.workspaceId = params.workspaceId;
  }

  const session = await prisma.session.update({
    where: { id: sessionId },
    data: updateData,
    select: {
      id: true,
      title: true,
      status: true,
      workspaceId: true,
      modelConfig: true,
      updatedAt: true,
      workspace: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return {
    ...session,
    id: Number(session.id),
    workspaceId: session.workspaceId ? Number(session.workspaceId) : null,
    workspace: session.workspace ? { id: Number(session.workspace.id), name: session.workspace.name } : null,
  };
}

/**
 * 删除会话（软删除）
 *
 * @param userId 用户 ID
 * @param sessionId 会话 ID
 */
export async function deleteSession(userId: number, sessionId: number): Promise<void> {
  const existing = await prisma.session.findFirst({
    where: {
      id: sessionId,
      userId,
    },
  });

  if (!existing) {
    throw new AppError(ErrorCode.SESSION_NOT_FOUND, '会话不存在');
  }

  await prisma.session.update({
    where: { id: sessionId },
    data: { status: 'deleted' },
  });
}

/**
 * 归档会话
 *
 * @param userId 用户 ID
 * @param sessionId 会话 ID
 */
export async function archiveSession(userId: number, sessionId: number): Promise<void> {
  const existing = await prisma.session.findFirst({
    where: {
      id: sessionId,
      userId,
    },
  });

  if (!existing) {
    throw new AppError(ErrorCode.SESSION_NOT_FOUND, '会话不存在');
  }

  await prisma.session.update({
    where: { id: sessionId },
    data: { status: 'archived' },
  });
}

/**
 * 获取消息历史
 *
 * @param userId 用户 ID
 * @param sessionId 会话 ID
 * @param page 页码
 * @param pageSize 每页大小
 * @param before 消息 ID（用于加载更多）
 * @returns 消息列表
 */
export async function getMessages(
  userId: number,
  sessionId: number,
  page: number = 1,
  pageSize: number = 50,
  before?: number
) {
  // 验证会话是否存在
  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId },
  });

  if (!session) {
    throw new AppError(ErrorCode.SESSION_NOT_FOUND, '会话不存在');
  }

  const { skip, take } = createPagination(page, pageSize);

  const where: any = { sessionId };
  if (before) {
    where.id = { lt: before };
  }

  const [items, total] = await Promise.all([
    prisma.message.findMany({
      where,
      select: {
        id: true,
        role: true,
        content: true,
        messageType: true,
        metadata: true,
        tokenUsage: true,
        parentId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.message.count({ where: { sessionId } }),
  ]);

  return {
    items: items.reverse().map((m) => ({
      ...m,
      id: Number(m.id),
      parentId: m.parentId != null ? Number(m.parentId) : null,
    })),
    total,
    hasMore: skip + items.length < total,
    oldestId: items.length > 0 ? Number(items[0].id) : null,
  };
}

/**
 * 保存消息（不执行任务，只入库）
 */
export async function saveMessage(
  userId: number,
  sessionId: number,
  params: {
    content: string;
    role: 'user' | 'assistant';
    messageType?: string;
  }
) {
  // 验证会话
  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId },
  });
  if (!session) {
    throw new AppError(ErrorCode.SESSION_NOT_FOUND, '会话不存在');
  }

  const message = await prisma.message.create({
    data: {
      sessionId,
      role: params.role as any,
      content: params.content,
      messageType: (params.messageType?.toLowerCase() || 'text') as any,
    },
    select: {
      id: true,
      role: true,
      content: true,
      messageType: true,
      createdAt: true,
    },
  });

  // 更新统计
  await prisma.session.update({
    where: { id: sessionId },
    data: {
      messageCount: { increment: 1 },
      lastMessageAt: new Date(),
    },
  });

  return message;
}

/**
 * 发送消息
 *
 * @param userId 用户 ID
 * @param sessionId 会话 ID
 * @param params 消息参数
 * @returns 用户消息和 AI 回复
 */
export async function sendMessage(
  userId: number,
  sessionId: number,
  params: SendMessageParams
) {
  // 验证会话是否存在
  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId },
  });

  if (!session) {
    throw new AppError(ErrorCode.SESSION_NOT_FOUND, '会话不存在');
  }

  if (session.status === 'archived') {
    throw new AppError(ErrorCode.SESSION_ARCHIVED, '会话已归档，无法发送消息');
  }

  // 创建用户消息
  const userMessage = await prisma.message.create({
    data: {
      sessionId,
      role: ((params as any).role || 'user') as any,
      content: params.content,
      messageType: (params.messageType?.toLowerCase() || 'text') as any,
      metadata: params.metadata ? JSON.stringify(params.metadata) : undefined,
    },
    select: {
      id: true,
      role: true,
      content: true,
      messageType: true,
      createdAt: true,
    },
  });

  // 更新会话统计
  await prisma.session.update({
    where: { id: sessionId },
    data: {
      messageCount: { increment: 1 },
      lastMessageAt: new Date(),
    },
  });

  // 导入 LLM 服务和 API Key 服务
  const { executeTask } = await import('./llm.service.js');
  const { getActiveApiKey } = await import('./llmKey.service.js');

  // 检查用户是否配置了 API Key
  const userApiKey = await getActiveApiKey(userId);
  if (!userApiKey) {
    const noKeyMessage = await prisma.message.create({
      data: {
        sessionId,
        role: 'assistant',
        content: '⚠️ 您还没有配置 DeepSeek API Key，无法使用 AI 对话功能。\n\n请点击右上角头像 → LLM 设置，添加您的 API Key。',
        messageType: 'text',
      },
      select: {
        id: true,
        role: true,
        content: true,
        messageType: true,
        metadata: true,
        createdAt: true,
      },
    });

    return {
      userMessage,
      assistantMessage: noKeyMessage,
      taskId: null,
    };
  }

  // 检查是否需要创建任务
  const taskMode = params.taskMode || 'autonomous';
  let taskId: string | null = null;
  let assistantContent = '';

  // 从会话上下文获取工作空间信息
  const workspaceId = session.workspaceId ? Number(session.workspaceId) : undefined;

  try {
    // 创建并执行任务
    taskId = await executeTask({
      userId,
      sessionId,
      workspaceId,
      sourceContent: params.content,
      language: 'python', // 默认语言，后续可以从上下文推断
      requirements: params.content,
      mode: taskMode,
    });

    assistantContent = `已收到您的请求，正在使用 ${taskMode === 'workflow' ? 'Workflow 工作流' : 'Agent 自主模式'} 处理。\n\n任务 ID: ${taskId}\n\n您可以在任务管理页面查看执行进度。`;
  } catch (error: any) {
    assistantContent = `处理请求时出现错误: ${error.message}`;
  }

  // 创建助手消息
  const assistantMessage = await prisma.message.create({
    data: {
      sessionId,
      role: 'assistant',
      content: assistantContent,
      messageType: 'text',
      metadata: taskId ? JSON.stringify({ taskId, taskMode }) : undefined,
    },
    select: {
      id: true,
      role: true,
      content: true,
      messageType: true,
      metadata: true,
      createdAt: true,
    },
  });

  // 更新会话统计
  await prisma.session.update({
    where: { id: sessionId },
    data: {
      messageCount: { increment: 1 },
    },
  });

  return {
    userMessage,
    assistantMessage,
    taskId,
  };
}

/**
 * 获取会话统计
 *
 * @param userId 用户 ID
 * @returns 统计信息
 */
export async function getSessionStats(userId: number) {
  const [total, active, archived, totalMessages, totalTokens] = await Promise.all([
    prisma.session.count({ where: { userId, status: { not: 'deleted' } } }),
    prisma.session.count({ where: { userId, status: 'active' } }),
    prisma.session.count({ where: { userId, status: 'archived' } }),
    prisma.session.aggregate({
      where: { userId },
      _sum: { messageCount: true },
    }),
    prisma.session.aggregate({
      where: { userId },
      _sum: { totalTokens: true },
    }),
  ]);

  return {
    total,
    active,
    archived,
    totalMessages: totalMessages._sum.messageCount || 0,
    totalTokens: totalTokens._sum.totalTokens || 0,
  };
}
