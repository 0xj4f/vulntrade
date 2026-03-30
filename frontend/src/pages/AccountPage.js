import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/apiService';
import { sendMessage } from '../services/websocketService';
import { toast } from 'react-toastify';

import PageLayout from '../components/PageLayout';
import Card from '../components/Card';
import Button from '../components/Button';
import FormField, { Input } from '../components/FormField';
import Modal from '../components/Modal';
import StatCard from '../components/StatCard';
import JsonPreview from '../components/JsonPreview';
import { colors, flexRow, flexRowWrap, gridCols, lineHeight2, codeInline, smallText } from '../styles/shared';

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
    if (user?.userId) {
      // VULN: userId passed in URL - changeable
      api.get(`/api/users/${user.userId}`)
        .then(res => setProfile(res.data))
        .catch(err => console.error('Failed to fetch profile:', err));
      api.get('/api/accounts/balance')
        .then(res => setBalance(res.data))
        .catch(err => console.error('Failed to fetch balance:', err));
    }
  }, [user]);

  const handleChangePassword = async (e) => {
    e.preventDefault();
    try {
      // VULN: No old password required
      await api.put('/api/auth/change-password', { newPassword });
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
      await api.put(`/api/users/${user.userId}`, { email: newEmail });
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
      api.get('/api/accounts/balance').then(r => setBalance(r.data));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Withdraw failed');
      setShow2FA(false);
      setPendingAction(null);
    }
  };

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
    if (twoFACode.length >= 1) {
      if (pendingAction === 'withdraw') handleWithdraw();
      setTwoFACode('');
    } else {
      toast.error('Enter a 2FA code (any value works - it\'s decorative)');
    }
  };

  const close2FA = () => { setShow2FA(false); setPendingAction(null); setTwoFACode(''); };

  return (
    <PageLayout title="Account Settings" maxWidth="800px">

      {/* Profile Info */}
      <Card title="Profile">
        {profile && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {[
              { label: 'User ID', value: profile.id, color: colors.textPrimary },
              { label: 'Username', value: profile.username, color: colors.textPrimary },
              { label: 'Email', value: profile.email, color: colors.textSecondary },
              { label: 'Role', value: profile.role, color: profile.role === 'ADMIN' ? colors.red : colors.blue },
              { label: 'Balance', value: `$${Number(profile.balance).toLocaleString()}`, color: colors.green },
              { label: 'API Key', value: profile.apiKey, color: colors.amber, mono: true },
            ].map(({ label, value, color, mono }) => (
              <div key={label} style={{ padding: '12px 16px', borderRadius: '10px', backgroundColor: colors.bgStat, border: `1px solid ${colors.borderDefault}` }}>
                <div style={{ fontSize: '11px', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: '600', marginBottom: '4px' }}>{label}</div>
                <div style={{ color, fontWeight: '600', fontSize: mono ? '12px' : '14px', fontFamily: mono ? "'SF Mono', monospace" : 'inherit', wordBreak: 'break-all' }}>{value}</div>
              </div>
            ))}
            {profile.notes && (
              <div style={{ gridColumn: '1 / -1', padding: '12px 16px', borderRadius: '10px', backgroundColor: colors.purpleDark, border: '1px solid rgba(139,92,246,0.2)' }}>
                <div style={{ fontSize: '11px', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: '600', marginBottom: '4px' }}>Notes</div>
                <div style={{ color: colors.purpleLight, fontSize: '13px' }}>{profile.notes}</div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Change Password - VULN: no old password required */}
      <Card title="Change Password" hint="⚠️ No old password verification required">
        <form onSubmit={handleChangePassword} style={{ display: 'flex', gap: '10px' }}>
          <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password" style={{ flex: 1 }} />
          <Button type="submit" variant="green">Change</Button>
        </form>
      </Card>

      {/* Change Email - VULN: no verification */}
      <Card title="Change Email" hint="⚠️ No email verification required">
        <form onSubmit={handleUpdateEmail} style={{ display: 'flex', gap: '10px' }}>
          <Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
            placeholder="New email address" style={{ flex: 1 }} />
          <Button type="submit" variant="blue">Update</Button>
        </form>
      </Card>

      {/* VULN: User Lookup (IDOR demonstration) */}
      <Card variant="danger" title="User Lookup (IDOR Test)" titleColor={colors.red}
        hint="Try looking up other user IDs (1 = admin, 2 = trader1, 3 = trader2)">
        <form onSubmit={handleLookupUser} style={{ display: 'flex', gap: '10px' }}>
          <Input type="number" value={lookupUserId} onChange={(e) => setLookupUserId(e.target.value)}
            placeholder="Enter User ID" min="1" style={{ flex: 1 }} />
          <Button type="submit" variant="red">Lookup</Button>
        </form>
        <JsonPreview data={lookupResult} />
      </Card>

      {/* Balance Display */}
      {balance && (
        <Card title="Account Balance">
          <div style={gridCols()}>
            <StatCard label="Available Balance"
              value={`$${Number(balance.balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
              valueColor={colors.green} valueSize="26px" />
            <StatCard label="Account Status" valueSize="16px"
              value={
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  padding: '3px 10px', borderRadius: '20px', fontSize: '13px', fontWeight: '600',
                  backgroundColor: balance.isActive ? colors.greenDark : colors.redDark,
                  color: balance.isActive ? colors.greenLight : colors.redLight,
                }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: balance.isActive ? colors.green : colors.red }} />
                  {balance.isActive ? 'Active' : 'Inactive'}
                </span>
              }>
              {/* VULN: Internal fields exposed */}
              <div style={smallText(colors.textDim)}>Role: {balance.role} | API Key: {balance.apiKey}</div>
              {balance.notes && <div style={smallText(colors.amber)}>Notes: {balance.notes}</div>}
            </StatCard>
          </div>
        </Card>
      )}

      {/* Withdraw - VULN: fake 2FA, sign flip, JS-only validation */}
      <Card title="Withdraw Funds" hint="⚠️ 2FA is decorative only. Try negative amounts (sign flip vuln).">
        <div style={flexRowWrap('10px')}>
          <FormField label="Amount">
            <Input type="number" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder="Amount to withdraw" min="0.01" step="0.01" width="180px" />
          </FormField>
          <FormField label="Destination">
            <Input type="text" value={withdrawDest} onChange={(e) => setWithdrawDest(e.target.value)}
              placeholder="Bank account" width="200px" />
          </FormField>
          <Button variant="red" onClick={() => {
            const amt = parseFloat(withdrawAmount);
            if (isNaN(amt) || amt <= 0) { toast.error('Amount must be positive'); return; }
            if (amt > 100000) { toast.error('Maximum withdrawal is $100,000'); return; }
            setPendingAction('withdraw');
            setShow2FA(true);
          }}>Withdraw (with "2FA")</Button>
          <Button variant="darkRed" onClick={handleWithdrawWS}>Withdraw via WS (no 2FA)</Button>
        </div>
      </Card>

      {/* Deposit - VULN: no source verification */}
      <Card title="Deposit Funds" hint='⚠️ No source verification — deposit any amount from any "account"'>
        <div style={flexRowWrap('10px')}>
          <FormField label="Amount">
            <Input type="number" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)}
              placeholder="Amount to deposit" min="0.01" step="0.01" width="180px" />
          </FormField>
          <FormField label="Source Account">
            <Input type="text" value={depositSource} onChange={(e) => setDepositSource(e.target.value)}
              placeholder="Any value works" width="200px" />
          </FormField>
          <Button variant="green" onClick={handleDeposit}>Deposit</Button>
        </div>
      </Card>

      {/* VULN: Fake 2FA Modal - purely decorative */}
      <Modal open={show2FA} onClose={close2FA}>
        <div style={{
          width: '48px', height: '48px', borderRadius: '14px',
          background: `linear-gradient(135deg, ${colors.amber}, #E09500)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '22px', margin: '0 auto 16px',
          boxShadow: '0 4px 16px rgba(255,170,0,0.25)',
        }}>🔐</div>
        <h3 style={{ color: colors.textPrimary, marginBottom: '8px', fontSize: '18px', fontWeight: '700' }}>Two-Factor Authentication</h3>
        <p style={{ color: colors.textSecondary, fontSize: '14px', marginBottom: '8px' }}>
          Enter the 6-digit code from your authenticator app
        </p>
        <p style={{ color: colors.red, fontSize: '11px', marginBottom: '20px' }}>
          (VULN: This is decorative - any value is accepted, code never sent to server)
        </p>
        <Input type="text" value={twoFACode} onChange={(e) => setTwoFACode(e.target.value)}
          placeholder="000000" maxLength="6"
          style={{
            width: '200px', textAlign: 'center', fontSize: '28px', letterSpacing: '10px',
            margin: '0 auto', display: 'block', fontFamily: "'SF Mono', monospace",
            padding: '14px',
          }} />
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '24px' }}>
          <Button variant="green" onClick={handleFake2FA}>Verify & Proceed</Button>
          <Button variant="gray" onClick={close2FA}>Cancel</Button>
        </div>
      </Modal>
    </PageLayout>
  );
}

export default AccountPage;
