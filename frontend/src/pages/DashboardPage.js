import React, { useState, useEffect } from 'react';
import api from '../services/apiService';

function DashboardPage({ user }) {
  const [prices, setPrices] = useState([]);
  const [health, setHealth] = useState(null);

  useEffect(() => {
    // Fetch market prices
    api.get('/api/market/prices')
      .then(res => setPrices(res.data))
      .catch(err => console.error('Failed to fetch prices:', err));

    // Fetch health status
    api.get('/api/health')
      .then(res => setHealth(res.data))
      .catch(err => console.error('Failed to fetch health:', err));
  }, []);

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <h2 style={{ color: '#10b981', marginBottom: '24px' }}>Trading Dashboard</h2>

      {/* Health Status */}
      {health && (
        <div style={{
          backgroundColor: '#111827', padding: '16px', borderRadius: '8px',
          marginBottom: '24px', border: '1px solid #1f2937'
        }}>
          <h3 style={{ color: '#9ca3af', marginBottom: '8px' }}>System Status</h3>
          <span style={{
            color: health.status === 'UP' ? '#10b981' : '#ef4444',
            fontWeight: 'bold'
          }}>
            {health.status} — DB: {health.database} | Users: {health.users} | Symbols: {health.symbols}
          </span>
        </div>
      )}

      {/* User Info */}
      <div style={{
        backgroundColor: '#111827', padding: '16px', borderRadius: '8px',
        marginBottom: '24px', border: '1px solid #1f2937'
      }}>
        <h3 style={{ color: '#9ca3af', marginBottom: '8px' }}>Account</h3>
        <p>Username: <strong>{user?.username}</strong></p>
        <p>Role: <strong>{user?.role}</strong></p>
        <p>Balance: <strong style={{ color: '#10b981' }}>
          ${user?.balance ? Number(user.balance).toLocaleString() : '—'}
        </strong></p>
      </div>

      {/* Market Prices */}
      <div style={{
        backgroundColor: '#111827', padding: '16px', borderRadius: '8px',
        border: '1px solid #1f2937'
      }}>
        <h3 style={{ color: '#9ca3af', marginBottom: '16px' }}>Market Prices</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #374151' }}>
              <th style={{ textAlign: 'left', padding: '8px', color: '#6b7280' }}>Symbol</th>
              <th style={{ textAlign: 'left', padding: '8px', color: '#6b7280' }}>Name</th>
              <th style={{ textAlign: 'right', padding: '8px', color: '#6b7280' }}>Price</th>
              <th style={{ textAlign: 'right', padding: '8px', color: '#6b7280' }}>Bid</th>
              <th style={{ textAlign: 'right', padding: '8px', color: '#6b7280' }}>Ask</th>
              <th style={{ textAlign: 'right', padding: '8px', color: '#6b7280' }}>Volume</th>
            </tr>
          </thead>
          <tbody>
            {prices.map(p => (
              <tr key={p.symbol} style={{ borderBottom: '1px solid #1f2937' }}>
                <td style={{ padding: '8px', fontWeight: 'bold', color: '#e5e7eb' }}>
                  {/* VULN: dangerouslySetInnerHTML for symbol display */}
                  <span dangerouslySetInnerHTML={{ __html: p.symbol }} />
                </td>
                <td style={{ padding: '8px', color: '#9ca3af' }}>{p.name}</td>
                <td style={{ padding: '8px', textAlign: 'right', color: '#10b981' }}>
                  ${Number(p.currentPrice).toFixed(2)}
                </td>
                <td style={{ padding: '8px', textAlign: 'right', color: '#6b7280' }}>
                  ${p.bid ? Number(p.bid).toFixed(2) : '—'}
                </td>
                <td style={{ padding: '8px', textAlign: 'right', color: '#6b7280' }}>
                  ${p.ask ? Number(p.ask).toFixed(2) : '—'}
                </td>
                <td style={{ padding: '8px', textAlign: 'right', color: '#6b7280' }}>
                  {p.volume ? Number(p.volume).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default DashboardPage;
