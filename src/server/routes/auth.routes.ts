/**
 * 认证路由
 *
 * 定义用户注册、登录、Token 刷新等认证相关的路由。
 */

import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.js';
import {
  validateBody,
  registerSchema,
  loginSchema,
  updateProfileSchema,
  changePasswordSchema,
} from '../middleware/validator.js';
import { z } from 'zod';

const router = Router();

/**
 * Refresh Token 验证模式
 */
const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh Token 不能为空'),
});

/**
 * POST /api/v1/auth/register
 * 用户注册
 */
router.post('/register', validateBody(registerSchema), authController.register);

/**
 * POST /api/v1/auth/login
 * 用户登录
 */
router.post('/login', validateBody(loginSchema), authController.login);

/**
 * POST /api/v1/auth/refresh
 * 刷新 Token
 */
router.post('/refresh', validateBody(refreshSchema), authController.refresh);

/**
 * POST /api/v1/auth/logout
 * 用户登出
 */
router.post('/logout', authController.logout);

/**
 * GET /api/v1/auth/me
 * 获取当前用户信息（需要认证）
 */
router.get('/me', authenticate, authController.getMe);

/**
 * PUT /api/v1/auth/profile
 * 更新个人资料（需要认证）
 */
router.put('/profile', authenticate, validateBody(updateProfileSchema), authController.updateProfile);

/**
 * PUT /api/v1/auth/password
 * 修改密码（需要认证）
 */
router.put('/password', authenticate, validateBody(changePasswordSchema), authController.changePassword);

export default router;
