/**
 * 应用主组件
 */

import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useAuthStore } from './stores/authStore';

// 布局组件
import MainLayout from './components/Layout/MainLayout';

// 页面组件
import Login from './pages/Auth/Login';
import Register from './pages/Auth/Register';
import Dashboard from './pages/Dashboard/index';
import Chat from './pages/Chat/index';
import Sessions from './pages/Sessions/index';
import Tasks from './pages/Tasks/index';
import Workspaces from './pages/Workspaces/index';
import Files from './pages/Files/index';
import Profile from './pages/Profile/index';
import LLMConfig from './pages/Settings/LLMConfig';

/**
 * 受保护的路由组件
 */
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

/**
 * 应用主组件
 */
const App: React.FC = () => {
  const { fetchUser, isLoading } = useAuthStore();

  // 应用启动时，尝试获取用户信息（通过 cookie 自动认证）
  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  // 首次加载时显示加载状态
  if (isLoading) {
    return <div style={{ padding: 50, textAlign: 'center' }}>加载中...</div>;
  }

  return (
    <ConfigProvider locale={zhCN}>
      <BrowserRouter>
        <Routes>
          {/* 公开路由 */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* 受保护的路由 */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="chat" element={<Chat />} />
            <Route path="sessions" element={<Sessions />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="workspaces" element={<Workspaces />} />
            <Route path="files" element={<Files />} />
            <Route path="profile" element={<Profile />} />
            <Route path="settings" element={<LLMConfig />} />
          </Route>

          {/* 404 重定向 */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
};

export default App;
