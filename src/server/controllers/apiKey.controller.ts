/**
 * API Key 控制器
 *
 * 处理 API Key 的创建、查询、更新、删除等 HTTP 请求。
 */

import { Request, Response } from 'express';
import * as apiKeyService from '../services/apiKey.service.js';
import { sendSuccess, sendPaginated, sendError } from '../utils/response.js';
import { asyncHandler } from '../middleware/errorHandler.js';

/**
 * 创建 API Key
 *
 * POST /api/v1/api-keys
 */
export const createApiKey = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { name, apiKey } = req.body;

  if (!apiKey) {
    return sendError(res, 9003, '请提供 DeepSeek API Key');
  }

  if (!name) {
    return sendError(res, 9003, '请提供名称');
  }

  const result = await apiKeyService.createApiKey(userId, { name, apiKey });

  sendSuccess(res, result, 'API Key 添加成功', 201);
});

/**
 * 获取 API Key 列表
 *
 * GET /api/v1/api-keys
 */
export const getApiKeys = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { page, pageSize, isActive } = req.query as any;

  const result = await apiKeyService.getApiKeys(
    userId,
    page ? parseInt(page) : 1,
    pageSize ? parseInt(pageSize) : 20,
    isActive !== undefined ? isActive === 'true' : undefined
  );

  sendPaginated(res, result.items, result.total, result.page, result.pageSize);
});

/**
 * 删除 API Key
 *
 * DELETE /api/v1/api-keys/:id
 */
export const deleteApiKey = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const apiKeyId = parseInt(req.params.id);

  await apiKeyService.deleteApiKey(userId, apiKeyId);

  sendSuccess(res, null, 'API Key 删除成功');
});

/**
 * 激活 API Key
 *
 * POST /api/v1/api-keys/:id/activate
 */
export const activateApiKey = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const apiKeyId = parseInt(req.params.id);

  const result = await apiKeyService.activateApiKey(userId, apiKeyId);

  sendSuccess(res, result, 'API Key 已激活');
});

/**
 * 停用 API Key
 *
 * POST /api/v1/api-keys/:id/deactivate
 */
export const deactivateApiKey = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const apiKeyId = parseInt(req.params.id);

  const result = await apiKeyService.deactivateApiKey(userId, apiKeyId);

  sendSuccess(res, result, 'API Key 已停用');
});

/**
 * 测试 API Key
 *
 * POST /api/v1/api-keys/test
 */
export const testApiKey = asyncHandler(async (req: Request, res: Response) => {
  const { apiKey } = req.body;

  if (!apiKey) {
    return sendError(res, 9003, '请提供 API Key');
  }

  const result = await apiKeyService.validateApiKey(apiKey);

  sendSuccess(res, result, result.valid ? 'API Key 有效' : 'API Key 无效');
});

/**
 * 获取 API Key 统计
 *
 * GET /api/v1/api-keys/stats
 */
export const getApiKeyStats = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const result = await apiKeyService.getApiKeyStats(userId);

  sendSuccess(res, result);
});
