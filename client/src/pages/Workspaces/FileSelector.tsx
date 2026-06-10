/**
 * 工作空间文件选择器
 *
 * 显示工作目录下的所有文件，让用户选择要生成测试的文件
 */

import React, { useState, useEffect } from 'react';
import {
  Card,
  Tree,
  Button,
  Space,
  Typography,
  Tag,
  Empty,
  Spin,
  Breadcrumb,
  Select,
  message,
} from 'antd';
import {
  FolderOutlined,
  FileOutlined,
  CodeOutlined,
  ReloadOutlined,
  CheckOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import * as workspacesApi from '../../api/workspaces';
import type { Workspace } from '../../api/workspaces';

const { Text, Title } = Typography;
const { DirectoryTree } = Tree;

/**
 * 文件信息
 */
interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number | null;
  language: string | null;
  lastModified: string;
}

/**
 * 文件选择器组件
 */
const FileSelector: React.FC = () => {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<number | null>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);

  useEffect(() => {
    loadWorkspaces();
  }, []);

  useEffect(() => {
    if (selectedWorkspace) {
      loadFiles('');
    }
  }, [selectedWorkspace]);

  /**
   * 加载工作空间列表
   */
  const loadWorkspaces = async () => {
    try {
      const result = await workspacesApi.getWorkspaces();
      setWorkspaces(result);
      if (result.length > 0) {
        setSelectedWorkspace(result[0].id);
      }
    } catch (error) {
      message.error('加载工作空间失败');
    }
  };

  /**
   * 加载文件列表
   */
  const loadFiles = async (path: string) => {
    if (!selectedWorkspace) return;
    setLoading(true);
    try {
      const result = await workspacesApi.browseFiles(selectedWorkspace, path);
      setFiles(result.files);
      setCurrentPath(result.currentPath);
    } catch (error: any) {
      message.error(error.response?.data?.message || '加载文件失败');
    } finally {
      setLoading(false);
    }
  };

  /**
   * 选择文件
   */
  const handleSelectFile = (file: FileItem) => {
    if (file.type === 'file') {
      setSelectedFile(file);
    } else {
      loadFiles(file.path);
    }
  };

  /**
   * 选择文件并跳转到聊天
   */
  const handleGenerateTest = async () => {
    if (!selectedFile) {
      message.warning('请先选择一个文件');
      return;
    }

    // 创建会话并跳转到聊天
    navigate('/chat', {
      state: {
        selectedFile: selectedFile,
        workspaceId: selectedWorkspace,
      },
    });
  };

  /**
   * 获取文件图标
   */
  const getFileIcon = (file: FileItem) => {
    if (file.type === 'directory') {
      return <FolderOutlined style={{ color: '#faad14' }} />;
    }
    if (file.language === 'python' || file.language === 'java' || file.language === 'cpp') {
      return <CodeOutlined style={{ color: '#52c41a' }} />;
    }
    return <FileTextOutlined style={{ color: '#1890ff' }} />;
  };

  /**
   * 格式化文件大小
   */
  const formatSize = (bytes: number | null) => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  /**
   * 面包屑导航
   */
  const renderBreadcrumb = () => {
    const parts = currentPath.split('/').filter(Boolean);
    const items = [
      {
        title: <a onClick={() => loadFiles('')}>根目录</a>,
      },
      ...parts.map((part, index) => ({
        title: (
          <a
            onClick={() => {
              const path = parts.slice(0, index + 1).join('/');
              loadFiles(path);
            }}
          >
            {part}
          </a>
        ),
      })),
    ];
    return <Breadcrumb items={items} />;
  };

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {/* 头部 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={3} style={{ margin: 0 }}>选择文件生成测试</Title>
        <Space>
          <Select
            placeholder="选择工作空间"
            value={selectedWorkspace}
            onChange={setSelectedWorkspace}
            style={{ width: 250 }}
            options={workspaces.map(ws => ({
              value: ws.id,
              label: ws.name,
            }))}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => loadFiles(currentPath)}
            loading={loading}
          >
            刷新
          </Button>
        </Space>
      </div>

      {workspaces.length === 0 ? (
        <Card>
          <Empty description="还没有工作空间">
            <Button type="primary" onClick={() => navigate('/workspaces')}>
              创建工作空间
            </Button>
          </Empty>
        </Card>
      ) : (
        <>
          {/* 面包屑 */}
          <Card>
            {renderBreadcrumb()}
          </Card>

          {/* 文件列表 */}
          <Card
            title="文件列表"
            extra={
              <Button
                type="primary"
                icon={<CheckOutlined />}
                onClick={handleGenerateTest}
                disabled={!selectedFile}
              >
                为选中文件生成测试
              </Button>
            }
          >
            <Spin spinning={loading}>
              {files.length === 0 ? (
                <Empty description="此目录为空" />
              ) : (
                <div>
                  {files.map((file) => (
                    <div
                      key={file.path}
                      onClick={() => handleSelectFile(file)}
                      onDoubleClick={() => file.type === 'directory' && handleSelectFile(file)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '12px 16px',
                        borderRadius: 6,
                        marginBottom: 8,
                        cursor: 'pointer',
                        background: selectedFile?.path === file.path ? '#e6f7ff' : 'transparent',
                        border: selectedFile?.path === file.path ? '1px solid #1890ff' : '1px solid transparent',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        if (selectedFile?.path !== file.path) {
                          e.currentTarget.style.background = '#f5f5f5';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (selectedFile?.path !== file.path) {
                          e.currentTarget.style.background = 'transparent';
                        }
                      }}
                    >
                      <span style={{ fontSize: 20, marginRight: 12 }}>
                        {getFileIcon(file)}
                      </span>
                      <div style={{ flex: 1 }}>
                        <Text strong>{file.name}</Text>
                      </div>
                      <Space>
                        {file.language && (
                          <Tag color="blue">{file.language}</Tag>
                        )}
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {formatSize(file.size)}
                        </Text>
                      </Space>
                    </div>
                  ))}
                </div>
              )}
            </Spin>
          </Card>

          {/* 已选择的文件 */}
          {selectedFile && (
            <Card title="已选择的文件" style={{ background: '#f0f5ff' }}>
              <Space>
                <CodeOutlined style={{ fontSize: 24, color: '#1890ff' }} />
                <div>
                  <Text strong>{selectedFile.name}</Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {selectedFile.path}
                  </Text>
                </div>
              </Space>
            </Card>
          )}
        </>
      )}
    </Space>
  );
};

export default FileSelector;
