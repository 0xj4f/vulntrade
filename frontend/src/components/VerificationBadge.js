import React from 'react';
import { colors, levelBadge } from '../styles/shared';

/**
 * VerificationBadge — shows account level as a pill badge.
 * Level 1: gray "BASIC"
 * Level 2: green "VERIFIED" with checkmark
 *
 * Props:
 *  - level: 1 or 2
 *  - size: 'small' | 'default' (optional)
 */
export default function VerificationBadge({ level = 1, size = 'default' }) {
  const isVerified = level >= 2;
  const style = {
    ...levelBadge(isVerified),
    ...(size === 'small' ? { fontSize: '10px', padding: '2px 8px' } : {}),
  };

  return (
    <span style={style}>
      {isVerified ? (
        <>
          <span style={{ color: colors.green }}>&#10003;</span> VERIFIED
        </>
      ) : (
        'BASIC'
      )}
    </span>
  );
}
