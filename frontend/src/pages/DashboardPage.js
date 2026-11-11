import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { Activity, ArrowRightLeft, BarChart3, KeyRound, Landmark, ShieldAlert, Wallet } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useDebug } from '../context/DebugContext';
import { useMarketData } from '../context/MarketDataContext';
import api from '../services/apiService';
import { productOf, sendMessage } from '../services/websocketService';
import { balanceOf, fetchAccounts } from '../services/accounts';
import { newClientOrderId, settleClientOrder, trackClientOrder } from '../services/orderTracker';
import { useStomp } from '../hooks/useStomp';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable';
import Button from '../components/Button';
import Modal from '../components/Modal';
import StatusBadge from '../components/StatusBadge';
import { ChangeChip, Chip, EmptyState, KV, PriceText, Tabs } from '../components/ui';
import CandleChart, { INTERVALS } from '../components/trade/CandleChart';
import Watchlist from '../components/trade/Watchlist';
import OrderTicket from '../components/trade/OrderTicket';
import OrderBook from '../components/trade/OrderBook';
import AlertsPanel from '../components/trade/AlertsPanel';
import { REASON_TEXT } from '../components/trade/OrderUpdateToaster';
import { colors, inputStyle, labelStyle, num, type } from '../styles/shared';
import { fmtPct, fmtPnL, fmtPrice, fmtQty, fmtTime, fmtUSD, fmtCompact, fmtDate, parseDate, pnlColor, sideColor } from '../utils/format';

const HOUSE_SPREAD = 0.0001;
const isStock = (symbol) => productOf(symbol) === 'equities';
const createdTime = (o) => parseDate(o.createdAt)?.getTime() || 0;
const hasCost = (p) => p.avgPrice != null;      // coins have no cost basis

function DashboardPage() {
  const { user, refreshUser } = useAuth();
  const isDebug = useDebug();
  const { quotes, halted, markHalted, markResumed, quoteFor } = useMarketData();
  const [params] = useSearchParams();

  const [symbol, setSymbol] = useState(() => params.get('symbol') || 'AAPL');
  const [side, setSide] = useState(() => (params.get('side') === 'SELL' ? 'SELL' : 'BUY'));
  const [interval, setIntervalValue] = useState('5m');
  const [tab, setTab] = useState('positions');
  const [positions, setPositions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [trades, setTrades] = useState([]);
  const [adminAlerts, setAdminAlerts] = useState([]);
  const [health, setHealth] = useState(null);
  const [busy, setBusy] = useState(false);
  const [ticketError, setTicketError] = useState(null);
  const [lastOrder, setLastOrder] = useState(null);
  const [sellModal, setSellModal] = useState(null);
  const [pickPrice, setPickPrice] = useState(null);
  const [bar, setBar] = useState(null);

  const userId = user?.userId || user?.id;
  const pendingRef = useRef(null);          // { clientOrderId, timer }
  const lastActionRef = useRef(null);       // 'order' | 'cancel' | 'alert' | 'sell'
  const refreshTimer = useRef(null);

  // ── Data ──────────────────────────────────────────────
  // Stock positions (crypto coins are balances of the CRYPTO account, see `coins` below).
  const fetchPositions = useCallback(() => {
    if (!userId) return;
    api.get(`/api/users/${userId}/portfolio`)
      .then(res => setPositions((res.data?.positions || []).filter(p => isStock(p.symbol))))
      .catch(err => console.error('Failed to fetch positions:', err));
  }, [userId]);

  // Orders live in two gateways: fetch both and merge, newest first.
  const fetchOrders = useCallback(() => {
    if (!userId) return;
    const get = (product) => api.get(`/api/${product}/orders`)
      .then(res => (Array.isArray(res.data) ? res.data : []))
      .catch(err => { console.error(`Failed to fetch ${product} orders:`, err); return []; });
    Promise.all([get('equities'), get('crypto')])
      .then(([stocks, crypto]) => setOrders([...stocks, ...crypto].sort((a, b) => createdTime(b) - createdTime(a) || b.id - a.id)));
  }, [userId]);

  // MAIN / FX / EQUITIES / CRYPTO balances (trading cash and coins).
  const fetchBalances = useCallback(() => {
    if (!userId) return;
    fetchAccounts().then(setAccounts).catch(err => console.error('Failed to fetch accounts:', err));
  }, [userId]);

  /** One debounced refresh of positions, orders and balances after anything that changes them. */
  const refreshAccount = useCallback(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      fetchPositions();
      fetchOrders();
      fetchBalances();
      refreshUser && refreshUser();
    }, 250);
  }, [fetchPositions, fetchOrders, fetchBalances, refreshUser]);

  useEffect(() => {
    fetchPositions();
    fetchOrders();
    fetchBalances();
    refreshUser && refreshUser();
    api.get('/api/health').then(res => setHealth(res.data)).catch(() => setHealth({ status: 'DOWN' }));
    return () => clearTimeout(refreshTimer.current);
  }, [fetchPositions, fetchOrders, fetchBalances, refreshUser]);

  useEffect(() => {
    const onUpdate = () => refreshAccount();
    window.addEventListener('vt:order-update', onUpdate);
    return () => window.removeEventListener('vt:order-update', onUpdate);
  }, [refreshAccount]);

  // ── Realtime ──────────────────────────────────────────
  // Errors: platform socket (price alerts) and the product sockets (orders).
  const onError = (err) => {
    const message = err?.error || err?.message || 'Unknown error';
    const action = lastActionRef.current;
    if (pendingRef.current) {
      clearTimeout(pendingRef.current.timer);
      settleClientOrder(pendingRef.current.clientOrderId);
      pendingRef.current = null;
      setBusy(false);
      setTicketError(message);
      toast.error(`Order rejected: ${message}`, { autoClose: 6000 });
    } else if (action === 'cancel') {
      toast.error(`Cancel failed: ${message}`);
    } else if (action === 'alert') {
      toast.error(`Alert not set: ${message}`);
    } else if (action === 'sell') {
      toast.error(`Sell rejected: ${message}`, { autoClose: 6000 });
    } else {
      toast.error(message);
    }
  };
  useStomp('/user/queue/errors', onError);
  useStomp('/user/queue/errors', onError, 'equities');
  useStomp('/user/queue/errors', onError, 'crypto');

  // Replies to /app/order.place and /app/order.cancel come back on the product socket.
  const onOrderReply = (msg) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'ERROR') {
      onError(msg);
    } else if (msg.type === 'ORDER_PLACED' || msg.type === 'MARKET_ORDER_EXECUTED') {
      const mine = pendingRef.current && (!msg.clientOrderId || msg.clientOrderId === pendingRef.current.clientOrderId);
      if (mine) {
        clearTimeout(pendingRef.current.timer);
        settleClientOrder(pendingRef.current.clientOrderId);
        pendingRef.current = null;
        setBusy(false);
      }
      setLastOrder(msg);
      setTicketError(null);
      announce(msg);
      refreshAccount();
    } else if (msg.type === 'ORDER_CANCELLED') {
      toast.info(`Order #${msg.orderId ?? msg.id} cancelled`);
      refreshAccount();
    }
  };
  useStomp('/user/queue/orders', onOrderReply, 'equities');
  useStomp('/user/queue/orders', onOrderReply, 'crypto');

  const onTrade = (t) => {
    if (!t || !t.tradeId) return;
    setTrades(prev => [t, ...prev.filter(x => x.tradeId !== t.tradeId)].slice(0, 40));
  };
  useStomp('/topic/equities/trades', onTrade, 'equities');
  useStomp('/topic/crypto/trades', onTrade, 'crypto');

  // VULN (kept, #73): the admin channel is readable by any user; shown in debug mode.
  useStomp('/topic/admin/alerts', (alert) => {
    if (!alert) return;
    console.log('[ADMIN ALERT]', alert);
    if (alert.type === 'TRADING_HALT' && alert.symbol) markHalted(alert.symbol);
    if (alert.type === 'TRADING_RESUME' && alert.symbol) markResumed(alert.symbol);
    if (alert.type === 'PRICE_OVERRIDE' || alert.type === 'TRADING_RESUME') refreshAccount();
    setAdminAlerts(prev => [alert, ...prev].slice(0, 10));
    if (isDebug || alert.type === 'TRADING_HALT') toast.warn(`Admin alert: ${alert.message || alert.type}${alert.symbol ? ` · ${alert.symbol}` : ''}`);
  });

  // ── Actions ───────────────────────────────────────────
  const placeOrder = (payload) => {
    const clientOrderId = newClientOrderId('web');
    lastActionRef.current = 'order';
    setTicketError(null);
    trackClientOrder(clientOrderId);
    if (!sendMessage('/app/order.place', { ...payload, clientOrderId }, productOf(payload.symbol))) {
      settleClientOrder(clientOrderId);
      toast.error('Not connected to the market feed — try again in a moment');
      return;
    }
    setBusy(true);
    const timer = setTimeout(() => {
      if (pendingRef.current && pendingRef.current.clientOrderId === clientOrderId) {
        pendingRef.current = null;
        setBusy(false);
        toast.warn('No confirmation yet — check Open orders');
        refreshAccount();
      }
    }, 8000);
    pendingRef.current = { clientOrderId, timer };
  };

  const cancelOrder = (orderId, orderSymbol) => {
    lastActionRef.current = 'cancel';
    if (!sendMessage('/app/order.cancel', { orderId }, productOf(orderSymbol))) toast.error('Not connected — cancel not sent');
  };

  const openSell = (pos) => {
    const bid = quoteFor(pos.symbol, 'SELL');
    setSellModal({ symbol: pos.symbol, quantity: Number(pos.quantity), sellQty: String(Number(pos.quantity)), bid });
  };

  const executeSell = () => {
    if (!sellModal) return;
    const qty = Number(sellModal.sellQty);
    const bid = quoteFor(sellModal.symbol, 'SELL') || sellModal.bid;
    if (!Number.isFinite(qty) || qty <= 0 || qty > sellModal.quantity) {
      toast.error(`Enter a quantity above 0 and up to ${fmtQty(sellModal.quantity)}`);
      return;
    }
    if (!bid || bid <= 0) {
      toast.error(`No live bid for ${sellModal.symbol} — try again in a moment`);
      return;
    }
    lastActionRef.current = 'sell';
    const clientOrderId = newClientOrderId('sell');
    trackClientOrder(clientOrderId);
    const ok = sendMessage('/app/order.place', {
      symbol: sellModal.symbol, side: 'SELL', type: 'MARKET', quantity: qty, price: bid, clientOrderId,
    }, productOf(sellModal.symbol));
    if (!ok) { toast.error('Not connected — sell not sent'); return; }
    setSellModal(null);
  };

  // ── Derived ───────────────────────────────────────────
  const q = quotes[symbol];
  // Coins held in the CRYPTO account, shown as positions without a cost basis.
  const coins = useMemo(() => {
    const crypto = accounts.find(a => a.product === 'CRYPTO');
    return (crypto?.balances || [])
      .filter(b => b.asset !== 'USD')
      .map(b => ({ symbol: `${b.asset}-USD`, quantity: Number(b.available || 0) + Number(b.held || 0), avgPrice: null }))
      .filter(c => c.quantity > 0);
  }, [accounts]);
  const openPositions = useMemo(() => [...positions.filter(p => Number(p.quantity) > 0), ...coins], [positions, coins]);
  const priceOf = useCallback((sym, fallback) => {
    const v = quotes[sym] ? Number(quotes[sym].currentPrice) : NaN;
    return Number.isFinite(v) && v > 0 ? v : Number(fallback || 0);
  }, [quotes]);
  // VULN (kept, BIZ-11): P&L is computed here in the browser.
  const totals = useMemo(() => {
    let value = 0, cost = 0, pnl = 0;
    openPositions.forEach(p => {
      const qty = Number(p.quantity), avg = Number(p.avgPrice || 0);
      const v = priceOf(p.symbol, avg) * qty;
      value += v;
      if (hasCost(p)) { cost += avg * qty; pnl += v - avg * qty; }
    });
    return { value, cost, pnl };
  }, [openPositions, priceOf]);
  const cash = Number(user?.balance || 0);                              // MAIN account
  const stockCash = balanceOf(accounts, 'EQUITIES');                    // buys stocks
  const cryptoCash = balanceOf(accounts, 'CRYPTO');                     // buys coins
  const tradingCash = stockCash.available + stockCash.held + cryptoCash.available + cryptoCash.held;
  const equity = cash + tradingCash + totals.value;
  const ticketCash = productOf(symbol) === 'crypto' ? cryptoCash.available : stockCash.available;
  const openOrders = useMemo(() => orders.filter(o => o.status === 'NEW' || o.status === 'PARTIAL'), [orders]);
  const orderHistory = useMemo(() => orders.slice(0, 50), [orders]);

  const selectSymbol = (s) => { setSymbol(s); setPickPrice(null); };
  const spread = q && q.ask != null && q.bid != null ? Number(q.ask) - Number(q.bid) : null;

  return (
    <main className="vt-page fade-in" style={{ '--vt-page-max': '1680px', paddingTop: '16px' }}>
      {/* ── Account strip ── */}
      <div className="vt-stats" style={{ marginBottom: '12px' }}>
        <StatCard label="Cash balance" icon={<Wallet size={13} aria-hidden="true" />} value={fmtUSD(cash)} valueSize="20px"
          sub={`Main account · stocks ${fmtUSD(stockCash.available)} · crypto ${fmtUSD(cryptoCash.available)}`} />
        <StatCard label="Equity" icon={<Landmark size={13} aria-hidden="true" />} value={fmtUSD(equity)} valueSize="20px"
          sub={`${openPositions.length} position${openPositions.length === 1 ? '' : 's'} · ${fmtUSD(totals.value)} invested`} />
        <StatCard label="Unrealized P&L" icon={<Activity size={13} aria-hidden="true" />} value={fmtPnL(totals.pnl)} valueSize="20px"
          valueColor={pnlColor(totals.pnl)} sub={totals.cost > 0 ? fmtPct((totals.pnl / totals.cost) * 100) : 'No open positions'} />
        <StatCard label="API key" icon={<KeyRound size={13} aria-hidden="true" />} valueSize="12px"
          value={<code style={{ color: colors.amber, wordBreak: 'break-all' }}>{user?.apiKey || '—'}</code>}
          sub={health ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: health.status === 'UP' ? 'var(--vt-up)' : 'var(--vt-down)' }} />
            {health.status === 'UP' ? 'All systems operational' : 'Backend degraded'}{isDebug && health.users != null ? ` · ${health.users} users` : ''}
          </span> : null} />
      </div>

      <div className="vt-terminal">
        {/* ── Left: markets ── */}
        <aside className="vt-watch" aria-label="Markets">
          <Watchlist selected={symbol} onSelect={selectSymbol} isDebug={isDebug} />
        </aside>

        {/* ── Center: instrument, chart, blotter ── */}
        <section style={{ display: 'grid', gap: '12px', minWidth: 0 }}>
          <div style={{ background: colors.bgCard, border: `1px solid ${colors.borderDefault}`, borderRadius: 'var(--vt-radius)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px 24px', padding: '14px 16px', borderBottom: `1px solid ${colors.borderDefault}` }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h1 style={{ ...type.title, fontSize: '18px' }}>{symbol}</h1>
                  {halted[symbol] && <Chip tone="warn">Halted</Chip>}
                  <Link to={`/symbol/${encodeURIComponent(symbol)}`} style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <BarChart3 size={13} aria-hidden="true" />Details
                  </Link>
                </div>
                <div style={{ color: colors.textMuted, fontSize: '12px' }}>{q?.name || ' '}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                <PriceText value={q?.currentPrice} dir={q?.dir} tick={q?.tick} style={{ ...type.hero, fontSize: '26px' }} />
                <ChangeChip value={q?.changePct} solid />
              </div>
              <div style={{ display: 'flex', gap: '20px', marginLeft: 'auto', flexWrap: 'wrap' }}>
                {[
                  ['Bid', q?.bid != null ? fmtPrice(q.bid) : '—', colors.green],
                  ['Ask', q?.ask != null ? fmtPrice(q.ask) : '—', colors.red],
                  ['Spread', spread != null ? fmtPrice(spread) : '—'],
                  ['Volume', fmtCompact(q?.volume)],
                ].map(([k, v, c]) => (
                  <div key={k}>
                    <div style={{ ...type.caps, fontSize: '10px' }}>{k}</div>
                    <div style={{ ...num, fontSize: '13px', fontWeight: 600, color: c || colors.textPrimary }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', gap: '8px', flexWrap: 'wrap' }}>
              <div role="group" aria-label="Chart interval" style={{ display: 'flex', gap: '2px' }}>
                {INTERVALS.map(i => (
                  <button key={i.value} type="button" aria-pressed={interval === i.value} onClick={() => setIntervalValue(i.value)} className="vt-btn vt-ghost"
                    style={{ height: '26px', padding: '0 10px', borderRadius: '6px', border: 'none', fontSize: '12px', fontWeight: 600, background: interval === i.value ? colors.bgRaised : 'transparent', color: interval === i.value ? colors.textPrimary : colors.textMuted }}>
                    {i.label}
                  </button>
                ))}
              </div>
              {bar && (
                <div style={{ ...num, fontSize: '11.5px', color: colors.textMuted, display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <span>O <b style={{ color: colors.textSecondary, fontWeight: 500 }}>{fmtPrice(bar.open)}</b></span>
                  <span>H <b style={{ color: colors.textSecondary, fontWeight: 500 }}>{fmtPrice(bar.high)}</b></span>
                  <span>L <b style={{ color: colors.textSecondary, fontWeight: 500 }}>{fmtPrice(bar.low)}</b></span>
                  <span>C <b style={{ color: bar.close >= bar.open ? colors.green : colors.red, fontWeight: 600 }}>{fmtPrice(bar.close)}</b></span>
                </div>
              )}
            </div>
            <div style={{ padding: '0 4px 4px' }}>
              <CandleChart symbol={symbol} interval={interval} height={360} onBar={setBar} />
            </div>
          </div>

          {/* Blotter */}
          <div style={{ background: colors.bgCard, border: `1px solid ${colors.borderDefault}`, borderRadius: 'var(--vt-radius)', overflow: 'hidden' }}>
            <Tabs ariaLabel="Account activity" value={tab} onChange={setTab} tabs={[
              { value: 'positions', label: 'Positions', count: openPositions.length },
              { value: 'open', label: 'Open orders', count: openOrders.length },
              { value: 'history', label: 'Order history' },
              { value: 'tape', label: 'Market trades' },
            ]} />
            {tab === 'positions' && (
              <DataTable small maxHeight="320px" rowKey={p => p.symbol} data={openPositions}
                empty={<EmptyState icon={<ArrowRightLeft size={22} />} title="No open positions">Pick a market on the left and place your first order.</EmptyState>}
                onRowClick={p => selectSymbol(p.symbol)}
                columns={[
                  { key: 'symbol', label: 'Symbol', render: p => <span style={{ fontWeight: 600 }}>{p.symbol}</span> },
                  { key: 'quantity', label: 'Qty', align: 'right', render: p => fmtQty(p.quantity) },
                  { key: 'avg', label: 'Avg cost', align: 'right', render: p => (hasCost(p) ? fmtPrice(p.avgPrice) : '—') },
                  { key: 'last', label: 'Last', align: 'right', render: p => fmtPrice(priceOf(p.symbol, p.avgPrice)) },
                  { key: 'value', label: 'Value', align: 'right', render: p => fmtUSD(priceOf(p.symbol, p.avgPrice) * Number(p.quantity)) },
                  { key: 'pnl', label: 'P&L', align: 'right', render: p => {
                    if (!hasCost(p)) return '—';
                    const pnl = (priceOf(p.symbol, p.avgPrice) - Number(p.avgPrice)) * Number(p.quantity);
                    return <span style={{ color: pnlColor(pnl), fontWeight: 600 }}>{fmtPnL(pnl)}</span>;
                  } },
                  { key: 'pct', label: 'P&L %', align: 'right', render: p => {
                    if (!hasCost(p)) return '—';
                    const avg = Number(p.avgPrice);
                    const pct = avg > 0 ? (priceOf(p.symbol, avg) - avg) / avg * 100 : 0;
                    return <ChangeChip value={pct} size="sm" />;
                  } },
                  { key: 'act', label: '', align: 'right', render: p => (
                    <Button variant="darkRed" size="small" onClick={(e) => { e.stopPropagation(); openSell(p); }}>Sell</Button>
                  ) },
                ]} />
            )}
            {tab === 'open' && (
              <DataTable small maxHeight="320px" rowKey={o => `${o.product}-${o.id}`} data={openOrders} emptyText="No working orders"
                columns={[
                  { key: 'id', label: 'ID', render: o => <span style={{ ...num, color: colors.textMuted }}>#{o.id}</span> },
                  { key: 'symbol', label: 'Symbol', render: o => <span style={{ fontWeight: 600 }}>{o.symbol}</span> },
                  { key: 'side', label: 'Side', render: o => <span style={{ color: sideColor(o.side), fontWeight: 600 }}>{o.side}</span> },
                  { key: 'price', label: 'Price', align: 'right', render: o => fmtPrice(o.price) },
                  { key: 'filled', label: 'Filled', align: 'right', render: o => `${fmtQty(o.filledQty || 0)} / ${fmtQty(o.quantity)}` },
                  { key: 'status', label: 'Status', render: o => <StatusBadge status={o.status} reason={o.statusReason} /> },
                  { key: 'time', label: 'Placed', render: o => <span style={{ color: colors.textMuted }}>{fmtTime(o.createdAt)}</span> },
                  { key: 'act', label: '', align: 'right', render: o => <Button variant="gray" size="small" onClick={() => cancelOrder(o.id, o.symbol)}>Cancel</Button> },
                ]} />
            )}
            {tab === 'history' && (
              <DataTable small maxHeight="320px" rowKey={o => `${o.product}-${o.id}`} data={orderHistory} emptyText="No orders yet"
                columns={[
                  { key: 'id', label: 'ID', render: o => <span style={{ ...num, color: colors.textMuted }}>#{o.id}</span> },
                  { key: 'symbol', label: 'Symbol', render: o => <span style={{ fontWeight: 600 }}>{o.symbol}</span> },
                  { key: 'side', label: 'Side', render: o => <span style={{ color: sideColor(o.side), fontWeight: 600 }}>{o.side}</span> },
                  { key: 'type', label: 'Type', render: o => <span style={{ color: colors.textSecondary }}>{o.orderType}</span> },
                  { key: 'qty', label: 'Qty', align: 'right', render: o => fmtQty(o.quantity) },
                  { key: 'price', label: 'Limit', align: 'right', render: o => (o.orderType === 'MARKET' ? 'MKT' : fmtPrice(o.price)) },
                  { key: 'avg', label: 'Avg fill', align: 'right', render: o => (o.filledPrice ? fmtPrice(o.filledPrice) : '—') },
                  { key: 'status', label: 'Status', render: o => <StatusBadge status={o.status} reason={o.statusReason} /> },
                  { key: 'time', label: 'Placed', render: o => <span style={{ color: colors.textMuted }}>{fmtDate(o.createdAt)}</span> },
                ]} />
            )}
            {tab === 'tape' && (
              <DataTable small maxHeight="320px" rowKey={t => t.tradeId} data={trades} emptyText="Waiting for trades…"
                columns={[
                  { key: 'time', label: 'Time', render: t => <span style={{ ...num, color: colors.textMuted }}>{fmtTime(t.timestamp)}</span> },
                  { key: 'symbol', label: 'Symbol', render: t => <span style={{ fontWeight: 600 }}>{t.symbol}</span> },
                  { key: 'price', label: 'Price', align: 'right', render: t => fmtPrice(t.price) },
                  { key: 'qty', label: 'Qty', align: 'right', render: t => fmtQty(t.quantity) },
                  // VULN (kept, #61): buyer and seller ids are broadcast to everyone
                  { key: 'buyer', label: 'Buyer', align: 'right', render: t => <span style={{ color: colors.textMuted }}>User#{t.buyUserId}</span> },
                  { key: 'seller', label: 'Seller', align: 'right', render: t => <span style={{ color: colors.textMuted }}>User#{t.sellUserId}</span> },
                ]} />
            )}
          </div>
        </section>

        {/* ── Right: ticket, book, alerts ── */}
        <aside style={{ display: 'grid', gap: '12px', minWidth: 0 }} aria-label="Trading">
          <OrderTicket
            userId={userId}
            symbol={symbol}
            onSymbolChange={selectSymbol}
            side={side}
            onSideChange={setSide}
            balance={ticketCash}
            positions={openPositions}
            busy={busy}
            error={ticketError}
            onDismissError={() => setTicketError(null)}
            onSubmit={placeOrder}
            prefillPrice={pickPrice}
          />
          {lastOrder && <LastOrder order={lastOrder} />}
          <OrderBook symbol={symbol} userId={userId} onCancel={cancelOrder} onPickPrice={(p) => setPickPrice({ value: p, n: Date.now() })} />
          <AlertsPanel defaultSymbol={symbol} onAction={(a) => { lastActionRef.current = a; }} />
          {isDebug && adminAlerts.length > 0 && (
            <section style={{ background: colors.bgCard, border: `1px solid ${colors.borderWarning}`, borderRadius: 'var(--vt-radius)', padding: '12px' }}>
              <h2 style={{ ...type.section, fontSize: '14px', color: colors.amber, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <ShieldAlert size={15} aria-hidden="true" />Admin alerts (leaked)
              </h2>
              {adminAlerts.map((a, i) => (
                <div key={i} style={{ padding: '6px 0', borderBottom: `1px solid ${colors.borderDefault}`, fontSize: '12px', color: colors.amberLight, lineHeight: 1.5 }}>
                  <Chip tone="warn" style={{ marginRight: '6px' }}>{a.type || 'ALERT'}</Chip>
                  {a.message || JSON.stringify(a)}
                </div>
              ))}
            </section>
          )}
        </aside>
      </div>

      {/* ── Sell dialog ── */}
      <Modal open={!!sellModal} onClose={() => setSellModal(null)} title={sellModal ? `Sell ${sellModal.symbol}` : ''} width="420px"
        footer={<>
          <Button variant="gray" onClick={() => setSellModal(null)}>Cancel</Button>
          <Button variant="red" onClick={executeSell}>Confirm sell</Button>
        </>}>
        {sellModal && (() => {
          const bid = quoteFor(sellModal.symbol, 'SELL') || sellModal.bid;
          const fill = bid ? bid * (1 - HOUSE_SPREAD) : null;
          const qty = Number(sellModal.sellQty);
          return (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', padding: '12px', borderRadius: '8px', background: colors.bgStat, border: `1px solid ${colors.borderDefault}`, marginBottom: '14px' }}>
                <div><div style={{ ...type.caps, fontSize: '10px' }}>You hold</div><div style={{ ...num, fontWeight: 600 }}>{fmtQty(sellModal.quantity)} {sellModal.symbol}</div></div>
                <div><div style={{ ...type.caps, fontSize: '10px' }}>Market bid</div><div style={{ ...num, fontWeight: 600, color: colors.green }}>{bid ? fmtPrice(bid) : '—'}</div></div>
              </div>
              <label htmlFor="sell-qty" style={labelStyle}>Quantity to sell</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input id="sell-qty" type="number" min="0" step="any" inputMode="decimal" value={sellModal.sellQty}
                  onChange={e => setSellModal({ ...sellModal, sellQty: e.target.value })}
                  style={{ ...inputStyle, flex: 1, height: '40px', fontSize: '15px', ...num }} />
                <Button variant="gray" onClick={() => setSellModal({ ...sellModal, sellQty: String(sellModal.quantity) })}>Max</Button>
              </div>
              <div style={{ marginTop: '14px' }}>
                <KV label="Est. fill (bid − 0.01%)" value={fill ? fmtPrice(fill) : '—'} />
                <KV label="Est. proceeds" value={fill && Number.isFinite(qty) ? fmtUSD(qty * fill) : '—'} valueColor={colors.green} />
              </div>
            </>
          );
        })()}
      </Modal>
    </main>
  );
}

/** Compact confirmation of the last order reply. */
function LastOrder({ order }) {
  const filled = Number(order.filledQty || 0);
  const tone = order.status === 'FILLED' ? 'up' : order.status === 'CANCELLED' ? 'down' : 'accent';
  return (
    <div className="vt-pop" style={{ background: colors.bgCard, border: `1px solid ${colors.borderDefault}`, borderRadius: 'var(--vt-radius)', padding: '10px 12px', fontSize: '12.5px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
        <span style={{ ...type.caps, fontSize: '10px' }}>Last order · #{order.orderId}</span>
        <Chip tone={tone}>{order.status}</Chip>
      </div>
      <div style={{ ...num, color: colors.textSecondary }}>
        {order.side} {fmtQty(order.quantity)} {order.symbol}
        {filled > 0 && ` · filled ${fmtQty(filled)} @ ${fmtPrice(order.avgFillPrice || order.filledPrice)}`}
        {order.reason && ` · ${REASON_TEXT[order.reason] || order.reason}`}
      </div>
    </div>
  );
}

/** Toast for a placement reply. */
function announce(msg) {
  const what = `${msg.side || ''} ${fmtQty(msg.quantity)} ${msg.symbol || ''}`.trim();
  const filled = Number(msg.filledQty || 0);
  if (msg.status === 'FILLED') toast.success(`${what} filled @ ${fmtPrice(msg.avgFillPrice || msg.filledPrice)}`);
  else if (msg.status === 'PARTIAL') toast.info(`${what}: ${fmtQty(filled)} filled, ${fmtQty(msg.remainingQty)} working`);
  else if (msg.status === 'CANCELLED') toast.warn(`${what}${filled > 0 ? ` — ${fmtQty(filled)} filled,` : ''} rest cancelled: ${REASON_TEXT[msg.reason] || msg.reason || 'not filled'}`);
  else toast.info(`${what} placed @ ${fmtPrice(msg.price)} — working`);
}

export default DashboardPage;
