/**
 * 认证状态管理
 *
 * 使用 localStorage 存储 token 和用户信息
 */

import { create } from 'zustand';
import * as authApi from '../api/auth';
import type { UserInfo } from '../api/auth';

const USER_STORAGE_KEY = 'tg_user';
const ACCESS_TOKEN_KEY = 'accessToken';
const REFRESH_TOKEN_KEY = 'refreshToken';

interface AuthState {
  user: UserInfo | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  fetchUser: () => Promise<void>;
  clearError: () => void;
}

/**
 * 从 localStorage 读取用户信息
 */
function getStoredUser(): UserInfo | null {
  try {
    const stored = localStorage.getItem(USER_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * 保存用户信息到 localStorage
 */
function setStoredUser(user: UserInfo | null) {
  if (user) {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(USER_STORAGE_KEY);
  }
}

function clearStoredAuth() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  setStoredUser(null);
}

export const useAuthStore = create<AuthState>((set) => ({
  user: getStoredUser(),
  isAuthenticated: false,
  isLoading: true,
  error: null,

  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const result = await authApi.login({ email, password });
      localStorage.setItem(ACCESS_TOKEN_KEY, result.accessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, result.refreshToken);
      setStoredUser(result.user as UserInfo);
      set({
        user: result.user as UserInfo,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (error: any) {
      set({
        error: error.response?.data?.message || '登录失败',
        isLoading: false,
      });
      throw error;
    }
  },

  register: async (username: string, email: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const result = await authApi.register({ username, email, password });
      localStorage.setItem(ACCESS_TOKEN_KEY, result.accessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, result.refreshToken);
      setStoredUser(result.user as UserInfo);
      set({
        user: result.user as UserInfo,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (error: any) {
      set({
        error: error.response?.data?.message || '注册失败',
        isLoading: false,
      });
      throw error;
    }
  },

  logout: () => {
    clearStoredAuth();
    set({ user: null, isAuthenticated: false, isLoading: false, error: null });
  },

  fetchUser: async () => {
    set({ isLoading: true, error: null });
    try {
      const user = await authApi.getMe();
      setStoredUser(user);
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (error) {
      console.error('获取用户信息失败:', error);
      clearStoredAuth();
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
