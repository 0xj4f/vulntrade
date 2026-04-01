import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/apiService';

/**
 * VULN: Auth context stores role in client state.
 * VULN: Role used for client-side route guards (bypassable).
 * VULN: Full user object including sensitive data in React state.
 * VULN: Token stored in localStorage (accessible via XSS).
 */
const AuthContext = createContext(null);

/**
 * Decode JWT payload without signature verification.
 * VULN: Client decodes JWT to read claims including PII - no verification.
 */
function decodeJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return {};
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload));
  } catch (e) {
    return {};
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // VULN: Restore auth from localStorage on page load
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    if (storedToken && storedUser) {
      try {
        const userData = JSON.parse(storedUser);
        // Merge JWT claims into user state (VULN: PII from JWT in React state)
        const jwtClaims = decodeJWT(storedToken);
        const merged = { ...userData, ...jwtClaims };
        setToken(storedToken);
        setUser(merged);
        setIsAuthenticated(true);
      } catch (e) {
        // Invalid stored data
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    }
    setLoading(false);
  }, []);

  const login = async (username, password) => {
    const res = await api.post('/api/auth/login', { username, password });
    const data = res.data;

    // VULN: Store everything in localStorage
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data));

    // Decode JWT and merge claims into user state (VULN: PII exposed in React state)
    const jwtClaims = decodeJWT(data.token);
    const merged = { ...data, ...jwtClaims };

    setToken(data.token);
    setUser(merged);
    setIsAuthenticated(true);

    return data;
  };

  const register = async (username, password, email) => {
    const res = await api.post('/api/auth/register', { username, password, email });
    const data = res.data;

    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data));

    const jwtClaims = decodeJWT(data.token);
    const merged = { ...data, ...jwtClaims };

    setToken(data.token);
    setUser(merged);
    setIsAuthenticated(true);

    return data;
  };

  const logout = () => {
    // VULN: Token not invalidated server-side - old token still works
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    setIsAuthenticated(false);
  };

  // VULN: Role check is purely client-side
  const isAdmin = () => {
    return user?.role === 'ADMIN';
  };

  // Refresh user data (e.g. balance) from backend
  const refreshUser = async () => {
    try {
      const userId = user?.userId || user?.id;
      if (!userId) return;
      const res = await api.get(`/api/users/${userId}`);
      const updated = { ...user, ...res.data };
      setUser(updated);
      localStorage.setItem('user', JSON.stringify(updated));
    } catch (e) {
      console.error('Failed to refresh user:', e);
    }
  };

  // Refresh JWT token from server (gets new token with current DB state)
  // Used after profile update triggers account level change
  const refreshToken = async () => {
    try {
      const res = await api.post('/api/auth/refresh-token');
      const data = res.data;

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data));

      const jwtClaims = decodeJWT(data.token);
      const merged = { ...data, ...jwtClaims };

      setToken(data.token);
      setUser(merged);

      return data;
    } catch (e) {
      console.error('Failed to refresh token:', e);
    }
  };

  // Account level helpers
  const getAccountLevel = () => user?.accountLevel || 1;
  const isVerified = () => (user?.accountLevel || 1) >= 2;

  // Update the user's photo URL in state and localStorage so nav reflects immediately
  const updatePhoto = (userId) => {
    const photoUrl = `/api/users/${userId}/photo?t=${Date.now()}`;
    const updated = { ...user, photoUrl };
    setUser(updated);
    localStorage.setItem('user', JSON.stringify(updated));
  };

  const value = {
    user,
    token,
    isAuthenticated,
    loading,
    login,
    register,
    logout,
    isAdmin,
    refreshUser,
    refreshToken,
    getAccountLevel,
    isVerified,
    updatePhoto,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

export default AuthContext;
