/**
 * 会话列表页面
 */

import React, { useEffect, useState } from 'react';
import {
  Card,
  List,
  Button,
  Space,
  Typography,
  Tag,
  Empty,
  Popconfirm,
  message,
  Input,
} from 'antd';
import {
  PlusOutlined,
  MessageOutlined,
  DeleteOutlined,
  SaveOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../../stores/sessionStore';
import type { Session } from '../../api/sessions';

const { Text, Title } = Typography;

/**
 * 会话列表页面组件
 */
const Sessions: React.FC = () => {
  const navigate = useNavigate();
  const { sessions, isLoading, fetchSessions, createSession, deleteSession } = useSessionStore();
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  /**
   * 创建新会话
   */
  const handleCreate = async () => {
    try {
      const session = await createSession();
      navigate(`/chat?session=${session.id}`);
    } catch (error) {
      message.error('创建会话失败');
    }
  };

  /**
   * 删除会话
   */
  const handleDelete = async (sessionId: number) => {
    try {
      await deleteSession(sessionId);
      message.success('会话已删除');
    } catch (error) {
      message.error('删除失败');
    }
  };

  /**
   * 进入会话
   */
  const handleEnter = (session: Session) => {
    navigate(`/chat?session=${session.id}`);
  };

  /**
   * 过滤会话
   */
  const filteredSessions = sessions.filter(
    (s) => s.title.toLowerCase().includes(searchText.toLowerCase())
  );

  /**
   * 获取状态颜色
   */
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ACTIVE': return 'green';
      case 'ARCHIVED': return 'orange';
      default: return 'default';
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {/* 头部 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>会话历史</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          新建会话
        </Button>
      </div>

      {/* 搜索 */}
      <Input
        placeholder="搜索会话..."
        prefix={<SearchOutlined />}
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        allowClear
      />

      {/* 会话列表 */}
      <Card>
        <List
          loading={isLoading}
          dataSource={filteredSessions}
          locale={{ emptyText: <Empty description="暂无会话" /> }}
          renderItem={(session) => (
            <List.Item
              actions={[
                <Button
                  type="link"
                  icon={<MessageOutlined />}
                  onClick={() => handleEnter(session)}
                >
                  进入
                </Button>,
                <Popconfirm
                  title="确定删除这个会话吗？"
                  onConfirm={() => handleDelete(session.id)}
                  okText="确定"
                  cancelText="取消"
                >
                  <Button type="link" danger icon={<DeleteOutlined />}>
                    删除
                  </Button>
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space>
                    <Text strong>{session.title}</Text>
                    <Tag color={getStatusColor(session.status)}>
                      {session.status === 'ACTIVE' ? '活跃' : '已归档'}
                    </Tag>
                  </Space>
                }
                description={
                  <Space>
                    <Text type="secondary">
                      消息: {session.messageCount}
                    </Text>
                    <Text type="secondary">
                      Token: {session.totalTokens}
                    </Text>
                    {session.workspace && (
                      <Tag>{session.workspace.name}</Tag>
                    )}
                    <Text type="secondary">
                      {new Date(session.createdAt).toLocaleString()}
                    </Text>
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </Card>
    </Space>
  );
};

export default Sessions;
