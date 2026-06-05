/**
 * 任务控制器
 *
 * 处理测试生成任务的创建、查询、取消等 HTTP 请求。
 */

import { Request, Response } from 'express';
import * as taskService from '../services/task.service.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { asyncHandler } from '../middleware/errorHandler.js';

/**
 * 创建任务
 *
 * POST /api/v1/tasks
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const createTask = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const {
    sourceFile,
    sourceContent,
    fileId,
    language,
    workspaceId,
    sessionId,
    mode,
    requirements,
    maxAttempts,
  } = req.body;

  const result = await taskService.createTask(userId, {
    sourceFile,
    sourceContent,
    fileId,
    language,
    workspaceId,
    sessionId,
    mode,
    requirements,
    maxAttempts,
  });

  sendSuccess(res, result, '任务创建成功', 201);
});

/**
 * 获取任务列表
 *
 * GET /api/v1/tasks
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const getTasks = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const {
    page,
    pageSize,
    status,
    workspaceId,
    sessionId,
    language,
    startDate,
    endDate,
  } = req.query as any;

  const result = await taskService.getTasks(userId, {
    page: page ? parseInt(page) : 1,
    pageSize: pageSize ? parseInt(pageSize) : 20,
    status,
    workspaceId: workspaceId ? parseInt(workspaceId) : undefined,
    sessionId: sessionId ? parseInt(sessionId) : undefined,
    language,
    startDate,
    endDate,
  });

  sendPaginated(res, result.items, result.total, result.page, result.pageSize);
});

/**
 * 获取任务详情
 *
 * GET /api/v1/tasks/:taskId
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const getTaskById = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { taskId } = req.params;

  const result = await taskService.getTaskById(userId, taskId);

  sendSuccess(res, result);
});

/**
 * 获取任务日志
 *
 * GET /api/v1/tasks/:taskId/logs
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const getTaskLogs = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { taskId } = req.params;
  const { level, step, limit, offset } = req.query as any;

  const result = await taskService.getTaskLogs(
    userId,
    taskId,
    level,
    step,
    limit ? parseInt(limit) : 100,
    offset ? parseInt(offset) : 0
  );

  sendSuccess(res, result);
});

/**
 * 取消任务
 *
 * POST /api/v1/tasks/:taskId/cancel
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const cancelTask = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { taskId } = req.params;

  await taskService.cancelTask(userId, taskId);

  sendSuccess(res, null, '任务取消成功');
});

/**
 * 重试任务
 *
 * POST /api/v1/tasks/:taskId/retry
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const retryTask = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { taskId } = req.params;

  const result = await taskService.retryTask(userId, taskId);

  sendSuccess(res, result, '任务重试成功');
});

/**
 * 删除任务
 *
 * DELETE /api/v1/tasks/:taskId
 */
export const deleteTask = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { taskId } = req.params;

  await taskService.deleteTask(userId, taskId);

  sendSuccess(res, null, '任务已删除');
});

/**
 * 获取任务结果
 *
 * GET /api/v1/tasks/:taskId/result
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const getTaskResult = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { taskId } = req.params;

  const result = await taskService.getTaskResult(userId, taskId);

  sendSuccess(res, result);
});

/**
 * 获取任务统计
 *
 * GET /api/v1/tasks/stats
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const getTaskStats = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const result = await taskService.getTaskStats(userId);

  sendSuccess(res, result);
});
