import React from 'react';
import { cardStyle } from '../styles/shared';

/** Shimmer placeholder block. */
export default function Skeleton({ width = '100%', height = '14px', radius = '6px', style = {} }) {
  return <div className="skeleton" aria-hidden="true" style={{ width, height, borderRadius: radius, ...style }} />;
}

/** Card-shaped placeholder with a few lines. */
export function SkeletonCard({ lines = 3, style = {} }) {
  return (
    <div style={{ ...cardStyle, ...style }} aria-busy="true" aria-label="Loading">
      <Skeleton width="40%" height="12px" style={{ marginBottom: '14px' }} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={`${90 - i * 12}%`} style={{ marginBottom: '10px' }} />
      ))}
    </div>
  );
}
