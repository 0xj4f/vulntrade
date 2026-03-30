import React from 'react';
import { authContainer, authCard, colors, errorBanner, successBanner } from '../styles/shared';

/**
 * Centered auth page layout (Login, Register, Reset Password).
 * @param {string} subtitle - text below the logo
 * @param {string} error - error message to display
 * @param {string} success - success message to display
 * @param {string} width - card width
 */
export default function AuthLayout({ subtitle, error, success, width = '420px', children }) {
  return (
    <div style={authContainer}>
      <div style={authCard(width)}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '14px',
            background: `linear-gradient(135deg, ${colors.green}, #00B87A)`,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '22px',
            marginBottom: '16px',
            boxShadow: `0 4px 16px rgba(0,214,143,0.25)`,
          }}>
            ⚡
          </div>
          <h1 style={{
            color: colors.textPrimary,
            marginBottom: '6px',
            fontSize: '22px',
            fontWeight: '700',
            letterSpacing: '-0.02em',
          }}>
            VulnTrade
          </h1>
          <p style={{ color: colors.textMuted, fontSize: '14px' }}>
            {subtitle}
          </p>
        </div>

        {error && <div style={errorBanner}>{error}</div>}
        {success && <div style={successBanner}>{success}</div>}

        {children}
      </div>
    </div>
  );
}
