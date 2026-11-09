import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { ToastContainer, toast } from 'react-toastify';
import {
  LayoutDashboard, PieChart, Trophy, History, UserRound, ShieldAlert, LogOut, ChevronDown, Menu, X, Wallet, Globe,
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DebugProvider } from './context/DebugContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { MarketDataProvider, useMarketData } from './context/MarketDataContext';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import PortfolioPage from './pages/PortfolioPage';
import HistoryPage from './pages/HistoryPage';
import AccountPage from './pages/AccountPage';
import AdminPage from './pages/AdminPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import SymbolDetailPage from './pages/SymbolDetailPage';
import LeaderboardPage from './pages/LeaderboardPage';
import FxPage from './pages/FxPage';
import { connectWebSocket, disconnectWebSocket } from './services/websocketService';
import VerificationBadge from './components/VerificationBadge';
import BrandMark from './components/BrandMark';
import OrderUpdateToaster from './components/trade/OrderUpdateToaster';
import { Avatar, ChangeChip, ConnectionPill, PriceText, ThemeToggle } from './components/ui';
import { colors, num } from './styles/shared';
import { fmtBalance } from './utils/format';

const APP_VERSION = process.env.REACT_APP_VERSION || '1.0.0';

/* ── Primary nav link with active state ─────────────────── */
function NavItem({ to, label, icon: Icon, match = [], onNavigate }) {
  const { pathname } = useLocation();
  const active = pathname === to || match.some(m => pathname.startsWith(m));
  return (
    <Link
      to={to}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className="vt-btn"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '7px',
        height: '34px', padding: '0 12px', borderRadius: '8px',
        fontSize: '13px', fontWeight: active ? 600 : 500, textDecoration: 'none',
        color: active ? colors.textPrimary : colors.textSecondary,
        background: active ? colors.bgRaised : 'transparent',
      }}
    >
      <Icon size={16} aria-hidden="true" style={{ color: active ? 'var(--vt-accent)' : 'currentColor' }} />
      {label}
    </Link>
  );
}

/* ── Live ticker strip ─────────────────────────────────── */
function TickerStrip() {
  const { list } = useMarketData();
  return (
    <div className="vt-ticker" aria-label="Market prices">
      <div style={{ display: 'flex', gap: '20px', overflowX: 'auto', scrollbarWidth: 'none', padding: '0 12px' }}>
        {list.map(q => (
          <Link key={q.symbol} to={`/symbol/${encodeURIComponent(q.symbol)}`} className="vt-link-row"
            style={{ display: 'inline-flex', alignItems: 'baseline', gap: '6px', whiteSpace: 'nowrap', fontSize: '12px' }}>
            <span style={{ fontWeight: 600, color: colors.textSecondary }}>{q.symbol}</span>
            <PriceText value={q.currentPrice} dir={q.dir} tick={q.tick} style={{ color: colors.textPrimary, fontSize: '12px' }} />
            <ChangeChip value={q.changePct} size="sm" />
          </Link>
        ))}
      </div>
    </div>
  );
}

/* ── Avatar menu ─────────────────────────────────────────── */
function MenuItem({ icon: Icon, label, onClick, tone }) {
  return (
    <button type="button" onClick={onClick} className="vt-btn vt-ghost"
      style={{
        display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left',
        height: '36px', padding: '0 14px', border: 'none', background: 'transparent', fontSize: '13px', fontWeight: 500,
        color: tone === 'danger' ? colors.red : colors.textSecondary,
      }}>
      <Icon size={16} aria-hidden="true" />
      {label}
    </button>
  );
}

function UserMenu() {
  const { user, logout, isAdmin, isDeveloper, getAccountLevel } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const verified = getAccountLevel() >= 2;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const go = (path) => { setOpen(false); navigate(path); };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-controls="user-menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="vt-btn"
        style={{
          display: 'flex', alignItems: 'center', gap: '8px', height: '36px', padding: '0 10px 0 4px',
          borderRadius: '999px', border: `1px solid ${open ? colors.borderMedium : colors.borderDefault}`,
          background: open ? colors.bgRaised : 'transparent', color: colors.textPrimary,
        }}
      >
        <Avatar name={user?.username} src={user?.photoUrl} size={28} ring={verified ? 'var(--vt-up)' : undefined} />
        <span className="vt-hide-sm" style={{ fontSize: '13px', fontWeight: 500, maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {user?.username}
        </span>
        {isDeveloper() && (
          <span className="vt-hide-sm" style={{ padding: '1px 6px', borderRadius: '999px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', background: colors.purpleDark, color: colors.purple }}>DEBUG</span>
        )}
        <ChevronDown size={14} aria-hidden="true" style={{ color: colors.textMuted, transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {open && (
        <div id="user-menu" className="vt-pop" style={{
          position: 'absolute', right: 0, top: 'calc(100% + 8px)', minWidth: '232px', zIndex: 1000,
          background: colors.bgCard, border: `1px solid ${colors.borderDefault}`, borderRadius: '12px',
          boxShadow: 'var(--vt-shadow-3)', overflow: 'hidden',
        }}>
          <div style={{ padding: '14px', borderBottom: `1px solid ${colors.borderDefault}`, display: 'flex', gap: '10px', alignItems: 'center' }}>
            <Avatar name={user?.username} src={user?.photoUrl} size={36} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>@{user?.username}</span>
              </div>
              <div style={{ color: colors.textMuted, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email}</div>
              <div style={{ marginTop: '6px' }}><VerificationBadge level={getAccountLevel()} size="small" /></div>
            </div>
          </div>
          <div style={{ padding: '6px 0' }}>
            <MenuItem icon={History} label="History" onClick={() => go('/history')} />
            <MenuItem icon={UserRound} label="Account" onClick={() => go('/account')} />
            {(isAdmin() || isDeveloper()) && <MenuItem icon={ShieldAlert} label="Admin" tone="danger" onClick={() => go('/admin')} />}
          </div>
          <div style={{ padding: '6px 0', borderTop: `1px solid ${colors.borderDefault}` }}>
            <MenuItem icon={LogOut} label="Logout" onClick={() => { setOpen(false); logout(); }} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Top bar ─────────────────────────────────────────────── */
function TopBar() {
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setMobileOpen(false), [pathname]);

  const links = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, match: ['/symbol/'] },
    { to: '/fx', label: 'FX', icon: Globe },
    { to: '/portfolio', label: 'Portfolio', icon: PieChart },
    { to: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  ];

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 900,
      background: 'color-mix(in srgb, var(--vt-bg-elev) 88%, transparent)',
      backdropFilter: 'saturate(140%) blur(12px)', WebkitBackdropFilter: 'saturate(140%) blur(12px)',
      borderBottom: `1px solid ${colors.borderDefault}`,
    }}>
      <div className="vt-topbar">
        <button type="button" className="vt-nav-burger vt-btn vt-ghost" aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen} onClick={() => setMobileOpen(o => !o)}
          style={{ width: '34px', height: '34px', alignItems: 'center', justifyContent: 'center', border: `1px solid ${colors.borderDefault}`, borderRadius: '8px', background: 'transparent', color: colors.textSecondary }}>
          {mobileOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
        </button>

        <Link to="/dashboard" aria-label="VulnTrade home" className="vt-link-row" style={{ display: 'inline-flex', alignItems: 'center', gap: '9px', flexShrink: 0 }}>
          <BrandMark />
          <span className="vt-hide-sm" style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '-0.02em', color: colors.textPrimary }}>VulnTrade</span>
        </Link>

        <nav className="vt-nav-desktop" aria-label="Primary">
          {links.map(l => <NavItem key={l.to} {...l} />)}
        </nav>

        <TickerStrip />

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto', flexShrink: 0 }}>
          <ConnectionPill compact />
          <span className="vt-hide-sm" title="Cash balance" style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px', height: '34px', padding: '0 10px',
            borderRadius: '8px', border: `1px solid ${colors.borderDefault}`, fontSize: '13px',
          }}>
            <Wallet size={14} aria-hidden="true" style={{ color: colors.textMuted }} />
            <span style={{ ...num, fontWeight: 600 }}>{fmtBalance(user?.balance)}</span>
          </span>
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>

      {mobileOpen && (
        <nav aria-label="Primary" className="vt-pop" style={{ display: 'grid', gap: '4px', padding: '8px 12px 12px', borderTop: `1px solid ${colors.borderDefault}` }}>
          {links.map(l => <NavItem key={l.to} {...l} onNavigate={() => setMobileOpen(false)} />)}
        </nav>
      )}
    </header>
  );
}

function Footer() {
  return (
    <footer style={{ borderTop: `1px solid ${colors.borderDefault}`, padding: '16px 24px', color: colors.textMuted, fontSize: '12px', display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
      <span>VulnTrade <span style={num}>v{APP_VERSION}</span> · simulated markets, no real money</span>
      <span>Training lab — intentionally vulnerable. Do not expose to the internet.</span>
    </footer>
  );
}

/* ── Routes ─────────────────────────────────────────────── */
function AppContent() {
  const { isAuthenticated } = useAuth();
  const { theme } = useTheme();

  // The platform WebSocket for the whole session (it re-subscribes by itself after reconnects).
  // The product sockets (equities, crypto, fx) open on first use; logout closes them all.
  useEffect(() => {
    if (isAuthenticated) {
      connectWebSocket(() => console.log('[App] WebSocket connected'), (err) => console.error('[App] WebSocket error:', err));
    } else {
      disconnectWebSocket();
    }
  }, [isAuthenticated]);
  useEffect(() => () => disconnectWebSocket(), []);

  const onNotice = useCallback((e) => toast.info(e.detail), []);
  useEffect(() => {
    window.addEventListener('vt:notice', onNotice);
    return () => window.removeEventListener('vt:notice', onNotice);
  }, [onNotice]);

  const guard = (el) => (isAuthenticated ? el : <Navigate to="/login" />);

  return (
    <MarketDataProvider enabled={isAuthenticated}>
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: colors.bgPage, color: colors.textPrimary }}>
        {isAuthenticated && <TopBar />}
        {isAuthenticated && <OrderUpdateToaster />}
        <div style={{ flex: 1 }}>
          <Routes>
            <Route path="/login" element={isAuthenticated ? <Navigate to="/dashboard" /> : <LoginPage />} />
            <Route path="/register" element={isAuthenticated ? <Navigate to="/dashboard" /> : <RegisterPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/dashboard" element={guard(<DashboardPage />)} />
            <Route path="/portfolio" element={guard(<PortfolioPage />)} />
            <Route path="/leaderboard" element={guard(<LeaderboardPage />)} />
            <Route path="/fx" element={guard(<FxPage />)} />
            <Route path="/history" element={guard(<HistoryPage />)} />
            <Route path="/account" element={guard(<AccountPage />)} />
            {/* VULN: Admin route only protected client-side */}
            <Route path="/admin" element={guard(<AdminPage />)} />
            <Route path="/symbol/:symbol" element={guard(<SymbolDetailPage />)} />
            <Route path="*" element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} />} />
          </Routes>
        </div>
        {isAuthenticated && <Footer />}
        <ToastContainer theme={theme} position="bottom-right" newestOnTop limit={5} autoClose={3500} />
      </div>
    </MarketDataProvider>
  );
}

function App() {
  return (
    <ThemeProvider>
      <Router>
        <AuthProvider>
          <DebugProvider>
            <AppContent />
          </DebugProvider>
        </AuthProvider>
      </Router>
    </ThemeProvider>
  );
}

export default App;
