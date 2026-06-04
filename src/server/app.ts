/**
 * Express 应用配置
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

// 导入路由
import authRoutes from './routes/auth.routes.js';
import apiKeyRoutes from './routes/apiKey.routes.js';
import workspaceRoutes from './routes/workspace.routes.js';
import sessionRoutes from './routes/session.routes.js';
import fileRoutes from './routes/file.routes.js';
import taskRoutes from './routes/task.routes.js';
import configRoutes from './routes/config.routes.js';
import streamRoutes from './routes/stream.routes.js';

/**
 * 创建 Express 应用
 *
 * @returns Express 应用实例
 */
export function createApp(): express.Application {
  const app = express();

  // =====================================================
  // 基础中间件
  // =====================================================

  // 安全头
  app.use(helmet());

  // CORS 配置（开发环境允许所有来源）
  app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  }));

  // 请求体解析
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // 请求日志
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    });
    next();
  });

  // =====================================================
  // 限流配置（开发环境禁用）
  // =====================================================
  // 注：生产环境需要启用限流
  // const limiter = rateLimit({...});
  // app.use('/api/', limiter);

  // =====================================================
  // API 路由
  // =====================================================

  const apiRouter = express.Router();

  // 认证路由
  apiRouter.use('/auth', authRoutes);

  // API Key 路由
  apiRouter.use('/api-keys', apiKeyRoutes);

  // 工作空间路由
  apiRouter.use('/workspaces', workspaceRoutes);

  // 会话路由
  apiRouter.use('/sessions', sessionRoutes);

  // 文件路由
  apiRouter.use('/files', fileRoutes);

  // 任务路由
  apiRouter.use('/tasks', taskRoutes);

  // 配置路由
  apiRouter.use('/config', configRoutes);

  // 流式路由
  apiRouter.use('/stream', streamRoutes);

  // 健康检查
  apiRouter.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    });
  });

  // 挂载 API 路由
  app.use('/api/v1', apiRouter);

  // =====================================================
  // 错误处理
  // =====================================================

  // 404 处理
  app.use(notFoundHandler);

  // 全局错误处理
  app.use(errorHandler);

  return app;
}

export default createApp;
