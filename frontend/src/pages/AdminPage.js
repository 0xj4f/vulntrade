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
    { key: 'id', label: 'ID' },
    { key: 'username', label: 'Username', render: (u) => <span style={{ fontWeight: 'bold' }}>{u.username}</span> },
    {
      key: 'role', label: 'Role',
      render: (u) => <span style={{ color: u.role === 'ADMIN' ? colors.red : colors.textSecondary }}>{u.role}</span>,
    },
    {
      key: 'balance', label: 'Balance', align: 'right',
      render: (u) => <span style={{ color: colors.green }}>${Number(u.balance).toLocaleString()}</span>,
    },
    {
      key: 'apiKey', label: 'API Key',
      render: (u) => <span style={{ fontFamily: 'monospace', fontSize: '11px', color: colors.amber }}>{u.apiKey}</span>,
    },
    {
      key: 'notes', label: 'Notes',
      cellStyle: { color: colors.textMuted, fontSize: '11px', maxWidth: '200px', overflow: 'hidden' },
    },
  ];

  return (
    <PageLayout title="⚠️ Admin Panel" titleColor={colors.red}>

      <Card variant="danger">
        <p style={{ color: colors.redLight }}>
          Logged in as: <strong>{user?.username}</strong> (Role: {user?.role})
        </p>
        <p style={{ color: colors.textMuted, marginTop: '8px', fontSize: '14px' }}>
          VULN: This page is only hidden via client-side conditional render.
          Any authenticated user can navigate to /admin.
        </p>
      </Card>

      {/* User Management */}
      <Card title="User Management">
        <Button variant="blue" onClick={loadUsers} style={{ marginBottom: '12px' }}>Load All Users</Button>
        {users.length > 0 && (
          <DataTable
            columns={userColumns}
            data={users}
            rowKey={(u) => u.id}
            small
            maxHeight="300px"
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
            style={{ ...textareaStyle, marginBottom: '8px' }}
          />
          <Button type="submit" variant="amber">Execute SQL</Button>
        </form>
        <JsonPreview data={sqlResult} />
      </Card>

      {/* Balance Adjustment - VULN: log injection via reason */}
      <Card title="Balance Adjustment">
        <form onSubmit={adjustBalance} style={flexRowWrap()}>
          <FormField label="User ID">
            <Input type="number" value={adjustUserId} onChange={(e) => setAdjustUserId(e.target.value)}
              width="100px" placeholder="User ID" />
          </FormField>
          <FormField label="Amount (+/-)">
            <Input type="number" value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)}
              width="150px" placeholder="Amount" step="0.01" />
          </FormField>
          <FormField label="Reason (VULN: log injection)">
            {/* VULN: Reason field logged without sanitization */}
            <Input type="text" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)}
              width="250px" placeholder="Reason (try: test\nFAKE_LOG_ENTRY)" />
          </FormField>
          <Button type="submit" variant="green">Adjust</Button>
        </form>
      </Card>

      {/* Trading Halt Controls - VULN: accessible by any user via WS */}
      <Card variant="warning" title="⚡ Trading Halt Controls" titleColor={colors.amber}
        hint="VULN: Uses JWT role from token body (modifiable). Sends via WebSocket.">
        <div style={flexRowWrap()}>
          <FormField label="Symbol">
            <Input type="text" value={haltSymbol} onChange={(e) => setHaltSymbol(e.target.value)} width="120px" />
          </FormField>
          <FormField label="Reason">
            <Input type="text" value={haltReason} onChange={(e) => setHaltReason(e.target.value)} width="250px" />
          </FormField>
          <Button variant="red" onClick={haltTrading}>🛑 Halt Trading</Button>
          <Button variant="green" onClick={resumeTrading}>▶️ Resume Trading</Button>
        </div>
      </Card>

      {/* Price Override - VULN: market manipulation */}
      <Card variant="danger" title="💰 Manual Price Override" titleColor={colors.red}
        hint="VULN: Set arbitrary prices. No audit trail. Market manipulation.">
        <div style={flexRowWrap()}>
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
        <div style={flexRowWrap()}>
          <FormField label="User ID">
            <Input type="number" value={toggleUserId} onChange={(e) => setToggleUserId(e.target.value)}
              width="100px" placeholder="User ID" />
          </FormField>
          <Button variant="purple" onClick={toggleUser}>Toggle Active/Inactive</Button>
        </div>
      </Card>

      {/* Endpoint Reference */}
      <Card title="Vulnerable Endpoints Reference">
        <ul style={{ color: colors.textMuted, lineHeight: '2', fontSize: '13px' }}>
          <li>GET /actuator/env — Environment variables (secrets, flags)</li>
          <li>GET /actuator/heapdump — JVM heap dump (Flag 8)</li>
          <li>POST /api/auth/login-legacy — SQL injection in username</li>
          <li>GET /api/users/1 — IDOR: admin profile (Flag 2 in notes)</li>
          <li>GET /api/users/3/portfolio — IDOR: trader2 portfolio (Flag 6)</li>
          <li>POST /api/debug/execute — RCE (X-Debug-Key: vulntrade-debug-key-2024)</li>
          <li>redis-cli -h localhost -p 6379 GET flag3 — Redis no auth (Flag 3)</li>
        </ul>
      </Card>
    </PageLayout>
  );
}

export default AdminPage;
