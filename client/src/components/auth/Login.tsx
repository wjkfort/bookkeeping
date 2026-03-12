import React, { useState } from "react";
import { Form, Input, Button, Card, Typography, message } from "antd";
import { UserOutlined, LockOutlined, ArrowRightOutlined } from "@ant-design/icons";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "../ui/LanguageSwitcher";
import "./Auth.css";

const { Title, Text } = Typography;

export const Login: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const onFinish = async (values: { email: string; password: string }) => {
    setLoading(true);
    try {
      await login(values.email, values.password);
      message.success(t("login.success") || "Login successful!");
      navigate("/");
    } catch (error: any) {
      const errorMsg = error.message || t("login.error") || "Login failed";
      
      if (errorMsg.includes("Invalid credentials") || errorMsg.includes("credentials")) {
        message.warning(t("login.hint") || "Don't have an account? Please register first!");
      } else {
        message.error(errorMsg);
      }
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
          <p className="auth-brand-subtitle">{t("login.subtitle") || "Track your finances with ease"}</p>
        </div>

        <Card className="auth-card" variant="borderless">
          <div className="auth-card-header">
            <Title level={2} className="auth-card-title">{t("login.title") || "Welcome Back"}</Title>
            <Text className="auth-card-subtitle">{t("login.subtitle") || "Sign in to continue"}</Text>
          </div>

          <Form name="login" onFinish={onFinish} autoComplete="off" layout="vertical" size="large">
            <Form.Item
              name="email"
              rules={[
                { required: true, message: t("login.emailRequired") || "Please input your email!" },
                { type: "email", message: t("login.emailInvalid") || "Please enter a valid email!" },
              ]}
            >
              <Input 
                prefix={<UserOutlined style={{ color: "#a8a29e" }} />} 
                placeholder={t("login.emailPlaceholder") || "Email"} 
              />
            </Form.Item>

            <Form.Item 
              name="password" 
              rules={[{ required: true, message: t("login.passwordRequired") || "Please input your password!" }]}
            >
              <Input.Password 
                prefix={<LockOutlined style={{ color: "#a8a29e" }} />} 
                placeholder={t("login.passwordPlaceholder") || "Password"} 
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
                {t("login.button") || "Log in"}
              </Button>
            </Form.Item>

            <div className="auth-footer">
              <Text className="auth-footer-text">
                {t("login.noAccount") || "Don't have an account?"}{" "}
                <Link to="/register" className="auth-link">
                  {t("login.registerLink") || "Register now"}
                </Link>
              </Text>
            </div>
          </Form>
        </Card>
      </div>
    </div>
  );
};
