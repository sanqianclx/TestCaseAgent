/**
 * 文件管理页面
 */

import React, { useEffect, useState } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Typography,
  Tag,
  Upload,
  message,
  Popconfirm,
} from 'antd';
import {
  UploadOutlined,
  DeleteOutlined,
  ReloadOutlined,
  FileOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import * as filesApi from '../../api/files';
import type { FileInfo } from '../../api/files';

const { Title } = Typography;

/**
 * 文件管理页面组件
 */
const Files: React.FC = () => {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadFiles();
  }, []);

  /**
   * 加载文件列表
   */
  const loadFiles = async () => {
    setLoading(true);
    try {
      const result = await filesApi.getFiles();
      setFiles(result.items);
    } catch (error) {
      message.error('加载文件失败');
    } finally {
      setLoading(false);
    }
  };

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
      render: (name: string) => (
        <Space>
          <FileOutlined />
          {name}
        </Space>
      ),
    },
    {
      title: '语言',
      dataIndex: 'language',
      key: 'language',
      render: (lang: string | null) => lang ? <Tag>{lang}</Tag> : '-',
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      render: formatSize,
    },
    {
      title: '用途',
      dataIndex: 'purpose',
      key: 'purpose',
      render: (purpose: string) => {
        const colorMap: Record<string, string> = {
          source: 'blue',
          reference: 'green',
          config: 'orange',
        };
        return <Tag color={colorMap[purpose] || 'default'}>{purpose}</Tag>;
      },
    },
    {
      title: '上传时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (time: string) => new Date(time).toLocaleString(),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, record: FileInfo) => (
        <Space>
          <Popconfirm
            title="确定删除这个文件吗？"
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
        <Title level={4} style={{ margin: 0 }}>文件管理</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadFiles}>
            刷新
          </Button>
          <Upload
            showUploadList={false}
            beforeUpload={handleUpload}
            accept=".py,.java,.cpp,.c,.h,.hpp,.txt,.md"
          >
            <Button type="primary" icon={<UploadOutlined />}>
              上传文件
            </Button>
          </Upload>
        </Space>
      </div>

      {/* 文件表格 */}
      <Card>
        <Table
          columns={columns}
          dataSource={files}
          loading={loading}
          rowKey="id"
          pagination={{ pageSize: 10 }}
        />
      </Card>
    </Space>
  );
};

export default Files;
