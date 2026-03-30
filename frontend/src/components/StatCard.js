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
      <div style={{ color: colors.textMuted, fontSize: '12px', marginBottom: '4px' }}>{label}</div>
      <div style={{ color: valueColor, fontSize: valueSize, fontWeight: 'bold' }}>{value}</div>
      {children}
    </div>
  );
}
