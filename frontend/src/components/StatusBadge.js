import React from 'react';
import { colors } from '../styles/shared';

/**
 * Colored status badge.
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
      fontWeight: 'bold',
      padding: '2px 8px',
      borderRadius: '4px',
      background: color + '20',
      fontSize: '11px',
    }}>
      {status}
    </span>
  );
}
