import { colors } from '../styles/shared';

/**
 * Shared formatting utilities.
 * Pure functions — no side effects, no logic beyond presentation.
 */

/** "$1,234.56" — two forced decimal places */
export const fmtUSD = (val) =>
  `$${Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "$1,234.56" — at-least-two decimal places (for balances) */
export const fmtBalance = (val) =>
  `$${Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

/** "$1.23" — fixed two decimal places (for per-share prices) */
export const fmtPrice = (val) => `$${Number(val || 0).toFixed(2)}`;

/** "+$1,234.56" / "-$1,234.56" — P&L with sign and currency */
export const fmtPnL = (val) => {
  const n = Number(val || 0);
  return `${n >= 0 ? '+' : ''}${n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`;
};

/** "+1.23%" / "-1.23%" — percentage with sign */
export const fmtPct = (val) => {
  const n = Number(val || 0);
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
};

/** Quantity — up to 8 decimal places, locale-separated (covers fractional shares / crypto) */
export const fmtQty = (val) =>
  Number(val || 0).toLocaleString(undefined, { maximumFractionDigits: 8 });

/** Plain number with thousands separator */
export const fmtNum = (val) => Number(val || 0).toLocaleString();

/** "Jan 1, 2025, 4:32 PM" — full locale date + time */
export const fmtDate = (str) => (str ? new Date(str).toLocaleString() : '—');

/** "Jan 1, 2025" — date only */
export const fmtDateShort = (str) => (str ? new Date(str).toLocaleDateString() : '—');

/** Green for profit / non-negative, red for loss */
export const pnlColor = (val) => (Number(val) >= 0 ? colors.green : colors.red);

/** Green for BUY, red for SELL */
export const sideColor = (side) => (side === 'BUY' ? colors.green : colors.red);
