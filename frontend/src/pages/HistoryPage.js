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
import { colors, flexRowWrap } from '../styles/shared';
import { fmtPrice, sideColor } from '../utils/format';

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

  /* -- Column definitions for the trades table -- */
  const tradeColumns = [
    { key: 'id', label: 'ID', render: (t, i) => <span style={{ color: colors.textMuted, fontFamily: "'SF Mono', monospace", fontSize: '12px' }}>{t.id || t['Trade ID'] || i}</span> },
    { key: 'symbol', label: 'Symbol', render: (t) => <span style={{ color: colors.textPrimary, fontWeight: '700', fontSize: '14px' }}>{t.symbol || t.Symbol}</span> },
    {
      key: 'side', label: 'Side',
      render: (t) => {
        const side = t.side || t.Side || '\u2014';
        return <span style={{
          color: sideColor(side),
          fontWeight: '600', fontSize: '12px',
          padding: '2px 8px', borderRadius: '6px',
          backgroundColor: side === 'BUY' ? 'rgba(0,214,143,0.1)' : 'rgba(255,61,113,0.1)',
        }}>{side}</span>;
      },
    },
    { key: 'quantity', label: 'Qty', align: 'right', render: (t) => <span style={{ fontWeight: '500' }}>{t.quantity || t.Quantity || '\u2014'}</span> },
    {
      key: 'price', label: 'Price', align: 'right',
      render: (t) => {
        const raw = t.price ?? t.Price ?? t.filledPrice;
        return (raw != null && raw !== '' && !isNaN(Number(raw)))
          ? <span style={{ color: colors.green, fontWeight: '500' }}>{fmtPrice(raw)}</span>
          : <span style={{ color: colors.textMuted }}>MKT</span>;
      },
    },
    { key: 'status', label: 'Status', render: (t) => <span style={{ color: colors.textSecondary, fontSize: '12px' }}>{t.status || t.Status || '\u2014'}</span> },
    { key: 'date', label: 'Date', render: (t) => <span style={{ color: colors.textMuted, fontSize: '12px' }}>{t.executedAt || t['Executed At'] || t.createdAt || '\u2014'}</span> },
  ];

  return (
    <PageLayout title="Trade History">

      {/* Filters */}
      <Card title="Filters & Export">
        <div style={flexRowWrap('10px')}>
          <FormField label="Start Date">
            {/* VULN: Date sent to SQL injection-vulnerable endpoint */}
            <Input type="text" value={startDate} onChange={e => setStartDate(e.target.value)}
              placeholder="2020-01-01 or SQL payload" width="200px" />
          </FormField>
          <FormField label="End Date">
            <Input type="text" value={endDate} onChange={e => setEndDate(e.target.value)}
              placeholder="2030-12-31 or SQL payload" width="200px" />
          </FormField>
          <FormField label="Symbol">
            <Input type="text" value={symbol} onChange={e => setSymbol(e.target.value)}
              placeholder="AAPL (or SQL injection)" width="150px" />
          </FormField>
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' }}>
          <Button variant="blue" onClick={fetchTrades}>Load Trades (REST)</Button>
          <Button variant="purple" onClick={fetchViaWebSocket}>Load via WS (SQLi)</Button>
          <Button variant="amber" onClick={exportCSV}>Export CSV</Button>
          <Button variant="red" onClick={exportAllTrades}>Export All (SQLi)</Button>
        </div>
      </Card>

      {/* Trades Table */}
      <Card title={<span>Trades <span style={{ color: colors.textMuted, fontWeight: '400', fontSize: '14px' }}>({trades.length})</span></span>}>
        <DataTable
          columns={tradeColumns}
          data={trades}
          small
          maxHeight="500px"
          emptyText='No trades loaded — click "Load Trades" to fetch.'
          headerBorder="heavy"
        />
      </Card>
    </PageLayout>
  );
}

export default HistoryPage;
