import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, BadgeCheck, Camera, KeyRound, Lock, Mail, ShieldCheck, ZoomIn } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useDebug } from '../context/DebugContext';
import api from '../services/apiService';
import { sendMessage } from '../services/websocketService';
import { ACCOUNT_PRODUCTS, fetchAccounts } from '../services/accounts';
import { useStomp } from '../hooks/useStomp';
import PageLayout from '../components/PageLayout';
import Card from '../components/Card';
import Button from '../components/Button';
import FormField, { Input } from '../components/FormField';
import Modal from '../components/Modal';
import JsonPreview from '../components/JsonPreview';
import VerificationBadge from '../components/VerificationBadge';
import { Avatar, Chip, KV } from '../components/ui';
import { colors, num, progressBarFill, progressBarTrack, selectStyle, type } from '../styles/shared';
import { fmtDateShort, fmtQty, fmtUSD } from '../utils/format';

const CROP_SIZE = 280;
const DAILY_LIMIT = 100000;
const today = () => new Date().toISOString().split('T')[0];

/**
 * Account settings: profile & verification, security, funds, accounts & transfers.
 *
 * Deposits and withdrawals use the MAIN account; transfers move USD between the user's own
 * MAIN / FX / EQUITIES / CRYPTO accounts (POST /api/accounts/transfer).
 *
 * VULN (kept): password change without the old password; email change without verification;
 *   userId in API paths (IDOR lookup in debug); decorative 2FA (FE-14); JS-only amount checks
 *   (#80) — negative amounts reach the server (sign flip #78); deposits without source
 *   verification (#79); the $100k daily limit lives in localStorage only (FE-07/#99);
 *   SSN, notes and API key displayed (#100); any first name auto-verifies (BIZ-15).
 */
function AccountPage() {
  const { user, getAccountLevel, isVerified, refreshToken, refreshUser, updatePhoto } = useAuth();
  const isDebug = useDebug();
  const userId = user?.userId || user?.id;
  const [profile, setProfile] = useState(null);
  const [balance, setBalance] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [lookupUserId, setLookupUserId] = useState('');
  const [lookupResult, setLookupResult] = useState(null);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawDest, setWithdrawDest] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [depositSource, setDepositSource] = useState('');
  const [show2FA, setShow2FA] = useState(false);
  const [twoFACode, setTwoFACode] = useState('');
  const [busy, setBusy] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [transfer, setTransfer] = useState({ from: 'MAIN', to: 'EQUITIES', amount: '' });
  const [transferError, setTransferError] = useState(null);
  const [profileForm, setProfileForm] = useState({
    firstName: '', lastName: '', dateOfBirth: '', phoneNumber: '',
    ssn: '', addressLine1: '', addressLine2: '', city: '', state: '', zipCode: '', country: '',
  });
  const [photoPreview, setPhotoPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [showCropModal, setShowCropModal] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState(null);
  const [naturalSize, setNaturalSize] = useState({ w: 1, h: 1 });
  const [cropOffset, setCropOffset] = useState({ x: 0, y: 0 });
  const [cropZoom, setCropZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef(null);
  const cropRef = useRef(null);
  const fileRef = useRef(null);
  const wsPending = useRef(false);

  // VULN #99: Daily limit tracked in localStorage only
  const [dailyWithdrawn, setDailyWithdrawn] = useState(() => {
    const stored = localStorage.getItem('dailyWithdrawn');
    const storedDate = localStorage.getItem('dailyWithdrawnDate');
    if (storedDate === today() && stored) return parseFloat(stored);
    return 0;
  });

  const loadBalance = useCallback(() => api.get('/api/accounts/balance').then(r => setBalance(r.data)).catch(() => {}), []);
  const loadAccounts = useCallback(() => fetchAccounts().then(setAccounts).catch(() => {}), []);

  // Load the profile once per user (not on every balance refresh — that used to wipe edits).
  useEffect(() => {
    if (!userId) return;
    // VULN: userId passed in URL - changeable
    api.get(`/api/users/${userId}`)
      .then(res => {
        setProfile(res.data);
        setProfileForm(prev => ({
          ...prev,
          firstName: res.data.firstName || '', lastName: res.data.lastName || '',
          dateOfBirth: res.data.dateOfBirth || '', phoneNumber: res.data.phoneNumber || '',
          ssn: res.data.ssn || '', addressLine1: res.data.addressLine1 || '', addressLine2: res.data.addressLine2 || '',
          city: res.data.city || '', state: res.data.state || '', zipCode: res.data.zipCode || '', country: res.data.country || '',
        }));
        setPhotoPreview(p => p || user?.photoUrl || res.data.profilePic || (res.data.photoPath ? `/api/users/${userId}/photo` : null));
      })
      .catch(err => console.error('Failed to fetch profile:', err));
    loadBalance();
    loadAccounts();
  }, [userId]); // eslint-disable-line

  const afterMoneyMove = () => {
    loadBalance();
    loadAccounts();
    refreshUser && refreshUser();
  };

  // "Quick Withdraw" goes over the WebSocket; show its result.
  useStomp('/user/queue/balance', (reply) => {
    afterMoneyMove();
    if (reply?.type === 'WITHDRAW_SUCCESS') toast.success(`Withdrawn via WebSocket. New balance ${fmtUSD(reply.newBalance)}`);
    else if (reply?.type === 'DEPOSIT_SUCCESS') toast.success(`Deposited via WebSocket. New balance ${fmtUSD(reply.newBalance)}`);
    wsPending.current = false;
  });
  useStomp('/user/queue/errors', (err) => {
    if (!wsPending.current) return;
    wsPending.current = false;
    toast.error(err?.message || 'Request failed');
  });

  // ── Security ──
  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (!newPassword) return;
    try {
      // VULN: No old password required
      await api.put('/api/auth/change-password', { newPassword });
      toast.success('Password changed (existing sessions stay signed in)');
      setNewPassword('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to change password');
    }
  };

  const handleUpdateEmail = async (e) => {
    e.preventDefault();
    if (!newEmail) return;
    try {
      // VULN: Email change without verification, IDOR possible
      await api.put(`/api/users/${userId}`, { email: newEmail });
      toast.success('Email updated');
      setProfile(p => (p ? { ...p, email: newEmail } : p));
      setNewEmail('');
      refreshUser && refreshUser();
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

  // ── Verification ──
  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    setBusy('profile');
    try {
      const res = await api.put(`/api/users/${userId}/profile`, profileForm);
      toast.success(res.data.accountLevel >= 2 ? 'Profile saved — your account is verified (Level 2).' : 'Profile saved.');
      if (res.data.token) {
        localStorage.setItem('token', res.data.token);
        await refreshToken();
      }
      const profileRes = await api.get(`/api/users/${userId}`);
      setProfile(profileRes.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Profile update failed');
    } finally {
      setBusy(null);
    }
  };

  // ── Photo ──
  const handleFileSelect = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // picking the same file again should work too
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      const img = new Image();
      img.onload = () => {
        setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
        setCropImageSrc(dataUrl);
        setCropOffset({ x: 0, y: 0 });
        setCropZoom(1);
        setShowCropModal(true);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  // Wheel-to-zoom needs a non-passive listener (React's onWheel is passive).
  useEffect(() => {
    const el = cropRef.current;
    if (!el || !showCropModal) return undefined;
    const onWheel = (e) => { e.preventDefault(); setCropZoom(z => Math.min(4, Math.max(0.2, z - e.deltaY * 0.001))); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [showCropModal]);

  const startDrag = (x, y) => { setIsDragging(true); dragStartRef.current = { x: x - cropOffset.x, y: y - cropOffset.y }; };
  const moveDrag = (x, y) => { if (isDragging && dragStartRef.current) setCropOffset({ x: x - dragStartRef.current.x, y: y - dragStartRef.current.y }); };
  const endDrag = () => { setIsDragging(false); dragStartRef.current = null; };

  const handleApplyCrop = () => {
    if (!cropImageSrc) return;
    const drawAndUpload = (img) => {
      const canvas = document.createElement('canvas');
      canvas.width = CROP_SIZE;
      canvas.height = CROP_SIZE;
      const ctx = canvas.getContext('2d');
      ctx.beginPath();
      ctx.arc(CROP_SIZE / 2, CROP_SIZE / 2, CROP_SIZE / 2, 0, Math.PI * 2);
      ctx.clip();
      const baseScale = Math.max(CROP_SIZE / img.naturalWidth, CROP_SIZE / img.naturalHeight);
      const s = baseScale * cropZoom;
      const w = img.naturalWidth * s, h = img.naturalHeight * s;
      ctx.drawImage(img, (CROP_SIZE - w) / 2 + cropOffset.x, (CROP_SIZE - h) / 2 + cropOffset.y, w, h);
      canvas.toBlob(async (blob) => {
        if (!blob) { toast.error('Could not process image'); return; }
        setShowCropModal(false);
        setUploading(true);
        try {
          const formData = new FormData();
          formData.append('file', blob, 'profile.jpg');
          const res = await api.post(`/api/users/${userId}/photo`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
          const newUrl = `${res.data.photoUrl || `/api/users/${userId}/photo`}?t=${Date.now()}`;
          setPhotoPreview(newUrl);
          updatePhoto(newUrl);
          toast.success('Profile photo updated');
        } catch (err) {
          toast.error(err.response?.data?.error || 'Upload failed');
        } finally {
          setUploading(false);
        }
      }, 'image/jpeg', 0.92);
    };
    const img = new Image();
    img.onload = () => drawAndUpload(img);
    img.onerror = () => toast.error('Failed to read image');
    img.src = cropImageSrc;
    if (img.complete && img.naturalWidth > 0) { img.onload = null; drawAndUpload(img); }
  };

  // ── Funds ──
  // VULN: Withdraw - sign flip, race condition, no real 2FA
  const handleWithdraw = async () => {
    setBusy('withdraw');
    try {
      const res = await api.post('/api/accounts/withdraw', {
        amount: parseFloat(withdrawAmount),
        destinationAccount: withdrawDest || 'external-bank-account',
      });
      toast.success(`Withdrawn: ${fmtUSD(withdrawAmount)}. New balance ${fmtUSD(res.data.newBalance)}`);
      // VULN #99: Track daily limit in localStorage only
      const newDaily = dailyWithdrawn + parseFloat(withdrawAmount);
      setDailyWithdrawn(newDaily);
      localStorage.setItem('dailyWithdrawn', newDaily.toString());
      localStorage.setItem('dailyWithdrawnDate', today());
      setWithdrawAmount('');
      setWithdrawDest('');
      afterMoneyMove();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Withdraw failed');
    } finally {
      setShow2FA(false);
      setBusy(null);
    }
  };

  const handleWithdrawWS = () => {
    wsPending.current = true;
    const ok = sendMessage('/app/trade.withdraw', {
      amount: parseFloat(withdrawAmount),
      destinationAccount: withdrawDest || 'external-bank-account',
    });
    if (!ok) { wsPending.current = false; toast.error('Not connected — try again in a moment'); return; }
    toast.info('Withdrawal sent');
    setWithdrawAmount('');
  };

  // VULN: Deposit - no source verification (free money)
  const handleDeposit = async () => {
    setBusy('deposit');
    try {
      const res = await api.post('/api/accounts/deposit', {
        amount: parseFloat(depositAmount),
        sourceAccount: depositSource || 'fake-bank-account-12345',
      });
      toast.success(`Deposited ${fmtUSD(depositAmount)}. New balance ${fmtUSD(res.data.newBalance)}`);
      setDepositAmount('');
      setDepositSource('');
      afterMoneyMove();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Deposit failed');
    } finally {
      setBusy(null);
    }
  };

  // ── Transfers between my own accounts (USD only) ──
  const handleTransfer = async (e) => {
    e.preventDefault();
    setTransferError(null);
    setBusy('transfer');
    try {
      const res = await api.post('/api/accounts/transfer', {
        from: transfer.from,
        to: transfer.to,
        amount: parseFloat(transfer.amount),
      });
      toast.success(`Moved ${fmtUSD(res.data.amount)} from ${res.data.from} to ${res.data.to}`);
      setTransfer(t => ({ ...t, amount: '' }));
      afterMoneyMove();
    } catch (err) {
      const message = err.response?.data?.error || 'Transfer failed';
      setTransferError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  // VULN: Fake 2FA - purely decorative, always succeeds
  const handleFake2FA = () => {
    if (twoFACode.length >= 1) {
      handleWithdraw();
      setTwoFACode('');
    } else {
      toast.error('Enter the code from your authenticator app');
    }
  };

  const profileFields = ['firstName', 'lastName', 'dateOfBirth', 'phoneNumber', 'ssn'];
  const filledCount = profileFields.filter(f => profileForm[f] && String(profileForm[f]).trim()).length;
  const verified = isVerified();
  const locked = getAccountLevel() < 2;
  const cash = balance?.balance ?? profile?.balance ?? user?.balance;
  const setField = (k) => (e) => setProfileForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <PageLayout title="Account" subtitle="Profile, verification, security and funds" maxWidth="1160px">
      <div className="vt-settings">
        {/* ───────────── Left: identity ───────────── */}
        <div style={{ display: 'grid', gap: '16px', minWidth: 0 }}>
          <Card>
            {profile ? (
              <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <div style={{ width: 96, height: 96, borderRadius: '50%', overflow: 'hidden', boxShadow: verified ? '0 0 0 3px var(--vt-surface), 0 0 0 5px var(--vt-up)' : `0 0 0 1px ${colors.borderDefault}` }}>
                    {photoPreview
                      ? <img src={photoPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={() => setPhotoPreview(null)} />
                      : <Avatar name={profile.username} size={96} />}
                  </div>
                  <label title="Change photo" style={{
                    position: 'absolute', bottom: 0, right: 0, width: 32, height: 32, borderRadius: '50%',
                    background: colors.accentFill, color: colors.onAccent, border: `2px solid ${colors.bgCard}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: uploading ? 'progress' : 'pointer',
                  }}>
                    <Camera size={15} aria-hidden="true" />
                    <span style={{ position: 'absolute', left: '-9999px' }}>Change profile photo</span>
                    <input ref={fileRef} type="file" accept="image/*" onChange={handleFileSelect} style={{ display: 'none' }} disabled={uploading} />
                  </label>
                  {uploading && <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#fff', animation: 'spin 0.7s linear infinite' }} /></div>}
                </div>

                <div style={{ flex: 1, minWidth: '220px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <h2 style={{ ...type.title }}>{profile.username}</h2>
                    <VerificationBadge level={getAccountLevel()} />
                    {profile.role === 'ADMIN' && <Chip tone="down">ADMIN</Chip>}
                  </div>
                  <div style={{ color: colors.textMuted, fontSize: '13px', marginTop: '2px' }}>{profile.email}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '1px', marginTop: '14px', borderRadius: '10px', overflow: 'hidden', border: `1px solid ${colors.borderDefault}`, background: colors.borderDefault }}>
                    {[
                      ['Balance', fmtUSD(cash), colors.green],
                      ['Level', `Level ${profile.accountLevel || 1}`, verified ? colors.green : colors.amber],
                      ['User ID', `#${profile.id}`],
                      ...(verified && profile.verifiedAt ? [['Verified', fmtDateShort(profile.verifiedAt), colors.green]] : []),
                    ].map(([k, v, c]) => (
                      <div key={k} style={{ padding: '10px 12px', background: colors.bgStat }}>
                        <div style={{ ...type.caps, fontSize: '10px', marginBottom: '2px' }}>{k}</div>
                        <div style={{ ...num, fontWeight: 600, fontSize: '13.5px', color: c || colors.textPrimary }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: '12px', display: 'grid', gap: '6px' }}>
                    {profile.apiKey && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                        <KeyRound size={13} aria-hidden="true" style={{ color: colors.textMuted }} />
                        <code style={{ ...num, color: colors.amber, background: colors.bgInput, padding: '2px 8px', borderRadius: '6px', border: `1px solid ${colors.borderDefault}`, wordBreak: 'break-all' }}>{profile.apiKey}</code>
                      </div>
                    )}
                    {/* VULN #100: SSN displayed if present */}
                    {profile.ssn && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                        <span style={{ ...type.caps, fontSize: '10px', color: colors.red }}>SSN</span>
                        <code style={{ ...num, color: colors.redLight, background: colors.redDark, padding: '2px 8px', borderRadius: '6px' }}>{profile.ssn}</code>
                      </div>
                    )}
                    {profile.notes && (
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12px' }}>
                        <span style={{ ...type.caps, fontSize: '10px' }}>Notes</span>
                        <span style={{ color: colors.purple }}>{profile.notes}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : <div className="skeleton" style={{ height: '120px' }} />}
          </Card>

          {/* Verification */}
          <Card title={verified ? 'Verified account' : 'Verify your account'} titleColor={verified ? colors.green : colors.textPrimary}
            headerRight={verified ? <BadgeCheck size={18} aria-hidden="true" style={{ color: colors.green }} /> : <Chip tone="warn">{filledCount}/{profileFields.length}</Chip>}>
            {verified ? (
              <div style={{ color: colors.textSecondary, fontSize: '13px', lineHeight: 1.6 }}>
                Level 2 — deposits and withdrawals are unlocked. Daily withdrawal limit {fmtUSD(DAILY_LIMIT)}.
                {profile?.verifiedAt && <div style={{ color: colors.textMuted, fontSize: '12px', marginTop: '2px' }}>Verified {fmtDateShort(profile.verifiedAt)}</div>}
              </div>
            ) : (
              <>
                <ol aria-label="Verification steps" style={{ listStyle: 'none', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '14px' }}>
                  {[['1', 'Account', true], ['2', 'Profile', filledCount > 0], ['3', 'Verified', false]].map(([n, label, done]) => (
                    <li key={n} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: done ? colors.textPrimary : colors.textMuted }}>
                      <span style={{ ...num, width: 22, height: 22, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, background: done ? colors.upFill : colors.bgRaised, color: done ? colors.onUp : colors.textMuted }}>{n}</span>
                      {label}
                    </li>
                  ))}
                </ol>
                <div style={progressBarTrack} aria-hidden="true"><div style={progressBarFill((filledCount / profileFields.length) * 100)} /></div>
                <p style={{ color: colors.textMuted, fontSize: '12.5px', marginTop: '10px' }}>Complete your profile to unlock deposits and withdrawals.</p>
                {isDebug && <p style={{ color: colors.red, fontSize: '11.5px', marginTop: '6px' }}>VULN #98: any non-empty first name auto-verifies — no document review.</p>}

                <form onSubmit={handleProfileUpdate} style={{ marginTop: '16px', display: 'grid', gap: '12px' }}>
                  <div className="vt-cols-2" style={{ gap: '12px' }}>
                    <FormField label="First name"><Input value={profileForm.firstName} onChange={setField('firstName')} placeholder="First name" autoComplete="given-name" style={{ width: '100%' }} /></FormField>
                    <FormField label="Last name"><Input value={profileForm.lastName} onChange={setField('lastName')} placeholder="Last name" autoComplete="family-name" style={{ width: '100%' }} /></FormField>
                    <FormField label="Date of birth"><Input type="date" value={profileForm.dateOfBirth} onChange={setField('dateOfBirth')} style={{ width: '100%' }} /></FormField>
                    <FormField label="Phone"><Input type="tel" value={profileForm.phoneNumber} onChange={setField('phoneNumber')} placeholder="+1-555-0000" autoComplete="tel" style={{ width: '100%' }} /></FormField>
                  </div>
                  <FormField label="SSN" hint={isDebug ? 'VULN: stored in plaintext and returned in API responses' : undefined}>
                    <Input value={profileForm.ssn} onChange={setField('ssn')} placeholder="000-00-0000" style={{ width: '100%', ...num }} />
                  </FormField>
                  <FormField label="Address"><Input value={profileForm.addressLine1} onChange={setField('addressLine1')} placeholder="Street address" autoComplete="address-line1" style={{ width: '100%' }} /></FormField>
                  <div className="vt-cols-3" style={{ gap: '12px' }}>
                    <FormField label="City"><Input value={profileForm.city} onChange={setField('city')} placeholder="City" style={{ width: '100%' }} /></FormField>
                    <FormField label="State"><Input value={profileForm.state} onChange={setField('state')} placeholder="State" style={{ width: '100%' }} /></FormField>
                    <FormField label="ZIP"><Input value={profileForm.zipCode} onChange={setField('zipCode')} placeholder="ZIP" style={{ width: '100%' }} /></FormField>
                  </div>
                  <FormField label="Country"><Input value={profileForm.country} onChange={setField('country')} placeholder="Country" autoComplete="country-name" style={{ width: '100%' }} /></FormField>
                  <div><Button type="submit" variant="green" loading={busy === 'profile'} icon={<ShieldCheck size={15} aria-hidden="true" />}>Save & Verify</Button></div>
                </form>
              </>
            )}
          </Card>

          {/* Security */}
          <Card title="Security" subtitle={isDebug ? 'VULN: no old password, no email verification' : 'Sign-in details'}>
            <form onSubmit={handleChangePassword} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginBottom: '14px' }}>
              <FormField label="New password" grow><Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password" autoComplete="new-password" style={{ width: '100%' }} /></FormField>
              <Button type="submit" variant="gray" icon={<Lock size={14} aria-hidden="true" />}>Change</Button>
            </form>
            <form onSubmit={handleUpdateEmail} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
              <FormField label="New email" grow><Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="New email address" autoComplete="email" style={{ width: '100%' }} /></FormField>
              <Button type="submit" variant="gray" icon={<Mail size={14} aria-hidden="true" />}>Update</Button>
            </form>
          </Card>

          {/* VULN: User Lookup (IDOR demonstration) */}
          {isDebug && (
            <Card variant="danger" title="User lookup (IDOR test)" titleColor={colors.red} hint="Try 1 = admin, 2 = trader1, 3 = trader2">
              <form onSubmit={handleLookupUser} style={{ display: 'flex', gap: '8px' }}>
                <Input type="number" value={lookupUserId} onChange={(e) => setLookupUserId(e.target.value)} placeholder="Enter User ID" min="1" aria-label="User ID" style={{ flex: 1 }} />
                <Button type="submit" variant="red">Lookup</Button>
              </form>
              <JsonPreview data={lookupResult} />
            </Card>
          )}
        </div>

        {/* ───────────── Right: funds ───────────── */}
        <div style={{ display: 'grid', gap: '16px', minWidth: 0 }}>
          <section style={{ background: colors.bgCard, border: `1px solid ${colors.borderDefault}`, borderRadius: 'var(--vt-radius-lg)', padding: '20px' }}>
            <div style={{ ...type.caps, marginBottom: '6px' }}>Available balance</div>
            <div style={{ ...type.display, ...num }}>{cash != null ? fmtUSD(cash) : <span className="skeleton" style={{ display: 'inline-block', width: 180, height: 36 }} />}</div>
            {balance && (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' }}>
                <Chip tone={balance.isActive ? 'up' : 'down'}>{balance.isActive ? 'Active' : 'Inactive'}</Chip>
                {/* VULN: Internal fields exposed */}
                {isDebug && <span style={{ color: colors.textDim, fontSize: '11.5px' }}>Role {balance.role} · key {balance.apiKey}{balance.notes ? ` · ${balance.notes}` : ''}</span>}
              </div>
            )}
          </section>

          {locked && (
            <div role="note" style={{ display: 'flex', gap: '12px', padding: '14px 16px', borderRadius: 'var(--vt-radius)', background: colors.amberDark, border: `1px solid ${colors.borderWarning}` }}>
              <Lock size={18} aria-hidden="true" style={{ color: colors.amber, flexShrink: 0, marginTop: '2px' }} />
              <div>
                <div style={{ fontWeight: 600, color: colors.textPrimary, fontSize: '13.5px' }}>Deposits & withdrawals locked</div>
                <div style={{ color: colors.textSecondary, fontSize: '12.5px', marginTop: '2px' }}>Verify your account (Level 2) to move money.</div>
                {isDebug && <div style={{ color: colors.red, fontSize: '11.5px', marginTop: '6px' }}>VULN #92: or forge a JWT with accountLevel:2 — the server trusts the claim.</div>}
              </div>
            </div>
          )}

          <div style={locked ? { opacity: 0.45, pointerEvents: 'none' } : undefined} aria-disabled={locked || undefined}>
            {/* Withdraw - VULN: fake 2FA, sign flip, JS-only validation */}
            <Card title={<><ArrowUpFromLine size={15} aria-hidden="true" style={{ color: colors.red }} />Withdraw</>}
              hint={isDebug ? '2FA is decorative only. Try negative amounts (sign flip).' : undefined}>
              {!locked && (
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', color: colors.textMuted, marginBottom: '6px' }}>
                    <span>Daily Limit: <span style={{ ...num, color: colors.textPrimary, fontWeight: 600 }}>{fmtUSD(dailyWithdrawn)} / $100,000</span></span>
                    {isDebug && <span style={{ color: colors.red, fontSize: '11px' }}>VULN #99: enforced in JS only</span>}
                  </div>
                  <div style={progressBarTrack} aria-hidden="true">
                    <div style={{ ...progressBarFill(Math.min(100, (dailyWithdrawn / DAILY_LIMIT) * 100)), background: 'var(--vt-warn)' }} />
                  </div>
                </div>
              )}
              <div style={{ display: 'grid', gap: '10px' }}>
                <div className="vt-cols-2" style={{ gap: '10px' }}>
                  <FormField label="Amount"><Input type="number" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} placeholder="Amount to withdraw" min="0.01" step="0.01" inputMode="decimal" style={{ width: '100%', ...num }} /></FormField>
                  <FormField label="Destination"><Input type="text" value={withdrawDest} onChange={(e) => setWithdrawDest(e.target.value)} placeholder="Bank account" style={{ width: '100%' }} /></FormField>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <Button variant="red" loading={busy === 'withdraw'} onClick={() => {
                    const amt = parseFloat(withdrawAmount);
                    if (isNaN(amt) || amt <= 0) { toast.error('Enter an amount greater than 0'); return; }
                    // VULN #99: Daily limit check - frontend only
                    if (dailyWithdrawn + amt > DAILY_LIMIT) { toast.error('Daily withdrawal limit ($100,000) exceeded'); return; }
                    setShow2FA(true);
                  }}>Withdraw (with "2FA")</Button>
                  <Button variant="darkRed" onClick={handleWithdrawWS}>{isDebug ? 'Withdraw via WS (no 2FA)' : 'Quick Withdraw'}</Button>
                </div>
              </div>
            </Card>

            {/* Deposit - VULN: no source verification */}
            <Card title={<><ArrowDownToLine size={15} aria-hidden="true" style={{ color: colors.green }} />Deposit</>}
              hint={isDebug ? 'No source verification — deposit any amount from any "account".' : undefined}>
              <div style={{ display: 'grid', gap: '10px' }}>
                <div className="vt-cols-2" style={{ gap: '10px' }}>
                  <FormField label="Amount"><Input type="number" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} placeholder="Amount to deposit" min="0.01" step="0.01" inputMode="decimal" style={{ width: '100%', ...num }} /></FormField>
                  <FormField label="Source account"><Input type="text" value={depositSource} onChange={(e) => setDepositSource(e.target.value)} placeholder={isDebug ? 'Any value works' : 'Source account'} style={{ width: '100%' }} /></FormField>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {[1000, 5000, 10000].map(v => (
                    <button key={v} type="button" onClick={() => setDepositAmount(String(v))} className="vt-btn vt-ghost"
                      style={{ ...num, height: '26px', padding: '0 10px', borderRadius: '999px', border: `1px solid ${colors.borderDefault}`, background: 'transparent', color: colors.textSecondary, fontSize: '12px' }}>
                      +{fmtUSD(v).replace('.00', '')}
                    </button>
                  ))}
                </div>
                <div><Button variant="green" loading={busy === 'deposit'} onClick={handleDeposit}>Deposit</Button></div>
              </div>
            </Card>
          </div>

          {/* Accounts & transfers */}
          <Card title={<><ArrowLeftRight size={15} aria-hidden="true" style={{ color: colors.blue }} />Accounts & transfers</>}
            subtitle="Stocks trade from EQUITIES, coins from CRYPTO, currencies from FX">
            <div style={{ display: 'grid', gap: '8px', marginBottom: '14px' }}>
              {ACCOUNT_PRODUCTS.map(product => {
                const rows = accounts.find(a => a.product === product)?.balances || [];
                return (
                  <div key={product} style={{ padding: '8px 12px', borderRadius: '8px', background: colors.bgStat, border: `1px solid ${colors.borderDefault}` }}>
                    <div style={{ ...type.caps, fontSize: '10px', marginBottom: '2px' }}>{product}</div>
                    {rows.length === 0 && <div style={{ color: colors.textMuted, fontSize: '12.5px', padding: '4px 0' }}>No balance</div>}
                    {rows.map(b => (
                      <KV key={b.asset} label={b.asset}
                        value={`${b.asset === 'USD' ? fmtUSD(b.available) : fmtQty(b.available)}${Number(b.held) > 0 ? ` · held ${fmtQty(b.held)}` : ''}`} />
                    ))}
                  </div>
                );
              })}
            </div>
            <form onSubmit={handleTransfer}>
              <div className="vt-cols-3" style={{ gap: '10px' }}>
                <FormField label="From">
                  <select value={transfer.from} onChange={(e) => setTransfer(t => ({ ...t, from: e.target.value }))} style={{ ...selectStyle, width: '100%' }}>
                    {ACCOUNT_PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </FormField>
                <FormField label="To">
                  <select value={transfer.to} onChange={(e) => setTransfer(t => ({ ...t, to: e.target.value }))} style={{ ...selectStyle, width: '100%' }}>
                    {ACCOUNT_PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </FormField>
                <FormField label="Amount (USD)">
                  <Input type="number" value={transfer.amount} onChange={(e) => setTransfer(t => ({ ...t, amount: e.target.value }))}
                    placeholder="0.00" min="0.01" step="0.01" inputMode="decimal" style={{ width: '100%', ...num }} />
                </FormField>
              </div>
              {transferError && <div role="alert" style={{ color: colors.redLight, fontSize: '12.5px', marginTop: '8px' }}>{transferError}</div>}
              <div style={{ marginTop: '10px' }}>
                <Button type="submit" variant="blue" loading={busy === 'transfer'} icon={<ArrowLeftRight size={14} aria-hidden="true" />}>Transfer</Button>
              </div>
            </form>
          </Card>

          <Card title="Limits & fees">
            <KV label="Daily withdrawal limit" value={fmtUSD(DAILY_LIMIT)} />
            <KV label="House spread on market orders" value="0.01%" />
            <KV label="Max order size" value="10,000 units" />
            <KV label="Stock commission" value="$0.005 / share (min $1)" />
            <KV label="Crypto fees" value="maker 0.10% · taker 0.20%" />
          </Card>
        </div>
      </div>

      {/* VULN: Fake 2FA Modal - purely decorative */}
      <Modal open={show2FA} onClose={() => { setShow2FA(false); setTwoFACode(''); }} width="400px">
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, margin: '4px auto 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: colors.amberDark, color: colors.amber }}>
            <ShieldCheck size={24} aria-hidden="true" />
          </div>
          <h3 style={{ ...type.title, fontSize: '18px', marginBottom: '6px' }}>Two-factor authentication</h3>
          <p style={{ color: colors.textSecondary, fontSize: '13.5px', marginBottom: '6px' }}>Enter the 6-digit code from your authenticator app</p>
          {isDebug && <p style={{ color: colors.red, fontSize: '11.5px', marginBottom: '8px' }}>(VULN: decorative — any value is accepted, the code never reaches the server)</p>}
          <Input type="text" inputMode="numeric" autoComplete="one-time-code" aria-label="Authentication code" value={twoFACode}
            onChange={(e) => setTwoFACode(e.target.value)} placeholder="000000" maxLength="6"
            style={{ ...num, width: '220px', height: '56px', textAlign: 'center', fontSize: '26px', letterSpacing: '10px', margin: '12px auto 0', display: 'block' }} />
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '20px' }}>
            <Button variant="gray" onClick={() => { setShow2FA(false); setTwoFACode(''); }}>Cancel</Button>
            <Button variant="green" loading={busy === 'withdraw'} onClick={handleFake2FA}>Verify & Proceed</Button>
          </div>
        </div>
      </Modal>

      {/* Photo crop */}
      <Modal open={showCropModal} onClose={() => setShowCropModal(false)} title="Adjust profile photo" width="400px">
        <p style={{ color: colors.textMuted, fontSize: '13px', textAlign: 'center', marginTop: '-8px', marginBottom: '16px' }}>Drag to reposition · scroll or slide to zoom</p>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
          <div ref={cropRef}
            onMouseDown={(e) => { e.preventDefault(); startDrag(e.clientX, e.clientY); }}
            onMouseMove={(e) => moveDrag(e.clientX, e.clientY)}
            onMouseUp={endDrag} onMouseLeave={endDrag}
            onTouchStart={(e) => startDrag(e.touches[0].clientX, e.touches[0].clientY)}
            onTouchMove={(e) => moveDrag(e.touches[0].clientX, e.touches[0].clientY)}
            onTouchEnd={endDrag}
            style={{ width: CROP_SIZE, height: CROP_SIZE, borderRadius: '50%', overflow: 'hidden', position: 'relative', cursor: isDragging ? 'grabbing' : 'grab', boxShadow: '0 0 0 3px var(--vt-accent), 0 0 0 7px var(--vt-accent-soft)', userSelect: 'none', background: colors.bgInput, flexShrink: 0, touchAction: 'none' }}>
            {cropImageSrc && (() => {
              const base = Math.max(CROP_SIZE / naturalSize.w, CROP_SIZE / naturalSize.h) * cropZoom;
              const w = naturalSize.w * base, h = naturalSize.h * base;
              return <img src={cropImageSrc} alt="Crop preview" draggable={false}
                style={{ position: 'absolute', width: w, height: h, left: (CROP_SIZE - w) / 2 + cropOffset.x, top: (CROP_SIZE - h) / 2 + cropOffset.y, pointerEvents: 'none' }} />;
            })()}
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0 8px', marginBottom: '20px' }}>
          <ZoomIn size={16} aria-hidden="true" style={{ color: colors.textMuted }} />
          <span style={{ position: 'absolute', left: '-9999px' }}>Zoom</span>
          <input type="range" min="0.2" max="4" step="0.01" value={cropZoom} onChange={(e) => setCropZoom(parseFloat(e.target.value))} style={{ flex: 1, accentColor: 'var(--vt-accent)' }} />
          <span style={{ ...num, color: colors.textMuted, fontSize: '12px', minWidth: '42px', textAlign: 'right' }}>{Math.round(cropZoom * 100)}%</span>
        </label>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="gray" onClick={() => setShowCropModal(false)}>Cancel</Button>
          <Button variant="blue" onClick={handleApplyCrop} disabled={uploading}>{uploading ? 'Uploading…' : 'Apply & Set as Photo'}</Button>
        </div>
      </Modal>
    </PageLayout>
  );
}

export default AccountPage;
