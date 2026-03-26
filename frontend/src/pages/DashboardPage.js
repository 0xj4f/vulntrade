import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/apiService';
import { subscribe, sendMessage, isConnected } from '../services/websocketService';
import { toast } from 'react-toastify';

/**
 * Trading Dashboard — market prices, order form, positions with P&L, order history.
 */
function DashboardPage() {
  const { user, refreshUser } = useAuth();
  const [prices, setPrices] = useState([]);
  const [health, setHealth] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [recentTrades, setRecentTrades] = useState([]);
  const [orderBook, setOrderBook] = useState({ bids: [], asks: [] });
  const [orderForm, setOrderForm] = useState({
    symbol: 'AAPL', side: 'BUY', type: 'LIMIT', quantity: '10', price: '150.00'
  });
  const [orderStatus, setOrderStatus] = useState(null);
  const [adminAlerts, setAdminAlerts] = useState([]);
  const [positions, setPositions] = useState([]);
  const [myOrders, setMyOrders] = useState([]);
  const [orderError, setOrderError] = useState(null);
  const [sellModal, setSellModal] = useState(null); // { symbol, qty, price }
  const pricesRef = useRef({});

  // Fetch positions & orders
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

  // Refresh user balance from stored auth
  const refreshBalance = useCallback(() => {
    if (refreshUser) refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    // Fetch initial market prices via REST
    api.get('/api/market/prices')
      .then(res => {
        setPrices(res.data);
        res.data.forEach(p => { pricesRef.current[p.symbol] = p; });
      })
      .catch(err => console.error('Failed to fetch prices:', err));

    // Fetch health status
    api.get('/api/health')
      .then(res => setHealth(res.data))
      .catch(err => console.error('Failed to fetch health:', err));

    // Fetch initial order book for default symbol
    api.get('/api/market/orderbook/AAPL')
      .then(res => setOrderBook({ bids: res.data.bids || [], asks: res.data.asks || [] }))
      .catch(err => console.error('Failed to fetch orderbook:', err));

    // Subscribe to WS topics (connection managed by App.js)
    const setupSubscriptions = () => {
      if (!isConnected()) return false;
      setWsConnected(true);

      // Subscribe to live price feed
      subscribe('/topic/prices', (priceUpdate) => {
        if (priceUpdate.symbol) {
          pricesRef.current[priceUpdate.symbol] = {
            ...pricesRef.current[priceUpdate.symbol],
            currentPrice: priceUpdate.last,
            bid: priceUpdate.bid,
            ask: priceUpdate.ask,
            volume: priceUpdate.volume,
            // VULN: Internal fields received and displayed - not stripped
            marketMakerId: priceUpdate.marketMakerId,
            costBasis: priceUpdate.costBasis,
            spreadBps: priceUpdate.spreadBps,
          };
          setPrices(Object.values(pricesRef.current));
        }
      });

      // Subscribe to live order book - VULN: includes userId info
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

      // Subscribe to trade broadcasts - VULN: includes user IDs
      subscribe('/topic/trades', (trade) => {
        setRecentTrades(prev => [trade, ...prev].slice(0, 20));
      });

      // Subscribe to order updates for current user
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
        // Refresh positions and balance after any order update
        setTimeout(() => {
          fetchPositions();
          fetchOrders();
          refreshBalance();
        }, 500);
      });

      // VULN: Subscribe to admin alerts (any user can do this)
      subscribe('/topic/admin/alerts', (alert) => {
        console.log('[ADMIN ALERT]', alert);
        setAdminAlerts(prev => [alert, ...prev].slice(0, 10));
        toast.warn('Admin Alert: ' + (alert.message || alert.type));
      });

      // Subscribe to error queue — show errors prominently
      subscribe('/user/queue/errors', (error) => {
        const msg = error.message || 'Unknown error';
        setOrderError(msg);
        toast.error(`❌ ${msg}`, { autoClose: 8000 });
      });

      return true;
    };

    // Poll for WS connection readiness (managed by App.js)
    if (!setupSubscriptions()) {
      const interval = setInterval(() => {
        if (setupSubscriptions()) {
          clearInterval(interval);
        }
      }, 500);
      return () => clearInterval(interval);
    }
  }, [fetchPositions, fetchOrders, refreshBalance]);

  // Fetch positions & orders on mount
  useEffect(() => {
    fetchPositions();
    fetchOrders();
  }, [fetchPositions, fetchOrders]);

  // Fetch order book when symbol changes
  const fetchOrderBook = (symbol) => {
    api.get(`/api/market/orderbook/${symbol}`)
      .then(res => setOrderBook({ bids: res.data.bids || [], asks: res.data.asks || [] }))
      .catch(err => console.error('Failed to fetch orderbook:', err));
  };

  // VULN: Cancel any order by ID (IDOR - no ownership check)
  const cancelOrder = (orderId) => {
    sendMessage('/app/trade.cancelOrder', { orderId });
    toast.info(`Cancel request sent for order #${orderId}`);
  };

  // Sell position — opens sell modal or sends market sell directly
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
    sendMessage('/app/trade.placeOrder', {
      symbol: sellModal.symbol,
      side: 'SELL',
      type: 'MARKET',
      quantity: qty,
      price: sellModal.price,
      clientOrderId: 'sell-' + Date.now(),
    });
    toast.info(`Sell order submitted: ${qty} ${sellModal.symbol}`);
    setSellModal(null);
  };

  // Helper: get current price for a symbol
  const getCurrentPrice = (symbol) => {
    const p = pricesRef.current[symbol];
    return p ? Number(p.currentPrice || p.ask || 0) : 0;
  };

  const cardStyle = {
    backgroundColor: '#111827', padding: '16px', borderRadius: '8px',
    border: '1px solid #1f2937', marginBottom: '24px'
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      <h2 style={{ color: '#10b981', marginBottom: '24px' }}>Trading Dashboard</h2>

      {/* Health Status */}
      {health && (
        <div style={cardStyle}>
          <h3 style={{ color: '#9ca3af', marginBottom: '8px' }}>System Status</h3>
          <span style={{
            color: health.status === 'UP' ? '#10b981' : '#ef4444',
            fontWeight: 'bold'
          }}>
            {health.status} — DB: {health.database} | Users: {health.users} | Symbols: {health.symbols}
          </span>
          <span style={{ marginLeft: '16px', color: wsConnected ? '#10b981' : '#ef4444' }}>
            WS: {wsConnected ? '● LIVE' : '● OFFLINE'}
          </span>
        </div>
      )}

      {/* User Info */}
      <div style={cardStyle}>
        <h3 style={{ color: '#9ca3af', marginBottom: '8px' }}>Account</h3>
        <p>Username: <strong>{user?.username}</strong></p>
        <p>Role: <strong>{user?.role}</strong></p>
        <p>Balance: <strong style={{ color: '#10b981' }}>
          ${user?.balance ? Number(user.balance).toLocaleString() : '—'}
        </strong></p>
        {/* VULN: API key shown in UI */}
        <p style={{ fontSize: '11px', color: '#6b7280' }}>
          API Key: <code>{user?.apiKey || '—'}</code>
        </p>
      </div>

      {/* Market Prices - VULN: dangerouslySetInnerHTML for symbol AND name */}
      <div style={cardStyle}>
        <h3 style={{ color: '#9ca3af', marginBottom: '16px' }}>
          Market Prices {wsConnected ?
            <span style={{ color: '#10b981', fontSize: '12px' }}> ● LIVE</span> :
            <span style={{ color: '#ef4444', fontSize: '12px' }}> ● OFFLINE</span>}
        </h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #374151' }}>
              <th style={{ textAlign: 'left', padding: '8px', color: '#6b7280' }}>Symbol</th>
              <th style={{ textAlign: 'left', padding: '8px', color: '#6b7280' }}>Name</th>
              <th style={{ textAlign: 'right', padding: '8px', color: '#6b7280' }}>Price</th>
              <th style={{ textAlign: 'right', padding: '8px', color: '#6b7280' }}>Bid</th>
              <th style={{ textAlign: 'right', padding: '8px', color: '#6b7280' }}>Ask</th>
              <th style={{ textAlign: 'right', padding: '8px', color: '#6b7280' }}>Volume</th>
              <th style={{ textAlign: 'right', padding: '8px', color: '#6b7280' }}>Internal</th>
            </tr>
          </thead>
          <tbody>
            {prices.map(p => (
              <tr key={p.symbol} style={{ borderBottom: '1px solid #1f2937' }}>
                <td style={{ padding: '8px', fontWeight: 'bold', color: '#e5e7eb' }}>
                  {/* VULN: dangerouslySetInnerHTML for symbol display - XSS */}
                  <span dangerouslySetInnerHTML={{ __html: p.symbol }} />
                </td>
                <td style={{ padding: '8px', color: '#9ca3af' }}>
                  {/* VULN: dangerouslySetInnerHTML for name display - XSS */}
                  <span dangerouslySetInnerHTML={{ __html: p.name || '' }} />
                </td>
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
                {/* VULN: Internal fields displayed - info disclosure */}
                <td style={{ padding: '8px', textAlign: 'right', color: '#4b5563', fontSize: '10px' }}>
                  {p.marketMakerId && `MM:${p.marketMakerId}`}
                  {p.costBasis && ` CB:$${Number(p.costBasis).toFixed(2)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Order Form - VULN: hidden userId field, client-side only validation */}
      <div style={cardStyle}>
        <h3 style={{ color: '#9ca3af', marginBottom: '16px' }}>Place Order</h3>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {/* VULN: Hidden field with user ID - tamperable via DevTools */}
          <input type="hidden" id="order-user-id" value={user?.userId || user?.id || ''} />
          <div>
            <label style={{ color: '#6b7280', fontSize: '12px', display: 'block' }}>Symbol</label>
            <select value={orderForm.symbol} onChange={e => {
              const newSymbol = e.target.value;
              const newForm = {...orderForm, symbol: newSymbol};
              // If MARKET type, auto-update price to new symbol's market price
              if (orderForm.type === 'MARKET') {
                const symbolData = pricesRef.current[newSymbol];
                if (symbolData) {
                  const marketPrice = orderForm.side === 'BUY'
                    ? Number(symbolData.ask || symbolData.currentPrice)
                    : Number(symbolData.bid || symbolData.currentPrice);
                  newForm.price = marketPrice.toFixed(2);
                }
              }
              setOrderForm(newForm);
              fetchOrderBook(newSymbol);
            }}
              style={{ background: '#1f2937', color: '#e5e7eb', border: '1px solid #374151', padding: '8px', borderRadius: '4px' }}>
              {prices.map(p => <option key={p.symbol} value={p.symbol}>{p.symbol}</option>)}
            </select>
          </div>
          <div>
            <label style={{ color: '#6b7280', fontSize: '12px', display: 'block' }}>Side</label>
            <select value={orderForm.side} onChange={e => {
              const newSide = e.target.value;
              const newForm = {...orderForm, side: newSide};
              // If MARKET type, update price for new side (ask for BUY, bid for SELL)
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
            }}
              style={{ background: '#1f2937', color: '#e5e7eb', border: '1px solid #374151', padding: '8px', borderRadius: '4px' }}>
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
          </div>
          <div>
            <label style={{ color: '#6b7280', fontSize: '12px', display: 'block' }}>Type</label>
            <select value={orderForm.type} onChange={e => {
              const newType = e.target.value;
              if (newType === 'MARKET') {
                // Auto-fill with current market price
                const symbolData = pricesRef.current[orderForm.symbol];
                const marketPrice = symbolData
                  ? (orderForm.side === 'BUY'
                    ? Number(symbolData.ask || symbolData.currentPrice)
                    : Number(symbolData.bid || symbolData.currentPrice))
                  : '';
                setOrderForm({...orderForm, type: newType, price: marketPrice ? marketPrice.toFixed(2) : orderForm.price});
              } else {
                setOrderForm({...orderForm, type: newType});
              }
            }}
              style={{ background: '#1f2937', color: '#e5e7eb', border: '1px solid #374151', padding: '8px', borderRadius: '4px' }}>
              <option value="LIMIT">LIMIT</option>
              <option value="MARKET">MARKET</option>
            </select>
          </div>
          <div>
            <label style={{ color: '#6b7280', fontSize: '12px', display: 'block' }}>Quantity</label>
            {/* VULN: Client-side only validation for max order size */}
            <input type="number" value={orderForm.quantity}
              onChange={e => setOrderForm({...orderForm, quantity: e.target.value})}
              max="10000" min="1"
              style={{ background: '#1f2937', color: '#e5e7eb', border: '1px solid #374151', padding: '8px', borderRadius: '4px', width: '100px' }} />
          </div>
          <div>
            <label style={{ color: '#6b7280', fontSize: '12px', display: 'block' }}>Price</label>
            <input type="number" step="0.01" value={orderForm.price}
              onChange={e => setOrderForm({...orderForm, price: e.target.value})}
              readOnly={orderForm.type === 'MARKET'}
              style={{ background: orderForm.type === 'MARKET' ? '#0f172a' : '#1f2937', color: '#e5e7eb', border: '1px solid #374151', padding: '8px', borderRadius: '4px', width: '120px' }} />
          </div>
          <button onClick={() => {
            // VULN: Client-side only validation - bypass by modifying JS or sending direct WS message
            const qty = Number(orderForm.quantity);
            if (qty <= 0 || qty > 10000) {
              toast.error('Quantity must be between 1 and 10000');
              return;
            }
            if (orderForm.type === 'LIMIT' && Number(orderForm.price) <= 0) {
              toast.error('Price must be positive');
              return;
            }

            // For MARKET orders, resolve the price from live market data
            let orderPrice = null;
            if (orderForm.type === 'MARKET') {
              const symbolData = pricesRef.current[orderForm.symbol];
              if (symbolData) {
                // BUY at ask price, SELL at bid price
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

            // VULN: userId from hidden field (tamperable)
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
          }} style={{
            background: orderForm.side === 'BUY' ? '#10b981' : '#ef4444',
            color: '#fff', border: 'none', padding: '8px 24px', borderRadius: '4px',
            cursor: 'pointer', fontWeight: 'bold'
          }}>
            {orderForm.side} {orderForm.symbol}
          </button>
        </div>

        {/* Order Error Banner */}
        {orderError && (
          <div style={{
            marginTop: '12px', padding: '12px 16px', background: '#7f1d1d',
            border: '1px solid #ef4444', borderRadius: '6px', fontSize: '14px',
            color: '#fca5a5', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
          }}>
            <span>❌ <strong>Order Error:</strong> {orderError}</span>
            <button onClick={() => setOrderError(null)} style={{
              background: 'transparent', border: 'none', color: '#fca5a5',
              cursor: 'pointer', fontSize: '16px'
            }}>✕</button>
          </div>
        )}

        {/* Order Status */}
        {orderStatus && !orderError && (
          <div style={{
            marginTop: '12px', padding: '10px 16px',
            background: orderStatus.status === 'FILLED' ? '#064e3b' : '#1f2937',
            border: orderStatus.status === 'FILLED' ? '1px solid #10b981' : '1px solid #374151',
            borderRadius: '6px', fontSize: '13px', color: '#e5e7eb'
          }}>
            <strong>Last Order:</strong> {orderStatus.type || orderStatus.status} — ID: #{orderStatus.orderId || orderStatus.id || '?'}
            {orderStatus.filledQty && ` — Filled: ${orderStatus.filledQty}`}
            {orderStatus.filledPrice && ` @ $${Number(orderStatus.filledPrice).toFixed(2)}`}
          </div>
        )}
      </div>

      {/* ======================== ACTIVE POSITIONS ======================== */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ color: '#9ca3af', margin: 0 }}>📊 Active Positions</h3>
          <button onClick={fetchPositions} style={{
            background: '#1f2937', border: '1px solid #374151', color: '#9ca3af',
            padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px'
          }}>↻ Refresh</button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #374151' }}>
              <th style={{ textAlign: 'left', padding: '10px 8px', color: '#6b7280', fontSize: '12px' }}>Symbol</th>
              <th style={{ textAlign: 'right', padding: '10px 8px', color: '#6b7280', fontSize: '12px' }}>Quantity</th>
              <th style={{ textAlign: 'right', padding: '10px 8px', color: '#6b7280', fontSize: '12px' }}>Avg Cost</th>
              <th style={{ textAlign: 'right', padding: '10px 8px', color: '#6b7280', fontSize: '12px' }}>Current</th>
              <th style={{ textAlign: 'right', padding: '10px 8px', color: '#6b7280', fontSize: '12px' }}>Mkt Value</th>
              <th style={{ textAlign: 'right', padding: '10px 8px', color: '#6b7280', fontSize: '12px' }}>P&L ($)</th>
              <th style={{ textAlign: 'right', padding: '10px 8px', color: '#6b7280', fontSize: '12px' }}>P&L (%)</th>
              <th style={{ textAlign: 'center', padding: '10px 8px', color: '#6b7280', fontSize: '12px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {positions.filter(p => Number(p.quantity) > 0).map((pos, i) => {
              const qty = Number(pos.quantity || 0);
              const avgPrice = Number(pos.avgPrice || pos.avg_price || 0);
              const curPrice = getCurrentPrice(pos.symbol) || avgPrice;
              const mktValue = curPrice * qty;
              const pnl = (curPrice - avgPrice) * qty;
              const pnlPct = avgPrice > 0 ? ((curPrice - avgPrice) / avgPrice * 100) : 0;
              return (
                <tr key={pos.symbol || i} style={{ borderBottom: '1px solid #1f2937' }}>
                  <td style={{ padding: '10px 8px', fontWeight: 'bold', color: '#e5e7eb', fontSize: '14px' }}>
                    {pos.symbol}
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', color: '#e5e7eb' }}>
                    {qty.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', color: '#9ca3af' }}>
                    ${avgPrice.toFixed(2)}
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', color: '#e5e7eb' }}>
                    ${curPrice.toFixed(2)}
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', color: '#e5e7eb' }}>
                    ${mktValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td style={{
                    padding: '10px 8px', textAlign: 'right', fontWeight: 'bold',
                    color: pnl >= 0 ? '#10b981' : '#ef4444'
                  }}>
                    {pnl >= 0 ? '+' : ''}{pnl.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                  </td>
                  <td style={{
                    padding: '10px 8px', textAlign: 'right',
                    color: pnlPct >= 0 ? '#10b981' : '#ef4444'
                  }}>
                    {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                    <button onClick={() => sellPosition(pos.symbol, qty)} style={{
                      background: '#dc2626', color: '#fff', border: 'none',
                      padding: '6px 14px', borderRadius: '4px', cursor: 'pointer',
                      fontWeight: 'bold', fontSize: '12px'
                    }}>
                      SELL
                    </button>
                  </td>
                </tr>
              );
            })}
            {positions.filter(p => Number(p.quantity) > 0).length === 0 && (
              <tr>
                <td colSpan="8" style={{ padding: '24px', textAlign: 'center', color: '#4b5563' }}>
                  No active positions — buy something to get started!
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ======================== SELL MODAL ======================== */}
      {sellModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', zIndex: 1000
        }} onClick={() => setSellModal(null)}>
          <div style={{
            background: '#111827', border: '1px solid #374151', borderRadius: '12px',
            padding: '24px', width: '400px', maxWidth: '90vw'
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ color: '#ef4444', marginBottom: '16px' }}>
              Sell {sellModal.symbol}
            </h3>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ color: '#6b7280', fontSize: '12px', display: 'block', marginBottom: '4px' }}>
                Available: {sellModal.quantity} {sellModal.symbol}
              </label>
              <label style={{ color: '#6b7280', fontSize: '12px', display: 'block', marginBottom: '4px' }}>
                Market Bid: ${sellModal.price.toFixed(2)}
              </label>
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ color: '#6b7280', fontSize: '12px', display: 'block', marginBottom: '4px' }}>
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
                  width: '100%', padding: '10px', background: '#1f2937',
                  border: '1px solid #374151', borderRadius: '6px', color: '#e5e7eb',
                  boxSizing: 'border-box'
                }}
              />
            </div>
            <div style={{ marginBottom: '16px', padding: '12px', background: '#0f172a', borderRadius: '6px' }}>
              <div style={{ color: '#6b7280', fontSize: '12px' }}>Estimated Proceeds</div>
              <div style={{ color: '#10b981', fontSize: '20px', fontWeight: 'bold' }}>
                ${(Number(sellModal.sellQty || 0) * sellModal.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={executeSell} style={{
                flex: 1, background: '#dc2626', color: '#fff', border: 'none',
                padding: '12px', borderRadius: '6px', cursor: 'pointer',
                fontWeight: 'bold', fontSize: '14px'
              }}>
                Confirm Sell
              </button>
              <button onClick={() => setSellModal(null)} style={{
                flex: 1, background: '#374151', color: '#e5e7eb', border: 'none',
                padding: '12px', borderRadius: '6px', cursor: 'pointer', fontSize: '14px'
              }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================== MY ORDERS ======================== */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ color: '#9ca3af', margin: 0 }}>📋 My Orders</h3>
          <button onClick={fetchOrders} style={{
            background: '#1f2937', border: '1px solid #374151', color: '#9ca3af',
            padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px'
          }}>↻ Refresh</button>
        </div>
        <div style={{ maxHeight: '300px', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #374151' }}>
                <th style={{ textAlign: 'left', padding: '8px', color: '#6b7280' }}>ID</th>
                <th style={{ textAlign: 'left', padding: '8px', color: '#6b7280' }}>Symbol</th>
                <th style={{ textAlign: 'left', padding: '8px', color: '#6b7280' }}>Side</th>
                <th style={{ textAlign: 'left', padding: '8px', color: '#6b7280' }}>Type</th>
                <th style={{ textAlign: 'right', padding: '8px', color: '#6b7280' }}>Qty</th>
                <th style={{ textAlign: 'right', padding: '8px', color: '#6b7280' }}>Price</th>
                <th style={{ textAlign: 'right', padding: '8px', color: '#6b7280' }}>Filled</th>
                <th style={{ textAlign: 'left', padding: '8px', color: '#6b7280' }}>Status</th>
                <th style={{ textAlign: 'left', padding: '8px', color: '#6b7280' }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {myOrders.slice().sort((a, b) => (b.id || 0) - (a.id || 0)).slice(0, 30).map((o, i) => {
                const statusColor = o.status === 'FILLED' ? '#10b981'
                  : o.status === 'CANCELLED' ? '#6b7280'
                  : o.status === 'PARTIAL' ? '#f59e0b'
                  : '#3b82f6';
                return (
                  <tr key={o.id || i} style={{ borderBottom: '1px solid #1f2937' }}>
                    <td style={{ padding: '6px 8px', color: '#9ca3af' }}>#{o.id}</td>
                    <td style={{ padding: '6px 8px', color: '#e5e7eb', fontWeight: 'bold' }}>{o.symbol}</td>
                    <td style={{
                      padding: '6px 8px', fontWeight: 'bold',
                      color: o.side === 'BUY' ? '#10b981' : '#ef4444'
                    }}>{o.side}</td>
                    <td style={{ padding: '6px 8px', color: '#9ca3af' }}>{o.orderType || o.type}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: '#e5e7eb' }}>
                      {Number(o.quantity || 0).toLocaleString()}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: '#e5e7eb' }}>
                      ${Number(o.price || 0).toFixed(2)}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: '#9ca3af' }}>
                      {Number(o.filledQty || 0).toLocaleString()}
                      {o.filledPrice ? ` @ $${Number(o.filledPrice).toFixed(2)}` : ''}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <span style={{
                        color: statusColor, fontWeight: 'bold',
                        padding: '2px 8px', borderRadius: '4px',
                        background: statusColor + '20', fontSize: '11px'
                      }}>{o.status}</span>
                    </td>
                    <td style={{ padding: '6px 8px', color: '#6b7280', fontSize: '11px' }}>
                      {o.createdAt ? new Date(o.createdAt).toLocaleString() : '—'}
                    </td>
                  </tr>
                );
              })}
              {myOrders.length === 0 && (
                <tr>
                  <td colSpan="9" style={{ padding: '16px', textAlign: 'center', color: '#4b5563' }}>
                    No orders yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Order Book - VULN: Displays order IDs enabling targeted cancellation */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
        <div style={cardStyle}>
          <h3 style={{ color: '#10b981', marginBottom: '12px' }}>Bids (Buy Orders)</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #374151' }}>
                <th style={{ textAlign: 'left', padding: '4px', color: '#6b7280' }}>Order ID</th>
                <th style={{ textAlign: 'right', padding: '4px', color: '#6b7280' }}>Price</th>
                <th style={{ textAlign: 'right', padding: '4px', color: '#6b7280' }}>Qty</th>
                <th style={{ textAlign: 'left', padding: '4px', color: '#6b7280' }}>User</th>
                <th style={{ textAlign: 'center', padding: '4px', color: '#6b7280' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {orderBook.bids.map((b, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1f2937' }}>
                  {/* VULN: Order ID exposed - enables targeted cancellation */}
                  <td style={{ padding: '4px', color: '#9ca3af' }}>#{b.orderId}</td>
                  <td style={{ padding: '4px', textAlign: 'right', color: '#10b981' }}>
                    {b.price != null ? `$${Number(b.price).toFixed(2)}` : 'MKT'}
                  </td>
                  <td style={{ padding: '4px', textAlign: 'right', color: '#e5e7eb' }}>{b.quantity}</td>
                  {/* VULN: userId exposed in order book */}
                  <td style={{ padding: '4px', color: '#6b7280' }}>
                    {b.username || `User#${b.userId}`}
                  </td>
                  <td style={{ padding: '4px', textAlign: 'center' }}>
                    <button onClick={() => cancelOrder(b.orderId)} style={{
                      background: '#7f1d1d', color: '#fca5a5', border: 'none',
                      padding: '2px 8px', borderRadius: '3px', cursor: 'pointer', fontSize: '10px'
                    }}>Cancel</button>
                  </td>
                </tr>
              ))}
              {orderBook.bids.length === 0 && (
                <tr><td colSpan="5" style={{ padding: '8px', color: '#4b5563', textAlign: 'center' }}>No bids</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={cardStyle}>
          <h3 style={{ color: '#ef4444', marginBottom: '12px' }}>Asks (Sell Orders)</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #374151' }}>
                <th style={{ textAlign: 'left', padding: '4px', color: '#6b7280' }}>Order ID</th>
                <th style={{ textAlign: 'right', padding: '4px', color: '#6b7280' }}>Price</th>
                <th style={{ textAlign: 'right', padding: '4px', color: '#6b7280' }}>Qty</th>
                <th style={{ textAlign: 'left', padding: '4px', color: '#6b7280' }}>User</th>
                <th style={{ textAlign: 'center', padding: '4px', color: '#6b7280' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {orderBook.asks.map((a, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1f2937' }}>
                  <td style={{ padding: '4px', color: '#9ca3af' }}>#{a.orderId}</td>
                  <td style={{ padding: '4px', textAlign: 'right', color: '#ef4444' }}>
                    {a.price != null ? `$${Number(a.price).toFixed(2)}` : 'MKT'}
                  </td>
                  <td style={{ padding: '4px', textAlign: 'right', color: '#e5e7eb' }}>{a.quantity}</td>
                  <td style={{ padding: '4px', color: '#6b7280' }}>
                    {a.username || `User#${a.userId}`}
                  </td>
                  <td style={{ padding: '4px', textAlign: 'center' }}>
                    <button onClick={() => cancelOrder(a.orderId)} style={{
                      background: '#7f1d1d', color: '#fca5a5', border: 'none',
                      padding: '2px 8px', borderRadius: '3px', cursor: 'pointer', fontSize: '10px'
                    }}>Cancel</button>
                  </td>
                </tr>
              ))}
              {orderBook.asks.length === 0 && (
                <tr><td colSpan="5" style={{ padding: '8px', color: '#4b5563', textAlign: 'center' }}>No asks</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Trades - VULN: user IDs disclosed */}
      {recentTrades.length > 0 && (
        <div style={cardStyle}>
          <h3 style={{ color: '#9ca3af', marginBottom: '16px' }}>Recent Trades (Live)</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #374151' }}>
                <th style={{ textAlign: 'left', padding: '6px', color: '#6b7280', fontSize: '12px' }}>Trade ID</th>
                <th style={{ textAlign: 'left', padding: '6px', color: '#6b7280', fontSize: '12px' }}>Symbol</th>
                <th style={{ textAlign: 'right', padding: '6px', color: '#6b7280', fontSize: '12px' }}>Qty</th>
                <th style={{ textAlign: 'right', padding: '6px', color: '#6b7280', fontSize: '12px' }}>Price</th>
                <th style={{ textAlign: 'right', padding: '6px', color: '#6b7280', fontSize: '12px' }}>Buyer</th>
                <th style={{ textAlign: 'right', padding: '6px', color: '#6b7280', fontSize: '12px' }}>Seller</th>
              </tr>
            </thead>
            <tbody>
              {recentTrades.map((t, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1f2937' }}>
                  <td style={{ padding: '6px', color: '#9ca3af', fontSize: '12px' }}>{t.tradeId}</td>
                  <td style={{ padding: '6px', color: '#e5e7eb', fontSize: '12px' }}>{t.symbol}</td>
                  <td style={{ padding: '6px', textAlign: 'right', color: '#e5e7eb', fontSize: '12px' }}>{t.quantity}</td>
                  <td style={{ padding: '6px', textAlign: 'right', color: '#10b981', fontSize: '12px' }}>${Number(t.price).toFixed(2)}</td>
                  {/* VULN: User IDs disclosed in trade broadcast */}
                  <td style={{ padding: '6px', textAlign: 'right', color: '#6b7280', fontSize: '12px' }}>User#{t.buyUserId}</td>
                  <td style={{ padding: '6px', textAlign: 'right', color: '#6b7280', fontSize: '12px' }}>User#{t.sellUserId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Admin Alerts - VULN: visible to any user */}
      {adminAlerts.length > 0 && (
        <div style={{ ...cardStyle, border: '1px solid #92400e' }}>
          <h3 style={{ color: '#f59e0b', marginBottom: '12px' }}>⚠️ Admin Alerts (leaked)</h3>
          {adminAlerts.map((a, i) => (
            <div key={i} style={{ padding: '6px', borderBottom: '1px solid #1f2937', fontSize: '12px', color: '#fbbf24' }}>
              [{a.type || 'ALERT'}] {a.message || JSON.stringify(a)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default DashboardPage;
