import { BrowserRouter as Router, Routes, Route, Link, useLocation, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Flex, IconButton } from "@radix-ui/themes";
import { ExitIcon, BarChartIcon } from "@radix-ui/react-icons";
import Dashboard from "./components/features/Dashboard";

import { Login } from "./components/auth/Login";
import { Register } from "./components/auth/Register";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import LanguageSwitcher from "./components/ui/LanguageSwitcher";
import CurrencySwitcher from "./components/ui/CurrencySwitcher";
import { useAuth } from "./contexts/authContext";

function AppContent() {
  const { t } = useTranslation();
  const location = useLocation();
  const { isAuthenticated, loading, logout, user } = useAuth();

  const isAuthPage =
    location.pathname === "/login" || location.pathname === "/register";

  // Wait for auth to initialize (checking localStorage)
  if (loading) {
    return null;
  }

  // Redirect unauthenticated users to login
  if (!isAuthenticated && !isAuthPage) {
    return <Navigate to="/login" replace />;
  }

  // Auth pages render standalone — no nav bar, no layout wrapper
  if (isAuthPage) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Routes>
    );
  }

  // Authenticated app shell with navigation
  return (
    <Flex direction="column" minHeight="100vh" className="app-shell">
      {isAuthenticated && (
        <header className="app-header">
          <Flex align="center" justify="between" className="app-header-inner">
            <Link to="/" className="brand-lockup">
              <span className="brand-mark"><BarChartIcon /></span>
              <span className="brand-name">{t("nav.title")}</span>
            </Link>
            <Flex align="center" gap="3" className="header-actions">
              <span className="user-chip">{user?.username}</span>
              {/* Money and words are two different settings. */}
              <CurrencySwitcher />
              <LanguageSwitcher />
              <IconButton variant="soft" className="header-logout" onClick={logout} aria-label={t("nav.logout")} title={t("nav.logout")}>
                <ExitIcon />
              </IconButton>
            </Flex>
          </Flex>
        </header>
      )}

      {/* `asChild` so the page frame is a real <main> landmark: the app had no
          main and no nav, only an implicit banner. */}
      <Flex asChild flexGrow="1" direction="column" className="page-frame" style={{ flex: 1 }}>
        <main>
          <Routes>
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            {/* The app is homepage-only now. A bookmark or link to a page that
                was removed must land on the dashboard instead of rendering the
                shell with no route matched. */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </Flex>
    </Flex>
  );
}

function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}

export default App;
