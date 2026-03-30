import React from 'react';
import { colors } from '../styles/shared';

/**
 * Colored status badge (pill shape).
 * @param {string} status - e.g. 'FILLED', 'CANCELLED', 'PARTIAL', 'OPEN'
 * @param {object} colorMap - optional { STATUS: color } overrides
 */
export default function StatusBadge({ status, colorMap = {} }) {
  const defaultColors = {
    FILLED: colors.green,
    CANCELLED: colors.textMuted,
    PARTIAL: colors.amber,
    OPEN: colors.blue,
    PENDING: colors.blue,
  };

  const color = colorMap[status] || defaultColors[status] || colors.blue;

  return (
    <span style={{
      color,
      fontWeight: '600',
      padding: '3px 10px',
      borderRadius: '20px',
      background: color + '18',
      fontSize: '11px',
      letterSpacing: '0.03em',
      display: 'inline-block',
      lineHeight: '1.5',
    }}>
      {status}
    </span>
  );
}
