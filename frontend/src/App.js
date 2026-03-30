import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import PortfolioPage from './pages/PortfolioPage';
import HistoryPage from './pages/HistoryPage';
import AccountPage from './pages/AccountPage';
import AdminPage from './pages/AdminPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import { connectWebSocket, disconnectWebSocket, isConnected } from './services/websocketService';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

function AppContent() {
  const { isAuthenticated, user, logout, isAdmin } = useAuth();
  const wsConnectedRef = useRef(false);

  // Connect WebSocket at app level so it persists across page navigations
  useEffect(() => {
    if (isAuthenticated && !wsConnectedRef.current) {
      connectWebSocket(
        (frame) => {
          console.log('[App] WebSocket connected');
          wsConnectedRef.current = true;
        },
        (error) => {
          console.error('[App] WebSocket error:', error);
          wsConnectedRef.current = false;
        }
      );
    }
    if (!isAuthenticated && wsConnectedRef.current) {
      disconnectWebSocket();
      wsConnectedRef.current = false;
    }
    return () => {
      if (wsConnectedRef.current) {
        disconnectWebSocket();
        wsConnectedRef.current = false;
      }
    };
  }, [isAuthenticated]);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0B1426', color: '#FFFFFF' }}>
      {isAuthenticated && (
        <nav style={{
          backgroundColor: '#0E1A2E',
          padding: '0 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid #1E2D45',
          height: '56px',
        }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '18px', fontWeight: '700', color: '#00D68F', marginRight: '20px', letterSpacing: '-0.02em' }}>
              ⚡ VulnTrade
            </span>
            <Link to="/dashboard" style={{ color: '#8F9BB3', textDecoration: 'none', padding: '6px 14px', borderRadius: '8px', fontSize: '14px', fontWeight: '500', transition: 'all 0.15s ease' }}>
              Dashboard
            </Link>
            <Link to="/portfolio" style={{ color: '#8F9BB3', textDecoration: 'none', padding: '6px 14px', borderRadius: '8px', fontSize: '14px', fontWeight: '500', transition: 'all 0.15s ease' }}>
              Portfolio
            </Link>
            <Link to="/history" style={{ color: '#8F9BB3', textDecoration: 'none', padding: '6px 14px', borderRadius: '8px', fontSize: '14px', fontWeight: '500', transition: 'all 0.15s ease' }}>
              History
            </Link>
            <Link to="/account" style={{ color: '#8F9BB3', textDecoration: 'none', padding: '6px 14px', borderRadius: '8px', fontSize: '14px', fontWeight: '500', transition: 'all 0.15s ease' }}>
              Account
            </Link>
            {/* VULN: Admin link only hidden by client-side check */}
            {isAdmin() && (
              <Link to="/admin" style={{ color: '#FF3D71', textDecoration: 'none', padding: '6px 14px', borderRadius: '8px', fontSize: '14px', fontWeight: '500' }}>
                Admin
              </Link>
            )}
          </div>
          <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: '50%',
              background: 'linear-gradient(135deg, #4F8BFF, #8B5CF6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '13px', fontWeight: '700', color: '#fff',
            }}>
              {user?.username?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <span style={{ color: '#5E6B82', fontSize: '13px' }}>
              {user?.username}
            </span>
            <button onClick={logout} style={{
              background: '#1E2D45', border: '1px solid #263A56', color: '#8F9BB3',
              padding: '6px 14px', borderRadius: '8px', cursor: 'pointer',
              fontSize: '13px', fontWeight: '500',
            }}>
              Logout
            </button>
          </div>
        </nav>
      )}

      <Routes>
        <Route path="/login" element={
          isAuthenticated ? <Navigate to="/dashboard" /> : <LoginPage />
        } />
        <Route path="/register" element={
          isAuthenticated ? <Navigate to="/dashboard" /> : <RegisterPage />
        } />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/dashboard" element={
          isAuthenticated ? <DashboardPage /> : <Navigate to="/login" />
        } />
        <Route path="/portfolio" element={
          isAuthenticated ? <PortfolioPage /> : <Navigate to="/login" />
        } />
        <Route path="/history" element={
          isAuthenticated ? <HistoryPage /> : <Navigate to="/login" />
        } />
        <Route path="/account" element={
          isAuthenticated ? <AccountPage /> : <Navigate to="/login" />
        } />
        {/* VULN: Admin route only protected client-side */}
        <Route path="/admin" element={
          isAuthenticated ? <AdminPage /> : <Navigate to="/login" />
        } />
        <Route path="*" element={<Navigate to={isAuthenticated ? "/dashboard" : "/login"} />} />
      </Routes>

      <ToastContainer theme="dark" position="bottom-right" />
    </div>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </Router>
  );
}

export default App;
