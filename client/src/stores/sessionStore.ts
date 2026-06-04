/**
 * 会话状态管理
 */

import { create } from 'zustand';
import * as sessionsApi from '../api/sessions';
import type { Session, Message } from '../api/sessions';

interface SessionState {
  sessions: Session[];
  currentSession: Session | null;
  messages: Message[];
  isLoading: boolean;
  isSending: boolean;
  error: string | null;

  // Actions
  fetchSessions: () => Promise<void>;
  createSession: (params?: { title?: string; workspaceId?: number }) => Promise<Session>;
  setCurrentSession: (session: Session | null) => void;
  fetchMessages: (sessionId: number) => Promise<void>;
  sendMessage: (sessionId: number, content: string, options?: {
    taskMode?: 'workflow' | 'autonomous';
    fileIds?: number[];
  }) => Promise<void>;
  deleteSession: (sessionId: number) => Promise<void>;
  clearError: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  currentSession: null,
  messages: [],
  isLoading: false,
  isSending: false,
  error: null,

  fetchSessions: async () => {
    set({ isLoading: true });
    try {
      const result = await sessionsApi.getSessions();
      set({ sessions: result.items, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  createSession: async (params) => {
    set({ isLoading: true });
    try {
      const session = await sessionsApi.createSession(params || {});
      set((state) => ({
        sessions: [session, ...state.sessions],
        currentSession: session,
        messages: [],
        isLoading: false,
      }));
      return session;
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  setCurrentSession: (session) => {
    set({ currentSession: session, messages: [] });
  },

  fetchMessages: async (sessionId) => {
    set({ isLoading: true });
    try {
      const result = await sessionsApi.getMessages(sessionId);
      set({ messages: result.items, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  sendMessage: async (sessionId, content, options) => {
    set({ isSending: true });
    try {
      const result = await sessionsApi.sendMessage(sessionId, {
        content,
        taskMode: options?.taskMode,
        fileIds: options?.fileIds,
      });

      set((state) => ({
        messages: [...state.messages, result.userMessage, result.assistantMessage],
        isSending: false,
      }));
    } catch (error: any) {
      set({ error: error.message, isSending: false });
      throw error;
    }
  },

  deleteSession: async (sessionId) => {
    try {
      await sessionsApi.deleteSession(sessionId);
      set((state) => ({
        sessions: state.sessions.filter(s => s.id !== sessionId),
        currentSession: state.currentSession?.id === sessionId ? null : state.currentSession,
      }));
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  clearError: () => set({ error: null }),
}));
