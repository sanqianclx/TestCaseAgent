/**
 * 认证控制器
 */

import { Request, Response } from 'express';
import * as authService from '../services/auth.service.js';
import { sendSuccess, sendError, ErrorCode } from '../utils/response.js';
import { asyncHandler } from '../middleware/errorHandler.js';

function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string }
) {
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };

  res.cookie('tg_access_token', tokens.accessToken, {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  res.cookie('tg_refresh_token', tokens.refreshToken, {
    ...cookieOptions,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

/**
 * 用户注册
 */
export const register = asyncHandler(async (req: Request, res: Response) => {
  const { username, email, password } = req.body;

  const result = await authService.register({ username, email, password });
  setAuthCookies(res, result);

  sendSuccess(res, result, '注册成功', 201);
});

/**
 * 用户登录
 */
export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const result = await authService.login({ email, password });
  setAuthCookies(res, result);

  sendSuccess(res, result, '登录成功');
});

/**
 * 刷新 Token
 */
export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const refreshToken = req.body.refreshToken || req.cookies?.['tg_refresh_token'];

  if (!refreshToken) {
    sendError(res, ErrorCode.AUTH_TOKEN_INVALID, '缺少 Refresh Token');
    return;
  }

  const result = await authService.refreshToken(refreshToken);
  setAuthCookies(res, result);

  sendSuccess(res, result, 'Token 刷新成功');
});

/**
 * 获取当前用户信息
 */
export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const user = await authService.getUserProfile(userId);

  sendSuccess(res, user);
});

/**
 * 更新个人资料
 */
export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { username, avatarUrl, preferences } = req.body;

  const user = await authService.updateUserProfile(userId, {
    username,
    avatarUrl,
    preferences,
  });

  sendSuccess(res, user, '个人资料更新成功');
});

/**
 * 修改密码
 */
export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { oldPassword, newPassword } = req.body;

  await authService.changePassword(userId, oldPassword, newPassword);

  sendSuccess(res, null, '密码修改成功');
});

/**
 * 用户登出
 */
export const logout = asyncHandler(async (req: Request, res: Response) => {
  res.clearCookie('tg_access_token', { path: '/' });
  res.clearCookie('tg_refresh_token', { path: '/' });
  sendSuccess(res, null, '登出成功');
});
