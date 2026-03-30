import React from 'react';
import { authContainer, authCard, colors, errorBanner, successBanner } from '../styles/shared';

/**
 * Centered auth page layout (Login, Register, Reset Password).
 * @param {string} subtitle - text below the logo
 * @param {string} error - error message to display
 * @param {string} success - success message to display
 * @param {string} width - card width
 */
export default function AuthLayout({ subtitle, error, success, width = '400px', children }) {
  return (
    <div style={authContainer}>
      <div style={authCard(width)}>
        <h1 style={{ textAlign: 'center', color: colors.green, marginBottom: '8px' }}>
          ⚡ VulnTrade
        </h1>
        <p style={{ textAlign: 'center', color: colors.textMuted, marginBottom: '24px' }}>
          {subtitle}
        </p>

        {error && <div style={errorBanner}>{error}</div>}
        {success && <div style={successBanner}>{success}</div>}

        {children}
      </div>
    </div>
  );
}
