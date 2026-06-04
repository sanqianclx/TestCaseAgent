/**
 * 认证服务
 *
 * 处理用户注册、登录、Token 刷新等认证相关业务逻辑。
 */

import prisma from '../config/database.js';
import { hashPassword, verifyPassword, isPasswordStrong } from '../utils/crypto.js';
import { generateTokenPair, verifyToken, JwtPayload } from '../utils/jwt.js';
import { AppError } from '../middleware/errorHandler.js';
import { ErrorCode } from '../utils/response.js';

/**
 * 用户注册参数
 */
export interface RegisterParams {
  username: string;
  email: string;
  password: string;
}

/**
 * 用户登录参数
 */
export interface LoginParams {
  email: string;
  password: string;
  rememberMe?: boolean;
}

/**
 * 认证响应
 */
export interface AuthResponse {
  user: {
    id: number;
    username: string;
    email: string;
    role: string;
    createdAt: Date;
  };
  accessToken: string;
  refreshToken: string;
}

/**
 * 用户注册
 *
 * @param params 注册参数
 * @returns 认证响应
 * @throws 当邮箱或用户名已存在时抛出错误
 */
export async function register(params: RegisterParams): Promise<AuthResponse> {
  const { username, email, password } = params;

  // 检查邮箱是否已存在
  const existingEmail = await prisma.user.findUnique({
    where: { email },
  });
  if (existingEmail) {
    throw new AppError(ErrorCode.AUTH_EMAIL_EXISTS, '邮箱已被注册');
  }

  // 检查用户名是否已存在
  const existingUsername = await prisma.user.findUnique({
    where: { username },
  });
  if (existingUsername) {
    throw new AppError(ErrorCode.AUTH_USERNAME_EXISTS, '用户名已被占用');
  }

  // 验证密码强度
  if (!isPasswordStrong(password)) {
    throw new AppError(ErrorCode.AUTH_PASSWORD_TOO_WEAK, '密码强度不足，需要包含大小写字母和数字');
  }

  // 哈希密码
  const passwordHash = await hashPassword(password);

  // 创建用户
  const user = await prisma.user.create({
    data: {
      username,
      email,
      passwordHash,
      role: 'user',
      status: 'active',
    },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });

  // 生成 Token
  const tokens = generateTokenPair({
    sub: Number(user.id),
    email: user.email,
    role: user.role,
  });

  return {
    user: {
      ...user,
      id: Number(user.id),
    },
    ...tokens,
  };
}

/**
 * 用户登录
 *
 * @param params 登录参数
 * @returns 认证响应
 * @throws 当邮箱或密码错误时抛出错误
 */
export async function login(params: LoginParams): Promise<AuthResponse> {
  const { email, password } = params;

  // 查找用户
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      username: true,
      email: true,
      passwordHash: true,
      role: true,
      status: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw new AppError(ErrorCode.AUTH_INVALID_CREDENTIALS, '邮箱或密码错误');
  }

  // 检查用户状态
  if (user.status !== 'active') {
    throw new AppError(ErrorCode.AUTH_UNAUTHORIZED, '账户已被禁用');
  }

  // 验证密码
  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    throw new AppError(ErrorCode.AUTH_INVALID_CREDENTIALS, '邮箱或密码错误');
  }

  // 更新最后登录信息
  await prisma.user.update({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(),
    },
  });

  // 生成 Token
  const tokens = generateTokenPair({
    sub: Number(user.id),
    email: user.email,
    role: user.role,
  });

  return {
    user: {
      id: Number(user.id),
      username: user.username,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    },
    ...tokens,
  };
}

/**
 * 刷新 Token
 *
 * @param refreshToken Refresh Token
 * @returns 新的 Token 对
 * @throws 当 Refresh Token 无效时抛出错误
 */
export async function refreshToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  // 验证 Refresh Token
  const result = verifyToken(refreshToken, 'refresh');

  if (!result.valid || !result.payload) {
    throw new AppError(ErrorCode.AUTH_TOKEN_INVALID, 'Refresh Token 无效或已过期');
  }

  // 查询用户
  const user = await prisma.user.findUnique({
    where: { id: result.payload.sub },
    select: { id: true, email: true, role: true, status: true },
  });

  if (!user || user.status !== 'active') {
    throw new AppError(ErrorCode.AUTH_USER_NOT_FOUND, '用户不存在或已被禁用');
  }

  // 生成新的 Token 对
  return generateTokenPair({
    sub: Number(user.id),
    email: user.email,
    role: user.role,
  });
}

/**
 * 获取用户信息
 *
 * @param userId 用户 ID
 * @returns 用户信息
 */
export async function getUserProfile(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      avatarUrl: true,
      role: true,
      status: true,
      emailVerified: true,
      preferences: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          apiKeys: true,
          workspaces: true,
          sessions: true,
          tasks: true,
        },
      },
    },
  });

  if (!user) {
    throw new AppError(ErrorCode.AUTH_USER_NOT_FOUND, '用户不存在');
  }

  return user;
}

/**
 * 更新用户资料
 *
 * @param userId 用户 ID
 * @param data 更新数据
 * @returns 更新后的用户信息
 */
export async function updateUserProfile(
  userId: number,
  data: {
    username?: string;
    avatarUrl?: string;
    preferences?: Record<string, any>;
  }
) {
  // 如果更新用户名，检查是否已存在
  if (data.username) {
    const existing = await prisma.user.findFirst({
      where: {
        username: data.username,
        id: { not: userId },
      },
    });
    if (existing) {
      throw new AppError(ErrorCode.AUTH_USERNAME_EXISTS, '用户名已被占用');
    }
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      username: true,
      email: true,
      avatarUrl: true,
      role: true,
      preferences: true,
      updatedAt: true,
    },
  });

  return user;
}

/**
 * 修改密码
 *
 * @param userId 用户 ID
 * @param oldPassword 旧密码
 * @param newPassword 新密码
 */
export async function changePassword(
  userId: number,
  oldPassword: string,
  newPassword: string
): Promise<void> {
  // 查询用户
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });

  if (!user) {
    throw new AppError(ErrorCode.AUTH_USER_NOT_FOUND, '用户不存在');
  }

  // 验证旧密码
  const isValid = await verifyPassword(oldPassword, user.passwordHash);
  if (!isValid) {
    throw new AppError(ErrorCode.AUTH_INVALID_CREDENTIALS, '旧密码错误');
  }

  // 验证新密码强度
  if (!isPasswordStrong(newPassword)) {
    throw new AppError(ErrorCode.AUTH_PASSWORD_TOO_WEAK, '新密码强度不足');
  }

  // 哈希新密码并更新
  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });
}
