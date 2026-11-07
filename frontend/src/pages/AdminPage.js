import React, { useState } from 'react';
import { toast } from 'react-toastify';
import { Database, Gauge, PauseCircle, PlayCircle, ShieldAlert, UserCog, Users, Wallet } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useDebug } from '../context/DebugContext';
import { useMarketData } from '../context/MarketDataContext';
import api from '../services/apiService';
import { sendMessage } from '../services/websocketService';
import PageLayout from '../components/PageLayout';
import Card from '../components/Card';
import Button from '../components/Button';
import DataTable from '../components/DataTable';
import FormField, { Input } from '../components/FormField';
import JsonPreview from '../components/JsonPreview';
import { Chip } from '../components/ui';
import { colors, num, textareaStyle } from '../styles/shared';
import { fmtPrice, fmtUSD } from '../utils/format';

/** Symbol text input with suggestions (stable component so typing keeps focus). */
function SymbolInput({ value, onChange, id, ...rest }) {
  return <Input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} list="admin-symbols" style={{ width: '100%' }} {...rest} />;
}

/**
 * Admin panel.
 *
 * VULN (kept): only hidden client-side (FE-03 / #81); every action works for anyone who
 * knows the endpoint or forges the role; halt/resume and price override over STOMP accept
 * any user (#82/#83); the balance-adjust reason is logged raw (#84 log injection / Log4Shell);
 * arbitrary SQL executor; user activate/deactivate.
 */
function AdminPage() {
  const { user } = useAuth();
  const isDebug = useDebug();
  const { quotes, symbols } = useMarketData();
  const [users, setUsers] = useState([]);
  const [sqlQuery, setSqlQuery] = useState('SELECT * FROM flags');
  const [sqlResult, setSqlResult] = useState(null);
  const [adjustUserId, setAdjustUserId] = useState('');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('Admin adjustment');
  const [haltSymbol, setHaltSymbol] = useState('AAPL');
  const [haltReason, setHaltReason] = useState('Suspicious activity');
  const [priceSymbol, setPriceSymbol] = useState('AAPL');
  const [priceValue, setPriceValue] = useState('');
  const [toggleUserId, setToggleUserId] = useState('');
  const [busy, setBusy] = useState(null);

  const loadUsers = async () => {
    setBusy('users');
    try {
      const res = await api.get('/api/admin/users');
      setUsers(res.data);
      toast.success(`Loaded ${res.data.length} users`);
    } catch (err) {
      toast.error('Access denied (or is it?)');
    } finally { setBusy(null); }
  };

  const executeSql = async (e) => {
    e.preventDefault();
    setBusy('sql');
    try {
      const res = await api.post('/api/admin/execute-query', { sql: sqlQuery });
      setSqlResult(res.data);
      toast.success('Query executed');
    } catch (err) {
      setSqlResult({ error: err.response?.data?.error || 'Query failed' });
      toast.error('Query failed');
    } finally { setBusy(null); }
  };

  const adjustBalance = async (e) => {
    e.preventDefault();
    try {
      // VULN: Log injection via reason field
      const res = await api.post('/api/admin/adjust-balance', {
        userId: parseInt(adjustUserId, 10),
        amount: parseFloat(adjustAmount),
        reason: adjustReason, // VULN: unsanitized in audit log
      });
      toast.success(`Balance adjusted · new balance ${fmtUSD(res.data?.newBalance)}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed');
    }
  };

  const ws = (dest, body, okMsg) => {
    if (sendMessage(dest, body)) toast.info(okMsg);
    else toast.error('Not connected — try again in a moment');
  };
  // Trading halt via WebSocket - VULN: JWT role check from token body
  const haltTrading = () => ws('/app/admin.haltTrading', { symbol: haltSymbol, reason: haltReason }, `Halt requested for ${haltSymbol}`);
  const resumeTrading = () => ws('/app/admin.resumeTrading', { symbol: haltSymbol }, `Resume requested for ${haltSymbol}`);
  // Price override via WebSocket - VULN: market manipulation
  const setPrice = () => ws('/app/admin.setPrice', { symbol: priceSymbol, price: parseFloat(priceValue) }, `Price override sent: ${priceSymbol} = ${priceValue}`);

  const toggleUser = async () => {
    try {
      const res = await api.put(`/api/admin/users/${toggleUserId}/toggle`);
      toast.success(res.data.message);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to toggle user');
    }
  };

  return (
    <PageLayout title="Admin Panel" subtitle="Platform operations · every action here is audited (or is it?)" maxWidth="1160px"
      actions={<Chip tone="down"><ShieldAlert size={12} aria-hidden="true" />{user?.role} · {user?.username}</Chip>}>
      <datalist id="admin-symbols">{symbols.map(s => <option key={s} value={s} />)}</datalist>
      {isDebug && (
        <div role="note" style={{ padding: '12px 14px', borderRadius: 'var(--vt-radius)', background: colors.redDark, border: `1px solid ${colors.borderDanger}`, color: colors.redLight, fontSize: '13px', marginBottom: '16px' }}>
          VULN: This page is only hidden via client-side conditional render. Any authenticated user can navigate to /admin.
        </div>
      )}

      <div className="vt-cols-2" style={{ alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: '16px', minWidth: 0 }}>
          <Card title={<><Users size={15} aria-hidden="true" />User management</>}
            headerRight={<Button variant="blue" size="small" loading={busy === 'users'} onClick={loadUsers}>Load All Users</Button>} flush>
            {users.length > 0 ? (
              <DataTable small maxHeight="360px" rowKey={u => u.id} data={users}
                columns={[
                  { key: 'id', label: 'ID', render: u => <span style={{ ...num, color: colors.textMuted }}>{u.id}</span> },
                  { key: 'username', label: 'User', render: u => <span style={{ fontWeight: 600 }}>{u.username}</span> },
                  { key: 'role', label: 'Role', render: u => <Chip tone={u.role === 'ADMIN' ? 'down' : u.role === 'DEVELOPER' ? 'violet' : 'accent'}>{u.role}</Chip> },
                  { key: 'active', label: 'Status', render: u => <Chip tone={u.isActive ? 'up' : 'neutral'}>{u.isActive ? 'Active' : 'Disabled'}</Chip> },
                  { key: 'balance', label: 'Balance', align: 'right', render: u => fmtUSD(u.balance) },
                  { key: 'apiKey', label: 'API key', render: u => <span style={{ ...num, color: colors.amber, fontSize: '11px' }}>{u.apiKey}</span> },
                  { key: 'notes', label: 'Notes', render: u => <span style={{ color: colors.textMuted, fontSize: '11.5px' }}>{u.notes}</span> },
                ]} />
            ) : <div style={{ padding: '24px', textAlign: 'center', color: colors.textMuted, fontSize: '13px' }}>Load users to manage accounts.</div>}
          </Card>

          <Card variant="warning" title={<><Database size={15} aria-hidden="true" />SQL Query Executor</>} titleColor={colors.amber}>
            <form onSubmit={executeSql}>
              <label htmlFor="admin-sql" style={{ position: 'absolute', left: '-9999px' }}>SQL query</label>
              <textarea id="admin-sql" value={sqlQuery} onChange={(e) => setSqlQuery(e.target.value)} rows={4} spellCheck={false}
                style={{ ...textareaStyle, marginBottom: '10px' }} />
              <Button type="submit" variant="amber" loading={busy === 'sql'}>Execute SQL</Button>
            </form>
            <JsonPreview data={sqlResult} />
          </Card>

          <Card title={<><UserCog size={15} aria-hidden="true" />Account toggle</>}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
              <FormField label="User ID" grow><Input type="number" value={toggleUserId} onChange={(e) => setToggleUserId(e.target.value)} placeholder="User ID" style={{ width: '100%' }} /></FormField>
              <Button variant="purple" onClick={toggleUser}>Toggle Active/Inactive</Button>
            </div>
          </Card>
        </div>

        <div style={{ display: 'grid', gap: '16px', minWidth: 0 }}>
          {/* Balance Adjustment - VULN: log injection via reason */}
          <Card title={<><Wallet size={15} aria-hidden="true" />Balance adjustment</>}>
            <form onSubmit={adjustBalance} style={{ display: 'grid', gap: '10px' }}>
              <div className="vt-cols-2" style={{ gap: '10px' }}>
                <FormField label="User ID"><Input type="number" value={adjustUserId} onChange={(e) => setAdjustUserId(e.target.value)} placeholder="User ID" style={{ width: '100%' }} /></FormField>
                <FormField label="Amount (+/-)"><Input type="number" value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} placeholder="Amount" step="any" style={{ width: '100%', ...num }} /></FormField>
              </div>
              <FormField label={isDebug ? 'Reason (log injection)' : 'Reason'}>
                {/* VULN: Reason field logged without sanitization */}
                <Input type="text" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} style={{ width: '100%' }}
                  placeholder={isDebug ? 'Reason (try: test\\nFAKE_LOG_ENTRY)' : 'Admin adjustment reason'} />
              </FormField>
              <div><Button type="submit" variant="green">Adjust</Button></div>
            </form>
          </Card>

          {/* Trading Halt Controls - VULN: accessible by any user via WS */}
          <Card variant="warning" title={<><Gauge size={15} aria-hidden="true" />Trading halt controls</>} titleColor={colors.amber}
            hint={isDebug ? 'VULN: Uses JWT role from token body (modifiable). Sends via WebSocket.' : undefined}>
            <div style={{ display: 'grid', gap: '10px' }}>
              <div className="vt-cols-2" style={{ gap: '10px' }}>
                <FormField label="Symbol"><SymbolInput id="halt-symbol" value={haltSymbol} onChange={setHaltSymbol} /></FormField>
                <FormField label="Reason"><Input type="text" value={haltReason} onChange={(e) => setHaltReason(e.target.value)} style={{ width: '100%' }} /></FormField>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button variant="red" icon={<PauseCircle size={14} aria-hidden="true" />} onClick={haltTrading}>Halt Trading</Button>
                <Button variant="green" icon={<PlayCircle size={14} aria-hidden="true" />} onClick={resumeTrading}>Resume Trading</Button>
              </div>
            </div>
          </Card>

          {/* Price Override - VULN: market manipulation */}
          <Card variant="danger" title={<><ShieldAlert size={15} aria-hidden="true" />Manual price override</>} titleColor={colors.red}
            hint={isDebug ? 'VULN: Set arbitrary prices. No audit trail. Market manipulation.' : 'Overrides stop the simulator for that symbol until restart.'}>
            <div style={{ display: 'grid', gap: '10px' }}>
              <div className="vt-cols-2" style={{ gap: '10px' }}>
                <FormField label="Symbol" hint={quotes[priceSymbol] ? `Now ${fmtPrice(quotes[priceSymbol].currentPrice)}` : undefined}>
                  <SymbolInput id="price-symbol" value={priceSymbol} onChange={setPriceSymbol} />
                </FormField>
                <FormField label="New price"><Input type="number" value={priceValue} onChange={(e) => setPriceValue(e.target.value)} step="any" placeholder="e.g. 9999.99" style={{ width: '100%', ...num }} /></FormField>
              </div>
              <div><Button variant="red" onClick={setPrice}>Set Price</Button></div>
            </div>
          </Card>

          {isDebug && (
            <Card title="Vulnerable endpoints reference" flush>
              {[
                { method: 'GET', path: '/actuator/env', desc: 'Environment variables (secrets, flags)' },
                { method: 'GET', path: '/actuator/heapdump', desc: 'JVM heap dump (Flag 8)' },
                { method: 'POST', path: '/api/auth/login-legacy', desc: 'SQL injection in username' },
                { method: 'GET', path: '/api/users/1', desc: 'IDOR: admin profile (Flag 2 in notes)' },
                { method: 'GET', path: '/api/users/3/portfolio', desc: 'IDOR: trader2 portfolio (Flag 6)' },
                { method: 'POST', path: '/api/debug/execute', desc: 'RCE (X-Debug-Key: vulntrade-debug-key-2024)' },
                { method: 'CLI', path: 'redis-cli GET flag3', desc: 'Redis no auth (Flag 3)' },
              ].map(({ method, path, desc }) => (
                <div key={path} className="vt-row" style={{ display: 'grid', gridTemplateColumns: '48px minmax(0,1fr)', gap: '10px', padding: '9px 16px', borderBottom: `1px solid ${colors.borderDefault}`, fontSize: '12.5px' }}>
                  <Chip tone={method === 'GET' ? 'accent' : method === 'POST' ? 'up' : 'violet'} style={{ justifyContent: 'center' }}>{method}</Chip>
                  <span><code style={{ ...num, color: colors.amber }}>{path}</code><br /><span style={{ color: colors.textMuted }}>{desc}</span></span>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

export default AdminPage;
