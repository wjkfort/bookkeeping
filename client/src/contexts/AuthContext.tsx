import React, { useState } from 'react';
import { AuthContext, type AuthUser } from './authContext';
import axios from 'axios';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => {
    const storedToken = localStorage.getItem('auth_token');
    if (storedToken) axios.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`;
    return storedToken;
  });
  const [user, setUser] = useState<AuthUser | null>(() => {
    const storedUser = localStorage.getItem('auth_user');
    return storedUser ? JSON.parse(storedUser) as AuthUser : null;
  });


  const login = async (email: string, password: string) => {
    try {
      const apiBaseUrl = import.meta.env.PROD
        ? "https://bookkeeping-backend.stringwjk.workers.dev/api/v1"
        : "http://localhost:8787/api/v1";
      const response = await axios.post(`${apiBaseUrl}/auth/login`, {
        email,
        password,
      });

      const { token: newToken, user: newUser } = response.data;

      setToken(newToken);
      setUser(newUser);

      // Store in localStorage
      localStorage.setItem('auth_token', newToken);
      localStorage.setItem('auth_user', JSON.stringify(newUser));

      // Set axios default header
      axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
    } catch (error) {
      throw new Error((error as { response?: { data?: { error?: string } } }).response?.data?.error || 'Login failed');
    }
  };

  const register = async (email: string, password: string, username: string) => {
    try {
      const apiBaseUrl = import.meta.env.PROD
        ? "https://bookkeeping-backend.stringwjk.workers.dev/api/v1"
        : "http://localhost:8787/api/v1";
      const response = await axios.post(`${apiBaseUrl}/auth/register`, {
        email,
        password,
        username,
      });

      const { token: newToken, user: newUser } = response.data;

      setToken(newToken);
      setUser(newUser);

      // Store in localStorage
      localStorage.setItem('auth_token', newToken);
      localStorage.setItem('auth_user', JSON.stringify(newUser));

      // Set axios default header
      axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
    } catch (error) {
      throw new Error((error as { response?: { data?: { error?: string } } }).response?.data?.error || 'Registration failed');
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    delete axios.defaults.headers.common['Authorization'];
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        register,
        logout,
        isAuthenticated: !!token,
        loading: false,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
