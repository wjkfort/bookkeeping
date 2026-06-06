import React from "react";
import { Navigate } from "react-router-dom";
import { Flex, Spinner, Text } from "@radix-ui/themes";
import { useAuth } from "../../contexts/AuthContext";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <Flex justify="center" align="center" style={{ minHeight: "60vh" }}>
        <Flex direction="column" align="center" gap="3">
          <Spinner size="3" />
          <Text size="2" color="gray">Loading...</Text>
        </Flex>
      </Flex>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};
