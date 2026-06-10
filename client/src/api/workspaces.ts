/**
 * 工作空间 API
 */

import apiClient from './client';

export interface Workspace {
  id: number;
  name: string;
  basePath: string;
  description: string | null;
  isDefault: boolean;
  settings: Record<string, any> | null;
  lastAccessedAt: string | null;
  createdAt: string;
  _count?: {
    sessions: number;
    tasks: number;
  };
}

export interface CreateWorkspaceParams {
  name: string;
  basePath: string;
  description?: string;
  isDefault?: boolean;
  settings?: Record<string, any>;
}

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

export interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number | null;
  language: string | null;
  lastModified: string;
}

/**
 * 获取工作空间列表
 */
export async function getWorkspaces(): Promise<Workspace[]> {
  const response = await apiClient.get('/workspaces');
  return response.data.data;
}

/**
 * 创建工作空间
 */
export async function createWorkspace(params: CreateWorkspaceParams): Promise<Workspace> {
  const response = await apiClient.post('/workspaces', params);
  return response.data.data;
}

/**
 * 获取工作空间详情
 */
export async function getWorkspaceById(id: number): Promise<Workspace> {
  const response = await apiClient.get(`/workspaces/${id}`);
  return response.data.data;
}

/**
 * 更新工作空间
 */
export async function updateWorkspace(id: number, data: Partial<CreateWorkspaceParams>): Promise<Workspace> {
  const response = await apiClient.put(`/workspaces/${id}`, data);
  return response.data.data;
}

/**
 * 删除工作空间
 */
export async function deleteWorkspace(id: number): Promise<void> {
  await apiClient.delete(`/workspaces/${id}`);
}

/**
 * 验证工作目录
 */
export async function validateWorkspace(id: number): Promise<ValidationResult> {
  const response = await apiClient.post(`/workspaces/${id}/validate`);
  return response.data.data;
}

/**
 * 浏览工作空间文件
 */
export async function browseFiles(id: number, path?: string): Promise<{
  currentPath: string;
  parentPath: string | null;
  files: FileInfo[];
}> {
  const response = await apiClient.get(`/workspaces/${id}/files`, { params: { path } });
  return response.data.data;
}
