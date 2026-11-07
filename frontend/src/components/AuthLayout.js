import React, { useEffect, useState } from 'react';
import { BarChart3, BookOpen, Trophy } from 'lucide-react';
import api from '../services/apiService';
import BrandMark from './BrandMark';
import { ChangeChip, ThemeToggle } from './ui';
import { colors, errorBanner, num, successBanner, type } from '../styles/shared';
import { fmtPrice } from '../utils/format';

/** Live mini-ticker for the signed-out brand panel (public prices, polled). */
function MiniTicker() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let alive = true;
    const load = () => api.get('/api/market/prices').then(res => { if (alive) setRows((res.data || []).slice(0, 6)); }).catch(() => {});
    load();
    const iv = setInterval(load, 5000);
    return () => { alive = false; clearInterval(iv); };
  }, []);
  if (!rows.length) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', maxWidth: '460px' }}>
      {rows.map(r => (
        <div key={r.symbol} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: '10px', background: colors.bgCard, border: `1px solid ${colors.borderDefault}` }}>
          <span style={{ fontWeight: 600, fontSize: '13px' }}>{r.symbol}</span>
          <span style={{ display: 'grid', justifyItems: 'end' }}>
            <span style={{ ...num, fontSize: '13px' }}>{fmtPrice(r.currentPrice)}</span>
            <ChangeChip value={r.changePct} size="sm" />
          </span>
        </div>
      ))}
    </div>
  );
}

const FEATURES = [
  { icon: BarChart3, title: 'Live markets', text: 'Stocks and crypto ticking every second, with real candles.' },
  { icon: BookOpen, title: 'Real order book', text: 'Limit and market orders, partial fills, a house market maker.' },
  { icon: Trophy, title: 'Leaderboard', text: 'Out-trade the famous names and climb to #1.' },
];

/**
 * Signed-out layout: brand panel with a live mini-ticker on the left, the form on the right
 * (the brand panel is hidden on narrow screens).
 */
export default function AuthLayout({ title, subtitle, error, success, width = '400px', children }) {
  return (
    <div className="vt-auth">
      <aside className="vt-auth-brand" style={{
        position: 'relative', overflow: 'hidden', padding: '48px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        background: 'radial-gradient(1200px 600px at -10% -20%, var(--vt-accent-soft), transparent 60%), radial-gradient(900px 500px at 110% 120%, var(--vt-up-soft), transparent 60%), var(--vt-bg-elev)',
        borderRight: `1px solid ${colors.borderDefault}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <BrandMark size={32} />
          <span style={{ fontSize: '17px', fontWeight: 700, letterSpacing: '-0.02em' }}>VulnTrade</span>
        </div>
        <div>
          <h1 style={{ ...type.display, fontSize: '40px', lineHeight: 1.1, maxWidth: '520px', marginBottom: '14px' }}>
            Markets that never close.
          </h1>
          <p style={{ color: colors.textSecondary, fontSize: '15px', maxWidth: '460px', marginBottom: '28px', lineHeight: 1.6 }}>
            Trade 15 simulated markets in real time, track every fill, and see where you stand against the best.
          </p>
          <MiniTicker />
          <ul style={{ listStyle: 'none', display: 'grid', gap: '14px', marginTop: '32px', maxWidth: '460px' }}>
            {FEATURES.map(({ icon: Icon, title: t, text }) => (
              <li key={t} style={{ display: 'flex', gap: '12px' }}>
                <span style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: colors.blueDark, color: colors.blue }}>
                  <Icon size={16} aria-hidden="true" />
                </span>
                <span><span style={{ fontWeight: 600, fontSize: '13.5px' }}>{t}</span><br /><span style={{ color: colors.textMuted, fontSize: '13px' }}>{text}</span></span>
              </li>
            ))}
          </ul>
        </div>
        <p style={{ color: colors.textMuted, fontSize: '12px' }}>Simulated markets · no real money · training lab</p>
      </aside>

      <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 16px', position: 'relative' }}>
        <div style={{ position: 'absolute', top: '16px', right: '16px' }}><ThemeToggle /></div>
        <div className="fade-in" style={{ width: '100%', maxWidth: width }}>
          <div style={{ marginBottom: '24px' }}>
            <div className="vt-hide-lg" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
              <BrandMark size={30} />
              <span style={{ fontSize: '16px', fontWeight: 700 }}>VulnTrade</span>
            </div>
            <h2 style={{ ...type.title, fontSize: '24px' }}>{title}</h2>
            {subtitle && <p style={{ color: colors.textMuted, fontSize: '14px', marginTop: '4px' }}>{subtitle}</p>}
          </div>
          {error && <div role="alert" style={errorBanner}>{error}</div>}
          {success && <div role="status" style={successBanner}>{success}</div>}
          {children}
        </div>
      </main>
    </div>
  );
}
