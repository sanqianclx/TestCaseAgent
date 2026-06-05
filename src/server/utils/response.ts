/**
 * API 响应工具
 *
 * 提供统一的响应格式化函数，确保所有 API 返回一致的响应结构。
 */

import { Response } from 'express';

/**
 * 自定义 JSON 序列化，处理 BigInt 类型
 */
function safeJsonStringify(obj: any): string {
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return value;
  });
}

/**
 * 标准 API 响应接口
 */
export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data?: T;
  details?: any;
  timestamp: number;
}

/**
 * 分页响应接口
 */
export interface PaginatedResponse<T> extends ApiResponse {
  data: {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

/**
 * 错误码枚举
 */
export enum ErrorCode {
  // 认证相关 (1xxx)
  AUTH_INVALID_CREDENTIALS = 1001,
  AUTH_TOKEN_EXPIRED = 1002,
  AUTH_TOKEN_INVALID = 1003,
  AUTH_USER_NOT_FOUND = 1004,
  AUTH_EMAIL_EXISTS = 1005,
  AUTH_USERNAME_EXISTS = 1006,
  AUTH_PASSWORD_TOO_WEAK = 1007,
  AUTH_UNAUTHORIZED = 1008,

  // API Key 相关 (2xxx)
  API_KEY_NOT_FOUND = 2001,
  API_KEY_EXPIRED = 2002,
  API_KEY_INVALID = 2003,
  API_KEY_RATE_LIMIT = 2004,
  API_KEY_INACTIVE = 2005,

  // 任务相关 (3xxx)
  TASK_NOT_FOUND = 3001,
  TASK_ALREADY_RUNNING = 3002,
  TASK_CANCELLED = 3003,
  TASK_FAILED = 3004,

  // 工作空间相关 (4xxx)
  WORKSPACE_NOT_FOUND = 4001,
  WORKSPACE_PATH_INVALID = 4002,
  WORKSPACE_NO_PERMISSION = 4003,
  WORKSPACE_NAME_EXISTS = 4004,

  // 文件相关 (5xxx)
  FILE_NOT_FOUND = 5001,
  FILE_TOO_LARGE = 5002,
  FILE_TYPE_NOT_ALLOWED = 5003,
  FILE_UPLOAD_FAILED = 5004,

  // 会话相关 (6xxx)
  SESSION_NOT_FOUND = 6001,
  SESSION_ARCHIVED = 6002,

  // 系统相关 (9xxx)
  SYSTEM_INTERNAL_ERROR = 9001,
  SYSTEM_DATABASE_ERROR = 9002,
  SYSTEM_VALIDATION_ERROR = 9003,
  SYSTEM_NOT_FOUND = 9004,
}

/**
 * HTTP 状态码映射
 */
const ERROR_STATUS_MAP: Record<number, number> = {
  // 认证相关
  1001: 401,
  1002: 401,
  1003: 401,
  1004: 404,
  1005: 409,
  1006: 409,
  1007: 400,
  1008: 403,

  // API Key 相关
  2001: 404,
  2002: 401,
  2003: 401,
  2004: 429,
  2005: 403,

  // 任务相关
  3001: 404,
  3002: 409,
  3003: 410,
  3004: 500,

  // 工作空间相关
  4001: 404,
  4002: 400,
  4003: 403,
  4004: 409,

  // 文件相关
  5001: 404,
  5002: 413,
  5003: 415,
  5004: 500,

  // 会话相关
  6001: 404,
  6002: 410,

  // 系统相关
  9001: 500,
  9002: 500,
  9003: 400,
  9004: 404,
};

/**
 * 发送成功响应
 *
 * @param res Express 响应对象
 * @param data 响应数据
 * @param message 成功消息
 * @param statusCode HTTP 状态码
 */
export function sendSuccess<T>(
  res: Response,
  data?: T,
  message: string = 'success',
  statusCode: number = 200
): void {
  const response: ApiResponse<T> = {
    code: 0,
    message,
    data,
    timestamp: Date.now(),
  };
  res.status(statusCode).send(safeJsonStringify(response));
}

/**
 * 发送分页响应
 *
 * @param res Express 响应对象
 * @param items 数据列表
 * @param total 总数
 * @param page 当前页
 * @param pageSize 每页大小
 */
export function sendPaginated<T>(
  res: Response,
  items: T[],
  total: number,
  page: number,
  pageSize: number
): void {
  const response: PaginatedResponse<T> = {
    code: 0,
    message: 'success',
    data: {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
    timestamp: Date.now(),
  };
  res.status(200).send(safeJsonStringify(response));
}

/**
 * 发送错误响应
 *
 * @param res Express 响应对象
 * @param errorCode 错误码
 * @param message 错误消息
 * @param details 错误详情
 */
export function sendError(
  res: Response,
  errorCode: ErrorCode,
  message: string,
  details?: any
): void {
  const statusCode = ERROR_STATUS_MAP[errorCode] || 500;
  const response: ApiResponse = {
    code: errorCode,
    message,
    details,
    timestamp: Date.now(),
  };
  res.status(statusCode).send(safeJsonStringify(response));
}

/**
 * 发送验证错误响应
 *
 * @param res Express 响应对象
 * @param errors 验证错误列表
 */
export function sendValidationError(
  res: Response,
  errors: Array<{ field: string; message: string }>
): void {
  sendError(res, ErrorCode.SYSTEM_VALIDATION_ERROR, '参数验证失败', errors);
}

/**
 * 创建分页参数
 *
 * @param page 页码
 * @param pageSize 每页大小
 * @returns 分页参数对象
 */
export function createPagination(page: number = 1, pageSize: number = 20) {
  const safePage = Math.max(1, page);
  const safePageSize = Math.min(100, Math.max(1, pageSize));
  const skip = (safePage - 1) * safePageSize;

  return {
    page: safePage,
    pageSize: safePageSize,
    skip,
    take: safePageSize,
  };
}
