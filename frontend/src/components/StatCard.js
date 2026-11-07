import React from 'react';
import { colors, statCard, type, num } from '../styles/shared';

/**
 * KPI tile: small caps label, large tabular value, optional sub-line (e.g. change).
 */
export default function StatCard({
  label, value, sub, icon, valueColor = colors.textPrimary, valueSize = '22px',
  children, style = {}, mono = true, accent,
}) {
  return (
    <div style={{ ...statCard, position: 'relative', overflow: 'hidden', ...style }}>
      {accent && <span aria-hidden="true" style={{ position: 'absolute', inset: '0 auto 0 0', width: '3px', background: accent }} />}
      <div style={{ ...type.caps, display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
        {icon}
        {label}
      </div>
      <div style={{ color: valueColor, fontSize: valueSize, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.2, ...(mono ? num : {}), wordBreak: 'break-word' }}>
        {value}
      </div>
      {sub && <div style={{ marginTop: '6px', fontSize: '12px', color: colors.textMuted }}>{sub}</div>}
      {children}
    </div>
  );
}
