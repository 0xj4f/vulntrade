import React from 'react';
import {
  cardStyle, cardDanger, cardWarning,
  sectionHeading, colors,
} from '../styles/shared';

/**
 * Reusable card container.
 * @param {string} variant - 'default' | 'danger' | 'warning'
 * @param {string} title - optional heading text
 * @param {string} titleColor - heading color override
 * @param {string} hint - small hint text below title
 * @param {object} style - extra style overrides
 */
export default function Card({
  variant = 'default',
  title,
  titleColor,
  hint,
  children,
  style = {},
  headerRight,
}) {
  const base =
    variant === 'danger' ? cardDanger :
    variant === 'warning' ? cardWarning :
    cardStyle;

  return (
    <div style={{ ...base, ...style }}>
      {(title || headerRight) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          {title && (
            <h3 style={sectionHeading(titleColor || colors.textSecondary)}>{title}</h3>
          )}
          {headerRight}
        </div>
      )}
      {hint && (
        <p style={{ color: colors.textMuted, fontSize: '12px', marginBottom: '12px' }}>
          {hint}
        </p>
      )}
      {children}
    </div>
  );
}
