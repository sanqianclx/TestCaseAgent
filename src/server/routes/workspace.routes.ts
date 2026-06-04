/**
 * 工作空间路由
 *
 * 定义工作空间管理相关的路由。
 */

import { Router } from 'express';
import * as workspaceController from '../controllers/workspace.controller.js';
import { authenticate } from '../middleware/auth.js';
import {
  validateBody,
  validateParams,
  validateQuery,
  createWorkspaceSchema,
  updateWorkspaceSchema,
  idParamSchema,
} from '../middleware/validator.js';
import { z } from 'zod';

const router = Router();

// 所有路由都需要认证
router.use(authenticate);

/**
 * 文件浏览查询参数验证模式
 */
const browseQuerySchema = z.object({
  path: z.string().optional(),
});

/**
 * GET /api/v1/workspaces
 * 获取工作空间列表
 */
router.get('/', workspaceController.getWorkspaces);

/**
 * POST /api/v1/workspaces
 * 创建工作空间
 */
router.post('/', validateBody(createWorkspaceSchema), workspaceController.createWorkspace);

/**
 * GET /api/v1/workspaces/:id
 * 获取工作空间详情
 */
router.get('/:id', validateParams(idParamSchema), workspaceController.getWorkspaceById);

/**
 * PUT /api/v1/workspaces/:id
 * 更新工作空间
 */
router.put('/:id', validateParams(idParamSchema), validateBody(updateWorkspaceSchema), workspaceController.updateWorkspace);

/**
 * DELETE /api/v1/workspaces/:id
 * 删除工作空间
 */
router.delete('/:id', validateParams(idParamSchema), workspaceController.deleteWorkspace);

/**
 * POST /api/v1/workspaces/:id/validate
 * 验证工作目录
 */
router.post('/:id/validate', validateParams(idParamSchema), workspaceController.validateWorkspace);

/**
 * GET /api/v1/workspaces/:id/files
 * 浏览工作空间文件
 */
router.get('/:id/files', validateParams(idParamSchema), validateQuery(browseQuerySchema), workspaceController.browseFiles);

export default router;
