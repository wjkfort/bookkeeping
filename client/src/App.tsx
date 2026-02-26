import React, { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ConfigProvider, Layout, Menu } from "antd";
import { DashboardOutlined, TransactionOutlined, AppstoreOutlined } from "@ant-design/icons";
import Dashboard from "./components/Dashboard";
import Transactions from "./components/Transactions";
import Categories from "./components/Categories";
import LanguageSwitcher from "./components/LanguageSwitcher";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";

const { Header, Content } = Layout;

function AppContent() {
  const { t } = useTranslation();
  const location = useLocation();
  const [selectedKey, setSelectedKey] = useState(location.pathname);

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
  ];

  return (
    <Layout style={{ minHeight: "100vh", borderRadius: "8px" }}>
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
        <LanguageSwitcher />
      </Header>
      <Content style={{ padding: "24px", background: "#f0f2f5" }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/categories" element={<Categories />} />
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
