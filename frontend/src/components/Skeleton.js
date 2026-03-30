import React from 'react';

/**
 * Skeleton loading placeholder.
 * Uses CSS animation from index.html (.skeleton class).
 *
 * @param {string} width - width of skeleton
 * @param {string} height - height of skeleton
 * @param {string} borderRadius - border radius
 * @param {number} count - number of skeleton rows
 * @param {string} gap - gap between rows
 */
export default function Skeleton({
  width = '100%',
  height = '16px',
  borderRadius = '8px',
  count = 1,
  gap = '10px',
  style = {},
}) {
  if (count === 1) {
    return (
      <div
        className="skeleton"
        style={{ width, height, borderRadius, ...style }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="skeleton"
          style={{
            width: i === count - 1 ? '60%' : width,
            height,
            borderRadius,
            ...style,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Skeleton card — mimics a Card with loading content.
 */
export function SkeletonCard({ lines = 3, style = {} }) {
  return (
    <div style={{
      backgroundColor: '#111D35',
      padding: '24px',
      borderRadius: '14px',
      border: '1px solid #1E2D45',
      marginBottom: '20px',
      ...style,
    }}>
      <Skeleton width="140px" height="14px" style={{ marginBottom: '16px' }} />
      <Skeleton count={lines} height="12px" />
    </div>
  );
}
