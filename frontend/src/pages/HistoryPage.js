import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { Download, FileDown, RefreshCw, Radio } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useDebug } from '../context/DebugContext';
import api from '../services/apiService';
import { sendMessage } from '../services/websocketService';
import { useStomp } from '../hooks/useStomp';
import PageLayout from '../components/PageLayout';
import Card from '../components/Card';
import DataTable from '../components/DataTable';
import Button from '../components/Button';
import FormField, { Input } from '../components/FormField';
import StatusBadge from '../components/StatusBadge';
import { Chip } from '../components/ui';
import { colors, num } from '../styles/shared';
import { fmtDate, fmtPrice, fmtQty } from '../utils/format';

/** RFC-4180-ish CSV parse (quoted fields, embedded commas/quotes). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some(v => v !== '')) rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(vals => Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? '').trim()])));
}

/**
 * Trade history.
 *
 * VULN (kept, #53/#90): start/end dates and symbol are free text sent to the SQL-injectable
 * WebSocket history query.
 * VULN (kept, #91): CSV export is unsanitised (formula injection) and takes a userId (IDOR).
 */
function HistoryPage() {
  const { user } = useAuth();
  const isDebug = useDebug();
  const [rows, setRows] = useState([]);
  const [source, setSource] = useState('orders');   // 'orders' (REST) | 'trades' (WebSocket)
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState('2020-01-01');
  const [endDate, setEndDate] = useState('2030-12-31');
  const [symbol, setSymbol] = useState('');
  const wsPending = useRef(false);

  useStomp('/user/queue/history', (response) => {
    if (!response || response.type !== 'TRADE_HISTORY') return;
    wsPending.current = false;
    setLoading(false);
    // Native SQL rows: [id, symbol, quantity, price, executed_at] (or objects from UNION payloads)
    const list = (response.trades || []).map(r => (Array.isArray(r)
      ? { id: r[0], symbol: r[1], quantity: r[2], price: r[3], executedAt: r[4] }
      : r));
    setRows(list);
    setSource('trades');
    toast.success(`Loaded ${list.length} trade${list.length === 1 ? '' : 's'}`);
  });

  useStomp('/user/queue/errors', (error) => {
    if (!wsPending.current) return;
    wsPending.current = false;
    setLoading(false);
    // VULN: Error messages reveal database structure
    toast.error(error?.message || 'History query failed', { autoClose: 8000 });
  });

  // VULN: userId param enables IDOR
  const loadOrders = useCallback(async (quiet = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (user?.userId) params.append('userId', user.userId);
      if (symbol) params.append('symbol', symbol);
      params.append('format', 'json');
      const res = await api.get(`/api/export/trades?${params.toString()}`, { responseType: 'text' });
      const list = typeof res.data === 'string' ? parseCsv(res.data) : Array.isArray(res.data) ? res.data : [];
      const mapped = list.map(o => ({
        id: o['Order ID'] ?? o.id, symbol: o.Symbol ?? o.symbol, side: o.Side ?? o.side, type: o.Type ?? o.orderType,
        quantity: o.Quantity ?? o.quantity, price: o.Price ?? o.price, status: o.Status ?? o.status,
        clientOrderId: o['Client Order ID'] ?? o.clientOrderId, createdAt: o['Created At'] ?? o.createdAt, executedAt: o['Executed At'] ?? o.executedAt,
      })).sort((a, b) => Number(b.id) - Number(a.id));
      setRows(mapped);
      setSource('orders');
      if (!quiet) toast.success(`Loaded ${mapped.length} order${mapped.length === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error('Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [user?.userId, symbol]);

  useEffect(() => { loadOrders(true); }, []); // eslint-disable-line

  // VULN: SQL injection via WebSocket getHistory
  const fetchViaWebSocket = () => {
    wsPending.current = true;
    if (!sendMessage('/app/trade.getHistory', { startDate, endDate, symbol: symbol || null })) {
      wsPending.current = false;
      toast.error('Not connected — try again in a moment');
      return;
    }
    setLoading(true);
  };

  const downloadBlob = (blob, filename) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  // VULN: CSV export with potential injection; userId param enables IDOR
  const exportCSV = async () => {
    try {
      const params = new URLSearchParams();
      if (user?.userId) params.append('userId', user.userId);
      if (symbol) params.append('symbol', symbol);
      const res = await api.get(`/api/export/trades?${params.toString()}`, { responseType: 'blob' });
      downloadBlob(res.data, 'trades.csv');
      toast.success('CSV exported');
    } catch (err) {
      toast.error('Export failed');
    }
  };

  // VULN: Export all trades - SQL injection via symbol param
  const exportAllTrades = async () => {
    try {
      const params = new URLSearchParams();
      if (symbol) params.append('symbol', symbol);
      const res = await api.get(`/api/export/all-trades?${params.toString()}`, { responseType: 'blob' });
      downloadBlob(res.data, 'all-trades.csv');
      toast.success('All trades exported');
    } catch (err) {
      toast.error('Export failed');
    }
  };

  const orderColumns = [
    { key: 'id', label: 'Order', render: o => <span style={{ ...num, color: colors.textMuted }}>#{o.id}</span> },
    { key: 'symbol', label: 'Symbol', render: o => <span style={{ fontWeight: 600 }}>{o.symbol}</span> },
    { key: 'side', label: 'Side', render: o => (o.side ? <Chip tone={o.side === 'BUY' ? 'up' : 'down'}>{o.side}</Chip> : '—') },
    { key: 'type', label: 'Type', render: o => <span style={{ color: colors.textSecondary }}>{o.type || '—'}</span> },
    { key: 'quantity', label: 'Qty', align: 'right', render: o => fmtQty(o.quantity) },
    { key: 'price', label: 'Price', align: 'right', render: o => (o.price && o.price !== 'null' ? fmtPrice(o.price) : 'MKT') },
    { key: 'status', label: 'Status', render: o => <StatusBadge status={o.status} /> },
    { key: 'coid', label: 'Client ID', render: o => <span style={{ ...num, color: colors.textDim, fontSize: '11.5px' }}>{o.clientOrderId && o.clientOrderId !== 'null' ? o.clientOrderId : '—'}</span> },
    { key: 'created', label: 'Placed', render: o => <span style={{ color: colors.textMuted }}>{fmtDate(o.createdAt)}</span> },
  ];
  const tradeColumns = [
    { key: 'id', label: 'Trade', render: (t, i) => <span style={{ ...num, color: colors.textMuted }}>#{t.id ?? i}</span> },
    { key: 'symbol', label: 'Symbol', render: t => <span style={{ fontWeight: 600 }}>{String(t.symbol ?? '')}</span> },
    { key: 'quantity', label: 'Qty', align: 'right', render: t => (Number.isFinite(Number(t.quantity)) ? fmtQty(t.quantity) : String(t.quantity ?? '—')) },
    { key: 'price', label: 'Price', align: 'right', render: t => (Number.isFinite(Number(t.price)) ? fmtPrice(t.price) : String(t.price ?? '—')) },
    { key: 'date', label: 'Executed', render: t => <span style={{ color: colors.textMuted }}>{fmtDate(t.executedAt) !== '—' ? fmtDate(t.executedAt) : String(t.executedAt ?? '—')}</span> },
  ];

  return (
    <PageLayout title="History" subtitle="Your orders and executed trades — export for your records">
      <Card title="Filters & export">
        <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          <FormField label="Start date">
            {/* VULN: Date sent to SQL injection-vulnerable endpoint */}
            <Input type="text" value={startDate} onChange={e => setStartDate(e.target.value)}
              placeholder={isDebug ? '2020-01-01 or SQL payload' : 'YYYY-MM-DD'} style={{ width: '100%' }} />
          </FormField>
          <FormField label="End date">
            <Input type="text" value={endDate} onChange={e => setEndDate(e.target.value)}
              placeholder={isDebug ? '2030-12-31 or SQL payload' : 'YYYY-MM-DD'} style={{ width: '100%' }} />
          </FormField>
          <FormField label="Symbol">
            <Input type="text" value={symbol} onChange={e => setSymbol(e.target.value)}
              placeholder={isDebug ? 'Symbol (or SQL injection)' : 'All symbols'} style={{ width: '100%' }} />
          </FormField>
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' }}>
          <Button variant="blue" icon={<RefreshCw size={14} aria-hidden="true" />} onClick={() => loadOrders(false)} loading={loading && source === 'orders'}>Load orders</Button>
          <Button variant="purple" icon={<Radio size={14} aria-hidden="true" />} onClick={fetchViaWebSocket}>{isDebug ? 'Load trades via WS (SQLi)' : 'Load executed trades'}</Button>
          <span style={{ flex: 1 }} />
          <Button variant="gray" icon={<FileDown size={14} aria-hidden="true" />} onClick={exportCSV}>Export CSV</Button>
          <Button variant="gray" icon={<Download size={14} aria-hidden="true" />} onClick={exportAllTrades}>{isDebug ? 'Export all (SQLi)' : 'Export all trades'}</Button>
        </div>
      </Card>

      <Card flush title={source === 'orders' ? 'Orders' : 'Executed trades'} subtitle={`${rows.length} row${rows.length === 1 ? '' : 's'}`}>
        <DataTable
          small
          maxHeight="560px"
          columns={source === 'orders' ? orderColumns : tradeColumns}
          data={rows}
          rowKey={(r, i) => `${r.id}-${i}`}
          emptyText={loading ? 'Loading…' : 'Nothing here yet — place a trade from the dashboard.'}
        />
      </Card>
    </PageLayout>
  );
}

export default HistoryPage;
