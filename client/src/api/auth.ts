/**
 * 认证 API
 *
 * 处理用户注册、登录、Token 刷新等认证相关接口。
 */

import apiClient from './client';

/**
 * 用户注册参数
 */
export interface RegisterParams {
  username: string;
  email: string;
  password: string;
}

/**
 * 用户登录参数
 */
export interface LoginParams {
  email: string;
  password: string;
  rememberMe?: boolean;
}

/**
 * 认证响应
 */
export interface AuthResponse {
  user: {
    id: number;
    username: string;
    email: string;
    role: string;
    createdAt: string;
  };
  accessToken: string;
  refreshToken: string;
}

/**
 * 用户信息
 */
export interface UserInfo {
  id: number;
  username: string;
  email: string;
  avatarUrl: string | null;
  role: string;
  preferences: Record<string, any> | null;
  createdAt: string;
  _count: {
    apiKeys: number;
    workspaces: number;
    sessions: number;
  };
}

/**
 * 用户注册
 */
export async function register(params: RegisterParams): Promise<AuthResponse> {
  const response = await apiClient.post('/auth/register', params);
  return response.data.data;
}

/**
 * 用户登录
 */
export async function login(params: LoginParams): Promise<AuthResponse> {
  const response = await apiClient.post('/auth/login', params);
  return response.data.data;
}

/**
 * 刷新 Token
 */
export async function refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  const response = await apiClient.post('/auth/refresh', { refreshToken });
  return response.data.data;
}

/**
 * 用户登出
 */
export async function logout(): Promise<void> {
  await apiClient.post('/auth/logout');
}

/**
 * 获取当前用户信息
 */
export async function getMe(): Promise<UserInfo> {
  const response = await apiClient.get('/auth/me');
  return response.data.data;
}

/**
 * 更新个人资料
 */
export async function updateProfile(data: {
  username?: string;
  avatarUrl?: string;
  preferences?: Record<string, any>;
}): Promise<UserInfo> {
  const response = await apiClient.put('/auth/profile', data);
  return response.data.data;
}

/**
 * 修改密码
 */
export async function changePassword(data: {
  oldPassword: string;
  newPassword: string;
}): Promise<void> {
  await apiClient.put('/auth/password', data);
}
