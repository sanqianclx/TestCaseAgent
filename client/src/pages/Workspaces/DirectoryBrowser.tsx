/**
 * 工作空间路径浏览器
 *
 * 提供常用路径快捷选择和手动输入两种方式
 */

import React, { useState } from 'react';
import {
  Card,
  Input,
  Button,
  Space,
  Typography,
  Tree,
  Alert,
  Tag,
} from 'antd';
import {
  FolderOpenOutlined,
  DesktopOutlined,
  ReloadOutlined,
} from '@ant-design/icons';

const { Text } = Typography;

/**
 * 路径浏览器组件
 */
const DirectoryBrowser: React.FC<{
  value?: string;
  onChange?: (path: string) => void;
}> = ({ value, onChange }) => {
  const [inputValue, setInputValue] = useState(value || '');

  /**
   * 常用路径（Windows）
   */
  const commonPaths = [
    { label: '桌面', path: 'C:\\Users\\Administrator\\Desktop' },
    { label: '文档', path: 'C:\\Users\\Administrator\\Documents' },
    { label: '下载', path: 'C:\\Users\\Administrator\\Downloads' },
    { label: 'D 盘', path: 'D:\\' },
    { label: 'C 盘', path: 'C:\\' },
    { label: '项目根', path: 'D:\\deepseekV4-workspace' },
  ];

  /**
   * 选择路径
   */
  const handleSelectPath = (path: string) => {
    setInputValue(path);
    onChange?.(path);
  };

  /**
   * 尝试用 File System Access API 选文件夹
   */
  const handleBrowseFolder = async () => {
    const w = window as any;
    if (w.showDirectoryPicker) {
      try {
        const dirHandle = await w.showDirectoryPicker();
        // 获取完整路径（部分浏览器支持）
        const fullPath = (dirHandle as any).fullPath || dirHandle.name;
        handleSelectPath(fullPath);
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          // 降级方案
        }
      }
    }
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Alert
        message="请输入工作目录的完整路径"
        description={
          <div>
            <div>Windows 示例：<Text code copyable>D:\projects\my-project</Text></div>
            <div>Linux/Mac 示例：<Text code copyable>/home/user/project</Text></div>
          </div>
        }
        type="info"
        showIcon
      />

      <Space.Compact style={{ width: '100%' }}>
        <Input
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            onChange?.(e.target.value);
          }}
          placeholder="D:\projects\my-project"
          prefix={<FolderOpenOutlined />}
          allowClear
        />
        <Button type="primary" onClick={handleBrowseFolder} icon={<DesktopOutlined />}>
          打开文件夹
        </Button>
      </Space.Compact>

      <Card size="small" title="📁 常用路径" styles={{ body: { padding: 8 } }}>
        <Space wrap>
          {commonPaths.map((p) => (
            <Tag
              key={p.path}
              icon={<FolderOpenOutlined />}
              color={value === p.path ? 'blue' : 'default'}
              style={{ cursor: 'pointer', padding: '4px 8px' }}
              onClick={() => handleSelectPath(p.path)}
            >
              {p.label}
            </Tag>
          ))}
        </Space>
      </Card>
    </Space>
  );
};

export default DirectoryBrowser;
