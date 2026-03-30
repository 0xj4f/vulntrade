import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/apiService';
import { toast } from 'react-toastify';

import PageLayout from '../components/PageLayout';
import Card from '../components/Card';
import Button from '../components/Button';
import { Input } from '../components/FormField';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable';
import { colors, gridCols, flexRow, debugBanner } from '../styles/shared';

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

  /* -- Column definitions for the holdings table -- */
  const holdingColumns = [
    { key: 'symbol', label: 'Symbol', render: (pos) => <span style={{ fontWeight: 'bold', color: colors.textPrimary }}>{pos.symbol}</span> },
    { key: 'quantity', label: 'Quantity', align: 'right', render: (pos) => Number(pos.quantity || 0).toLocaleString() },
    {
      key: 'avgPrice', label: 'Avg Price', align: 'right',
      render: (pos) => <span style={{ color: colors.textSecondary }}>${Number(pos.avgPrice || pos.avg_price || 0).toFixed(2)}</span>,
    },
    {
      key: 'currentPrice', label: 'Current Price', align: 'right',
      render: (pos) => `$${Number(currentPrices[pos.symbol] || 0).toFixed(2)}`,
    },
    {
      key: 'marketValue', label: 'Market Value', align: 'right',
      render: (pos) => {
        const cur = currentPrices[pos.symbol] || 0;
        return `$${(cur * (pos.quantity || 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      },
    },
    {
      key: 'pnl', label: 'P&L', align: 'right',
      render: (pos) => {
        const cur = currentPrices[pos.symbol] || 0;
        const avg = pos.avgPrice || pos.avg_price || 0;
        const pnl = (cur - avg) * (pos.quantity || 0);
        return <span style={{ color: pnl >= 0 ? colors.green : colors.red }}>
          {pnl >= 0 ? '+' : ''}{pnl.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
        </span>;
      },
    },
    {
      key: 'pnlPct', label: 'P&L %', align: 'right',
      render: (pos) => {
        const cur = currentPrices[pos.symbol] || 0;
        const avg = pos.avgPrice || pos.avg_price || 0;
        const pct = avg > 0 ? ((cur - avg) / avg * 100) : 0;
        return <span style={{ color: pct >= 0 ? colors.green : colors.red }}>
          {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
        </span>;
      },
    },
  ];

  /* -- Column definitions for the transactions table -- */
  const txColumns = [
    { key: 'id', label: 'ID' },
    { key: 'type', label: 'Type' },
    {
      key: 'amount', label: 'Amount', align: 'right',
      render: (tx) => <span style={{ color: tx.amount >= 0 ? colors.green : colors.red }}>
        {tx.amount >= 0 ? '+' : ''}{Number(tx.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
      </span>,
    },
    {
      key: 'balanceAfter', label: 'Balance After', align: 'right',
      render: (tx) => <span style={{ color: colors.textSecondary }}>
        ${Number(tx.balanceAfter || tx.balance_after || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
      </span>,
    },
    {
      key: 'description', label: 'Description',
      cellStyle: { color: colors.textMuted, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' },
    },
    {
      key: 'createdAt', label: 'Date',
      render: (tx) => <span style={{ color: colors.textMuted }}>{tx.createdAt ? new Date(tx.createdAt).toLocaleString() : '\u2014'}</span>,
    },
  ];

  return (
    <PageLayout title="Portfolio">

      {/* Account Summary */}
      <Card title="Account Summary">
        <div style={gridCols('1fr 1fr 1fr')}>
          <StatCard
            label="Cash Balance"
            value={portfolio?.balance ? `$${Number(portfolio.balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '\u2014'}
            valueColor={colors.green}
          />
          <StatCard
            label="Unrealized P&L"
            value={`${totalPnL >= 0 ? '+' : ''}${totalPnL.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`}
            valueColor={totalPnL >= 0 ? colors.green : colors.red}
          />
          <StatCard label="Positions" value={positions.length} />
        </div>
        {/* VULN: Notes field exposed - may contain flags */}
        {portfolio?.notes && (
          <div style={{ ...debugBanner, marginTop: '12px', marginBottom: 0 }}>
            Notes: {portfolio.notes}
          </div>
        )}
      </Card>

      {/* Holdings Table - VULN: userId in API call */}
      <Card title="Holdings">
        <DataTable
          columns={holdingColumns}
          data={positions}
          emptyText="No positions"
        />
      </Card>

      {/* Recent Transactions */}
      <Card title="Recent Transactions">
        <DataTable
          columns={txColumns}
          data={transactions}
          small
          maxHeight="300px"
          emptyText="No transactions"
        />
      </Card>

      {/* VULN: Portfolio Lookup - IDOR demonstration */}
      <Card variant="danger" title="&#128269; View Another User's Portfolio (IDOR)" titleColor={colors.red}
        hint="Try user IDs: 1 (admin), 2 (trader1), 3 (trader2 - has Flag 6 in notes)">
        <form onSubmit={handleLookupPortfolio} style={flexRow()}>
          <Input type="number" value={lookupUserId} onChange={(e) => setLookupUserId(e.target.value)}
            placeholder="User ID" min="1" style={{ flex: 1 }} />
          <Button type="submit" variant="red">View Portfolio</Button>
        </form>
      </Card>
    </PageLayout>
  );
}

export default PortfolioPage;
