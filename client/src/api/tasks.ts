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
