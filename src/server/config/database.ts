/**
 * 数据库连接配置
 *
 * 使用 Prisma Client 连接 MySQL 数据库，
 * 提供单例模式确保连接池复用。
 */

import { PrismaClient } from '@prisma/client';

/**
 * Prisma 客户端单例
 *
 * 在开发环境下将实例挂载到 globalThis，
 * 避免热重载时创建多个连接池。
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * 获取 Prisma 客户端实例
 *
 * @returns PrismaClient 实例
 */
export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  errorFormat: 'pretty',
});

// 开发环境保存到全局，避免热重载创建多个连接
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * 测试数据库连接
 *
 * @returns 连接是否成功
 */
export async function testDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ 数据库连接成功');
    return true;
  } catch (error) {
    console.error('❌ 数据库连接失败:', error);
    return false;
  }
}

/**
 * 关闭数据库连接
 *
 * 在应用关闭时调用，释放连接池资源。
 */
export async function closeDatabaseConnection(): Promise<void> {
  await prisma.$disconnect();
  console.log('🔌 数据库连接已关闭');
}

export default prisma;
