import React from 'react';

/**
 * Inline SVG sparkline — renders a tiny line chart from an array of numbers.
 * Zero dependencies, ~30 lines.
 *
 * @param {number[]} data - array of price values
 * @param {number} width - SVG width
 * @param {number} height - SVG height
 * @param {string} color - stroke color (auto green/red if not specified)
 * @param {number} strokeWidth - line thickness
 */
export default function SparkLine({
  data = [],
  width = 80,
  height = 28,
  color,
  strokeWidth = 1.5,
}) {
  if (data.length < 2) return <div style={{ width, height }} />;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  // Auto color: green if trending up, red if down
  const autoColor = data[data.length - 1] >= data[0] ? '#00D68F' : '#FF3D71';
  const strokeColor = color || autoColor;

  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((val - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <polyline
        points={points}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Gradient fill under the line */}
      <defs>
        <linearGradient id={`spark-grad-${data.length}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.15" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${points} ${width},${height}`}
        fill={`url(#spark-grad-${data.length})`}
      />
    </svg>
  );
}
