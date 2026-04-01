import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import PortfolioPage from './pages/PortfolioPage';
import HistoryPage from './pages/HistoryPage';
import AccountPage from './pages/AccountPage';
import AdminPage from './pages/AdminPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import SymbolDetailPage from './pages/SymbolDetailPage';
import { connectWebSocket, disconnectWebSocket, isConnected } from './services/websocketService';
import VerificationBadge from './components/VerificationBadge';
import { colors } from './styles/shared';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

/* ── Nav link with active state ─────────────────────────── */
function NavItem({ to, label, danger = false }) {
  const location = useLocation();
  const isActive = location.pathname === to;
  const baseColor = danger ? '#FF3D71' : '#8F9BB3';
  const activeColor = danger ? '#FF3D71' : '#FFFFFF';

  return (
    <Link
      to={to}
      style={{
        color: isActive ? activeColor : baseColor,
        textDecoration: 'none',
        padding: '7px 16px',
        borderRadius: '8px',
        fontSize: '13px',
        fontWeight: isActive ? '600' : '500',
        transition: 'all 0.15s ease',
        backgroundColor: isActive
          ? (danger ? 'rgba(255,61,113,0.12)' : 'rgba(79,139,255,0.10)')
          : 'transparent',
        letterSpacing: '0.01em',
      }}
    >
      {label}
    </Link>
  );
}

function AppContent() {
  const { isAuthenticated, user, logout, isAdmin, getAccountLevel } = useAuth();
  const verified = getAccountLevel() >= 2;
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
          padding: '0 28px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid #1E2D45',
          height: '56px',
          position: 'sticky',
          top: 0,
          zIndex: 900,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}>
          {/* Left: Logo + Nav Links */}
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <Link to="/dashboard" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '8px', marginRight: '16px' }}>
              <div style={{
                width: '30px', height: '30px', borderRadius: '8px',
                background: 'linear-gradient(135deg, #00D68F, #00B87A)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '15px',
                boxShadow: '0 2px 8px rgba(0,214,143,0.25)',
              }}>⚡</div>
              <span style={{ fontSize: '16px', fontWeight: '700', color: '#FFFFFF', letterSpacing: '-0.02em' }}>
                VulnTrade
              </span>
            </Link>

            <NavItem to="/dashboard" label="Dashboard" />
            <NavItem to="/portfolio" label="Portfolio" />
            <NavItem to="/history" label="History" />
            <NavItem to="/account" label="Account" />
            {/* VULN: Admin link only hidden by client-side check */}
            {isAdmin() && <NavItem to="/admin" label="Admin" danger />}
          </div>

          {/* Right: User info + Logout */}
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '4px 12px 4px 4px',
              borderRadius: '24px',
              backgroundColor: 'rgba(30,45,69,0.6)',
              border: '1px solid #1E2D45',
            }}>
              <div style={{ position: 'relative' }}>
                {user?.photoUrl ? (
                  <img
                    src={user.photoUrl}
                    alt={user.username}
                    style={{
                      width: '28px', height: '28px', borderRadius: '50%',
                      objectFit: 'cover', display: 'block',
                      border: verified ? `2px solid ${colors.green}` : '2px solid transparent',
                    }}
                  />
                ) : (
                  <div style={{
                    width: '28px', height: '28px', borderRadius: '50%',
                    background: 'linear-gradient(135deg, #4F8BFF, #8B5CF6)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '12px', fontWeight: '700', color: '#fff',
                    border: verified ? `2px solid ${colors.green}` : '2px solid transparent',
                  }}>
                    {user?.username?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                )}
                {verified && (
                  <div style={{
                    position: 'absolute', bottom: '-2px', right: '-2px',
                    width: '12px', height: '12px', borderRadius: '50%',
                    backgroundColor: colors.green, display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    fontSize: '7px', color: '#fff', fontWeight: '700',
                    border: '1.5px solid #0E1A2E',
                  }}>&#10003;</div>
                )}
              </div>
              <span style={{ color: '#8F9BB3', fontSize: '13px', fontWeight: '500' }}>
                {user?.username}
              </span>
              <VerificationBadge level={getAccountLevel()} size="small" />
            </div>
            <button onClick={logout} style={{
              background: 'transparent', border: '1px solid #263A56', color: '#5E6B82',
              padding: '6px 14px', borderRadius: '8px', cursor: 'pointer',
              fontSize: '12px', fontWeight: '500', transition: 'all 0.15s ease',
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
        <Route path="/symbol/:symbol" element={
          isAuthenticated ? <SymbolDetailPage /> : <Navigate to="/login" />
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
