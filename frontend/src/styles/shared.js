/**
 * Shared style objects used across all pages.
 * Single source of truth for the app's visual language.
 */

// ── Colors ──────────────────────────────────────────────
export const colors = {
  bgPage: '#0a0e17',
  bgCard: '#111827',
  bgInput: '#1f2937',
  bgStat: '#0f172a',
  borderDefault: '#1f2937',
  borderMedium: '#374151',
  borderDanger: '#7f1d1d',
  borderWarning: '#92400e',
  textPrimary: '#e5e7eb',
  textSecondary: '#9ca3af',
  textMuted: '#6b7280',
  textDim: '#4b5563',
  green: '#10b981',
  red: '#ef4444',
  blue: '#3b82f6',
  amber: '#f59e0b',
  purple: '#8b5cf6',
  greenDark: '#064e3b',
  redDark: '#7f1d1d',
  purpleDark: '#1e1b4b',
  purpleLight: '#a5b4fc',
  amberLight: '#fbbf24',
  redLight: '#fca5a5',
  greenLight: '#6ee7b7',
};

// ── Layout ──────────────────────────────────────────────
export const pageContainer = (maxWidth = '1200px') => ({
  padding: '24px',
  maxWidth,
  margin: '0 auto',
});

export const authContainer = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  minHeight: '100vh',
  backgroundColor: colors.bgPage,
};

export const authCard = (width = '400px') => ({
  backgroundColor: colors.bgCard,
  padding: '40px',
  borderRadius: '12px',
  width,
  border: `1px solid ${colors.borderDefault}`,
});

// ── Cards ───────────────────────────────────────────────
export const cardStyle = {
  backgroundColor: colors.bgCard,
  padding: '20px',
  borderRadius: '8px',
  marginBottom: '20px',
  border: `1px solid ${colors.borderDefault}`,
};

export const cardDanger = {
  ...cardStyle,
  border: `1px solid ${colors.borderDanger}`,
};

export const cardWarning = {
  ...cardStyle,
  border: `1px solid ${colors.borderWarning}`,
};

export const statCard = {
  padding: '16px',
  background: colors.bgStat,
  borderRadius: '8px',
};

// ── Inputs ──────────────────────────────────────────────
export const inputStyle = {
  padding: '10px',
  backgroundColor: colors.bgInput,
  border: `1px solid ${colors.borderMedium}`,
  borderRadius: '6px',
  color: colors.textPrimary,
  boxSizing: 'border-box',
};

export const inputFull = {
  ...inputStyle,
  width: '100%',
};

// ── Buttons ─────────────────────────────────────────────
const buttonBase = {
  border: 'none',
  borderRadius: '6px',
  color: 'white',
  cursor: 'pointer',
  fontWeight: 'bold',
};

export const buttonStyles = {
  green: { ...buttonBase, backgroundColor: colors.green },
  red: { ...buttonBase, backgroundColor: colors.red },
  blue: { ...buttonBase, backgroundColor: colors.blue },
  amber: { ...buttonBase, backgroundColor: colors.amber, color: colors.bgCard },
  purple: { ...buttonBase, backgroundColor: colors.purple },
  gray: { ...buttonBase, backgroundColor: colors.borderMedium, color: colors.textPrimary, fontWeight: 'normal' },
  darkRed: { ...buttonBase, backgroundColor: colors.redDark, color: colors.redLight, fontWeight: 'normal' },
};

export const btnSmall = { padding: '6px 14px', fontSize: '12px' };
export const btnMedium = { padding: '10px 20px' };
export const btnLarge = { padding: '12px', width: '100%', fontSize: '16px' };

// ── Labels ──────────────────────────────────────────────
export const labelStyle = {
  color: colors.textMuted,
  fontSize: '12px',
  display: 'block',
  marginBottom: '4px',
};

export const formLabel = {
  display: 'block',
  color: colors.textSecondary,
  marginBottom: '4px',
  fontSize: '14px',
};

// ── Tables ──────────────────────────────────────────────
export const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
};

export const tableSmall = {
  ...tableStyle,
  fontSize: '13px',
};

export const thStyle = (align = 'left') => ({
  textAlign: align,
  padding: '8px',
  color: colors.textMuted,
});

export const thStyleSmall = (align = 'left') => ({
  textAlign: align,
  padding: '6px',
  color: colors.textMuted,
});

export const trBorder = {
  borderBottom: `1px solid ${colors.borderDefault}`,
};

export const trBorderMedium = {
  borderBottom: `1px solid ${colors.borderMedium}`,
};

export const trBorderHeavy = {
  borderBottom: `2px solid ${colors.borderMedium}`,
};

export const tdStyle = (align = 'left') => ({
  padding: '8px',
  textAlign: align,
});

export const tdStyleSmall = (align = 'left') => ({
  padding: '6px',
  textAlign: align,
});

export const emptyRow = (colSpan) => ({
  padding: '16px',
  textAlign: 'center',
  color: colors.textDim,
});

// ── Alerts / Banners ────────────────────────────────────
export const errorBanner = {
  backgroundColor: colors.redDark,
  color: colors.redLight,
  padding: '10px',
  borderRadius: '6px',
  marginBottom: '16px',
  fontSize: '14px',
};

export const successBanner = {
  backgroundColor: colors.greenDark,
  color: colors.greenLight,
  padding: '10px',
  borderRadius: '6px',
  marginBottom: '16px',
  fontSize: '14px',
};

export const debugBanner = {
  backgroundColor: colors.purpleDark,
  color: colors.purpleLight,
  padding: '10px',
  borderRadius: '6px',
  marginBottom: '16px',
  fontSize: '12px',
  fontFamily: 'monospace',
};

// ── Modals ──────────────────────────────────────────────
export const modalOverlay = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.7)',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  zIndex: 1000,
};

export const modalContent = (width = '400px') => ({
  backgroundColor: colors.bgInput,
  padding: '32px',
  borderRadius: '12px',
  border: `1px solid ${colors.borderMedium}`,
  width,
  textAlign: 'center',
});

// ── Misc ────────────────────────────────────────────────
export const preBlock = {
  marginTop: '12px',
  padding: '12px',
  backgroundColor: colors.bgStat,
  borderRadius: '6px',
  fontSize: '12px',
  overflow: 'auto',
  color: colors.purpleLight,
  maxHeight: '300px',
};

export const sectionHeading = (color = colors.textSecondary) => ({
  color,
  marginBottom: '12px',
});

export const pageHeading = (color = colors.green) => ({
  color,
  marginBottom: '24px',
});

export const hintText = {
  color: colors.textMuted,
  fontSize: '12px',
  marginBottom: '12px',
};

export const flexRow = (gap = '8px') => ({
  display: 'flex',
  gap,
});

export const flexRowWrap = (gap = '8px') => ({
  display: 'flex',
  gap,
  flexWrap: 'wrap',
  alignItems: 'flex-end',
});

export const gridCols = (cols = '1fr 1fr') => ({
  display: 'grid',
  gridTemplateColumns: cols,
  gap: '16px',
});

// ── Textarea ────────────────────────────────────────────
export const textareaStyle = {
  ...inputStyle,
  width: '100%',
  fontFamily: 'monospace',
  resize: 'vertical',
};

// ── Inline code / monospace ─────────────────────────────
export const codeInline = (color = colors.amber) => ({
  color,
  fontSize: '12px',
  fontFamily: 'monospace',
});

// ── Select (dropdown) ───────────────────────────────────
export const selectStyle = {
  background: colors.bgInput,
  color: colors.textPrimary,
  border: `1px solid ${colors.borderMedium}`,
  padding: '8px',
  borderRadius: '4px',
};

// ── Order-error banner ──────────────────────────────────
export const orderErrorBanner = {
  marginTop: '12px',
  padding: '12px 16px',
  background: colors.redDark,
  border: `1px solid ${colors.red}`,
  borderRadius: '6px',
  fontSize: '14px',
  color: colors.redLight,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

// ── Order-status banner ─────────────────────────────────
export const orderStatusBanner = (filled = false) => ({
  marginTop: '12px',
  padding: '10px 16px',
  background: filled ? colors.greenDark : colors.bgInput,
  border: `1px solid ${filled ? colors.green : colors.borderMedium}`,
  borderRadius: '6px',
  fontSize: '13px',
  color: colors.textPrimary,
});

// ── Misc small helpers ──────────────────────────────────
export const lineHeight2 = { lineHeight: '2', fontSize: '14px' };

export const smallText = (color = colors.textMuted) => ({
  color,
  fontSize: '11px',
  marginTop: '4px',
});
