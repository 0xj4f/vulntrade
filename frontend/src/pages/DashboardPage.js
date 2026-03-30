import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import {
  colors, selectStyle, flexRowWrap, gridCols,
  orderErrorBanner, orderStatusBanner,
} from '../styles/shared';

function DashboardPage() {
  const { user, refreshUser } = useAuth();
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

  // ── Keep MARKET order price in sync with live prices ──
  useEffect(() => {
    if (orderForm.type !== 'MARKET') return;
    const livePrice = getSymbolPrice(orderForm.symbol, orderForm.side);
    if (livePrice && livePrice.toFixed(2) !== orderForm.price) {
      setOrderForm(prev => {
        if (prev.type !== 'MARKET') return prev;
        const p = getSymbolPrice(prev.symbol, prev.side);
        if (!p) return prev;
        return { ...prev, price: p.toFixed(2) };
      });
    }
  }, [prices, orderForm.type, orderForm.symbol, orderForm.side]);

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
          setPrices(Object.values(pricesRef.current));
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
        setTimeout(refreshAll, 300);
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
        refreshAfterOrder();
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
  }, [fetchPositions, fetchOrders, refreshBalance, refreshAll, refreshAfterOrder]);

  useEffect(() => { fetchPositions(); fetchOrders(); }, [fetchPositions, fetchOrders]);

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

  const executeSell = () => {
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

      {health && (
        <Card title="System Status">
          <span style={{ color: health.status === 'UP' ? colors.green : colors.red, fontWeight: 'bold' }}>
            {health.status} — DB: {health.database} | Users: {health.users} | Symbols: {health.symbols}
          </span>
          <span style={{ marginLeft: '16px', color: wsConnected ? colors.green : colors.red }}>
            WS: {wsConnected ? '● LIVE' : '● OFFLINE'}
          </span>
        </Card>
      )}

      <Card title="Account">
        <p>Username: <strong>{user?.username}</strong></p>
        <p>Role: <strong>{user?.role}</strong></p>
        <p>Balance: <strong style={{ color: colors.green }}>
          ${user?.balance ? Number(user.balance).toLocaleString() : '—'}
        </strong></p>
        <p style={{ fontSize: '11px', color: colors.textMuted }}>
          API Key: <code>{user?.apiKey || '—'}</code>
        </p>
      </Card>

      {/* ── Market Prices ── */}
      <Card title={<>Market Prices {wsConnected
        ? <span style={{ color: colors.green, fontSize: '12px' }}> ● LIVE</span>
        : <span style={{ color: colors.red, fontSize: '12px' }}> ● OFFLINE</span>}
      </>}>
        <DataTable
          columns={[
            { key: 'symbol', label: 'Symbol', render: p => (
              <span style={{ fontWeight: 'bold', color: colors.textPrimary }}
                dangerouslySetInnerHTML={{ __html: p.symbol }} />
            )},
            { key: 'name', label: 'Name', render: p => (
              <span style={{ color: colors.textSecondary }}
                dangerouslySetInnerHTML={{ __html: p.name || '' }} />
            )},
            { key: 'price', label: 'Price', align: 'right', render: p => (
              <span style={{ color: colors.green }}>${Number(p.currentPrice).toFixed(2)}</span>
            )},
            { key: 'bid', label: 'Bid', align: 'right', render: p => (
              <span style={{ color: colors.textMuted }}>{p.bid ? `$${Number(p.bid).toFixed(2)}` : '—'}</span>
            )},
            { key: 'ask', label: 'Ask', align: 'right', render: p => (
              <span style={{ color: colors.textMuted }}>{p.ask ? `$${Number(p.ask).toFixed(2)}` : '—'}</span>
            )},
            { key: 'volume', label: 'Volume', align: 'right', render: p => (
              <span style={{ color: colors.textMuted }}>{p.volume ? Number(p.volume).toLocaleString() : '—'}</span>
            )},
            { key: 'internal', label: 'Internal', align: 'right', render: p => (
              <span style={{ color: colors.textDim, fontSize: '10px' }}>
                {p.marketMakerId && `MM:${p.marketMakerId}`}
                {p.costBasis && ` CB:$${Number(p.costBasis).toFixed(2)}`}
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

          <FormField label="Symbol">
            <select value={orderForm.symbol} onChange={e => {
              const newSymbol = e.target.value;
              const newForm = { ...orderForm, symbol: newSymbol };
              // Always update price to new symbol's market price
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

          <FormField label="Side">
            <select value={orderForm.side} onChange={e => {
              const newSide = e.target.value;
              const newForm = { ...orderForm, side: newSide };
              if (orderForm.type === 'MARKET') {
                const symbolData = pricesRef.current[orderForm.symbol];
                if (symbolData) {
                  const marketPrice = newSide === 'BUY'
                    ? Number(symbolData.ask || symbolData.currentPrice)
                    : Number(symbolData.bid || symbolData.currentPrice);
                  newForm.price = marketPrice.toFixed(2);
                }
              }
              setOrderForm(newForm);
            }} style={selectStyle}>
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
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
              style={{ background: orderForm.type === 'MARKET' ? colors.bgStat : colors.bgInput }} />
          </FormField>

          <Button
            variant={orderForm.side === 'BUY' ? 'green' : 'red'}
            style={{ padding: '8px 24px' }}
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
            {orderStatus.filledPrice && ` @ $${Number(orderStatus.filledPrice).toFixed(2)}`}
          </div>
        )}
      </Card>

      {/* ── Active Positions ── */}
      <Card
        title="📊 Active Positions"
        headerRight={
          <Button variant="gray" size="small"
            style={{ padding: '4px 12px', fontSize: '12px', border: `1px solid ${colors.borderMedium}` }}
            onClick={fetchPositions}>↻ Refresh</Button>
        }
      >
        <DataTable
          columns={[
            { key: 'symbol', label: 'Symbol', render: pos => (
              <span style={{ fontWeight: 'bold', color: colors.textPrimary, fontSize: '14px' }}>{pos.symbol}</span>
            )},
            { key: 'quantity', label: 'Quantity', align: 'right', render: pos =>
              Number(pos.quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 8 })
            },
            { key: 'avgPrice', label: 'Avg Cost', align: 'right', render: pos => (
              <span style={{ color: colors.textSecondary }}>${Number(pos.avgPrice || pos.avg_price || 0).toFixed(2)}</span>
            )},
            { key: 'current', label: 'Current', align: 'right', render: pos => {
              const avg = Number(pos.avgPrice || pos.avg_price || 0);
              return `$${(getCurrentPrice(pos.symbol) || avg).toFixed(2)}`;
            }},
            { key: 'mktValue', label: 'Mkt Value', align: 'right', render: pos => {
              const qty = Number(pos.quantity || 0);
              const avg = Number(pos.avgPrice || pos.avg_price || 0);
              const cur = getCurrentPrice(pos.symbol) || avg;
              return `$${(cur * qty).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }},
            { key: 'pnl', label: 'P&L ($)', align: 'right', render: pos => {
              const qty = Number(pos.quantity || 0);
              const avg = Number(pos.avgPrice || pos.avg_price || 0);
              const cur = getCurrentPrice(pos.symbol) || avg;
              const pnl = (cur - avg) * qty;
              return (
                <span style={{ fontWeight: 'bold', color: pnl >= 0 ? colors.green : colors.red }}>
                  {pnl >= 0 ? '+' : ''}{pnl.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                </span>
              );
            }},
            { key: 'pnlPct', label: 'P&L (%)', align: 'right', render: pos => {
              const avg = Number(pos.avgPrice || pos.avg_price || 0);
              const cur = getCurrentPrice(pos.symbol) || avg;
              const pct = avg > 0 ? ((cur - avg) / avg * 100) : 0;
              return (
                <span style={{ color: pct >= 0 ? colors.green : colors.red }}>
                  {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                </span>
              );
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
          <h3 style={{ color: colors.red, marginBottom: '16px', textAlign: 'left' }}>
            Sell {sellModal.symbol}
          </h3>
          <div style={{ marginBottom: '12px', textAlign: 'left' }}>
            <label style={{ color: colors.textMuted, fontSize: '12px', display: 'block', marginBottom: '4px' }}>
              Available: {sellModal.quantity} {sellModal.symbol}
            </label>
            <label style={{ color: colors.textMuted, fontSize: '12px', display: 'block', marginBottom: '4px' }}>
              Market Bid: ${sellModal.price.toFixed(2)}
            </label>
          </div>
          <div style={{ marginBottom: '16px', textAlign: 'left' }}>
            <label style={{ color: colors.textMuted, fontSize: '12px', display: 'block', marginBottom: '4px' }}>
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
                width: '100%', padding: '10px', background: colors.bgInput,
                border: `1px solid ${colors.borderMedium}`, borderRadius: '6px',
                color: colors.textPrimary, boxSizing: 'border-box'
              }}
            />
          </div>
          <StatCard label="Estimated Proceeds" valueColor={colors.green} valueSize="20px"
            value={`$${(Number(sellModal.sellQty || 0) * sellModal.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            style={{ marginBottom: '16px' }} />
          <div style={{ display: 'flex', gap: '12px' }}>
            <button onClick={executeSell} style={{
              flex: 1, background: '#dc2626', color: '#fff', border: 'none',
              padding: '12px', borderRadius: '6px', cursor: 'pointer',
              fontWeight: 'bold', fontSize: '14px'
            }}>
              Confirm Sell
            </button>
            <button onClick={() => setSellModal(null)} style={{
              flex: 1, background: colors.borderMedium, color: colors.textPrimary,
              border: 'none', padding: '12px', borderRadius: '6px',
              cursor: 'pointer', fontSize: '14px'
            }}>
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {/* ── My Orders ── */}
      <Card
        title="📋 My Orders"
        headerRight={
          <Button variant="gray" size="small"
            style={{ padding: '4px 12px', fontSize: '12px', border: `1px solid ${colors.borderMedium}` }}
            onClick={fetchOrders}>↻ Refresh</Button>
        }
      >
        <DataTable
          columns={[
            { key: 'id', label: 'ID', render: o => <span style={{ color: colors.textSecondary }}>#{o.id}</span> },
            { key: 'symbol', label: 'Symbol', render: o => <span style={{ color: colors.textPrimary, fontWeight: 'bold' }}>{o.symbol}</span> },
            { key: 'side', label: 'Side', render: o => <span style={{ fontWeight: 'bold', color: o.side === 'BUY' ? colors.green : colors.red }}>{o.side}</span> },
            { key: 'type', label: 'Type', render: o => <span style={{ color: colors.textSecondary }}>{o.orderType || o.type}</span> },
            { key: 'quantity', label: 'Qty', align: 'right', render: o => Number(o.quantity || 0).toLocaleString() },
            { key: 'price', label: 'Price', align: 'right', render: o => `$${Number(o.price || 0).toFixed(2)}` },
            { key: 'filled', label: 'Filled', align: 'right', render: o => (
              <span style={{ color: colors.textSecondary }}>
                {Number(o.filledQty || 0).toLocaleString()}
                {o.filledPrice ? ` @ $${Number(o.filledPrice).toFixed(2)}` : ''}
              </span>
            )},
            { key: 'status', label: 'Status', render: o => <StatusBadge status={o.status} /> },
            { key: 'time', label: 'Time', render: o => (
              <span style={{ color: colors.textMuted, fontSize: '11px' }}>
                {o.createdAt ? new Date(o.createdAt).toLocaleString() : '—'}
              </span>
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
                  <span style={{ color }}>{r.price != null ? `$${Number(r.price).toFixed(2)}` : 'MKT'}</span>
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
        <Card title="Recent Trades (Live)">
          <DataTable
            columns={[
              { key: 'tradeId', label: 'Trade ID', render: t => <span style={{ color: colors.textSecondary, fontSize: '12px' }}>{t.tradeId}</span> },
              { key: 'symbol', label: 'Symbol', render: t => <span style={{ color: colors.textPrimary, fontSize: '12px' }}>{t.symbol}</span> },
              { key: 'quantity', label: 'Qty', align: 'right', render: t => <span style={{ fontSize: '12px' }}>{t.quantity}</span> },
              { key: 'price', label: 'Price', align: 'right', render: t => <span style={{ color: colors.green, fontSize: '12px' }}>${Number(t.price).toFixed(2)}</span> },
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
        <Card variant="warning" title="⚠️ Admin Alerts (leaked)" titleColor={colors.amber}>
          {adminAlerts.map((a, i) => (
            <div key={i} style={{
              padding: '6px', borderBottom: `1px solid ${colors.borderDefault}`,
              fontSize: '12px', color: colors.amberLight,
            }}>
              [{a.type || 'ALERT'}] {a.message || JSON.stringify(a)}
            </div>
          ))}
        </Card>
      )}
    </PageLayout>
  );
}

export default DashboardPage;