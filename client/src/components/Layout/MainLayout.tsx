/**
 * 主布局组件
 */

import React from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Avatar, Dropdown, Space, Typography, Tag, message } from 'antd';
import {
  DashboardOutlined,
  MessageOutlined,
  FolderOutlined,
  FileOutlined,
  ThunderboltOutlined,
  UserOutlined,
  LogoutOutlined,
  SettingOutlined,
  ExperimentOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../../stores/authStore';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const SIDER_WIDTH = 220;
const HEADER_HEIGHT = 64;

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
      onClick: () => {
        navigate('/profile');
      },
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: 'LLM 设置',
      onClick: () => {
        navigate('/settings');
      },
    },
    {
      type: 'divider' as const,
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: handleLogout,
    },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', width: '100%' }}>
      {/* 侧边栏 */}
      <div
        style={{
          width: SIDER_WIDTH,
          minHeight: '100vh',
          background: '#fff',
          borderRight: '1px solid #f0f0f0',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 100,
          overflow: 'auto',
        }}
      >
        {/* Logo */}
        <div style={{
          height: HEADER_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          padding: '0 20px',
          borderBottom: '1px solid #f0f0f0',
        }}>
          <span style={{ fontSize: 20, marginRight: 8 }}>🧪</span>
          <Text strong style={{ fontSize: 16 }}>TestGenerate</Text>
          <Tag color="blue" style={{ marginLeft: 4, fontSize: 10 }}>V3</Tag>
        </div>

        {/* 菜单 */}
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={handleMenuClick}
          style={{ borderRight: 0, paddingTop: 8 }}
        />
      </div>

      {/* 右侧主区域 */}
      <div
        style={{
          marginLeft: SIDER_WIDTH,
          flex: 1,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
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
            padding: '0 24px',
            position: 'sticky',
            top: 0,
            zIndex: 99,
          }}
        >
          <Text type="secondary" style={{ fontSize: 14 }}>
            {(() => {
              const item = menuItems.find(m => m.key === location.pathname);
              return item ? item.label : 'TestGenerate Agent';
            })()}
          </Text>
          <Space size="large">
            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
              <Space style={{ cursor: 'pointer' }}>
                <Avatar style={{ backgroundColor: '#1890ff' }} icon={<UserOutlined />} />
                <Text strong>{user?.username || '用户'}</Text>
              </Space>
            </Dropdown>
          </Space>
        </div>

        {/* 主内容 */}
        <div
          style={{
            flex: 1,
            padding: 24,
            background: '#f5f7fa',
            minHeight: `calc(100vh - ${HEADER_HEIGHT}px)`,
            overflow: 'auto',
          }}
        >
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default MainLayout;
