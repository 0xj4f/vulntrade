import React from 'react';
import { colors, type } from '../styles/shared';

/**
 * Page frame: max-width container with a title row (title, subtitle, actions).
 * `titleColor` is accepted for compatibility; titles are neutral by design.
 */
export default function PageLayout({ title, subtitle, actions, maxWidth = '1280px', children, eyebrow }) {
  return (
    <main className="vt-page fade-in" style={{ '--vt-page-max': maxWidth }}>
      {(title || actions) && (
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            {eyebrow && <div style={{ ...type.caps, marginBottom: '4px' }}>{eyebrow}</div>}
            {title && <h1 style={{ ...type.title, fontSize: '22px', color: colors.textPrimary }}>{title}</h1>}
            {subtitle && <p style={{ color: colors.textMuted, fontSize: '13px', marginTop: '4px' }}>{subtitle}</p>}
          </div>
          {actions && <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>{actions}</div>}
        </div>
      )}
      {children}
    </main>
  );
}
