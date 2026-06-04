/**
 * API Key 管理页面
 */

import React, { useEffect, useState } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Typography,
  Tag,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  message,
  Popconfirm,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  ReloadOutlined,
  CopyOutlined,
  KeyOutlined,
} from '@ant-design/icons';
import * as apiKeysApi from '../../api/apiKeys';
import type { ApiKey, CreateApiKeyParams } from '../../api/apiKeys';

const { Title, Text } = Typography;

/**
 * API Key 管理页面组件
 */
const ApiKeys: React.FC = () => {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    loadApiKeys();
  }, []);

  /**
   * 加载 API Key 列表
   */
  const loadApiKeys = async () => {
    setLoading(true);
    try {
      const result = await apiKeysApi.getApiKeys();
      setApiKeys(result.items);
    } catch (error) {
      message.error('加载 API Key 失败');
    } finally {
      setLoading(false);
    }
  };

  /**
   * 创建 API Key
   */
  const handleCreate = async (values: CreateApiKeyParams) => {
    try {
      const result = await apiKeysApi.createApiKey(values);
      setNewKey(result.key);
      form.resetFields();
      loadApiKeys();
    } catch (error) {
      message.error('创建失败');
    }
  };

  /**
   * 删除 API Key
   */
  const handleDelete = async (id: number) => {
    try {
      await apiKeysApi.deleteApiKey(id);
      message.success('已删除');
      loadApiKeys();
    } catch (error) {
      message.error('删除失败');
    }
  };

  /**
   * 复制 Key
   */
  const handleCopy = (key: string) => {
    navigator.clipboard.writeText(key);
    message.success('已复制到剪贴板');
  };

  /**
   * 表格列定义
   */
  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '前缀',
      dataIndex: 'prefix',
      key: 'prefix',
      render: (prefix: string) => <Tag>tg_{prefix}</Tag>,
    },
    {
      title: '权限',
      dataIndex: 'permissions',
      key: 'permissions',
      render: (permissions: string[]) => (
        <Space>
          {permissions.map((p) => (
            <Tag key={p}>{p}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '使用次数',
      dataIndex: 'usageCount',
      key: 'usageCount',
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      key: 'isActive',
      render: (isActive: boolean) => (
        <Tag color={isActive ? 'green' : 'red'}>
          {isActive ? '启用' : '禁用'}
        </Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (time: string) => new Date(time).toLocaleString(),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, record: ApiKey) => (
        <Space>
          <Popconfirm
            title="确定删除这个 API Key 吗？"
            onConfirm={() => handleDelete(record.id)}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {/* 头部 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>API Key 管理</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadApiKeys}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>
            创建 API Key
          </Button>
        </Space>
      </div>

      {/* API Key 表格 */}
      <Card>
        <Table
          columns={columns}
          dataSource={apiKeys}
          loading={loading}
          rowKey="id"
          pagination={{ pageSize: 10 }}
        />
      </Card>

      {/* 创建弹窗 */}
      <Modal
        title="创建 API Key"
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setNewKey(null);
        }}
        footer={newKey ? (
          <Button type="primary" onClick={() => setModalVisible(false)}>
            完成
          </Button>
        ) : null}
      >
        {newKey ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Text type="warning">
              请立即复制保存，此密钥只会显示一次！
            </Text>
            <Input
              value={newKey}
              addonAfter={
                <Tooltip title="复制">
                  <CopyOutlined onClick={() => handleCopy(newKey)} />
                </Tooltip>
              }
              readOnly
            />
          </Space>
        ) : (
          <Form form={form} onFinish={handleCreate} layout="vertical">
            <Form.Item
              name="name"
              label="名称"
              rules={[{ required: true, message: '请输入名称' }]}
            >
              <Input placeholder="例如：我的项目" />
            </Form.Item>

            <Form.Item
              name="permissions"
              label="权限"
              initialValue={['read', 'generate']}
            >
              <Select
                mode="multiple"
                options={[
                  { value: 'read', label: '读取' },
                  { value: 'generate', label: '生成测试' },
                  { value: 'execute', label: '执行测试' },
                  { value: 'export', label: '导出结果' },
                ]}
              />
            </Form.Item>

            <Form.Item
              name="rateLimit"
              label="每小时请求限制"
              initialValue={100}
            >
              <InputNumber min={1} max={10000} style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item>
              <Button type="primary" htmlType="submit" block>
                创建
              </Button>
            </Form.Item>
          </Form>
        )}
      </Modal>
    </Space>
  );
};

export default ApiKeys;
