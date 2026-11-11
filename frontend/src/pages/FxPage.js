import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useDebug } from '../context/DebugContext';
import api from '../services/apiService';
import { newClientOrderId } from '../services/orderTracker';
import { useStomp } from '../hooks/useStomp';
import PageLayout from '../components/PageLayout';
import Card from '../components/Card';
import DataTable from '../components/DataTable';
import Button from '../components/Button';
import StatusBadge from '../components/StatusBadge';
import FormField, { Input } from '../components/FormField';
import { Chip, KV, PriceText, Segmented } from '../components/ui';
import { colors, num, selectStyle, type } from '../styles/shared';
import { fmtDate, fmtQty, fmtTime, sideColor } from '../utils/format';

/** Rates: 3 decimals for yen pairs, 5 for the others (one digit past the pip). */
const isYen = (pair) => String(pair || '').endsWith('JPY');
const fmtRate = (pair, value) => (value != null && Number.isFinite(Number(value)) ? Number(value).toFixed(isYen(pair) ? 3 : 5) : '—');
const pipSize = (pair) => (isYen(pair) ? 0.01 : 0.0001);
/** Currency amounts: no decimals for JPY, 2 for the others. */
const fmtAmount = (ccy, value) => {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const d = ccy === 'JPY' ? 0 : 2;
  return Number(value).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
};
const mid = (q) => (Number(q.bid) + Number(q.ask)) / 2;

/**
 * FX: spot currencies against the house dealer (/api/fx). Every order fills at once, on a quote.
 *
 * Quotes: GET /api/fx/quotes, then /topic/fx/prices on the FX socket (about once a second per pair).
 * Trade:  POST /api/fx/orders { pair, side, amount (base currency), quoteId } -> FILLED | REJECTED.
 * Money:  the FX account (USD, EUR, GBP, JPY); fund it from MAIN with a transfer on the Account page.
 *
 * VULN (kept, FE-09/#71): a hidden, editable user id travels with every order.
 * VULN (kept, FX-6): every quote carries the bank prices, our margin and the House position;
 *   they are shown in debug mode, like the other internal price fields.
 */
function FxPage() {
  const { user } = useAuth();
  const isDebug = useDebug();
  const userId = user?.userId || user?.id;
  const [quotes, setQuotes] = useState({});          // pair -> latest quote (+ dir, tick for the flash)
  const [pair, setPair] = useState('EURUSD');
  const [side, setSide] = useState('BUY');
  const [amount, setAmount] = useState('1000');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [balances, setBalances] = useState([]);
  const [orders, setOrders] = useState([]);

  const applyQuote = useCallback((q) => {
    if (!q || !q.pair) return;
    setQuotes(prev => {
      const old = prev[q.pair];
      const dir = old && mid(q) !== mid(old) ? (mid(q) > mid(old) ? 'up' : 'down') : old?.dir;
      return { ...prev, [q.pair]: { ...q, dir, tick: (old?.tick || 0) + 1 } };
    });
  }, []);

  const loadAccount = useCallback(() => {
    api.get('/api/fx/balances')
      .then(res => setBalances(res.data?.balances || []))
      .catch(err => console.error('Failed to fetch FX balances:', err));
    api.get('/api/fx/orders')
      .then(res => setOrders(Array.isArray(res.data) ? res.data : []))
      .catch(err => console.error('Failed to fetch FX orders:', err));
  }, []);

  useEffect(() => {
    api.get('/api/fx/quotes')
      .then(res => (Array.isArray(res.data) ? res.data : []).forEach(applyQuote))
      .catch(err => console.error('Failed to fetch FX quotes:', err));
    loadAccount();
  }, [applyQuote, loadAccount]);

  useStomp('/topic/fx/prices', applyQuote, 'fx');
  useStomp('/user/queue/order-updates', () => loadAccount(), 'fx');

  const pairs = Object.keys(quotes);
  const q = quotes[pair];
  const base = q ? q.base : pair.slice(0, 3);
  const quoteCcy = q ? q.quote : pair.slice(3);
  const price = q ? Number(side === 'BUY' ? q.ask : q.bid) : null;
  const qty = Number(amount);
  const quoteAmount = price != null && Number.isFinite(qty) ? qty * price : null;
  const pay = side === 'BUY' ? [quoteCcy, quoteAmount] : [base, qty];
  const receive = side === 'BUY' ? [base, qty] : [quoteCcy, quoteAmount];

  const submit = async (e) => {
    e.preventDefault();
    if (!q) { toast.error(`No quote for ${pair} yet`); return; }
    if (!Number.isFinite(qty) || qty <= 0) { toast.error('Enter an amount greater than 0'); return; }
    const hiddenUserId = document.getElementById('fx-user-id')?.value;
    setBusy(true);
    try {
      const res = await api.post('/api/fx/orders', {
        pair, side, amount: qty, quoteId: q.quoteId, clientOrderId: newClientOrderId('fx'),
        userId: hiddenUserId ? parseInt(hiddenUserId, 10) : undefined,
      });
      setResult(res.data);
      if (res.data.status === 'FILLED') toast.success(`${side} ${fmtQty(qty)} ${base} filled @ ${fmtRate(pair, res.data.price)}`);
      else toast.warn(`Order rejected: ${res.data.reason || 'no reason given'}`);
    } catch (err) {
      const message = err.response?.data?.error || 'Order failed';
      setResult({ status: 'REJECTED', reason: message, pair });
      toast.error(`Order rejected: ${message}`);
    } finally {
      setBusy(false);
      loadAccount();
    }
  };

  return (
    <PageLayout title="FX" subtitle="Spot currencies against the house dealer: every order fills at once on the live quote">
      <div className="vt-settings">
        {/* ───────────── Left: quotes ───────────── */}
        <div style={{ display: 'grid', gap: '16px', minWidth: 0 }}>
          <Card title="Live quotes" flush subtitle="Click a pair to trade it" style={{ marginBottom: 0 }}>
            <DataTable
              rowKey={r => r.pair}
              data={pairs.map(p => quotes[p])}
              emptyText="Waiting for quotes…"
              onRowClick={r => setPair(r.pair)}
              rowStyle={r => (r.pair === pair ? { background: colors.bgRaised } : undefined)}
              columns={[
                { key: 'pair', label: 'Pair', render: r => <span style={{ fontWeight: 600 }}>{r.base}/{r.quote}</span> },
                { key: 'bid', label: 'Bid', align: 'right', render: r => (
                  <PriceText value={r.bid} dir={r.dir} tick={r.tick} prefix="" format={v => fmtRate(r.pair, v)} style={{ color: colors.green, fontWeight: 600 }} />
                ) },
                { key: 'ask', label: 'Ask', align: 'right', render: r => (
                  <PriceText value={r.ask} dir={r.dir} tick={r.tick} prefix="" format={v => fmtRate(r.pair, v)} style={{ color: colors.red, fontWeight: 600 }} />
                ) },
                { key: 'spread', label: 'Spread', align: 'right', render: r => `${((Number(r.ask) - Number(r.bid)) / pipSize(r.pair)).toFixed(1)} pips` },
                { key: 'time', label: 'Updated', align: 'right', render: r => <span style={{ color: colors.textMuted }}>{fmtTime(r.timestamp)}</span> },
              ]}
            />
          </Card>

          {/* VULN (kept, FX-6): bank prices, our margin and the House position leak with every quote. */}
          {isDebug && q && (
            <Card variant="warning" style={{ marginBottom: 0 }} titleColor={colors.amber}
              title={<><ShieldAlert size={15} aria-hidden="true" />Internals · {pair} (leaked)</>}>
              <div style={{ ...num, fontSize: '12px', color: colors.amberLight, display: 'grid', gap: '4px' }}>
                {(q.lpQuotes || []).map(lp => (
                  <div key={lp.bank}>LP {lp.bank}: {fmtRate(pair, lp.bid)} / {fmtRate(pair, lp.ask)}</div>
                ))}
                <div>Margin: {q.margin != null ? String(q.margin) : '—'}</div>
                <div>House net: {Object.entries(q.houseNet || {}).map(([ccy, n]) => `${ccy} ${fmtAmount(ccy, n)}`).join(' · ') || '—'}</div>
                <div>Quote {q.quoteId} · expires {fmtTime(q.expiresAt)}</div>
              </div>
            </Card>
          )}
        </div>

        {/* ───────────── Right: trade + balances ───────────── */}
        <div style={{ display: 'grid', gap: '16px', minWidth: 0 }}>
          <Card title="Trade" style={{ marginBottom: 0 }}>
            <form onSubmit={submit} style={{ display: 'grid', gap: '12px' }}>
              {/* VULN (IDOR, FE-09/#71): editable hidden user id; the FX gateway honours it. */}
              <input type="hidden" id="fx-user-id" key={userId || 'anon'} defaultValue={userId || ''} />
              <Segmented ariaLabel="Side" fullWidth value={side} onChange={setSide}
                options={[{ value: 'BUY', label: 'BUY', tone: 'up' }, { value: 'SELL', label: 'SELL', tone: 'down' }]} />
              <div className="vt-cols-2" style={{ gap: '10px' }}>
                <FormField label="Pair">
                  <select value={pair} onChange={e => setPair(e.target.value)} style={{ ...selectStyle, width: '100%' }}>
                    {(pairs.length ? pairs : [pair]).map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </FormField>
                <FormField label={`Amount (${base})`}>
                  <Input type="number" min="0" step="any" inputMode="decimal" value={amount}
                    onChange={e => setAmount(e.target.value)} style={{ width: '100%', ...num }} />
                </FormField>
              </div>
              <div style={{ borderTop: `1px dashed ${colors.borderDefault}`, paddingTop: '8px' }}>
                <KV label={`Price (${side === 'BUY' ? 'ask' : 'bid'})`} value={fmtRate(pair, price)} />
                <KV label="You pay ≈" value={`${fmtAmount(pay[0], pay[1])} ${pay[0]}`} />
                <KV label="You receive ≈" value={`${fmtAmount(receive[0], receive[1])} ${receive[0]}`} />
              </div>
              <Button type="submit" variant={side === 'BUY' ? 'green' : 'red'} size="large" loading={busy}>{side} {pair}</Button>
            </form>

            {result && (
              <div role="status" style={{ marginTop: '12px', padding: '10px 12px', borderRadius: '8px', background: colors.bgStat, border: `1px solid ${colors.borderDefault}`, fontSize: '12.5px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ ...type.caps, fontSize: '10px' }}>Last order{result.orderId ? ` · #${result.orderId}` : ''}</span>
                  <Chip tone={result.status === 'FILLED' ? 'up' : 'down'}>{result.status}</Chip>
                </div>
                {result.status === 'FILLED' ? (
                  <div style={{ ...num, color: colors.textSecondary }}>
                    Paid {fmtAmount(result.pay?.currency, result.pay?.amount)} {result.pay?.currency}
                    {' · '}received {fmtAmount(result.receive?.currency, result.receive?.amount)} {result.receive?.currency}
                    {' @ '}{fmtRate(result.pair, result.price)}
                  </div>
                ) : (
                  <div style={{ color: colors.redLight }}>{result.reason || 'Rejected'}</div>
                )}
              </div>
            )}
          </Card>

          <Card title="My FX balances" subtitle="Fund the FX account from MAIN on the Account page" style={{ marginBottom: 0 }}>
            {balances.length === 0 && <div style={{ color: colors.textMuted, fontSize: '13px' }}>No FX balances</div>}
            {balances.map(b => (
              <KV key={b.asset} label={b.asset}
                value={`${fmtAmount(b.asset, b.available)}${Number(b.held) > 0 ? ` · held ${fmtAmount(b.asset, b.held)}` : ''}`} />
            ))}
          </Card>
        </div>
      </div>

      <Card title="My FX orders" flush style={{ marginTop: '16px' }}>
        <DataTable
          small
          maxHeight="380px"
          rowKey={o => o.orderId}
          data={orders}
          emptyText="No FX orders yet"
          columns={[
            { key: 'time', label: 'Time', render: o => <span style={{ color: colors.textMuted }}>{fmtDate(o.createdAt)}</span> },
            { key: 'pair', label: 'Pair', render: o => <span style={{ fontWeight: 600 }}>{o.pair}</span> },
            { key: 'side', label: 'Side', render: o => <span style={{ color: sideColor(o.side), fontWeight: 600 }}>{o.side}</span> },
            { key: 'amount', label: 'Amount', align: 'right', render: o => fmtQty(o.amount) },
            { key: 'price', label: 'Price', align: 'right', render: o => fmtRate(o.pair, o.price) },
            { key: 'status', label: 'Status', render: o => <StatusBadge status={o.status} /> },
            { key: 'reason', label: 'Reason', render: o => <span style={{ color: colors.textMuted }}>{o.reason || ''}</span> },
            { key: 'id', label: 'ID', align: 'right', render: o => <span style={{ color: colors.textDim }}>#{o.orderId}</span> },
          ]}
        />
      </Card>
    </PageLayout>
  );
}

export default FxPage;
