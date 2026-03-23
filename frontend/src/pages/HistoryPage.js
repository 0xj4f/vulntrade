import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/apiService';
import { sendMessage } from '../services/websocketService';
import { toast } from 'react-toastify';

/**
 * PHASE 6: Trade History page
 * - VULN: SQL injection via date parameters (WebSocket getHistory)
 * - VULN: CSV export with injection payloads
 * - VULN: IDOR via userId parameter on export
 */
function HistoryPage() {
  const { user } = useAuth();
  const [trades, setTrades] = useState([]);
  const [startDate, setStartDate] = useState('2020-01-01');
  const [endDate, setEndDate] = useState('2030-12-31');
  const [symbol, setSymbol] = useState('');

  // Fetch trades via REST export endpoint
  const fetchTrades = async () => {
    try {
      // VULN: userId param enables IDOR
      const params = new URLSearchParams();
      if (user?.userId) params.append('userId', user.userId);
      if (symbol) params.append('symbol', symbol);
      params.append('format', 'json');

      const res = await api.get(`/api/export/trades?${params.toString()}`);
      // Parse CSV or handle JSON
      if (typeof res.data === 'string') {
        // CSV response - parse it
        const lines = res.data.split('\n').filter(l => l.trim());
        if (lines.length > 1) {
          const headers = lines[0].split(',');
          const parsed = lines.slice(1).map(line => {
            const vals = line.split(',');
            const obj = {};
            headers.forEach((h, i) => { obj[h.trim()] = vals[i]?.trim(); });
            return obj;
          });
          setTrades(parsed);
        }
      } else if (Array.isArray(res.data)) {
        setTrades(res.data);
      }
      toast.success(`Loaded ${trades.length} trades`);
    } catch (err) {
      toast.error('Failed to load trades');
    }
  };

  // VULN: SQL injection via WebSocket getHistory
  const fetchViaWebSocket = () => {
    sendMessage('/app/trade.getHistory', {
      startDate: startDate,
      endDate: endDate,
      symbol: symbol || null
    });
    toast.info('History request sent via WebSocket (check console for response)');
  };

  // VULN: CSV export with potential injection
  const exportCSV = () => {
    const params = new URLSearchParams();
    if (user?.userId) params.append('userId', user.userId);
    if (symbol) params.append('symbol', symbol);

    // VULN: Opens export URL directly - CSV injection possible
    window.open(`/api/export/trades?${params.toString()}`, '_blank');
    toast.info('CSV export started');
  };

  // VULN: Export all trades - SQL injection via symbol param
  const exportAllTrades = () => {
    const params = new URLSearchParams();
    if (symbol) params.append('symbol', symbol);

    window.open(`/api/export/all-trades?${params.toString()}`, '_blank');
    toast.info('All trades export started');
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
      <h2 style={{ color: '#10b981', marginBottom: '24px' }}>Trade History</h2>

      {/* Filters */}
      <div style={cardStyle}>
        <h3 style={{ color: '#9ca3af', marginBottom: '12px' }}>Filters</h3>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={{ color: '#6b7280', fontSize: '12px', display: 'block', marginBottom: '4px' }}>Start Date</label>
            {/* VULN: Date sent to SQL injection-vulnerable endpoint */}
            <input type="text" value={startDate} onChange={e => setStartDate(e.target.value)}
              placeholder="2020-01-01 or SQL payload"
              style={{ ...inputStyle, width: '200px' }} />
          </div>
          <div>
            <label style={{ color: '#6b7280', fontSize: '12px', display: 'block', marginBottom: '4px' }}>End Date</label>
            <input type="text" value={endDate} onChange={e => setEndDate(e.target.value)}
              placeholder="2030-12-31 or SQL payload"
              style={{ ...inputStyle, width: '200px' }} />
          </div>
          <div>
            <label style={{ color: '#6b7280', fontSize: '12px', display: 'block', marginBottom: '4px' }}>Symbol</label>
            <input type="text" value={symbol} onChange={e => setSymbol(e.target.value)}
              placeholder="AAPL (or SQL injection)"
              style={{ ...inputStyle, width: '150px' }} />
          </div>
          <button onClick={fetchTrades} style={{
            padding: '10px 20px', backgroundColor: '#3b82f6',
            border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer'
          }}>
            Load Trades (REST)
          </button>
          <button onClick={fetchViaWebSocket} style={{
            padding: '10px 20px', backgroundColor: '#8b5cf6',
            border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer'
          }}>
            Load via WS (SQLi)
          </button>
          <button onClick={exportCSV} style={{
            padding: '10px 20px', backgroundColor: '#f59e0b',
            border: 'none', borderRadius: '6px', color: '#111827', cursor: 'pointer'
          }}>
            Export CSV
          </button>
          <button onClick={exportAllTrades} style={{
            padding: '10px 20px', backgroundColor: '#ef4444',
            border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer'
          }}>
            Export All (SQLi)
          </button>
        </div>
      </div>

      {/* Trades Table */}
      <div style={cardStyle}>
        <h3 style={{ color: '#9ca3af', marginBottom: '16px' }}>Trades ({trades.length})</h3>
        <div style={{ maxHeight: '500px', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #374151' }}>
                <th style={{ textAlign: 'left', padding: '6px', color: '#6b7280' }}>ID</th>
                <th style={{ textAlign: 'left', padding: '6px', color: '#6b7280' }}>Symbol</th>
                <th style={{ textAlign: 'left', padding: '6px', color: '#6b7280' }}>Side</th>
                <th style={{ textAlign: 'right', padding: '6px', color: '#6b7280' }}>Qty</th>
                <th style={{ textAlign: 'right', padding: '6px', color: '#6b7280' }}>Price</th>
                <th style={{ textAlign: 'left', padding: '6px', color: '#6b7280' }}>Status</th>
                <th style={{ textAlign: 'left', padding: '6px', color: '#6b7280' }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1f2937' }}>
                  <td style={{ padding: '6px', color: '#9ca3af' }}>{t.id || t['Trade ID'] || i}</td>
                  <td style={{ padding: '6px', color: '#e5e7eb' }}>{t.symbol || t.Symbol}</td>
                  <td style={{ padding: '6px', color: t.side === 'BUY' ? '#10b981' : '#ef4444' }}>
                    {t.side || t.Side || '—'}
                  </td>
                  <td style={{ padding: '6px', textAlign: 'right', color: '#e5e7eb' }}>
                    {t.quantity || t.Quantity || '—'}
                  </td>
                  <td style={{ padding: '6px', textAlign: 'right', color: '#10b981' }}>
                    ${Number(t.price || t.Price || 0).toFixed(2)}
                  </td>
                  <td style={{ padding: '6px', color: '#9ca3af' }}>{t.status || t.Status || '—'}</td>
                  <td style={{ padding: '6px', color: '#6b7280' }}>
                    {t.executedAt || t['Executed At'] || t.createdAt || '—'}
                  </td>
                </tr>
              ))}
              {trades.length === 0 && (
                <tr><td colSpan="7" style={{ padding: '16px', textAlign: 'center', color: '#4b5563' }}>
                  No trades loaded. Click "Load Trades" to fetch.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default HistoryPage;
