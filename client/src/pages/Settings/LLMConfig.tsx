/**
 * LLM 配置页面
 *
 * 用户添加多个 DeepSeek API Key，但只能启用一个。
 */

import React, { useState, useEffect } from 'react';
import {
  Card,
  Form,
  Input,
  Button,
  Space,
  Typography,
  Tag,
  Alert,
  message,
  List,
  Modal,
  Popconfirm,
  Empty,
  Switch,
  Tooltip,
} from 'antd';
import {
  KeyOutlined,
  CheckCircleOutlined,
  PlusOutlined,
  DeleteOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  RobotOutlined,
  BranchesOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ApiOutlined,
} from '@ant-design/icons';
import apiClient from '../../api/client';

const { Title, Text, Paragraph } = Typography;

interface ApiKey {
  id: number;
  name: string;
  prefix: string;
  isActive: boolean;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
}

interface LLMConfigData {
  provider: string;
  model: string;
  baseUrl: string;
  userHasKey: boolean;
  activeKey: ApiKey | null;
}

const LLMConfig: React.FC = () => {
  const [form] = Form.useForm();
  const [config, setConfig] = useState<LLMConfigData | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [showKey, setShowKey] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ valid: boolean; message: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  /**
   * 加载数据
   */
  const loadData = async () => {
    setLoading(true);
    try {
      const [configRes, keysRes] = await Promise.all([
        apiClient.get('/config/llm'),
        apiClient.get('/api-keys'),
      ]);
      if (configRes.data.code === 0) {
        setConfig(configRes.data.data);
      }
      if (keysRes.data.code === 0) {
        setApiKeys(keysRes.data.data.items || []);
      }
    } catch (error) {
      console.error('加载配置失败:', error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * 添加 API Key
   */
  const handleAdd = async (values: { name: string; apiKey: string }) => {
    try {
      const response = await apiClient.post('/api-keys', {
        name: values.name,
        apiKey: values.apiKey,
      });
      if (response.data.code === 0) {
        message.success('API Key 添加成功并已启用');
        setModalVisible(false);
        form.resetFields();
        loadData();
      } else {
        message.error(response.data.message);
      }
    } catch (error: any) {
      message.error(error.response?.data?.message || '添加失败');
    }
  };

  /**
   * 启用 API Key
   */
  const handleActivate = async (id: number) => {
    try {
      await apiClient.post(`/api-keys/${id}/activate`);
      message.success('已启用此 API Key');
      loadData();
    } catch (error: any) {
      message.error('启用失败');
    }
  };

  /**
   * 停用 API Key
   */
  const handleDeactivate = async (id: number) => {
    try {
      await apiClient.post(`/api-keys/${id}/deactivate`);
      message.success('已停用');
      loadData();
    } catch (error: any) {
      message.error('停用失败');
    }
  };

  /**
   * 删除 API Key
   */
  const handleDelete = async (id: number) => {
    try {
      await apiClient.delete(`/api-keys/${id}`);
      message.success('已删除');
      loadData();
    } catch (error: any) {
      message.error('删除失败');
    }
  };

  /**
   * 测试当前 API Key
   */
  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await apiClient.post('/api-keys/test', {
        apiKey: 'current', // 占位符，后端会从数据库取
      });
      if (response.data.code === 0) {
        setTestResult(response.data.data);
        message[response.data.data.valid ? 'success' : 'error'](
          response.data.data.valid ? '连接成功' : '连接失败'
        );
      }
    } catch (error: any) {
      setTestResult({ valid: false, message: '测试失败' });
    } finally {
      setTesting(false);
    }
  };

  const hasActiveKey = config?.userHasKey || false;
  const activeKey = config?.activeKey;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* 头部 */}
        <div>
          <Title level={3} style={{ margin: 0 }}>🔑 LLM 配置</Title>
          <Text type="secondary">配置 DeepSeek API Key，让 AI 助手能调用大模型</Text>
        </div>

        {/* 状态提示 */}
        <Alert
          message={hasActiveKey ? '✅ 已配置 API Key' : '⚠️ 未配置 API Key'}
          description={
            <div>
              <Paragraph style={{ margin: '8px 0' }}>
                {activeKey
                  ? `当前启用: ${activeKey.name} (前缀: ${activeKey.prefix})`
                  : '请添加您的 DeepSeek API Key，否则无法使用 AI 对话功能'}
              </Paragraph>
              <Space direction="vertical" size={4}>
                <Space>
                  <RobotOutlined style={{ color: '#1890ff' }} />
                  <Text>Agent 模式</Text>
                  <Text type="secondary">- LLM 自主规划并调用工具</Text>
                </Space>
                <Space>
                  <BranchesOutlined style={{ color: '#52c41a' }} />
                  <Text>Workflow 模式</Text>
                  <Text type="secondary">- 7 步流水线，每步调用 LLM</Text>
                </Space>
              </Space>
            </div>
          }
          type={hasActiveKey ? 'success' : 'warning'}
          showIcon
        />

        {/* 测试结果 */}
        {testResult && (
          <Alert
            message={testResult.valid ? '✅ 连接成功' : '❌ 连接失败'}
            description={testResult.message}
            type={testResult.valid ? 'success' : 'error'}
            showIcon
            closable
            onClose={() => setTestResult(null)}
          />
        )}

        {/* API Key 列表 */}
        <Card
          title="📋 我的 API Keys"
          extra={
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setModalVisible(true)}
            >
              添加 API Key
            </Button>
          }
        >
          {apiKeys.length === 0 ? (
            <Empty description="还没有 API Key">
              <Button type="primary" onClick={() => setModalVisible(true)}>
                立即添加
              </Button>
            </Empty>
          ) : (
            <List
              loading={loading}
              dataSource={apiKeys}
              renderItem={(key) => (
                <List.Item
                  actions={[
                    key.isActive ? (
                      <Tooltip title="停用此 Key">
                        <Button
                          type="link"
                          icon={<PauseCircleOutlined />}
                          onClick={() => handleDeactivate(key.id)}
                        >
                          停用
                        </Button>
                      </Tooltip>
                    ) : (
                      <Tooltip title="启用此 Key（其他 Key 将自动停用）">
                        <Button
                          type="link"
                          icon={<PlayCircleOutlined />}
                          onClick={() => handleActivate(key.id)}
                        >
                          启用
                        </Button>
                      </Tooltip>
                    ),
                    <Popconfirm
                      title="确定删除这个 API Key？"
                      description="删除后无法恢复"
                      onConfirm={() => handleDelete(key.id)}
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
                    avatar={
                      <KeyOutlined
                        style={{
                          fontSize: 24,
                          color: key.isActive ? '#52c41a' : '#999',
                        }}
                      />
                    }
                    title={
                      <Space>
                        <Text strong>{key.name}</Text>
                        {key.isActive ? (
                          <Tag color="green" icon={<CheckCircleOutlined />}>
                            ✓ 已启用
                          </Tag>
                        ) : (
                          <Tag>未启用</Tag>
                        )}
                        <Text type="secondary" code style={{ fontSize: 12 }}>
                          {key.prefix}...
                        </Text>
                      </Space>
                    }
                    description={
                      <Space size="large" style={{ fontSize: 12 }}>
                        <Text type="secondary">
                          创建: {new Date(key.createdAt).toLocaleString()}
                        </Text>
                        <Text type="secondary">
                          使用: {key.usageCount} 次
                        </Text>
                        {key.lastUsedAt && (
                          <Text type="secondary">
                            最后使用: {new Date(key.lastUsedAt).toLocaleString()}
                          </Text>
                        )}
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          )}
        </Card>

        {/* 测试按钮 */}
        {hasActiveKey && (
          <Card>
            <Space>
              <Button
                icon={<ApiOutlined />}
                onClick={handleTest}
                loading={testing}
              >
                测试当前 API Key 连接
              </Button>
              <Text type="secondary">
                测试当前启用的 DeepSeek API Key 是否有效
              </Text>
            </Space>
          </Card>
        )}

        {/* 添加 API Key 弹窗 */}
        <Modal
          title="添加 DeepSeek API Key"
          open={modalVisible}
          onCancel={() => {
            setModalVisible(false);
            form.resetFields();
          }}
          footer={null}
        >
          <Alert
            message="您的 API Key 将被加密存储"
            description="只用于调用 DeepSeek 大模型，不会上传到任何其他地方。"
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />

          <Form form={form} onFinish={handleAdd} layout="vertical">
            <Form.Item
              name="name"
              label="名称"
              rules={[{ required: true, message: '请输入名称' }]}
            >
              <Input placeholder="例如：我的 DeepSeek Key" />
            </Form.Item>

            <Form.Item
              name="apiKey"
              label="API Key"
              rules={[
                { required: true, message: '请输入 API Key' },
                { pattern: /^sk-/, message: 'DeepSeek API Key 应以 sk- 开头' },
              ]}
            >
              <Input.Password
                prefix={<KeyOutlined />}
                placeholder="sk-xxxxxxxxxxxxxxxx"
                visibilityToggle={{
                  visible: showKey,
                  onVisibleChange: setShowKey,
                }}
              />
            </Form.Item>

            <Form.Item>
              <Space>
                <Button type="primary" htmlType="submit">
                  添加并启用
                </Button>
                <Button onClick={() => {
                  setModalVisible(false);
                  form.resetFields();
                }}>
                  取消
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </Modal>

        {/* 使用说明 */}
        <Card title="💡 如何获取 DeepSeek API Key">
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <div>
              <Title level={5}>1. 注册 DeepSeek 账户</Title>
              <Paragraph>
                访问 <a href="https://platform.deepseek.com" target="_blank" rel="noopener noreferrer">DeepSeek 平台</a>
                ，注册并登录账户。
              </Paragraph>
            </div>

            <div>
              <Title level={5}>2. 创建 API Key</Title>
              <Paragraph>
                在控制台中点击 "API Keys" → "Create new secret key"，复制生成的 Key。
              </Paragraph>
            </div>

            <div>
              <Title level={5}>3. 添加到 TestGenerate</Title>
              <Paragraph>
                点击"添加 API Key"按钮，粘贴您的 Key。添加后会自动启用。
                如果您有多个 Key，可以切换启用其中一个。
              </Paragraph>
            </div>
          </Space>
        </Card>
      </Space>
    </div>
  );
};

export default LLMConfig;
