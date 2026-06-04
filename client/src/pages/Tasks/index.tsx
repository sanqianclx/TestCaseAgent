/**
 * 任务列表页面
 */

import React, { useEffect, useState } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Typography,
  Tag,
  Select,
  message,
  Popconfirm,
} from 'antd';
import {
  ReloadOutlined,
  StopOutlined,
  RedoOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import * as tasksApi from '../../api/tasks';
import type { Task } from '../../api/tasks';

const { Title } = Typography;

/**
 * 任务列表页面组件
 */
const Tasks: React.FC = () => {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | undefined>();

  useEffect(() => {
    loadTasks();
  }, [statusFilter]);

  /**
   * 加载任务列表
   */
  const loadTasks = async () => {
    setLoading(true);
    try {
      const result = await tasksApi.getTasks({ status: statusFilter });
      setTasks(result.items);
    } catch (error) {
      message.error('加载任务失败');
    } finally {
      setLoading(false);
    }
  };

  /**
   * 取消任务
   */
  const handleCancel = async (taskId: string) => {
    try {
      await tasksApi.cancelTask(taskId);
      message.success('任务已取消');
      loadTasks();
    } catch (error) {
      message.error('取消失败');
    }
  };

  /**
   * 重试任务
   */
  const handleRetry = async (taskId: string) => {
    try {
      await tasksApi.retryTask(taskId);
      message.success('任务已重新提交');
      loadTasks();
    } catch (error) {
      message.error('重试失败');
    }
  };

  /**
   * 获取状态标签
   */
  const getStatusTag = (status: string) => {
    const statusMap: Record<string, { color: string; text: string }> = {
      pending: { color: 'default', text: '等待中' },
      running: { color: 'processing', text: '运行中' },
      completed: { color: 'success', text: '已完成' },
      failed: { color: 'error', text: '失败' },
      cancelled: { color: 'warning', text: '已取消' },
    };
    const info = statusMap[status] || { color: 'default', text: status };
    return <Tag color={info.color}>{info.text}</Tag>;
  };

  /**
   * 表格列定义
   */
  const columns = [
    {
      title: '任务 ID',
      dataIndex: 'taskId',
      key: 'taskId',
      render: (taskId: string) => (
        <Text copyable style={{ fontSize: 12 }}>
          {taskId.slice(0, 8)}...
        </Text>
      ),
    },
    {
      title: '模式',
      dataIndex: 'mode',
      key: 'mode',
      render: (mode: string) => (
        <Tag color={mode === 'autonomous' ? 'blue' : 'green'}>
          {mode === 'autonomous' ? 'Agent' : 'Workflow'}
        </Tag>
      ),
    },
    {
      title: '源文件',
      dataIndex: 'sourceFile',
      key: 'sourceFile',
      ellipsis: true,
    },
    {
      title: '语言',
      dataIndex: 'language',
      key: 'language',
      render: (lang: string) => <Tag>{lang}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: getStatusTag,
    },
    {
      title: '尝试次数',
      dataIndex: 'attemptCount',
      key: 'attemptCount',
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
      render: (_: any, record: Task) => (
        <Space>
          {(record.status === 'pending' || record.status === 'running') && (
            <Popconfirm
              title="确定取消这个任务吗？"
              onConfirm={() => handleCancel(record.taskId)}
            >
              <Button size="small" icon={<StopOutlined />}>
                取消
              </Button>
            </Popconfirm>
          )}
          {(record.status === 'failed' || record.status === 'cancelled') && (
            <Button
              size="small"
              icon={<RedoOutlined />}
              onClick={() => handleRetry(record.taskId)}
            >
              重试
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {/* 头部 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>任务管理</Title>
        <Space>
          <Select
            placeholder="筛选状态"
            allowClear
            style={{ width: 150 }}
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'pending', label: '等待中' },
              { value: 'running', label: '运行中' },
              { value: 'completed', label: '已完成' },
              { value: 'failed', label: '失败' },
              { value: 'cancelled', label: '已取消' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={loadTasks}>
            刷新
          </Button>
        </Space>
      </div>

      {/* 任务表格 */}
      <Card>
        <Table
          columns={columns}
          dataSource={tasks}
          loading={loading}
          rowKey="taskId"
          pagination={{ pageSize: 10 }}
        />
      </Card>
    </Space>
  );
};

export default Tasks;
