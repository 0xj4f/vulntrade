import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/apiService';
import { connectWebSocket, subscribe, sendMessage, disconnectWebSocket } from '../services/websocketService';
import { toast } from 'react-toastify';

function DashboardPage() {
  const { user } = useAuth();
  const [prices, setPrices] = useState([]);
  const [health, setHealth] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [recentTrades, setRecentTrades] = useState([]);
  const [orderForm, setOrderForm] = useState({
    symbol: 'AAPL', side: 'BUY', type: 'LIMIT', quantity: '10', price: '150.00'
  });
  const [orderStatus, setOrderStatus] = useState(null);
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

    // Connect to WebSocket for live prices
    connectWebSocket(
      (frame) => {
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
              // VULN: Internal fields received but not stripped
              marketMakerId: priceUpdate.marketMakerId,
              costBasis: priceUpdate.costBasis,
            };
            setPrices(Object.values(pricesRef.current));
          }
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
          toast.warn('Admin Alert: ' + (alert.message || alert.type));
        });

        // Subscribe to error queue
        subscribe('/user/queue/errors', (error) => {
          toast.error(error.message || 'Unknown error');
        });
      },
      (error) => {
        console.error('WebSocket error:', error);
        setWsConnected(false);
      }
    );

    return () => {
      disconnectWebSocket();
    };
  }, []);

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <h2 style={{ color: '#10b981', marginBottom: '24px' }}>Trading Dashboard</h2>

      {/* Health Status */}
      {health && (
        <div style={{
          backgroundColor: '#111827', padding: '16px', borderRadius: '8px',
          marginBottom: '24px', border: '1px solid #1f2937'
        }}>
          <h3 style={{ color: '#9ca3af', marginBottom: '8px' }}>System Status</h3>
          <span style={{
            color: health.status === 'UP' ? '#10b981' : '#ef4444',
            fontWeight: 'bold'
          }}>
            {health.status} — DB: {health.database} | Users: {health.users} | Symbols: {health.symbols}
          </span>
        </div>
      )}

      {/* User Info */}
      <div style={{
        backgroundColor: '#111827', padding: '16px', borderRadius: '8px',
        marginBottom: '24px', border: '1px solid #1f2937'
      }}>
        <h3 style={{ color: '#9ca3af', marginBottom: '8px' }}>Account</h3>
        <p>Username: <strong>{user?.username}</strong></p>
        <p>Role: <strong>{user?.role}</strong></p>
        <p>Balance: <strong style={{ color: '#10b981' }}>
          ${user?.balance ? Number(user.balance).toLocaleString() : '—'}
        </strong></p>
      </div>

      {/* Market Prices */}
      <div style={{
        backgroundColor: '#111827', padding: '16px', borderRadius: '8px',
        border: '1px solid #1f2937', marginBottom: '24px'
      }}>
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
            </tr>
          </thead>
          <tbody>
            {prices.map(p => (
              <tr key={p.symbol} style={{ borderBottom: '1px solid #1f2937' }}>
                <td style={{ padding: '8px', fontWeight: 'bold', color: '#e5e7eb' }}>
                  {/* VULN: dangerouslySetInnerHTML for symbol display */}
                  <span dangerouslySetInnerHTML={{ __html: p.symbol }} />
                </td>
                <td style={{ padding: '8px', color: '#9ca3af' }}>{p.name}</td>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Order Form */}
      <div style={{
        backgroundColor: '#111827', padding: '16px', borderRadius: '8px',
        border: '1px solid #1f2937', marginBottom: '24px'
      }}>
        <h3 style={{ color: '#9ca3af', marginBottom: '16px' }}>Place Order</h3>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={{ color: '#6b7280', fontSize: '12px', display: 'block' }}>Symbol</label>
            <select value={orderForm.symbol} onChange={e => setOrderForm({...orderForm, symbol: e.target.value})}
              style={{ background: '#1f2937', color: '#e5e7eb', border: '1px solid #374151', padding: '8px', borderRadius: '4px' }}>
              {prices.map(p => <option key={p.symbol} value={p.symbol}>{p.symbol}</option>)}
            </select>
          </div>
          <div>
            <label style={{ color: '#6b7280', fontSize: '12px', display: 'block' }}>Side</label>
            <select value={orderForm.side} onChange={e => setOrderForm({...orderForm, side: e.target.value})}
              style={{ background: '#1f2937', color: '#e5e7eb', border: '1px solid #374151', padding: '8px', borderRadius: '4px' }}>
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
          </div>
          <div>
            <label style={{ color: '#6b7280', fontSize: '12px', display: 'block' }}>Type</label>
            <select value={orderForm.type} onChange={e => setOrderForm({...orderForm, type: e.target.value})}
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
              style={{ background: '#1f2937', color: '#e5e7eb', border: '1px solid #374151', padding: '8px', borderRadius: '4px', width: '100px' }} />
          </div>
          <div>
            <label style={{ color: '#6b7280', fontSize: '12px', display: 'block' }}>Price</label>
            <input type="number" step="0.01" value={orderForm.price}
              onChange={e => setOrderForm({...orderForm, price: e.target.value})}
              disabled={orderForm.type === 'MARKET'}
              style={{ background: '#1f2937', color: '#e5e7eb', border: '1px solid #374151', padding: '8px', borderRadius: '4px', width: '120px' }} />
          </div>
          <button onClick={() => {
            // VULN: Client-side only validation
            if (Number(orderForm.quantity) <= 0 || Number(orderForm.quantity) > 10000) {
              toast.error('Quantity must be between 1 and 10000');
              return;
            }
            sendMessage('/app/trade.placeOrder', {
              symbol: orderForm.symbol,
              side: orderForm.side,
              type: orderForm.type,
              quantity: Number(orderForm.quantity),
              price: orderForm.type === 'MARKET' ? null : Number(orderForm.price),
              clientOrderId: 'web-' + Date.now()
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

      {/* Recent Trades */}
      {recentTrades.length > 0 && (
        <div style={{
          backgroundColor: '#111827', padding: '16px', borderRadius: '8px',
          border: '1px solid #1f2937'
        }}>
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
    </div>
  );
}

export default DashboardPage;
