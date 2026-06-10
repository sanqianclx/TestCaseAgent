/**
 * 文件管理页面
 *
 * - 列表展示该用户的所有文件
 * - 支持预览文件内容（代码高亮）
 * - 支持按用途过滤（用户上传 / AI 生成的测试代码 / 引用 / 配置 / 其他）
 * - 支持上传 / 删除
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Button,
  Space,
  Typography,
  Tag,
  Upload,
  message,
  Popconfirm,
  Select,
  Tooltip,
} from 'antd';
import {
  UploadOutlined,
  DeleteOutlined,
  ReloadOutlined,
  FileOutlined,
  EyeOutlined,
  RobotOutlined,
  UserOutlined,
} from '@ant-design/icons';
import * as filesApi from '../../api/files';
import type { FileInfo } from '../../api/files';
import CodeViewerModal from '../../components/Common/CodeViewerModal';

const { Title, Text } = Typography;

/**
 * 用途颜色映射
 */
const PURPOSE_COLOR: Record<string, string> = {
  source: 'blue',
  reference: 'green',
  config: 'orange',
  other: 'default',
  test_output: 'magenta',
  test_plan: 'purple',
};

/**
 * 用途中文标签
 */
const PURPOSE_LABEL: Record<string, string> = {
  source: '用户源文件',
  reference: '引用',
  config: '配置',
  other: '其他',
  test_output: 'AI 测试代码',
  test_plan: '测试计划',
};

/**
 * 预览状态
 */
interface PreviewState {
  fileId: number;
  filename: string;
  language: string | null;
}

/**
 * 文件管理页面
 */
const Files: React.FC = () => {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [purposeFilter, setPurposeFilter] = useState<string | undefined>();
  const [preview, setPreview] = useState<PreviewState | null>(null);

  /**
   * 加载文件列表
   */
  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { pageSize: 50 };
      if (purposeFilter) params.purpose = purposeFilter;
      const result = await filesApi.getFiles(params);
      setFiles(result.items);
    } catch (error) {
      message.error('加载文件失败');
    } finally {
      setLoading(false);
    }
  }, [purposeFilter]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  /**
   * 上传文件
   */
  const handleUpload = async (file: File) => {
    try {
      await filesApi.uploadFile(file, { purpose: 'source' });
      message.success('上传成功');
      loadFiles();
    } catch (error) {
      message.error('上传失败');
    }
    return false;
  };

  /**
   * 删除文件
   */
  const handleDelete = async (id: number) => {
    try {
      await filesApi.deleteFile(id);
      message.success('已删除');
      loadFiles();
    } catch (error) {
      message.error('删除失败');
    }
  };

  /**
   * 格式化文件大小
   */
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  /**
   * 表格列定义
   */
  const columns = [
    {
      title: '文件名',
      dataIndex: 'originalName',
      key: 'originalName',
      ellipsis: true,
      render: (name: string, r: FileInfo) => (
        <Space>
          <FileOutlined />
          <Text style={{ fontSize: 13 }}>{name}</Text>
          {r.purpose === 'test_output' && (
            <Tooltip title="由 AI 生成的测试代码">
              <RobotOutlined style={{ color: '#722ed1' }} />
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: '语言',
      dataIndex: 'language',
      key: 'language',
      width: 100,
      render: (lang: string | null) => (lang ? <Tag>{lang}</Tag> : '-'),
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      width: 100,
      render: formatSize,
    },
    {
      title: '用途',
      dataIndex: 'purpose',
      key: 'purpose',
      width: 130,
      render: (purpose: string) => (
        <Tag color={PURPOSE_COLOR[purpose] || 'default'}>
          {purpose === 'test_output' && <RobotOutlined />}
          {purpose === 'source' && <UserOutlined />}
          {PURPOSE_LABEL[purpose] || purpose}
        </Tag>
      ),
    },
    {
      title: '上传时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 150,
      render: (time: string) => new Date(time).toLocaleString(),
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      fixed: 'right' as const,
      render: (_: any, record: FileInfo) => (
        <Space size={4}>
          <Button
            size="small"
            type="link"
            icon={<EyeOutlined />}
            onClick={() =>
              setPreview({
                fileId: record.id,
                filename: record.originalName,
                language: record.language,
              })
            }
          >
            预览
          </Button>
          <Popconfirm
            title="确定删除这个文件吗？"
            onConfirm={() => handleDelete(record.id)}
          >
            <Button size="small" type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {/* 头部 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>
          文件管理
        </Title>
        <Space>
          <Select
            placeholder="用途过滤"
            allowClear
            style={{ width: 160 }}
            value={purposeFilter}
            onChange={setPurposeFilter}
            options={Object.keys(PURPOSE_LABEL).map((k) => ({
              value: k,
              label: PURPOSE_LABEL[k] || k,
            }))}
          />
          <Button icon={<ReloadOutlined />} onClick={loadFiles}>
            刷新
          </Button>
          <Upload
            showUploadList={false}
            beforeUpload={handleUpload}
            accept=".py,.java,.cpp,.c,.h,.hpp,.txt,.md,.json"
          >
            <Button type="primary" icon={<UploadOutlined />}>
              上传文件
            </Button>
          </Upload>
        </Space>
      </div>

      {/* 文件表格 */}
      <Table
        columns={columns}
        dataSource={files}
        loading={loading}
        rowKey="id"
        pagination={{ pageSize: 15, showSizeChanger: true }}
        scroll={{ x: 900 }}
        size="middle"
      />

      {/* 预览弹窗 */}
      <CodeViewerModal
        open={!!preview}
        onClose={() => setPreview(null)}
        fileId={preview?.fileId}
        filename={preview?.filename}
        language={preview?.language}
      />
    </Space>
  );
};

export default Files;
