/**
 * 加密工具
 *
 * 提供密码哈希、API Key 生成等加密相关功能。
 */

import bcrypt from 'bcryptjs';
import crypto from 'crypto';

/**
 * 盐值轮数
 */
const SALT_ROUNDS = 10;

/**
 * 对密码进行哈希处理
 *
 * @param password 原始密码
 * @returns 哈希后的密码
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * 验证密码是否匹配
 *
 * @param password 原始密码
 * @param hash 哈希值
 * @returns 是否匹配
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * 生成 API Key
 *
 * 格式: tg_{prefix}_{random}
 * 示例: tg_abc123_xK9mN2pL5qR8sT1vW3yZ
 *
 * @returns 包含完整 key、hash 和 prefix 的对象
 */
export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const prefix = crypto.randomBytes(4).toString('hex');
  const random = crypto.randomBytes(24).toString('hex');
  const key = `tg_${prefix}_${random}`;
  const hash = bcrypt.hashSync(key, SALT_ROUNDS);

  return { key, hash, prefix };
}

/**
 * 验证 API Key 是否匹配
 *
 * @param key 原始 API Key
 * @param hash 哈希值
 * @returns 是否匹配
 */
export async function verifyApiKey(key: string, hash: string): Promise<boolean> {
  return bcrypt.compare(key, hash);
}

/**
 * 生成随机字符串
 *
 * @param length 字符串长度
 * @returns 随机字符串
 */
export function generateRandomString(length: number = 32): string {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

/**
 * 生成 UUID
 *
 * @returns UUID 字符串
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * 计算 SHA256 哈希
 *
 * @param data 数据
 * @returns 哈希值
 */
export function sha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * 验证密码强度
 *
 * 要求：
 * - 至少 8 个字符
 * - 包含大写字母
 * - 包含小写字母
 * - 包含数字
 *
 * @param password 密码
 * @returns 是否符合强度要求
 */
export function isPasswordStrong(password: string): boolean {
  if (password.length < 8) return false;

  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumbers = /\d/.test(password);

  return hasUpperCase && hasLowerCase && hasNumbers;
}

/**
 * 生成密码强度建议
 *
 * @param password 密码
 * @returns 建议列表
 */
export function getPasswordStrengthSuggestions(password: string): string[] {
  const suggestions: string[] = [];

  if (password.length < 8) {
    suggestions.push('密码至少需要 8 个字符');
  }
  if (!/[A-Z]/.test(password)) {
    suggestions.push('密码需要包含大写字母');
  }
  if (!/[a-z]/.test(password)) {
    suggestions.push('密码需要包含小写字母');
  }
  if (!/\d/.test(password)) {
    suggestions.push('密码需要包含数字');
  }

  return suggestions;
}
