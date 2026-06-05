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
  InboxOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import apiClient from '../../api/client';
import * as filesApi from '../../api/files';
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
    Record<number, { previewFileId: number | null; previewLanguage: string | null; activeTaskId: string | null }>
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
  // 派生当前会话的数据
  const toolEvents = currentSessionId != null ? toolEventsBySession[currentSessionId] || [] : [];
  const currentPreview = currentSessionId != null ? previewBySession[currentSessionId] : undefined;
  const previewFileId = currentPreview?.previewFileId ?? null;
  const previewLanguage = currentPreview?.previewLanguage ?? 'python';
  const activeTaskId = currentPreview?.activeTaskId ?? null;
  const attachments = currentSessionId != null ? attachmentsBySession[currentSessionId] || [] : [];

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
    (v: number | null) => {
      setPreviewBySession((prev) => {
        if (currentSessionId == null) return prev;
        return { ...prev, [currentSessionId]: { ...(prev[currentSessionId] || { previewFileId: null, previewLanguage: 'python', activeTaskId: null }), previewFileId: v } };
      });
    },
    [currentSessionId]
  );
  const setPreviewLanguage = useCallback(
    (v: string | null) => {
      setPreviewBySession((prev) => {
        if (currentSessionId == null) return prev;
        return { ...prev, [currentSessionId]: { ...(prev[currentSessionId] || { previewFileId: null, previewLanguage: 'python', activeTaskId: null }), previewLanguage: v } };
      });
    },
    [currentSessionId]
  );
  const setActiveTaskId = useCallback(
    (v: string | null) => {
      setPreviewBySession((prev) => {
        if (currentSessionId == null) return prev;
        return { ...prev, [currentSessionId]: { ...(prev[currentSessionId] || { previewFileId: null, previewLanguage: 'python', activeTaskId: null }), activeTaskId: v } };
      });
    },
    [currentSessionId]
  );
  const setAttachments = useCallback(
    (updater: React.SetStateAction<AttachedFile[]>) => {
      setAttachmentsBySession((prev) => {
        if (currentSessionId == null) return prev;
        const cur = prev[currentSessionId] || [];
        const next = typeof updater === 'function' ? (updater as (s: AttachedFile[]) => AttachedFile[])(cur) : updater;
        return { ...prev, [currentSessionId]: next };
      });
    },
    [currentSessionId]
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

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 加载会话列表
  useEffect(() => {
    loadSessions();
  }, []);

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [streamMessages, isStreaming]);

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
          workspaceId: currentWorkspaceId ?? undefined,
        });
      if (res.data.code === 0) {
        const newSession = res.data.data;
        setCurrentSessionId(Number(newSession.id));
        setCurrentWorkspaceId(newSession.workspace?.id ? Number(newSession.workspace.id) : currentWorkspaceId);
        setStreamMessages([]);
        setToolEvents([]);
        setPreviewFileId(null);
        setError(null);
        setSelectedFile(null);
        setAttachments([]);
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
        setToolEvents([]);
        setPreviewFileId(null);
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
        setStreamMessages([]);
        setToolEvents([]);
        setPreviewFileId(null);
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
          workspaceId: currentWorkspaceId ?? undefined,
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
    setToolEvents([]);
    setPreviewFileId(null);
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

    setInputValue('');
    setError(null);
    resetLivePanel();

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
          workspaceId: currentWorkspaceId ?? undefined,
        });
        if (res.data.code === 0) {
          sessionId = Number(res.data.data.id);
          setCurrentSessionId(sessionId);
          setCurrentWorkspaceId(res.data.data.workspace?.id ? Number(res.data.data.workspace.id) : currentWorkspaceId);
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

    // 用户消息加到 UI
    const userMsg: StreamMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    setStreamMessages((prev) => [...prev, userMsg]);

    // 占位 Assistant
    const assistantId = `assistant-${Date.now()}`;
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

    setIsStreaming(true);
    setProgress(5);
    setCurrentStep('准备调用 AI...');

    try {
      // 构造请求体
      const requestData: any = {
        content,
        mode: taskMode,
        sessionId,
        workspaceId: currentWorkspaceId ?? undefined,
        fileIds: attachments.map((a) => a.id),
      };

      if (taskMode === 'workflow' && (selectedFile || attachments[0])) {
        const srcName = selectedFile?.name || attachments[0].originalName;
        requestData.sourceFile = srcName;
        requestData.language =
          selectedFile?.language ||
          attachments[0].language ||
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

      // 复用统一的 SSE 消费器
      await consumeStream(response, assistantId, sessionId);

      setSelectedFile(null);
      // 不清空 attachments，方便继续追问
      loadSessions();
    } catch (err: any) {
      console.error('流式请求失败:', err);
      setError(err.message);
      setIsStreaming(false);
    }
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
          workspaceId: currentWorkspaceId ?? undefined,
          sourceFile: selectedFile?.name || attachments[0]?.originalName,
          language:
            selectedFile?.language ||
            attachments[0]?.language ||
            (selectedFile?.name?.endsWith('.py') || attachments[0]?.originalName?.endsWith('.py') ? 'python' : undefined),
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      // 直接传入新 assistant ID，resume 流的文本就追加到这里
      await consumeStream(response, newAssistantId, currentSessionId);
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
          if (ev.taskId) setActiveTaskId(ev.taskId);
          setToolEvents((prev) => [...prev, pendingTool]);
          setStreamMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m))
          );
          setIsStreaming(false);
          setCurrentStep('⏸️ 等待你在右侧面板批准/拒绝...');
          setProgress((prev) => Math.max(prev, 60));
        } else if (eventType === 'complete') {
          if (ev.taskId) setActiveTaskId(ev.taskId);
          if (ev.previewFileId) setPreviewFileId(ev.previewFileId);
          if (ev.testCode && !fullAssistantText.includes(ev.testCode)) {
            const codeBlock = '\n\n```' + (previewLanguage || 'python') + '\n' + ev.testCode + '\n```\n';
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
          {error && (
            <Alert
              message="执行错误"
              description={error}
              type="error"
              closable
              onClose={() => setError(null)}
              style={{ margin: 8 }}
            />
          )}

          {/* 消息列表 */}
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
                <Upload.Dragger
                  showUploadList={false}
                  beforeUpload={(file) => {
                    handleUploadFile(file);
                    return false;
                  }}
                  style={{ display: 'none' }}
                />
                <Button
                  size="small"
                  icon={<InboxOutlined />}
                  disabled={isStreaming}
                  title="也可直接拖拽文件到上方输入框"
                >
                  拖拽
                </Button>
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
        <ChatRightPanel
          collapsed={rightPanelCollapsed}
          onToggleCollapse={() => setRightPanelCollapsed((v) => !v)}
          toolEvents={toolEvents}
          activeTaskId={activeTaskId}
          previewFileId={previewFileId}
          previewLanguage={previewLanguage}
          isRunning={isStreaming}
          width={340}
          onApproveTool={handleApproveTool}
          onDeclineTool={handleDeclineTool}
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
