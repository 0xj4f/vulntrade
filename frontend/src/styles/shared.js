/**
 * Shared style objects used across all pages.
 *
 * Every colour is a CSS variable from styles/theme.css, so the same inline styles render
 * correctly in the dark and the light theme. Spacing follows a 4px grid
 * (4 · 8 · 12 · 16 · 20 · 24 · 32 · 48); radii are 6 (controls) · 10 (cards) · 14 (dialogs).
 */

// ── Colors (theme variables) ────────────────────────────
export const colors = {
  // Backgrounds
  bgPage:       'var(--vt-bg)',
  bgCard:       'var(--vt-surface)',
  bgCardHover:  'var(--vt-surface-2)',
  bgInput:      'var(--vt-input)',
  bgStat:       'var(--vt-surface-2)',
  bgNav:        'var(--vt-bg-elev)',
  bgRaised:     'var(--vt-surface-3)',
  overlay:      'var(--vt-overlay)',

  // Borders
  borderDefault: 'var(--vt-border)',
  borderMedium:  'var(--vt-border-strong)',
  borderLight:   'var(--vt-border-strong)',
  borderDanger:  'var(--vt-down-border)',
  borderWarning: 'var(--vt-warn-border)',
  borderAccent:  'var(--vt-accent-border)',
  borderUp:      'var(--vt-up-border)',

  // Text
  textPrimary:   'var(--vt-text)',
  textSecondary: 'var(--vt-text-2)',
  textMuted:     'var(--vt-text-3)',
  textDim:       'var(--vt-text-4)',

  // Accents (text-safe in both themes)
  green:      'var(--vt-pos)',
  red:        'var(--vt-neg)',
  blue:       'var(--vt-accent-text)',
  amber:      'var(--vt-warn-text)',
  purple:     'var(--vt-violet-text)',

  // Solid fills (buttons, bars) and the text that sits on them
  upFill:     'var(--vt-up-fill)',
  onUp:       'var(--vt-on-up)',
  downFill:   'var(--vt-down-fill)',
  onDown:     'var(--vt-on-down)',
  accentFill: 'var(--vt-accent-fill)',
  onAccent:   'var(--vt-on-accent)',
  warnFill:   'var(--vt-warn)',
  violetFill: 'var(--vt-violet)',

  // Tinted backgrounds
  greenDark:  'var(--vt-up-soft)',
  redDark:    'var(--vt-down-soft)',
  blueDark:   'var(--vt-accent-soft)',
  purpleDark: 'var(--vt-violet-soft)',
  amberDark:  'var(--vt-warn-soft)',

  // Text on tinted backgrounds
  greenLight:  'var(--vt-up-text)',
  redLight:    'var(--vt-down-text)',
  purpleLight: 'var(--vt-violet-text)',
  amberLight:  'var(--vt-warn-text)',
  blueLight:   'var(--vt-accent-text)',

  // Ranks
  gold:   'var(--vt-gold)',
  silver: 'var(--vt-silver)',
  bronze: 'var(--vt-bronze)',
};

export const fonts = {
  sans: 'var(--vt-font)',
  mono: 'var(--vt-mono)',
};

export const space = { 1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '20px', 6: '24px', 8: '32px', 12: '48px' };
export const radius = { sm: 'var(--vt-radius-sm)', md: 'var(--vt-radius)', lg: 'var(--vt-radius-lg)', pill: '999px' };

/** Type scale (px): 11 caps · 12 meta · 13 dense · 14 body · 16 section · 20 title · 28 hero · 36 display */
export const type = {
  caps:    { fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: colors.textMuted },
  meta:    { fontSize: '12px', color: colors.textMuted },
  dense:   { fontSize: '13px' },
  body:    { fontSize: '14px' },
  section: { fontSize: '16px', fontWeight: 600, letterSpacing: '-0.01em' },
  title:   { fontSize: '20px', fontWeight: 600, letterSpacing: '-0.02em' },
  hero:    { fontSize: '28px', fontWeight: 600, letterSpacing: '-0.02em' },
  display: { fontSize: '36px', fontWeight: 700, letterSpacing: '-0.03em' },
};

/** Monospaced, tabular numerals for prices, quantities and ids */
export const num = { fontFamily: fonts.mono, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' };

// ── Layout ──────────────────────────────────────────────
export const pageContainer = (maxWidth = '1280px') => ({
  padding: '24px 24px 48px',
  maxWidth,
  margin: '0 auto',
  width: '100%',
});

export const authContainer = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  minHeight: '100vh',
  background: colors.bgPage,
};

export const authCard = (width = '420px') => ({
  backgroundColor: colors.bgCard,
  padding: '32px',
  borderRadius: radius.lg,
  width: '100%',
  maxWidth: width,
  border: `1px solid ${colors.borderDefault}`,
  boxShadow: 'var(--vt-shadow-2)',
});

// ── Cards ───────────────────────────────────────────────
export const cardStyle = {
  backgroundColor: colors.bgCard,
  padding: '16px 20px',
  borderRadius: radius.md,
  marginBottom: '16px',
  border: `1px solid ${colors.borderDefault}`,
  boxShadow: 'var(--vt-shadow-1)',
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
  backgroundColor: colors.bgCard,
  padding: '14px 16px',
  borderRadius: radius.md,
  border: `1px solid ${colors.borderDefault}`,
};

// ── Inputs ──────────────────────────────────────────────
export const inputStyle = {
  height: '36px',
  padding: '0 12px',
  background: colors.bgInput,
  border: `1px solid ${colors.borderMedium}`,
  borderRadius: radius.sm,
  color: colors.textPrimary,
  fontSize: '13px',
  outline: 'none',
  minWidth: 0,
};

export const inputFull = {
  ...inputStyle,
  width: '100%',
  height: '40px',
  fontSize: '14px',
};

// ── Buttons ─────────────────────────────────────────────
const btnBase = {
  border: '1px solid transparent',
  borderRadius: radius.sm,
  cursor: 'pointer',
  fontWeight: 600,
  letterSpacing: '0.01em',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  whiteSpace: 'nowrap',
};

export const buttonStyles = {
  green:   { ...btnBase, background: colors.upFill, color: colors.onUp },
  red:     { ...btnBase, background: colors.downFill, color: colors.onDown },
  blue:    { ...btnBase, background: colors.accentFill, color: colors.onAccent },
  amber:   { ...btnBase, background: colors.amberDark, color: colors.amber, border: `1px solid ${colors.borderWarning}` },
  purple:  { ...btnBase, background: colors.purpleDark, color: colors.purple, border: '1px solid var(--vt-violet-soft)' },
  gray:    { ...btnBase, background: colors.bgCard, color: colors.textSecondary, border: `1px solid ${colors.borderMedium}`, fontWeight: 500 },
  ghost:   { ...btnBase, background: 'transparent', color: colors.textSecondary, fontWeight: 500 },
  darkRed: { ...btnBase, background: colors.redDark, color: colors.red, border: `1px solid ${colors.borderDanger}` },
};

export const btnSmall  = { height: '28px', padding: '0 10px', fontSize: '12px' };
export const btnMedium = { height: '36px', padding: '0 16px', fontSize: '13px' };
export const btnLarge  = { height: '44px', padding: '0 16px', width: '100%', fontSize: '14px' };

// ── Labels ──────────────────────────────────────────────
export const labelStyle = {
  ...type.caps,
  display: 'block',
  marginBottom: '6px',
};

export const formLabel = {
  display: 'block',
  marginBottom: '6px',
  color: colors.textSecondary,
  fontSize: '13px',
  fontWeight: 500,
};

// ── Tables ──────────────────────────────────────────────
export const tableStyle = {
  width: '100%',
  borderCollapse: 'separate',
  borderSpacing: 0,
};

export const tableSmall = {
  ...tableStyle,
  fontSize: '12.5px',
};

export const thStyle = (align = 'left') => ({
  textAlign: align,
  padding: '10px 12px',
  color: colors.textMuted,
  fontWeight: 600,
  fontSize: '11px',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: `1px solid ${colors.borderDefault}`,
  background: colors.bgCard,
  whiteSpace: 'nowrap',
});

export const thStyleSmall = (align = 'left') => ({
  ...thStyle(align),
  padding: '8px 10px',
});

export const trBorder = {};
export const trBorderMedium = {};
export const trBorderHeavy = {};

export const tdStyle = (align = 'left') => ({
  textAlign: align,
  padding: '10px 12px',
  borderBottom: `1px solid ${colors.borderDefault}`,
  fontSize: '13px',
});

export const tdStyleSmall = (align = 'left') => ({
  textAlign: align,
  padding: '7px 10px',
  borderBottom: `1px solid ${colors.borderDefault}`,
  fontSize: '12.5px',
});

export const emptyRow = (colSpan) => ({
  padding: '28px 12px',
  textAlign: 'center',
  color: colors.textMuted,
  fontSize: '13px',
});

// ── Banners ─────────────────────────────────────────────
export const errorBanner = {
  color: colors.redLight,
  background: colors.redDark,
  border: `1px solid ${colors.borderDanger}`,
  padding: '10px 14px',
  borderRadius: radius.sm,
  marginBottom: '16px',
  fontSize: '13px',
  lineHeight: 1.5,
};

export const successBanner = {
  color: colors.greenLight,
  background: colors.greenDark,
  border: `1px solid ${colors.borderUp}`,
  padding: '10px 14px',
  borderRadius: radius.sm,
  marginBottom: '16px',
  fontSize: '13px',
  lineHeight: 1.5,
};

export const debugBanner = {
  background: colors.amberDark,
  color: colors.amber,
  padding: '10px 14px',
  borderRadius: radius.sm,
  border: `1px solid ${colors.borderWarning}`,
  marginBottom: '16px',
  fontSize: '12px',
  fontFamily: fonts.mono,
  lineHeight: 1.6,
};

// ── Modal ───────────────────────────────────────────────
export const modalOverlay = {
  position: 'fixed',
  inset: 0,
  backgroundColor: colors.overlay,
  backdropFilter: 'blur(4px)',
  WebkitBackdropFilter: 'blur(4px)',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  zIndex: 1000,
  padding: '16px',
};

export const modalContent = (width = '420px') => ({
  position: 'relative',
  backgroundColor: colors.bgCard,
  padding: '24px',
  borderRadius: radius.lg,
  width: '100%',
  maxWidth: width,
  maxHeight: 'calc(100vh - 32px)',
  overflowY: 'auto',
  border: `1px solid ${colors.borderDefault}`,
  boxShadow: 'var(--vt-shadow-3)',
});

// ── Misc ────────────────────────────────────────────────
export const preBlock = {
  background: colors.bgInput,
  padding: '12px 14px',
  borderRadius: radius.sm,
  border: `1px solid ${colors.borderDefault}`,
  overflow: 'auto',
  color: colors.textSecondary,
  fontSize: '12px',
  fontFamily: fonts.mono,
  lineHeight: 1.6,
  maxHeight: '420px',
};

export const sectionHeading = (color = colors.textSecondary) => ({
  ...type.caps,
  color,
  marginBottom: '12px',
});

export const pageHeading = (color = colors.textPrimary) => ({
  ...type.title,
  color,
  marginBottom: '16px',
});

export const hintText = {
  color: colors.textMuted,
  fontSize: '12px',
  marginTop: '8px',
  lineHeight: 1.6,
};

export const flexRow = (gap = '8px') => ({
  display: 'flex',
  gap,
  alignItems: 'center',
});

export const flexRowWrap = (gap = '8px') => ({
  display: 'flex',
  gap,
  alignItems: 'flex-end',
  flexWrap: 'wrap',
});

export const gridCols = (cols = '1fr 1fr') => ({
  display: 'grid',
  gridTemplateColumns: cols,
  gap: '16px',
});

export const textareaStyle = {
  ...inputFull,
  height: 'auto',
  padding: '10px 12px',
  fontFamily: fonts.mono,
  fontSize: '12.5px',
  resize: 'vertical',
  lineHeight: 1.6,
};

export const codeInline = (color = colors.amber) => ({
  color,
  fontFamily: fonts.mono,
  fontSize: '12px',
  wordBreak: 'break-all',
});

export const selectStyle = {
  ...inputStyle,
  paddingRight: '30px',
  cursor: 'pointer',
  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237f8a9d' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
};

export const orderErrorBanner = {
  marginTop: '12px',
  padding: '10px 12px',
  borderRadius: radius.sm,
  backgroundColor: colors.redDark,
  border: `1px solid ${colors.borderDanger}`,
  color: colors.redLight,
  fontSize: '12.5px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '8px',
};

export const orderStatusBanner = (filled = false) => ({
  marginTop: '12px',
  padding: '10px 12px',
  borderRadius: radius.sm,
  fontSize: '12.5px',
  backgroundColor: filled ? colors.greenDark : colors.blueDark,
  border: `1px solid ${filled ? colors.borderUp : colors.borderAccent}`,
  color: filled ? colors.greenLight : colors.blueLight,
});

export const lineHeight2 = { lineHeight: '2', fontSize: '14px' };

export const smallText = (color = colors.textMuted) => ({
  color,
  fontSize: '12px',
});

// ── Account Level / Verification ────────────────────────
export const levelBadge = (isVerified) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '2px 8px',
  borderRadius: '999px',
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.02em',
  backgroundColor: isVerified ? colors.greenDark : colors.amberDark,
  color: isVerified ? colors.greenLight : colors.amber,
  border: `1px solid ${isVerified ? colors.borderUp : colors.borderWarning}`,
});

export const verifiedRing = {
  border: `2px solid ${colors.upFill}`,
  boxShadow: '0 0 0 3px var(--vt-up-soft)',
};

export const progressBarTrack = {
  width: '100%',
  height: '6px',
  backgroundColor: colors.bgRaised,
  borderRadius: '999px',
  overflow: 'hidden',
};

export const progressBarFill = (percent) => ({
  width: `${percent}%`,
  height: '100%',
  background: `linear-gradient(90deg, ${colors.accentFill}, ${colors.upFill})`,
  borderRadius: '999px',
  transition: 'width 0.5s var(--vt-ease)',
});

export const lockOverlay = {
  position: 'relative',
  opacity: 0.45,
  pointerEvents: 'none',
  userSelect: 'none',
};

export const lockBanner = {
  padding: '12px 16px',
  borderRadius: radius.sm,
  backgroundColor: colors.amberDark,
  border: `1px solid ${colors.borderWarning}`,
  color: colors.amber,
  fontSize: '13px',
  marginBottom: '16px',
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
};
