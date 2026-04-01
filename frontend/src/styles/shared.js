/**
 * Shared style objects used across all pages.
 * Single source of truth for the app's visual language.
 *
 * MODERNIZED — deep navy palette, rounded cards, glassmorphism accents.
 */

// ── Colors ──────────────────────────────────────────────
export const colors = {
  // Backgrounds
  bgPage:       '#0B1426',
  bgCard:       '#111D35',
  bgCardHover:  '#152240',
  bgInput:      '#0D1829',
  bgStat:       '#0A1628',
  bgNav:        '#0E1A2E',

  // Borders
  borderDefault: '#1E2D45',
  borderMedium:  '#263A56',
  borderLight:   '#2E4468',
  borderDanger:  '#5C1D1D',
  borderWarning: '#6B4106',

  // Text
  textPrimary:   '#FFFFFF',
  textSecondary: '#8F9BB3',
  textMuted:     '#5E6B82',
  textDim:       '#3D4A5C',

  // Accents
  green:      '#00D68F',
  red:        '#FF3D71',
  blue:       '#4F8BFF',
  amber:      '#FFAA00',
  purple:     '#8B5CF6',

  // Accent darks (for backgrounds)
  greenDark:  '#0A2E1F',
  redDark:    '#2E0F1A',
  blueDark:   '#0F1F3D',
  purpleDark: '#1A1040',
  amberDark:  '#2E2000',

  // Accent lights (for text on dark accent bg)
  greenLight:  '#6EEDB8',
  redLight:    '#FF8FAA',
  purpleLight: '#B4A5FC',
  amberLight:  '#FFD166',
  blueLight:   '#8FB8FF',
};

// ── Layout ──────────────────────────────────────────────
export const pageContainer = (maxWidth = '1200px') => ({
  padding: '28px 24px',
  maxWidth,
  margin: '0 auto',
});

export const authContainer = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  minHeight: '100vh',
  background: `linear-gradient(135deg, ${colors.bgPage} 0%, #0F1D32 50%, #0B1426 100%)`,
};

export const authCard = (width = '420px') => ({
  backgroundColor: colors.bgCard,
  padding: '44px 40px',
  borderRadius: '16px',
  width,
  border: `1px solid ${colors.borderDefault}`,
  boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
});

// ── Cards ───────────────────────────────────────────────
export const cardStyle = {
  backgroundColor: colors.bgCard,
  padding: '24px',
  borderRadius: '14px',
  marginBottom: '20px',
  border: `1px solid ${colors.borderDefault}`,
  boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
  transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
};

export const cardDanger = {
  ...cardStyle,
  border: `1px solid ${colors.borderDanger}`,
  boxShadow: `0 2px 12px rgba(92,29,29,0.15)`,
};

export const cardWarning = {
  ...cardStyle,
  border: `1px solid ${colors.borderWarning}`,
  boxShadow: `0 2px 12px rgba(107,65,6,0.15)`,
};

export const statCard = {
  padding: '20px',
  background: `linear-gradient(135deg, ${colors.bgStat} 0%, ${colors.bgCard} 100%)`,
  borderRadius: '12px',
  border: `1px solid ${colors.borderDefault}`,
};

// ── Inputs ──────────────────────────────────────────────
export const inputStyle = {
  padding: '11px 14px',
  backgroundColor: colors.bgInput,
  border: `1px solid ${colors.borderMedium}`,
  borderRadius: '10px',
  color: colors.textPrimary,
  boxSizing: 'border-box',
  fontSize: '14px',
  outline: 'none',
  transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
};

export const inputFull = {
  ...inputStyle,
  width: '100%',
};

// ── Buttons ─────────────────────────────────────────────
const buttonBase = {
  border: 'none',
  borderRadius: '10px',
  color: 'white',
  cursor: 'pointer',
  fontWeight: '600',
  fontSize: '14px',
  letterSpacing: '0.01em',
  transition: 'transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease',
};

export const buttonStyles = {
  green:   { ...buttonBase, background: `linear-gradient(135deg, ${colors.green}, #00B87A)` },
  red:     { ...buttonBase, background: `linear-gradient(135deg, ${colors.red}, #E0284F)` },
  blue:    { ...buttonBase, background: `linear-gradient(135deg, ${colors.blue}, #3A6FE0)` },
  amber:   { ...buttonBase, background: `linear-gradient(135deg, ${colors.amber}, #E09500)`, color: '#1A1400' },
  purple:  { ...buttonBase, background: `linear-gradient(135deg, ${colors.purple}, #7044E0)` },
  gray:    { ...buttonBase, backgroundColor: colors.borderMedium, color: colors.textSecondary, fontWeight: '500' },
  darkRed: { ...buttonBase, backgroundColor: colors.redDark, color: colors.redLight, fontWeight: '500', border: `1px solid ${colors.borderDanger}` },
};

export const btnSmall  = { padding: '6px 16px', fontSize: '12px' };
export const btnMedium = { padding: '10px 22px', fontSize: '14px' };
export const btnLarge  = { padding: '14px', width: '100%', fontSize: '16px' };

// ── Labels ──────────────────────────────────────────────
export const labelStyle = {
  color: colors.textMuted,
  fontSize: '12px',
  display: 'block',
  marginBottom: '6px',
  fontWeight: '500',
  letterSpacing: '0.03em',
  textTransform: 'uppercase',
};

export const formLabel = {
  display: 'block',
  color: colors.textSecondary,
  marginBottom: '6px',
  fontSize: '14px',
  fontWeight: '500',
};

// ── Tables ──────────────────────────────────────────────
export const tableStyle = {
  width: '100%',
  borderCollapse: 'separate',
  borderSpacing: '0',
};

export const tableSmall = {
  ...tableStyle,
  fontSize: '13px',
};

export const thStyle = (align = 'left') => ({
  textAlign: align,
  padding: '10px 12px',
  color: colors.textMuted,
  fontSize: '11px',
  fontWeight: '600',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
});

export const thStyleSmall = (align = 'left') => ({
  textAlign: align,
  padding: '8px 10px',
  color: colors.textMuted,
  fontSize: '10px',
  fontWeight: '600',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
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
  padding: '10px 12px',
  textAlign: align,
});

export const tdStyleSmall = (align = 'left') => ({
  padding: '8px 10px',
  textAlign: align,
});

export const emptyRow = (colSpan) => ({
  padding: '24px 16px',
  textAlign: 'center',
  color: colors.textDim,
});

// ── Alerts / Banners ────────────────────────────────────
export const errorBanner = {
  backgroundColor: colors.redDark,
  color: colors.redLight,
  padding: '12px 16px',
  borderRadius: '10px',
  marginBottom: '16px',
  fontSize: '14px',
  border: `1px solid ${colors.borderDanger}`,
};

export const successBanner = {
  backgroundColor: colors.greenDark,
  color: colors.greenLight,
  padding: '12px 16px',
  borderRadius: '10px',
  marginBottom: '16px',
  fontSize: '14px',
  border: `1px solid rgba(0,214,143,0.2)`,
};

export const debugBanner = {
  backgroundColor: colors.purpleDark,
  color: colors.purpleLight,
  padding: '12px 16px',
  borderRadius: '10px',
  marginBottom: '16px',
  fontSize: '12px',
  fontFamily: 'monospace',
  border: `1px solid rgba(139,92,246,0.2)`,
};

// ── Modals ──────────────────────────────────────────────
export const modalOverlay = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(5,10,20,0.80)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  zIndex: 1000,
};

export const modalContent = (width = '420px') => ({
  backgroundColor: colors.bgCard,
  padding: '36px',
  borderRadius: '16px',
  border: `1px solid ${colors.borderMedium}`,
  width,
  textAlign: 'center',
  boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
});

// ── Misc ────────────────────────────────────────────────
export const preBlock = {
  marginTop: '12px',
  padding: '16px',
  backgroundColor: colors.bgStat,
  borderRadius: '10px',
  fontSize: '12px',
  overflow: 'auto',
  color: colors.purpleLight,
  maxHeight: '300px',
  border: `1px solid ${colors.borderDefault}`,
  fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
};

export const sectionHeading = (color = colors.textSecondary) => ({
  color,
  marginBottom: '12px',
  fontSize: '15px',
  fontWeight: '600',
});

export const pageHeading = (color = colors.green) => ({
  color,
  marginBottom: '28px',
  fontSize: '22px',
  fontWeight: '700',
  letterSpacing: '-0.01em',
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
  fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
  resize: 'vertical',
};

// ── Inline code / monospace ─────────────────────────────
export const codeInline = (color = colors.amber) => ({
  color,
  fontSize: '12px',
  fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
});

// ── Select (dropdown) ───────────────────────────────────
export const selectStyle = {
  background: colors.bgInput,
  color: colors.textPrimary,
  border: `1px solid ${colors.borderMedium}`,
  padding: '10px 14px',
  borderRadius: '10px',
  fontSize: '14px',
  outline: 'none',
  transition: 'border-color 0.2s ease',
};

// ── Order-error banner ──────────────────────────────────
export const orderErrorBanner = {
  marginTop: '12px',
  padding: '14px 18px',
  background: colors.redDark,
  border: `1px solid ${colors.red}`,
  borderRadius: '10px',
  fontSize: '14px',
  color: colors.redLight,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

// ── Order-status banner ─────────────────────────────────
export const orderStatusBanner = (filled = false) => ({
  marginTop: '12px',
  padding: '12px 18px',
  background: filled ? colors.greenDark : colors.bgInput,
  border: `1px solid ${filled ? colors.green : colors.borderMedium}`,
  borderRadius: '10px',
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

// ── Account Level ──────────────────────────────────────
export const levelBadge = (isVerified) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '3px 10px',
  borderRadius: '20px',
  fontSize: '11px',
  fontWeight: '600',
  letterSpacing: '0.04em',
  backgroundColor: isVerified ? colors.greenDark : '#1A1F2E',
  color: isVerified ? colors.greenLight : colors.textMuted,
  border: `1px solid ${isVerified ? 'rgba(0,214,143,0.3)' : colors.borderDefault}`,
});

export const verifiedRing = {
  width: '32px',
  height: '32px',
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '14px',
  fontWeight: '700',
  position: 'relative',
};

export const progressBarTrack = {
  width: '100%',
  height: '8px',
  backgroundColor: colors.bgInput,
  borderRadius: '4px',
  overflow: 'hidden',
  border: `1px solid ${colors.borderDefault}`,
};

export const progressBarFill = (percent) => ({
  width: `${Math.min(percent, 100)}%`,
  height: '100%',
  background: `linear-gradient(90deg, ${colors.green}, #00B87A)`,
  borderRadius: '4px',
  transition: 'width 0.4s ease',
});

export const lockOverlay = {
  opacity: 0.5,
  pointerEvents: 'none',
  filter: 'grayscale(30%)',
};

export const lockBanner = {
  backgroundColor: colors.bgInput,
  border: `1px solid ${colors.borderMedium}`,
  borderRadius: '10px',
  padding: '16px 20px',
  textAlign: 'center',
  marginBottom: '16px',
};
