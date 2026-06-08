/**
 * 会话 API
 *
 * 处理会话和消息相关接口。
 */

import apiClient from './client';

/**
 * 会话信息
 */
export interface Session {
  id: number;
  title: string;
  status: string;
  messageCount: number;
  totalTokens: number;
  lastMessageAt: string | null;
  createdAt: string;
  outputDir?: string | null;
  workspace: {
    id: number;
    name: string;
  } | null;
}

export interface SessionOutputEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number | null;
  language: string | null;
  lastModified: string;
}

/**
 * 消息信息
 */
export interface Message {
  id: number;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  messageType: string;
  metadata: Record<string, any> | null;
  tokenUsage: Record<string, any> | null;
  parentId: number | null;
  createdAt: string;
}

/**
 * 创建会话参数
 */
export interface CreateSessionParams {
  title?: string;
  workspaceId?: number;
  modelConfig?: {
    provider?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
  };
}

/**
 * 发送消息参数
 */
export interface SendMessageParams {
  content: string;
  messageType?: 'text' | 'code' | 'file';
  metadata?: Record<string, any>;
  fileIds?: number[];
  taskMode?: 'workflow' | 'autonomous';
}

/**
 * 获取会话列表
 */
export async function getSessions(params?: {
  page?: number;
  pageSize?: number;
  status?: string;
  workspaceId?: number;
}): Promise<{ items: Session[]; total: number; page: number; pageSize: number }> {
  const response = await apiClient.get('/sessions', { params });
  return response.data.data;
}

/**
 * 创建会话
 */
export async function createSession(params: CreateSessionParams): Promise<Session> {
  const response = await apiClient.post('/sessions', params);
  return response.data.data;
}

/**
 * 获取会话详情
 */
export async function getSessionById(sessionId: number): Promise<Session> {
  const response = await apiClient.get(`/sessions/${sessionId}`);
  return response.data.data;
}

/**
 * 更新会话
 */
export async function updateSession(
  sessionId: number,
  data: { title?: string; status?: string; modelConfig?: Record<string, any> }
): Promise<Session> {
  const response = await apiClient.put(`/sessions/${sessionId}`, data);
  return response.data.data;
}

/**
 * 删除会话
 */
export async function deleteSession(sessionId: number): Promise<void> {
  await apiClient.delete(`/sessions/${sessionId}`);
}

/**
 * 归档会话
 */
export async function archiveSession(sessionId: number): Promise<void> {
  await apiClient.post(`/sessions/${sessionId}/archive`);
}

/**
 * 获取消息历史
 */
export async function getMessages(
  sessionId: number,
  params?: {
    page?: number;
    pageSize?: number;
    before?: number;
  }
): Promise<{ items: Message[]; total: number; hasMore: boolean; oldestId: number | null }> {
  const response = await apiClient.get(`/sessions/${sessionId}/messages`, { params });
  return response.data.data;
}

/**
 * 发送消息
 */
export async function sendMessage(
  sessionId: number,
  params: SendMessageParams
): Promise<{ userMessage: Message; assistantMessage: Message; taskId: string | null }> {
  const response = await apiClient.post(`/sessions/${sessionId}/messages`, params);
  return response.data.data;
}

/**
 * 获取会话统计
 */
export async function getSessionStats(): Promise<{
  total: number;
  active: number;
  archived: number;
  totalMessages: number;
  totalTokens: number;
}> {
  const response = await apiClient.get('/sessions/stats');
  return response.data.data;
}

export async function getSessionOutputFiles(
  sessionId: number,
  path?: string
): Promise<{
  outputDir: string;
  currentPath: string;
  parentPath: string | null;
  files: SessionOutputEntry[];
}> {
  const response = await apiClient.get(`/sessions/${sessionId}/output-files`, {
    params: path ? { path } : undefined,
  });
  return response.data.data;
}

export async function getSessionOutputFileContent(
  sessionId: number,
  path: string
): Promise<{
  outputDir: string;
  path: string;
  filename: string;
  content: string;
  encoding: string;
  lineCount: number;
}> {
  const response = await apiClient.get(`/sessions/${sessionId}/output-file`, {
    params: { path },
  });
  return response.data.data;
}
