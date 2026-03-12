import React, { useState } from 'react';
import { Form, Input, Button, Card, Typography, message } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../ui/LanguageSwitcher';
import './Auth.css';

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
    <div className="auth-container">
      <div className="auth-background">
        <div className="auth-blob auth-blob-1"></div>
        <div className="auth-blob auth-blob-2"></div>
        <div className="auth-blob auth-blob-3"></div>
      </div>
      
      <div className="auth-language-switcher">
        <LanguageSwitcher />
      </div>

      <div className="auth-content">
        <div className="auth-brand">
          <div className="auth-brand-icon">💰</div>
          <h1 className="auth-brand-title">{t("nav.title") || "Bookkeeping"}</h1>
          <p className="auth-brand-subtitle">{t("register.subtitle") || "Start tracking your finances today"}</p>
        </div>

        <Card className="auth-card" variant="borderless">
          <div className="auth-card-header">
            <Title level={2} className="auth-card-title">{t('register.title') || 'Create Account'}</Title>
            <Text className="auth-card-subtitle">{t('register.subtitle') || 'Join us to get started'}</Text>
          </div>

          <Form
            name="register"
            onFinish={onFinish}
            autoComplete="off"
            layout="vertical"
            size="large"
          >
            <Form.Item
              name="username"
              rules={[{ required: true, message: t('register.usernameRequired') || 'Please input your username!' }]}
            >
              <Input 
                prefix={<UserOutlined style={{ color: "#a8a29e" }} />} 
                placeholder={t('register.usernamePlaceholder') || 'Username'} 
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
                prefix={<MailOutlined style={{ color: "#a8a29e" }} />} 
                placeholder={t('register.emailPlaceholder') || 'Email'} 
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
                prefix={<LockOutlined style={{ color: "#a8a29e" }} />}
                placeholder={t('register.passwordPlaceholder') || 'Password (min 6 characters)'}
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
                prefix={<LockOutlined style={{ color: "#a8a29e" }} />}
                placeholder={t('register.confirmPasswordPlaceholder') || 'Confirm Password'}
              />
            </Form.Item>

            <Form.Item>
              <Button 
                type="primary" 
                htmlType="submit" 
                loading={loading} 
                block 
                icon={<ArrowRightOutlined />}
                iconPlacement="end"
                className="auth-submit-btn"
              >
                {t('register.button') || 'Register'}
              </Button>
            </Form.Item>

            <div className="auth-footer">
              <Text className="auth-footer-text">
                {t('register.hasAccount') || 'Already have an account?'}{' '}
                <Link to="/login" className="auth-link">
                  {t('register.loginLink') || 'Log in'}
                </Link>
              </Text>
            </div>
          </Form>
        </Card>
      </div>
    </div>
  );
};
