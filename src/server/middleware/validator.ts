/**
 * 参数验证中间件
 *
 * 使用 Zod 进行请求参数验证，提供类型安全的验证逻辑。
 */

import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema, ZodError } from 'zod';
import { sendValidationError } from '../utils/response.js';

/**
 * 验证位置枚举
 */
type ValidationLocation = 'body' | 'query' | 'params';

/**
 * 创建验证中间件
 *
 * @param schema Zod 验证模式
 * @param location 验证位置（body/query/params）
 * @returns Express 中间件
 */
export function validate(schema: ZodSchema, location: ValidationLocation = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const data = schema.parse(req[location]);
      // 将验证后的数据替换回请求对象
      req[location] = data;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));
        sendValidationError(res, errors);
        return;
      }
      next(error);
    }
  };
}

/**
 * 验证请求体
 *
 * @param schema Zod 验证模式
 * @returns Express 中间件
 */
export function validateBody(schema: ZodSchema) {
  return validate(schema, 'body');
}

/**
 * 验证查询参数
 *
 * @param schema Zod 验证模式
 * @returns Express 中间件
 */
export function validateQuery(schema: ZodSchema) {
  return validate(schema, 'query');
}

/**
 * 验证路径参数
 *
 * @param schema Zod 验证模式
 * @returns Express 中间件
 */
export function validateParams(schema: ZodSchema) {
  return validate(schema, 'params');
}

// =====================================================
// 通用验证模式
// =====================================================

/**
 * 分页参数验证模式
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * ID 参数验证模式
 */
export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/**
 * UUID 参数验证模式
 */
export const uuidParamSchema = z.object({
  taskId: z.string().uuid(),
});

// =====================================================
// 认证相关验证模式
// =====================================================

/**
 * 用户注册验证模式
 */
export const registerSchema = z.object({
  username: z.string()
    .min(3, '用户名至少 3 个字符')
    .max(50, '用户名最多 50 个字符')
    .regex(/^[a-zA-Z0-9_]+$/, '用户名只能包含字母、数字和下划线'),
  email: z.string()
    .email('邮箱格式无效')
    .max(100, '邮箱最多 100 个字符'),
  password: z.string()
    .min(8, '密码至少 8 个字符')
    .max(100, '密码最多 100 个字符')
    .regex(/[A-Z]/, '密码需要包含大写字母')
    .regex(/[a-z]/, '密码需要包含小写字母')
    .regex(/\d/, '密码需要包含数字'),
});

/**
 * 用户登录验证模式
 */
export const loginSchema = z.object({
  email: z.string().email('邮箱格式无效'),
  password: z.string().min(1, '密码不能为空'),
  rememberMe: z.boolean().optional().default(false),
});

/**
 * 更新个人资料验证模式
 */
export const updateProfileSchema = z.object({
  username: z.string()
    .min(3, '用户名至少 3 个字符')
    .max(50, '用户名最多 50 个字符')
    .regex(/^[a-zA-Z0-9_]+$/, '用户名只能包含字母、数字和下划线')
    .optional(),
  avatarUrl: z.string().url('头像 URL 格式无效').optional(),
  preferences: z.object({
    theme: z.enum(['light', 'dark']).optional(),
    language: z.enum(['zh-CN', 'en-US']).optional(),
    defaultModel: z.string().optional(),
    maxAttempts: z.number().int().min(1).max(20).optional(),
    autoApprove: z.boolean().optional(),
  }).optional(),
});

/**
 * 修改密码验证模式
 */
export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, '旧密码不能为空'),
  newPassword: z.string()
    .min(8, '新密码至少 8 个字符')
    .max(100, '新密码最多 100 个字符')
    .regex(/[A-Z]/, '新密码需要包含大写字母')
    .regex(/[a-z]/, '新密码需要包含小写字母')
    .regex(/\d/, '新密码需要包含数字'),
});

// =====================================================
// API Key 相关验证模式
// =====================================================

/**
 * 创建 API Key 验证模式
 */
export const createApiKeySchema = z.object({
  name: z.string()
    .min(1, '名称不能为空')
    .max(100, '名称最多 100 个字符'),
  permissions: z.array(z.enum(['read', 'generate', 'execute', 'export', 'admin']))
    .optional()
    .default(['read', 'generate']),
  rateLimit: z.number().int().min(1).max(10000).optional().default(100),
  expiresIn: z.number().int().min(1).max(365).nullable().optional(),
});

/**
 * 更新 API Key 验证模式
 */
export const updateApiKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  permissions: z.array(z.enum(['read', 'generate', 'execute', 'export', 'admin'])).optional(),
  rateLimit: z.number().int().min(1).max(10000).optional(),
  isActive: z.boolean().optional(),
});

// =====================================================
// 工作空间相关验证模式
// =====================================================

/**
 * 创建工作空间验证模式
 */
export const createWorkspaceSchema = z.object({
  name: z.string()
    .min(1, '名称不能为空')
    .max(100, '名称最多 100 个字符'),
  basePath: z.string()
    .min(1, '路径不能为空')
    .max(500, '路径最多 500 个字符'),
  description: z.string().max(500).optional(),
  isDefault: z.boolean().optional().default(false),
  settings: z.object({
    defaultLanguage: z.string().optional(),
    maxAttempts: z.number().int().min(1).max(20).optional(),
    llmRetries: z.number().int().min(1).max(10).optional(),
    outputDir: z.string().optional(),
    excludePatterns: z.array(z.string()).optional(),
    autoDetectLanguage: z.boolean().optional(),
  }).optional(),
});

/**
 * 更新工作空间验证模式
 */
export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  isDefault: z.boolean().optional(),
  settings: z.object({
    defaultLanguage: z.string().optional(),
    maxAttempts: z.number().int().min(1).max(20).optional(),
    llmRetries: z.number().int().min(1).max(10).optional(),
    outputDir: z.string().optional(),
    excludePatterns: z.array(z.string()).optional(),
    autoDetectLanguage: z.boolean().optional(),
  }).optional(),
});

// =====================================================
// 会话相关验证模式
// =====================================================

/**
 * 创建会话验证模式
 */
export const createSessionSchema = z.object({
  title: z.string().max(200).optional().default('新会话'),
  workspaceId: z.number().int().positive().optional(),
  mode: z.enum(['workflow', 'autonomous']).optional().default('autonomous'),
  outputDir: z.string().max(500).optional(),
  modelConfig: z.object({
    provider: z.string().optional(),
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().min(1).max(32000).optional(),
    systemPrompt: z.string().optional(),
  }).optional(),
});

/**
 * 更新会话验证模式
 */
export const updateSessionSchema = z.object({
  title: z.string().max(200).optional(),
  status: z.enum(['active', 'archived']).optional(),
  modelConfig: z.object({
    provider: z.string().optional(),
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().min(1).max(32000).optional(),
    systemPrompt: z.string().optional(),
  }).optional(),
});

/**
 * 发送消息验证模式
 */
export const sendMessageSchema = z.object({
  content: z.string().min(1, '消息内容不能为空').max(50000),
  messageType: z.enum(['text', 'code', 'file']).optional().default('text'),
  metadata: z.any().optional(),
  fileIds: z.array(z.number().int().positive()).optional(),
  taskMode: z.enum(['workflow', 'autonomous']).optional(),
  role: z.enum(['user', 'assistant']).optional().default('user'),
});

// =====================================================
// 任务相关验证模式
// =====================================================

/**
 * 创建任务验证模式
 */
export const createTaskSchema = z.object({
  sourceFile: z.string().max(500).optional(),
  sourceContent: z.string().max(100000).optional(),
  fileId: z.number().int().positive().optional(),
  language: z.string().max(20).optional(),
  workspaceId: z.number().int().positive().optional(),
  sessionId: z.number().int().positive().optional(),
  mode: z.enum(['workflow', 'autonomous']).optional().default('workflow'),
  requirements: z.string().max(10000).optional(),
  maxAttempts: z.number().int().min(1).max(20).optional(),
  llmRetries: z.number().int().min(1).max(10).optional(),
  outputDir: z.string().max(500).optional(),
}).refine(
  (data) => data.sourceFile || data.sourceContent || data.fileId,
  { message: '必须提供 sourceFile、sourceContent 或 fileId 之一' }
);

/**
 * 任务查询验证模式
 */
export const taskQuerySchema = paginationSchema.extend({
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']).optional(),
  workspaceId: z.coerce.number().int().positive().optional(),
  sessionId: z.coerce.number().int().positive().optional(),
  language: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});
