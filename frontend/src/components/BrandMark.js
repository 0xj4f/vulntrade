import React from 'react';

/** VulnTrade logo mark (rising-chart glyph on the brand green). */
export default function BrandMark({ size = 28 }) {
  return (
    <span aria-hidden="true" style={{
      width: size, height: size, borderRadius: Math.round(size * 0.28), flexShrink: 0,
      background: 'linear-gradient(135deg, var(--vt-up-fill), #0ea371)',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 10px var(--vt-up-soft)',
    }}>
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none" stroke="#03140c" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 17l6-6 4 4 8-8" />
        <path d="M15 7h6v6" />
      </svg>
    </span>
  );
}

