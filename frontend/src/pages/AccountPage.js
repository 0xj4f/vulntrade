import React, { useState, useEffect, useRef } from 'react';
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
import VerificationBadge from '../components/VerificationBadge';
import { colors, flexRow, flexRowWrap, gridCols, lineHeight2, codeInline, smallText, inputFull, progressBarTrack, progressBarFill, lockBanner, buttonStyles, btnMedium } from '../styles/shared';
import { fmtUSD, fmtBalance, fmtNum } from '../utils/format';
import { useDebug } from '../context/DebugContext';
import DebugOnly from '../components/DebugOnly';

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
  const { user, token, getAccountLevel, isVerified, refreshToken, refreshUser, updatePhoto } = useAuth();
  const isDebug = useDebug();
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

  // ── Verification / Profile state ──
  const [profileForm, setProfileForm] = useState({
    firstName: '', lastName: '', dateOfBirth: '', phoneNumber: '',
    ssn: '', addressLine1: '', addressLine2: '', city: '', state: '', zipCode: '', country: '',
  });
  const [photoPreview, setPhotoPreview] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Crop modal state
  const CROP_SIZE = 280;
  const [showCropModal, setShowCropModal] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState(null);
  const [naturalSize, setNaturalSize] = useState({ w: 1, h: 1 });
  const [cropOffset, setCropOffset] = useState({ x: 0, y: 0 });
  const [cropZoom, setCropZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef(null);
  // VULN #99: Daily limit tracked in localStorage only
  const [dailyWithdrawn, setDailyWithdrawn] = useState(() => {
    const stored = localStorage.getItem('dailyWithdrawn');
    const storedDate = localStorage.getItem('dailyWithdrawnDate');
    const today = new Date().toISOString().split('T')[0];
    if (storedDate === today && stored) return parseFloat(stored);
    return 0;
  });

  useEffect(() => {
    if (user?.userId) {
      // VULN: userId passed in URL - changeable
      api.get(`/api/users/${user.userId}`)
        .then(res => {
          setProfile(res.data);
          // Pre-fill profile form with existing data
          setProfileForm(prev => ({
            ...prev,
            firstName: res.data.firstName || '',
            lastName: res.data.lastName || '',
            dateOfBirth: res.data.dateOfBirth || '',
            phoneNumber: res.data.phoneNumber || '',
            ssn: res.data.ssn || '',
            addressLine1: res.data.addressLine1 || '',
            addressLine2: res.data.addressLine2 || '',
            city: res.data.city || '',
            state: res.data.state || '',
            zipCode: res.data.zipCode || '',
            country: res.data.country || '',
          }));
          // Set photo preview: auth context url (has cache-bust ts) → profilePic from DB → fallback
          if (user.photoUrl) {
            setPhotoPreview(user.photoUrl);
          } else if (res.data.profilePic) {
            setPhotoPreview(res.data.profilePic);
          } else if (res.data.photoPath) {
            setPhotoPreview(`/api/users/${user.userId}/photo`);
          }
        })
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

  // ── Profile / Verification handlers ──
  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    setVerifying(true);
    try {
      const res = await api.put(`/api/users/${user.userId}/profile`, profileForm);
      toast.success(res.data.accountLevel >= 2
        ? 'Profile updated & account verified! You are now Level 2.'
        : 'Profile updated.');
      // If new token returned, refresh auth state
      if (res.data.token) {
        localStorage.setItem('token', res.data.token);
        await refreshToken();
      }
      // Re-fetch profile
      const profileRes = await api.get(`/api/users/${user.userId}`);
      setProfile(profileRes.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Profile update failed');
    } finally {
      setVerifying(false);
    }
  };

  // ── Crop / Photo handlers ──
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
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

  const handleCropMouseDown = (e) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - cropOffset.x, y: e.clientY - cropOffset.y };
  };

  const handleCropMouseMove = (e) => {
    if (!isDragging || !dragStartRef.current) return;
    setCropOffset({ x: e.clientX - dragStartRef.current.x, y: e.clientY - dragStartRef.current.y });
  };

  const handleCropMouseUp = () => {
    setIsDragging(false);
    dragStartRef.current = null;
  };

  const handleCropTouchStart = (e) => {
    const touch = e.touches[0];
    setIsDragging(true);
    dragStartRef.current = { x: touch.clientX - cropOffset.x, y: touch.clientY - cropOffset.y };
  };

  const handleCropTouchMove = (e) => {
    if (!isDragging || !dragStartRef.current) return;
    const touch = e.touches[0];
    setCropOffset({ x: touch.clientX - dragStartRef.current.x, y: touch.clientY - dragStartRef.current.y });
  };

  const handleApplyCrop = () => {
    if (!cropImageSrc) return;

    const drawAndUpload = (img) => {
      const canvas = document.createElement('canvas');
      canvas.width = CROP_SIZE;
      canvas.height = CROP_SIZE;
      const ctx = canvas.getContext('2d');

      // Clip to circle
      ctx.beginPath();
      ctx.arc(CROP_SIZE / 2, CROP_SIZE / 2, CROP_SIZE / 2, 0, Math.PI * 2);
      ctx.clip();

      const baseScale = Math.max(CROP_SIZE / img.naturalWidth, CROP_SIZE / img.naturalHeight);
      const totalScale = baseScale * cropZoom;
      const drawW = img.naturalWidth * totalScale;
      const drawH = img.naturalHeight * totalScale;
      const drawX = (CROP_SIZE - drawW) / 2 + cropOffset.x;
      const drawY = (CROP_SIZE - drawH) / 2 + cropOffset.y;
      ctx.drawImage(img, drawX, drawY, drawW, drawH);

      canvas.toBlob(async (blob) => {
        if (!blob) { toast.error('Could not process image'); return; }
        setShowCropModal(false);
        setUploading(true);
        try {
          const formData = new FormData();
          formData.append('file', blob, 'profile.jpg');
          const res = await api.post(`/api/users/${user.userId}/photo`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
          // Add cache-busting timestamp so the browser re-fetches the new file
          const baseUrl = res.data.photoUrl || `/api/users/${user.userId}/photo`;
          const newUrl = `${baseUrl}?t=${Date.now()}`;
          setPhotoPreview(newUrl);
          updatePhoto(newUrl);
          toast.success('Profile photo updated!');
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
    // data URLs are often already decoded; if so, fire immediately
    if (img.complete && img.naturalWidth > 0) {
      img.onload = null;
      drawAndUpload(img);
    }
  };

  const profileFields = ['firstName', 'lastName', 'dateOfBirth', 'phoneNumber', 'ssn'];
  const filledCount = profileFields.filter(f => profileForm[f] && profileForm[f].trim()).length;
  const progressPercent = (filledCount / profileFields.length) * 100;

  // VULN: Withdraw - sign flip, race condition, no real 2FA
  const handleWithdraw = async () => {
    try {
      const res = await api.post('/api/accounts/withdraw', {
        amount: parseFloat(withdrawAmount),
        destinationAccount: withdrawDest || 'external-bank-account'
      });
      toast.success(`Withdrawn: $${withdrawAmount}. New balance: $${res.data.newBalance}`);
      // VULN #99: Track daily limit in localStorage only
      const newDaily = dailyWithdrawn + parseFloat(withdrawAmount);
      setDailyWithdrawn(newDaily);
      localStorage.setItem('dailyWithdrawn', newDaily.toString());
      localStorage.setItem('dailyWithdrawnDate', new Date().toISOString().split('T')[0]);
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

      {/* ── Profile Hero Card ── */}
      <Card>
        {profile && (
          <div style={{ display: 'flex', gap: '28px', alignItems: 'flex-start', flexWrap: 'wrap' }}>

            {/* Avatar column */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
              {/* Avatar circle with upload overlay */}
              <div style={{ position: 'relative' }}>
                <div style={{
                  width: '104px', height: '104px', borderRadius: '50%',
                  overflow: 'hidden', flexShrink: 0,
                  border: isVerified()
                    ? `3px solid ${colors.green}`
                    : `3px solid ${colors.borderMedium}`,
                  boxShadow: isVerified()
                    ? `0 0 0 4px rgba(0,214,143,0.12), 0 8px 32px rgba(0,0,0,0.5)`
                    : `0 8px 32px rgba(0,0,0,0.5)`,
                }}>
                  {photoPreview ? (
                    <img src={photoPreview} alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      onError={() => setPhotoPreview(null)} />
                  ) : (
                    <div style={{
                      width: '100%', height: '100%',
                      background: 'linear-gradient(135deg, #4F8BFF 0%, #8B5CF6 100%)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '38px', fontWeight: '800', color: '#fff',
                      letterSpacing: '-0.02em', userSelect: 'none',
                    }}>
                      {profile.username?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                  )}
                </div>

                {/* Camera button */}
                <label title="Change photo" style={{
                  position: 'absolute', bottom: '2px', right: '2px',
                  width: '30px', height: '30px', borderRadius: '50%',
                  background: `linear-gradient(135deg, ${colors.purple}, #6D28D9)`,
                  border: `2px solid #111D35`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: uploading ? 'default' : 'pointer',
                  boxShadow: '0 2px 10px rgba(139,92,246,0.5)',
                  fontSize: '13px', lineHeight: 1,
                  transition: 'transform 0.15s ease',
                }}>
                  {uploading ? '…' : '📷'}
                  <input type="file" accept="image/*" onChange={handleFileSelect}
                    style={{ display: 'none' }} disabled={uploading} />
                </label>

                {/* Upload spinner overlay */}
                {uploading && (
                  <div style={{
                    position: 'absolute', inset: 0, borderRadius: '50%',
                    backgroundColor: 'rgba(0,0,0,0.55)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <div style={{
                      width: '22px', height: '22px', borderRadius: '50%',
                      border: `2px solid rgba(255,255,255,0.15)`,
                      borderTopColor: '#fff',
                      animation: 'spin 0.7s linear infinite',
                    }} />
                  </div>
                )}
              </div>

              {/* Upload hint */}
              <span style={{ color: colors.textMuted, fontSize: '11px', letterSpacing: '0.02em' }}>
                Click 📷 to update
              </span>
            </div>

            {/* Info column */}
            <div style={{ flex: 1, minWidth: '220px' }}>
              {/* Name + badge row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '4px' }}>
                <h2 style={{ color: colors.textPrimary, fontSize: '22px', fontWeight: '800', margin: 0, letterSpacing: '-0.02em' }}>
                  {profile.username}
                </h2>
                <VerificationBadge level={getAccountLevel()} />
                {profile.role === 'ADMIN' && (
                  <span style={{
                    padding: '2px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: '700',
                    backgroundColor: 'rgba(255,61,113,0.12)', color: colors.red,
                    border: '1px solid rgba(255,61,113,0.25)', letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}>Admin</span>
                )}
              </div>

              <div style={{ color: colors.textMuted, fontSize: '13px', marginBottom: '20px' }}>{profile.email}</div>

              {/* Stats row */}
              <div style={{ display: 'flex', gap: '0', borderRadius: '12px', overflow: 'hidden', border: `1px solid ${colors.borderDefault}` }}>
                {[
                  {
                    label: 'Balance',
                    value: fmtUSD(profile.balance),
                    color: colors.green,
                  },
                  {
                    label: 'Account Level',
                    value: `Level ${profile.accountLevel || 1}`,
                    color: isVerified() ? colors.green : colors.amber,
                  },
                  {
                    label: 'User ID',
                    value: `#${profile.id}`,
                    color: colors.textSecondary,
                  },
                  ...(isVerified() && profile.verifiedAt ? [{
                    label: 'Verified',
                    value: new Date(profile.verifiedAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
                    color: colors.green,
                  }] : []),
                ].map(({ label, value, color }, i, arr) => (
                  <div key={label} style={{
                    flex: 1, padding: '12px 16px',
                    backgroundColor: colors.bgStat,
                    borderRight: i < arr.length - 1 ? `1px solid ${colors.borderDefault}` : 'none',
                  }}>
                    <div style={{ fontSize: '10px', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: '600', marginBottom: '4px' }}>{label}</div>
                    <div style={{ color, fontWeight: '700', fontSize: '14px' }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* API Key + sensitive fields */}
              <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {profile.apiKey && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '10px', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: '600', minWidth: '56px' }}>API Key</span>
                    <span style={{ color: colors.amber, fontSize: '11px', fontFamily: "'SF Mono', monospace", backgroundColor: colors.bgInput, padding: '3px 8px', borderRadius: '5px', border: `1px solid ${colors.borderDefault}`, wordBreak: 'break-all' }}>{profile.apiKey}</span>
                  </div>
                )}
                {/* VULN #100: SSN displayed if present */}
                {profile.ssn && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '10px', color: colors.red, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: '600', minWidth: '56px' }}>SSN</span>
                    <span style={{ color: colors.red, fontSize: '11px', fontFamily: "'SF Mono', monospace", backgroundColor: colors.redDark, padding: '3px 8px', borderRadius: '5px', border: `1px solid ${colors.borderDanger}` }}>{profile.ssn}</span>
                  </div>
                )}
                {profile.notes && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '10px', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: '600', minWidth: '56px' }}>Notes</span>
                    <span style={{ color: colors.purpleLight, fontSize: '12px' }}>{profile.notes}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* CSS keyframe for spinner */}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </Card>

      {/* ── Account Level Status ── */}
      <Card title={isVerified() ? 'Account Verified' : 'Upgrade Your Account'}
        titleColor={isVerified() ? colors.green : colors.amber}>
        {isVerified() ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '48px', height: '48px', borderRadius: '50%',
              border: `3px solid ${colors.green}`, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontSize: '22px', backgroundColor: colors.greenDark,
            }}>&#10003;</div>
            <div>
              <div style={{ color: colors.green, fontWeight: '700', fontSize: '16px' }}>Level 2 — Verified</div>
              <div style={{ color: colors.textMuted, fontSize: '13px' }}>
                Deposit & Withdraw unlocked. Daily limit: $100,000
              </div>
              {profile?.verifiedAt && (
                <div style={{ color: colors.textDim, fontSize: '11px', marginTop: '2px' }}>
                  Verified: {new Date(profile.verifiedAt).toLocaleDateString()}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div>
            <div style={{ color: colors.textSecondary, fontSize: '14px', marginBottom: '12px' }}>
              Complete your profile to unlock deposits and withdrawals.
            </div>
            <div style={{ marginBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: colors.textMuted, fontSize: '12px' }}>Verification Progress</span>
                <span style={{ color: colors.amber, fontSize: '12px', fontWeight: '600' }}>{filledCount}/{profileFields.length} fields</span>
              </div>
              <div style={progressBarTrack}>
                <div style={progressBarFill(progressPercent)} />
              </div>
            </div>
            {isDebug && (
              <div style={{ color: colors.red, fontSize: '11px', marginTop: '8px' }}>
                VULN #98: Any non-empty first name triggers auto-verification. No real document review.
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ── Profile Completion Form ── */}
      {!isVerified() && (
        <Card title="Complete Your Profile" titleColor={colors.blue}
          hint={isDebug ? "VULN #98: Filling just the first name auto-verifies. VULN #96: All PII stored in plaintext." : undefined}>
          <form onSubmit={handleProfileUpdate}>
            <div style={gridCols()}>
              <FormField label="First Name">
                <Input value={profileForm.firstName}
                  onChange={(e) => setProfileForm(p => ({ ...p, firstName: e.target.value }))}
                  placeholder="First name" style={{ width: '100%' }} />
              </FormField>
              <FormField label="Last Name">
                <Input value={profileForm.lastName}
                  onChange={(e) => setProfileForm(p => ({ ...p, lastName: e.target.value }))}
                  placeholder="Last name" style={{ width: '100%' }} />
              </FormField>
            </div>
            <div style={{ ...gridCols(), marginTop: '12px' }}>
              <FormField label="Date of Birth">
                <Input type="date" value={profileForm.dateOfBirth}
                  onChange={(e) => setProfileForm(p => ({ ...p, dateOfBirth: e.target.value }))}
                  style={{ width: '100%' }} />
              </FormField>
              <FormField label="Phone Number">
                <Input value={profileForm.phoneNumber}
                  onChange={(e) => setProfileForm(p => ({ ...p, phoneNumber: e.target.value }))}
                  placeholder="+1-555-0000" style={{ width: '100%' }} />
              </FormField>
            </div>
            <div style={{ marginTop: '12px' }}>
              <FormField label={<span>SSN {isDebug && <span style={{ color: colors.red, fontSize: '10px' }}>(VULN: stored in plaintext, returned in API responses)</span>}</span>}>
                <Input value={profileForm.ssn}
                  onChange={(e) => setProfileForm(p => ({ ...p, ssn: e.target.value }))}
                  placeholder="000-00-0000" style={{ width: '100%', fontFamily: "'SF Mono', monospace" }} />
              </FormField>
            </div>
            <div style={{ marginTop: '12px' }}>
              <FormField label="Address Line 1">
                <Input value={profileForm.addressLine1}
                  onChange={(e) => setProfileForm(p => ({ ...p, addressLine1: e.target.value }))}
                  placeholder="Street address" style={{ width: '100%' }} />
              </FormField>
            </div>
            <div style={{ ...gridCols('1fr 1fr 1fr'), marginTop: '12px' }}>
              <FormField label="City">
                <Input value={profileForm.city}
                  onChange={(e) => setProfileForm(p => ({ ...p, city: e.target.value }))}
                  placeholder="City" style={{ width: '100%' }} />
              </FormField>
              <FormField label="State">
                <Input value={profileForm.state}
                  onChange={(e) => setProfileForm(p => ({ ...p, state: e.target.value }))}
                  placeholder="State" style={{ width: '100%' }} />
              </FormField>
              <FormField label="ZIP Code">
                <Input value={profileForm.zipCode}
                  onChange={(e) => setProfileForm(p => ({ ...p, zipCode: e.target.value }))}
                  placeholder="ZIP" style={{ width: '100%' }} />
              </FormField>
            </div>
            <div style={{ ...gridCols(), marginTop: '12px' }}>
              <FormField label="Country">
                <Input value={profileForm.country}
                  onChange={(e) => setProfileForm(p => ({ ...p, country: e.target.value }))}
                  placeholder="Country" style={{ width: '100%' }} />
              </FormField>
            </div>
            <div style={{ marginTop: '16px' }}>
              <Button type="submit" variant="green" disabled={verifying}>
                {verifying ? 'Saving...' : 'Save & Verify'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Change Password - VULN: no old password required */}
      <Card title="Change Password" hint={isDebug ? "No old password verification required" : undefined}>
        <form onSubmit={handleChangePassword} style={{ display: 'flex', gap: '10px' }}>
          <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password" style={{ flex: 1 }} />
          <Button type="submit" variant="green">Change</Button>
        </form>
      </Card>

      {/* Change Email - VULN: no verification */}
      <Card title="Change Email" hint={isDebug ? "No email verification required" : undefined}>
        <form onSubmit={handleUpdateEmail} style={{ display: 'flex', gap: '10px' }}>
          <Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
            placeholder="New email address" style={{ flex: 1 }} />
          <Button type="submit" variant="blue">Update</Button>
        </form>
      </Card>

      {/* VULN: User Lookup (IDOR demonstration) */}
      {isDebug && (
        <Card variant="danger" title="User Lookup (IDOR Test)" titleColor={colors.red}
          hint="Try looking up other user IDs (1 = admin, 2 = trader1, 3 = trader2)">
          <form onSubmit={handleLookupUser} style={{ display: 'flex', gap: '10px' }}>
            <Input type="number" value={lookupUserId} onChange={(e) => setLookupUserId(e.target.value)}
              placeholder="Enter User ID" min="1" style={{ flex: 1 }} />
            <Button type="submit" variant="red">Lookup</Button>
          </form>
          <JsonPreview data={lookupResult} />
        </Card>
      )}

      {/* Balance Display */}
      {balance && (
        <Card title="Account Balance">
          <div style={gridCols()}>
            <StatCard label="Available Balance"
              value={fmtBalance(balance.balance)}
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
              {isDebug && (
                <>
                  <div style={smallText(colors.textDim)}>Role: {balance.role} | API Key: {balance.apiKey}</div>
                  {balance.notes && <div style={smallText(colors.amber)}>Notes: {balance.notes}</div>}
                </>
              )}
            </StatCard>
          </div>
        </Card>
      )}

      {/* ── Level Gate: Deposit & Withdraw ── */}
      {getAccountLevel() < 2 && (
        <div style={lockBanner}>
          <div style={{ fontSize: '18px', marginBottom: '6px' }}>&#128274;</div>
          <div style={{ color: colors.textSecondary, fontSize: '14px', fontWeight: '600' }}>
            Deposit & Withdraw Locked
          </div>
          <div style={{ color: colors.textMuted, fontSize: '12px', marginTop: '4px' }}>
            Complete verification (Level 2) to unlock deposits and withdrawals.
          </div>
          {isDebug && (
            <div style={{ color: colors.red, fontSize: '11px', marginTop: '8px' }}>
              VULN #92: Or forge a JWT with accountLevel:2 — the server trusts it without DB check.
            </div>
          )}
        </div>
      )}

      {/* Withdraw - VULN: fake 2FA, sign flip, JS-only validation */}
      <div style={getAccountLevel() < 2 ? { opacity: 0.4, pointerEvents: 'none' } : {}}>
        <Card title="Withdraw Funds" hint={isDebug ? "2FA is decorative only. Try negative amounts (sign flip vuln)." : undefined}>
          {getAccountLevel() >= 2 && (
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 12px', borderRadius: '8px', marginBottom: '12px',
              backgroundColor: colors.bgInput, border: `1px solid ${colors.borderDefault}`,
            }}>
              <span style={{ color: colors.textMuted, fontSize: '12px' }}>
                Daily Limit: <span style={{ color: colors.amber, fontWeight: '600' }}>
                  {fmtNum(dailyWithdrawn)} / $100,000
                </span>
              </span>
              {isDebug && (
                <span style={{ color: colors.red, fontSize: '10px' }}>
                  VULN #99: Limit enforced in JS only — curl ignores it
                </span>
              )}
            </div>
          )}
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
              // VULN #99: Daily limit check - frontend only
              if (dailyWithdrawn + amt > 100000) { toast.error('Daily withdrawal limit ($100,000) exceeded'); return; }
              setPendingAction('withdraw');
              setShow2FA(true);
            }}>Withdraw (with "2FA")</Button>
            <Button variant="darkRed" onClick={handleWithdrawWS}>{isDebug ? 'Withdraw via WS (no 2FA)' : 'Quick Withdraw'}</Button>
          </div>
        </Card>

        {/* Deposit - VULN: no source verification */}
        <Card title="Deposit Funds" hint={isDebug ? 'No source verification — deposit any amount from any "account"' : undefined}>
          <div style={flexRowWrap('10px')}>
            <FormField label="Amount">
              <Input type="number" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="Amount to deposit" min="0.01" step="0.01" width="180px" />
            </FormField>
            <FormField label="Source Account">
              <Input type="text" value={depositSource} onChange={(e) => setDepositSource(e.target.value)}
                placeholder={isDebug ? "Any value works" : "Source account"} width="200px" />
            </FormField>
            <Button variant="green" onClick={handleDeposit}>Deposit</Button>
          </div>
        </Card>
      </div>

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
        {isDebug && (
          <p style={{ color: colors.red, fontSize: '11px', marginBottom: '20px' }}>
            (VULN: This is decorative - any value is accepted, code never sent to server)
          </p>
        )}
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

      {/* ── Photo Crop Modal ── */}
      <Modal open={showCropModal} onClose={() => setShowCropModal(false)}>
        <h3 style={{ color: colors.textPrimary, fontSize: '18px', fontWeight: '700', textAlign: 'center', marginBottom: '6px' }}>
          Adjust Profile Photo
        </h3>
        <p style={{ color: colors.textMuted, fontSize: '13px', textAlign: 'center', marginBottom: '20px' }}>
          Drag to reposition &nbsp;·&nbsp; Slide to zoom
        </p>

        {/* Circle crop viewport */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
          <div
            onMouseDown={handleCropMouseDown}
            onMouseMove={handleCropMouseMove}
            onMouseUp={handleCropMouseUp}
            onMouseLeave={handleCropMouseUp}
            onTouchStart={handleCropTouchStart}
            onTouchMove={handleCropTouchMove}
            onTouchEnd={handleCropMouseUp}
            onWheel={(e) => {
              e.preventDefault();
              setCropZoom(z => Math.min(4, Math.max(0.2, z - e.deltaY * 0.001)));
            }}
            style={{
              width: `${CROP_SIZE}px`,
              height: `${CROP_SIZE}px`,
              borderRadius: '50%',
              overflow: 'hidden',
              position: 'relative',
              cursor: isDragging ? 'grabbing' : 'grab',
              border: `3px solid ${colors.purple}`,
              boxShadow: `0 0 0 5px rgba(139,92,246,0.15), 0 8px 32px rgba(0,0,0,0.4)`,
              userSelect: 'none',
              backgroundColor: colors.bgInput,
              flexShrink: 0,
            }}
          >
            {cropImageSrc && (() => {
              const baseScale = Math.max(CROP_SIZE / naturalSize.w, CROP_SIZE / naturalSize.h);
              const totalScale = baseScale * cropZoom;
              const displayW = naturalSize.w * totalScale;
              const displayH = naturalSize.h * totalScale;
              const left = (CROP_SIZE - displayW) / 2 + cropOffset.x;
              const top = (CROP_SIZE - displayH) / 2 + cropOffset.y;
              return (
                <img
                  src={cropImageSrc}
                  alt="Crop preview"
                  draggable={false}
                  style={{
                    position: 'absolute',
                    width: `${displayW}px`,
                    height: `${displayH}px`,
                    left: `${left}px`,
                    top: `${top}px`,
                    pointerEvents: 'none',
                    userSelect: 'none',
                  }}
                />
              );
            })()}
          </div>
        </div>

        {/* Zoom slider */}
        <div style={{ padding: '0 24px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '16px' }}>🔍</span>
            <input
              type="range"
              min="0.2"
              max="4"
              step="0.01"
              value={cropZoom}
              onChange={(e) => setCropZoom(parseFloat(e.target.value))}
              style={{ flex: 1, accentColor: colors.purple, cursor: 'pointer' }}
            />
            <span style={{ color: colors.textMuted, fontSize: '12px', minWidth: '42px', textAlign: 'right' }}>
              {Math.round(cropZoom * 100)}%
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <Button variant="purple" onClick={handleApplyCrop} disabled={uploading}>
            {uploading ? 'Uploading…' : 'Apply & Set as Photo'}
          </Button>
          <Button variant="gray" onClick={() => setShowCropModal(false)}>Cancel</Button>
        </div>
      </Modal>
    </PageLayout>
  );
}

export default AccountPage;
