import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useAuth } from '../context/AuthContext';
import AuthLayout from '../components/AuthLayout';
import Button from '../components/Button';
import PasswordInput from '../components/PasswordInput';
import { colors, formLabel, inputFull } from '../styles/shared';

/**
 * VULN: Client-side only validation.
 * - Min password length checked in JS only (server accepts anything)
 * - No email format validation on server
 * - Mass assignment possible (role field not shown but accepted by API)
 */
function RegisterPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { register } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    // VULN: Client-side only validation - server doesn't enforce any of this
    if (!username.trim()) { setError('Choose a username'); return; }
    if (!email.includes('@')) { setError('Enter a valid email address'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    setBusy(true);
    try {
      await register(username, password, email);
      toast.success('Account created — you start with $10,000 to trade');
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Create your account" subtitle="Start with $10,000 in simulated cash." error={error}>
      <form onSubmit={handleSubmit} noValidate>
        <div style={{ marginBottom: '14px' }}>
          <label htmlFor="reg-username" style={formLabel}>Username</label>
          <input id="reg-username" type="text" value={username} onChange={(e) => setUsername(e.target.value)} required
            placeholder="Choose a username" autoComplete="username" autoFocus style={inputFull} />
        </div>
        <div style={{ marginBottom: '14px' }}>
          <label htmlFor="reg-email" style={formLabel}>Email</label>
          <input id="reg-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
            placeholder="your@email.com" autoComplete="email" style={inputFull} />
        </div>
        <div style={{ marginBottom: '14px' }}>
          <label htmlFor="reg-password" style={formLabel}>Password <span style={{ color: colors.textMuted, fontWeight: 400 }}>· 6+ characters</span></label>
          {/* VULN: HTML5/JS validation only, server accepts "a" */}
          <PasswordInput id="reg-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
            placeholder="Enter password" autoComplete="new-password" />
        </div>
        <div style={{ marginBottom: '22px' }}>
          <label htmlFor="reg-confirm" style={formLabel}>Confirm password</label>
          <PasswordInput id="reg-confirm" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required
            placeholder="Confirm password" autoComplete="new-password" />
        </div>
        {/* VULN: role not shown but the API accepts it (mass assignment) */}
        <Button type="submit" variant="green" size="large" loading={busy}>Create Account</Button>
      </form>
      <p style={{ marginTop: '24px', textAlign: 'center', fontSize: '13.5px', color: colors.textMuted }}>
        Already trading? <Link to="/login" style={{ fontWeight: 600 }}>Sign in</Link>
      </p>
    </AuthLayout>
  );
}

export default RegisterPage;
