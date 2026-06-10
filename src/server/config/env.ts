/**
 * 环境变量配置
 *
 * 集中管理所有环境变量，提供类型安全的访问方式。
 * 包含默认值和必要的验证。
 */

import dotenv from 'dotenv';
import path from 'path';

// 加载 .env 文件
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/**
 * 环境变量配置接口
 */
export interface EnvConfig {
  // 数据库配置
  database: {
    url: string;
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
  };

  // JWT 配置
  jwt: {
    secret: string;
    expiresIn: string;
    refreshExpiresIn: string;
  };

  // 服务器配置
  server: {
    port: number;
    host: string;
    nodeEnv: string;
  };

  // CORS 配置
  cors: {
    origin: string;
  };

  // 文件上传配置
  upload: {
    dir: string;
    maxFileSize: number;
  };

  // LLM 配置
  llm: {
    deepseekApiKey: string;
  };

  // Agent 运行配置
  agent: {
    maxSteps: number;
    maxOutputTokens: number;
    memoryLimit: number;
  };

  // 日志配置
  log: {
    level: string;
    dir: string;
  };

  // 安全配置
  security: {
    rateLimitWindowMs: number;
    rateLimitMax: number;
  };
}

/**
 * 获取环境变量，支持默认值
 *
 * @param key 环境变量名
 * @param defaultValue 默认值
 * @returns 环境变量值
 */
function getEnv(key: string, defaultValue: string = ''): string {
  return process.env[key] || defaultValue;
}

/**
 * 获取数字类型的环境变量
 *
 * @param key 环境变量名
 * @param defaultValue 默认值
 * @returns 数字值
 */
function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const num = parseInt(value, 10);
  return isNaN(num) ? defaultValue : num;
}

/**
 * 导出配置实例
 */
export const env: EnvConfig = {
  database: {
    url: getEnv('DATABASE_URL', 'mysql://root:123456@localhost:3306/testgenerate'),
    host: getEnv('DB_HOST', 'localhost'),
    port: getEnvNumber('DB_PORT', 3306),
    user: getEnv('DB_USER', 'root'),
    password: getEnv('DB_PASSWORD', '123456'),
    name: getEnv('DB_NAME', 'testgenerate'),
  },

  jwt: {
    secret: getEnv('JWT_SECRET', 'testgenerate-jwt-secret-key-2026'),
    expiresIn: getEnv('JWT_EXPIRES_IN', '2h'),
    refreshExpiresIn: getEnv('JWT_REFRESH_EXPIRES_IN', '7d'),
  },

  server: {
    port: getEnvNumber('PORT', 3000),
    host: getEnv('HOST', '0.0.0.0'),
    nodeEnv: getEnv('NODE_ENV', 'development'),
  },

  cors: {
    origin: getEnv('CORS_ORIGIN', 'http://localhost:5173'),
  },

  upload: {
    dir: getEnv('UPLOAD_DIR', './uploads'),
    maxFileSize: getEnvNumber('MAX_FILE_SIZE', 10 * 1024 * 1024), // 10MB
  },

  llm: {
    deepseekApiKey: getEnv('DEEPSEEK_API_KEY'),
  },

  agent: {
    maxSteps: getEnvNumber('AGENT_MAX_STEPS', 80),
    maxOutputTokens: getEnvNumber('AGENT_MAX_OUTPUT_TOKENS', 8192),
    memoryLimit: getEnvNumber('AGENT_MEMORY_LIMIT', 30),
  },

  log: {
    level: getEnv('LOG_LEVEL', 'debug'),
    dir: getEnv('LOG_DIR', './logs'),
  },

  security: {
    rateLimitWindowMs: getEnvNumber('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000), // 15 分钟
    rateLimitMax: getEnvNumber('RATE_LIMIT_MAX', 100),
  },
};

export default env;
