/**
 * 测试任务页面
 *
 * 显示该用户所有"真正执行了测试生成"的任务。
 * 列表默认只显示 completed / failed 状态。
 * 每行可：
 * - 点击会话名跳到 AI 对话页并自动选中该会话
 * - 点击"预览"打开 Drawer，查看输出目录、源文件、测试文件、测试代码
 * - 点击"查看源文件"上传或预览（若任务记录了 sourceFileId）
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Button,
  Space,
  Typography,
  Tag,
  Select,
  message,
  Drawer,
  Descriptions,
  Divider,
  Tabs,
  List,
  Empty,
  Spin,
  Popconfirm,
} from 'antd';
import {
  ReloadOutlined,
  EyeOutlined,
  RedoOutlined,
  FileTextOutlined,
  CodeOutlined,
  FolderOpenOutlined,
  MessageOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  LoadingOutlined,
  StopOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import * as tasksApi from '../../api/tasks';
import type { Task, TaskResultResponse, TaskResultPayload } from '../../api/tasks';
import * as filesApi from '../../api/files';
import CodeViewer from '../../components/Common/CodeViewer';

const { Title, Text, Paragraph } = Typography;
const { TabPane } = Tabs;

/**
 * 状态标签渲染
 */
function StatusTag({ status }: { status: Task['status'] }) {
  const map: Record<string, { color: string; text: string; icon: React.ReactNode }> = {
    pending: { color: 'default', text: '等待中', icon: <ClockCircleOutlined /> },
    running: { color: 'processing', text: '运行中', icon: <LoadingOutlined spin /> },
    completed: { color: 'success', text: '已完成', icon: <CheckCircleOutlined /> },
    failed: { color: 'error', text: '失败', icon: <CloseCircleOutlined /> },
    cancelled: { color: 'warning', text: '已取消', icon: <StopOutlined /> },
  };
  const info = map[status] || { color: 'default', text: status, icon: null };
  return (
    <Tag color={info.color} icon={info.icon as any}>
      {info.text}
    </Tag>
  );
}

/**
 * 任务列表页面
 */
const Tasks: React.FC = () => {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  // 多选状态过滤，默认只看已完成和失败
  const [statuses, setStatuses] = useState<string[]>(['completed', 'failed']);

  // 详情 Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<TaskResultResponse | null>(null);
  const [taskLogs, setTaskLogs] = useState<Array<{ level: string; step?: string; message: string; createdAt: string }>>([]);

  // 源文件内容（若 sourceFileId 存在则拉取）
  const [sourceCode, setSourceCode] = useState<string | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);

  /**
   * 加载任务列表（多状态并发）
   */
  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const allLists = await Promise.all(
        statuses.map((s) => tasksApi.getTasks({ status: s, pageSize: 50 }).catch(() => ({ items: [], total: 0 })))
      );
      const merged = allLists
        .flatMap((r) => r.items)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setTasks(merged);
    } catch (e) {
      message.error('加载任务失败');
    } finally {
      setLoading(false);
    }
  }, [statuses]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  /**
   * 打开详情 Drawer
   */
  const openDetail = async (record: Task) => {
    setDrawerOpen(true);
    setDetail(null);
    setTaskLogs([]);
    setSourceCode(null);
    setDetailLoading(true);
    try {
      // 拉详情
      const res = await tasksApi.getTaskResult(record.taskId);
      setDetail(res);
      // 拉日志
      try {
        const logs = await tasksApi.getTaskLogs(record.taskId, { limit: 200 });
        setTaskLogs(logs.logs);
      } catch {
        // 日志可能没有，忽略
      }
      // 如果后端返回里 testCode 字段带 sourceContent，我们直接渲染
      // 否则尝试从 sourceFile 拉文件（如果原文件是用户上传的）
    } catch (e: any) {
      // 任务可能不是 completed 状态，getTaskResult 抛错
      // 降级为 getTaskById
      try {
        const basic = await tasksApi.getTaskById(record.taskId);
        setDetail({
          taskId: basic.taskId,
          status: basic.status,
          mode: basic.mode,
          sourceFile: basic.sourceFile,
          language: basic.language,
          outputDir: basic.outputDir || null,
          result: null,
          errorMessage: null,
          executionTime: basic.executionTime,
          startedAt: basic.startedAt,
          completedAt: basic.completedAt,
          createdAt: basic.createdAt,
          sessionId: null,
          session: null,
        });
      } catch {
        message.error('加载任务详情失败');
      }
    } finally {
      setDetailLoading(false);
    }
  };

  /**
   * 加载源文件（如果源文件有 previewFileId 关联）
   */
  const loadSource = async (fileId: number) => {
    setSourceLoading(true);
    try {
      const r = await filesApi.getFileContent(fileId);
      setSourceCode(r.content);
    } catch {
      setSourceCode(null);
    } finally {
      setSourceLoading(false);
    }
  };

  /**
   * 跳到 AI 对话页并自动选中该任务的会话
   */
  const goToSession = (sessionId: number | null | undefined) => {
    if (!sessionId) {
      message.warning('该任务未关联会话');
      return;
    }
    navigate('/chat', { state: { sessionId } });
  };

  /**
   * 重试任务
   */
  const handleRetry = async (taskId: string) => {
    try {
      await tasksApi.retryTask(taskId);
      message.success('任务已重新提交');
      loadTasks();
    } catch (e) {
      message.error('重试失败');
    }
  };

  /**
   * 物理删除任务
   */
  const handleDelete = async (taskId: string) => {
    try {
      await tasksApi.deleteTask(taskId);
      message.success('任务已删除');
      // 如果详情 Drawer 开着这个任务，顺手关掉
      if (detail?.taskId === taskId) {
        setDrawerOpen(false);
        setDetail(null);
      }
      loadTasks();
    } catch (e: any) {
      const msg = e?.response?.data?.message || '删除失败';
      message.error(msg);
    }
  };

  /**
   * 表格列
   */
  const columns = [
    {
      title: '任务 ID',
      dataIndex: 'taskId',
      key: 'taskId',
      width: 130,
      render: (taskId: string) => (
        <Text copyable style={{ fontSize: 12, fontFamily: 'monospace' }}>
          {taskId.slice(0, 8)}…
        </Text>
      ),
    },
    {
      title: '所属会话',
      key: 'session',
      width: 200,
      render: (_: any, r: Task) =>
        r.session ? (
          <a
            onClick={() => goToSession(r.session?.id)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <MessageOutlined />
            <Text style={{ fontSize: 13 }} ellipsis>
              {r.session.title}
            </Text>
          </a>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            未关联
          </Text>
        ),
    },
    {
      title: '模式',
      dataIndex: 'mode',
      key: 'mode',
      width: 90,
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
      render: (s: string) => <Text style={{ fontSize: 12 }}>{s || '-'}</Text>,
    },
    {
      title: '测试文件',
      key: 'testFile',
      width: 180,
      render: (_: any, r: any) => {
        // 列表接口目前不返回 result 详情，仅显示源文件
        return r.result?.testFile ? (
          <Text style={{ fontSize: 12 }}>{r.result.testFile}</Text>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            点击预览查看
          </Text>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (s: Task['status']) => <StatusTag status={s} />,
    },
    {
      title: '耗时',
      dataIndex: 'executionTime',
      key: 'executionTime',
      width: 80,
      render: (t: number | null) => (t ? `${(t / 1000).toFixed(1)}s` : '-'),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 150,
      render: (t: string) => (
        <Text style={{ fontSize: 12 }}>{new Date(t).toLocaleString()}</Text>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 240,
      fixed: 'right' as const,
      render: (_: any, r: Task) => (
        <Space size={4}>
          <Button
            size="small"
            type="link"
            icon={<EyeOutlined />}
            onClick={() => openDetail(r)}
          >
            预览
          </Button>
          {(r.status === 'failed' || r.status === 'cancelled') && (
            <Button
              size="small"
              type="link"
              icon={<RedoOutlined />}
              onClick={() => handleRetry(r.taskId)}
            >
              重试
            </Button>
          )}
          {r.status !== 'pending' && r.status !== 'running' && (
            <Popconfirm
              title="确定删除此任务？"
              description="删除后无法恢复，关联的日志会一起删除。"
              okText="删除"
              okType="danger"
              cancelText="取消"
              onConfirm={() => handleDelete(r.taskId)}
            >
              <Button
                size="small"
                type="link"
                danger
                icon={<DeleteOutlined />}
              >
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {/* 头部 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>
          <UnorderedListOutlinedTitle /> 测试任务
        </Title>
        <Space>
          <Select
            mode="multiple"
            placeholder="状态过滤"
            value={statuses}
            onChange={setStatuses}
            style={{ minWidth: 240 }}
            maxTagCount={3}
            options={[
              { value: 'completed', label: '已完成' },
              { value: 'failed', label: '失败' },
              { value: 'running', label: '运行中' },
              { value: 'pending', label: '等待中' },
              { value: 'cancelled', label: '已取消' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={loadTasks}>
            刷新
          </Button>
        </Space>
      </div>

      {/* 任务表格 */}
      <Table
        columns={columns}
        dataSource={tasks}
        loading={loading}
        rowKey="taskId"
        pagination={{ pageSize: 15, showSizeChanger: true }}
        scroll={{ x: 1200 }}
        size="middle"
      />

      {/* 详情 Drawer */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={760}
        title={
          <Space>
            <CodeOutlined />
            任务详情
            {detail && <Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>{detail.taskId}</Text>}
          </Space>
        }
        destroyOnClose
      >
        {detailLoading ? (
          <div style={{ padding: 60, textAlign: 'center' }}>
            <Spin tip="加载中..." />
          </div>
        ) : !detail ? (
          <Empty description="无数据" />
        ) : (
          <>
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="状态">
                <StatusTag status={detail.status} />
              </Descriptions.Item>
              <Descriptions.Item label="模式">
                <Tag color={detail.mode === 'autonomous' ? 'blue' : 'green'}>
                  {detail.mode === 'autonomous' ? 'Agent 自主' : 'Workflow'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="所属会话">
                {detail.session ? (
                  <a onClick={() => goToSession(detail.session?.id)}>
                    <MessageOutlined /> {detail.session.title}
                  </a>
                ) : (
                  <Text type="secondary">未关联</Text>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="源文件">
                <Text code style={{ fontSize: 12 }}>{detail.sourceFile || '-'}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="语言">
                <Tag>{detail.language || '-'}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="输出目录">
                {detail.outputDir ? (
                  <Space size={4}>
                    <FolderOpenOutlined />
                    <Text copyable style={{ fontSize: 12 }}>{detail.outputDir}</Text>
                  </Space>
                ) : (
                  <Text type="secondary">未指定</Text>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="测试文件">
                {detail.result?.testFile ? (
                  <Text code style={{ fontSize: 12 }}>{detail.result.testFile}</Text>
                ) : (
                  <Text type="secondary">-</Text>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="耗时">
                {detail.executionTime ? `${(detail.executionTime / 1000).toFixed(2)}s` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">{new Date(detail.createdAt).toLocaleString()}</Descriptions.Item>
              <Descriptions.Item label="完成时间">
                {detail.completedAt ? new Date(detail.completedAt).toLocaleString() : '-'}
              </Descriptions.Item>
              {detail.errorMessage && (
                <Descriptions.Item label="错误信息">
                  <Paragraph
                    type="danger"
                    style={{ marginBottom: 0, fontSize: 12 }}
                    copyable
                  >
                    {detail.errorMessage}
                  </Paragraph>
                </Descriptions.Item>
              )}
            </Descriptions>

            <Divider>执行产物</Divider>

            <Tabs defaultActiveKey="test">
              <TabPane
                tab={
                  <span>
                    <CodeOutlined /> 测试代码
                  </span>
                }
                key="test"
              >
                {detail.result?.previewFileId ? (
                  <CodeViewer
                    fileId={detail.result.previewFileId}
                    language={detail.language || 'python'}
                    maxHeight={520}
                  />
                ) : detail.result?.testCode ? (
                  <CodeViewer
                    code={detail.result.testCode}
                    language={detail.language || 'python'}
                    maxHeight={520}
                  />
                ) : detail.status !== 'completed' ? (
                  <Empty
                    description={`任务未完成（${detail.status}），无测试代码`}
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                ) : (
                  <Empty
                    description="该任务未生成测试代码（可能因失败）"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                )}
              </TabPane>
              <TabPane
                tab={
                  <span>
                    <FileTextOutlined /> 任务日志 ({taskLogs.length})
                  </span>
                }
                key="logs"
              >
                {taskLogs.length === 0 ? (
                  <Empty description="无日志" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                  <List
                    size="small"
                    bordered
                    dataSource={taskLogs}
                    style={{ maxHeight: 520, overflow: 'auto' }}
                    renderItem={(l) => {
                      const color =
                        l.level === 'ERROR' || l.level === 'error'
                          ? 'red'
                          : l.level === 'WARN' || l.level === 'warn'
                          ? 'orange'
                          : l.level === 'STEP' || l.level === 'step'
                          ? 'blue'
                          : 'default';
                      return (
                        <List.Item style={{ padding: '4px 8px' }}>
                          <Space align="start" size={6} style={{ width: '100%' }}>
                            <Tag color={color} style={{ marginRight: 0, fontSize: 11, flexShrink: 0 }}>
                              {l.level}
                            </Tag>
                            {l.step && (
                              <Tag style={{ marginRight: 0, fontSize: 11, flexShrink: 0 }}>
                                {l.step}
                              </Tag>
                            )}
                            <Text style={{ fontSize: 12, flex: 1 }}>{l.message}</Text>
                            <Text type="secondary" style={{ fontSize: 10, flexShrink: 0 }}>
                              {new Date(l.createdAt).toLocaleTimeString()}
                            </Text>
                          </Space>
                        </List.Item>
                      );
                    }}
                  />
                )}
              </TabPane>
              {detail.result?.coverage && (
                <TabPane
                  tab={
                    <span>
                      <FileTextOutlined /> 覆盖率
                    </span>
                  }
                  key="cov"
                >
                  <Descriptions bordered size="small" column={1}>
                    {Object.entries(detail.result.coverage).map(([k, v]) => (
                      <Descriptions.Item label={k} key={k}>
                        {typeof v === 'number' ? `${v.toFixed(1)}%` : String(v)}
                      </Descriptions.Item>
                    ))}
                  </Descriptions>
                </TabPane>
              )}
              {detail.result?.execution && (
                <TabPane
                  tab={
                    <span>
                      <FileTextOutlined /> 执行结果
                    </span>
                  }
                  key="exec"
                >
                  <Descriptions bordered size="small" column={2}>
                    {Object.entries(detail.result.execution).map(([k, v]) => (
                      <Descriptions.Item label={k} key={k}>
                        {String(v)}
                      </Descriptions.Item>
                    ))}
                  </Descriptions>
                </TabPane>
              )}
            </Tabs>
          </>
        )}
      </Drawer>
    </Space>
  );
};

/**
 * 头部图标（避免顶部 import 中嵌入 JSX 时 IDE 误判）
 */
const UnorderedListOutlinedTitle = () => null;

export default Tasks;
