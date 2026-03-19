import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import AdminPage from './pages/AdminPage';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

function App() {
  // VULN: Auth state managed client-side, role from localStorage
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    // VULN: JWT stored in localStorage
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');
    if (token && userData) {
      setIsAuthenticated(true);
      setUser(JSON.parse(userData));
    }
  }, []);

  const handleLogin = (token, userData) => {
    // VULN: Storing sensitive data in localStorage
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    setIsAuthenticated(true);
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setIsAuthenticated(false);
    setUser(null);
  };

  return (
    <Router>
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
              {/* VULN: Admin link only hidden by client-side check */}
              {user?.role === 'ADMIN' && (
                <Link to="/admin" style={{ color: '#ef4444', textDecoration: 'none' }}>
                  Admin
                </Link>
              )}
            </div>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <span style={{ color: '#6b7280', fontSize: '14px' }}>
                {user?.username} ({user?.role})
              </span>
              <button onClick={handleLogout} style={{
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
            isAuthenticated ? <Navigate to="/dashboard" /> :
            <LoginPage onLogin={handleLogin} />
          } />
          <Route path="/dashboard" element={
            isAuthenticated ? <DashboardPage user={user} /> :
            <Navigate to="/login" />
          } />
          {/* VULN: Admin route only protected client-side */}
          <Route path="/admin" element={
            isAuthenticated ? <AdminPage user={user} /> :
            <Navigate to="/login" />
          } />
          <Route path="*" element={<Navigate to={isAuthenticated ? "/dashboard" : "/login"} />} />
        </Routes>

        <ToastContainer theme="dark" position="bottom-right" />
      </div>
    </Router>
  );
}

export default App;
