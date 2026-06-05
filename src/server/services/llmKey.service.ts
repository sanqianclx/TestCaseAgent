/**
 * LLM API Key 服务
 *
 * 管理用户自己的 DeepSeek API Key。
 * 每个用户可以有多个 Key，但只能启用一个。
 */

import prisma from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { ErrorCode } from '../utils/response.js';
import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.JWT_SECRET || 'testgenerate-jwt-secret-key-2026';
const ALGORITHM = 'aes-256-cbc';

/**
 * 加密 API Key
 */
function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY.slice(0, 32).padEnd(32, '0')), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * 解密 API Key
 */
function decrypt(encrypted: string): string {
  const parts = encrypted.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY.slice(0, 32).padEnd(32, '0')), iv);
  let decrypted = decipher.update(parts[1], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * 获取用户当前启用的 API Key（解密后的真实 key）
 *
 * @param userId 用户 ID
 * @returns API Key 字符串
 */
export async function getActiveApiKey(userId: number): Promise<string | null> {
  const apiKey = await prisma.apiKey.findFirst({
    where: {
      userId,
      isActive: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!apiKey) {
    return null;
  }

  try {
    return decrypt(apiKey.keyHash);
  } catch (error) {
    console.error('解密 API Key 失败:', error);
    return null;
  }
}

/**
 * 验证 API Key 是否有效（通过调用 DeepSeek API）
 */
export async function validateApiKey(apiKey: string): Promise<{ valid: boolean; message: string }> {
  try {
    const response = await fetch('https://api.deepseek.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (response.ok) {
      return { valid: true, message: 'API Key 有效' };
    } else if (response.status === 401) {
      return { valid: false, message: 'API Key 无效' };
    } else {
      return { valid: false, message: `API 返回错误: ${response.status}` };
    }
  } catch (error: any) {
    return { valid: false, message: `网络错误: ${error.message}` };
  }
}

/**
 * 创建 API Key
 */
export async function createApiKey(
  userId: number,
  params: {
    name: string;
    apiKey: string;
  }
): Promise<{ id: number; name: string; prefix: string; preview: string }> {
  const { name, apiKey } = params;

  // 加密存储
  const encrypted = encrypt(apiKey);
  const prefix = apiKey.slice(0, 7);
  const preview = `${apiKey.slice(0, 7)}...${apiKey.slice(-4)}`;

  // 创建记录
  const record = await prisma.apiKey.create({
    data: {
      userId,
      name,
      keyHash: encrypted,
      prefix,
      permissions: JSON.stringify(['read', 'generate', 'execute']),
      rateLimit: 1000,
      isActive: true,
    },
  });

  return {
    id: Number(record.id),
    name: record.name,
    prefix,
    preview,
  };
}

/**
 * 获取用户的 API Key 列表
 */
export async function getApiKeys(userId: number) {
  const keys = await prisma.apiKey.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      prefix: true,
      permissions: true,
      rateLimit: true,
      expiresAt: true,
      lastUsedAt: true,
      usageCount: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return keys;
}

/**
 * 启用某个 API Key（自动禁用其他）
 */
export async function activateApiKey(userId: number, apiKeyId: number) {
  // 检查 Key 是否存在
  const existing = await prisma.apiKey.findFirst({
    where: { id: apiKeyId, userId },
  });

  if (!existing) {
    throw new AppError(ErrorCode.API_KEY_NOT_FOUND, 'API Key 不存在');
  }

  // 禁用所有 Key
  await prisma.apiKey.updateMany({
    where: { userId },
    data: { isActive: false },
  });

  // 启用指定 Key
  const result = await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: { isActive: true },
  });

  return result;
}

/**
 * 删除 API Key
 */
export async function deleteApiKey(userId: number, apiKeyId: number): Promise<void> {
  const existing = await prisma.apiKey.findFirst({
    where: { id: apiKeyId, userId },
  });

  if (!existing) {
    throw new AppError(ErrorCode.API_KEY_NOT_FOUND, 'API Key 不存在');
  }

  await prisma.apiKey.delete({
    where: { id: apiKeyId },
  });
}

export { encrypt, decrypt };
