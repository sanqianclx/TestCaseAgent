/**
 * 文件 API
 */

import apiClient from './client';

export interface FileInfo {
  id: number;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  language: string | null;
  purpose: string;
  isGenerated?: boolean;
  outputPath?: string | null;
  createdAt: string;
}

/**
 * 上传文件
 */
export async function uploadFile(file: File, params?: {
  workspaceId?: number;
  sessionId?: number;
  purpose?: string;
}): Promise<FileInfo> {
  const formData = new FormData();
  formData.append('file', file);
  if (params?.workspaceId) formData.append('workspaceId', String(params.workspaceId));
  if (params?.sessionId) formData.append('sessionId', String(params.sessionId));
  if (params?.purpose) formData.append('purpose', params.purpose);

  const response = await apiClient.post('/files/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data.data;
}

/**
 * 批量上传文件
 */
export async function uploadMultipleFiles(files: File[], params?: {
  workspaceId?: number;
  sessionId?: number;
  purpose?: string;
}): Promise<{ uploaded: FileInfo[]; failed: Array<{ filename: string; error: string }> }> {
  const formData = new FormData();
  files.forEach(file => formData.append('files', file));
  if (params?.workspaceId) formData.append('workspaceId', String(params.workspaceId));
  if (params?.sessionId) formData.append('sessionId', String(params.sessionId));
  if (params?.purpose) formData.append('purpose', params.purpose);

  const response = await apiClient.post('/files/upload-multiple', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data.data;
}

/**
 * 获取文件列表
 */
export async function getFiles(params?: {
  page?: number;
  pageSize?: number;
  workspaceId?: number;
  sessionId?: number;
  purpose?: string;
}): Promise<{ items: FileInfo[]; total: number; page: number; pageSize: number }> {
  const response = await apiClient.get('/files', { params });
  return response.data.data;
}

/**
 * 获取文件内容
 */
export async function getFileContent(fileId: number): Promise<{
  id: number;
  filename: string;
  content: string;
  encoding: string;
  lineCount: number;
}> {
  const response = await apiClient.get(`/files/${fileId}/content`);
  return response.data.data;
}

/**
 * 删除文件
 */
export async function deleteFile(fileId: number): Promise<void> {
  await apiClient.delete(`/files/${fileId}`);
}

/**
 * 分析文件
 */
export async function analyzeFile(fileId: number): Promise<{
  language: string | null;
  lineCount: number;
  functionCount: number;
  classCount: number;
  imports: string[];
  functions: Array<{ name: string; line: number }>;
  classes: Array<{ name: string; line: number }>;
}> {
  const response = await apiClient.post(`/files/${fileId}/analyze`);
  return response.data.data;
}

/**
 * 获取文件统计
 */
export async function getFileStats(): Promise<{
  totalFiles: number;
  totalSize: number;
  byPurpose: Record<string, number>;
}> {
  const response = await apiClient.get('/files/stats');
  return response.data.data;
}
