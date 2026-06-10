/**
 * API Key API
 *
 * DeepSeek API Key 管理
 */

import apiClient from './client';

export interface ApiKey {
  id: number;
  name: string;
  prefix: string;
  permissions: string[];
  rateLimit: number;
  expiresAt: string | null;
  lastUsedAt: string | null;
  usageCount: number;
  isActive: boolean;
  createdAt: string;
}

export interface CreateApiKeyParams {
  name: string;
  apiKey: string;          // DeepSeek API Key (sk-xxx)
  permissions?: string[];
  rateLimit?: number;
}

/**
 * 获取 API Key 列表
 */
export async function getApiKeys(params?: {
  page?: number;
  pageSize?: number;
  isActive?: boolean;
}): Promise<{ items: ApiKey[]; total: number; page: number; pageSize: number }> {
  const response = await apiClient.get('/api-keys', { params });
  return response.data.data;
}

/**
 * 创建 API Key (DeepSeek)
 */
export async function createApiKey(params: CreateApiKeyParams): Promise<{
  id: number;
  name: string;
  prefix: string;
  preview: string;
}> {
  const response = await apiClient.post('/api-keys', params);
  return response.data.data;
}

/**
 * 获取 API Key 详情
 */
export async function getApiKeyById(id: number): Promise<ApiKey> {
  const response = await apiClient.get(`/api-keys/${id}`);
  return response.data.data;
}

/**
 * 删除 API Key
 */
export async function deleteApiKey(id: number): Promise<void> {
  await apiClient.delete(`/api-keys/${id}`);
}

/**
 * 启用 API Key
 */
export async function activateApiKey(id: number): Promise<void> {
  await apiClient.post(`/api-keys/${id}/regenerate`);
}

/**
 * 获取 API Key 统计
 */
export async function getApiKeyStats(): Promise<{
  total: number;
  active: number;
  inactive: number;
  totalUsage: number;
}> {
  const response = await apiClient.get('/api-keys/stats');
  return response.data.data;
}
