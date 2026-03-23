import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/apiService';
import { sendMessage } from '../services/websocketService';
import { toast } from 'react-toastify';

/**
 * PHASE 6 VULNS:
 * - VULN: Password change without old password verification
 * - VULN: Email change without verification
 * - VULN: User ID in API calls (changeable via DevTools) → IDOR
 * - VULN: 2FA modal is purely decorative (no server verification)
 * - VULN: Amount validation in JS only (server accepts anything)
 * - VULN: Negative withdraw amount = deposit (sign flip)
 * - VULN: Deposit with no source verification (free money)
 */
function AccountPage() {
  const { user, token } = useAuth();
  const [profile, setProfile] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [lookupUserId, setLookupUserId] = useState('');
  const [lookupResult, setLookupResult] = useState(null);
  // Deposit/Withdraw state
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawDest, setWithdrawDest] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [depositSource, setDepositSource] = useState('');
  // Fake 2FA state
  const [show2FA, setShow2FA] = useState(false);
  const [twoFACode, setTwoFACode] = useState('');
  const [pendingAction, setPendingAction] = useState(null);
  // Balance
  const [balance, setBalance] = useState(null);

  useEffect(() => {
    // Fetch own profile
    if (user?.userId) {
      // VULN: userId passed in URL - changeable
      api.get(`/api/users/${user.userId}`)
        .then(res => setProfile(res.data))
        .catch(err => console.error('Failed to fetch profile:', err));
      // Fetch balance
      api.get('/api/accounts/balance')
        .then(res => setBalance(res.data))
        .catch(err => console.error('Failed to fetch balance:', err));
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

  // VULN: Withdraw - sign flip, race condition, no real 2FA
  const handleWithdraw = async () => {
    try {
      const res = await api.post('/api/accounts/withdraw', {
        amount: parseFloat(withdrawAmount),
        destinationAccount: withdrawDest || 'external-bank-account'
      });
      toast.success(`Withdrawn: $${withdrawAmount}. New balance: $${res.data.newBalance}`);
      setWithdrawAmount('');
      setWithdrawDest('');
      setShow2FA(false);
      setPendingAction(null);
      // Refresh balance
      api.get('/api/accounts/balance').then(r => setBalance(r.data));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Withdraw failed');
      setShow2FA(false);
      setPendingAction(null);
    }
  };

  // Also try via WebSocket
  const handleWithdrawWS = () => {
    sendMessage('/app/trade.withdraw', {
      amount: parseFloat(withdrawAmount),
      destinationAccount: withdrawDest || 'external-bank-account'
    });
    toast.info('Withdraw request sent via WebSocket');
    setWithdrawAmount('');
  };

  // VULN: Deposit - no source verification (free money)
  const handleDeposit = async () => {
    try {
      const res = await api.post('/api/accounts/deposit', {
        amount: parseFloat(depositAmount),
        sourceAccount: depositSource || 'fake-bank-account-12345'
      });
      toast.success(`Deposited: $${depositAmount}. New balance: $${res.data.newBalance}`);
      setDepositAmount('');
      setDepositSource('');
      api.get('/api/accounts/balance').then(r => setBalance(r.data));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Deposit failed');
    }
  };

  // VULN: Fake 2FA - purely decorative, always succeeds
  const handleFake2FA = () => {
    // VULN: 2FA code is never sent to server - just a UI gate
    if (twoFACode.length >= 1) {
      // Execute the pending action without any server-side 2FA check
      if (pendingAction === 'withdraw') {
        handleWithdraw();
      }
      setTwoFACode('');
    } else {
      toast.error('Enter a 2FA code (any value works - it\'s decorative)');
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

      {/* Balance Display */}
      {balance && (
        <div style={cardStyle}>
          <h3 style={{ color: '#9ca3af', marginBottom: '12px' }}>Account Balance</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div style={{ padding: '16px', background: '#0f172a', borderRadius: '8px' }}>
              <div style={{ color: '#6b7280', fontSize: '12px' }}>Available Balance</div>
              <div style={{ color: '#10b981', fontSize: '28px', fontWeight: 'bold' }}>
                ${Number(balance.balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div style={{ padding: '16px', background: '#0f172a', borderRadius: '8px' }}>
              <div style={{ color: '#6b7280', fontSize: '12px' }}>Account Status</div>
              <div style={{ color: '#e5e7eb', fontSize: '16px' }}>
                {balance.isActive ? '✅ Active' : '❌ Inactive'}
              </div>
              {/* VULN: Internal fields exposed */}
              <div style={{ color: '#4b5563', fontSize: '11px', marginTop: '4px' }}>
                Role: {balance.role} | API Key: {balance.apiKey}
              </div>
              {balance.notes && (
                <div style={{ color: '#f59e0b', fontSize: '11px', marginTop: '4px' }}>
                  Notes: {balance.notes}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Withdraw - VULN: fake 2FA, sign flip, JS-only validation */}
      <div style={cardStyle}>
        <h3 style={{ color: '#9ca3af', marginBottom: '12px' }}>💸 Withdraw Funds</h3>
        <p style={{ color: '#6b7280', fontSize: '12px', marginBottom: '12px' }}>
          ⚠️ 2FA is decorative only. Try negative amounts (sign flip vuln).
        </p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={{ color: '#6b7280', fontSize: '12px', display: 'block', marginBottom: '4px' }}>Amount</label>
            {/* VULN: Client-side only validation - server accepts negative */}
            <input
              type="number"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder="Amount to withdraw"
              min="0.01"
              step="0.01"
              style={{ ...inputStyle, width: '180px' }}
            />
          </div>
          <div>
            <label style={{ color: '#6b7280', fontSize: '12px', display: 'block', marginBottom: '4px' }}>Destination</label>
            <input
              type="text"
              value={withdrawDest}
              onChange={(e) => setWithdrawDest(e.target.value)}
              placeholder="Bank account"
              style={{ ...inputStyle, width: '200px' }}
            />
          </div>
          <button onClick={() => {
            // VULN: Client-side validation only
            const amt = parseFloat(withdrawAmount);
            if (isNaN(amt) || amt <= 0) {
              toast.error('Amount must be positive');
              return;
            }
            if (amt > 100000) {
              toast.error('Maximum withdrawal is $100,000');
              return;
            }
            // VULN: Show fake 2FA modal - purely decorative
            setPendingAction('withdraw');
            setShow2FA(true);
          }} style={{
            padding: '10px 20px', backgroundColor: '#ef4444',
            border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer'
          }}>
            Withdraw (with "2FA")
          </button>
          <button onClick={handleWithdrawWS} style={{
            padding: '10px 20px', backgroundColor: '#7f1d1d',
            border: 'none', borderRadius: '6px', color: '#fca5a5', cursor: 'pointer'
          }}>
            Withdraw via WS (no 2FA)
          </button>
        </div>
      </div>

      {/* Deposit - VULN: no source verification */}
      <div style={cardStyle}>
        <h3 style={{ color: '#9ca3af', marginBottom: '12px' }}>💰 Deposit Funds</h3>
        <p style={{ color: '#6b7280', fontSize: '12px', marginBottom: '12px' }}>
          ⚠️ No source verification - deposit any amount from any "account"
        </p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={{ color: '#6b7280', fontSize: '12px', display: 'block', marginBottom: '4px' }}>Amount</label>
            <input
              type="number"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder="Amount to deposit"
              min="0.01"
              step="0.01"
              style={{ ...inputStyle, width: '180px' }}
            />
          </div>
          <div>
            <label style={{ color: '#6b7280', fontSize: '12px', display: 'block', marginBottom: '4px' }}>Source Account</label>
            <input
              type="text"
              value={depositSource}
              onChange={(e) => setDepositSource(e.target.value)}
              placeholder="Any value works"
              style={{ ...inputStyle, width: '200px' }}
            />
          </div>
          <button onClick={handleDeposit} style={{
            padding: '10px 20px', backgroundColor: '#10b981',
            border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer'
          }}>
            Deposit
          </button>
        </div>
      </div>

      {/* VULN: Fake 2FA Modal - purely decorative */}
      {show2FA && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex',
          justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>
          <div style={{
            backgroundColor: '#1f2937', padding: '32px', borderRadius: '12px',
            border: '1px solid #374151', width: '400px', textAlign: 'center'
          }}>
            <h3 style={{ color: '#f59e0b', marginBottom: '16px' }}>🔐 Two-Factor Authentication</h3>
            <p style={{ color: '#9ca3af', fontSize: '14px', marginBottom: '16px' }}>
              Enter the 6-digit code from your authenticator app
            </p>
            <p style={{ color: '#ef4444', fontSize: '11px', marginBottom: '16px' }}>
              (VULN: This is decorative - any value is accepted, code never sent to server)
            </p>
            <input
              type="text"
              value={twoFACode}
              onChange={(e) => setTwoFACode(e.target.value)}
              placeholder="Enter 2FA code"
              maxLength="6"
              style={{
                ...inputStyle, width: '200px', textAlign: 'center',
                fontSize: '24px', letterSpacing: '8px', margin: '0 auto', display: 'block'
              }}
            />
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '20px' }}>
              <button onClick={handleFake2FA} style={{
                padding: '10px 24px', backgroundColor: '#10b981',
                border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer'
              }}>
                Verify & Proceed
              </button>
              <button onClick={() => { setShow2FA(false); setPendingAction(null); setTwoFACode(''); }} style={{
                padding: '10px 24px', backgroundColor: '#374151',
                border: 'none', borderRadius: '6px', color: '#e5e7eb', cursor: 'pointer'
              }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AccountPage;
