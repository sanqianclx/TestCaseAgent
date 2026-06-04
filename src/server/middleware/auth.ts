/**
 * 认证中间件
 *
 * 提供 JWT Token 认证和 API Key 认证两种方式。
 * 支持混合认证模式，优先使用 API Key。
 */

import { Request, Response, NextFunction } from 'express';
import { verifyToken, extractTokenFromHeader, JwtPayload } from '../utils/jwt.js';
import { verifyApiKey } from '../utils/crypto.js';
import { sendError, ErrorCode } from '../utils/response.js';
import prisma from '../config/database.js';

/**
 * 扩展 Request 接口，添加用户信息
 */
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        email: string;
        role: string;
        username: string;
      };
      apiKeyId?: number;
    }
  }
}

/**
 * JWT Token 认证中间件
 *
 * 从 Authorization 头或 Cookie 提取 Bearer Token 并验证。
 * 验证成功后将用户信息添加到 req.user。
 */
export async function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // 优先从 Authorization 头读取，其次从 Cookie 读取
    let token = extractTokenFromHeader(req.headers.authorization);

    if (!token) {
      token = req.cookies?.['tg_access_token'];
    }

    if (!token) {
      sendError(res, ErrorCode.AUTH_UNAUTHORIZED, '缺少认证 Token');
      return;
    }

    const result = verifyToken(token, 'access');

    if (!result.valid || !result.payload) {
      sendError(res, ErrorCode.AUTH_TOKEN_INVALID, result.error || 'Token 无效');
      return;
    }

    // 查询用户信息
    const user = await prisma.user.findUnique({
      where: { id: result.payload.sub },
      select: { id: true, email: true, role: true, username: true, status: true },
    });

    if (!user) {
      sendError(res, ErrorCode.AUTH_USER_NOT_FOUND, '用户不存在');
      return;
    }

    if (user.status !== 'active') {
      sendError(res, ErrorCode.AUTH_UNAUTHORIZED, '账户已被禁用');
      return;
    }

    req.user = {
      id: Number(user.id),
      email: user.email,
      role: user.role,
      username: user.username,
    };

    next();
  } catch (error) {
    console.error('认证中间件错误:', error);
    sendError(res, ErrorCode.SYSTEM_INTERNAL_ERROR, '认证失败');
  }
}

/**
 * API Key 认证中间件
 *
 * 从 X-API-Key 头提取 API Key 并验证。
 * 验证成功后将用户信息添加到 req.user。
 *
 * @param req Express 请求对象
 * @param res Express 响应对象
 * @param next 下一个中间件
 */
export async function authenticateApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const apiKey = req.headers['x-api-key'] as string;

    if (!apiKey) {
      sendError(res, ErrorCode.AUTH_UNAUTHORIZED, '缺少 API Key');
      return;
    }

    // 通过前缀查找 API Key
    const prefix = apiKey.split('_')[1];
    if (!prefix) {
      sendError(res, ErrorCode.API_KEY_INVALID, 'API Key 格式无效');
      return;
    }

    const apiKeyRecord = await prisma.apiKey.findFirst({
      where: {
        prefix,
        isActive: true,
      },
      include: {
        user: {
          select: { id: true, email: true, role: true, username: true, status: true },
        },
      },
    });

    if (!apiKeyRecord) {
      sendError(res, ErrorCode.API_KEY_NOT_FOUND, 'API Key 不存在');
      return;
    }

    // 检查是否过期
    if (apiKeyRecord.expiresAt && apiKeyRecord.expiresAt < new Date()) {
      sendError(res, ErrorCode.API_KEY_EXPIRED, 'API Key 已过期');
      return;
    }

    // 验证 Key
    const isValid = await verifyApiKey(apiKey, apiKeyRecord.keyHash);
    if (!isValid) {
      sendError(res, ErrorCode.API_KEY_INVALID, 'API Key 无效');
      return;
    }

    // 检查用户状态
    if (apiKeyRecord.user.status !== 'active') {
      sendError(res, ErrorCode.AUTH_UNAUTHORIZED, '账户已被禁用');
      return;
    }

    // 更新使用统计
    await prisma.apiKey.update({
      where: { id: apiKeyRecord.id },
      data: {
        lastUsedAt: new Date(),
        lastUsedIp: req.ip,
        usageCount: { increment: 1 },
      },
    });

    req.user = {
      id: apiKeyRecord.user.id,
      email: apiKeyRecord.user.email,
      role: apiKeyRecord.user.role,
      username: apiKeyRecord.user.username,
    };
    req.apiKeyId = apiKeyRecord.id;

    next();
  } catch (error) {
    console.error('API Key 认证错误:', error);
    sendError(res, ErrorCode.SYSTEM_INTERNAL_ERROR, '认证失败');
  }
}

/**
 * 混合认证中间件
 *
 * 优先使用 API Key，其次使用 JWT Token。
 *
 * @param req Express 请求对象
 * @param res Express 响应对象
 * @param next 下一个中间件
 */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const apiKey = req.headers['x-api-key'] as string;
  const authorization = req.headers.authorization;

  // 优先使用 API Key
  if (apiKey) {
    return authenticateApiKey(req, res, next);
  }

  // 其次使用 JWT Token
  if (authorization) {
    return authenticateToken(req, res, next);
  }

  sendError(res, ErrorCode.AUTH_UNAUTHORIZED, '缺少认证信息');
}

/**
 * 角色授权中间件
 *
 * 检查用户是否具有所需角色。
 *
 * @param roles 允许的角色列表
 * @returns 中间件函数
 */
export function authorize(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendError(res, ErrorCode.AUTH_UNAUTHORIZED, '未认证');
      return;
    }

    if (!roles.includes(req.user.role)) {
      sendError(res, ErrorCode.AUTH_UNAUTHORIZED, '权限不足');
      return;
    }

    next();
  };
}

/**
 * 管理员权限中间件
 *
 * 只允许 admin 和 super_admin 角色访问。
 */
export const adminOnly = authorize('admin', 'super_admin');

/**
 * 超级管理员权限中间件
 *
 * 只允许 super_admin 角色访问。
 */
export const superAdminOnly = authorize('super_admin');
