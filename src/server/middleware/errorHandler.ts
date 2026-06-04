/**
 * 错误处理中间件
 *
 * 提供统一的错误处理逻辑，捕获并处理所有未处理的异常。
 */

import { Request, Response, NextFunction } from 'express';
import { sendError, ErrorCode } from '../utils/response.js';

/**
 * 自定义应用错误类
 *
 * 用于在业务逻辑中抛出带有错误码的异常。
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: any;

  constructor(code: ErrorCode, message: string, details?: any) {
    super(message);
    this.code = code;
    this.statusCode = this.getStatusCode(code);
    this.details = details;
    this.name = 'AppError';
  }

  /**
   * 根据错误码获取 HTTP 状态码
   */
  private getStatusCode(code: ErrorCode): number {
    const statusMap: Record<number, number> = {
      1001: 401, 1002: 401, 1003: 401, 1004: 404,
      1005: 409, 1006: 409, 1007: 400, 1008: 403,
      2001: 404, 2002: 401, 2003: 401, 2004: 429, 2005: 403,
      3001: 404, 3002: 409, 3003: 410, 3004: 500,
      4001: 404, 4002: 400, 4003: 403, 4004: 409,
      5001: 404, 5002: 413, 5003: 415, 5004: 500,
      6001: 404, 6002: 410,
      9001: 500, 9002: 500, 9003: 400, 9004: 404,
    };
    return statusMap[code] || 500;
  }
}

/**
 * 404 错误处理中间件
 *
 * 处理所有未匹配路由的请求。
 *
 * @param req Express 请求对象
 * @param res Express 响应对象
 * @param next 下一个中间件
 */
export function notFoundHandler(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  sendError(res, ErrorCode.SYSTEM_NOT_FOUND, `路由 ${req.method} ${req.path} 不存在`);
}

/**
 * 全局错误处理中间件
 *
 * 捕获所有未处理的异常并返回统一的错误响应。
 *
 * @param err 错误对象
 * @param req Express 请求对象
 * @param res Express 响应对象
 * @param next 下一个中间件
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  console.error('未处理的错误:', err);

  // 如果是自定义应用错误
  if (err instanceof AppError) {
    sendError(res, err.code, err.message, err.details);
    return;
  }

  // JSON 解析错误
  if (err instanceof SyntaxError && 'body' in err) {
    sendError(res, ErrorCode.SYSTEM_VALIDATION_ERROR, '请求体 JSON 格式错误');
    return;
  }

  // 数据库错误
  if (err.message?.includes('Prisma')) {
    console.error('数据库错误:', err.message);
    sendError(res, ErrorCode.SYSTEM_DATABASE_ERROR, '数据库操作失败');
    return;
  }

  // 其他未知错误
  sendError(
    res,
    ErrorCode.SYSTEM_INTERNAL_ERROR,
    process.env.NODE_ENV === 'development' ? err.message : '服务器内部错误'
  );
}

/**
 * 异步路由包装器
 *
 * 自动捕获异步路由中的错误并传递给错误处理中间件。
 *
 * @param fn 异步路由处理函数
 * @returns 包装后的路由处理函数
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
