/**
 * 文件控制器
 *
 * 处理文件的上传、查询、删除等 HTTP 请求。
 */

import { Request, Response } from 'express';
import * as fileService from '../services/file.service.js';
import { sendSuccess, sendPaginated, sendError, ErrorCode } from '../utils/response.js';
import { asyncHandler } from '../middleware/errorHandler.js';

/**
 * 上传文件
 *
 * POST /api/v1/files/upload
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const uploadFile = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const file = req.file;

  if (!file) {
    sendError(res, ErrorCode.FILE_UPLOAD_FAILED, '请选择要上传的文件');
    return;
  }

  const { workspaceId, sessionId, purpose } = req.body;

  const result = await fileService.uploadFile(file, {
    userId,
    workspaceId: workspaceId ? parseInt(workspaceId) : undefined,
    sessionId: sessionId ? parseInt(sessionId) : undefined,
    purpose,
  });

  sendSuccess(res, result, '文件上传成功', 201);
});

/**
 * 批量上传文件
 *
 * POST /api/v1/files/upload-multiple
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const uploadMultipleFiles = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const files = req.files as Express.Multer.File[];

  if (!files || files.length === 0) {
    sendError(res, ErrorCode.FILE_UPLOAD_FAILED, '请选择要上传的文件');
    return;
  }

  const { workspaceId, sessionId, purpose } = req.body;

  const result = await fileService.uploadMultipleFiles(files, {
    userId,
    workspaceId: workspaceId ? parseInt(workspaceId) : undefined,
    sessionId: sessionId ? parseInt(sessionId) : undefined,
    purpose,
  });

  sendSuccess(res, result, '文件上传完成');
});

/**
 * 获取文件列表
 *
 * GET /api/v1/files
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const getFiles = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { page, pageSize, workspaceId, sessionId, purpose } = req.query as any;

  const result = await fileService.getFiles(
    userId,
    page ? parseInt(page) : 1,
    pageSize ? parseInt(pageSize) : 20,
    workspaceId ? parseInt(workspaceId) : undefined,
    sessionId ? parseInt(sessionId) : undefined,
    purpose
  );

  sendPaginated(res, result.items, result.total, result.page, result.pageSize);
});

/**
 * 获取文件详情
 *
 * GET /api/v1/files/:id
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const getFileById = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const fileId = parseInt(req.params.id);

  const result = await fileService.getFileById(userId, fileId);

  sendSuccess(res, result);
});

/**
 * 获取文件内容
 *
 * GET /api/v1/files/:id/content
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const getFileContent = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const fileId = parseInt(req.params.id);

  const result = await fileService.getFileContent(userId, fileId);

  sendSuccess(res, result);
});

/**
 * 删除文件
 *
 * DELETE /api/v1/files/:id
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const deleteFile = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const fileId = parseInt(req.params.id);

  await fileService.deleteFile(userId, fileId);

  sendSuccess(res, null, '文件删除成功');
});

/**
 * 分析文件
 *
 * POST /api/v1/files/:id/analyze
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const analyzeFile = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const fileId = parseInt(req.params.id);

  const result = await fileService.analyzeFile(userId, fileId);

  sendSuccess(res, result);
});

/**
 * 获取文件统计
 *
 * GET /api/v1/files/stats
 *
 * @param req 请求对象
 * @param res 响应对象
 */
export const getFileStats = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const result = await fileService.getFileStats(userId);

  sendSuccess(res, result);
});
