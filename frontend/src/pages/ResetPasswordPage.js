import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import api from '../services/apiService';
import { useDebug } from '../context/DebugContext';
import AuthLayout from '../components/AuthLayout';
import Button from '../components/Button';
import PasswordInput from '../components/PasswordInput';
import { colors, debugBanner, formLabel, inputFull, num } from '../styles/shared';

/**
 * Password reset page.
 * VULN: Reset token is predictable (timestamp-based).
 * VULN: Token leaked in API response.
 * VULN: Token never expires.
 */
function ResetPasswordPage() {
  const isDebug = useDebug();
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
        setToken(res.data.debug_token);
      }
      setStep('confirm');
      toast.success('If that email exists, a reset token is on its way');
    } catch (err) {
      setError(err.response?.data?.error || 'Reset request failed');
    }
  };

  const handleConfirmReset = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const res = await api.post('/api/auth/reset-confirm', { token, newPassword });
      setMessage(`${res.data.message} — you can now sign in with your new password.`);
      toast.success('Password reset');
    } catch (err) {
      setError(err.response?.data?.error || 'Reset failed');
    }
  };

  return (
    <AuthLayout
      title={step === 'request' ? 'Reset your password' : 'Choose a new password'}
      subtitle={step === 'request' ? "We'll send a reset token to your email." : 'Paste the token from your email.'}
      error={error}
      success={message}
    >
      {/* VULN: Debug token shown in UI */}
      {isDebug && debugToken && <div style={debugBanner}>Debug Token: {debugToken}</div>}

      {step === 'request' ? (
        <form onSubmit={handleRequestReset}>
          <div style={{ marginBottom: '22px' }}>
            <label htmlFor="reset-email" style={formLabel}>Email address</label>
            <input id="reset-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              placeholder="your@email.com" autoComplete="email" style={inputFull} />
          </div>
          <Button type="submit" variant="green" size="large">Send Reset Token</Button>
        </form>
      ) : (
        <form onSubmit={handleConfirmReset}>
          <div style={{ marginBottom: '14px' }}>
            <label htmlFor="reset-token" style={formLabel}>Reset token</label>
            <input id="reset-token" type="text" value={token} onChange={(e) => setToken(e.target.value)} required
              placeholder="Enter reset token" style={{ ...inputFull, ...num }} />
          </div>
          <div style={{ marginBottom: '22px' }}>
            <label htmlFor="reset-password" style={formLabel}>New password</label>
            <PasswordInput id="reset-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required
              placeholder="Enter new password" autoComplete="new-password" />
          </div>
          <div style={{ display: 'grid', gap: '8px' }}>
            <Button type="submit" variant="green" size="large">Reset Password</Button>
            <Button variant="gray" size="large" onClick={() => setStep('request')}>Back to Request</Button>
          </div>
        </form>
      )}
      <p style={{ marginTop: '24px', textAlign: 'center', fontSize: '13.5px', color: colors.textMuted }}>
        <Link to="/login" style={{ fontWeight: 600 }}>Back to sign in</Link>
      </p>
    </AuthLayout>
  );
}

export default ResetPasswordPage;
