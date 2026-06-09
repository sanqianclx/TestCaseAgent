/**
 * AI 聊天页面
 *
 * 左侧：会话历史（按模式分组）
 * 中间：聊天窗口
 *   - 顶部模式切换（Agent 自主 / Workflow）
 *   - 已上传附件 Tag 列表
 *   - 进度条
 *   - 消息列表（Markdown 渲染、代码高亮）
 *   - 底部输入区（支持粘贴 / 拖拽 / 按钮上传）
 *   - 高级选项（输出目录 + 已上传附件）
 * 右侧：实时面板（工具调用 / 任务日志 / 文件预览）
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Input,
  Button,
  Typography,
  Segmented,
  Avatar,
  Tag,
  Progress,
  Alert,
  Layout,
  List,
  Space,
  Empty,
  Popconfirm,
  Modal,
  message,
  Collapse,
  Upload,
  Select,
  Steps,
} from 'antd';
import {
  SendOutlined,
  RobotOutlined,
  UserOutlined,
  BranchesOutlined,
  CodeOutlined,
  ThunderboltOutlined,
  PlusOutlined,
  DeleteOutlined,
  MessageOutlined,
  PaperClipOutlined,
  FileTextOutlined,
  FolderOutlined,
} from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import apiClient from '../../api/client';
import * as filesApi from '../../api/files';
import * as sessionsApi from '../../api/sessions';
import * as workspacesApi from '../../api/workspaces';
import type { Workspace } from '../../api/workspaces';
import MarkdownMessage from '../../components/Common/MarkdownMessage';
import ChatRightPanel, {
  type ToolEvent,
} from '../../components/Chat/ChatRightPanel';

const { Text } = Typography;
const { TextArea } = Input;
const { Sider, Content } = Layout;

interface StreamMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  isStreaming?: boolean;
  createdAt: string;
}

interface Session {
  id: number;
  title: string;
  status: string;
  mode: string;
  messageCount: number;
  createdAt: string;
  lastMessageAt: string | null;
  workspace?: { id: number; name: string } | null;
}

interface AttachedFile {
  id: number;
  filename: string;
  originalName: string;
  language: string | null;
  size: number;
}

interface WorkflowLogEntry {
  id: string;
  step: string;
  message: string;
  progress: number;
  type: 'progress' | 'trace' | 'complete' | 'error';
  at: string;
  data?: Record<string, any>;
}

interface WorkflowSessionState {
  input: string;
  logs: WorkflowLogEntry[];
  progress: number;
  currentStep: string;
  status: 'idle' | 'running' | 'success' | 'error';
  outputDir: string | null;
  previewFileId: number | null;
  error: string | null;
}

const WORKFLOW_STEP_TITLES: Record<string, string> = {
  init: '初始化',
  parse: '读取与解析',
  design: '设计用例',
  exportPlan: '导出测试计划',
  generate: '生成测试代码',
  execute: '执行测试',
  heal: '自愈修复',
  export: '导出结果',
  input: '准备输入',
  'workflow-start': '启动运行',
  'workflow-result': '结果摘要',
  workflow: '执行工作流',
  register: '登记产物',
  complete: '完成',
  error: '失败',
};

const WORKFLOW_STEP_ORDER = [
  'init',
  'parse',
  'design',
  'exportPlan',
  'generate',
  'execute',
  'heal',
  'export',
  'input',
  'workflow-start',
  'workflow',
  'workflow-result',
  'register',
  'complete',
];

const DRAFT_SESSION_ID = -1;

/**
 * 聊天页面
 */
const Chat: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  // === 输入与模式 ===
  const [inputValue, setInputValue] = useState('');
  const [taskMode, setTaskMode] = useState<'workflow' | 'autonomous'>('autonomous');
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<number | null>(null);
  const [workspaceLocked, setWorkspaceLocked] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  // === 附件 / 工具调用 / 预览 都按 sessionId 持久化（在下方） ===
  const [uploading, setUploading] = useState(false);

  // === 会话管理 ===
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [streamMessages, setStreamMessages] = useState<StreamMessage[]>([]);

  // === 流式状态 ===
  const [isStreaming, setIsStreaming] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [newSessionModal, setNewSessionModal] = useState(false);
  const [newSessionTitle, setNewSessionTitle] = useState('');

  // === Agent 工具审批 ===
  // 后端检测到 requireApproval 工具（writeFile / shellRun / exportCases）挂起时
  // 会发 event: ask，携带 runId / toolCallId / toolName / args / question。
  // 我们不弹全局 Modal，而是把这条挂起信息附加到右侧"工具调用"列表的最近一条上，
  // 让用户在那条工具记录旁边点击 [批准] / [拒绝] 按钮。

  // === 右侧面板：所有数据按 sessionId 分组存到 localStorage，刷新/切换会话不丢 ===
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [rightPanelWidth, setRightPanelWidth] = useState(420);
  const [isResizingPanel, setIsResizingPanel] = useState(false);
  const [workflowStateBySession, setWorkflowStateBySession] = useState<
    Record<number, WorkflowSessionState>
  >(() => {
    try {
      const raw = localStorage.getItem('chat:workflow:state');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  // 当前会话的工具事件
  const [toolEventsBySession, setToolEventsBySession] = useState<
    Record<number, ToolEvent[]>
  >(() => {
    try {
      const raw = localStorage.getItem('chat:right:all-tools');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  // 当前会话的预览
  const [previewBySession, setPreviewBySession] = useState<
    Record<number, { previewFileId: number | null; previewLanguage: string | null; activeTaskId: string | null; previewCode: string | null }>
  >(() => {
    try {
      const raw = localStorage.getItem('chat:right:all-previews');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  // 当前会话的附件列表
  const [attachmentsBySession, setAttachmentsBySession] = useState<
    Record<number, AttachedFile[]>
  >(() => {
    try {
      const raw = localStorage.getItem('chat:right:all-attachments');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [outputEntriesBySession, setOutputEntriesBySession] = useState<
    Record<number, sessionsApi.SessionOutputEntry[]>
  >(() => {
    try {
      const raw = localStorage.getItem('chat:right:output-entries');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [outputDirBySession, setOutputDirBySession] = useState<Record<number, string | null>>(() => {
    try {
      const raw = localStorage.getItem('chat:right:output-dir');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [currentOutputPathBySession, setCurrentOutputPathBySession] = useState<Record<number, string>>(() => {
    try {
      const raw = localStorage.getItem('chat:right:output-current-path');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [parentOutputPathBySession, setParentOutputPathBySession] = useState<Record<number, string | null>>(() => {
    try {
      const raw = localStorage.getItem('chat:right:output-parent-path');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [selectedOutputFilePathBySession, setSelectedOutputFilePathBySession] = useState<Record<number, string | null>>(() => {
    try {
      const raw = localStorage.getItem('chat:right:selected-output-file');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  // 派生当前会话的数据
  const toolEvents = currentSessionId != null ? toolEventsBySession[currentSessionId] || [] : [];
  const currentPreview = currentSessionId != null ? previewBySession[currentSessionId] : undefined;
  const previewFileId = currentPreview?.previewFileId ?? null;
  const previewLanguage = currentPreview?.previewLanguage ?? 'python';
  const activeTaskId = currentPreview?.activeTaskId ?? null;
  const previewCode = currentPreview?.previewCode ?? null;
  const attachmentSessionKey = currentSessionId ?? DRAFT_SESSION_ID;
  const attachments = attachmentsBySession[attachmentSessionKey] || [];
  const outputEntries = currentSessionId != null ? outputEntriesBySession[currentSessionId] || [] : [];
  const outputDir = currentSessionId != null ? outputDirBySession[currentSessionId] ?? null : null;
  const currentOutputPath = currentSessionId != null ? currentOutputPathBySession[currentSessionId] || '/' : '/';
  const parentOutputPath = currentSessionId != null ? parentOutputPathBySession[currentSessionId] ?? null : null;
  const selectedOutputFilePath = currentSessionId != null ? selectedOutputFilePathBySession[currentSessionId] ?? null : null;
  const currentWorkflowState =
    currentSessionId != null ? workflowStateBySession[currentSessionId] : undefined;
  const currentSessionMode =
    currentSessionId != null
      ? sessions.find((s) => s.id === currentSessionId)?.mode || taskMode
      : taskMode;
  const isWorkflowSession = currentSessionMode === 'workflow';

  // 包装 setXxxBySession：把单会话更新写到对应 map
  const setToolEvents = useCallback(
    (updater: React.SetStateAction<ToolEvent[]>) => {
      setToolEventsBySession((prev) => {
        if (currentSessionId == null) return prev;
        const cur = prev[currentSessionId] || [];
        const next = typeof updater === 'function' ? (updater as (s: ToolEvent[]) => ToolEvent[])(cur) : updater;
        // 限制最多 200 条
        return { ...prev, [currentSessionId]: next.slice(-200) };
      });
    },
    [currentSessionId]
  );
  const setPreviewFileId = useCallback(
    (v: number | null, forSessionId?: number) => {
      const sid = forSessionId ?? currentSessionId;
      if (sid == null) return;
      setPreviewBySession((prev) => ({
        ...prev,
        [sid]: { ...(prev[sid] || { previewFileId: null, previewLanguage: 'python', activeTaskId: null, previewCode: null }), previewFileId: v },
      }));
    },
    [currentSessionId]
  );
  const setPreviewLanguage = useCallback(
    (v: string | null, forSessionId?: number) => {
      const sid = forSessionId ?? currentSessionId;
      if (sid == null) return;
      setPreviewBySession((prev) => ({
        ...prev,
        [sid]: { ...(prev[sid] || { previewFileId: null, previewLanguage: 'python', activeTaskId: null, previewCode: null }), previewLanguage: v },
      }));
    },
    [currentSessionId]
  );
  const setActiveTaskId = useCallback(
    (v: string | null, forSessionId?: number) => {
      const sid = forSessionId ?? currentSessionId;
      if (sid == null) return;
      setPreviewBySession((prev) => ({
        ...prev,
        [sid]: { ...(prev[sid] || { previewFileId: null, previewLanguage: 'python', activeTaskId: null, previewCode: null }), activeTaskId: v },
      }));
    },
    [currentSessionId]
  );
  const setPreviewCode = useCallback(
    (v: string | null, forSessionId?: number) => {
      const sid = forSessionId ?? currentSessionId;
      if (sid == null) return;
      setPreviewBySession((prev) => ({
        ...prev,
        [sid]: { ...(prev[sid] || { previewFileId: null, previewLanguage: 'python', activeTaskId: null, previewCode: null }), previewCode: v },
      }));
    },
    [currentSessionId]
  );
  const setAttachments = useCallback(
    (updater: React.SetStateAction<AttachedFile[]>) => {
      setAttachmentsBySession((prev) => {
        const sid = currentSessionId ?? DRAFT_SESSION_ID;
        const cur = prev[sid] || [];
        const next = typeof updater === 'function' ? (updater as (s: AttachedFile[]) => AttachedFile[])(cur) : updater;
        return { ...prev, [sid]: next };
      });
    },
    [currentSessionId]
  );
  const migrateDraftAttachmentsToSession = useCallback((sessionId: number) => {
    setAttachmentsBySession((prev) => {
      const draft = prev[DRAFT_SESSION_ID] || [];
      if (draft.length === 0) return prev;
      const existing = prev[sessionId] || [];
      const merged = [...existing];
      for (const file of draft) {
        if (!merged.some((item) => item.id === file.id)) merged.push(file);
      }
      const next = { ...prev, [sessionId]: merged };
      delete next[DRAFT_SESSION_ID];
      return next;
    });
  }, []);
  const setSessionOutputState = useCallback(
    (
      sessionId: number,
      data: {
        outputDir: string;
        currentPath: string;
        parentPath: string | null;
        files: sessionsApi.SessionOutputEntry[];
      }
    ) => {
      setOutputEntriesBySession((prev) => ({ ...prev, [sessionId]: data.files }));
      setOutputDirBySession((prev) => ({ ...prev, [sessionId]: data.outputDir }));
      setCurrentOutputPathBySession((prev) => ({ ...prev, [sessionId]: data.currentPath }));
      setParentOutputPathBySession((prev) => ({ ...prev, [sessionId]: data.parentPath }));
      setSelectedOutputFilePathBySession((prev) => {
        const existingSelected = prev[sessionId] ?? null;
        const hasExisting = existingSelected != null && data.files.some((file) => file.type === 'file' && file.path === existingSelected);
        const fallback = data.files.find((file) => file.type === 'file')?.path ?? null;
        return {
          ...prev,
          [sessionId]: hasExisting ? existingSelected : fallback,
        };
      });
    },
    []
  );
  const setSelectedOutputFilePath = useCallback(
    (sessionId: number, filePath: string | null) => {
      setSelectedOutputFilePathBySession((prev) => ({
        ...prev,
        [sessionId]: filePath,
      }));
    },
    []
  );
  const updateWorkflowState = useCallback(
    (
      sessionId: number,
      updater: WorkflowSessionState | ((prev: WorkflowSessionState | undefined) => WorkflowSessionState)
    ) => {
      setWorkflowStateBySession((prev) => ({
        ...prev,
        [sessionId]:
          typeof updater === 'function'
            ? (updater as (prev: WorkflowSessionState | undefined) => WorkflowSessionState)(prev[sessionId])
            : updater,
      }));
    },
    []
  );
  // 写回 localStorage（任何 map 变化都同步）
  useEffect(() => {
    try { localStorage.setItem('chat:right:all-tools', JSON.stringify(toolEventsBySession)); } catch { /* ignore */ }
  }, [toolEventsBySession]);
  useEffect(() => {
    try { localStorage.setItem('chat:right:all-previews', JSON.stringify(previewBySession)); } catch { /* ignore */ }
  }, [previewBySession]);
  useEffect(() => {
    try { localStorage.setItem('chat:right:all-attachments', JSON.stringify(attachmentsBySession)); } catch { /* ignore */ }
  }, [attachmentsBySession]);
  useEffect(() => {
    try { localStorage.setItem('chat:right:output-entries', JSON.stringify(outputEntriesBySession)); } catch { /* ignore */ }
  }, [outputEntriesBySession]);
  useEffect(() => {
    try { localStorage.setItem('chat:right:output-dir', JSON.stringify(outputDirBySession)); } catch { /* ignore */ }
  }, [outputDirBySession]);
  useEffect(() => {
    try { localStorage.setItem('chat:right:output-current-path', JSON.stringify(currentOutputPathBySession)); } catch { /* ignore */ }
  }, [currentOutputPathBySession]);
  useEffect(() => {
    try { localStorage.setItem('chat:right:output-parent-path', JSON.stringify(parentOutputPathBySession)); } catch { /* ignore */ }
  }, [parentOutputPathBySession]);
  useEffect(() => {
    try { localStorage.setItem('chat:right:selected-output-file', JSON.stringify(selectedOutputFilePathBySession)); } catch { /* ignore */ }
  }, [selectedOutputFilePathBySession]);
  useEffect(() => {
    try { localStorage.setItem('chat:workflow:state', JSON.stringify(workflowStateBySession)); } catch { /* ignore */ }
  }, [workflowStateBySession]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 加载会话列表
  useEffect(() => {
    loadSessions();
    loadWorkspaces();
  }, []);

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [streamMessages, isStreaming]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isResizingPanel) return;
    const handleMove = (event: MouseEvent) => {
      const nextWidth = window.innerWidth - event.clientX;
      setRightPanelWidth(Math.max(320, Math.min(860, nextWidth)));
    };
    const handleUp = () => setIsResizingPanel(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isResizingPanel]);

  const loadSessionOutputFiles = useCallback(async (sessionId: number, pathArg?: string) => {
    try {
      const response = await sessionsApi.getSessionOutputFiles(sessionId, pathArg);
      setSessionOutputState(sessionId, response);
    } catch (e) {
      console.error('加载会话输出目录失败:', e);
    }
  }, [setSessionOutputState]);

  /**
   * 接收从 Workspaces 跳过来的选中文件
   */
  useEffect(() => {
    if (location.state) {
      const state = location.state as { selectedFile?: any; sessionId?: number; workspaceId?: number };
      if (state.selectedFile) {
        setSelectedFile(state.selectedFile);
        setInputValue(`请为文件 ${state.selectedFile.name} 生成单元测试`);
        setCurrentWorkspaceId(state.workspaceId ? Number(state.workspaceId) : null);
        setWorkspaceLocked(Boolean(state.workspaceId));
        window.history.replaceState({}, document.title);
      }
      // 从任务页跳转过来：自动选中会话
      if (state.sessionId && !currentSessionId) {
        handleSelectSession(Number(state.sessionId));
        window.history.replaceState({}, document.title);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  /**
   * 加载会话列表
   */
  const loadSessions = useCallback(async () => {
    try {
      const res = await apiClient.get('/sessions');
      if (res.data.code === 0) {
        setSessions(res.data.data.items || []);
      }
    } catch (e) {
      console.error('加载会话失败:', e);
    }
  }, []);

  const loadWorkspaces = useCallback(async () => {
    try {
      const list = await workspacesApi.getWorkspaces();
      setWorkspaces(list);
      if (!currentWorkspaceId) {
        const defaultWorkspace = list.find((w) => w.isDefault);
        if (defaultWorkspace && !currentSessionId) setCurrentWorkspaceId(defaultWorkspace.id);
      }
    } catch (e) {
      console.error('加载工作空间失败:', e);
    }
  }, [currentSessionId, currentWorkspaceId]);

  const bindWorkspaceToCurrentSession = async (workspaceId: number | null) => {
    if (isStreaming) return;
    if (!currentSessionId) {
      setCurrentWorkspaceId(workspaceId);
      setWorkspaceLocked(false);
      return;
    }
    if (!workspaceId) {
      setCurrentWorkspaceId(null);
      setWorkspaceLocked(false);
      return;
    }
    try {
      const res = await apiClient.put(`/sessions/${currentSessionId}`, { workspaceId });
      if (res.data.code === 0) {
        setCurrentWorkspaceId(workspaceId);
        setWorkspaceLocked(true);
        loadSessions();
        message.success('工作空间已绑定到当前会话');
      }
    } catch (e: any) {
      message.error(e?.response?.data?.message || '绑定工作空间失败');
    }
  };

  /**
   * 按模式过滤会话
   */
  const filteredSessions = sessions.filter((s) => s.mode === taskMode);

  /**
   * 创建新会话
   */
  const handleNewSession = () => {
    if (isStreaming) return;
    setNewSessionTitle('');
    setNewSessionModal(true);
  };

  /**
   * 确认创建会话
   */
  const handleConfirmNewSession = async () => {
    if (!newSessionTitle.trim()) {
      message.warning('请输入会话标题');
      return;
    }
    try {
        const res = await apiClient.post('/sessions', {
          title: newSessionTitle.trim(),
          mode: taskMode,
          workspaceId: currentWorkspaceId != null ? Number(currentWorkspaceId) : undefined,
        });
      if (res.data.code === 0) {
        const newSession = res.data.data;
        const newSessionId = Number(newSession.id);
        setCurrentSessionId(newSessionId);
        migrateDraftAttachmentsToSession(newSessionId);
        const boundWorkspaceId = newSession.workspace?.id ? Number(newSession.workspace.id) : null;
        setCurrentWorkspaceId(boundWorkspaceId);
        setWorkspaceLocked(Boolean(boundWorkspaceId));
        setStreamMessages([]);
        setToolEvents([]);
        setPreviewFileId(null);
        setPreviewCode(null);
        setError(null);
        setSelectedFile(null);
        setAttachmentsBySession((prev) => ({ ...prev, [newSessionId]: prev[newSessionId] || [] }));
        setOutputEntriesBySession((prev) => ({ ...prev, [Number(newSession.id)]: [] }));
        setCurrentOutputPathBySession((prev) => ({ ...prev, [Number(newSession.id)]: '/' }));
        setParentOutputPathBySession((prev) => ({ ...prev, [Number(newSession.id)]: null }));
        setSelectedOutputFilePathBySession((prev) => ({ ...prev, [Number(newSession.id)]: null }));
        setNewSessionModal(false);
        loadSessions();
        message.success('会话已创建');
      }
    } catch (e) {
      message.error('创建会话失败');
    }
  };

  /**
   * 选择会话
   */
  const handleSelectSession = async (sessionId: number) => {
    if (isStreaming) return;
    setCurrentSessionId(sessionId);
    setError(null);
    try {
      const detailRes = await apiClient.get(`/sessions/${sessionId}`);
      if (detailRes.data.code === 0) {
        const wsId = detailRes.data.data.workspace?.id;
        setCurrentWorkspaceId(wsId ? Number(wsId) : null);
        setWorkspaceLocked(Boolean(wsId));
      }
      const res = await apiClient.get(`/sessions/${sessionId}/messages`);
      if (res.data.code === 0) {
        const msgs = res.data.data.items.map((m: any) => ({
          id: String(m.id),
          role: m.role,
          content: m.content,
          isStreaming: false,
          createdAt: m.createdAt,
        }));
        setStreamMessages(msgs);
        const sessionPreview = previewBySession[sessionId];
        setPreviewFileId(sessionPreview?.previewFileId ?? null, sessionId);
        setPreviewLanguage(sessionPreview?.previewLanguage ?? 'python', sessionId);
        setActiveTaskId(sessionPreview?.activeTaskId ?? null, sessionId);
        setPreviewCode(sessionPreview?.previewCode ?? null, sessionId);
        await loadSessionOutputFiles(sessionId);
      }
    } catch (e) {
      message.error('加载消息失败');
    }
  };

  /**
   * 删除会话
   */
  const handleDeleteSession = async (sessionId: number) => {
    try {
      await apiClient.delete(`/sessions/${sessionId}`);
      message.success('已删除');
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
        setCurrentWorkspaceId(null);
        setWorkspaceLocked(false);
        setStreamMessages([]);
        setPreviewFileId(null);
        setPreviewCode(null);
        setOutputEntriesBySession((prev) => {
          const next = { ...prev };
          delete next[sessionId];
          return next;
        });
        setOutputDirBySession((prev) => {
          const next = { ...prev };
          delete next[sessionId];
          return next;
        });
        setCurrentOutputPathBySession((prev) => {
          const next = { ...prev };
          delete next[sessionId];
          return next;
        });
        setParentOutputPathBySession((prev) => {
          const next = { ...prev };
          delete next[sessionId];
          return next;
        });
        setSelectedOutputFilePathBySession((prev) => {
          const next = { ...prev };
          delete next[sessionId];
          return next;
        });
        setWorkflowStateBySession((prev) => {
          const next = { ...prev };
          delete next[sessionId];
          return next;
        });
      }
      loadSessions();
    } catch (e) {
      message.error('删除失败');
    }
  };

  /**
   * 处理上传文件（粘贴 / 拖拽 / 按钮）
   */
  const handleUploadFile = useCallback(
    async (file: File) => {
      if (isStreaming) {
        message.warning('AI 正在执行中，请稍后再上传');
        return;
      }
      setUploading(true);
      try {
        const res = await filesApi.uploadFile(file, {
          sessionId: currentSessionId ?? undefined,
          workspaceId: currentWorkspaceId != null ? Number(currentWorkspaceId) : undefined,
          purpose: 'source',
        });
        // 转换 FileInfo → AttachedFile
        const af: AttachedFile = {
          id: res.id,
          filename: res.filename,
          originalName: res.originalName,
          language: res.language,
          size: res.size,
        };
        setAttachments((prev) => [...prev, af]);
        message.success(`已上传 ${af.originalName}`);
      } catch (e: any) {
        message.error(`上传失败: ${e?.message || '未知错误'}`);
      } finally {
        setUploading(false);
      }
    },
    [currentSessionId, currentWorkspaceId, isStreaming]
  );

  /**
   * 移除附件
   */
  const handleRemoveAttachment = (id: number) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  /**
   * 重置实时面板（开始新一次执行时）
   */
  const resetLivePanel = () => {
    if (taskMode === 'autonomous') {
      setToolEvents([]);
    }
    setPreviewFileId(null);
    setPreviewCode(null);
    setActiveTaskId(null);
    setProgress(0);
    setCurrentStep('准备调用 AI...');
  };

  /**
   * 发送消息（流式）
   */
  const handleStreamSend = async () => {
    const content = inputValue.trim();
    if (!content || isStreaming) return;
    const isWorkflowRequest = taskMode === 'workflow';

    setInputValue('');
    setError(null);
    resetLivePanel();
    const requestAttachments = attachments;

    // 还没有会话就先创建
    let sessionId = currentSessionId;
    if (!sessionId) {
      try {
        const title =
          attachments[0]
            ? `测试 ${attachments[0].originalName}`
            : selectedFile
            ? `测试 ${selectedFile.name}`
            : content.slice(0, 50);
        const res = await apiClient.post('/sessions', {
          title,
          mode: taskMode,
          workspaceId: currentWorkspaceId != null ? Number(currentWorkspaceId) : undefined,
        });
        if (res.data.code === 0) {
          sessionId = Number(res.data.data.id);
          setCurrentSessionId(sessionId);
          migrateDraftAttachmentsToSession(sessionId);
          const boundWorkspaceId = res.data.data.workspace?.id ? Number(res.data.data.workspace.id) : null;
          setCurrentWorkspaceId(boundWorkspaceId);
          setWorkspaceLocked(Boolean(boundWorkspaceId));
        } else {
          message.error('创建会话失败');
          return;
        }
      } catch (e) {
        message.error('创建会话失败');
        return;
      }
    }

    // 保存用户消息
    saveMessageToServer(sessionId, 'user', content);

    let assistantId = '';
    if (!isWorkflowRequest) {
      const userMsg: StreamMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
      };
      setStreamMessages((prev) => [...prev, userMsg]);
      assistantId = `assistant-${Date.now()}`;
      setStreamMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: 'assistant',
          content: '',
          isStreaming: true,
          createdAt: new Date().toISOString(),
        },
      ]);
    } else {
      updateWorkflowState(sessionId, {
        input: content,
        logs: [],
        progress: 5,
        currentStep: '准备调用 Workflow...',
        status: 'running',
        outputDir: null,
        previewFileId: null,
        error: null,
      });
    }

    setIsStreaming(true);
    setProgress(5);
    setCurrentStep(isWorkflowRequest ? '准备调用 Workflow...' : '准备调用 AI...');

    try {
      // 构造请求体
      const requestData: any = {
        content,
        mode: taskMode,
          sessionId,
          workspaceId: currentWorkspaceId != null ? Number(currentWorkspaceId) : undefined,
        fileIds: requestAttachments.map((a) => a.id),
      };

      if (currentWorkspaceId) {
        const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId);
        if (currentWorkspace?.basePath) {
          requestData.outputDir = currentWorkspace.basePath;
        }
      }

      if (taskMode === 'workflow' && (selectedFile || requestAttachments[0])) {
        const srcName = selectedFile?.name || requestAttachments[0].originalName;
        requestData.sourceFile = srcName;
        requestData.language =
          selectedFile?.language ||
          requestAttachments[0].language ||
          (srcName.endsWith('.py') ? 'python' : srcName.endsWith('.java') ? 'java' : 'python');
      }

      const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';
      const response = await fetch(`${baseURL}/stream/agent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
        },
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      if (isWorkflowRequest) {
        await consumeWorkflowStream(response, sessionId);
      } else {
        await consumeStream(response, assistantId, sessionId);
      }

      setSelectedFile(null);
      // 不清空 attachments，方便继续追问
      await loadSessionOutputFiles(sessionId);
      loadSessions();
    } catch (err: any) {
      console.error('流式请求失败:', err);
      setError(err.message);
      setIsStreaming(false);
    }
  };

  const consumeWorkflowStream = async (response: Response, sessionId: number) => {
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    if (!reader) {
      throw new Error('Workflow 响应流不可用');
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value);
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() || '';

      for (const line of chunks) {
        const eventMatch = line.match(/^event: (.+)$/m);
        const dataMatch = line.match(/^data: (.+)$/m);
        if (!eventMatch || !dataMatch) continue;
        const eventType = eventMatch[1];
        let ev: any = {};
        try { ev = JSON.parse(dataMatch[1]); } catch { continue; }

        if (eventType === 'progress') {
          const nextProgress = typeof ev.progress === 'number' ? ev.progress : 0;
          const nextStep = ev.step || 'workflow';
          const nextMessage = ev.message || '';
          const nextType = ev.type === 'trace' ? 'trace' : 'progress';
          setProgress(nextProgress);
          setCurrentStep(nextMessage);
          updateWorkflowState(sessionId, (prev) => ({
            input: prev?.input || '',
            logs: [
              ...(prev?.logs || []),
              {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                step: nextStep,
                message: nextMessage,
                progress: nextProgress,
                type: nextType,
                at: new Date().toISOString(),
                data: ev.data,
              },
            ],
            progress: nextProgress,
            currentStep: nextMessage,
            status: 'running',
            outputDir: prev?.outputDir ?? null,
            previewFileId: prev?.previewFileId ?? null,
            error: null,
          }));
        } else if (eventType === 'complete') {
          setProgress(100);
          setCurrentStep('✅ Workflow 执行完成');
          if (typeof ev.previewFileId === 'number') {
            setPreviewFileId(ev.previewFileId, sessionId);
          }
          if (ev.testCode) {
            setPreviewCode(ev.testCode, sessionId);
          }
          updateWorkflowState(sessionId, (prev) => ({
            input: prev?.input || '',
            logs: [
              ...(prev?.logs || []),
              {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                step: 'complete',
                message: 'Workflow 已完成，产物已写入输出目录',
                progress: 100,
                type: 'complete',
                at: new Date().toISOString(),
              },
            ],
            progress: 100,
            currentStep: '✅ Workflow 执行完成',
            status: 'success',
            outputDir: ev.outputDir || prev?.outputDir || null,
            previewFileId: typeof ev.previewFileId === 'number' ? ev.previewFileId : prev?.previewFileId ?? null,
            error: null,
          }));
          await loadSessionOutputFiles(sessionId);
          loadSessions();
        } else if (eventType === 'error') {
          setError(ev.message || 'Workflow 执行失败');
          updateWorkflowState(sessionId, (prev) => ({
            input: prev?.input || '',
            logs: [
              ...(prev?.logs || []),
              {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                step: 'error',
                message: ev.message || 'Workflow 执行失败',
                progress: prev?.progress || 0,
                type: 'error',
                at: new Date().toISOString(),
              },
            ],
            progress: prev?.progress || 0,
            currentStep: '执行出错',
            status: 'error',
            outputDir: prev?.outputDir ?? null,
            previewFileId: prev?.previewFileId ?? null,
            error: ev.message || 'Workflow 执行失败',
          }));
        }
      }
    }

    setIsStreaming(false);
    await loadSessionOutputFiles(sessionId);
    loadSessions();
  };

  const saveMessageToServer = async (
    sessionId: number,
    role: 'user' | 'assistant',
    content: string
  ) => {
    try {
      await apiClient.post(`/sessions/${sessionId}/messages`, {
        content,
        messageType: 'text',
        role,
      });
    } catch (e) {
      console.error('保存消息失败:', e);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleStreamSend();
    }
  };

  /**
   * Agent ask-user 工具：用户提交答案
   * 把答案作为新 user message 重新发请求（带 askContext 上下文），让 Agent 继续
   */
  /**
   * 工具审批：在右侧"工具调用"列表上的 [批准] / [拒绝] 按钮
   * 调 /api/v1/stream/agent/resume 把决定传回后端
   * 不发新气泡，不弹窗；进度消息在 chat 顶部进度条和工具状态 tag 上
   */
  const handleApproveTool = async (event: ToolEvent, answer?: string) => {
    if (!currentSessionId || !event.runId || !event.toolCallId) {
      message.error('缺少 runId / toolCallId / sessionId');
      return;
    }
    await resumeAgentStream(event, 'approve', answer);
  };
  const handleDeclineTool = async (event: ToolEvent, answer?: string) => {
    if (!currentSessionId || !event.runId || !event.toolCallId) {
      message.error('缺少 runId / toolCallId / sessionId');
      return;
    }
    await resumeAgentStream(event, 'decline', answer);
  };

  /**
   * 实际调 /resume 接口并消费 SSE
   *
   * 关键修复：提前创建新的 assistant 消息并把 ID 传下去，
   * 不要在 setState 回调里赋值外部变量（闭包陷阱）。
   */
  const resumeAgentStream = async (
    event: ToolEvent,
    decision: 'approve' | 'decline',
    answer?: string
  ) => {
    if (!event.runId || !event.toolCallId) return;

    // 立刻更新这条 toolEvent 的状态（视觉反馈）
    setToolEvents((prev) =>
      prev.map((e) =>
        e.toolCallId === event.toolCallId && e.runId === event.runId
          ? { ...e, status: decision === 'approve' ? 'approved' : 'declined', answer: answer || e.answer }
          : e
      )
    );

    // 提前创建新的 assistant 消息气泡作为承载
    const newAssistantId = `assistant-${Date.now()}`;
    setStreamMessages((prev) => [
      ...prev,
      { id: newAssistantId, role: 'assistant', content: '', isStreaming: true, createdAt: new Date().toISOString() },
    ]);

    setIsStreaming(true);
    setProgress(30);
    setCurrentStep(decision === 'approve' ? '▶️ Agent 继续执行...' : '🔙 Agent 收到拒绝信号...');

    try {
      const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';
      const response = await fetch(`${baseURL}/stream/agent/resume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
        },
        body: JSON.stringify({
          runId: event.runId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          decision,
          answer: answer || '',
          taskId: event.taskId,
          sessionId: currentSessionId,
          workspaceId: currentWorkspaceId != null ? Number(currentWorkspaceId) : undefined,
          sourceFile: selectedFile?.name || attachments[0]?.originalName,
          language:
            selectedFile?.language ||
            attachments[0]?.language ||
            (selectedFile?.name?.endsWith('.py') || attachments[0]?.originalName?.endsWith('.py') ? 'python' : undefined),
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      // 直接传入新 assistant ID，resume 流的文本就追加到这里
      await consumeStream(response, newAssistantId, currentSessionId!);
      await loadSessionOutputFiles(currentSessionId!);
    } catch (err: any) {
      message.error(err.message || '继续执行失败');
      setIsStreaming(false);
    }
  };

  /**
   * 把 SSE 解析抽出来，handleStreamSend 和 handleAskSubmit 都能复用
   */
  const consumeStream = async (response: Response, assistantId: string, sessionId: number) => {
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullAssistantText = '';
    if (!reader) return;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value);
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const eventMatch = line.match(/^event: (.+)$/m);
        const dataMatch = line.match(/^data: (.+)$/m);
        if (!eventMatch || !dataMatch) continue;
        const eventType = eventMatch[1];
        let ev: any = {};
        try { ev = JSON.parse(dataMatch[1]); } catch { continue; }

        if (eventType === 'progress') {
          const subType = ev.type || 'progress';
          if (typeof ev.progress === 'number') setProgress(ev.progress);
          if (ev.message) setCurrentStep(ev.message);
          if (subType === 'text') {
            fullAssistantText += ev.message || '';
            setStreamMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + (ev.message || '') } : m))
            );
          } else if (subType === 'tool' || subType === 'tool-result') {
            setToolEvents((prev) => [...prev, { step: ev.step, message: ev.message || '', at: Date.now() }]);
            const toolName = ev?.data?.toolName || '';
            const toolResult = ev?.data?.result;
            const toolArgs = ev?.data?.args;
            const outputPath =
              ev?.data?.filePath ||
              toolResult?.file_path ||
              toolResult?.filePath ||
              toolResult?.path ||
              toolArgs?.path ||
              toolArgs?.filePath;
            const outputContent =
              ev?.data?.content ||
              toolResult?.content ||
              toolArgs?.content;
            if (
              subType === 'tool-result' &&
              (toolName === 'writeFile' || toolName === 'write-file') &&
              typeof outputContent === 'string' &&
              outputContent.trim()
            ) {
              setPreviewCode(outputContent, sessionId);
              if (typeof ev?.data?.registeredFileId === 'number') {
                setPreviewFileId(ev.data.registeredFileId, sessionId);
                void loadSessionOutputFiles(sessionId);
              }
              if (typeof outputPath === 'string' && outputPath) {
                const ext = outputPath.split('.').pop()?.toLowerCase();
                const lang =
                  ext === 'py' ? 'python' :
                  ext === 'java' ? 'java' :
                  ext === 'cpp' || ext === 'cc' || ext === 'cxx' || ext === 'c' ? 'cpp' :
                  previewLanguage || 'python';
                setPreviewLanguage(lang, sessionId);
                setCurrentStep(`已捕捉生成文件：${outputPath.split(/[\\\\/]/).pop() || outputPath}`);
              }
            }
          } else {
          }
        } else if (eventType === 'ask') {
          // Agent 工具挂起：把审批信息附加到 toolEvents
          const tName = ev.toolName || 'tool';
          const pendingTool: ToolEvent = {
            step: tName,
            message: ev.question || `Agent 等待审批: ${tName}`,
            at: Date.now(),
            toolName: tName,
            args: ev.args,
            runId: ev.runId,
            toolCallId: ev.toolCallId,
            taskId: ev.taskId,
            status: 'pending',
          };
          if (ev.taskId) setActiveTaskId(ev.taskId, sessionId);
          setToolEvents((prev) => [...prev, pendingTool]);
          setStreamMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m))
          );
          setIsStreaming(false);
          setCurrentStep('⏸️ 等待你在右侧面板批准/拒绝...');
          setProgress((prev) => Math.max(prev, 60));
        } else if (eventType === 'complete') {
          if (ev.taskId) setActiveTaskId(ev.taskId, sessionId);
          if (ev.previewFileId) setPreviewFileId(ev.previewFileId, sessionId);
          if (ev.testCode) setPreviewCode(ev.testCode, sessionId);
          void loadSessionOutputFiles(sessionId);
          if (ev.incomplete) {
            const pauseText = ev.error || ev.message || 'Agent 本轮未完成，进度已保存。发送“继续”可接着执行。';
            setStreamMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, isStreaming: false } : m));
            setCurrentStep(`⏸️ ${pauseText}`);
            setProgress((prev) => Math.max(prev, 90));
            if (fullAssistantText) saveMessageToServer(sessionId, 'assistant', fullAssistantText);
            continue;
          }
          if (ev.outputDir && !ev.previewFileId && ev.testCode) {
            setCurrentStep(`✅ 完成，产物目录：${ev.outputDir}`);
          }
          if (ev.testCode && !fullAssistantText.includes(ev.testCode)) {
            const lang = ev.previewLanguage || ev.language || previewLanguage || 'python';
            setPreviewLanguage(lang, sessionId);
            const codeBlock = '\n\n```' + lang + '\n' + ev.testCode + '\n```\n';
            fullAssistantText += codeBlock;
            setStreamMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: m.content + codeBlock, isStreaming: false } : m));
          } else {
            setStreamMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, isStreaming: false } : m));
          }
          setCurrentStep('✅ 完成');
          setProgress(100);
          if (fullAssistantText) saveMessageToServer(sessionId, 'assistant', fullAssistantText);
        } else if (eventType === 'error') {
          setError(ev.message);
          setStreamMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: m.content + `\n\n❌ 错误: ${ev.message}`, isStreaming: false } : m));
          setCurrentStep('执行出错');
        }
      }
    }
    setIsStreaming(false);
    await loadSessionOutputFiles(sessionId);
    loadSessions();
  };

  /**
   * 渲染单条消息
   */
  const renderMessage = (msg: StreamMessage) => {
    const isUser = msg.role === 'user';
    return (
      <div
        key={msg.id}
        style={{
          display: 'flex',
          gap: 10,
          marginBottom: 16,
          justifyContent: isUser ? 'flex-end' : 'flex-start',
        }}
      >
        {!isUser && (
          <Avatar
            size={32}
            style={{ backgroundColor: '#52c41a', flexShrink: 0, marginTop: 4 }}
            icon={<RobotOutlined />}
          />
        )}
        <div style={{ maxWidth: '85%' }}>
          <div
            style={{
              fontSize: 11,
              color: '#999',
              marginBottom: 4,
              textAlign: isUser ? 'right' : 'left',
            }}
          >
            {isUser ? '你' : 'AI 助手'} ·{' '}
            {new Date(msg.createdAt).toLocaleTimeString()}
            {msg.isStreaming && (
              <span style={{ color: '#1890ff', marginLeft: 6 }}>● 生成中</span>
            )}
          </div>
          <div
            style={{
              background: isUser ? '#1890ff' : '#fff',
              color: isUser ? '#fff' : '#222',
              borderRadius: 8,
              padding: '10px 14px',
              border: isUser ? 'none' : '1px solid #f0f0f0',
              boxShadow: isUser ? 'none' : '0 1px 2px rgba(0,0,0,0.04)',
            }}
          >
            {isUser ? (
              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 14 }}>
                {msg.content}
              </div>
            ) : (
              <MarkdownMessage content={msg.content} />
            )}
          </div>
        </div>
        {isUser && (
          <Avatar
            size={32}
            style={{ backgroundColor: '#1890ff', flexShrink: 0, marginTop: 4 }}
            icon={<UserOutlined />}
          />
        )}
      </div>
    );
  };

  const renderWorkflowContent = () => {
    const logs = currentWorkflowState?.logs || [];
    const latestStepKey =
      logs.length > 0 ? logs[logs.length - 1].step : currentWorkflowState?.status === 'success' ? 'complete' : 'init';
    const currentStepIndex = Math.max(WORKFLOW_STEP_ORDER.indexOf(latestStepKey), 0);
    const seenSteps = new Set(logs.map((log) => log.step));

    return (
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 20,
          minHeight: 0,
        }}
      >
        {!currentSessionId ? (
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
            }}
          >
            <ThunderboltOutlined style={{ fontSize: 80, color: '#d9d9d9' }} />
            <Text type="secondary" style={{ marginTop: 16, fontSize: 16 }}>
              选择 Workflow 会话或新建会话
            </Text>
          </div>
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {currentWorkflowState?.input ? (
              <div style={{ background: '#fff', border: '1px solid #f0f0f0', borderRadius: 8, padding: 14 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>本次请求</Text>
                <div style={{ marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 14 }}>
                  {currentWorkflowState.input}
                </div>
              </div>
            ) : null}

            <div style={{ background: '#fff', border: '1px solid #f0f0f0', borderRadius: 8, padding: 16 }}>
              <Steps
                direction="vertical"
                size="small"
                current={currentWorkflowState?.status === 'success' ? WORKFLOW_STEP_ORDER.length - 1 : currentStepIndex}
                items={WORKFLOW_STEP_ORDER.map((stepKey, index) => {
                  const matched = [...logs].reverse().find((log) => log.step === stepKey);
                  const status =
                    stepKey === 'error'
                      ? currentWorkflowState?.status === 'error'
                        ? 'error'
                        : 'wait'
                      : matched
                      ? matched.type === 'error'
                        ? 'error'
                        : index < currentStepIndex || currentWorkflowState?.status === 'success'
                        ? 'finish'
                        : currentWorkflowState?.status === 'running' && index === currentStepIndex
                        ? 'process'
                        : 'finish'
                      : currentWorkflowState?.status === 'running' && index === currentStepIndex
                      ? 'process'
                      : 'wait';

                  return {
                    title: WORKFLOW_STEP_TITLES[stepKey] || stepKey,
                    description: matched?.message || '',
                    status,
                  };
                })}
              />
            </div>

            <div style={{ background: '#fff', border: '1px solid #f0f0f0', borderRadius: 8, padding: 16 }}>
              <Text strong style={{ display: 'block', marginBottom: 12 }}>执行日志</Text>
              {logs.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无流水线记录" />
              ) : (
                <List
                  size="small"
                  dataSource={logs}
                  renderItem={(log) => (
                    <List.Item style={{ paddingInline: 0 }}>
                      <Space direction="vertical" size={2} style={{ width: '100%' }}>
                        <Space size={8}>
                          <Tag color={log.type === 'error' ? 'error' : log.type === 'complete' ? 'success' : log.type === 'trace' ? 'blue' : 'processing'}>
                            {WORKFLOW_STEP_TITLES[log.step] || log.step}
                          </Tag>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {new Date(log.at).toLocaleTimeString()}
                          </Text>
                        </Space>
                        <Text style={{ fontSize: 13 }}>{log.message}</Text>
                        {log.data ? (
                          <div
                            style={{
                              marginTop: 4,
                              padding: '6px 8px',
                              background: '#fafafa',
                              border: '1px solid #f0f0f0',
                              borderRadius: 4,
                              fontSize: 12,
                              color: '#555',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}
                          >
                            {Object.entries(log.data)
                              .filter(([, value]) => value !== undefined && value !== null && value !== '')
                              .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
                              .join('\n')}
                          </div>
                        ) : null}
                      </Space>
                    </List.Item>
                  )}
                />
              )}
            </div>

            {currentWorkflowState?.outputDir ? (
              <div style={{ background: '#fff', border: '1px solid #f0f0f0', borderRadius: 8, padding: 14 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>输出目录</Text>
                <div style={{ marginTop: 6, fontSize: 14 }}>{currentWorkflowState.outputDir}</div>
              </div>
            ) : null}
          </Space>
        )}
      </div>
    );
  };

  const rightPanelEvents = isWorkflowSession
    ? (currentWorkflowState?.logs || []).map((log) => ({
        step: log.step,
        message: log.message,
        at: new Date(log.at).getTime(),
      }))
    : toolEvents;

  return (
    <>
      <Layout
        style={{
          height: 'calc(100vh - 56px)',
          background: '#fff',
          overflow: 'hidden',
        }}
      >
        {/* 左侧会话历史 */}
        <Sider
          width={240}
          style={{
            background: '#fafafa',
            borderRight: '1px solid #f0f0f0',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ padding: 12, borderBottom: '1px solid #f0f0f0' }}>
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              <Space>
                <BranchesOutlined style={{ color: '#1890ff' }} />
                <Text strong style={{ fontSize: 13 }}>
                  会话列表
                </Text>
              </Space>
              <Button
                type="dashed"
                icon={<PlusOutlined />}
                onClick={handleNewSession}
                block
                size="small"
                disabled={isStreaming}
              >
                新建会话
              </Button>
            </Space>
          </div>
          <div style={{ padding: 8, flex: 1, overflow: 'auto' }}>
            {filteredSessions.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={`暂无${taskMode === 'autonomous' ? 'Agent' : 'Workflow'}会话`}
                style={{ marginTop: 40 }}
              />
            ) : (
              <List
                size="small"
                dataSource={filteredSessions}
                renderItem={(s) => (
                  <List.Item
                    style={{
                      cursor: 'pointer',
                      background: currentSessionId === s.id ? '#e6f7ff' : 'transparent',
                      borderRadius: 6,
                      padding: '8px 10px',
                      margin: '2px 0',
                    }}
                    onClick={() => handleSelectSession(s.id)}
                    actions={
                      currentSessionId === s.id
                        ? [
                            <Popconfirm
                              key="del"
                              title="确定删除？"
                              onConfirm={(e) => {
                                e?.stopPropagation();
                                handleDeleteSession(s.id);
                              }}
                              onCancel={(e) => e?.stopPropagation()}
                            >
                              <Button
                                type="text"
                                size="small"
                                danger
                                icon={<DeleteOutlined />}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </Popconfirm>,
                          ]
                        : undefined
                    }
                  >
                    <div style={{ overflow: 'hidden' }}>
                      <Text
                        strong
                        style={{
                          fontSize: 13,
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {s.title || '新会话'}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {s.messageCount || 0} 条消息
                      </Text>
                    </div>
                  </List.Item>
                )}
              />
            )}
          </div>
        </Sider>

        {/* 中间聊天 */}
        <Content
          style={{
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            background: '#fafafa',
          }}
        >
          {/* 顶部 */}
          <div
            style={{
              padding: '8px 16px',
              borderBottom: '1px solid #f0f0f0',
              background: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <Space size={12} wrap>
              <Segmented
                value={taskMode}
                onChange={(v) => setTaskMode(v as 'workflow' | 'autonomous')}
                options={[
                  {
                    value: 'autonomous',
                    label: (
                      <Space size={4}>
                        <BranchesOutlined />
                        Agent 自主
                      </Space>
                    ),
                  },
                  {
                    value: 'workflow',
                    label: (
                      <Space size={4}>
                        <ThunderboltOutlined />
                        Workflow
                      </Space>
                    ),
                  },
                ]}
              />
              {selectedFile && (
                <Tag
                  color="purple"
                  closable
                  onClose={() => setSelectedFile(null)}
                  icon={<CodeOutlined />}
                >
                  {selectedFile.name}
                </Tag>
              )}
              {attachments.map((a) => (
                <Tag
                  key={a.id}
                  color="blue"
                  closable
                  onClose={() => handleRemoveAttachment(a.id)}
                  icon={<PaperClipOutlined />}
                >
                  {a.originalName}
                </Tag>
              ))}
              {currentWorkspaceId && (
                <Tag color="green" icon={<FolderOutlined />}>
                  {workspaces.find((w) => w.id === currentWorkspaceId)?.name || '工作空间'}
                </Tag>
              )}
            </Space>
          </div>

          {/* 进度条 */}
          {(isStreaming || progress > 0) && (
            <div
              style={{
                padding: '6px 16px',
                background: '#f0f5ff',
                borderBottom: '1px solid #f0f0f0',
              }}
            >
              <Space direction="vertical" style={{ width: '100%' }} size={2}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {currentStep || '准备中...'}
                </Text>
                <Progress
                  percent={Math.round(progress)}
                  size="small"
                  status={isStreaming ? 'active' : 'success'}
                />
              </Space>
            </div>
          )}

          {/* 错误 */}
          {(error || currentWorkflowState?.error) && (
            <Alert
              message="执行错误"
              description={currentWorkflowState?.error || error}
              type="error"
              closable
              onClose={() => {
                setError(null);
                if (currentSessionId != null && currentWorkflowState?.error) {
                  updateWorkflowState(currentSessionId, (prev) => ({
                    input: prev?.input || '',
                    logs: prev?.logs || [],
                    progress: prev?.progress || 0,
                    currentStep: prev?.currentStep || '',
                    status: prev?.status || 'idle',
                    outputDir: prev?.outputDir ?? null,
                    previewFileId: prev?.previewFileId ?? null,
                    error: null,
                  }));
                }
              }}
              style={{ margin: 8 }}
            />
          )}

          {isWorkflowSession ? (
            renderWorkflowContent()
          ) : (
            <div
              style={{
                flex: 1,
                overflow: 'auto',
                padding: 20,
                minHeight: 0,
              }}
            >
              {streamMessages.length === 0 ? (
                <div
                  style={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'column',
                  }}
                >
                  <MessageOutlined style={{ fontSize: 80, color: '#d9d9d9' }} />
                  <Text type="secondary" style={{ marginTop: 16, fontSize: 16 }}>
                    {currentSessionId ? '该会话暂无消息' : '选择左侧会话或新建会话'}
                  </Text>
                  <Text type="secondary" style={{ marginTop: 8, fontSize: 12 }}>
                    支持拖拽文件、点击上传，或直接粘贴文件
                  </Text>
                </div>
              ) : (
                streamMessages.map(renderMessage)
              )}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* 输入区 */}
          <div
            style={{
              padding: 12,
              background: '#fff',
              borderTop: '1px solid #f0f0f0',
            }}
          >
            {/* 拖拽区域 */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const files = Array.from(e.dataTransfer.files || []);
                files.forEach((f) => handleUploadFile(f));
              }}
              style={{ position: 'relative' }}
            >
              <TextArea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={(e) => {
                  const items = Array.from(e.clipboardData?.files || []);
                  if (items.length > 0) {
                    e.preventDefault();
                    items.forEach((f) => handleUploadFile(f));
                  }
                }}
                placeholder="输入消息，可粘贴文件 (Ctrl+V) 或拖拽文件到这里..."
                autoSize={{ minRows: 2, maxRows: 6 }}
                disabled={isStreaming}
                style={{ marginBottom: 8 }}
              />
            </div>

            <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
              <Space size={4} wrap>
                <Upload
                  showUploadList={false}
                  beforeUpload={(file) => {
                    handleUploadFile(file);
                    return false;
                  }}
                  accept=".py,.java,.cpp,.cc,.cxx,.c,.h,.hpp,.txt,.md,.json"
                >
                  <Button
                    size="small"
                    icon={<PaperClipOutlined />}
                    loading={uploading}
                    disabled={isStreaming}
                    title="上传文件"
                  >
                    上传
                  </Button>
                </Upload>
              </Space>

              <Space size={4} wrap>
                <Collapse
                  ghost
                  size="small"
                  style={{ background: 'transparent' }}
                  items={[
                    {
                      key: 'adv',
                      label: (
                        <Text style={{ fontSize: 12 }} type="secondary">
                          高级选项
                        </Text>
                      ),
                      children: (
                        <div style={{ padding: '4px 0', minWidth: 480 }}>
                          <Space direction="vertical" size="small" style={{ width: '100%' }}>
                            <div>
                              <Text
                                type="secondary"
                                style={{ fontSize: 12, display: 'block', marginBottom: 4 }}
                              >
                                <FolderOutlined /> 会话工作空间
                              </Text>
                              <Select
                                allowClear={!currentSessionId}
                                placeholder={currentSessionId ? '本会话尚未绑定工作空间' : '选择本会话绑定的工作空间'}
                                value={currentWorkspaceId ?? undefined}
                                disabled={isStreaming || !!currentSessionId}
                                onChange={(v) => bindWorkspaceToCurrentSession(v ?? null)}
                                style={{ width: '100%' }}
                                options={workspaces.map((w) => ({
                                  value: w.id,
                                  label: `${w.name}${w.isDefault ? '（默认）' : ''}`,
                                }))}
                              />
                              <Text type="secondary" style={{ display: 'block', fontSize: 11, marginTop: 4 }}>
                                {currentSessionId
                                  ? '会话创建后即锁定工作空间（已创建但未绑定可新建会话绑定）。'
                                  : '新建会话时可绑定工作空间；绑定后如需更换，请新建会话。'}
                              </Text>
                            </div>
                            {attachments.length > 0 && (
                              <div>
                                <Text
                                  type="secondary"
                                  style={{ fontSize: 12, display: 'block', marginBottom: 4 }}
                                >
                                  <FileTextOutlined /> 已上传附件 (随消息发送给 AI)
                                </Text>
                                <List
                                  size="small"
                                  bordered
                                  dataSource={attachments}
                                  style={{ background: '#fafafa' }}
                                  renderItem={(a) => (
                                    <List.Item
                                      actions={[
                                        <Button
                                          key="rm"
                                          type="link"
                                          size="small"
                                          danger
                                          onClick={() => handleRemoveAttachment(a.id)}
                                        >
                                          移除
                                        </Button>,
                                      ]}
                                    >
                                      <Space>
                                        <Tag>{a.language || 'text'}</Tag>
                                        <Text style={{ fontSize: 12 }}>{a.originalName}</Text>
                                        <Text type="secondary" style={{ fontSize: 11 }}>
                                          ({(a.size / 1024).toFixed(1)} KB)
                                        </Text>
                                      </Space>
                                    </List.Item>
                                  )}
                                />
                              </div>
                            )}
                          </Space>
                        </div>
                      ),
                    },
                  ]}
                />
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  onClick={handleStreamSend}
                  loading={isStreaming}
                  disabled={!inputValue.trim()}
                >
                  发送
                </Button>
              </Space>
            </Space>
          </div>
        </Content>

        {/* 右侧实时面板 */}
        {!rightPanelCollapsed && (
          <div
            onMouseDown={() => setIsResizingPanel(true)}
            style={{
              width: 6,
              cursor: 'col-resize',
              background: isResizingPanel ? '#91caff' : 'transparent',
              transition: 'background 0.15s ease',
              flexShrink: 0,
            }}
          />
        )}
        <ChatRightPanel
          collapsed={rightPanelCollapsed}
          onToggleCollapse={() => setRightPanelCollapsed((v) => !v)}
          toolEvents={rightPanelEvents}
          activeTaskId={activeTaskId}
          sessionId={currentSessionId}
          previewFileId={previewFileId}
          previewLanguage={previewLanguage}
          previewCode={previewCode}
          outputEntries={outputEntries}
          outputDir={outputDir}
          currentOutputPath={currentOutputPath}
          parentOutputPath={parentOutputPath}
          selectedOutputFilePath={selectedOutputFilePath}
          onOpenOutputEntry={(entry) => {
            if (currentSessionId == null) return;
            if (entry.type === 'directory') {
              void loadSessionOutputFiles(currentSessionId, entry.path);
              return;
            }
            setSelectedOutputFilePath(currentSessionId, entry.path);
          }}
          onOpenParentOutputDir={() => {
            if (currentSessionId == null) return;
            void loadSessionOutputFiles(
              currentSessionId,
              parentOutputPath && parentOutputPath !== '.' ? parentOutputPath : undefined
            );
          }}
          isRunning={isStreaming}
          width={rightPanelWidth}
          onApproveTool={isWorkflowSession ? undefined : handleApproveTool}
          onDeclineTool={isWorkflowSession ? undefined : handleDeclineTool}
        />
      </Layout>

      {/* 新建会话对话框 */}
      <Modal
        title="新建会话"
        open={newSessionModal}
        onOk={handleConfirmNewSession}
        onCancel={() => setNewSessionModal(false)}
        okText="创建"
        cancelText="取消"
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text>请为这个会话起个名字：</Text>
          <Input
            value={newSessionTitle}
            onChange={(e) => setNewSessionTitle(e.target.value)}
            placeholder="例如：测试登录模块"
            onPressEnter={handleConfirmNewSession}
            autoFocus
          />
        </Space>
      </Modal>
    </>
  );
};

export default Chat;
