import React, { useState } from 'react';
import { Form, Input, Button, Card, Typography, message } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined } from '@ant-design/icons';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from './LanguageSwitcher';

const { Title, Text } = Typography;

export const Register: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const onFinish = async (values: { email: string; password: string; username: string }) => {
    setLoading(true);
    try {
      await register(values.email, values.password, values.username);
      message.success(t('register.success') || 'Registration successful!');
      navigate('/');
    } catch (error: any) {
      message.error(error.message || t('register.error') || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      minHeight: '100vh',
      background: '#f0f2f5',
      position: 'relative'
    }}>
      <div style={{ position: 'absolute', top: 24, right: 24 }}>
        <LanguageSwitcher />
      </div>
      <Card style={{ width: 400, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Title level={2}>{t('register.title') || 'Register'}</Title>
          <Text type="secondary">{t('register.subtitle') || 'Create your Bookkeeping account'}</Text>
        </div>

        <Form
          name="register"
          onFinish={onFinish}
          autoComplete="off"
          layout="vertical"
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: t('register.usernameRequired') || 'Please input your username!' }]}
          >
            <Input 
              prefix={<UserOutlined />} 
              placeholder={t('register.usernamePlaceholder') || 'Username'} 
              size="large"
            />
          </Form.Item>

          <Form.Item
            name="email"
            rules={[
              { required: true, message: t('register.emailRequired') || 'Please input your email!' },
              { type: 'email', message: t('register.emailInvalid') || 'Please enter a valid email!' }
            ]}
          >
            <Input 
              prefix={<MailOutlined />} 
              placeholder={t('register.emailPlaceholder') || 'Email'} 
              size="large"
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[
              { required: true, message: t('register.passwordRequired') || 'Please input your password!' },
              { min: 6, message: t('register.passwordMin') || 'Password must be at least 6 characters!' }
            ]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder={t('register.passwordPlaceholder') || 'Password (min 6 characters)'}
              size="large"
            />
          </Form.Item>

          <Form.Item
            name="confirmPassword"
            dependencies={['password']}
            rules={[
              { required: true, message: t('register.confirmPasswordRequired') || 'Please confirm your password!' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error(t('register.passwordMismatch') || 'Passwords do not match!'));
                },
              }),
            ]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder={t('register.confirmPasswordPlaceholder') || 'Confirm Password'}
              size="large"
            />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block size="large">
              {t('register.button') || 'Register'}
            </Button>
          </Form.Item>

          <div style={{ textAlign: 'center' }}>
            <Text>
              {t('register.hasAccount') || 'Already have an account?'}{' '}
              <Link to="/login">{t('register.loginLink') || 'Log in'}</Link>
            </Text>
          </div>
        </Form>
      </Card>
    </div>
  );
};
