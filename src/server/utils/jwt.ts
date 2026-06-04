/**
 * JWT 工具
 *
 * 提供 JWT Token 的生成、验证和解析功能。
 * 支持 Access Token 和 Refresh Token。
 */

import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/**
 * JWT Payload 接口
 */
export interface JwtPayload {
  sub: number;        // 用户 ID
  email: string;      // 用户邮箱
  role: string;       // 用户角色
  type?: 'access' | 'refresh';  // Token 类型
}

/**
 * Token 对象接口
 */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Token 验证结果接口
 */
export interface TokenVerificationResult {
  valid: boolean;
  payload?: JwtPayload;
  error?: string;
}

/**
 * 生成 Access Token
 *
 * @param payload JWT Payload
 * @returns Access Token 字符串
 */
export function generateAccessToken(payload: Omit<JwtPayload, 'type'>): string {
  return jwt.sign(
    { ...payload, type: 'access' },
    env.jwt.secret,
    { expiresIn: env.jwt.expiresIn }
  );
}

/**
 * 生成 Refresh Token
 *
 * @param payload JWT Payload
 * @returns Refresh Token 字符串
 */
export function generateRefreshToken(payload: Omit<JwtPayload, 'type'>): string {
  return jwt.sign(
    { ...payload, type: 'refresh' },
    env.jwt.secret,
    { expiresIn: env.jwt.refreshExpiresIn }
  );
}

/**
 * 生成 Token 对（Access + Refresh）
 *
 * @param payload JWT Payload
 * @returns Token 对象
 */
export function generateTokenPair(payload: Omit<JwtPayload, 'type'>): TokenPair {
  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken(payload),
  };
}

/**
 * 验证 Token
 *
 * @param token Token 字符串
 * @param expectedType 期望的 Token 类型
 * @returns 验证结果
 */
export function verifyToken(
  token: string,
  expectedType: 'access' | 'refresh' = 'access'
): TokenVerificationResult {
  try {
    const payload = jwt.verify(token, env.jwt.secret) as JwtPayload;

    // 验证 Token 类型
    if (payload.type !== expectedType) {
      return {
        valid: false,
        error: `期望 ${expectedType} token，但收到 ${payload.type} token`,
      };
    }

    return {
      valid: true,
      payload,
    };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return {
        valid: false,
        error: 'Token 已过期',
      };
    }

    if (error instanceof jwt.JsonWebTokenError) {
      return {
        valid: false,
        error: 'Token 无效',
      };
    }

    return {
      valid: false,
      error: 'Token 验证失败',
    };
  }
}

/**
 * 解析 Token（不验证签名）
 *
 * @param token Token 字符串
 * @returns Payload 或 null
 */
export function decodeToken(token: string): JwtPayload | null {
  try {
    return jwt.decode(token) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * 从 Authorization 头提取 Token
 *
 * @param authorization Authorization 头值
 * @returns Token 字符串或 null
 */
export function extractTokenFromHeader(authorization: string | undefined): string | null {
  if (!authorization) return null;

  const parts = authorization.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}
