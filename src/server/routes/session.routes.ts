/**
 * 会话路由
 *
 * 定义会话和消息管理相关的路由。
 */

import { Router } from 'express';
import * as sessionController from '../controllers/session.controller.js';
import { authenticate } from '../middleware/auth.js';
import {
  validateBody,
  validateParams,
  validateQuery,
  createSessionSchema,
  updateSessionSchema,
  sendMessageSchema,
  paginationSchema,
  idParamSchema,
} from '../middleware/validator.js';
import { z } from 'zod';

const router = Router();

// 所有路由都需要认证
router.use(authenticate);

/**
 * 会话查询参数验证模式
 */
const sessionQuerySchema = paginationSchema.extend({
  status: z.enum(['active', 'archived', 'deleted']).optional(),
  workspaceId: z.coerce.number().int().positive().optional(),
});

/**
 * 消息查询参数验证模式
 */
const messageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  before: z.coerce.number().int().positive().optional(),
});

const outputPathQuerySchema = z.object({
  path: z.string().optional(),
  encoding: z.string().optional(),
});

/**
 * GET /api/v1/sessions/stats
 * 获取会话统计
 */
router.get('/stats', sessionController.getSessionStats);

/**
 * GET /api/v1/sessions
 * 获取会话列表
 */
router.get('/', validateQuery(sessionQuerySchema), sessionController.getSessions);

/**
 * POST /api/v1/sessions
 * 创建会话
 */
router.post('/', validateBody(createSessionSchema), sessionController.createSession);

/**
 * GET /api/v1/sessions/:id
 * 获取会话详情
 */
router.get('/:id', validateParams(idParamSchema), sessionController.getSessionById);

/**
 * PUT /api/v1/sessions/:id
 * 更新会话
 */
router.put('/:id', validateParams(idParamSchema), validateBody(updateSessionSchema), sessionController.updateSession);

/**
 * DELETE /api/v1/sessions/:id
 * 删除会话
 */
router.delete('/:id', validateParams(idParamSchema), sessionController.deleteSession);

/**
 * POST /api/v1/sessions/:id/archive
 * 归档会话
 */
router.post('/:id/archive', validateParams(idParamSchema), sessionController.archiveSession);

/**
 * GET /api/v1/sessions/:id/messages
 * 获取消息历史
 */
router.get('/:id/messages', validateParams(idParamSchema), validateQuery(messageQuerySchema), sessionController.getMessages);

/**
 * GET /api/v1/sessions/:id/output-files
 * 浏览当前会话输出目录
 */
router.get('/:id/output-files', validateParams(idParamSchema), validateQuery(outputPathQuerySchema), sessionController.getSessionOutputFiles);

/**
 * GET /api/v1/sessions/:id/output-file
 * 读取当前会话输出目录中的文件内容
 */
router.get('/:id/output-file', validateParams(idParamSchema), validateQuery(outputPathQuerySchema), sessionController.getSessionOutputFileContent);

/**
 * POST /api/v1/sessions/:id/messages
 * 发送消息
 */
router.post('/:id/messages', validateParams(idParamSchema), validateBody(sendMessageSchema), sessionController.sendMessage);

export default router;
