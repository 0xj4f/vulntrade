import React, { useRef } from 'react';
import { Moon, Sun, Wifi, WifiOff, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { colors, num, type } from '../styles/shared';
import { useTheme } from '../context/ThemeContext';
import { useConnectionStatus } from '../hooks/useStomp';
import { fmtPct, fmtPrice } from '../utils/format';

/** Small rounded label. tone: neutral | up | down | accent | warn | violet */
export function Chip({ tone = 'neutral', children, style = {}, title }) {
  const tones = {
    neutral: [colors.bgRaised, colors.textSecondary],
    up: [colors.greenDark, colors.greenLight],
    down: [colors.redDark, colors.redLight],
    accent: [colors.blueDark, colors.blueLight],
    warn: [colors.amberDark, colors.amber],
    violet: [colors.purpleDark, colors.purple],
  };
  const [bg, fg] = tones[tone] || tones.neutral;
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '999px',
      fontSize: '11px', fontWeight: 600, background: bg, color: fg, whiteSpace: 'nowrap', ...style,
    }}>{children}</span>
  );
}

/** Price that flashes green/red when it ticks up/down. */
export function PriceText({ value, symbol, dir, tick, style = {}, prefix = '$', format }) {
  const text = format ? format(value) : fmtPrice(value, symbol);
  return (
    <span key={tick} className={dir === 'up' ? 'flash-up' : dir === 'down' ? 'flash-down' : undefined}
      style={{ ...num, padding: '0 2px', margin: '0 -2px', ...style }}>
      {prefix === '$' ? text : text.replace(/^\$/, '')}
    </span>
  );
}

/** "+1.23%" chip with an arrow; colour and icon both carry the direction. */
export function ChangeChip({ value, size = 'md', solid = false }) {
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) return <span style={{ color: colors.textMuted }}>—</span>;
  const up = n > 0.00005, down = n < -0.00005;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  const fg = up ? colors.green : down ? colors.red : colors.textMuted;
  const bg = up ? colors.greenDark : down ? colors.redDark : colors.bgRaised;
  return (
    <span style={{
      ...num, display: 'inline-flex', alignItems: 'center', gap: '2px',
      fontSize: size === 'sm' ? '11.5px' : '12.5px', fontWeight: 600, color: fg,
      background: solid ? bg : 'transparent', padding: solid ? '2px 6px' : 0, borderRadius: '6px',
    }}>
      <Icon size={size === 'sm' ? 12 : 14} aria-hidden="true" />
      {fmtPct(n)}
    </span>
  );
}

/** Segmented control (radio group semantics). options: [{ value, label, tone }] */
export function Segmented({ value, onChange, options, ariaLabel, size = 'md', fullWidth = false }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} style={{
      display: fullWidth ? 'grid' : 'inline-grid', gridTemplateColumns: `repeat(${options.length}, 1fr)`,
      gap: '2px', padding: '2px', borderRadius: '8px', background: colors.bgInput, border: `1px solid ${colors.borderDefault}`,
    }}>
      {options.map(opt => {
        const active = opt.value === value;
        const activeBg = opt.tone === 'up' ? colors.upFill : opt.tone === 'down' ? colors.downFill : colors.bgRaised;
        const activeFg = opt.tone === 'up' ? colors.onUp : opt.tone === 'down' ? colors.onDown : colors.textPrimary;
        return (
          <button key={opt.value} type="button" role="radio" aria-checked={active}
            onClick={() => onChange(opt.value)} className="vt-btn"
            style={{
              height: size === 'sm' ? '26px' : '32px', padding: '0 12px', border: 'none', borderRadius: '6px',
              fontSize: size === 'sm' ? '12px' : '13px', fontWeight: 600, letterSpacing: '0.02em',
              background: active ? activeBg : 'transparent', color: active ? activeFg : colors.textMuted,
              boxShadow: active && !opt.tone ? 'var(--vt-shadow-1)' : 'none',
            }}>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Underlined tabs (tablist semantics). tabs: [{ value, label, count }] */
export function Tabs({ value, onChange, tabs, ariaLabel }) {
  return (
    <div role="tablist" aria-label={ariaLabel} style={{ display: 'flex', gap: '4px', borderBottom: `1px solid ${colors.borderDefault}`, padding: '0 8px' }}>
      {tabs.map(t => {
        const active = t.value === value;
        return (
          <button key={t.value} role="tab" type="button" aria-selected={active} onClick={() => onChange(t.value)}
            className="vt-btn"
            style={{
              height: '40px', padding: '0 10px', border: 'none', background: 'transparent',
              color: active ? colors.textPrimary : colors.textMuted, fontWeight: active ? 600 : 500, fontSize: '13px',
              boxShadow: active ? `inset 0 -2px 0 ${colors.accentFill}` : 'none', display: 'inline-flex', alignItems: 'center', gap: '6px',
            }}>
            {t.label}
            {t.count != null && (
              <span style={{ ...num, fontSize: '11px', padding: '0 6px', borderRadius: '999px', background: colors.bgRaised, color: colors.textSecondary }}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Connection state pill. Shows "LIVE" while the socket is up. */
export function ConnectionPill({ compact = false }) {
  const status = useConnectionStatus();
  const live = status === 'live';
  const label = live ? 'LIVE' : status === 'reconnecting' ? 'RECONNECTING' : status === 'connecting' ? 'CONNECTING' : 'OFFLINE';
  const Icon = live ? Wifi : WifiOff;
  return (
    <span role="status" aria-live="polite" style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px', height: '26px', padding: '0 10px', borderRadius: '999px',
      fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em',
      background: live ? colors.greenDark : status === 'offline' ? colors.redDark : colors.amberDark,
      color: live ? colors.greenLight : status === 'offline' ? colors.redLight : colors.amber,
      border: `1px solid ${live ? colors.borderUp : status === 'offline' ? colors.borderDanger : colors.borderWarning}`,
    }}>
      {live
        ? <span className="live-dot" aria-hidden="true" style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--vt-up)' }} />
        : <Icon size={12} aria-hidden="true" />}
      {compact && !live ? null : label}
    </span>
  );
}

/** Sun/moon theme switch. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const Icon = theme === 'dark' ? Sun : Moon;
  return (
    <button type="button" onClick={toggle} className="vt-btn vt-ghost"
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
      style={{ width: '34px', height: '34px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', border: `1px solid ${colors.borderDefault}`, background: 'transparent', color: colors.textSecondary }}>
      <Icon size={16} aria-hidden="true" />
    </button>
  );
}

const AVATAR_TONES = ['#3b82f6', '#8b5cf6', '#16c784', '#f5a524', '#ea3943', '#06b6d4', '#ec4899'];

/** Round avatar: photo when available, otherwise initials on a stable colour. */
export function Avatar({ name = '?', src, size = 32, ring }) {
  const seed = Array.from(name || '?').reduce((a, c) => a + c.charCodeAt(0), 0);
  const bg = AVATAR_TONES[seed % AVATAR_TONES.length];
  const imgRef = useRef(null);
  return (
    <span style={{
      position: 'relative', width: size, height: size, borderRadius: '50%', flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: `linear-gradient(135deg, ${bg}, ${bg}cc)`, color: '#fff', fontWeight: 700,
      fontSize: Math.max(10, Math.round(size * 0.4)), boxShadow: ring ? `0 0 0 2px ${colors.bgCard}, 0 0 0 4px ${ring}` : 'none',
    }}>
      {(name || '?').replace(/^@/, '').charAt(0).toUpperCase()}
      {src && (
        <img ref={imgRef} src={src} alt="" onError={() => { if (imgRef.current) imgRef.current.style.display = 'none'; }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
      )}
    </span>
  );
}

/** Centered empty-state message with an optional action. */
export function EmptyState({ icon, title, children, action }) {
  return (
    <div style={{ textAlign: 'center', padding: '32px 16px', color: colors.textMuted }}>
      {icon && <div style={{ display: 'inline-flex', marginBottom: '10px', color: colors.textDim }}>{icon}</div>}
      {title && <div style={{ ...type.section, fontSize: '14px', color: colors.textSecondary, marginBottom: '4px' }}>{title}</div>}
      {children && <div style={{ fontSize: '13px', lineHeight: 1.6 }}>{children}</div>}
      {action && <div style={{ marginTop: '14px' }}>{action}</div>}
    </div>
  );
}

/** Label/value line for compact key-value lists. */
export function KV({ label, value, mono = true, valueColor }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', padding: '4px 0', fontSize: '12.5px' }}>
      <span style={{ color: colors.textMuted }}>{label}</span>
      <span style={{ ...(mono ? num : {}), color: valueColor || colors.textPrimary, textAlign: 'right' }}>{value}</span>
    </div>
  );
}
