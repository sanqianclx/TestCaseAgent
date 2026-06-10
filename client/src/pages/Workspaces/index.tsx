/**
 * 工作空间管理页面
 */

import React, { useEffect, useState } from 'react';
import {
  Card,
  List,
  Button,
  Space,
  Typography,
  Tag,
  Modal,
  Form,
  Input,
  Switch,
  message,
  Popconfirm,
  Empty,
  Tabs,
} from 'antd';
import {
  PlusOutlined,
  FolderOutlined,
  DeleteOutlined,
  EnvironmentOutlined,
  FileSearchOutlined,
} from '@ant-design/icons';
import * as workspacesApi from '../../api/workspaces';
import type { Workspace, CreateWorkspaceParams } from '../../api/workspaces';
import FileSelector from './FileSelector';
import DirectoryBrowser from './DirectoryBrowser';

const { Title, Text } = Typography;

const Workspaces: React.FC = () => {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [form] = Form.useForm();
  const [activeTab, setActiveTab] = useState('list');

  useEffect(() => {
    loadWorkspaces();
  }, []);

  const loadWorkspaces = async () => {
    setLoading(true);
    try {
      const result = await workspacesApi.getWorkspaces();
      setWorkspaces(result);
    } catch (error) {
      message.error('加载工作空间失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (values: CreateWorkspaceParams) => {
    try {
      await workspacesApi.createWorkspace(values);
      message.success('工作空间创建成功');
      setModalVisible(false);
      form.resetFields();
      loadWorkspaces();
    } catch (error: any) {
      message.error(error.response?.data?.message || '创建失败');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await workspacesApi.deleteWorkspace(id);
      message.success('已删除');
      loadWorkspaces();
    } catch (error) {
      message.error('删除失败');
    }
  };

  const tabItems = [
    {
      key: 'list',
      label: '工作空间列表',
      children: (
        <Card>
          {workspaces.length === 0 ? (
            <Empty description="暂无工作空间">
              <Button type="primary" onClick={() => setModalVisible(true)}>
                创建工作空间
              </Button>
            </Empty>
          ) : (
            <List
              dataSource={workspaces}
              renderItem={(workspace) => (
                <List.Item
                  actions={[
                    <Button
                      type="link"
                      icon={<FileSearchOutlined />}
                      onClick={() => setActiveTab('files')}
                    >
                      浏览文件
                    </Button>,
                    <Popconfirm
                      title="确定删除这个工作空间吗？"
                      onConfirm={() => handleDelete(workspace.id)}
                    >
                      <Button danger icon={<DeleteOutlined />}>
                        删除
                      </Button>
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={
                      <FolderOutlined style={{ fontSize: 24, color: '#1890ff' }} />
                    }
                    title={
                      <Space>
                        <Text strong>{workspace.name}</Text>
                        {workspace.isDefault && (
                          <Tag color="blue">默认</Tag>
                        )}
                      </Space>
                    }
                    description={
                      <Space direction="vertical" size={4}>
                        <Space>
                          <EnvironmentOutlined />
                          <Text copyable style={{ fontSize: 12 }}>
                            {workspace.basePath}
                          </Text>
                        </Space>
                        {workspace.description && (
                          <Text type="secondary">{workspace.description}</Text>
                        )}
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          )}
        </Card>
      ),
    },
    {
      key: 'files',
      label: '浏览文件',
      children: <FileSelector />,
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={3} style={{ margin: 0 }}>工作空间</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>
          创建工作空间
        </Button>
      </div>

      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />

      <Modal
        title="创建工作空间"
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        width={600}
      >
        <Form
          form={form}
          onFinish={handleCreate}
          layout="vertical"
        >
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="例如：我的项目" />
          </Form.Item>

          <Form.Item
            name="basePath"
            label="工作目录"
            rules={[{ required: true, message: '请选择工作目录' }]}
          >
            <DirectoryBrowser />
          </Form.Item>

          <Form.Item name="description" label="描述">
            <Input.TextArea placeholder="可选描述" />
          </Form.Item>

          <Form.Item name="isDefault" label="设为默认" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                创建
              </Button>
              <Button onClick={() => setModalVisible(false)}>
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
};

export default Workspaces;
