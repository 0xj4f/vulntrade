import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/apiService';
import { subscribe, sendMessage, isConnected } from '../services/websocketService';
import { toast } from 'react-toastify';

/**
 * PHASE 6 VULNS:
 * - dangerouslySetInnerHTML for symbol names AND display names (XSS)
 * - Price display trusts server data without sanitization
 * - Client-side only validation for max order size (10000)
 * - Hidden form field contains user ID (tamperable via DevTools)
 * - Order book displays order IDs enabling targeted cancellation
 * - Internal price fields (costBasis, marketMakerId) displayed
 */
function DashboardPage() {
  const { user } = useAuth();
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
  const pricesRef = useRef({});

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
        toast.info('Order update: ' + (order.type || order.status));
      });

      // VULN: Subscribe to admin alerts (any user can do this)
      subscribe('/topic/admin/alerts', (alert) => {
        console.log('[ADMIN ALERT]', alert); // VULN: leaked to console
        setAdminAlerts(prev => [alert, ...prev].slice(0, 10));
        toast.warn('Admin Alert: ' + (alert.message || alert.type));
      });

      // Subscribe to error queue
      subscribe('/user/queue/errors', (error) => {
        toast.error(error.message || 'Unknown error');
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
  }, []);

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
          }} style={{
            background: orderForm.side === 'BUY' ? '#10b981' : '#ef4444',
            color: '#fff', border: 'none', padding: '8px 24px', borderRadius: '4px',
            cursor: 'pointer', fontWeight: 'bold'
          }}>
            {orderForm.side} {orderForm.symbol}
          </button>
        </div>
        {orderStatus && (
          <div style={{ marginTop: '12px', padding: '8px', background: '#1f2937', borderRadius: '4px', fontSize: '13px' }}>
            <strong>Last Order:</strong> {orderStatus.type || orderStatus.status} — ID: {orderStatus.orderId}
          </div>
        )}
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
