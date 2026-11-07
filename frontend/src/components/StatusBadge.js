import React from 'react';
import { colors } from '../styles/shared';

const TONES = {
  FILLED:    { bg: colors.greenDark, fg: colors.greenLight, label: 'Filled' },
  PARTIAL:   { bg: colors.amberDark, fg: colors.amber, label: 'Partial' },
  NEW:       { bg: colors.blueDark, fg: colors.blueLight, label: 'Open' },
  OPEN:      { bg: colors.blueDark, fg: colors.blueLight, label: 'Open' },
  PENDING:   { bg: colors.blueDark, fg: colors.blueLight, label: 'Pending' },
  CANCELLED: { bg: colors.bgRaised, fg: colors.textMuted, label: 'Cancelled' },
  REJECTED:  { bg: colors.redDark, fg: colors.redLight, label: 'Rejected' },
};

const REASONS = {
  INSUFFICIENT_FUNDS: 'Not enough cash when it matched',
  INSUFFICIENT_POSITION: 'Not enough shares when it matched',
  NO_LIQUIDITY: 'No liquidity for the rest',
};

/** Order status pill; a cancel reason (if any) is shown as a tooltip and screen-reader text. */
export default function StatusBadge({ status, reason, colorMap = {} }) {
  const key = (status || '').toUpperCase();
  const tone = { ...(TONES[key] || { bg: colors.blueDark, fg: colors.blueLight, label: status || '—' }), ...(colorMap[key] || {}) };
  const why = reason ? (REASONS[reason] || reason) : null;
  return (
    <span
      data-tooltip={why || undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: 600,
        backgroundColor: tone.bg, color: tone.fg, whiteSpace: 'nowrap', letterSpacing: '0.01em',
      }}
    >
      {tone.label}{why ? ' ·' : ''}
      {why && <span style={{ fontWeight: 500 }}>{reason === 'NO_LIQUIDITY' ? 'rest cancelled' : 'auto'}</span>}
      {why && <span style={{ position: 'absolute', left: '-9999px' }}>{why}</span>}
    </span>
  );
}
