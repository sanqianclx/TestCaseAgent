/**
 * 聊天页面
 *
 * 左侧会话历史（按模式分组），右侧聊天窗口
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  Card,
  Input,
  Button,
  Typography,
  Select,
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
} from 'antd';
import {
  SendOutlined,
  RobotOutlined,
  UserOutlined,
  BranchesOutlined,
  CodeOutlined,
  ThunderboltOutlined,
  ClearOutlined,
  PlusOutlined,
  DeleteOutlined,
  MessageOutlined,
} from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import apiClient from '../../api/client';

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
}

/**
 * 聊天页面
 */
const Chat: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState('');
  const [taskMode, setTaskMode] = useState<'workflow' | 'autonomous'>('autonomous');
  const [selectedFile, setSelectedFile] = useState<any>(null);

  // 会话管理
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [streamMessages, setStreamMessages] = useState<StreamMessage[]>([]);

  const [isStreaming, setIsStreaming] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [newSessionModal, setNewSessionModal] = useState(false);
  const [newSessionTitle, setNewSessionTitle] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 加载会话列表
  useEffect(() => {
    loadSessions();
  }, []);

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [streamMessages, isStreaming]);

  // 接收文件
  useEffect(() => {
    if (location.state) {
      const state = location.state as { selectedFile?: any };
      if (state.selectedFile) {
        setSelectedFile(state.selectedFile);
        setInputValue(`请为文件 ${state.selectedFile.name} 生成单元测试`);
        window.history.replaceState({}, document.title);
      }
    }
  }, [location]);

  /**
   * 加载会话列表
   */
  const loadSessions = async () => {
    try {
      const res = await apiClient.get('/sessions');
      if (res.data.code === 0) {
        setSessions(res.data.data.items || []);
      }
    } catch (error) {
      console.error('加载会话失败:', error);
    }
  };

  /**
   * 按模式过滤会话
   */
  const filteredSessions = sessions.filter(s => s.mode === taskMode);

  /**
   * 创建新会话 - 弹出对话框输入标题
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
      });
      if (res.data.code === 0) {
        const newSession = res.data.data;
        setCurrentSessionId(Number(newSession.id));
        setStreamMessages([]);
        setError(null);
        setSelectedFile(null);
        setNewSessionModal(false);
        loadSessions();
        message.success('会话已创建');
      }
    } catch (error) {
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

    // 加载该会话的消息
    try {
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
      }
    } catch (error) {
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
        setStreamMessages([]);
      }
      loadSessions();
    } catch (error) {
      message.error('删除失败');
    }
  };

  /**
   * 发送消息（流式）
   */
  const handleStreamSend = async () => {
    const content = inputValue.trim();
    if (!content || isStreaming) return;

    setInputValue('');
    setError(null);

    // 如果没有当前会话，先创建一个
    let sessionId = currentSessionId;
    if (!sessionId) {
      try {
        const title = selectedFile ? `测试 ${selectedFile.name}` : content.slice(0, 50);
        const res = await apiClient.post('/sessions', { title });
        if (res.data.code === 0) {
          sessionId = Number(res.data.data.id);
          setCurrentSessionId(sessionId);
        } else {
          message.error('创建会话失败');
          return;
        }
      } catch (error) {
        message.error('创建会话失败');
        return;
      }
    }

    // 保存用户消息到后端
    saveMessageToServer(sessionId, 'user', content);

    // 添加用户消息
    const userMsg: StreamMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: content,
      createdAt: new Date().toISOString(),
    };
    setStreamMessages(prev => [...prev, userMsg]);

    // 添加占位 Assistant
    const assistantId = `assistant-${Date.now()}`;
    setStreamMessages(prev => [...prev, {
      id: assistantId,
      role: 'assistant',
      content: '',
      isStreaming: true,
      createdAt: new Date().toISOString(),
    }]);

    setIsStreaming(true);
    setProgress(0);
    setCurrentStep('准备调用 AI...');

    try {
      const requestData: any = {
        content,
        mode: taskMode,
        sessionId,
      };

      if (taskMode === 'workflow' && selectedFile) {
        requestData.sourceCode = `// ${selectedFile.name}`;
        requestData.sourceFile = selectedFile.name;
        requestData.language = selectedFile.language || 'python';
      }

      const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';
      const response = await fetch(`${baseURL}/stream/agent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
        },
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        let buffer = '';
        let fullAssistantText = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value);
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const eventMatch = line.match(/^event: (.+)$/m);
            const dataMatch = line.match(/^data: (.+)$/m);

            if (eventMatch && dataMatch) {
              const eventType = eventMatch[1];
              try {
                const eventData = JSON.parse(dataMatch[1]);

                if (eventType === 'progress') {
                  if (eventData.progress !== undefined) setProgress(eventData.progress);
                  if (eventData.message) setCurrentStep(eventData.message);
                  if (eventData.type === 'text' && eventData.message) {
                    fullAssistantText += eventData.message;
                    setStreamMessages(prev =>
                      prev.map(m => m.id === assistantId
                        ? { ...m, content: m.content + eventData.message }
                        : m
                      )
                    );
                  }
                } else if (eventType === 'complete') {
                  if (eventData.testCode) {
                    const codeBlock = '\n\n```' + (selectedFile?.language || 'python') + '\n' + eventData.testCode + '\n```\n';
                    fullAssistantText += codeBlock;
                    setStreamMessages(prev =>
                      prev.map(m => m.id === assistantId
                        ? { ...m, content: m.content + codeBlock, isStreaming: false }
                        : m
                      )
                    );
                  }
                  setCurrentStep('✅ 完成');
                  // 保存助手消息到后端
                  if (fullAssistantText) {
                    saveMessageToServer(sessionId, 'assistant', fullAssistantText);
                  }
                } else if (eventType === 'error') {
                  setError(eventData.message);
                  setStreamMessages(prev =>
                    prev.map(m => m.id === assistantId
                      ? { ...m, content: m.content + `\n\n❌ 错误: ${eventData.message}`, isStreaming: false }
                      : m
                    )
                  );
                }
              } catch (parseError) {
                console.error('解析事件失败:', parseError);
              }
            }
          }
        }
      }

      setIsStreaming(false);
      setProgress(0);
      setSelectedFile(null);
      loadSessions();
    } catch (err: any) {
      console.error('流式请求失败:', err);
      setError(err.message);
      setIsStreaming(false);
    }
  };

  const saveMessageToServer = async (sessionId: number, role: 'user' | 'assistant', content: string) => {
    try {
      await apiClient.post(`/sessions/${sessionId}/messages`, {
        content,
        messageType: 'text',
      });
    } catch (error) {
      console.error('保存消息失败:', error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleStreamSend();
    }
  };

  /**
   * 渲染消息
   */
  const renderMessage = (msg: StreamMessage) => {
    const isUser = msg.role === 'user';
    return (
      <div
        key={msg.id}
        style={{
          display: 'flex',
          gap: 12,
          marginBottom: 20,
          justifyContent: isUser ? 'flex-end' : 'flex-start',
        }}
      >
        {!isUser && (
          <Avatar size={36} style={{ backgroundColor: '#52c41a', flexShrink: 0 }} icon={<RobotOutlined />} />
        )}
        <div style={{ maxWidth: '75%' }}>
          <div
            style={{
              fontSize: 12,
              color: '#999',
              marginBottom: 4,
              textAlign: isUser ? 'right' : 'left',
            }}
          >
            {isUser ? '你' : 'AI 助手'} · {new Date(msg.createdAt).toLocaleTimeString()}
          </div>
          <div
            style={{
              background: isUser ? '#1890ff' : '#f6f6f6',
              color: isUser ? '#fff' : '#000',
              borderRadius: 8,
              padding: '12px 16px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: msg.content.includes('```') ? 'Consolas, monospace' : 'inherit',
              fontSize: msg.content.includes('```') ? 13 : 14,
            }}
          >
            {msg.content || '...'}
          </div>
        </div>
        {isUser && (
          <Avatar size={36} style={{ backgroundColor: '#1890ff', flexShrink: 0 }} icon={<UserOutlined />} />
        )}
      </div>
    );
  };

  return (
    <>
    <Layout style={{ height: 'calc(100vh - 64px)', background: '#fff', overflow: 'hidden' }}>
      {/* 左侧会话历史 */}
      <Sider width={280} style={{ background: '#fafafa', borderRight: '1px solid #f0f0f0', overflow: 'auto' }}>
        <div style={{ padding: 12, borderBottom: '1px solid #f0f0f0' }}>
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            <Space>
              <BranchesOutlined style={{ color: '#1890ff' }} />
              <Text strong>Agent 会话</Text>
            </Space>
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              onClick={handleNewSession}
              block
              size="small"
            >
              新建会话
            </Button>
          </Space>
        </div>

        <div style={{ padding: 8 }}>
          {filteredSessions.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无 Agent 会话"
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
                    padding: '8px 12px',
                    margin: '2px 0',
                  }}
                  onClick={() => handleSelectSession(s.id)}
                  actions={[
                    currentSessionId === s.id ? (
                      <Popconfirm
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
                      </Popconfirm>
                    ) : null,
                  ]}
                >
                  <div>
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

      {/* 右侧聊天区域 */}
      <Content style={{ display: 'flex', flexDirection: 'column' }}>
        {/* 头部 */}
        <div style={{ padding: 12, borderBottom: '1px solid #f0f0f0', background: '#fff' }}>
          <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
            <Space wrap>
              <Select
                value={taskMode}
                onChange={setTaskMode}
                style={{ width: 180 }}
                size="small"
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
              <Tag color={taskMode === 'autonomous' ? 'blue' : 'green'}>
                {taskMode === 'autonomous' ? 'LLM 自主' : '7 步流水线'}
              </Tag>
              {selectedFile && (
                <Tag color="purple" closable onClose={() => setSelectedFile(null)}>
                  <CodeOutlined /> {selectedFile.name}
                </Tag>
              )}
            </Space>
            <Button
              size="small"
              icon={<ClearOutlined />}
              onClick={() => {
                setStreamMessages([]);
                setError(null);
              }}
              disabled={streamMessages.length === 0}
            >
              清空
            </Button>
          </Space>
        </div>

        {/* 进度条 */}
        {(isStreaming || progress > 0) && (
          <div style={{ padding: 8, background: '#f0f5ff', borderBottom: '1px solid #f0f0f0' }}>
            <Space direction="vertical" style={{ width: '100%' }} size={4}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {currentStep || '准备中...'}
              </Text>
              <Progress percent={progress} size="small" status={isStreaming ? 'active' : 'success'} />
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
            padding: 24,
            background: '#fafafa',
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
            </div>
          ) : (
            streamMessages.map(renderMessage)
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入 */}
        <div style={{ padding: 12, background: '#fff', borderTop: '1px solid #f0f0f0' }}>
          <Space.Compact style={{ width: '100%' }}>
            <TextArea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息..."
              autoSize={{ minRows: 1, maxRows: 4 }}
              disabled={isStreaming}
              style={{ flex: 1 }}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleStreamSend}
              loading={isStreaming}
              disabled={!inputValue.trim()}
              style={{ height: 'auto' }}
            >
              发送
            </Button>
          </Space.Compact>
        </div>
      </Content>
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
