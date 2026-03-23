import React, { useState, useEffect } from 'react';
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
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

function AppContent() {
  const { isAuthenticated, user, logout, isAdmin } = useAuth();

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0e17', color: '#e1e5ea' }}>
      {isAuthenticated && (
        <nav style={{
          backgroundColor: '#111827',
          padding: '12px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid #1f2937'
        }}>
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
            <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#10b981' }}>
              ⚡ VulnTrade
            </span>
            <Link to="/dashboard" style={{ color: '#9ca3af', textDecoration: 'none' }}>
              Dashboard
            </Link>
            <Link to="/portfolio" style={{ color: '#9ca3af', textDecoration: 'none' }}>
              Portfolio
            </Link>
            <Link to="/history" style={{ color: '#9ca3af', textDecoration: 'none' }}>
              History
            </Link>
            <Link to="/account" style={{ color: '#9ca3af', textDecoration: 'none' }}>
              Account
            </Link>
            {/* VULN: Admin link only hidden by client-side check */}
            {isAdmin() && (
              <Link to="/admin" style={{ color: '#ef4444', textDecoration: 'none' }}>
                Admin
              </Link>
            )}
          </div>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <span style={{ color: '#6b7280', fontSize: '14px' }}>
              {user?.username} ({user?.role})
            </span>
            <button onClick={logout} style={{
              background: '#374151', border: 'none', color: '#e5e7eb',
              padding: '6px 12px', borderRadius: '4px', cursor: 'pointer'
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
