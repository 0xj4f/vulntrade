import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { PieChart, RefreshCw, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useDebug } from '../context/DebugContext';
import { useMarketData } from '../context/MarketDataContext';
import api from '../services/apiService';
import PageLayout from '../components/PageLayout';
import Card from '../components/Card';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable';
import Button from '../components/Button';
import { Input } from '../components/FormField';
import { ChangeChip, Chip, EmptyState } from '../components/ui';
import { colors, debugBanner, num, type } from '../styles/shared';
import { fmtDate, fmtPct, fmtPnL, fmtPrice, fmtQty, fmtUSD, pnlColor } from '../utils/format';

const PALETTE = ['#3b82f6', '#16c784', '#f5a524', '#8b5cf6', '#06b6d4', '#ec4899', '#ea3943', '#84cc16', '#f97316', '#64748b'];

const TX_TONE = { DEPOSIT: 'up', WITHDRAW: 'down', TRADE_BUY: 'accent', TRADE_SELL: 'violet', ADJUSTMENT: 'warn' };

/**
 * Portfolio: equity, allocation, holdings and the cash ledger.
 *
 * VULN (kept, #74/#76): portfolio and transactions are fetched by userId (IDOR lookup in debug).
 * VULN (kept, FE-08/BIZ-11): P&L is computed here, in the browser.
 * VULN (kept): the portfolio response's notes field is shown in debug mode.
 */
function PortfolioPage() {
  const { user } = useAuth();
  const isDebug = useDebug();
  const { quotes } = useMarketData();
  const [portfolio, setPortfolio] = useState(null);
  const [positions, setPositions] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [lookupUserId, setLookupUserId] = useState('');
  const [viewing, setViewing] = useState(null);
  const [loading, setLoading] = useState(true);
  const ownId = user?.userId || user?.id;
  const targetId = viewing || ownId;

  // VULN: userId passed directly in URL - IDOR
  const fetchPortfolio = useCallback((userId) => api.get(`/api/users/${userId}/portfolio`)
    .then(res => { setPortfolio(res.data); setPositions(res.data.positions || []); })
    .catch(err => { console.error('Failed to fetch portfolio:', err); toast.error('Failed to load portfolio'); }), []);

  // VULN: userId passed in query param - IDOR
  const fetchTransactions = useCallback((userId) => api.get(`/api/accounts/transactions?userId=${userId}`)
    .then(res => setTransactions(Array.isArray(res.data) ? res.data : []))
    .catch(err => console.error('Failed to fetch transactions:', err)), []);

  const refresh = useCallback(() => {
    if (!targetId) return;
    Promise.all([fetchPortfolio(targetId), fetchTransactions(targetId)]).finally(() => setLoading(false));
  }, [targetId, fetchPortfolio, fetchTransactions]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const onUpdate = () => { if (!viewing) refresh(); };
    window.addEventListener('vt:order-update', onUpdate);
    return () => window.removeEventListener('vt:order-update', onUpdate);
  }, [refresh, viewing]);

  const handleLookupPortfolio = (e) => {
    e.preventDefault();
    if (!lookupUserId) return;
    setViewing(lookupUserId);
    toast.info(`Loading portfolio for user #${lookupUserId}`);
  };

  // VULN: P&L calculated entirely client-side - manipulable via DevTools.
  // A symbol without a live price falls back to its average cost (no phantom loss).
  const rows = useMemo(() => positions
    .filter(p => Number(p.quantity) > 0)
    .map(p => {
      const qty = Number(p.quantity), avg = Number(p.avgPrice || 0);
      const live = quotes[p.symbol] ? Number(quotes[p.symbol].currentPrice) : NaN;
      const last = Number.isFinite(live) && live > 0 ? live : avg;
      const value = last * qty, cost = avg * qty;
      return { ...p, qty, avg, last, value, cost, pnl: value - cost, pnlPct: cost > 0 ? (value - cost) / cost * 100 : 0, changePct: quotes[p.symbol]?.changePct };
    })
    .sort((a, b) => b.value - a.value), [positions, quotes]);

  const totals = useMemo(() => rows.reduce((t, r) => ({ value: t.value + r.value, cost: t.cost + r.cost, pnl: t.pnl + r.pnl }), { value: 0, cost: 0, pnl: 0 }), [rows]);
  const realized = useMemo(() => positions.reduce((s, p) => s + Number(p.realizedPnl || 0), 0), [positions]);
  const cash = Number(portfolio?.balance ?? (viewing ? 0 : user?.balance) ?? 0);
  const equity = cash + totals.value;
  const allocation = useMemo(() => {
    const parts = rows.map((r, i) => ({ label: r.symbol, value: r.value, color: PALETTE[i % PALETTE.length] }));
    if (cash > 0) parts.push({ label: 'Cash', value: cash, color: 'var(--vt-border-strong)' });
    const total = parts.reduce((s, p) => s + p.value, 0) || 1;
    return parts.map(p => ({ ...p, pct: (p.value / total) * 100 }));
  }, [rows, cash]);

  return (
    <PageLayout
      title={viewing ? `Portfolio · user #${viewing}` : 'Portfolio'}
      subtitle={viewing ? 'Viewing another account' : 'Your holdings, performance and cash activity'}
      actions={<>
        {viewing && <Button variant="gray" onClick={() => setViewing(null)}>Back to mine</Button>}
        <Button variant="gray" icon={<RefreshCw size={14} aria-hidden="true" />} onClick={refresh}>Refresh</Button>
      </>}
    >
      {/* Equity hero */}
      <section style={{ background: colors.bgCard, border: `1px solid ${colors.borderDefault}`, borderRadius: 'var(--vt-radius-lg)', padding: '20px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <div style={{ ...type.caps, marginBottom: '6px' }}>Total equity</div>
            <div style={{ ...type.display, ...num }}>{loading ? <span className="skeleton" style={{ display: 'inline-block', width: '220px', height: '36px' }} /> : fmtUSD(equity)}</div>
            <div style={{ marginTop: '6px', display: 'flex', gap: '10px', alignItems: 'center', fontSize: '13px' }}>
              <span style={{ ...num, color: pnlColor(totals.pnl), fontWeight: 600 }}>{fmtPnL(totals.pnl)}</span>
              <ChangeChip value={totals.cost > 0 ? (totals.pnl / totals.cost) * 100 : 0} solid />
              <span style={{ color: colors.textMuted }}>unrealized</span>
            </div>
          </div>
          <div className="vt-stats" style={{ flex: '1 1 560px', maxWidth: '760px', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
            <StatCard label="Cash" value={fmtUSD(cash)} valueSize="18px" />
            <StatCard label="Invested" value={fmtUSD(totals.value)} valueSize="18px" sub={`cost ${fmtUSD(totals.cost)}`} />
            <StatCard label="Realized P&L" value={fmtPnL(realized)} valueColor={pnlColor(realized)} valueSize="18px" />
            <StatCard label="Positions" value={rows.length} valueSize="18px" />
          </div>
        </div>

        {/* Allocation */}
        {allocation.length > 0 && equity > 0 && (
          <div style={{ marginTop: '20px' }}>
            <div style={{ ...type.caps, marginBottom: '8px' }}>Allocation</div>
            <div role="img" aria-label={`Allocation: ${allocation.map(a => `${a.label} ${a.pct.toFixed(1)}%`).join(', ')}`}
              style={{ display: 'flex', height: '10px', borderRadius: '999px', overflow: 'hidden', gap: '2px', background: colors.bgRaised }}>
              {allocation.map(a => <span key={a.label} style={{ width: `${a.pct}%`, background: a.color, minWidth: a.pct > 0 ? '3px' : 0 }} />)}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: '10px' }}>
              {allocation.map(a => (
                <span key={a.label} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: colors.textSecondary }}>
                  <span aria-hidden="true" style={{ width: '8px', height: '8px', borderRadius: '2px', background: a.color }} />
                  {a.label} <span style={{ ...num, color: colors.textMuted }}>{a.pct.toFixed(1)}%</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* VULN: Notes field exposed - may contain flags */}
        {isDebug && portfolio?.notes && <div style={{ ...debugBanner, marginTop: '16px', marginBottom: 0 }}>Notes: {portfolio.notes}</div>}
      </section>

      <Card title="Holdings" flush subtitle={rows.length ? `${rows.length} open position${rows.length === 1 ? '' : 's'}` : null}>
        <DataTable
          rowKey={r => r.symbol}
          data={rows}
          empty={<EmptyState icon={<PieChart size={22} />} title="No holdings yet" action={<Link to="/dashboard">Go to markets →</Link>}>Positions you buy show up here with live P&L.</EmptyState>}
          columns={[
            { key: 'symbol', label: 'Asset', render: r => (
              <Link to={`/symbol/${encodeURIComponent(r.symbol)}`} style={{ color: colors.textPrimary, fontWeight: 600 }}>{r.symbol}</Link>
            ) },
            { key: 'qty', label: 'Quantity', align: 'right', render: r => fmtQty(r.qty) },
            { key: 'avg', label: 'Avg cost', align: 'right', render: r => fmtPrice(r.avg) },
            { key: 'last', label: 'Last', align: 'right', render: r => fmtPrice(r.last) },
            { key: 'day', label: 'Session', align: 'right', render: r => <ChangeChip value={r.changePct} size="sm" /> },
            { key: 'value', label: 'Value', align: 'right', render: r => <span style={{ fontWeight: 600 }}>{fmtUSD(r.value)}</span> },
            { key: 'weight', label: 'Weight', align: 'right', render: r => <span style={{ color: colors.textMuted }}>{equity > 0 ? `${(r.value / equity * 100).toFixed(1)}%` : '—'}</span> },
            { key: 'pnl', label: 'Unrealized', align: 'right', render: r => <span style={{ color: pnlColor(r.pnl), fontWeight: 600 }}>{fmtPnL(r.pnl)}</span> },
            { key: 'pnlPct', label: 'Return', align: 'right', render: r => <span style={{ color: pnlColor(r.pnlPct), fontWeight: 600 }}>{fmtPct(r.pnlPct)}</span> },
            { key: 'realized', label: 'Realized', align: 'right', render: r => <span style={{ color: pnlColor(r.realizedPnl) }}>{fmtPnL(r.realizedPnl || 0)}</span> },
          ]}
        />
      </Card>

      <Card title="Cash activity" flush subtitle="Deposits, withdrawals, trades and adjustments">
        <DataTable
          small
          maxHeight="380px"
          rowKey={tx => tx.id}
          data={transactions.slice().sort((a, b) => (b.id || 0) - (a.id || 0))}
          emptyText="No transactions yet"
          columns={[
            { key: 'createdAt', label: 'Date', render: tx => <span style={{ color: colors.textMuted }}>{fmtDate(tx.createdAt)}</span> },
            { key: 'type', label: 'Type', render: tx => <Chip tone={TX_TONE[tx.type] || 'neutral'}>{(tx.type || '').replace('_', ' ')}</Chip> },
            { key: 'description', label: 'Description', render: tx => <span style={{ color: colors.textSecondary }}>{tx.description}</span> },
            { key: 'amount', label: 'Amount', align: 'right', render: tx => <span style={{ color: pnlColor(tx.amount), fontWeight: 600 }}>{fmtPnL(tx.amount)}</span> },
            { key: 'balanceAfter', label: 'Balance', align: 'right', render: tx => <span style={{ color: colors.textSecondary }}>{fmtUSD(tx.balanceAfter)}</span> },
            { key: 'id', label: 'Ref', align: 'right', render: tx => <span style={{ color: colors.textDim }}>#{tx.id}</span> },
          ]}
        />
      </Card>

      {/* VULN: Portfolio Lookup - IDOR demonstration */}
      {isDebug && (
        <Card variant="danger" title="View another user's portfolio (IDOR)" titleColor={colors.red}
          hint="Try user IDs: 1 (admin), 2 (trader1), 3 (trader2 - has Flag 6 in notes)">
          <form onSubmit={handleLookupPortfolio} style={{ display: 'flex', gap: '8px' }}>
            <Input type="number" value={lookupUserId} onChange={(e) => setLookupUserId(e.target.value)}
              placeholder="Enter User ID" min="1" aria-label="User ID" style={{ flex: 1 }} />
            <Button type="submit" variant="red" icon={<Search size={14} aria-hidden="true" />}>View portfolio</Button>
          </form>
        </Card>
      )}
    </PageLayout>
  );
}

export default PortfolioPage;
