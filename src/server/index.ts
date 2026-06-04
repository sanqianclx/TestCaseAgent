/**
 * 服务器入口
 *
 * 启动 Express 服务器，初始化数据库连接。
 */

import { createApp } from './app.js';
import { env } from './config/env.js';
import { testDatabaseConnection, closeDatabaseConnection } from './config/database.js';

/**
 * 启动服务器
 */
async function main(): Promise<void> {
  console.log('🚀 正在启动 TestGenerate Agent API 服务器...');
  console.log(`📦 环境: ${env.server.nodeEnv}`);
  console.log(`🌐 主机: ${env.server.host}:${env.server.port}`);

  // 测试数据库连接
  const dbConnected = await testDatabaseConnection();
  if (!dbConnected) {
    console.error('❌ 数据库连接失败，服务器启动中止');
    process.exit(1);
  }

  // 创建应用
  const app = createApp();

  // 启动服务器
  const server = app.listen(env.server.port, env.server.host, () => {
    console.log('✅ 服务器启动成功！');
    console.log(`🔗 API 地址: http://${env.server.host}:${env.server.port}/api/v1`);
    console.log(`📚 健康检查: http://${env.server.host}:${env.server.port}/api/v1/health`);
    console.log('');
    console.log('可用的 API 端点:');
    console.log('  - POST   /api/v1/auth/register     用户注册');
    console.log('  - POST   /api/v1/auth/login        用户登录');
    console.log('  - GET    /api/v1/auth/me           获取当前用户');
    console.log('  - GET    /api/v1/api-keys          API Key 列表');
    console.log('  - POST   /api/v1/api-keys          创建 API Key');
    console.log('  - GET    /api/v1/workspaces        工作空间列表');
    console.log('  - POST   /api/v1/workspaces        创建工作空间');
    console.log('  - GET    /api/v1/sessions          会话列表');
    console.log('  - POST   /api/v1/sessions          创建会话');
    console.log('  - POST   /api/v1/files/upload      上传文件');
    console.log('  - GET    /api/v1/tasks             任务列表');
    console.log('  - POST   /api/v1/tasks             创建任务');
    console.log('');
  });

  // 优雅关闭
  const gracefulShutdown = async (signal: string) => {
    console.log(`\n📡 收到 ${signal} 信号，正在优雅关闭...`);

    server.close(async () => {
      console.log('🔌 HTTP 服务器已关闭');

      // 关闭数据库连接
      await closeDatabaseConnection();

      console.log('👋 服务器已完全关闭');
      process.exit(0);
    });

    // 超时强制关闭
    setTimeout(() => {
      console.error('⚠️ 关闭超时，强制退出');
      process.exit(1);
    }, 10000);
  };

  // 监听关闭信号
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // 未捕获异常处理
  process.on('uncaughtException', (error) => {
    console.error('❌ 未捕获的异常:', error);
    gracefulShutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ 未处理的 Promise 拒绝:', reason);
    gracefulShutdown('unhandledRejection');
  });
}

// 启动服务器
main().catch((error) => {
  console.error('❌ 服务器启动失败:', error);
  process.exit(1);
});
