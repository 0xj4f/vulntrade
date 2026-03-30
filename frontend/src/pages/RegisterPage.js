import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import AuthLayout from '../components/AuthLayout';
import { InputFull } from '../components/FormField';
import Button from '../components/Button';
import { colors, formLabel } from '../styles/shared';

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
  const { register } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // VULN: Client-side only validation - server doesn't enforce any of this
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (!email.includes('@')) {
      setError('Invalid email format');
      return;
    }

    try {
      await register(username, password, email);
      toast.success('Registration successful!');
    } catch (err) {
      const msg = err.response?.data?.error || 'Registration failed';
      setError(msg);
      toast.error(msg);
    }
  };

  return (
    <AuthLayout subtitle="Create your trading account" error={error}>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '20px' }}>
          <label style={formLabel}>Username</label>
          <InputFull
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            placeholder="Choose a username"
          />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={formLabel}>Email</label>
          <InputFull
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="your@email.com"
          />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={formLabel}>
            Password <span style={{ color: colors.textMuted, fontSize: '12px' }}>(min 6 chars)</span>
          </label>
          <InputFull
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}  // VULN: HTML5 validation only, server accepts "a"
            placeholder="Enter password"
          />
        </div>

        <div style={{ marginBottom: '28px' }}>
          <label style={formLabel}>Confirm Password</label>
          <InputFull
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            placeholder="Confirm password"
          />
        </div>

        {/* VULN: Hidden field - role not shown but API accepts it */}
        {/* An attacker can add role=ADMIN via DevTools or API call */}

        <Button type="submit" variant="green" size="large">
          Create Account
        </Button>
      </form>

      <div style={{
        borderTop: `1px solid ${colors.borderDefault}`,
        marginTop: '28px',
        paddingTop: '20px',
        textAlign: 'center',
      }}>
        <Link to="/login" style={{ color: colors.green, fontSize: '14px', textDecoration: 'none', fontWeight: '500' }}>
          Already have an account? Sign in
        </Link>
      </div>
    </AuthLayout>
  );
}

export default RegisterPage;
