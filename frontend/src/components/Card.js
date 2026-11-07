import React from 'react';
import { colors, cardStyle, cardDanger, cardWarning, type } from '../styles/shared';

const VARIANTS = { default: cardStyle, danger: cardDanger, warning: cardWarning };

/**
 * Surface container with an optional header (title · subtitle · right-side actions).
 * `flush` removes body padding (for tables/lists that run edge to edge).
 */
export default function Card({
  title, subtitle, titleColor, variant = 'default', headerRight, hint, children,
  flush = false, style = {}, bodyStyle = {}, id, className = '', as: Tag = 'section',
}) {
  const base = VARIANTS[variant] || cardStyle;
  const hasHeader = title || headerRight;
  return (
    <Tag id={id} className={className} style={{ ...base, padding: 0, overflow: 'hidden', ...style }}>
      {hasHeader && (
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
          padding: '12px 16px', minHeight: '48px',
          borderBottom: `1px solid ${colors.borderDefault}`,
        }}>
          <div style={{ minWidth: 0 }}>
            {title && (
              <h3 style={{ ...type.section, fontSize: '14px', color: titleColor || colors.textPrimary, display: 'flex', alignItems: 'center', gap: '8px' }}>
                {title}
              </h3>
            )}
            {subtitle && <div style={{ ...type.meta, marginTop: '2px' }}>{subtitle}</div>}
          </div>
          {headerRight && <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>{headerRight}</div>}
        </header>
      )}
      <div style={{ padding: flush ? 0 : '16px', ...bodyStyle }}>
        {children}
        {hint && <p style={{ color: colors.textMuted, fontSize: '12px', marginTop: '10px', lineHeight: 1.6 }}>{hint}</p>}
      </div>
    </Tag>
  );
}
