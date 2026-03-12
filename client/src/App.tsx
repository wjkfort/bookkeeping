import { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ConfigProvider, Layout, Menu, Button } from "antd";
import { DashboardOutlined, TransactionOutlined, AppstoreOutlined, ShoppingOutlined, LogoutOutlined } from "@ant-design/icons";
import Dashboard from "./components/features/Dashboard";
import Transactions from "./components/features/Transactions";
import Categories from "./components/features/Categories";
import Items from "./components/features/Items";
import AIChat from "./components/features/ai/AIChat";
import { Login } from "./components/auth/Login";
import { Register } from "./components/auth/Register";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import LanguageSwitcher from "./components/ui/LanguageSwitcher";
import { useAuth } from "./contexts/AuthContext";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";
import { antdTheme } from "./theme/antdTheme";
import "./theme/globalStyles.css";

const { Header, Content } = Layout;

function AppContent() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [selectedKey, setSelectedKey] = useState(location.pathname);
  const { isAuthenticated, logout, user } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setSelectedKey(location.pathname);
  }, [location.pathname]);

  const handleTransactionCreated = () => {
    // Trigger refresh by updating key
    setRefreshKey(prev => prev + 1);
    // If not on dashboard or transactions page, navigate there
    if (location.pathname !== '/' && location.pathname !== '/transactions') {
      navigate('/transactions');
    }
  };

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
    <Layout style={{ minHeight: "100vh", background: "var(--bg-primary)" }}>
      {!isAuthPage && isAuthenticated && (
        <Header className="app-header">
          <div className="header-content">
            <div className="header-left">
              <div className="header-brand">
                <span className="header-brand-icon">💰</span>
                <h1 className="header-brand-title">{t("nav.title")}</h1>
              </div>
              <Menu 
                theme="light" 
                mode="horizontal" 
                selectedKeys={[selectedKey]} 
                items={menuItems} 
                className="header-menu"
              />
            </div>
            <div className="header-right">
              <span className="header-username">{user?.username}</span>
              <LanguageSwitcher />
              <Button 
                type="text" 
                icon={<LogoutOutlined />} 
                onClick={logout}
                className="header-logout-btn"
              >
                {t("nav.logout")}
              </Button>
            </div>
          </div>
        </Header>
      )}
      <Content className={isAuthPage ? "content-auth" : "content-main"}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/" element={<ProtectedRoute><Dashboard key={`dashboard-${refreshKey}`} /></ProtectedRoute>} />
          <Route path="/transactions" element={<ProtectedRoute><Transactions key={`transactions-${refreshKey}`} /></ProtectedRoute>} />
          <Route path="/categories" element={<ProtectedRoute><Categories /></ProtectedRoute>} />
          <Route path="/items" element={<ProtectedRoute><Items /></ProtectedRoute>} />
        </Routes>
        {!isAuthPage && isAuthenticated && <AIChat onTransactionCreated={handleTransactionCreated} />}
      </Content>
    </Layout>
  );
}

function App() {
  const { i18n } = useTranslation();
  const locale = i18n.language === "zh" ? zhCN : enUS;

  return (
    <ConfigProvider locale={locale} theme={antdTheme}>
      <Router>
        <AppContent />
      </Router>
    </ConfigProvider>
  );
}

export default App;
