/**
 * 任务 API
 */

import apiClient from './client';

export interface Task {
  id: number;
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  mode: 'workflow' | 'autonomous';
  sourceFile: string;
  language: string;
  executionTime: number | null;
  tokenUsage: Record<string, any> | null;
  attemptCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  outputDir?: string | null;
  session?: { id: number; title: string } | null;
}

export interface TaskResultPayload {
  testCode?: string;
  testFile?: string;
  previewFileId?: number | null;
  outputDir?: string;
  coverage?: Record<string, any>;
  execution?: Record<string, any>;
}

export interface TaskResultResponse {
  taskId: string;
  status: Task['status'];
  mode: Task['mode'];
  sourceFile: string;
  language: string;
  outputDir: string | null;
  result: TaskResultPayload | null;
  errorMessage: string | null;
  executionTime: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  sessionId: number | null;
  session: { id: number; title: string } | null;
}

export interface CreateTaskParams {
  sourceFile?: string;
  sourceContent?: string;
  fileId?: number;
  language?: string;
  workspaceId?: number;
  sessionId?: number;
  mode?: 'workflow' | 'autonomous';
  requirements?: string;
  maxAttempts?: number;
  outputDir?: string;
}

/**
 * 获取任务列表
 */
export async function getTasks(params?: {
  page?: number;
  pageSize?: number;
  status?: string;
  workspaceId?: number;
  sessionId?: number;
  language?: string;
}): Promise<{ items: Task[]; total: number; page: number; pageSize: number }> {
  const response = await apiClient.get('/tasks', { params });
  return response.data.data;
}

/**
 * 创建任务
 */
export async function createTask(params: CreateTaskParams): Promise<Task> {
  const response = await apiClient.post('/tasks', params);
  return response.data.data;
}

/**
 * 获取任务详情
 */
export async function getTaskById(taskId: string): Promise<Task> {
  const response = await apiClient.get(`/tasks/${taskId}`);
  return response.data.data;
}

/**
 * 获取任务结果（含解析后的 result JSON）
 */
export async function getTaskResult(taskId: string): Promise<TaskResultResponse> {
  const response = await apiClient.get(`/tasks/${taskId}/result`);
  return response.data.data;
}

/**
 * 获取任务日志
 */
export async function getTaskLogs(taskId: string, params?: {
  level?: string;
  step?: string;
  limit?: number;
  offset?: number;
}): Promise<{ logs: Array<{ id: number; level: string; step: string | null; message: string; createdAt: string }>; total: number }> {
  const response = await apiClient.get(`/tasks/${taskId}/logs`, { params });
  return response.data.data;
}

/**
 * 取消任务
 */
export async function cancelTask(taskId: string): Promise<void> {
  await apiClient.post(`/tasks/${taskId}/cancel`);
}

/**
 * 重试任务
 */
export async function retryTask(taskId: string): Promise<Task> {
  const response = await apiClient.post(`/tasks/${taskId}/retry`);
  return response.data.data;
}

/**
 * 物理删除任务（仅限非运行中）
 */
export async function deleteTask(taskId: string): Promise<void> {
  await apiClient.delete(`/tasks/${taskId}`);
}

/**
 * 获取任务统计
 */
export async function getTaskStats(): Promise<{
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
}> {
  const response = await apiClient.get('/tasks/stats');
  return response.data.data;
}
