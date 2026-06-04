/**
 * 工作空间控制器
 *
 * 处理工作空间的创建、查询、更新、删除等 HTTP 请求。
 */

import { Request, Response } from 'express';
import * as workspaceService from '../services/workspace.service.js';
import { sendSuccess } from '../utils/response.js';
import { asyncHandler } from '../middleware/errorHandler.js';

/**
 * 创建工作空间
 *
 * POST /api/v1/workspaces
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const createWorkspace = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { name, basePath, description, isDefault, settings } = req.body;

  const result = await workspaceService.createWorkspace(userId, {
    name,
    basePath,
    description,
    isDefault,
    settings,
  });

  sendSuccess(res, result, '工作空间创建成功', 201);
});

/**
 * 获取工作空间列表
 *
 * GET /api/v1/workspaces
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const getWorkspaces = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const result = await workspaceService.getWorkspaces(userId);

  sendSuccess(res, result);
});

/**
 * 获取工作空间详情
 *
 * GET /api/v1/workspaces/:id
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const getWorkspaceById = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const workspaceId = parseInt(req.params.id);

  const result = await workspaceService.getWorkspaceById(userId, workspaceId);

  sendSuccess(res, result);
});

/**
 * 更新工作空间
 *
 * PUT /api/v1/workspaces/:id
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const updateWorkspace = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const workspaceId = parseInt(req.params.id);
  const { name, description, isDefault, settings } = req.body;

  const result = await workspaceService.updateWorkspace(userId, workspaceId, {
    name,
    description,
    isDefault,
    settings,
  });

  sendSuccess(res, result, '工作空间更新成功');
});

/**
 * 删除工作空间
 *
 * DELETE /api/v1/workspaces/:id
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const deleteWorkspace = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const workspaceId = parseInt(req.params.id);

  await workspaceService.deleteWorkspace(userId, workspaceId);

  sendSuccess(res, null, '工作空间删除成功');
});

/**
 * 验证工作目录
 *
 * POST /api/v1/workspaces/:id/validate
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const validateWorkspace = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const workspaceId = parseInt(req.params.id);

  const result = await workspaceService.validateWorkspace(userId, workspaceId);

  sendSuccess(res, result);
});

/**
 * 浏览工作空间文件
 *
 * GET /api/v1/workspaces/:id/files
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const browseFiles = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const workspaceId = parseInt(req.params.id);
  const { path: subPath } = req.query as { path?: string };

  const result = await workspaceService.browseFiles(userId, workspaceId, subPath);

  sendSuccess(res, result);
});
