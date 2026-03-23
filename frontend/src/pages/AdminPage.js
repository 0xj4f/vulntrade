import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/apiService';
import { sendMessage } from '../services/websocketService';
import { toast } from 'react-toastify';

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
    sendMessage('/app/admin.haltTrading', {
      symbol: haltSymbol,
      reason: haltReason
    });
    toast.warn(`Halt trading request sent for ${haltSymbol}`);
  };

  const resumeTrading = () => {
    sendMessage('/app/admin.resumeTrading', {
      symbol: haltSymbol
    });
    toast.success(`Resume trading request sent for ${haltSymbol}`);
  };

  // Price override via WebSocket - VULN: market manipulation
  const setPrice = () => {
    sendMessage('/app/admin.setPrice', {
      symbol: priceSymbol,
      price: parseFloat(priceValue)
    });
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

  const cardStyle = {
    backgroundColor: '#111827', padding: '20px', borderRadius: '8px',
    marginBottom: '20px', border: '1px solid #1f2937'
  };

  const inputStyle = {
    padding: '10px', backgroundColor: '#1f2937',
    border: '1px solid #374151', borderRadius: '6px', color: '#e5e7eb',
    boxSizing: 'border-box'
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <h2 style={{ color: '#ef4444', marginBottom: '24px' }}>⚠️ Admin Panel</h2>

      <div style={{ ...cardStyle, border: '1px solid #7f1d1d' }}>
        <p style={{ color: '#fca5a5' }}>
          Logged in as: <strong>{user?.username}</strong> (Role: {user?.role})
        </p>
        <p style={{ color: '#6b7280', marginTop: '8px', fontSize: '14px' }}>
          VULN: This page is only hidden via client-side conditional render.
          Any authenticated user can navigate to /admin.
        </p>
      </div>

      {/* User Management */}
      <div style={cardStyle}>
        <h3 style={{ color: '#9ca3af', marginBottom: '12px' }}>User Management</h3>
        <button onClick={loadUsers} style={{
          padding: '10px 20px', backgroundColor: '#3b82f6',
          border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer',
          marginBottom: '12px'
        }}>
          Load All Users
        </button>
        {users.length > 0 && (
          <div style={{ overflow: 'auto', maxHeight: '300px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #374151' }}>
                  <th style={{ padding: '6px', textAlign: 'left', color: '#6b7280' }}>ID</th>
                  <th style={{ padding: '6px', textAlign: 'left', color: '#6b7280' }}>Username</th>
                  <th style={{ padding: '6px', textAlign: 'left', color: '#6b7280' }}>Role</th>
                  <th style={{ padding: '6px', textAlign: 'right', color: '#6b7280' }}>Balance</th>
                  <th style={{ padding: '6px', textAlign: 'left', color: '#6b7280' }}>API Key</th>
                  <th style={{ padding: '6px', textAlign: 'left', color: '#6b7280' }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} style={{ borderBottom: '1px solid #1f2937' }}>
                    <td style={{ padding: '6px' }}>{u.id}</td>
                    <td style={{ padding: '6px', fontWeight: 'bold' }}>{u.username}</td>
                    <td style={{ padding: '6px', color: u.role === 'ADMIN' ? '#ef4444' : '#9ca3af' }}>
                      {u.role}
                    </td>
                    <td style={{ padding: '6px', textAlign: 'right', color: '#10b981' }}>
                      ${Number(u.balance).toLocaleString()}
                    </td>
                    <td style={{ padding: '6px', fontFamily: 'monospace', fontSize: '11px', color: '#f59e0b' }}>
                      {u.apiKey}
                    </td>
                    <td style={{ padding: '6px', color: '#6b7280', fontSize: '11px', maxWidth: '200px', overflow: 'hidden' }}>
                      {u.notes}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SQL Execution */}
      <div style={{ ...cardStyle, border: '1px solid #92400e' }}>
        <h3 style={{ color: '#f59e0b', marginBottom: '12px' }}>SQL Query Executor</h3>
        <form onSubmit={executeSql}>
          <textarea
            value={sqlQuery}
            onChange={(e) => setSqlQuery(e.target.value)}
            rows={3}
            style={{
              ...inputStyle, width: '100%', fontFamily: 'monospace',
              marginBottom: '8px', resize: 'vertical'
            }}
          />
          <button type="submit" style={{
            padding: '10px 20px', backgroundColor: '#f59e0b',
            border: 'none', borderRadius: '6px', color: '#111827',
            fontWeight: 'bold', cursor: 'pointer'
          }}>
            Execute SQL
          </button>
        </form>
        {sqlResult && (
          <pre style={{
            marginTop: '12px', padding: '12px', backgroundColor: '#0f172a',
            borderRadius: '6px', fontSize: '12px', overflow: 'auto',
            color: '#a5b4fc', maxHeight: '300px'
          }}>
            {JSON.stringify(sqlResult, null, 2)}
          </pre>
        )}
      </div>

      {/* Balance Adjustment - VULN: log injection via reason */}
      <div style={cardStyle}>
        <h3 style={{ color: '#9ca3af', marginBottom: '12px' }}>Balance Adjustment</h3>
        <form onSubmit={adjustBalance} style={{ display: 'flex', gap: '8px', alignItems: 'end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', color: '#6b7280', fontSize: '12px', marginBottom: '4px' }}>User ID</label>
            <input type="number" value={adjustUserId} onChange={(e) => setAdjustUserId(e.target.value)}
              style={{ ...inputStyle, width: '100px' }} placeholder="User ID" />
          </div>
          <div>
            <label style={{ display: 'block', color: '#6b7280', fontSize: '12px', marginBottom: '4px' }}>Amount (+/-)</label>
            <input type="number" value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)}
              style={{ ...inputStyle, width: '150px' }} placeholder="Amount" step="0.01" />
          </div>
          <div>
            <label style={{ display: 'block', color: '#6b7280', fontSize: '12px', marginBottom: '4px' }}>
              Reason (VULN: log injection)
            </label>
            {/* VULN: Reason field logged without sanitization */}
            <input type="text" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)}
              style={{ ...inputStyle, width: '250px' }}
              placeholder="Reason (try: test\nFAKE_LOG_ENTRY)" />
          </div>
          <button type="submit" style={{
            padding: '10px 20px', backgroundColor: '#10b981',
            border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer'
          }}>
            Adjust
          </button>
        </form>
      </div>

      {/* Trading Halt Controls - VULN: accessible by any user via WS */}
      <div style={{ ...cardStyle, border: '1px solid #92400e' }}>
        <h3 style={{ color: '#f59e0b', marginBottom: '12px' }}>⚡ Trading Halt Controls</h3>
        <p style={{ color: '#6b7280', fontSize: '12px', marginBottom: '12px' }}>
          VULN: Uses JWT role from token body (modifiable). Sends via WebSocket.
        </p>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', color: '#6b7280', fontSize: '12px', marginBottom: '4px' }}>Symbol</label>
            <input type="text" value={haltSymbol} onChange={(e) => setHaltSymbol(e.target.value)}
              style={{ ...inputStyle, width: '120px' }} />
          </div>
          <div>
            <label style={{ display: 'block', color: '#6b7280', fontSize: '12px', marginBottom: '4px' }}>Reason</label>
            <input type="text" value={haltReason} onChange={(e) => setHaltReason(e.target.value)}
              style={{ ...inputStyle, width: '250px' }} />
          </div>
          <button onClick={haltTrading} style={{
            padding: '10px 20px', backgroundColor: '#ef4444',
            border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer'
          }}>
            🛑 Halt Trading
          </button>
          <button onClick={resumeTrading} style={{
            padding: '10px 20px', backgroundColor: '#10b981',
            border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer'
          }}>
            ▶️ Resume Trading
          </button>
        </div>
      </div>

      {/* Price Override - VULN: market manipulation */}
      <div style={{ ...cardStyle, border: '1px solid #7f1d1d' }}>
        <h3 style={{ color: '#ef4444', marginBottom: '12px' }}>💰 Manual Price Override</h3>
        <p style={{ color: '#6b7280', fontSize: '12px', marginBottom: '12px' }}>
          VULN: Set arbitrary prices. No audit trail. Market manipulation.
        </p>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'end' }}>
          <div>
            <label style={{ display: 'block', color: '#6b7280', fontSize: '12px', marginBottom: '4px' }}>Symbol</label>
            <input type="text" value={priceSymbol} onChange={(e) => setPriceSymbol(e.target.value)}
              style={{ ...inputStyle, width: '120px' }} />
          </div>
          <div>
            <label style={{ display: 'block', color: '#6b7280', fontSize: '12px', marginBottom: '4px' }}>New Price</label>
            <input type="number" value={priceValue} onChange={(e) => setPriceValue(e.target.value)}
              step="0.01" placeholder="e.g. 9999.99"
              style={{ ...inputStyle, width: '150px' }} />
          </div>
          <button onClick={setPrice} style={{
            padding: '10px 20px', backgroundColor: '#ef4444',
            border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer'
          }}>
            Set Price
          </button>
        </div>
      </div>

      {/* User Toggle - activate/deactivate */}
      <div style={cardStyle}>
        <h3 style={{ color: '#9ca3af', marginBottom: '12px' }}>User Account Toggle</h3>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'end' }}>
          <div>
            <label style={{ display: 'block', color: '#6b7280', fontSize: '12px', marginBottom: '4px' }}>User ID</label>
            <input type="number" value={toggleUserId} onChange={(e) => setToggleUserId(e.target.value)}
              style={{ ...inputStyle, width: '100px' }} placeholder="User ID" />
          </div>
          <button onClick={toggleUser} style={{
            padding: '10px 20px', backgroundColor: '#8b5cf6',
            border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer'
          }}>
            Toggle Active/Inactive
          </button>
        </div>
      </div>

      {/* Endpoint Reference */}
      <div style={cardStyle}>
        <h3 style={{ color: '#9ca3af', marginBottom: '12px' }}>Vulnerable Endpoints Reference</h3>
        <ul style={{ color: '#6b7280', lineHeight: '2', fontSize: '13px' }}>
          <li>GET /actuator/env — Environment variables (secrets, flags)</li>
          <li>GET /actuator/heapdump — JVM heap dump (Flag 8)</li>
          <li>POST /api/auth/login-legacy — SQL injection in username</li>
          <li>GET /api/users/1 — IDOR: admin profile (Flag 2 in notes)</li>
          <li>GET /api/users/3/portfolio — IDOR: trader2 portfolio (Flag 6)</li>
          <li>POST /api/debug/execute — RCE (X-Debug-Key: vulntrade-debug-key-2024)</li>
          <li>redis-cli -h localhost -p 6379 GET flag3 — Redis no auth (Flag 3)</li>
        </ul>
      </div>
    </div>
  );
}

export default AdminPage;
