import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/apiService';
import { subscribe, isConnected } from '../services/websocketService';
import { toast } from 'react-toastify';

import PageLayout from '../components/PageLayout';
import Card from '../components/Card';
import Button from '../components/Button';
import { Input } from '../components/FormField';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable';
import { colors, gridCols, flexRow, debugBanner } from '../styles/shared';
import { fmtPrice, fmtUSD, fmtBalance, fmtPnL, fmtPct, fmtNum, fmtDate, pnlColor } from '../utils/format';

/**
 * PHASE 6 VULNS:
 * - VULN: userId passed in API call (changeable via DevTools) -> IDOR
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
  const pricesRef = useRef({});
  const pricesDirtyRef = useRef(false);

  useEffect(() => {
    // Fetch current prices for P&L calculation
    api.get('/api/market/prices')
      .then(res => {
        const priceMap = {};
        res.data.forEach(p => { priceMap[p.symbol] = p.currentPrice; });
        pricesRef.current = priceMap;
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

  // Live price updates via WebSocket — only writes to ref, dirty flag throttles React updates
  useEffect(() => {
    const setupPriceSub = () => {
      if (!isConnected()) return false;
      subscribe('/topic/prices', (update) => {
        if (update.symbol && update.last) {
          pricesRef.current[update.symbol] = Number(update.last);
          pricesDirtyRef.current = true;
        }
      });
      return true;
    };
    if (!setupPriceSub()) {
      const iv = setInterval(() => { if (setupPriceSub()) clearInterval(iv); }, 500);
      return () => clearInterval(iv);
    }
  }, []);

  // Flush price ref to state at most every 100 ms
  useEffect(() => {
    const iv = setInterval(() => {
      if (pricesDirtyRef.current) {
        pricesDirtyRef.current = false;
        setCurrentPrices({ ...pricesRef.current });
      }
    }, 100);
    return () => clearInterval(iv);
  }, []);

  const handleLookupPortfolio = (e) => {
    e.preventDefault();
    if (lookupUserId) {
      fetchPortfolio(lookupUserId);
      fetchTransactions(lookupUserId);
      toast.info(`Loading portfolio for user #${lookupUserId}`);
    }
  };

  /* -- Column definitions for the holdings table -- */
  const holdingColumns = [
    { key: 'symbol', label: 'Symbol', render: (pos) => <span style={{ fontWeight: '700', color: colors.textPrimary, fontSize: '14px' }}>{pos.symbol}</span> },
    { key: 'quantity', label: 'Quantity', align: 'right', render: (pos) => <span style={{ fontWeight: '500' }}>{fmtNum(pos.quantity)}</span> },
    {
      key: 'avgPrice', label: 'Avg Price', align: 'right',
      render: (pos) => <span style={{ color: colors.textSecondary }}>{fmtPrice(pos.avgPrice || pos.avg_price)}</span>,
    },
    {
      key: 'currentPrice', label: 'Current', align: 'right',
      render: (pos) => <span style={{ color: colors.textPrimary, fontWeight: '500' }}>{fmtPrice(currentPrices[pos.symbol])}</span>,
    },
    {
      key: 'marketValue', label: 'Mkt Value', align: 'right',
      render: (pos) => {
        const cur = currentPrices[pos.symbol] || 0;
        return <span style={{ fontWeight: '500' }}>{fmtUSD(cur * (pos.quantity || 0))}</span>;
      },
    },
    {
      key: 'pnl', label: 'P&L', align: 'right',
      render: (pos) => {
        const cur = currentPrices[pos.symbol] || 0;
        const avg = pos.avgPrice || pos.avg_price || 0;
        const pnl = (cur - avg) * (pos.quantity || 0);
        return <span style={{ color: pnlColor(pnl), fontWeight: '600' }}>{fmtPnL(pnl)}</span>;
      },
    },
    {
      key: 'pnlPct', label: 'P&L %', align: 'right',
      render: (pos) => {
        const cur = currentPrices[pos.symbol] || 0;
        const avg = pos.avgPrice || pos.avg_price || 0;
        const pct = avg > 0 ? ((cur - avg) / avg * 100) : 0;
        return <span style={{
          color: pnlColor(pct),
          fontWeight: '600',
          padding: '2px 8px', borderRadius: '6px', fontSize: '12px',
          backgroundColor: pct >= 0 ? 'rgba(0,214,143,0.1)' : 'rgba(255,61,113,0.1)',
        }}>{fmtPct(pct)}</span>;
      },
    },
  ];

  /* -- Column definitions for the transactions table -- */
  const txColumns = [
    { key: 'id', label: 'ID', render: (tx) => <span style={{ color: colors.textMuted, fontFamily: "'SF Mono', monospace", fontSize: '12px' }}>{tx.id}</span> },
    { key: 'type', label: 'Type', render: (tx) => (
      <span style={{
        padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '600',
        backgroundColor: colors.blueDark, color: colors.blueLight,
      }}>{tx.type}</span>
    )},
    {
      key: 'amount', label: 'Amount', align: 'right',
      render: (tx) => <span style={{ color: pnlColor(tx.amount), fontWeight: '600' }}>{fmtPnL(tx.amount)}</span>,
    },
    {
      key: 'balanceAfter', label: 'Balance After', align: 'right',
      render: (tx) => <span style={{ color: colors.textSecondary }}>{fmtBalance(tx.balanceAfter || tx.balance_after)}</span>,
    },
    {
      key: 'description', label: 'Description',
      cellStyle: { color: colors.textMuted, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '13px' },
    },
    {
      key: 'createdAt', label: 'Date',
      render: (tx) => <span style={{ color: colors.textMuted, fontSize: '12px' }}>{fmtDate(tx.createdAt)}</span>,
    },
  ];

  return (
    <PageLayout title="Portfolio">

      {/* Account Summary */}
      <Card title="Account Summary">
        <div style={gridCols('1fr 1fr 1fr')}>
          <StatCard
            label="Cash Balance"
            value={portfolio?.balance ? fmtBalance(portfolio.balance) : '\u2014'}
            valueColor={colors.green}
            valueSize="22px"
          />
          <StatCard
            label="Unrealized P&L"
            value={fmtPnL(totalPnL)}
            valueColor={pnlColor(totalPnL)}
            valueSize="22px"
          />
          <StatCard label="Positions" value={positions.length} valueSize="22px" valueColor={colors.blue} />
        </div>
        {/* VULN: Notes field exposed - may contain flags */}
        {portfolio?.notes && (
          <div style={{ ...debugBanner, marginTop: '16px', marginBottom: 0 }}>
            Notes: {portfolio.notes}
          </div>
        )}
      </Card>

      {/* Holdings Table - VULN: userId in API call */}
      <Card title="Holdings">
        <DataTable
          columns={holdingColumns}
          data={positions}
          emptyText="No positions — start trading to build your portfolio"
          headerBorder="heavy"
        />
      </Card>

      {/* Recent Transactions */}
      <Card title="Recent Transactions">
        <DataTable
          columns={txColumns}
          data={transactions}
          small
          maxHeight="300px"
          emptyText="No transactions yet"
          headerBorder="medium"
        />
      </Card>

      {/* VULN: Portfolio Lookup - IDOR demonstration */}
      <Card variant="danger" title="View Another User's Portfolio (IDOR)" titleColor={colors.red}
        hint="Try user IDs: 1 (admin), 2 (trader1), 3 (trader2 - has Flag 6 in notes)">
        <form onSubmit={handleLookupPortfolio} style={{ display: 'flex', gap: '10px' }}>
          <Input type="number" value={lookupUserId} onChange={(e) => setLookupUserId(e.target.value)}
            placeholder="Enter User ID" min="1" style={{ flex: 1 }} />
          <Button type="submit" variant="red">View Portfolio</Button>
        </form>
      </Card>
    </PageLayout>
  );
}

export default PortfolioPage;
