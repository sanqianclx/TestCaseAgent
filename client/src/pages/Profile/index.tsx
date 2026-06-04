/**
 * 个人资料页面
 */

import React, { useEffect, useState } from 'react';
import {
  Card,
  Form,
  Input,
  Button,
  Avatar,
  Typography,
  Space,
  message,
  Divider,
  Row,
  Col,
  Statistic,
} from 'antd';
import { UserOutlined, MailOutlined, LockOutlined, EditOutlined } from '@ant-design/icons';
import { useAuthStore } from '../../stores/authStore';
import * as authApi from '../../api/auth';

const { Title, Text } = Typography;

const Profile: React.FC = () => {
  const { user, fetchUser } = useAuthStore();
  const [profileForm] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      profileForm.setFieldsValue({
        username: user.username,
        email: user.email,
      });
    }
  }, [user, profileForm]);

  /**
   * 更新个人资料
   */
  const handleUpdateProfile = async (values: { username: string }) => {
    setLoading(true);
    try {
      await authApi.updateProfile({ username: values.username });
      message.success('用户名更新成功');
      setEditMode(false);
      await fetchUser();
    } catch (error: any) {
      message.error(error.response?.data?.message || '更新失败');
    } finally {
      setLoading(false);
    }
  };

  /**
   * 修改密码
   */
  const handleChangePassword = async (values: {
    oldPassword: string;
    newPassword: string;
  }) => {
    setLoading(true);
    try {
      await authApi.changePassword(values);
      message.success('密码修改成功，请重新登录');
      passwordForm.resetFields();
      // 清除 token 并跳转到登录页
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      window.location.href = '/login';
    } catch (error: any) {
      message.error(error.response?.data?.message || '修改失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* 头部 */}
        <div>
          <Title level={3} style={{ margin: 0 }}>个人资料</Title>
          <Text type="secondary">管理您的账户信息</Text>
        </div>

        {/* 资料卡片 */}
        <Card>
          <Row gutter={24} align="middle">
            <Col flex="200px">
              <div style={{ textAlign: 'center' }}>
                <Avatar size={100} icon={<UserOutlined />} style={{ backgroundColor: '#1890ff' }} />
                <div style={{ marginTop: 16 }}>
                  <Title level={4} style={{ margin: 0 }}>{user?.username}</Title>
                  <Text type="secondary">{user?.email}</Text>
                </div>
              </div>
            </Col>
            <Col flex="auto">
              <Row gutter={16}>
                <Col span={8}>
                  <Statistic
                    title="API Keys"
                    value={user?._count?.apiKeys || 0}
                    valueStyle={{ color: '#722ed1' }}
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title="工作空间"
                    value={user?._count?.workspaces || 0}
                    valueStyle={{ color: '#52c41a' }}
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title="任务数"
                    value={user?._count?.tasks || 0}
                    valueStyle={{ color: '#fa8c16' }}
                  />
                </Col>
              </Row>
            </Col>
          </Row>
        </Card>

        {/* 账户信息 */}
        <Card title="账户信息" extra={
          !editMode ? (
            <Button icon={<EditOutlined />} onClick={() => setEditMode(true)}>
              编辑
            </Button>
          ) : null
        }>
          <Form
            form={profileForm}
            layout="vertical"
            onFinish={handleUpdateProfile}
            disabled={!editMode}
          >
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="username"
                  label="用户名"
                  rules={[
                    { required: true, message: '请输入用户名' },
                    { min: 3, message: '用户名至少 3 个字符' },
                    { pattern: /^[a-zA-Z0-9_]+$/, message: '只能包含字母、数字和下划线' },
                  ]}
                >
                  <Input prefix={<UserOutlined />} placeholder="用户名" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="email"
                  label="邮箱"
                  tooltip="邮箱不可修改"
                >
                  <Input
                    prefix={<MailOutlined />}
                    disabled
                    placeholder="邮箱"
                  />
                </Form.Item>
              </Col>
            </Row>

            {editMode && (
              <Form.Item>
                <Space>
                  <Button type="primary" htmlType="submit" loading={loading}>
                    保存
                  </Button>
                  <Button
                    onClick={() => {
                      setEditMode(false);
                      profileForm.setFieldsValue({ username: user?.username });
                    }}
                  >
                    取消
                  </Button>
                </Space>
              </Form.Item>
            )}
          </Form>
        </Card>

        {/* 修改密码 */}
        <Card title="修改密码">
          <Form
            form={passwordForm}
            layout="vertical"
            onFinish={handleChangePassword}
          >
            <Form.Item
              name="oldPassword"
              label="当前密码"
              rules={[{ required: true, message: '请输入当前密码' }]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="当前密码" />
            </Form.Item>

            <Form.Item
              name="newPassword"
              label="新密码"
              rules={[
                { required: true, message: '请输入新密码' },
                { min: 8, message: '密码至少 8 个字符' },
                {
                  pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
                  message: '需要包含大小写字母和数字',
                },
              ]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="新密码" />
            </Form.Item>

            <Form.Item
              name="confirmPassword"
              label="确认新密码"
              dependencies={['newPassword']}
              rules={[
                { required: true, message: '请确认新密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('newPassword') === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error('两次密码不一致'));
                  },
                }),
              ]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="确认新密码" />
            </Form.Item>

            <Form.Item>
              <Button type="primary" htmlType="submit" loading={loading}>
                修改密码
              </Button>
            </Form.Item>
          </Form>
        </Card>
      </Space>
    </div>
  );
};

export default Profile;
