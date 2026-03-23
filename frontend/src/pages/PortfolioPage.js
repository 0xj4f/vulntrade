import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/apiService';
import { toast } from 'react-toastify';

/**
 * PHASE 6 VULNS:
 * - VULN: userId passed in API call (changeable via DevTools) → IDOR
 * - VULN: P&L calculated client-side (manipulable via React DevTools)
 * - VULN: Balance and notes exposed in portfolio response
 * - VULN: No server-side ownership check on portfolio endpoint
 */
function PortfolioPage() {
  const { user } = useAuth();
  const [portfolio, setPortfolio] = useState(null);
  const [positions, setPositions] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [lookupUserId, setLookupUserId] = useState('');
  const [currentPrices, setCurrentPrices] = useState({});
  const [totalPnL, setTotalPnL] = useState(0);

  useEffect(() => {
    // Fetch current prices for P&L calculation
    api.get('/api/market/prices')
      .then(res => {
        const priceMap = {};
        res.data.forEach(p => { priceMap[p.symbol] = p.currentPrice; });
        setCurrentPrices(priceMap);
      })
      .catch(err => console.error('Failed to fetch prices:', err));

    // Fetch own portfolio
    if (user?.userId) {
      fetchPortfolio(user.userId);
      fetchTransactions(user.userId);
    }
  }, [user]);

  // VULN: userId passed directly in URL - IDOR
  const fetchPortfolio = (userId) => {
    api.get(`/api/users/${userId}/portfolio`)
      .then(res => {
        setPortfolio(res.data);
        setPositions(res.data.positions || []);
      })
      .catch(err => {
        console.error('Failed to fetch portfolio:', err);
        toast.error('Failed to load portfolio');
      });
  };

  // VULN: userId passed in query param - IDOR
  const fetchTransactions = (userId) => {
    api.get(`/api/accounts/transactions?userId=${userId}`)
      .then(res => setTransactions(res.data || []))
      .catch(err => console.error('Failed to fetch transactions:', err));
  };

  // VULN: P&L calculated entirely client-side - manipulable via DevTools
  useEffect(() => {
    if (positions.length > 0 && Object.keys(currentPrices).length > 0) {
      let total = 0;
      positions.forEach(pos => {
        const currentPrice = currentPrices[pos.symbol] || 0;
        const avgPrice = pos.avgPrice || pos.avg_price || 0;
        const qty = pos.quantity || 0;
        // VULN: Using floating point arithmetic (precision errors)
        const pnl = (currentPrice - avgPrice) * qty;
        total += pnl;
      });
      setTotalPnL(total);
    }
  }, [positions, currentPrices]);

  const handleLookupPortfolio = (e) => {
    e.preventDefault();
    if (lookupUserId) {
      fetchPortfolio(lookupUserId);
      fetchTransactions(lookupUserId);
      toast.info(`Loading portfolio for user #${lookupUserId}`);
    }
  };

  const cardStyle = {
    backgroundColor: '#111827', padding: '20px', borderRadius: '8px',
    marginBottom: '20px', border: '1px solid #1f2937'
  };

  const inputStyle = {
    padding: '10px', backgroundColor: '#1f2937',
    border: '1px solid #374151', borderRadius: '6px', color: '#e5e7eb',
    boxSizing: 'border-box'
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <h2 style={{ color: '#10b981', marginBottom: '24px' }}>Portfolio</h2>

      {/* Account Summary */}
      <div style={cardStyle}>
        <h3 style={{ color: '#9ca3af', marginBottom: '12px' }}>Account Summary</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
          <div style={{ padding: '16px', background: '#0f172a', borderRadius: '8px' }}>
            <div style={{ color: '#6b7280', fontSize: '12px', marginBottom: '4px' }}>Cash Balance</div>
            <div style={{ color: '#10b981', fontSize: '24px', fontWeight: 'bold' }}>
              ${portfolio?.balance ? Number(portfolio.balance).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'}
            </div>
          </div>
          <div style={{ padding: '16px', background: '#0f172a', borderRadius: '8px' }}>
            <div style={{ color: '#6b7280', fontSize: '12px', marginBottom: '4px' }}>Unrealized P&L</div>
            {/* VULN: P&L calculated client-side - can be manipulated */}
            <div style={{ color: totalPnL >= 0 ? '#10b981' : '#ef4444', fontSize: '24px', fontWeight: 'bold' }}>
              {totalPnL >= 0 ? '+' : ''}{totalPnL.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
            </div>
          </div>
          <div style={{ padding: '16px', background: '#0f172a', borderRadius: '8px' }}>
            <div style={{ color: '#6b7280', fontSize: '12px', marginBottom: '4px' }}>Positions</div>
            <div style={{ color: '#e5e7eb', fontSize: '24px', fontWeight: 'bold' }}>
              {positions.length}
            </div>
          </div>
        </div>
        {/* VULN: Notes field exposed - may contain flags */}
        {portfolio?.notes && (
          <div style={{ marginTop: '12px', padding: '8px', background: '#1e1b4b', borderRadius: '4px', fontSize: '12px', color: '#a5b4fc' }}>
            Notes: {portfolio.notes}
          </div>
        )}
      </div>

      {/* Holdings Table - VULN: userId in API call */}
      <div style={cardStyle}>
        <h3 style={{ color: '#9ca3af', marginBottom: '16px' }}>Holdings</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #374151' }}>
              <th style={{ textAlign: 'left', padding: '8px', color: '#6b7280' }}>Symbol</th>
              <th style={{ textAlign: 'right', padding: '8px', color: '#6b7280' }}>Quantity</th>
              <th style={{ textAlign: 'right', padding: '8px', color: '#6b7280' }}>Avg Price</th>
              <th style={{ textAlign: 'right', padding: '8px', color: '#6b7280' }}>Current Price</th>
              <th style={{ textAlign: 'right', padding: '8px', color: '#6b7280' }}>Market Value</th>
              <th style={{ textAlign: 'right', padding: '8px', color: '#6b7280' }}>P&L</th>
              <th style={{ textAlign: 'right', padding: '8px', color: '#6b7280' }}>P&L %</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((pos, i) => {
              const currentPrice = currentPrices[pos.symbol] || 0;
              const avgPrice = pos.avgPrice || pos.avg_price || 0;
              const qty = pos.quantity || 0;
              // VULN: Client-side P&L calculation with floating point
              const marketValue = currentPrice * qty;
              const pnl = (currentPrice - avgPrice) * qty;
              const pnlPct = avgPrice > 0 ? ((currentPrice - avgPrice) / avgPrice * 100) : 0;

              return (
                <tr key={i} style={{ borderBottom: '1px solid #1f2937' }}>
                  <td style={{ padding: '8px', fontWeight: 'bold', color: '#e5e7eb' }}>{pos.symbol}</td>
                  <td style={{ padding: '8px', textAlign: 'right', color: '#e5e7eb' }}>
                    {Number(qty).toLocaleString()}
                  </td>
                  <td style={{ padding: '8px', textAlign: 'right', color: '#9ca3af' }}>
                    ${Number(avgPrice).toFixed(2)}
                  </td>
                  <td style={{ padding: '8px', textAlign: 'right', color: '#e5e7eb' }}>
                    ${Number(currentPrice).toFixed(2)}
                  </td>
                  <td style={{ padding: '8px', textAlign: 'right', color: '#e5e7eb' }}>
                    ${marketValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: '8px', textAlign: 'right', color: pnl >= 0 ? '#10b981' : '#ef4444' }}>
                    {pnl >= 0 ? '+' : ''}{pnl.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                  </td>
                  <td style={{ padding: '8px', textAlign: 'right', color: pnlPct >= 0 ? '#10b981' : '#ef4444' }}>
                    {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                  </td>
                </tr>
              );
            })}
            {positions.length === 0 && (
              <tr><td colSpan="7" style={{ padding: '16px', textAlign: 'center', color: '#4b5563' }}>No positions</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Recent Transactions */}
      <div style={cardStyle}>
        <h3 style={{ color: '#9ca3af', marginBottom: '16px' }}>Recent Transactions</h3>
        <div style={{ maxHeight: '300px', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #374151' }}>
                <th style={{ textAlign: 'left', padding: '6px', color: '#6b7280' }}>ID</th>
                <th style={{ textAlign: 'left', padding: '6px', color: '#6b7280' }}>Type</th>
                <th style={{ textAlign: 'right', padding: '6px', color: '#6b7280' }}>Amount</th>
                <th style={{ textAlign: 'right', padding: '6px', color: '#6b7280' }}>Balance After</th>
                <th style={{ textAlign: 'left', padding: '6px', color: '#6b7280' }}>Description</th>
                <th style={{ textAlign: 'left', padding: '6px', color: '#6b7280' }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1f2937' }}>
                  <td style={{ padding: '6px', color: '#9ca3af' }}>{tx.id}</td>
                  <td style={{ padding: '6px', color: '#e5e7eb' }}>{tx.type}</td>
                  <td style={{ padding: '6px', textAlign: 'right', color: tx.amount >= 0 ? '#10b981' : '#ef4444' }}>
                    {tx.amount >= 0 ? '+' : ''}{Number(tx.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                  </td>
                  <td style={{ padding: '6px', textAlign: 'right', color: '#9ca3af' }}>
                    ${Number(tx.balanceAfter || tx.balance_after || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: '6px', color: '#6b7280', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {tx.description}
                  </td>
                  <td style={{ padding: '6px', color: '#6b7280' }}>
                    {tx.createdAt ? new Date(tx.createdAt).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
              {transactions.length === 0 && (
                <tr><td colSpan="6" style={{ padding: '16px', textAlign: 'center', color: '#4b5563' }}>No transactions</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* VULN: Portfolio Lookup - IDOR demonstration */}
      <div style={{ ...cardStyle, border: '1px solid #7f1d1d' }}>
        <h3 style={{ color: '#ef4444', marginBottom: '12px' }}>🔍 View Another User's Portfolio (IDOR)</h3>
        <p style={{ color: '#6b7280', fontSize: '12px', marginBottom: '12px' }}>
          Try user IDs: 1 (admin), 2 (trader1), 3 (trader2 - has Flag 6 in notes)
        </p>
        <form onSubmit={handleLookupPortfolio} style={{ display: 'flex', gap: '8px' }}>
          <input
            type="number"
            value={lookupUserId}
            onChange={(e) => setLookupUserId(e.target.value)}
            placeholder="User ID"
            min="1"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button type="submit" style={{
            padding: '10px 20px', backgroundColor: '#ef4444',
            border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer'
          }}>
            View Portfolio
          </button>
        </form>
      </div>
    </div>
  );
}

export default PortfolioPage;
