import React, { useId } from 'react';
import { colors } from '../styles/shared';

/**
 * Tiny inline trend line. Colour follows direction (first vs last point) unless given.
 */
export default function SparkLine({ data = [], width = 80, height = 24, color, strokeWidth = 1.5, fill = true }) {
  const gid = useId().replace(/:/g, '');
  const pts = (data || []).map(Number).filter(n => Number.isFinite(n));
  if (pts.length < 2) {
    return <svg width={width} height={height} aria-hidden="true"><line x1="0" x2={width} y1={height / 2} y2={height / 2} stroke={colors.borderMedium} strokeDasharray="2 3" /></svg>;
  }
  const min = Math.min(...pts), max = Math.max(...pts);
  const range = max - min || 1;
  const step = width / (pts.length - 1);
  const xy = pts.map((p, i) => [i * step, height - 2 - ((p - min) / range) * (height - 4)]);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const stroke = color || (pts[pts.length - 1] >= pts[0] ? 'var(--vt-up)' : 'var(--vt-down)');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
      {fill && (
        <>
          <defs>
            <linearGradient id={`sg${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${line} L${width},${height} L0,${height} Z`} fill={`url(#sg${gid})`} />
        </>
      )}
      <path d={line} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
