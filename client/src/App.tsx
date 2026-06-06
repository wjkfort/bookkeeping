import { BrowserRouter as Router, Routes, Route, Link, useLocation, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Flex, Container, Tabs, IconButton, Text, Heading, Separator } from "@radix-ui/themes";
import {
  DashboardIcon,
  ListBulletIcon,
  MixerHorizontalIcon,
  ArchiveIcon,
  HomeIcon,
  LightningBoltIcon,
  GearIcon,
  ExitIcon,
} from "@radix-ui/react-icons";
import Dashboard from "./components/features/Dashboard";
import Transactions from "./components/features/Transactions";
import Categories from "./components/features/Categories";
import Items from "./components/features/Items";
import UtilityAddresses from "./components/features/UtilityAddresses";
import UtilityReadings from "./components/features/UtilityReadings";
import UtilityTypes from "./components/features/UtilityTypes";
import { Login } from "./components/auth/Login";
import { Register } from "./components/auth/Register";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import LanguageSwitcher from "./components/ui/LanguageSwitcher";
import { useAuth } from "./contexts/AuthContext";

const navItems = [
  { path: "/", icon: DashboardIcon },
  { path: "/transactions", icon: ListBulletIcon },
  { path: "/categories", icon: MixerHorizontalIcon },
  { path: "/items", icon: ArchiveIcon },
  { path: "/utility-addresses", icon: HomeIcon },
  { path: "/utility-readings", icon: LightningBoltIcon },
  { path: "/utility-types", icon: GearIcon },
] as const;

function AppContent() {
  const { t } = useTranslation();
  const location = useLocation();
  const { isAuthenticated, loading, logout, user } = useAuth();

  const currentTab =
    location.pathname === "/"
      ? "dashboard"
      : location.pathname.replace("/", "") || "dashboard";

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
    <Flex direction="column" minHeight="100vh">
      {isAuthenticated && (
        <>
          <Flex
            px="6"
            py="3"
            align="center"
            justify="between"
            style={{ borderBottom: "1px solid var(--gray-5)" }}
          >
            <Flex align="center" gap="6">
              <Flex align="center" gap="2">
                <Text size="5">💰</Text>
                <Heading size="3" style={{ letterSpacing: "-0.02em" }}>
                  {t("nav.title")}
                </Heading>
              </Flex>
              <Tabs.Root value={currentTab}>
                <Tabs.List>
                  {navItems.map((item) => (
                    <Tabs.Trigger
                      key={item.path}
                      value={
                        item.path === "/"
                          ? "dashboard"
                          : item.path.replace("/", "")
                      }
                      asChild
                    >
                      <Link to={item.path}>
                        <item.icon />
                      </Link>
                    </Tabs.Trigger>
                  ))}
                </Tabs.List>
              </Tabs.Root>
            </Flex>
            <Flex align="center" gap="3">
              <Text size="2" color="gray">
                {user?.username}
              </Text>
              <LanguageSwitcher />
              <IconButton variant="ghost" color="gray" onClick={logout}>
                <ExitIcon />
              </IconButton>
            </Flex>
          </Flex>
          <Separator size="4" />
        </>
      )}

      <Flex flexGrow="1" direction="column">
        <Container size="4" px="4" py="6" style={{ flex: 1 }}>
          <Routes>
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/transactions"
              element={
                <ProtectedRoute>
                  <Transactions />
                </ProtectedRoute>
              }
            />
            <Route
              path="/categories"
              element={
                <ProtectedRoute>
                  <Categories />
                </ProtectedRoute>
              }
            />
            <Route
              path="/items"
              element={
                <ProtectedRoute>
                  <Items />
                </ProtectedRoute>
              }
            />
            <Route
              path="/utility-addresses"
              element={
                <ProtectedRoute>
                  <UtilityAddresses />
                </ProtectedRoute>
              }
            />
            <Route
              path="/utility-readings"
              element={
                <ProtectedRoute>
                  <UtilityReadings />
                </ProtectedRoute>
              }
            />
            <Route
              path="/utility-types"
              element={
                <ProtectedRoute>
                  <UtilityTypes />
                </ProtectedRoute>
              }
            />
          </Routes>
        </Container>
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
