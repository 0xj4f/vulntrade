import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/apiService';
import { toast } from 'react-toastify';
import AuthLayout from '../components/AuthLayout';
import { InputFull } from '../components/FormField';
import Button from '../components/Button';
import { colors, formLabel, debugBanner } from '../styles/shared';

/**
 * Password reset page.
 * VULN: Reset token is predictable (timestamp-based).
 * VULN: Token leaked in API response.
 * VULN: Token never expires.
 */
function ResetPasswordPage() {
  const [step, setStep] = useState('request'); // request | confirm
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [debugToken, setDebugToken] = useState('');

  const handleRequestReset = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    try {
      const res = await api.post('/api/auth/reset', { email });
      setMessage(res.data.message);
      // VULN: Debug token returned in response
      if (res.data.debug_token) {
        setDebugToken(res.data.debug_token);
        setToken(res.data.debug_token);  // Auto-fill for convenience
      }
      setStep('confirm');
      toast.success('Reset link sent (check response)');
    } catch (err) {
      setError(err.response?.data?.error || 'Reset request failed');
    }
  };

  const handleConfirmReset = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    try {
      const res = await api.post('/api/auth/reset-confirm', {
        token: token,
        newPassword: newPassword
      });
      setMessage(res.data.message + ' - You can now login with your new password.');
      toast.success('Password reset successful!');
    } catch (err) {
      setError(err.response?.data?.error || 'Reset failed');
    }
  };

  return (
    <AuthLayout
      subtitle={step === 'request' ? 'Reset your password' : 'Set a new password'}
      error={error}
      success={message}
      width="440px"
    >
      {/* VULN: Debug token shown in UI */}
      {debugToken && (
        <div style={debugBanner}>Debug Token: {debugToken}</div>
      )}

      {step === 'request' ? (
        <form onSubmit={handleRequestReset}>
          <div style={{ marginBottom: '28px' }}>
            <label style={formLabel}>Email Address</label>
            <InputFull
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="your@email.com"
            />
          </div>

          <Button type="submit" variant="green" size="large">
            Send Reset Token
          </Button>
        </form>
      ) : (
        <form onSubmit={handleConfirmReset}>
          <div style={{ marginBottom: '20px' }}>
            <label style={formLabel}>Reset Token</label>
            <InputFull
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
              style={{ fontFamily: "'SF Mono', 'Fira Code', monospace", letterSpacing: '0.05em' }}
              placeholder="Enter reset token"
            />
          </div>

          <div style={{ marginBottom: '28px' }}>
            <label style={formLabel}>New Password</label>
            <InputFull
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              placeholder="Enter new password"
            />
          </div>

          <Button type="submit" variant="green" size="large">
            Reset Password
          </Button>

          <Button
            variant="gray"
            size="large"
            onClick={() => setStep('request')}
            style={{ marginTop: '10px', fontSize: '14px' }}
          >
            Back to Request
          </Button>
        </form>
      )}

      <div style={{
        borderTop: `1px solid ${colors.borderDefault}`,
        marginTop: '28px',
        paddingTop: '20px',
        textAlign: 'center',
      }}>
        <Link to="/login" style={{ color: colors.green, fontSize: '14px', textDecoration: 'none', fontWeight: '500' }}>
          Back to Sign In
        </Link>
      </div>
    </AuthLayout>
  );
}

export default ResetPasswordPage;
