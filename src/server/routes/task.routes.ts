/**
 * 任务路由
 *
 * 定义测试生成任务管理相关的路由。
 */

import { Router } from 'express';
import * as taskController from '../controllers/task.controller.js';
import { authenticate } from '../middleware/auth.js';
import {
  validateBody,
  validateParams,
  validateQuery,
  createTaskSchema,
  taskQuerySchema,
  uuidParamSchema,
} from '../middleware/validator.js';
import { z } from 'zod';

const router = Router();

// 所有路由都需要认证
router.use(authenticate);

/**
 * 任务日志查询参数验证模式
 */
const taskLogsQuerySchema = z.object({
  level: z.enum(['info', 'warn', 'error', 'debug', 'step']).transform((value) => value.toLowerCase()).optional(),
  step: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * GET /api/v1/tasks/stats
 * 获取任务统计
 */
router.get('/stats', taskController.getTaskStats);

/**
 * GET /api/v1/tasks
 * 获取任务列表
 */
router.get('/', validateQuery(taskQuerySchema), taskController.getTasks);

/**
 * POST /api/v1/tasks
 * 创建任务
 */
router.post('/', validateBody(createTaskSchema), taskController.createTask);

/**
 * GET /api/v1/tasks/:taskId
 * 获取任务详情
 */
router.get('/:taskId', taskController.getTaskById);

/**
 * GET /api/v1/tasks/:taskId/logs
 * 获取任务日志
 */
router.get('/:taskId/logs', validateQuery(taskLogsQuerySchema), taskController.getTaskLogs);

/**
 * POST /api/v1/tasks/:taskId/cancel
 * 取消任务
 */
router.post('/:taskId/cancel', taskController.cancelTask);

/**
 * POST /api/v1/tasks/:taskId/retry
 * 重试任务
 */
router.post('/:taskId/retry', taskController.retryTask);

/**
 * DELETE /api/v1/tasks/:taskId
 * 物理删除任务（仅限非运行中）
 */
router.delete('/:taskId', taskController.deleteTask);

/**
 * GET /api/v1/tasks/:taskId/result
 * 获取任务结果
 */
router.get('/:taskId/result', taskController.getTaskResult);

export default router;
