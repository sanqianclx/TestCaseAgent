/**
 * 主布局组件
 *
 * 紧凑布局，自适应屏幕，不出现整体滚动条
 */

import React from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Avatar, Dropdown, Space, Typography, Tag, message } from 'antd';
import {
  DashboardOutlined,
  MessageOutlined,
  FolderOutlined,
  FileOutlined,
  UserOutlined,
  LogoutOutlined,
  SettingOutlined,
  ExperimentOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../../stores/authStore';

const { Text } = Typography;

const SIDER_WIDTH = 200;
const HEADER_HEIGHT = 56;

/**
 * 侧边栏菜单项
 */
const menuItems = [
  {
    key: '/dashboard',
    icon: <DashboardOutlined />,
    label: '仪表盘',
  },
  {
    key: '/chat',
    icon: <MessageOutlined />,
    label: 'AI 对话',
  },
  {
    key: '/sessions',
    icon: <ExperimentOutlined />,
    label: '会话历史',
  },
  {
    key: '/tasks',
    icon: <UnorderedListOutlined />,
    label: '测试任务',
  },
  {
    key: '/workspaces',
    icon: <FolderOutlined />,
    label: '工作空间',
  },
  {
    key: '/files',
    icon: <FileOutlined />,
    label: '文件管理',
  },
];

/**
 * 主布局组件
 */
const MainLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();

  const handleMenuClick = (info: { key: string }) => {
    navigate(info.key);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: '个人资料',
      onClick: () => navigate('/profile'),
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: 'LLM 设置',
      onClick: () => navigate('/settings'),
    },
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: handleLogout,
    },
  ];

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        position: 'fixed',
        top: 0,
        left: 0,
      }}
    >
      {/* 侧边栏 */}
      <div
        style={{
          width: SIDER_WIDTH,
          minWidth: SIDER_WIDTH,
          height: '100vh',
          background: '#fff',
          borderRight: '1px solid #f0f0f0',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}
      >
        {/* Logo */}
        <div
          style={{
            height: HEADER_HEIGHT,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            padding: '0 16px',
            borderBottom: '1px solid #f0f0f0',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 18, marginRight: 6 }}>🧪</span>
          <Text strong style={{ fontSize: 14 }}>TestGenerate</Text>
          <Tag color="blue" style={{ marginLeft: 4, fontSize: 10 }}>V3</Tag>
        </div>

        {/* 菜单 */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <Menu
            mode="inline"
            selectedKeys={[location.pathname]}
            items={menuItems}
            onClick={handleMenuClick}
            style={{ borderRight: 0 }}
          />
        </div>
      </div>

      {/* 右侧主区域 */}
      <div
        style={{
          flex: 1,
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        {/* 顶部导航 */}
        <div
          style={{
            height: HEADER_HEIGHT,
            background: '#fff',
            borderBottom: '1px solid #f0f0f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 16px',
            flexShrink: 0,
          }}
        >
          <Text type="secondary" style={{ fontSize: 13 }}>
            {(() => {
              const item = menuItems.find(m => m.key === location.pathname);
              return item ? item.label : 'TestGenerate Agent';
            })()}
          </Text>
          <Space size="middle">
            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
              <Space style={{ cursor: 'pointer' }}>
                <Avatar size={28} style={{ backgroundColor: '#1890ff' }} icon={<UserOutlined />} />
                <Text style={{ fontSize: 13 }}>{user?.username || '用户'}</Text>
              </Space>
            </Dropdown>
          </Space>
        </div>

        {/* 主内容区 */}
        <div
          style={{
            flex: 1,
            background: '#f5f7fa',
            overflow: 'auto',
            minHeight: 0,
          }}
        >
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default MainLayout;
