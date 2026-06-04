/**
 * 仪表盘页面
 */

import React, { useEffect, useState } from 'react';
import {
  Card,
  Row,
  Col,
  Statistic,
  Typography,
  Space,
  Spin,
  Progress,
  Avatar,
  List,
  Tag,
  Button,
} from 'antd';
import {
  MessageOutlined,
  ThunderboltOutlined,
  ApiOutlined,
  FolderOutlined,
  FileOutlined,
  RocketOutlined,
  ArrowRightOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  RiseOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import * as sessionsApi from '../../api/sessions';
import * as tasksApi from '../../api/tasks';
import * as apiKeysApi from '../../api/apiKeys';

const { Title, Text, Paragraph } = Typography;

/**
 * 仪表盘页面组件
 */
const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    sessions: { total: 0, active: 0, totalMessages: 0 },
    tasks: { total: 0, completed: 0, running: 0, failed: 0, pending: 0 },
    apiKeys: { total: 0, active: 0 },
  });

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    setLoading(true);
    try {
      const [sessionStats, taskStats, apiKeyStats] = await Promise.allSettled([
        sessionsApi.getSessionStats(),
        tasksApi.getTaskStats(),
        apiKeysApi.getApiKeyStats(),
      ]);

      setStats({
        sessions: sessionStats.status === 'fulfilled'
          ? sessionStats.value
          : { total: 0, active: 0, totalMessages: 0 },
        tasks: taskStats.status === 'fulfilled'
          ? taskStats.value
          : { total: 0, completed: 0, running: 0, failed: 0, pending: 0 },
        apiKeys: apiKeyStats.status === 'fulfilled'
          ? apiKeyStats.value
          : { total: 0, active: 0 },
      });
    } catch (error) {
      console.error('加载统计失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const successRate = stats.tasks.total > 0
    ? Math.round((stats.tasks.completed / stats.tasks.total) * 100)
    : 0;

  return (
    <Spin spinning={loading}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {/* 欢迎卡片 */}
        <Card
          style={{
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            border: 'none',
          }}
          styles={{ body: { padding: '24px 32px' } }}
        >
          <Row align="middle" gutter={16}>
            <Col>
              <Avatar size={64} style={{ backgroundColor: 'rgba(255,255,255,0.2)' }} icon={<UserOutlined />} />
            </Col>
            <Col flex="auto">
              <Title level={3} style={{ color: '#fff', margin: 0 }}>
                欢迎回来，{user?.username || '用户'} 👋
              </Title>
              <Paragraph style={{ color: 'rgba(255,255,255,0.85)', margin: '4px 0 0 0' }}>
                欢迎使用 TestGenerate Agent 智能测试生成系统 · 今天是个生成高质量测试的好日子！
              </Paragraph>
            </Col>
            <Col>
              <Button
                type="primary"
                size="large"
                icon={<RocketOutlined />}
                onClick={() => navigate('/chat')}
                style={{ background: '#fff', color: '#667eea', borderColor: '#fff' }}
              >
                开始生成测试
              </Button>
            </Col>
          </Row>
        </Card>

        {/* 统计卡片 */}
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} lg={6}>
            <Card hoverable styles={{ body: { padding: 20 } }}>
              <Statistic
                title="总会话数"
                value={stats.sessions.total}
                prefix={<MessageOutlined style={{ color: '#1890ff' }} />}
                suffix={<Tag color="blue" style={{ marginLeft: 8 }}>活跃 {stats.sessions.active}</Tag>}
                valueStyle={{ color: '#1890ff' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card hoverable styles={{ body: { padding: 20 } }}>
              <Statistic
                title="总任务数"
                value={stats.tasks.total}
                prefix={<ThunderboltOutlined style={{ color: '#52c41a' }} />}
                suffix={<Tag color="green" style={{ marginLeft: 8 }}>完成 {stats.tasks.completed}</Tag>}
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card hoverable styles={{ body: { padding: 20 } }}>
              <Statistic
                title="API Keys"
                value={stats.apiKeys.total}
                prefix={<ApiOutlined style={{ color: '#722ed1' }} />}
                suffix={<Tag color="purple" style={{ marginLeft: 8 }}>活跃 {stats.apiKeys.active}</Tag>}
                valueStyle={{ color: '#722ed1' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card hoverable styles={{ body: { padding: 20 } }}>
              <Statistic
                title="总消息数"
                value={stats.sessions.totalMessages}
                prefix={<RiseOutlined style={{ color: '#fa8c16' }} />}
                valueStyle={{ color: '#fa8c16' }}
              />
            </Card>
          </Col>
        </Row>

        {/* 主要内容区 */}
        <Row gutter={[16, 16]}>
          {/* 左侧 - 快速操作 */}
          <Col xs={24} lg={16}>
            <Card title="🚀 快速操作" extra={<Text type="secondary">选择开始</Text>}>
              <Row gutter={[16, 16]}>
                <Col xs={24} sm={12} md={8}>
                  <Card
                    hoverable
                    onClick={() => navigate('/chat')}
                    style={{
                      background: 'linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%)',
                      border: 'none',
                      textAlign: 'center',
                    }}
                    styles={{ body: { padding: 24 } }}
                  >
                    <MessageOutlined style={{ fontSize: 40, color: '#1976d2' }} />
                    <div style={{ marginTop: 12, fontSize: 16, fontWeight: 600, color: '#1565c0' }}>
                      AI 对话
                    </div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      智能助手帮您生成
                    </Text>
                  </Card>
                </Col>
                <Col xs={24} sm={12} md={8}>
                  <Card
                    hoverable
                    onClick={() => navigate('/workspaces')}
                    style={{
                      background: 'linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%)',
                      border: 'none',
                      textAlign: 'center',
                    }}
                    styles={{ body: { padding: 24 } }}
                  >
                    <FolderOutlined style={{ fontSize: 40, color: '#388e3c' }} />
                    <div style={{ marginTop: 12, fontSize: 16, fontWeight: 600, color: '#2e7d32' }}>
                      工作空间
                    </div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      配置项目目录
                    </Text>
                  </Card>
                </Col>
                <Col xs={24} sm={12} md={8}>
                  <Card
                    hoverable
                    onClick={() => navigate('/files')}
                    style={{
                      background: 'linear-gradient(135deg, #f3e5f5 0%, #e1bee7 100%)',
                      border: 'none',
                      textAlign: 'center',
                    }}
                    styles={{ body: { padding: 24 } }}
                  >
                    <FileOutlined style={{ fontSize: 40, color: '#7b1fa2' }} />
                    <div style={{ marginTop: 12, fontSize: 16, fontWeight: 600, color: '#6a1b9a' }}>
                      上传文件
                    </div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      提交源代码
                    </Text>
                  </Card>
                </Col>
              </Row>
            </Card>

            {/* 任务状态 */}
            <Card title="📊 任务概览" style={{ marginTop: 16 }}>
              <Row gutter={16}>
                <Col span={12}>
                  <div style={{ textAlign: 'center', padding: 16 }}>
                    <Progress
                      type="circle"
                      percent={successRate}
                      strokeColor={{
                        '0%': '#108ee9',
                        '100%': '#87d068',
                      }}
                      size={120}
                    />
                    <div style={{ marginTop: 12 }}>
                      <Text type="secondary">任务成功率</Text>
                    </div>
                  </div>
                </Col>
                <Col span={12}>
                  <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    <div>
                      <Space>
                        <ClockCircleOutlined style={{ color: '#faad14' }} />
                        <Text>等待中</Text>
                      </Space>
                      <Progress
                        percent={stats.tasks.total > 0 ? (stats.tasks.pending / stats.tasks.total) * 100 : 0}
                        strokeColor="#faad14"
                        showInfo={false}
                      />
                      <Text type="secondary">{stats.tasks.pending} 个任务</Text>
                    </div>
                    <div>
                      <Space>
                        <ThunderboltOutlined style={{ color: '#1890ff' }} />
                        <Text>运行中</Text>
                      </Space>
                      <Progress
                        percent={stats.tasks.total > 0 ? (stats.tasks.running / stats.tasks.total) * 100 : 0}
                        strokeColor="#1890ff"
                        showInfo={false}
                      />
                      <Text type="secondary">{stats.tasks.running} 个任务</Text>
                    </div>
                    <div>
                      <Space>
                        <CheckCircleOutlined style={{ color: '#52c41a' }} />
                        <Text>已完成</Text>
                      </Space>
                      <Progress
                        percent={stats.tasks.total > 0 ? (stats.tasks.completed / stats.tasks.total) * 100 : 0}
                        strokeColor="#52c41a"
                        showInfo={false}
                      />
                      <Text type="secondary">{stats.tasks.completed} 个任务</Text>
                    </div>
                  </Space>
                </Col>
              </Row>
            </Card>
          </Col>

          {/* 右侧 - 活动日志 */}
          <Col xs={24} lg={8}>
            <Card
              title="📈 系统状态"
              extra={
                <Button
                  type="link"
                  size="small"
                  onClick={() => navigate('/tasks')}
                >
                  查看全部 <ArrowRightOutlined />
                </Button>
              }
              style={{ height: '100%' }}
            >
              <List
                size="small"
                dataSource={[
                  {
                    icon: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
                    title: '系统运行正常',
                    desc: '所有服务在线',
                    time: '现在',
                  },
                  {
                    icon: <MessageOutlined style={{ color: '#1890ff' }} />,
                    title: `${stats.sessions.active} 个活跃会话`,
                    desc: '持续对话中',
                    time: '最近',
                  },
                  {
                    icon: <ThunderboltOutlined style={{ color: '#722ed1' }} />,
                    title: `${stats.tasks.total} 个任务记录`,
                    desc: `完成率 ${successRate}%`,
                    time: '累计',
                  },
                  {
                    icon: <ApiOutlined style={{ color: '#fa8c16' }} />,
                    title: `${stats.apiKeys.active} 个 API Key`,
                    desc: '正在使用中',
                    time: '当前',
                  },
                ]}
                renderItem={(item) => (
                  <List.Item>
                    <List.Item.Meta
                      avatar={item.icon}
                      title={<Text>{item.title}</Text>}
                      description={<Text type="secondary" style={{ fontSize: 12 }}>{item.desc}</Text>}
                    />
                    <Text type="secondary" style={{ fontSize: 12 }}>{item.time}</Text>
                  </List.Item>
                )}
              />
            </Card>
          </Col>
        </Row>
      </Space>
    </Spin>
  );
};

export default Dashboard;
