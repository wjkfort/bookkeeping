import React, { useState } from "react";
import { Form, Input, Button, Card, Typography, message } from "antd";
import { UserOutlined, LockOutlined } from "@ant-design/icons";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "../ui/LanguageSwitcher";

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
    } catch (error: unknown) {
      message.error(error.message || t("login.error") || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        background: "#f0f2f5",
        position: "relative",
      }}
    >
      <div style={{ position: "absolute", top: 24, right: 24 }}>
        <LanguageSwitcher />
      </div>
      <Card style={{ width: 400, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <Title level={2}>{t("login.title") || "Login"}</Title>
          <Text type="secondary">{t("login.subtitle") || "Welcome back to Bookkeeping"}</Text>
        </div>

        <Form name="login" onFinish={onFinish} autoComplete="off" layout="vertical">
          <Form.Item
            name="email"
            rules={[
              { required: true, message: t("login.emailRequired") || "Please input your email!" },
              { type: "email", message: t("login.emailInvalid") || "Please enter a valid email!" },
            ]}
          >
            <Input prefix={<UserOutlined />} placeholder={t("login.emailPlaceholder") || "Email"} size="large" />
          </Form.Item>

          <Form.Item name="password" rules={[{ required: true, message: t("login.passwordRequired") || "Please input your password!" }]}>
            <Input.Password prefix={<LockOutlined />} placeholder={t("login.passwordPlaceholder") || "Password"} size="large" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block size="large">
              {t("login.button") || "Log in"}
            </Button>
          </Form.Item>

          <div style={{ textAlign: "center" }}>
            <Text>
              {t("login.noAccount") || "Don't have an account?"} <Link to="/register">{t("login.registerLink") || "Register now"}</Link>
            </Text>
          </div>
        </Form>
      </Card>
    </div>
  );
};
