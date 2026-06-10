/**
 * API Key 服务
 *
 * 处理 API Key 的创建、查询、更新、删除等业务逻辑。
 * 注意：这里的 API Key 实际是用户自己的 DeepSeek API Key
 */

import prisma from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { ErrorCode, createPagination } from '../utils/response.js';
import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.JWT_SECRET || 'testgenerate-jwt-secret-key-2026';

/**
 * 加密 API Key
 */
function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const key = Buffer.from(ENCRYPTION_KEY.slice(0, 32).padEnd(32, '0'));
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
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
  const key = Buffer.from(ENCRYPTION_KEY.slice(0, 32).padEnd(32, '0'));
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(parts[1], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * 验证 DeepSeek API Key
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
) {
  const { name, apiKey } = params;

  // 加密存储
  const encrypted = encrypt(apiKey);
  const prefix = apiKey.slice(0, 7);
  const preview = `${apiKey.slice(0, 7)}...${apiKey.slice(-4)}`;

  // 创建记录（默认启用）
  const record = await prisma.apiKey.create({
    data: {
      userId,
      name,
      keyHash: encrypted,
      prefix,
      permissions: JSON.stringify(['read', 'generate']),
      rateLimit: 1000,
      isActive: true,  // 新建默认启用
    },
  });

  // 禁用其他 Key（确保只有一个启用）
  await prisma.apiKey.updateMany({
    where: {
      userId,
      id: { not: record.id },
    },
    data: { isActive: false },
  });

  return {
    id: Number(record.id),
    name: record.name,
    prefix,
    preview,
  };
}

/**
 * 获取用户的所有 API Key
 */
export async function getApiKeys(
  userId: number,
  page: number = 1,
  pageSize: number = 20,
  isActive?: boolean
) {
  const { skip, take } = createPagination(page, pageSize);

  const where: any = { userId };
  if (isActive !== undefined) where.isActive = isActive;

  const [items, total] = await Promise.all([
    prisma.apiKey.findMany({
      where,
      select: {
        id: true,
        name: true,
        prefix: true,
        isActive: true,
        usageCount: true,
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: [
        { isActive: 'desc' },
        { createdAt: 'desc' },
      ],
      skip,
      take,
    }),
    prisma.apiKey.count({ where }),
  ]);

  return {
    items: items.map(item => ({
      ...item,
      id: Number(item.id),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * 激活 API Key（自动禁用其他）
 */
export async function activateApiKey(userId: number, apiKeyId: number) {
  // 检查 Key 是否存在
  const existing = await prisma.apiKey.findFirst({
    where: { id: apiKeyId, userId },
  });

  if (!existing) {
    throw new AppError(ErrorCode.API_KEY_NOT_FOUND, 'API Key 不存在');
  }

  // 先禁用所有
  await prisma.apiKey.updateMany({
    where: { userId },
    data: { isActive: false },
  });

  // 再启用指定 Key
  const updated = await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: { isActive: true },
  });

  return {
    id: Number(updated.id),
    name: updated.name,
    prefix: updated.prefix,
    isActive: updated.isActive,
  };
}

/**
 * 停用 API Key
 */
export async function deactivateApiKey(userId: number, apiKeyId: number) {
  const existing = await prisma.apiKey.findFirst({
    where: { id: apiKeyId, userId },
  });

  if (!existing) {
    throw new AppError(ErrorCode.API_KEY_NOT_FOUND, 'API Key 不存在');
  }

  const updated = await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: { isActive: false },
  });

  return {
    id: Number(updated.id),
    name: updated.name,
    isActive: updated.isActive,
  };
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

/**
 * 获取用户当前激活的 API Key
 */
export async function getActiveApiKey(userId: number): Promise<string | null> {
  const activeKey = await prisma.apiKey.findFirst({
    where: { userId, isActive: true },
  });

  if (!activeKey) return null;

  try {
    return decrypt(activeKey.keyHash);
  } catch {
    return null;
  }
}

/**
 * 获取 API Key 统计
 */
export async function getApiKeyStats(userId: number) {
  const [total, active, totalUsage] = await Promise.all([
    prisma.apiKey.count({ where: { userId } }),
    prisma.apiKey.count({ where: { userId, isActive: true } }),
    prisma.apiKey.aggregate({
      where: { userId },
      _sum: { usageCount: true },
    }),
  ]);

  return {
    total,
    active,
    inactive: total - active,
    totalUsage: Number(totalUsage._sum.usageCount || 0),
  };
}
