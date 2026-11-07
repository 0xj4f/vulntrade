import React from 'react';
import { BadgeCheck } from 'lucide-react';
import { levelBadge } from '../styles/shared';

/**
 * Account level pill. Level 1: "BASIC"; level 2: "VERIFIED" with a check.
 */
export default function VerificationBadge({ level = 1, size = 'default' }) {
  const isVerified = level >= 2;
  const style = { ...levelBadge(isVerified), ...(size === 'small' ? { fontSize: '10px', padding: '1px 7px' } : {}) };
  return (
    <span style={style}>
      {isVerified && <BadgeCheck size={size === 'small' ? 11 : 13} aria-hidden="true" />}
      {isVerified ? 'VERIFIED' : 'BASIC'}
    </span>
  );
}
