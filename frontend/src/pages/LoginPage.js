import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import AuthLayout from '../components/AuthLayout';
import { InputFull } from '../components/FormField';
import Button from '../components/Button';
import { colors, formLabel } from '../styles/shared';

function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    try {
      await login(username, password);
      toast.success('Login successful!');
    } catch (err) {
      const msg = err.response?.data?.error || 'Authentication failed';
      setError(msg);
      toast.error(msg);
    }
  };

  return (
    <AuthLayout subtitle="Sign in to your trading account" error={error}>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '20px' }}>
          <label style={formLabel}>Username</label>
          {/* VULN: Error message from server displayed directly (user enumeration) */}
          <InputFull
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter username"
          />
        </div>

        <div style={{ marginBottom: '28px' }}>
          <label style={formLabel}>Password</label>
          <InputFull
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
          />
        </div>

        <Button type="submit" variant="green" size="large">
          Sign In
        </Button>
      </form>

      <div style={{
        borderTop: `1px solid ${colors.borderDefault}`,
        marginTop: '28px',
        paddingTop: '20px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}>
        <Link to="/register" style={{ color: colors.green, fontSize: '14px', textDecoration: 'none', fontWeight: '500' }}>
          Don't have an account? Register
        </Link>
        <Link to="/reset-password" style={{ color: colors.textMuted, fontSize: '13px', textDecoration: 'none' }}>
          Forgot password?
        </Link>
      </div>
    </AuthLayout>
  );
}

export default LoginPage;
