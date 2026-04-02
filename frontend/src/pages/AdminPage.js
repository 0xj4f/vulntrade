import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/apiService';
import { sendMessage } from '../services/websocketService';
import { toast } from 'react-toastify';

import PageLayout from '../components/PageLayout';
import Card from '../components/Card';
import Button from '../components/Button';
import FormField, { Input } from '../components/FormField';
import DataTable from '../components/DataTable';
import JsonPreview from '../components/JsonPreview';
import { colors, flexRowWrap, textareaStyle } from '../styles/shared';
import { fmtNum } from '../utils/format';
import { useDebug } from '../context/DebugContext';

/**
 * PHASE 6 VULNS:
 * - VULN: Admin page only protected by client-side conditional render
 * - VULN: Any authenticated user can navigate to /admin
 * - VULN: All admin API calls work if you know the endpoint
 * - VULN: JWT role from token body (modifiable by client)
 * - VULN: Trading halt controls accessible
 * - VULN: Manual price override - market manipulation
 * - VULN: User toggle (activate/deactivate)
 */
function AdminPage() {
  const { user } = useAuth();
  const isDebug = useDebug();
  const [users, setUsers] = useState([]);
  const [sqlQuery, setSqlQuery] = useState('SELECT * FROM flags');
  const [sqlResult, setSqlResult] = useState(null);
  const [adjustUserId, setAdjustUserId] = useState('');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('Admin adjustment');
  // Trading halt
  const [haltSymbol, setHaltSymbol] = useState('AAPL');
  const [haltReason, setHaltReason] = useState('Suspicious activity');
  // Price override
  const [priceSymbol, setPriceSymbol] = useState('AAPL');
  const [priceValue, setPriceValue] = useState('');
  // Toggle user
  const [toggleUserId, setToggleUserId] = useState('');

  const loadUsers = async () => {
    try {
      const res = await api.get('/api/admin/users');
      setUsers(res.data);
      toast.success(`Loaded ${res.data.length} users`);
    } catch (err) {
      toast.error('Access denied (or is it?)');
    }
  };

  const executeSql = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post('/api/admin/execute-query', { sql: sqlQuery });
      setSqlResult(res.data);
      toast.success('Query executed');
    } catch (err) {
      setSqlResult({ error: err.response?.data?.error || 'Query failed' });
      toast.error('Query failed');
    }
  };

  const adjustBalance = async (e) => {
    e.preventDefault();
    try {
      // VULN: Log injection via reason field
      await api.post('/api/admin/adjust-balance', {
        userId: parseInt(adjustUserId),
        amount: parseFloat(adjustAmount),
        reason: adjustReason  // VULN: unsanitized in audit log
      });
      toast.success('Balance adjusted');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed');
    }
  };

  // Trading halt via WebSocket - VULN: JWT role check from token body
  const haltTrading = () => {
    sendMessage('/app/admin.haltTrading', { symbol: haltSymbol, reason: haltReason });
    toast.warn(`Halt trading request sent for ${haltSymbol}`);
  };

  const resumeTrading = () => {
    sendMessage('/app/admin.resumeTrading', { symbol: haltSymbol });
    toast.success(`Resume trading request sent for ${haltSymbol}`);
  };

  // Price override via WebSocket - VULN: market manipulation
  const setPrice = () => {
    sendMessage('/app/admin.setPrice', { symbol: priceSymbol, price: parseFloat(priceValue) });
    toast.warn(`Price override sent: ${priceSymbol} = $${priceValue}`);
  };

  // Toggle user active status
  const toggleUser = async () => {
    try {
      const res = await api.put(`/api/admin/users/${toggleUserId}/toggle`);
      toast.success(res.data.message);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to toggle user');
    }
  };

  /* -- Column definitions for the users table -- */
  const userColumns = [
    { key: 'id', label: 'ID', render: (u) => <span style={{ color: colors.textMuted, fontFamily: "'SF Mono', monospace", fontSize: '12px' }}>{u.id}</span> },
    { key: 'username', label: 'Username', render: (u) => <span style={{ fontWeight: '700', color: colors.textPrimary }}>{u.username}</span> },
    {
      key: 'role', label: 'Role',
      render: (u) => <span style={{
        color: u.role === 'ADMIN' ? colors.red : colors.blue,
        fontWeight: '600', fontSize: '11px',
        padding: '2px 8px', borderRadius: '6px',
        backgroundColor: u.role === 'ADMIN' ? 'rgba(255,61,113,0.1)' : 'rgba(79,139,255,0.1)',
      }}>{u.role}</span>,
    },
    {
      key: 'balance', label: 'Balance', align: 'right',
      render: (u) => <span style={{ color: colors.green, fontWeight: '600' }}>${fmtNum(u.balance)}</span>,
    },
    {
      key: 'apiKey', label: 'API Key',
      render: (u) => <span style={{ fontFamily: "'SF Mono', monospace", fontSize: '11px', color: colors.amber }}>{u.apiKey}</span>,
    },
    {
      key: 'notes', label: 'Notes',
      cellStyle: { color: colors.textMuted, fontSize: '11px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' },
    },
  ];

  return (
    <PageLayout title="Admin Panel" titleColor={colors.red}>

      <Card variant="danger">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{
            padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600',
            backgroundColor: colors.redDark, color: colors.redLight,
            border: '1px solid rgba(255,61,113,0.2)',
          }}>
            {user?.role}
          </span>
          <span style={{ color: colors.redLight }}>
            Logged in as <strong>{user?.username}</strong>
          </span>
        </div>
        {isDebug && (
          <p style={{ color: colors.textMuted, marginTop: '10px', fontSize: '13px', lineHeight: '1.5' }}>
            VULN: This page is only hidden via client-side conditional render.
            Any authenticated user can navigate to /admin.
          </p>
        )}
      </Card>

      {/* User Management */}
      <Card title="User Management">
        <Button variant="blue" onClick={loadUsers} style={{ marginBottom: '16px' }}>Load All Users</Button>
        {users.length > 0 && (
          <DataTable
            columns={userColumns}
            data={users}
            rowKey={(u) => u.id}
            small
            maxHeight="300px"
            headerBorder="heavy"
          />
        )}
      </Card>

      {/* SQL Execution */}
      <Card variant="warning" title="SQL Query Executor" titleColor={colors.amber}>
        <form onSubmit={executeSql}>
          <textarea
            value={sqlQuery}
            onChange={(e) => setSqlQuery(e.target.value)}
            rows={3}
            style={{ ...textareaStyle, marginBottom: '10px' }}
          />
          <Button type="submit" variant="amber">Execute SQL</Button>
        </form>
        <JsonPreview data={sqlResult} />
      </Card>

      {/* Balance Adjustment - VULN: log injection via reason */}
      <Card title="Balance Adjustment">
        <form onSubmit={adjustBalance} style={flexRowWrap('10px')}>
          <FormField label="User ID">
            <Input type="number" value={adjustUserId} onChange={(e) => setAdjustUserId(e.target.value)}
              width="100px" placeholder="User ID" />
          </FormField>
          <FormField label="Amount (+/-)">
            <Input type="number" value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)}
              width="150px" placeholder="Amount" step="0.01" />
          </FormField>
          <FormField label={isDebug ? "Reason (log injection)" : "Reason"}>
            {/* VULN: Reason field logged without sanitization */}
            <Input type="text" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)}
              width="250px" placeholder={isDebug ? "Reason (try: test\\nFAKE_LOG_ENTRY)" : "Admin adjustment reason"} />
          </FormField>
          <Button type="submit" variant="green">Adjust</Button>
        </form>
      </Card>

      {/* Trading Halt Controls - VULN: accessible by any user via WS */}
      <Card variant="warning" title="Trading Halt Controls" titleColor={colors.amber}
        hint={isDebug ? "VULN: Uses JWT role from token body (modifiable). Sends via WebSocket." : undefined}>
        <div style={flexRowWrap('10px')}>
          <FormField label="Symbol">
            <Input type="text" value={haltSymbol} onChange={(e) => setHaltSymbol(e.target.value)} width="120px" />
          </FormField>
          <FormField label="Reason">
            <Input type="text" value={haltReason} onChange={(e) => setHaltReason(e.target.value)} width="250px" />
          </FormField>
          <Button variant="red" onClick={haltTrading}>Halt Trading</Button>
          <Button variant="green" onClick={resumeTrading}>Resume Trading</Button>
        </div>
      </Card>

      {/* Price Override - VULN: market manipulation */}
      <Card variant="danger" title="Manual Price Override" titleColor={colors.red}
        hint={isDebug ? "VULN: Set arbitrary prices. No audit trail. Market manipulation." : undefined}>
        <div style={flexRowWrap('10px')}>
          <FormField label="Symbol">
            <Input type="text" value={priceSymbol} onChange={(e) => setPriceSymbol(e.target.value)} width="120px" />
          </FormField>
          <FormField label="New Price">
            <Input type="number" value={priceValue} onChange={(e) => setPriceValue(e.target.value)}
              step="0.01" placeholder="e.g. 9999.99" width="150px" />
          </FormField>
          <Button variant="red" onClick={setPrice}>Set Price</Button>
        </div>
      </Card>

      {/* User Toggle - activate/deactivate */}
      <Card title="User Account Toggle">
        <div style={flexRowWrap('10px')}>
          <FormField label="User ID">
            <Input type="number" value={toggleUserId} onChange={(e) => setToggleUserId(e.target.value)}
              width="100px" placeholder="User ID" />
          </FormField>
          <Button variant="purple" onClick={toggleUser}>Toggle Active/Inactive</Button>
        </div>
      </Card>

      {/* Endpoint Reference - debug only */}
      {isDebug && (
        <Card title="Vulnerable Endpoints Reference">
          <div style={{ display: 'grid', gap: '6px' }}>
            {[
              { method: 'GET', path: '/actuator/env', desc: 'Environment variables (secrets, flags)' },
              { method: 'GET', path: '/actuator/heapdump', desc: 'JVM heap dump (Flag 8)' },
              { method: 'POST', path: '/api/auth/login-legacy', desc: 'SQL injection in username' },
              { method: 'GET', path: '/api/users/1', desc: 'IDOR: admin profile (Flag 2 in notes)' },
              { method: 'GET', path: '/api/users/3/portfolio', desc: 'IDOR: trader2 portfolio (Flag 6)' },
              { method: 'POST', path: '/api/debug/execute', desc: 'RCE (X-Debug-Key: vulntrade-debug-key-2024)' },
              { method: 'CLI', path: 'redis-cli GET flag3', desc: 'Redis no auth (Flag 3)' },
            ].map(({ method, path, desc }) => (
              <div key={path} style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '8px 12px', borderRadius: '8px',
                backgroundColor: colors.bgStat, fontSize: '13px',
              }}>
                <span style={{
                  padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '700',
                  backgroundColor: method === 'GET' ? colors.blueDark : method === 'POST' ? colors.greenDark : colors.purpleDark,
                  color: method === 'GET' ? colors.blueLight : method === 'POST' ? colors.greenLight : colors.purpleLight,
                  fontFamily: "'SF Mono', monospace", minWidth: '36px', textAlign: 'center',
                }}>{method}</span>
                <code style={{ color: colors.amber, fontFamily: "'SF Mono', monospace", fontSize: '12px' }}>{path}</code>
                <span style={{ color: colors.textMuted, marginLeft: 'auto', fontSize: '12px' }}>{desc}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </PageLayout>
  );
}

export default AdminPage;
