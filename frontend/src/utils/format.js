import { colors } from '../styles/shared';

/**
 * Shared formatting utilities (en-US everywhere, tabular-friendly).
 * Missing values (null/undefined/NaN) render as "—"; zero renders as zero.
 */

const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const DASH = '—';

/** Decimal places for a price by magnitude — sub-dollar coins keep their precision. */
export const priceDecimals = (abs) =>
  abs === 0 || abs >= 1 ? 2 : abs >= 0.01 ? 4 : abs >= 0.0001 ? 6 : 8;

const nf = (min, max) => new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max });
const NF = {};
const fmt = (n, min, max) => (NF[`${min}-${max}`] = NF[`${min}-${max}`] || nf(min, max)).format(n);

/** Avoid "-0.00": anything that rounds to zero is zero. */
const clean = (n, decimals) => (Math.abs(n) < 0.5 * 10 ** -decimals ? 0 : n);

/** "$1,234.56" */
export const fmtUSD = (val) => (isNum(val) ? `${Number(val) < 0 ? '-' : ''}$${fmt(Math.abs(clean(Number(val), 2)), 2, 2)}` : DASH);

/** Balances: same as USD (two decimals, grouped). */
export const fmtBalance = (val) => fmtUSD(isNum(val) ? val : 0);

/** "$67,512.40" · "$0.1655" · "$0.00001234" — precision follows magnitude. */
export const fmtPrice = (val) => {
  if (!isNum(val)) return DASH;
  const n = Number(val);
  const d = priceDecimals(Math.abs(n));
  return `${n < 0 ? '-' : ''}$${fmt(Math.abs(n), d, d)}`;
};

/** Bare price string for <input> values (no "$", no grouping). */
export const priceInputValue = (val) => {
  if (!isNum(val)) return '';
  const n = Number(val);
  return n.toFixed(priceDecimals(Math.abs(n)));
};

/** "+$1,234.56" / "-$12.30" */
export const fmtPnL = (val) => {
  if (!isNum(val)) return DASH;
  const n = clean(Number(val), 2);
  return `${n > 0 ? '+' : n < 0 ? '-' : ''}$${fmt(Math.abs(n), 2, 2)}`;
};

/** "+1.23%" / "-0.40%" / "0.00%" */
export const fmtPct = (val, decimals = 2) => {
  if (!isNum(val)) return DASH;
  const n = clean(Number(val), decimals);
  return `${n > 0 ? '+' : ''}${n.toFixed(decimals)}%`;
};

/** Quantities: up to 8 decimals, trailing zeros trimmed, grouped. */
export const fmtQty = (val) => (isNum(val) ? fmt(Number(val), 0, 8) : DASH);

/** Integers / counts with grouping. */
export const fmtNum = (val) => (isNum(val) ? fmt(Number(val), 0, 2) : DASH);

/** "1.2K" · "3.4M" · "5.6B" */
export const fmtCompact = (val, prefix = '') => {
  if (!isNum(val)) return DASH;
  const n = Number(val), a = Math.abs(n);
  const [d, s] = a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : a >= 1e3 ? [1e3, 'K'] : [1, ''];
  return `${n < 0 ? '-' : ''}${prefix}${fmt(a / d, 0, s ? 2 : 2)}${s}`;
};

/**
 * Parse an API timestamp. The backend sends UTC with a "Z"; older rows (and raw SQL
 * results) may come without a zone — treat those as UTC too.
 */
export const parseDate = (str) => {
  if (!str) return null;
  if (typeof str === 'number') return new Date(str);
  const s = String(str);
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(s);
  const d = new Date(hasZone ? s : s.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
};

/** "Nov 6, 2026, 9:41 PM" in the viewer's time zone */
export const fmtDate = (str) => {
  const d = parseDate(str);
  return d ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : DASH;
};

/** "Nov 6, 2026" */
export const fmtDateShort = (str) => {
  const d = parseDate(str);
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : DASH;
};

/** "21:41:07" */
export const fmtTime = (str) => {
  const d = parseDate(str);
  return d ? d.toLocaleTimeString('en-US', { hour12: false }) : DASH;
};

/** Text colour for P&L. */
export const pnlColor = (val) => (Number(val) > 0 ? colors.green : Number(val) < 0 ? colors.red : colors.textSecondary);

/** Text colour for BUY / SELL. */
export const sideColor = (side) => (side === 'BUY' ? colors.green : colors.red);
