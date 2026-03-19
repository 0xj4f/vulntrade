import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';

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
    <div style={{
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      minHeight: '100vh', backgroundColor: '#0a0e17'
    }}>
      <div style={{
        backgroundColor: '#111827', padding: '40px', borderRadius: '12px',
        width: '400px', border: '1px solid #1f2937'
      }}>
        <h1 style={{ textAlign: 'center', color: '#10b981', marginBottom: '8px' }}>
          ⚡ VulnTrade
        </h1>
        <p style={{ textAlign: 'center', color: '#6b7280', marginBottom: '24px' }}>
          Create Account
        </p>

        {error && (
          <div style={{
            backgroundColor: '#7f1d1d', color: '#fca5a5', padding: '10px',
            borderRadius: '6px', marginBottom: '16px', fontSize: '14px'
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', color: '#9ca3af', marginBottom: '4px', fontSize: '14px' }}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              style={{
                width: '100%', padding: '10px', backgroundColor: '#1f2937',
                border: '1px solid #374151', borderRadius: '6px', color: '#e5e7eb',
                boxSizing: 'border-box'
              }}
              placeholder="Choose a username"
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', color: '#9ca3af', marginBottom: '4px', fontSize: '14px' }}>
              Email
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

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', color: '#9ca3af', marginBottom: '4px', fontSize: '14px' }}>
              Password <span style={{ color: '#6b7280' }}>(min 6 chars)</span>
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}  // VULN: HTML5 validation only, server accepts "a"
              style={{
                width: '100%', padding: '10px', backgroundColor: '#1f2937',
                border: '1px solid #374151', borderRadius: '6px', color: '#e5e7eb',
                boxSizing: 'border-box'
              }}
              placeholder="Enter password"
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', color: '#9ca3af', marginBottom: '4px', fontSize: '14px' }}>
              Confirm Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              style={{
                width: '100%', padding: '10px', backgroundColor: '#1f2937',
                border: '1px solid #374151', borderRadius: '6px', color: '#e5e7eb',
                boxSizing: 'border-box'
              }}
              placeholder="Confirm password"
            />
          </div>

          {/* VULN: Hidden field - role not shown but API accepts it */}
          {/* An attacker can add role=ADMIN via DevTools or API call */}

          <button type="submit" style={{
            width: '100%', padding: '12px', backgroundColor: '#10b981',
            border: 'none', borderRadius: '6px', color: 'white',
            fontSize: '16px', fontWeight: 'bold', cursor: 'pointer'
          }}>
            Register
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '14px' }}>
          <Link to="/login" style={{ color: '#10b981' }}>
            Already have an account? Login
          </Link>
        </div>
      </div>
    </div>
  );
}

export default RegisterPage;
