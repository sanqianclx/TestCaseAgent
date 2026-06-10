/**
 * 会话控制器
 *
 * 处理会话的创建、查询、更新、删除以及消息管理等 HTTP 请求。
 */

import { Request, Response } from 'express';
import * as sessionService from '../services/session.service.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { asyncHandler } from '../middleware/errorHandler.js';

/**
 * 创建会话
 *
 * POST /api/v1/sessions
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const createSession = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  console.log('[createSession] 完整 req.body:', JSON.stringify(req.body));

  const { title, workspaceId, modelConfig, mode, outputDir } = req.body;

  console.log('[createSession] 解析后:', { title, workspaceId, mode, modelConfig, outputDir });

  // 合并 mode 到 modelConfig
  const finalMode = mode || 'autonomous';
  const finalModelConfig = {
    ...(modelConfig || {}),
    mode: finalMode,
  };

  const result = await sessionService.createSession(userId, {
    title,
    workspaceId,
    mode: finalMode,
    modelConfig: finalModelConfig,
    outputDir,
  });

  sendSuccess(res, result, '会话创建成功', 201);
});

/**
 * 获取会话列表
 *
 * GET /api/v1/sessions
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const getSessions = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { page, pageSize, status, workspaceId } = req.query as any;

  const result = await sessionService.getSessions(
    userId,
    page ? parseInt(page) : 1,
    pageSize ? parseInt(pageSize) : 20,
    status,
    workspaceId ? parseInt(workspaceId) : undefined
  );

  sendPaginated(res, result.items, result.total, result.page, result.pageSize);
});

/**
 * 获取会话详情
 *
 * GET /api/v1/sessions/:id
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const getSessionById = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const sessionId = parseInt(req.params.id);

  const result = await sessionService.getSessionById(userId, sessionId);

  sendSuccess(res, result);
});

/**
 * 更新会话
 *
 * PUT /api/v1/sessions/:id
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const updateSession = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const sessionId = parseInt(req.params.id);
  const { title, status, modelConfig, workspaceId, outputDir } = req.body;

  const result = await sessionService.updateSession(userId, sessionId, {
    title,
    status,
    modelConfig,
    workspaceId,
    outputDir,
  });

  sendSuccess(res, result, '会话更新成功');
});

/**
 * 删除会话
 *
 * DELETE /api/v1/sessions/:id
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const deleteSession = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const sessionId = parseInt(req.params.id);

  await sessionService.deleteSession(userId, sessionId);

  sendSuccess(res, null, '会话删除成功');
});

/**
 * 归档会话
 *
 * POST /api/v1/sessions/:id/archive
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const archiveSession = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const sessionId = parseInt(req.params.id);

  await sessionService.archiveSession(userId, sessionId);

  sendSuccess(res, null, '会话归档成功');
});

/**
 * 获取消息历史
 *
 * GET /api/v1/sessions/:id/messages
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const getMessages = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const sessionId = parseInt(req.params.id);
  const { page, pageSize, before } = req.query as any;

  const result = await sessionService.getMessages(
    userId,
    sessionId,
    page ? parseInt(page) : 1,
    pageSize ? parseInt(pageSize) : 50,
    before ? parseInt(before) : undefined
  );

  sendSuccess(res, result);
});

/**
 * 发送消息
 *
 * POST /api/v1/sessions/:id/messages
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const sendMessage = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const sessionId = parseInt(req.params.id);
  const { content, messageType, metadata, fileIds, taskMode, role } = req.body;

  // 如果只是保存消息（Chat 页面 SSE 模式调用）
  if (role && (role === 'user' || role === 'assistant')) {
    const msg = await sessionService.saveMessage(userId, sessionId, {
      content,
      role,
      messageType,
    });
    sendSuccess(res, msg, '消息已保存');
    return;
  }

  // 否则执行完整流程
  const result = await sessionService.sendMessage(userId, sessionId, {
    content,
    messageType,
    metadata,
    fileIds,
    taskMode,
  });

  sendSuccess(res, result, '消息发送成功');
});

/**
 * 获取会话统计
 *
 * GET /api/v1/sessions/stats
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const getSessionStats = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const result = await sessionService.getSessionStats(userId);

  sendSuccess(res, result);
});

export const getSessionOutputFiles = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const sessionId = parseInt(req.params.id);
  const { path: subPath } = req.query as { path?: string };

  const result = await sessionService.getSessionOutputFiles(userId, sessionId, subPath);

  sendSuccess(res, result);
});

export const getSessionOutputFileContent = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const sessionId = parseInt(req.params.id);
  const { path: filePath, encoding } = req.query as { path?: string; encoding?: string };

  const result = await sessionService.getSessionOutputFileContent(userId, sessionId, filePath || '', encoding);

  sendSuccess(res, result);
});
