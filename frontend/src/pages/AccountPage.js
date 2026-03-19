import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/apiService';
import { toast } from 'react-toastify';

/**
 * Account page.
 * VULN: Password change without old password verification.
 * VULN: Email change without verification.
 * VULN: User ID in API calls (changeable via DevTools).
 */
function AccountPage() {
  const { user, token } = useAuth();
  const [profile, setProfile] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [lookupUserId, setLookupUserId] = useState('');
  const [lookupResult, setLookupResult] = useState(null);

  useEffect(() => {
    // Fetch own profile
    if (user?.userId) {
      // VULN: userId passed in URL - changeable
      api.get(`/api/users/${user.userId}`)
        .then(res => setProfile(res.data))
        .catch(err => console.error('Failed to fetch profile:', err));
    }
  }, [user]);

  const handleChangePassword = async (e) => {
    e.preventDefault();
    try {
      // VULN: No old password required
      await api.put('/api/auth/change-password', {
        newPassword: newPassword
        // Note: oldPassword field is NOT sent (server doesn't check it anyway)
      });
      toast.success('Password changed! (old tokens still valid)');
      setNewPassword('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to change password');
    }
  };

  const handleUpdateEmail = async (e) => {
    e.preventDefault();
    try {
      // VULN: Email change without verification, IDOR possible
      await api.put(`/api/users/${user.userId}`, {
        email: newEmail
      });
      toast.success('Email updated (no verification needed)');
      setNewEmail('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update email');
    }
  };

  // VULN: User lookup - demonstrates IDOR
  const handleLookupUser = async (e) => {
    e.preventDefault();
    try {
      const res = await api.get(`/api/users/${lookupUserId}`);
      setLookupResult(res.data);
    } catch (err) {
      toast.error('User not found');
      setLookupResult(null);
    }
  };

  const inputStyle = {
    padding: '10px', backgroundColor: '#1f2937',
    border: '1px solid #374151', borderRadius: '6px', color: '#e5e7eb',
    boxSizing: 'border-box', width: '100%'
  };

  const cardStyle = {
    backgroundColor: '#111827', padding: '20px', borderRadius: '8px',
    marginBottom: '20px', border: '1px solid #1f2937'
  };

  return (
    <div style={{ padding: '24px', maxWidth: '800px', margin: '0 auto' }}>
      <h2 style={{ color: '#10b981', marginBottom: '24px' }}>Account Settings</h2>

      {/* Profile Info */}
      <div style={cardStyle}>
        <h3 style={{ color: '#9ca3af', marginBottom: '12px' }}>Profile</h3>
        {profile && (
          <div style={{ lineHeight: '2', fontSize: '14px' }}>
            <p>User ID: <strong>{profile.id}</strong></p>
            <p>Username: <strong>{profile.username}</strong></p>
            <p>Email: <strong>{profile.email}</strong></p>
            <p>Role: <strong>{profile.role}</strong></p>
            <p>Balance: <strong style={{ color: '#10b981' }}>
              ${Number(profile.balance).toLocaleString()}
            </strong></p>
            <p>API Key: <code style={{ color: '#f59e0b', fontSize: '12px' }}>
              {profile.apiKey}
            </code></p>
            {profile.notes && (
              <p>Notes: <span style={{ color: '#6b7280' }}>{profile.notes}</span></p>
            )}
          </div>
        )}
      </div>

      {/* Change Password - VULN: no old password required */}
      <div style={cardStyle}>
        <h3 style={{ color: '#9ca3af', marginBottom: '12px' }}>Change Password</h3>
        <p style={{ color: '#6b7280', fontSize: '12px', marginBottom: '12px' }}>
          ⚠️ No old password verification required
        </p>
        <form onSubmit={handleChangePassword} style={{ display: 'flex', gap: '8px' }}>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button type="submit" style={{
            padding: '10px 20px', backgroundColor: '#10b981',
            border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer'
          }}>
            Change
          </button>
        </form>
      </div>

      {/* Change Email - VULN: no verification */}
      <div style={cardStyle}>
        <h3 style={{ color: '#9ca3af', marginBottom: '12px' }}>Change Email</h3>
        <p style={{ color: '#6b7280', fontSize: '12px', marginBottom: '12px' }}>
          ⚠️ No email verification required
        </p>
        <form onSubmit={handleUpdateEmail} style={{ display: 'flex', gap: '8px' }}>
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="New email address"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button type="submit" style={{
            padding: '10px 20px', backgroundColor: '#3b82f6',
            border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer'
          }}>
            Update
          </button>
        </form>
      </div>

      {/* VULN: User Lookup (IDOR demonstration) */}
      <div style={{ ...cardStyle, border: '1px solid #7f1d1d' }}>
        <h3 style={{ color: '#ef4444', marginBottom: '12px' }}>🔍 User Lookup (IDOR Test)</h3>
        <p style={{ color: '#6b7280', fontSize: '12px', marginBottom: '12px' }}>
          Try looking up other user IDs (1 = admin, 2 = trader1, 3 = trader2)
        </p>
        <form onSubmit={handleLookupUser} style={{ display: 'flex', gap: '8px' }}>
          <input
            type="number"
            value={lookupUserId}
            onChange={(e) => setLookupUserId(e.target.value)}
            placeholder="User ID"
            min="1"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button type="submit" style={{
            padding: '10px 20px', backgroundColor: '#ef4444',
            border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer'
          }}>
            Lookup
          </button>
        </form>
        {lookupResult && (
          <pre style={{
            marginTop: '12px', padding: '12px', backgroundColor: '#0f172a',
            borderRadius: '6px', fontSize: '12px', overflow: 'auto',
            color: '#a5b4fc', maxHeight: '300px'
          }}>
            {JSON.stringify(lookupResult, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

export default AccountPage;
