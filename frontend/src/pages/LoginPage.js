import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useAuth } from '../context/AuthContext';
import AuthLayout from '../components/AuthLayout';
import Button from '../components/Button';
import PasswordInput from '../components/PasswordInput';
import { colors, formLabel, inputFull } from '../styles/shared';

function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { login } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username, password);
      toast.success(`Welcome back, ${username}`);
    } catch (err) {
      // VULN: Error message from server displayed directly (user enumeration)
      const msg = err.response?.data?.error || 'Authentication failed';
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Sign in" subtitle="Welcome back — the markets are open." error={error}>
      <form onSubmit={handleSubmit} noValidate>
        <div style={{ marginBottom: '16px' }}>
          <label htmlFor="login-username" style={formLabel}>Username</label>
          <input id="login-username" type="text" value={username} onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter username" autoComplete="username" autoFocus style={inputFull} />
        </div>
        <div style={{ marginBottom: '8px' }}>
          <label htmlFor="login-password" style={formLabel}>Password</label>
          <PasswordInput id="login-password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password" autoComplete="current-password" />
        </div>
        <div style={{ textAlign: 'right', marginBottom: '20px' }}>
          <Link to="/reset-password" style={{ fontSize: '12.5px', color: colors.textMuted }}>Forgot password?</Link>
        </div>
        <Button type="submit" variant="green" size="large" loading={busy}>Sign In</Button>
      </form>
      <p style={{ marginTop: '24px', textAlign: 'center', fontSize: '13.5px', color: colors.textMuted }}>
        New here? <Link to="/register" style={{ fontWeight: 600 }}>Create an account</Link>
      </p>
    </AuthLayout>
  );
}

export default LoginPage;
