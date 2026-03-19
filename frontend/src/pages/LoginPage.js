import React, { useState } from 'react';
import api from '../services/apiService';
import { toast } from 'react-toastify';

function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    try {
      if (isRegister) {
        const res = await api.post('/api/auth/register', {
          username, password, email
        });
        onLogin(res.data.token, {
          userId: res.data.userId,
          username: res.data.username,
          role: res.data.role
        });
        toast.success('Registration successful!');
      } else {
        const res = await api.post('/api/auth/login', {
          username, password
        });
        onLogin(res.data.token, {
          userId: res.data.userId,
          username: res.data.username,
          role: res.data.role,
          balance: res.data.balance
        });
        toast.success('Login successful!');
      }
    } catch (err) {
      const msg = err.response?.data?.error || 'Authentication failed';
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
          {isRegister ? 'Create Account' : 'Sign In to Trade'}
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
              style={{
                width: '100%', padding: '10px', backgroundColor: '#1f2937',
                border: '1px solid #374151', borderRadius: '6px', color: '#e5e7eb',
                boxSizing: 'border-box'
              }}
              placeholder="Enter username"
            />
          </div>

          {isRegister && (
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', color: '#9ca3af', marginBottom: '4px', fontSize: '14px' }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  width: '100%', padding: '10px', backgroundColor: '#1f2937',
                  border: '1px solid #374151', borderRadius: '6px', color: '#e5e7eb',
                  boxSizing: 'border-box'
                }}
                placeholder="Enter email"
              />
            </div>
          )}

          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', color: '#9ca3af', marginBottom: '4px', fontSize: '14px' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: '100%', padding: '10px', backgroundColor: '#1f2937',
                border: '1px solid #374151', borderRadius: '6px', color: '#e5e7eb',
                boxSizing: 'border-box'
              }}
              placeholder="Enter password"
            />
          </div>

          <button type="submit" style={{
            width: '100%', padding: '12px', backgroundColor: '#10b981',
            border: 'none', borderRadius: '6px', color: 'white',
            fontSize: '16px', fontWeight: 'bold', cursor: 'pointer'
          }}>
            {isRegister ? 'Register' : 'Login'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: '16px', color: '#6b7280', fontSize: '14px' }}>
          <span onClick={() => setIsRegister(!isRegister)} style={{ color: '#10b981', cursor: 'pointer' }}>
            {isRegister ? 'Already have an account? Login' : "Don't have an account? Register"}
          </span>
        </p>
      </div>
    </div>
  );
}

export default LoginPage;
