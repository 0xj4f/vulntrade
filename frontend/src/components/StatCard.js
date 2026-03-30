import React from 'react';
import { statCard, colors } from '../styles/shared';

/**
 * Small stat display card (label + value).
 * @param {string} label - small label text
 * @param {string|number} value - main display value
 * @param {string} valueColor - value text color
 * @param {string} valueSize - font size for value
 */
export default function StatCard({ label, value, valueColor = colors.textPrimary, valueSize = '24px', children, style = {} }) {
  return (
    <div style={{ ...statCard, ...style }}>
      <div style={{
        color: colors.textMuted,
        fontSize: '11px',
        marginBottom: '8px',
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}>{label}</div>
      <div style={{
        color: valueColor,
        fontSize: valueSize,
        fontWeight: '700',
        letterSpacing: '-0.02em',
        lineHeight: '1.2',
      }}>{value}</div>
      {children}
    </div>
  );
}
