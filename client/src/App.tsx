import { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ConfigProvider, Layout, Menu, Button } from "antd";
import { DashboardOutlined, TransactionOutlined, AppstoreOutlined, ShoppingOutlined, LogoutOutlined } from "@ant-design/icons";
import Dashboard from "./components/features/Dashboard";
import Transactions from "./components/features/Transactions";
import Categories from "./components/features/Categories";
import Items from "./components/features/Items";
import { Login } from "./components/auth/Login";
import { Register } from "./components/auth/Register";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import LanguageSwitcher from "./components/ui/LanguageSwitcher";
import { useAuth } from "./contexts/AuthContext";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";

const { Header, Content } = Layout;

function AppContent() {
  const { t } = useTranslation();
  const location = useLocation();
  const [selectedKey, setSelectedKey] = useState(location.pathname);
  const { isAuthenticated, logout, user } = useAuth();

  useEffect(() => {
    setSelectedKey(location.pathname);
  }, [location.pathname]);

  const menuItems = [
    {
      key: "/",
      icon: <DashboardOutlined />,
      label: <Link to="/">{t("nav.dashboard")}</Link>,
    },
    {
      key: "/transactions",
      icon: <TransactionOutlined />,
      label: <Link to="/transactions">{t("nav.transactions")}</Link>,
    },
    {
      key: "/categories",
      icon: <AppstoreOutlined />,
      label: <Link to="/categories">{t("nav.categories")}</Link>,
    },
    {
      key: "/items",
      icon: <ShoppingOutlined />,
      label: <Link to="/items">{t("nav.items")}</Link>,
    },
  ];

  // Don't show header on login/register pages
  const isAuthPage = location.pathname === '/login' || location.pathname === '/register';

  return (
    <Layout style={{ minHeight: "100vh", borderRadius: isAuthPage ? "0" : "8px" }}>
      {!isAuthPage && isAuthenticated && (
        <Header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 24px",
            borderRadius: "8px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            margin: "8px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "24px", flex: 1 }}>
            <h1 style={{ color: "white", margin: 0, fontSize: "20px", whiteSpace: "nowrap" }}>{t("nav.title")}</h1>
            <Menu theme="dark" mode="horizontal" selectedKeys={[selectedKey]} items={menuItems} style={{ flex: 1, minWidth: 0, border: "none" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <span style={{ color: "white" }}>{user?.username}</span>
            <LanguageSwitcher />
            <Button 
              type="text" 
              icon={<LogoutOutlined />} 
              onClick={logout}
              style={{ color: "white" }}
            >
              {t("nav.logout")}
            </Button>
          </div>
        </Header>
      )}
      <Content style={{ padding: isAuthPage ? "0" : "24px", background: "#f0f2f5" }}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/transactions" element={<ProtectedRoute><Transactions /></ProtectedRoute>} />
          <Route path="/categories" element={<ProtectedRoute><Categories /></ProtectedRoute>} />
          <Route path="/items" element={<ProtectedRoute><Items /></ProtectedRoute>} />
        </Routes>
      </Content>
    </Layout>
  );
}

function App() {
  const { i18n } = useTranslation();
  const locale = i18n.language === "zh" ? zhCN : enUS;

  return (
    <ConfigProvider locale={locale}>
      <Router>
        <AppContent />
      </Router>
    </ConfigProvider>
  );
}

export default App;
