import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/apiService';
import { toast } from 'react-toastify';

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
    <div style={{
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      minHeight: '100vh', backgroundColor: '#0a0e17'
    }}>
      <div style={{
        backgroundColor: '#111827', padding: '40px', borderRadius: '12px',
        width: '440px', border: '1px solid #1f2937'
      }}>
        <h1 style={{ textAlign: 'center', color: '#10b981', marginBottom: '8px' }}>
          ⚡ VulnTrade
        </h1>
        <p style={{ textAlign: 'center', color: '#6b7280', marginBottom: '24px' }}>
          {step === 'request' ? 'Reset Password' : 'Set New Password'}
        </p>

        {error && (
          <div style={{
            backgroundColor: '#7f1d1d', color: '#fca5a5', padding: '10px',
            borderRadius: '6px', marginBottom: '16px', fontSize: '14px'
          }}>
            {error}
          </div>
        )}

        {message && (
          <div style={{
            backgroundColor: '#064e3b', color: '#6ee7b7', padding: '10px',
            borderRadius: '6px', marginBottom: '16px', fontSize: '14px'
          }}>
            {message}
          </div>
        )}

        {/* VULN: Debug token shown in UI */}
        {debugToken && (
          <div style={{
            backgroundColor: '#1e1b4b', color: '#a5b4fc', padding: '10px',
            borderRadius: '6px', marginBottom: '16px', fontSize: '12px',
            fontFamily: 'monospace'
          }}>
            Debug Token: {debugToken}
          </div>
        )}

        {step === 'request' ? (
          <form onSubmit={handleRequestReset}>
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', color: '#9ca3af', marginBottom: '4px', fontSize: '14px' }}>
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{
                  width: '100%', padding: '10px', backgroundColor: '#1f2937',
                  border: '1px solid #374151', borderRadius: '6px', color: '#e5e7eb',
                  boxSizing: 'border-box'
                }}
                placeholder="your@email.com"
              />
            </div>

            <button type="submit" style={{
              width: '100%', padding: '12px', backgroundColor: '#10b981',
              border: 'none', borderRadius: '6px', color: 'white',
              fontSize: '16px', fontWeight: 'bold', cursor: 'pointer'
            }}>
              Send Reset Token
            </button>
          </form>
        ) : (
          <form onSubmit={handleConfirmReset}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', color: '#9ca3af', marginBottom: '4px', fontSize: '14px' }}>
                Reset Token
              </label>
              <input
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
                style={{
                  width: '100%', padding: '10px', backgroundColor: '#1f2937',
                  border: '1px solid #374151', borderRadius: '6px', color: '#e5e7eb',
                  boxSizing: 'border-box', fontFamily: 'monospace'
                }}
                placeholder="Enter reset token"
              />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', color: '#9ca3af', marginBottom: '4px', fontSize: '14px' }}>
                New Password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                style={{
                  width: '100%', padding: '10px', backgroundColor: '#1f2937',
                  border: '1px solid #374151', borderRadius: '6px', color: '#e5e7eb',
                  boxSizing: 'border-box'
                }}
                placeholder="Enter new password"
              />
            </div>

            <button type="submit" style={{
              width: '100%', padding: '12px', backgroundColor: '#10b981',
              border: 'none', borderRadius: '6px', color: 'white',
              fontSize: '16px', fontWeight: 'bold', cursor: 'pointer'
            }}>
              Reset Password
            </button>

            <button
              type="button"
              onClick={() => setStep('request')}
              style={{
                width: '100%', padding: '12px', backgroundColor: '#374151',
                border: 'none', borderRadius: '6px', color: '#9ca3af',
                fontSize: '14px', cursor: 'pointer', marginTop: '8px'
              }}
            >
              Back to Request
            </button>
          </form>
        )}

        <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '14px' }}>
          <Link to="/login" style={{ color: '#10b981' }}>
            Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}

export default ResetPasswordPage;
