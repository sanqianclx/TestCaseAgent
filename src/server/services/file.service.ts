/**
 * 文件服务
 *
 * 处理文件的上传、查询、删除等业务逻辑。
 * 支持文件存储、元数据管理和内容读取。
 */

import prisma from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { ErrorCode, createPagination } from '../utils/response.js';
import { sha256 } from '../utils/crypto.js';
import fs from 'fs/promises';
import path from 'path';
import { env } from '../config/env.js';

/**
 * 上传文件参数
 */
export interface UploadFileParams {
  userId: number;
  workspaceId?: number;
  sessionId?: number;
  purpose?: 'source' | 'reference' | 'config' | 'other';
}

/**
 * 文件信息
 */
export interface FileInfo {
  id: number;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  language: string | null;
  purpose: string;
  createdAt: Date;
}

/**
 * 检测文件语言
 *
 * @param filename 文件名
 * @returns 语言标识或 null
 */
function detectLanguage(filename: string): string | null {
  const ext = path.extname(filename).toLowerCase();
  const languageMap: Record<string, string> = {
    '.py': 'python',
    '.java': 'java',
    '.cpp': 'cpp',
    '.cc': 'cpp',
    '.cxx': 'cpp',
    '.c': 'cpp',
    '.h': 'cpp',
    '.hpp': 'cpp',
  };
  return languageMap[ext] || null;
}

/**
 * 确保上传目录存在
 *
 * @returns 上传目录路径
 */
async function ensureUploadDir(): Promise<string> {
  const uploadDir = path.resolve(env.upload.dir);
  await fs.mkdir(uploadDir, { recursive: true });
  return uploadDir;
}

/**
 * 注册 AI 生成的测试文件
 *
 * 用于把工作流 / 自主 Agent 生成的测试代码落盘到 uploads 目录，
 * 并写入 `uploaded_files` + `file_contents` 表，
 * 后续可通过 `GET /api/v1/files/:id/content` 预览。
 *
 * @param params 文件元信息
 * @returns 入库后的文件 ID 与磁盘路径
 */
export async function registerGeneratedFile(params: {
  userId: number;
  sessionId?: number;
  workspaceId?: number;
  filename: string;
  content: string | Buffer;
  purpose?: 'test_output' | 'test_plan' | 'source';
  metadata?: Record<string, any>;
}): Promise<{ id: number; path: string }> {
  const {
    userId,
    sessionId,
    workspaceId,
    filename,
    content,
    purpose = 'test_output',
    metadata = {},
  } = params;

  // 计算内容 Buffer 与哈希
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
  const hash = sha256(buf);
  const detectedLang = detectLanguage(filename) || 'text';
  const mimeType = 'text/plain';

  // 命名规则：uploads/<userId>/generated/<timestamp>-<rand>__<filename>
  const userDir = path.resolve(env.upload.dir, String(userId), 'generated');
  await fs.mkdir(userDir, { recursive: true });

  const safeBase = path.basename(filename).replace(/[\\/:*?"<>|]/g, '_');
  const storedName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}__${safeBase}`;
  const filePath = path.join(userDir, storedName);

  await fs.writeFile(filePath, buf);

  // 查重：同 user + 同 hash 已有记录则直接返回（避免重复入库）
  const existing = await prisma.uploadedFile.findFirst({
    where: { userId, hash },
  });
  if (existing) {
    return { id: Number(existing.id), path: existing.path };
  }

  const file = await prisma.uploadedFile.create({
    data: {
      userId,
      workspaceId,
      sessionId,
      filename: storedName,
      originalName: safeBase,
      mimeType,
      size: BigInt(buf.length),
      path: filePath,
      hash,
      purpose: purpose.toLowerCase() as any,
      metadata: JSON.stringify({ ...metadata, language: detectedLang, isGenerated: true }),
    },
  });

  await prisma.fileContent.create({
    data: {
      fileId: file.id,
      chunkIndex: 0,
      content: buf,
    },
  });

  return { id: Number(file.id), path: filePath };
}

/**
 * 上传文件
 *
 * @param file 上传的文件
 * @param params 上传参数
 * @returns 上传的文件信息
 */
export async function uploadFile(
  file: Express.Multer.File,
  params: UploadFileParams
): Promise<FileInfo> {
  const { userId, workspaceId, sessionId, purpose = 'source' } = params;

  // 确保上传目录存在
  const uploadDir = await ensureUploadDir();

  // 生成唯一文件名
  const ext = path.extname(file.originalname);
  const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`;
  const filePath = path.join(uploadDir, filename);

  // 保存文件
  await fs.writeFile(filePath, file.buffer);

  // 计算文件哈希
  const hash = sha256(file.buffer);

  // 检查是否已存在相同文件
  const existingFile = await prisma.uploadedFile.findFirst({
    where: { hash, userId },
  });

  // 如果文件已存在，删除新上传的文件
  if (existingFile) {
    await fs.unlink(filePath);
    return {
      id: existingFile.id,
      filename: existingFile.filename,
      originalName: existingFile.originalName,
      mimeType: existingFile.mimeType,
      size: Number(existingFile.size),
      language: detectLanguage(existingFile.originalName),
      purpose: existingFile.purpose,
      createdAt: existingFile.createdAt,
    };
  }

  // 保存文件信息到数据库
  const uploadedFile = await prisma.uploadedFile.create({
    data: {
      userId,
      workspaceId,
      sessionId,
      filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: BigInt(file.size),
      path: filePath,
      hash,
      purpose: purpose.toLowerCase() as any,
      metadata: JSON.stringify({
        language: detectLanguage(file.originalname),
      }),
    },
  });

  // 保存文件内容（用于后续读取）
  await prisma.fileContent.create({
    data: {
      fileId: uploadedFile.id,
      chunkIndex: 0,
      content: file.buffer,
    },
  });

  return {
    id: uploadedFile.id,
    filename: uploadedFile.filename,
    originalName: uploadedFile.originalName,
    mimeType: uploadedFile.mimeType,
    size: Number(uploadedFile.size),
    language: detectLanguage(uploadedFile.originalName),
    purpose: uploadedFile.purpose,
    createdAt: uploadedFile.createdAt,
  };
}

/**
 * 批量上传文件
 *
 * @param files 上传的文件列表
 * @param params 上传参数
 * @returns 上传结果
 */
export async function uploadMultipleFiles(
  files: Express.Multer.File[],
  params: UploadFileParams
): Promise<{
  uploaded: FileInfo[];
  failed: Array<{ filename: string; error: string }>;
}> {
  const uploaded: FileInfo[] = [];
  const failed: Array<{ filename: string; error: string }> = [];

  for (const file of files) {
    try {
      const result = await uploadFile(file, params);
      uploaded.push(result);
    } catch (error: any) {
      failed.push({
        filename: file.originalname,
        error: error.message || '上传失败',
      });
    }
  }

  return { uploaded, failed };
}

/**
 * 获取文件列表
 *
 * @param userId 用户 ID
 * @param page 页码
 * @param pageSize 每页大小
 * @param workspaceId 工作空间 ID
 * @param sessionId 会话 ID
 * @param purpose 文件用途
 * @returns 文件列表和分页信息
 */
export async function getFiles(
  userId: number,
  page: number = 1,
  pageSize: number = 20,
  workspaceId?: number,
  sessionId?: number,
  purpose?: string
) {
  const { skip, take } = createPagination(page, pageSize);

  const where: any = { userId };
  if (workspaceId) where.workspaceId = workspaceId;
  if (sessionId) where.sessionId = sessionId;
  if (purpose) where.purpose = purpose.toLowerCase();

  const [items, total] = await Promise.all([
    prisma.uploadedFile.findMany({
      where,
      select: {
        id: true,
        filename: true,
        originalName: true,
        mimeType: true,
        size: true,
        purpose: true,
        metadata: true,
        isProcessed: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.uploadedFile.count({ where }),
  ]);

  return {
    items: items.map(item => ({
      ...item,
      size: Number(item.size),
      language: detectLanguage(item.originalName),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * 获取文件详情
 *
 * @param userId 用户 ID
 * @param fileId 文件 ID
 * @returns 文件详情
 */
export async function getFileById(userId: number, fileId: number) {
  const file = await prisma.uploadedFile.findFirst({
    where: {
      id: fileId,
      userId,
    },
    select: {
      id: true,
      filename: true,
      originalName: true,
      mimeType: true,
      size: true,
      path: true,
      hash: true,
      purpose: true,
      metadata: true,
      isProcessed: true,
      processedAt: true,
      expiresAt: true,
      createdAt: true,
      workspace: {
        select: {
          id: true,
          name: true,
        },
      },
      session: {
        select: {
          id: true,
          title: true,
        },
      },
    },
  });

  if (!file) {
    throw new AppError(ErrorCode.FILE_NOT_FOUND, '文件不存在');
  }

  return {
    ...file,
    size: Number(file.size),
    language: detectLanguage(file.originalName),
  };
}

/**
 * 获取文件内容
 *
 * @param userId 用户 ID
 * @param fileId 文件 ID
 * @returns 文件内容
 */
export async function getFileContent(userId: number, fileId: number) {
  const file = await prisma.uploadedFile.findFirst({
    where: {
      id: fileId,
      userId,
    },
  });

  if (!file) {
    throw new AppError(ErrorCode.FILE_NOT_FOUND, '文件不存在');
  }

  const content = await prisma.fileContent.findFirst({
    where: { fileId },
    orderBy: { chunkIndex: 'asc' },
  });

  if (!content) {
    throw new AppError(ErrorCode.FILE_NOT_FOUND, '文件内容不存在');
  }

  return {
    id: file.id,
    filename: file.originalName,
    content: content.content.toString('utf-8'),
    encoding: 'utf-8',
    lineCount: content.content.toString('utf-8').split('\n').length,
  };
}

/**
 * 删除文件
 *
 * @param userId 用户 ID
 * @param fileId 文件 ID
 */
export async function deleteFile(userId: number, fileId: number): Promise<void> {
  const file = await prisma.uploadedFile.findFirst({
    where: {
      id: fileId,
      userId,
    },
  });

  if (!file) {
    throw new AppError(ErrorCode.FILE_NOT_FOUND, '文件不存在');
  }

  // 删除物理文件
  try {
    await fs.unlink(file.path);
  } catch {
    // 忽略文件不存在的错误
  }

  // 删除数据库记录（级联删除 file_contents）
  await prisma.uploadedFile.delete({
    where: { id: fileId },
  });
}

/**
 * 分析文件
 *
 * @param userId 用户 ID
 * @param fileId 文件 ID
 * @returns 文件分析结果
 */
export async function analyzeFile(userId: number, fileId: number) {
  const file = await prisma.uploadedFile.findFirst({
    where: {
      id: fileId,
      userId,
    },
  });

  if (!file) {
    throw new AppError(ErrorCode.FILE_NOT_FOUND, '文件不存在');
  }

  const content = await prisma.fileContent.findFirst({
    where: { fileId },
  });

  if (!content) {
    throw new AppError(ErrorCode.FILE_NOT_FOUND, '文件内容不存在');
  }

  const fileContent = content.content.toString('utf-8');
  const language = detectLanguage(file.originalName);

  // 简单的文件分析
  const analysis: any = {
    language,
    lineCount: fileContent.split('\n').length,
    functionCount: 0,
    classCount: 0,
    imports: [],
    functions: [],
    classes: [],
  };

  // 根据语言进行简单分析
  if (language === 'python') {
    // Python 函数和类检测
    const functionRegex = /def\s+(\w+)\s*\(/g;
    const classRegex = /class\s+(\w+)\s*[:(]/g;
    const importRegex = /^(?:from\s+\S+\s+)?import\s+(.+)$/gm;

    let match;
    while ((match = functionRegex.exec(fileContent)) !== null) {
      analysis.functions.push({ name: match[1], line: fileContent.substring(0, match.index).split('\n').length });
      analysis.functionCount++;
    }

    while ((match = classRegex.exec(fileContent)) !== null) {
      analysis.classes.push({ name: match[1], line: fileContent.substring(0, match.index).split('\n').length });
      analysis.classCount++;
    }

    while ((match = importRegex.exec(fileContent)) !== null) {
      analysis.imports.push(match[1].trim());
    }
  } else if (language === 'java') {
    // Java 方法和类检测
    const methodRegex = /(?:public|private|protected)?\s+(?:static\s+)?(?:\w+\s+)+(\w+)\s*\(/g;
    const classRegex = /class\s+(\w+)/g;

    let match;
    while ((match = methodRegex.exec(fileContent)) !== null) {
      if (match[1] !== 'class' && match[1] !== 'if' && match[1] !== 'for' && match[1] !== 'while') {
        analysis.functions.push({ name: match[1], line: fileContent.substring(0, match.index).split('\n').length });
        analysis.functionCount++;
      }
    }

    while ((match = classRegex.exec(fileContent)) !== null) {
      analysis.classes.push({ name: match[1], line: fileContent.substring(0, match.index).split('\n').length });
      analysis.classCount++;
    }
  }

  return analysis;
}

/**
 * 获取文件使用统计
 *
 * @param userId 用户 ID
 * @returns 统计信息
 */
export async function getFileStats(userId: number) {
  const [totalFiles, totalSize, byPurpose] = await Promise.all([
    prisma.uploadedFile.count({ where: { userId } }),
    prisma.uploadedFile.aggregate({
      where: { userId },
      _sum: { size: true },
    }),
    prisma.uploadedFile.groupBy({
      by: ['purpose'],
      where: { userId },
      _count: true,
    }),
  ]);

  return {
    totalFiles,
    totalSize: Number(totalSize._sum.size || 0),
    byPurpose: byPurpose.reduce((acc, item) => {
      acc[item.purpose.toLowerCase()] = item._count;
      return acc;
    }, {} as Record<string, number>),
  };
}
