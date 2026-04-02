import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
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
import { DebugProvider } from './context/DebugContext';
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

/* ── Dropdown menu item ─────────────────────────── */
function DropdownItem({ label, onClick, danger = false, muted = false }) {
  const [hovered, setHovered] = useState(false);
  const color = danger ? '#FF3D71' : muted ? '#5E6B82' : '#C5CEE0';
  const hoverBg = danger ? 'rgba(255,61,113,0.08)' : 'rgba(79,139,255,0.06)';

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '9px 16px',
        fontSize: '13px', fontWeight: danger ? '600' : '500',
        color,
        background: hovered ? hoverBg : 'transparent',
        border: 'none', cursor: 'pointer',
        transition: 'background 0.12s ease',
      }}
    >
      {label}
    </button>
  );
}

function AppContent() {
  const { isAuthenticated, user, logout, isAdmin, isDeveloper, getAccountLevel } = useAuth();
  const verified = getAccountLevel() >= 2;
  const wsConnectedRef = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const navigate = useNavigate();

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

  // Close dropdown on click outside or Escape
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    const handleKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('mousedown', handleClick); document.removeEventListener('keydown', handleKey); };
  }, [menuOpen]);

  const goTo = useCallback((path) => { navigate(path); setMenuOpen(false); }, [navigate]);

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
          {/* Left: Logo + primary Nav Links */}
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
          </div>

          {/* Right: Avatar dropdown */}
          <div ref={menuRef} style={{ position: 'relative' }}>
            <div
              onClick={() => setMenuOpen(o => !o)}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '4px 12px 4px 4px',
                borderRadius: '24px',
                backgroundColor: menuOpen ? 'rgba(30,45,69,0.9)' : 'rgba(30,45,69,0.6)',
                border: `1px solid ${menuOpen ? '#2A4060' : '#1E2D45'}`,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                userSelect: 'none',
              }}
            >
              <div style={{ position: 'relative' }}>
                <div style={{
                  width: '28px', height: '28px', borderRadius: '50%',
                  background: 'linear-gradient(135deg, #4F8BFF, #8B5CF6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '12px', fontWeight: '700', color: '#fff',
                  border: verified ? `2px solid ${colors.green}` : '2px solid transparent',
                  flexShrink: 0,
                }}>
                  {user?.username?.charAt(0)?.toUpperCase() || '?'}
                </div>
                {user?.photoUrl && (
                  <img
                    key={user.photoUrl}
                    src={user.photoUrl}
                    alt=""
                    onError={(e) => { e.target.style.display = 'none'; }}
                    style={{
                      position: 'absolute', inset: 0,
                      width: '28px', height: '28px', borderRadius: '50%',
                      objectFit: 'cover', display: 'block',
                      border: verified ? `2px solid ${colors.green}` : '2px solid transparent',
                    }}
                  />
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
              {isDeveloper() && (
                <span style={{
                  padding: '2px 8px', borderRadius: '12px', fontSize: '10px', fontWeight: '700',
                  backgroundColor: 'rgba(139,92,246,0.15)', color: '#A78BFA',
                  border: '1px solid rgba(139,92,246,0.3)', letterSpacing: '0.06em',
                }}>DEBUG</span>
              )}
              <span style={{
                color: '#5E6B82', fontSize: '10px', marginLeft: '2px',
                transition: 'transform 0.2s ease',
                transform: menuOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              }}>&#9662;</span>
            </div>

            {/* Dropdown menu */}
            {menuOpen && (
              <div style={{
                position: 'absolute', right: 0, top: 'calc(100% + 8px)',
                minWidth: '200px',
                backgroundColor: '#0E1A2E',
                border: '1px solid #1E2D45',
                borderRadius: '12px',
                boxShadow: '0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(30,45,69,0.5)',
                overflow: 'hidden',
                zIndex: 1000,
              }}>
                {/* User info header */}
                <div style={{
                  padding: '14px 16px 12px',
                  borderBottom: '1px solid #1E2D45',
                }}>
                  <div style={{ color: '#FFFFFF', fontSize: '14px', fontWeight: '600' }}>{user?.username}</div>
                  <div style={{ color: '#5E6B82', fontSize: '12px', marginTop: '2px' }}>{user?.email}</div>
                </div>

                {/* Nav links */}
                <div style={{ padding: '6px 0' }}>
                  {[
                    { label: 'History', path: '/history' },
                    { label: 'Account', path: '/account' },
                    ...((isAdmin() || isDeveloper()) ? [{ label: 'Admin', path: '/admin', danger: true }] : []),
                  ].map(({ label, path, danger }) => (
                    <DropdownItem key={path} label={label} danger={danger} onClick={() => goTo(path)} />
                  ))}
                </div>

                {/* Divider + Logout */}
                <div style={{ borderTop: '1px solid #1E2D45', padding: '6px 0' }}>
                  <DropdownItem label="Logout" onClick={() => { setMenuOpen(false); logout(); }} muted />
                </div>
              </div>
            )}
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
        <DebugProvider>
          <AppContent />
        </DebugProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
