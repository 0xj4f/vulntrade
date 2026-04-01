import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/apiService';
import { subscribe, sendMessage, isConnected } from '../services/websocketService';
import { toast } from 'react-toastify';

import PageLayout from '../components/PageLayout';
import Card from '../components/Card';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable';
import Button from '../components/Button';
import Modal from '../components/Modal';
import FormField, { Input } from '../components/FormField';
import StatusBadge from '../components/StatusBadge';
import SparkLine from '../components/SparkLine';
import VerificationBadge from '../components/VerificationBadge';
import {
  colors, selectStyle, flexRowWrap, gridCols,
  orderErrorBanner, orderStatusBanner,
} from '../styles/shared';
import { fmtUSD, fmtBalance, fmtPrice, fmtPnL, fmtPct, fmtQty, fmtNum, fmtDate, pnlColor, sideColor } from '../utils/format';

function DashboardPage() {
  const { user, refreshUser, getAccountLevel } = useAuth();
  const [prices, setPrices] = useState([]);
  const [health, setHealth] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [recentTrades, setRecentTrades] = useState([]);
  const [orderBook, setOrderBook] = useState({ bids: [], asks: [] });
  const [orderForm, setOrderForm] = useState({
    symbol: 'AAPL', side: 'BUY', type: 'LIMIT', quantity: '1', price: '150.00'
  });
  const [orderStatus, setOrderStatus] = useState(null);
  const [adminAlerts, setAdminAlerts] = useState([]);
  const [positions, setPositions] = useState([]);
  const [myOrders, setMyOrders] = useState([]);
  const [orderError, setOrderError] = useState(null);
  const [sellModal, setSellModal] = useState(null);
  const pricesRef = useRef({});
  const priceHistoryRef = useRef({}); // { symbol: [price1, price2, ...] } for sparklines
  const [priceHistory, setPriceHistory] = useState({}); // triggers re-render for sparklines
  const pricesDirtyRef = useRef(false); // true when refs have unflushed updates
  // Stable refs so WS callbacks always call the latest version without re-subscribing
  const refreshAllRef = useRef(null);
  const refreshAfterOrderRef = useRef(null);

  // ── Fetchers (unchanged) ─────────────────────────────
  const fetchPositions = useCallback(() => {
    if (!user?.userId) return;
    api.get(`/api/users/${user.userId}/portfolio`)
      .then(res => setPositions(res.data?.positions || []))
      .catch(err => console.error('Failed to fetch positions:', err));
  }, [user?.userId]);

  const fetchOrders = useCallback(() => {
    if (!user?.userId) return;
    api.get(`/api/orders`)
      .then(res => setMyOrders(Array.isArray(res.data) ? res.data : []))
      .catch(err => console.error('Failed to fetch orders:', err));
  }, [user?.userId]);

  const refreshBalance = useCallback(() => {
    if (refreshUser) refreshUser();
  }, [refreshUser]);

  const fetchOrderBook = (symbol) => {
    api.get(`/api/market/orderbook/${symbol}`)
      .then(res => setOrderBook({ bids: res.data.bids || [], asks: res.data.asks || [] }))
      .catch(err => console.error('Failed to fetch orderbook:', err));
  };

  // Aggressive refresh — multiple attempts to catch backend processing
  const refreshAll = useCallback(() => {
    fetchPositions();
    fetchOrders();
    refreshBalance();
  }, [fetchPositions, fetchOrders, refreshBalance]);

  const refreshAfterOrder = useCallback(() => {
    // Immediate + staggered refreshes to catch backend processing
    refreshAll();
    setTimeout(refreshAll, 500);
    setTimeout(refreshAll, 1500);
    setTimeout(refreshAll, 3000);
  }, [refreshAll]);

  // ── Price helpers ────────────────────────────────────
  const getCurrentPrice = (symbol) => {
    const p = pricesRef.current[symbol];
    return p ? Number(p.currentPrice || p.ask || 0) : 0;
  };

  const getSymbolPrice = (symbol, side) => {
    const d = pricesRef.current[symbol];
    if (!d) return null;
    return side === 'BUY'
      ? Number(d.ask || d.currentPrice)
      : Number(d.bid || d.currentPrice);
  };

  // Keep callback refs up-to-date so WS handlers always call the latest version
  useEffect(() => { refreshAllRef.current = refreshAll; }, [refreshAll]);
  useEffect(() => { refreshAfterOrderRef.current = refreshAfterOrder; }, [refreshAfterOrder]);

  // ── Sync MARKET order price when symbol/side/type changes (not on every tick) ──
  useEffect(() => {
    if (orderForm.type !== 'MARKET') return;
    const p = getSymbolPrice(orderForm.symbol, orderForm.side);
    if (p) setOrderForm(prev => prev.type === 'MARKET' ? { ...prev, price: p.toFixed(2) } : prev);
  }, [orderForm.type, orderForm.symbol, orderForm.side]); // intentionally excludes prices

  // ── WS setup (unchanged logic) ──────────────────────
  useEffect(() => {
    api.get('/api/market/prices')
      .then(res => {
        setPrices(res.data);
        res.data.forEach(p => { pricesRef.current[p.symbol] = p; });
      })
      .catch(err => console.error('Failed to fetch prices:', err));

    api.get('/api/health')
      .then(res => setHealth(res.data))
      .catch(err => console.error('Failed to fetch health:', err));

    api.get('/api/market/orderbook/AAPL')
      .then(res => setOrderBook({ bids: res.data.bids || [], asks: res.data.asks || [] }))
      .catch(err => console.error('Failed to fetch orderbook:', err));

    const setupSubscriptions = () => {
      if (!isConnected()) return false;
      setWsConnected(true);

      subscribe('/topic/prices', (priceUpdate) => {
        if (priceUpdate.symbol) {
          pricesRef.current[priceUpdate.symbol] = {
            ...pricesRef.current[priceUpdate.symbol],
            currentPrice: priceUpdate.last,
            bid: priceUpdate.bid,
            ask: priceUpdate.ask,
            volume: priceUpdate.volume,
            marketMakerId: priceUpdate.marketMakerId,
            costBasis: priceUpdate.costBasis,
            spreadBps: priceUpdate.spreadBps,
          };
          // Accumulate for sparklines (last 30 ticks per symbol)
          const sym = priceUpdate.symbol;
          const last = Number(priceUpdate.last || priceUpdate.bid || 0);
          if (last > 0) {
            const prev = priceHistoryRef.current[sym] || [];
            priceHistoryRef.current[sym] = [...prev.slice(-29), last];
          }
          // Mark dirty — the ticker below flushes to state at most every 100 ms
          pricesDirtyRef.current = true;
        }
      });

      subscribe('/topic/orderbook', (entry) => {
        setOrderBook(prev => {
          const side = entry.side === 'BUY' ? 'bids' : 'asks';
          const updated = [...prev[side]];
          const idx = updated.findIndex(e => e.orderId === entry.orderId);
          if (entry.status === 'CANCELLED' || entry.status === 'FILLED') {
            return { ...prev, [side]: updated.filter(e => e.orderId !== entry.orderId) };
          }
          if (idx >= 0) {
            updated[idx] = entry;
          } else {
            updated.push(entry);
          }
          return { ...prev, [side]: updated.slice(0, 20) };
        });
      });

      subscribe('/topic/trades', (trade) => {
        setRecentTrades(prev => [trade, ...prev].slice(0, 20));
        // A trade happened — refresh positions in case we're involved
        setTimeout(() => refreshAllRef.current?.(), 300);
      });

      subscribe('/user/queue/orders', (order) => {
        setOrderStatus(order);
        setOrderError(null);
        const status = order.status || order.type || 'UPDATED';
        if (status === 'FILLED' || status === 'ORDER_PLACED' || status === 'MARKET_ORDER_EXECUTED') {
          toast.success(`✅ Order ${status}: ${order.symbol || ''} ${order.side || ''} — ID #${order.orderId || order.id || '?'}`);
        } else if (status === 'PARTIAL') {
          toast.info(`📊 Partial fill: ${order.symbol || ''} — filled ${order.filledQty || '?'}`);
        } else if (status === 'ORDER_CANCELLED') {
          toast.info(`🚫 Order cancelled: #${order.orderId || order.id || '?'}`);
        } else {
          toast.info(`Order ${status}: #${order.orderId || order.id || '?'}`);
        }
        refreshAfterOrderRef.current?.();
      });

      subscribe('/topic/admin/alerts', (alert) => {
        console.log('[ADMIN ALERT]', alert);
        setAdminAlerts(prev => [alert, ...prev].slice(0, 10));
        toast.warn('Admin Alert: ' + (alert.message || alert.type));
      });

      subscribe('/user/queue/errors', (error) => {
        const msg = error.message || 'Unknown error';
        setOrderError(msg);
        toast.error(`❌ ${msg}`, { autoClose: 8000 });
      });

      return true;
    };

    if (!setupSubscriptions()) {
      const interval = setInterval(() => {
        if (setupSubscriptions()) clearInterval(interval);
      }, 500);
      return () => clearInterval(interval);
    }
  }, []); // runs once — callbacks accessed via refs to avoid re-subscribing

  useEffect(() => { fetchPositions(); fetchOrders(); }, [fetchPositions, fetchOrders]);

  // Flush price refs to state at most every 100 ms — prevents per-message re-renders
  useEffect(() => {
    const iv = setInterval(() => {
      if (pricesDirtyRef.current) {
        pricesDirtyRef.current = false;
        setPrices(Object.values(pricesRef.current));
        setPriceHistory({ ...priceHistoryRef.current });
      }
    }, 100);
    return () => clearInterval(iv);
  }, []);

  // Keep balance fresh — poll every 30 s so deposits/withdrawals from other pages are reflected
  useEffect(() => {
    refreshBalance();
    const iv = setInterval(refreshBalance, 30000);
    return () => clearInterval(iv);
  }, [refreshBalance]);

  // ── Actions ──────────────────────────────────────────
  const cancelOrder = (orderId) => {
    sendMessage('/app/trade.cancelOrder', { orderId });
    toast.info(`Cancel request sent for order #${orderId}`);
  };

  const sellPosition = (symbol, quantity) => {
    const symbolData = pricesRef.current[symbol];
    const bidPrice = symbolData ? Number(symbolData.bid || symbolData.currentPrice) : 0;
    setSellModal({ symbol, quantity: Number(quantity), price: bidPrice, sellQty: String(quantity) });
  };

  const executeSell = async () => {
    if (!sellModal) return;
    const qty = Number(sellModal.sellQty);
    if (qty <= 0 || qty > sellModal.quantity) {
      toast.error(`Quantity must be between 0 and ${sellModal.quantity}`);
      return;
    }
    setOrderError(null);

    const payload = {
      symbol: sellModal.symbol,
      side: 'SELL',
      type: 'MARKET',
      quantity: qty,
      price: sellModal.price,
      clientOrderId: 'sell-' + Date.now(),
    };
    console.log('[SELL] Sending order:', payload);
    sendMessage('/app/trade.placeOrder', payload);
    toast.info(`Sell order submitted: ${qty} ${sellModal.symbol}`);
    setSellModal(null);

    // Aggressive refresh after sell
    refreshAfterOrder();
  };

  // ── Render ───────────────────────────────────────────
  return (
    <PageLayout title="Trading Dashboard" maxWidth="1400px">

      {/* ── Status Bar + Account ── */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '4px', flexWrap: 'wrap' }}>
        {health && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            padding: '10px 18px', borderRadius: '12px',
            backgroundColor: colors.bgCard, border: `1px solid ${colors.borderDefault}`,
            flex: '1 1 auto',
          }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600',
              backgroundColor: health.status === 'UP' ? colors.greenDark : colors.redDark,
              color: health.status === 'UP' ? colors.greenLight : colors.redLight,
              border: `1px solid ${health.status === 'UP' ? 'rgba(0,214,143,0.2)' : 'rgba(255,61,113,0.2)'}`,
            }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: health.status === 'UP' ? colors.green : colors.red }} />
              {health.status}
            </span>
            <span style={{ color: colors.textMuted, fontSize: '12px' }}>
              DB: {health.database} · Users: {health.users} · Symbols: {health.symbols}
            </span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '600',
              backgroundColor: wsConnected ? colors.greenDark : colors.redDark,
              color: wsConnected ? colors.greenLight : colors.redLight,
              border: `1px solid ${wsConnected ? 'rgba(0,214,143,0.2)' : 'rgba(255,61,113,0.2)'}`,
              marginLeft: 'auto',
            }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: wsConnected ? colors.green : colors.red }} />
              {wsConnected ? 'LIVE' : 'OFFLINE'}
            </span>
          </div>
        )}
      </div>

      {/* ── Account Summary ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '20px' }}>
        <StatCard label="Balance" valueColor={colors.green} valueSize="22px"
          value={fmtBalance(user?.balance)} />
        <StatCard label="Username" valueSize="18px"
          value={<span>{user?.username || '—'} <VerificationBadge level={getAccountLevel()} size="small" /></span>} />
        <StatCard label="Role" valueSize="18px"
          value={user?.role || '—'}
          valueColor={user?.role === 'ADMIN' ? colors.red : colors.blue} />
        <StatCard label="API Key" valueSize="11px"
          value={<code style={{ fontFamily: "'SF Mono', monospace", color: colors.amber, wordBreak: 'break-all' }}>{user?.apiKey || '—'}</code>} />
      </div>

      {/* ── Market Prices ── */}
      <Card title={<span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        Live Prices
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: '4px',
          padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: '600',
          backgroundColor: wsConnected ? colors.greenDark : colors.redDark,
          color: wsConnected ? colors.greenLight : colors.redLight,
        }}>
          <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: wsConnected ? colors.green : colors.red }} />
          {wsConnected ? 'LIVE' : 'OFF'}
        </span>
      </span>}>
        <DataTable
          columns={[
            { key: 'symbol', label: 'Symbol', render: p => (
              <Link to={`/symbol/${p.symbol}`} style={{ fontWeight: '700', color: colors.textPrimary, fontSize: '14px', textDecoration: 'none' }}
                dangerouslySetInnerHTML={{ __html: p.symbol }} />
            )},
            { key: 'name', label: 'Name', render: p => (
              <span style={{ color: colors.textMuted, fontSize: '13px' }}
                dangerouslySetInnerHTML={{ __html: p.name || '' }} />
            )},
            { key: 'price', label: 'Price', align: 'right', render: p => (
              <span style={{ color: colors.green, fontWeight: '600', fontSize: '14px' }}>{fmtPrice(p.currentPrice)}</span>
            )},
            { key: 'bid', label: 'Bid', align: 'right', render: p => (
              <span style={{ color: colors.textSecondary, fontSize: '13px' }}>{p.bid ? fmtPrice(p.bid) : '—'}</span>
            )},
            { key: 'ask', label: 'Ask', align: 'right', render: p => (
              <span style={{ color: colors.textSecondary, fontSize: '13px' }}>{p.ask ? fmtPrice(p.ask) : '—'}</span>
            )},
            { key: 'volume', label: 'Volume', align: 'right', render: p => (
              <span style={{ color: colors.textMuted, fontSize: '13px' }}>{p.volume ? fmtNum(p.volume) : '—'}</span>
            )},
            { key: 'spark', label: 'Trend', align: 'center', render: p => (
              <SparkLine data={priceHistory[p.symbol] || []} width={72} height={24} />
            )},
            { key: 'internal', label: 'Internal', align: 'right', render: p => (
              <span style={{ color: colors.textDim, fontSize: '10px', fontFamily: "'SF Mono', monospace" }}>
                {p.marketMakerId && `MM:${p.marketMakerId}`}
                {p.costBasis && ` CB:${fmtPrice(p.costBasis)}`}
              </span>
            )},
          ]}
          data={prices}
          rowKey={p => p.symbol}
          emptyText="No market data"
          headerBorder="medium"
        />
      </Card>

      {/* ── Place Order ── */}
      <Card title="Place Order">
        <div style={flexRowWrap('12px')}>
          <input type="hidden" id="order-user-id" value={user?.userId || user?.id || ''} />

          {/* BUY/SELL toggle */}
          <div style={{ display: 'flex', borderRadius: '10px', overflow: 'hidden', border: `1px solid ${colors.borderMedium}` }}>
            {['BUY', 'SELL'].map(side => (
              <button key={side} onClick={() => {
                const newForm = { ...orderForm, side };
                if (orderForm.type === 'MARKET') {
                  const symbolData = pricesRef.current[orderForm.symbol];
                  if (symbolData) {
                    const marketPrice = side === 'BUY'
                      ? Number(symbolData.ask || symbolData.currentPrice)
                      : Number(symbolData.bid || symbolData.currentPrice);
                    newForm.price = marketPrice.toFixed(2);
                  }
                }
                setOrderForm(newForm);
              }} style={{
                padding: '9px 22px', border: 'none', cursor: 'pointer',
                fontWeight: '600', fontSize: '13px', letterSpacing: '0.03em',
                transition: 'all 0.15s ease',
                backgroundColor: orderForm.side === side
                  ? (side === 'BUY' ? colors.green : colors.red)
                  : colors.bgInput,
                color: orderForm.side === side ? '#fff' : colors.textMuted,
              }}>
                {side}
              </button>
            ))}
          </div>

          <FormField label="Symbol">
            <select value={orderForm.symbol} onChange={e => {
              const newSymbol = e.target.value;
              const newForm = { ...orderForm, symbol: newSymbol };
              const symbolData = pricesRef.current[newSymbol];
              if (symbolData) {
                const marketPrice = orderForm.side === 'BUY'
                  ? Number(symbolData.ask || symbolData.currentPrice)
                  : Number(symbolData.bid || symbolData.currentPrice);
                newForm.price = marketPrice.toFixed(2);
              }
              setOrderForm(newForm);
              fetchOrderBook(newSymbol);
            }} style={selectStyle}>
              {prices.map(p => <option key={p.symbol} value={p.symbol}>{p.symbol}</option>)}
            </select>
          </FormField>

          <FormField label="Type">
            <select value={orderForm.type} onChange={e => {
              const newType = e.target.value;
              if (newType === 'MARKET') {
                const symbolData = pricesRef.current[orderForm.symbol];
                const marketPrice = symbolData
                  ? (orderForm.side === 'BUY'
                    ? Number(symbolData.ask || symbolData.currentPrice)
                    : Number(symbolData.bid || symbolData.currentPrice))
                  : '';
                setOrderForm({ ...orderForm, type: newType, price: marketPrice ? marketPrice.toFixed(2) : orderForm.price });
              } else {
                setOrderForm({ ...orderForm, type: newType });
              }
            }} style={selectStyle}>
              <option value="LIMIT">LIMIT</option>
              <option value="MARKET">MARKET</option>
            </select>
          </FormField>

          <FormField label="Quantity">
            <Input type="number" value={orderForm.quantity}
              onChange={e => setOrderForm({ ...orderForm, quantity: e.target.value })}
              max="10000" min="1" width="100px" />
          </FormField>

          <FormField label="Price">
            <Input type="number" step="0.01" value={orderForm.price}
              onChange={e => setOrderForm({ ...orderForm, price: e.target.value })}
              readOnly={orderForm.type === 'MARKET'} width="120px"
              style={{
                background: orderForm.type === 'MARKET' ? colors.bgStat : colors.bgInput,
                opacity: orderForm.type === 'MARKET' ? 0.7 : 1,
              }} />
          </FormField>

          <Button
            variant={orderForm.side === 'BUY' ? 'green' : 'red'}
            style={{ padding: '10px 28px', fontSize: '14px', letterSpacing: '0.02em' }}
            onClick={() => {
              const qty = Number(orderForm.quantity);
              if (qty <= 0 || qty > 10000) {
                toast.error('Quantity must be between 1 and 10000');
                return;
              }
              if (orderForm.type === 'LIMIT' && Number(orderForm.price) <= 0) {
                toast.error('Price must be positive');
                return;
              }
              let orderPrice = null;
              if (orderForm.type === 'MARKET') {
                const symbolData = pricesRef.current[orderForm.symbol];
                if (symbolData) {
                  orderPrice = orderForm.side === 'BUY'
                    ? Number(symbolData.ask || symbolData.currentPrice)
                    : Number(symbolData.bid || symbolData.currentPrice);
                }
                if (!orderPrice || isNaN(orderPrice)) {
                  toast.error('Market price not available for ' + orderForm.symbol);
                  return;
                }
              } else {
                orderPrice = Number(orderForm.price);
              }
              const hiddenUserId = document.getElementById('order-user-id')?.value;
              sendMessage('/app/trade.placeOrder', {
                symbol: orderForm.symbol,
                side: orderForm.side,
                type: orderForm.type,
                quantity: qty,
                price: orderPrice,
                clientOrderId: 'web-' + Date.now(),
                userId: hiddenUserId ? parseInt(hiddenUserId) : undefined
              });
              toast.info('Order submitted via WebSocket');
              setOrderError(null);
              // Immediate refresh after placing order
              refreshAfterOrder();
            }}
          >
            {orderForm.side} {orderForm.symbol}
          </Button>
        </div>

        {orderError && (
          <div style={orderErrorBanner}>
            <span>❌ <strong>Order Error:</strong> {orderError}</span>
            <button onClick={() => setOrderError(null)} style={{
              background: 'transparent', border: 'none', color: colors.redLight,
              cursor: 'pointer', fontSize: '16px'
            }}>✕</button>
          </div>
        )}

        {orderStatus && !orderError && (
          <div style={orderStatusBanner(orderStatus.status === 'FILLED')}>
            <strong>Last Order:</strong> {orderStatus.type || orderStatus.status} — ID: #{orderStatus.orderId || orderStatus.id || '?'}
            {orderStatus.filledQty && ` — Filled: ${orderStatus.filledQty}`}
            {orderStatus.filledPrice && ` @ ${fmtPrice(orderStatus.filledPrice)}`}
          </div>
        )}
      </Card>

      {/* ── Active Positions ── */}
      <Card
        title="Active Positions"
        headerRight={
          <Button variant="gray" size="small"
            style={{ padding: '5px 14px', fontSize: '11px', border: `1px solid ${colors.borderMedium}`, borderRadius: '8px' }}
            onClick={fetchPositions}>↻ Refresh</Button>
        }
      >
        <DataTable
          columns={[
            { key: 'symbol', label: 'Symbol', render: pos => (
              <span style={{ fontWeight: 'bold', color: colors.textPrimary, fontSize: '14px' }}>{pos.symbol}</span>
            )},
            { key: 'quantity', label: 'Quantity', align: 'right', render: pos => fmtQty(pos.quantity) },
            { key: 'avgPrice', label: 'Avg Cost', align: 'right', render: pos => (
              <span style={{ color: colors.textSecondary }}>{fmtPrice(pos.avgPrice || pos.avg_price)}</span>
            )},
            { key: 'current', label: 'Current', align: 'right', render: pos => {
              const avg = Number(pos.avgPrice || pos.avg_price || 0);
              return fmtPrice(getCurrentPrice(pos.symbol) || avg);
            }},
            { key: 'mktValue', label: 'Mkt Value', align: 'right', render: pos => {
              const qty = Number(pos.quantity || 0);
              const avg = Number(pos.avgPrice || pos.avg_price || 0);
              const cur = getCurrentPrice(pos.symbol) || avg;
              return fmtUSD(cur * qty);
            }},
            { key: 'pnl', label: 'P&L ($)', align: 'right', render: pos => {
              const qty = Number(pos.quantity || 0);
              const avg = Number(pos.avgPrice || pos.avg_price || 0);
              const cur = getCurrentPrice(pos.symbol) || avg;
              const pnl = (cur - avg) * qty;
              return <span style={{ fontWeight: 'bold', color: pnlColor(pnl) }}>{fmtPnL(pnl)}</span>;
            }},
            { key: 'pnlPct', label: 'P&L (%)', align: 'right', render: pos => {
              const avg = Number(pos.avgPrice || pos.avg_price || 0);
              const cur = getCurrentPrice(pos.symbol) || avg;
              const pct = avg > 0 ? ((cur - avg) / avg * 100) : 0;
              return <span style={{ color: pnlColor(pct) }}>{fmtPct(pct)}</span>;
            }},
            { key: 'actions', label: 'Actions', align: 'center', render: pos => (
              <Button variant="red" size="small"
                onClick={() => sellPosition(pos.symbol, Number(pos.quantity || 0))}>
                SELL
              </Button>
            )},
          ]}
          data={positions.filter(p => Number(p.quantity) > 0)}
          rowKey={pos => pos.symbol}
          emptyText="No active positions — buy something to get started!"
          headerBorder="heavy"
        />
      </Card>

      {/* ── Sell Modal ── */}
      {sellModal && (
        <Modal open={true} onClose={() => setSellModal(null)}>
          <h3 style={{ color: colors.red, marginBottom: '20px', textAlign: 'left', fontSize: '18px', fontWeight: '700' }}>
            Sell {sellModal.symbol}
          </h3>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px',
            marginBottom: '16px', padding: '14px', borderRadius: '10px',
            backgroundColor: colors.bgStat, border: `1px solid ${colors.borderDefault}`,
          }}>
            <div>
              <div style={{ color: colors.textMuted, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Available</div>
              <div style={{ color: colors.textPrimary, fontWeight: '600' }}>{sellModal.quantity} {sellModal.symbol}</div>
            </div>
            <div>
              <div style={{ color: colors.textMuted, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Market Bid</div>
              <div style={{ color: colors.green, fontWeight: '600' }}>{fmtPrice(sellModal.price)}</div>
            </div>
          </div>
          <div style={{ marginBottom: '16px', textAlign: 'left' }}>
            <label style={{ color: colors.textMuted, fontSize: '11px', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: '600' }}>
              Quantity to Sell
            </label>
            <input
              type="number"
              value={sellModal.sellQty}
              onChange={e => setSellModal({ ...sellModal, sellQty: e.target.value })}
              max={sellModal.quantity}
              min="0.00000001"
              step="any"
              style={{
                width: '100%', padding: '11px 14px', background: colors.bgInput,
                border: `1px solid ${colors.borderMedium}`, borderRadius: '10px',
                color: colors.textPrimary, boxSizing: 'border-box', fontSize: '16px',
                outline: 'none',
              }}
            />
          </div>
          <StatCard label="Estimated Proceeds" valueColor={colors.green} valueSize="20px"
            value={fmtUSD(Number(sellModal.sellQty || 0) * sellModal.price)}
            style={{ marginBottom: '20px' }} />
          <div style={{ display: 'flex', gap: '12px' }}>
            <button onClick={executeSell} style={{
              flex: 1, background: `linear-gradient(135deg, ${colors.red}, #E0284F)`, color: '#fff', border: 'none',
              padding: '12px', borderRadius: '10px', cursor: 'pointer',
              fontWeight: '600', fontSize: '14px', transition: 'all 0.15s ease',
            }}>
              Confirm Sell
            </button>
            <button onClick={() => setSellModal(null)} style={{
              flex: 1, background: colors.bgInput, color: colors.textSecondary,
              border: `1px solid ${colors.borderMedium}`, padding: '12px', borderRadius: '10px',
              cursor: 'pointer', fontSize: '14px', transition: 'all 0.15s ease',
            }}>
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {/* ── My Orders ── */}
      <Card
        title="My Orders"
        headerRight={
          <Button variant="gray" size="small"
            style={{ padding: '5px 14px', fontSize: '11px', border: `1px solid ${colors.borderMedium}`, borderRadius: '8px' }}
            onClick={fetchOrders}>↻ Refresh</Button>
        }
      >
        <DataTable
          columns={[
            { key: 'id', label: 'ID', render: o => <span style={{ color: colors.textSecondary }}>#{o.id}</span> },
            { key: 'symbol', label: 'Symbol', render: o => <span style={{ color: colors.textPrimary, fontWeight: 'bold' }}>{o.symbol}</span> },
            { key: 'side', label: 'Side', render: o => <span style={{ fontWeight: 'bold', color: sideColor(o.side) }}>{o.side}</span> },
            { key: 'type', label: 'Type', render: o => <span style={{ color: colors.textSecondary }}>{o.orderType || o.type}</span> },
            { key: 'quantity', label: 'Qty', align: 'right', render: o => fmtNum(o.quantity) },
            { key: 'price', label: 'Price', align: 'right', render: o => fmtPrice(o.price) },
            { key: 'filled', label: 'Filled', align: 'right', render: o => (
              <span style={{ color: colors.textSecondary }}>
                {fmtNum(o.filledQty)}
                {o.filledPrice ? ` @ ${fmtPrice(o.filledPrice)}` : ''}
              </span>
            )},
            { key: 'status', label: 'Status', render: o => <StatusBadge status={o.status} /> },
            { key: 'time', label: 'Time', render: o => (
              <span style={{ color: colors.textMuted, fontSize: '11px' }}>{fmtDate(o.createdAt)}</span>
            )},
          ]}
          data={myOrders.slice().sort((a, b) => (b.id || 0) - (a.id || 0)).slice(0, 30)}
          rowKey={o => o.id}
          emptyText="No orders yet"
          small
          maxHeight="300px"
          headerBorder="heavy"
        />
      </Card>

      {/* ── Order Book ── */}
      <div style={gridCols('1fr 1fr')}>
        {[
          { title: 'Bids (Buy Orders)', color: colors.green, data: orderBook.bids, empty: 'No bids' },
          { title: 'Asks (Sell Orders)', color: colors.red, data: orderBook.asks, empty: 'No asks' },
        ].map(({ title, color, data, empty }) => (
          <Card key={title} title={title} titleColor={color}>
            <DataTable
              columns={[
                { key: 'orderId', label: 'Order ID', render: r => <span style={{ color: colors.textSecondary }}>#{r.orderId}</span> },
                { key: 'price', label: 'Price', align: 'right', render: r => (
                  <span style={{ color }}>{r.price != null ? fmtPrice(r.price) : 'MKT'}</span>
                )},
                { key: 'quantity', label: 'Qty', align: 'right' },
                { key: 'user', label: 'User', render: r => (
                  <span style={{ color: colors.textMuted }}>{r.username || `User#${r.userId}`}</span>
                )},
                { key: 'action', label: 'Action', align: 'center', render: r => (
                  <Button variant="darkRed" size="small"
                    style={{ padding: '2px 8px', fontSize: '10px' }}
                    onClick={() => cancelOrder(r.orderId)}>Cancel</Button>
                )},
              ]}
              data={data}
              emptyText={empty}
              small
              headerBorder="medium"
            />
          </Card>
        ))}
      </div>

      {/* ── Recent Trades ── */}
      {recentTrades.length > 0 && (
        <Card title="Recent Trades">
          <DataTable
            columns={[
              { key: 'tradeId', label: 'Trade ID', render: t => <span style={{ color: colors.textMuted, fontSize: '12px', fontFamily: "'SF Mono', monospace" }}>{t.tradeId}</span> },
              { key: 'symbol', label: 'Symbol', render: t => <span style={{ color: colors.textPrimary, fontSize: '13px', fontWeight: '600' }}>{t.symbol}</span> },
              { key: 'quantity', label: 'Qty', align: 'right', render: t => <span style={{ fontSize: '13px' }}>{t.quantity}</span> },
              { key: 'price', label: 'Price', align: 'right', render: t => <span style={{ color: colors.green, fontSize: '13px', fontWeight: '500' }}>{fmtPrice(t.price)}</span> },
              { key: 'buyer', label: 'Buyer', align: 'right', render: t => <span style={{ color: colors.textMuted, fontSize: '12px' }}>User#{t.buyUserId}</span> },
              { key: 'seller', label: 'Seller', align: 'right', render: t => <span style={{ color: colors.textMuted, fontSize: '12px' }}>User#{t.sellUserId}</span> },
            ]}
            data={recentTrades}
            emptyText="No trades"
            small
            headerBorder="medium"
          />
        </Card>
      )}

      {/* ── Admin Alerts ── */}
      {adminAlerts.length > 0 && (
        <Card variant="warning" title="Admin Alerts (leaked)" titleColor={colors.amber}>
          {adminAlerts.map((a, i) => (
            <div key={i} style={{
              padding: '10px 12px', borderBottom: `1px solid ${colors.borderDefault}`,
              fontSize: '12px', color: colors.amberLight, lineHeight: '1.5',
            }}>
              <span style={{
                display: 'inline-block', padding: '1px 6px', borderRadius: '4px',
                backgroundColor: colors.amberDark, fontSize: '10px', fontWeight: '600',
                marginRight: '8px', color: colors.amber,
              }}>{a.type || 'ALERT'}</span>
              {a.message || JSON.stringify(a)}
            </div>
          ))}
        </Card>
      )}
    </PageLayout>
  );
}

export default DashboardPage;