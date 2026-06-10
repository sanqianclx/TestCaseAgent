/**
 * 工作空间服务
 *
 * 处理工作空间的创建、查询、更新、删除等业务逻辑。
 * 支持工作目录验证和文件浏览。
 */

import prisma from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { ErrorCode, createPagination } from '../utils/response.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * 创建工作空间参数
 */
export interface CreateWorkspaceParams {
  name: string;
  basePath: string;
  description?: string;
  isDefault?: boolean;
  settings?: Record<string, any>;
}

/**
 * 更新工作空间参数
 */
export interface UpdateWorkspaceParams {
  name?: string;
  description?: string;
  isDefault?: boolean;
  settings?: Record<string, any>;
}

/**
 * 工作目录验证结果
 */
export interface ValidationResult {
  valid: boolean;
  exists: boolean;
  readable: boolean;
  writable: boolean;
  files: {
    total: number;
    byLanguage: {
      python: number;
      java: number;
      cpp: number;
      other: number;
    };
  };
}

/**
 * 文件信息
 */
export interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number | null;
  language: string | null;
  lastModified: string;
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
 * 创建工作空间
 *
 * @param userId 用户 ID
 * @param params 创建参数
 * @returns 创建的工作空间
 */
export async function createWorkspace(userId: number, params: CreateWorkspaceParams) {
  const { name, basePath, description, isDefault = false, settings } = params;

  // 检查名称是否已存在
  const existing = await prisma.workspace.findFirst({
    where: {
      userId,
      name,
    },
  });

  if (existing) {
    throw new AppError(ErrorCode.WORKSPACE_NAME_EXISTS, '工作空间名称已存在');
  }

  // 验证路径是否存在
  try {
    const stat = await fs.stat(basePath);
    if (!stat.isDirectory()) {
      throw new AppError(ErrorCode.WORKSPACE_PATH_INVALID, '路径不是目录');
    }
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    throw new AppError(ErrorCode.WORKSPACE_PATH_INVALID, '路径不存在或无法访问');
  }

  // 如果设置为默认，取消其他默认工作空间
  if (isDefault) {
    await prisma.workspace.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });
  }

  // 创建工作空间
  const workspace = await prisma.workspace.create({
    data: {
      userId,
      name,
      basePath: path.resolve(basePath),
      description,
      isDefault,
      settings: settings ? JSON.stringify(settings) : undefined,
    },
    select: {
      id: true,
      name: true,
      basePath: true,
      description: true,
      isDefault: true,
      settings: true,
      createdAt: true,
    },
  });

  return {
    ...workspace,
    id: Number(workspace.id),
  };
}

/**
 * 获取工作空间列表
 *
 * @param userId 用户 ID
 * @returns 工作空间列表
 */
export async function getWorkspaces(userId: number) {
  const workspaces = await prisma.workspace.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      basePath: true,
      description: true,
      isDefault: true,
      settings: true,
      lastAccessedAt: true,
      createdAt: true,
      _count: {
        select: {
          sessions: true,
          tasks: true,
        },
      },
    },
    orderBy: [
      { isDefault: 'desc' },
      { createdAt: 'desc' },
    ],
  });

  return workspaces.map((w) => ({
    ...w,
    id: Number(w.id),
  }));
}

/**
 * 获取工作空间详情
 *
 * @param userId 用户 ID
 * @param workspaceId 工作空间 ID
 * @returns 工作空间详情
 */
export async function getWorkspaceById(userId: number, workspaceId: number) {
  const workspace = await prisma.workspace.findFirst({
    where: {
      id: workspaceId,
      userId,
    },
    select: {
      id: true,
      name: true,
      basePath: true,
      description: true,
      isDefault: true,
      settings: true,
      lastAccessedAt: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          sessions: true,
          tasks: true,
          uploadedFiles: true,
        },
      },
    },
  });

  if (!workspace) {
    throw new AppError(ErrorCode.WORKSPACE_NOT_FOUND, '工作空间不存在');
  }

  // 更新最后访问时间
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { lastAccessedAt: new Date() },
  });

  return {
    ...workspace,
    id: Number(workspace.id),
  };
}

/**
 * 更新工作空间
 *
 * @param userId 用户 ID
 * @param workspaceId 工作空间 ID
 * @param params 更新参数
 * @returns 更新后的工作空间
 */
export async function updateWorkspace(
  userId: number,
  workspaceId: number,
  params: UpdateWorkspaceParams
) {
  // 检查工作空间是否存在
  const existing = await prisma.workspace.findFirst({
    where: {
      id: workspaceId,
      userId,
    },
  });

  if (!existing) {
    throw new AppError(ErrorCode.WORKSPACE_NOT_FOUND, '工作空间不存在');
  }

  // 如果更新名称，检查是否已存在
  if (params.name && params.name !== existing.name) {
    const nameExists = await prisma.workspace.findFirst({
      where: {
        userId,
        name: params.name,
        id: { not: workspaceId },
      },
    });
    if (nameExists) {
      throw new AppError(ErrorCode.WORKSPACE_NAME_EXISTS, '工作空间名称已存在');
    }
  }

  // 如果设置为默认，取消其他默认工作空间
  if (params.isDefault) {
    await prisma.workspace.updateMany({
      where: { userId, isDefault: true, id: { not: workspaceId } },
      data: { isDefault: false },
    });
  }

  // 准备更新数据
  const updateData: any = {};
  if (params.name !== undefined) updateData.name = params.name;
  if (params.description !== undefined) updateData.description = params.description;
  if (params.isDefault !== undefined) updateData.isDefault = params.isDefault;
  if (params.settings !== undefined) updateData.settings = JSON.stringify(params.settings);

  const workspace = await prisma.workspace.update({
    where: { id: workspaceId },
    data: updateData,
    select: {
      id: true,
      name: true,
      basePath: true,
      description: true,
      isDefault: true,
      settings: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return {
    ...workspace,
    id: Number(workspace.id),
  };
}

/**
 * 删除工作空间
 *
 * @param userId 用户 ID
 * @param workspaceId 工作空间 ID
 */
export async function deleteWorkspace(userId: number, workspaceId: number): Promise<void> {
  const existing = await prisma.workspace.findFirst({
    where: {
      id: workspaceId,
      userId,
    },
  });

  if (!existing) {
    throw new AppError(ErrorCode.WORKSPACE_NOT_FOUND, '工作空间不存在');
  }

  await prisma.workspace.delete({
    where: { id: workspaceId },
  });
}

/**
 * 验证工作目录
 *
 * @param userId 用户 ID
 * @param workspaceId 工作空间 ID
 * @returns 验证结果
 */
export async function validateWorkspace(
  userId: number,
  workspaceId: number
): Promise<ValidationResult> {
  const workspace = await prisma.workspace.findFirst({
    where: {
      id: workspaceId,
      userId,
    },
  });

  if (!workspace) {
    throw new AppError(ErrorCode.WORKSPACE_NOT_FOUND, '工作空间不存在');
  }

  const basePath = workspace.basePath;

  // 检查路径是否存在
  let exists = false;
  let readable = false;
  let writable = false;

  try {
    const stat = await fs.stat(basePath);
    exists = stat.isDirectory();

    if (exists) {
      // 测试读取权限
      await fs.access(basePath, fs.constants.R_OK);
      readable = true;

      // 测试写入权限
      try {
        await fs.access(basePath, fs.constants.W_OK);
        writable = true;
      } catch {
        writable = false;
      }
    }
  } catch {
    exists = false;
  }

  // 统计文件
  const files = { total: 0, byLanguage: { python: 0, java: 0, cpp: 0, other: 0 } };

  if (exists && readable) {
    try {
      const entries = await fs.readdir(basePath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          files.total++;
          const lang = detectLanguage(entry.name);
          if (lang === 'python') files.byLanguage.python++;
          else if (lang === 'java') files.byLanguage.java++;
          else if (lang === 'cpp') files.byLanguage.cpp++;
          else files.byLanguage.other++;
        }
      }
    } catch {
      // 忽略读取错误
    }
  }

  return {
    valid: exists && readable && writable,
    exists,
    readable,
    writable,
    files,
  };
}

/**
 * 浏览工作空间文件
 *
 * @param userId 用户 ID
 * @param workspaceId 工作空间 ID
 * @param subPath 子目录路径
 * @returns 文件列表
 */
export async function browseFiles(
  userId: number,
  workspaceId: number,
  subPath: string = ''
): Promise<{
  currentPath: string;
  parentPath: string | null;
  files: FileInfo[];
}> {
  const workspace = await prisma.workspace.findFirst({
    where: {
      id: workspaceId,
      userId,
    },
  });

  if (!workspace) {
    throw new AppError(ErrorCode.WORKSPACE_NOT_FOUND, '工作空间不存在');
  }

  const fullPath = path.join(workspace.basePath, subPath);

  // 检查路径是否在工作空间内
  if (!fullPath.startsWith(workspace.basePath)) {
    throw new AppError(ErrorCode.WORKSPACE_NO_PERMISSION, '路径越界');
  }

  // 检查路径是否存在
  try {
    const stat = await fs.stat(fullPath);
    if (!stat.isDirectory()) {
      throw new AppError(ErrorCode.WORKSPACE_PATH_INVALID, '路径不是目录');
    }
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    throw new AppError(ErrorCode.WORKSPACE_PATH_INVALID, '路径不存在');
  }

  // 读取目录内容
  const entries = await fs.readdir(fullPath, { withFileTypes: true });
  const files: FileInfo[] = [];

  for (const entry of entries) {
    const entryPath = path.join(fullPath, entry.name);
    const relativePath = path.relative(workspace.basePath, entryPath);

    try {
      const stat = await fs.stat(entryPath);

      files.push({
        name: entry.name,
        path: relativePath.replace(/\\/g, '/'),
        type: entry.isDirectory() ? 'directory' : 'file',
        size: entry.isFile() ? stat.size : null,
        language: entry.isFile() ? detectLanguage(entry.name) : null,
        lastModified: stat.mtime.toISOString(),
      });
    } catch {
      // 忽略无法访问的文件
    }
  }

  // 排序：目录在前，文件在后，按名称排序
  files.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    currentPath: subPath || '/',
    parentPath: subPath ? path.dirname(subPath).replace(/\\/g, '/') : null,
    files,
  };
}
