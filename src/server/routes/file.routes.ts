/**
 * 文件路由
 *
 * 定义文件上传和管理相关的路由。
 */

import { Router } from 'express';
import multer from 'multer';
import * as fileController from '../controllers/file.controller.js';
import { authenticate } from '../middleware/auth.js';
import { validateParams, validateQuery, idParamSchema } from '../middleware/validator.js';
import { z } from 'zod';
import { env } from '../config/env.js';

const router = Router();

// 所有路由都需要认证
router.use(authenticate);

/**
 * Multer 配置
 *
 * 使用内存存储，文件将保存到数据库。
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.upload.maxFileSize, // 10MB
  },
  fileFilter: (req, file, cb) => {
    // 允许的文件类型
    const allowedMimes = [
      'text/x-python',
      'text/plain',
      'application/x-python-code',
      'text/x-java',
      'text/x-c++src',
      'text/x-csrc',
      'text/markdown',
      'application/json',
      'text/xml',
      'application/xml',
    ];

    const allowedExts = ['.py', '.java', '.cpp', '.cc', '.cxx', '.c', '.h', '.hpp', '.txt', '.md', '.json', '.xml'];
    const ext = '.' + file.originalname.split('.').pop()?.toLowerCase();

    if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件类型'));
    }
  },
});

/**
 * 文件查询参数验证模式
 */
const fileQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  workspaceId: z.coerce.number().int().positive().optional(),
  sessionId: z.coerce.number().int().positive().optional(),
  purpose: z.enum(['source', 'reference', 'config', 'other']).optional(),
});

/**
 * GET /api/v1/files/stats
 * 获取文件统计
 */
router.get('/stats', fileController.getFileStats);

/**
 * GET /api/v1/files
 * 获取文件列表
 */
router.get('/', validateQuery(fileQuerySchema), fileController.getFiles);

/**
 * POST /api/v1/files/upload
 * 上传单个文件
 */
router.post('/upload', upload.single('file'), fileController.uploadFile);

/**
 * POST /api/v1/files/upload-multiple
 * 批量上传文件
 */
router.post('/upload-multiple', upload.array('files', 10), fileController.uploadMultipleFiles);

/**
 * GET /api/v1/files/:id
 * 获取文件详情
 */
router.get('/:id', validateParams(idParamSchema), fileController.getFileById);

/**
 * GET /api/v1/files/:id/content
 * 获取文件内容
 */
router.get('/:id/content', validateParams(idParamSchema), fileController.getFileContent);

/**
 * DELETE /api/v1/files/:id
 * 删除文件
 */
router.delete('/:id', validateParams(idParamSchema), fileController.deleteFile);

/**
 * POST /api/v1/files/:id/analyze
 * 分析文件
 */
router.post('/:id/analyze', validateParams(idParamSchema), fileController.analyzeFile);

export default router;
