import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { createChart, ColorType, CrosshairMode } from 'lightweight-charts';
import api from '../services/apiService';
import { subscribe, isConnected } from '../services/websocketService';
import PageLayout from '../components/PageLayout';
import Card from '../components/Card';
import StatCard from '../components/StatCard';
import Button from '../components/Button';
import { colors } from '../styles/shared';

/**
 * Symbol Detail Page — candlestick chart + live price header.
 * Generates fake OHLC candles from accumulated WS price ticks.
 * No backend changes needed.
 */
function SymbolDetailPage() {
  const { symbol } = useParams();
  const navigate = useNavigate();
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);

  const [currentPrice, setCurrentPrice] = useState(null);
  const [priceData, setPriceData] = useState(null); // { bid, ask, volume, ... }
  const [candles, setCandles] = useState([]);
  const [interval, setInterval_] = useState('1m');
  const priceHistoryRef = useRef([]); // raw ticks

  // ── Fetch initial price ──────────────────────────────
  useEffect(() => {
    api.get('/api/market/prices')
      .then(res => {
        const found = res.data.find(p => p.symbol === symbol);
        if (found) {
          setCurrentPrice(Number(found.currentPrice));
          setPriceData(found);
          // Seed 60 fake historical candles from current price
          seedCandles(Number(found.currentPrice));
        }
      })
      .catch(err => console.error('Failed to fetch prices:', err));
  }, [symbol]);

  // ── Generate seed candles (fake history) ─────────────
  const seedCandles = useCallback((basePrice) => {
    const now = Math.floor(Date.now() / 1000);
    const intervalSec = 60; // 1-minute candles
    const count = 80;
    const seeded = [];
    let price = basePrice * (0.95 + Math.random() * 0.05); // start slightly lower

    for (let i = count; i >= 0; i--) {
      const time = now - i * intervalSec;
      const open = price;
      const change = (Math.random() - 0.48) * basePrice * 0.008;
      const close = open + change;
      const high = Math.max(open, close) + Math.random() * basePrice * 0.003;
      const low = Math.min(open, close) - Math.random() * basePrice * 0.003;
      seeded.push({
        time,
        open: parseFloat(open.toFixed(2)),
        high: parseFloat(high.toFixed(2)),
        low: parseFloat(low.toFixed(2)),
        close: parseFloat(close.toFixed(2)),
      });
      price = close;
    }
    setCandles(seeded);
  }, []);

  // ── Subscribe to WS price updates ───────────────────
  useEffect(() => {
    const trySubscribe = () => {
      if (!isConnected()) return false;
      subscribe('/topic/prices', (update) => {
        if (update.symbol === symbol) {
          const last = Number(update.last || update.bid || 0);
          if (last > 0) {
            setCurrentPrice(last);
            setPriceData(prev => ({ ...prev, ...update, currentPrice: last }));
            priceHistoryRef.current.push({ time: Date.now(), price: last });

            // Append to candles — update last candle or create new one
            setCandles(prev => {
              if (prev.length === 0) return prev;
              const lastCandle = { ...prev[prev.length - 1] };
              const now = Math.floor(Date.now() / 1000);
              const candleTime = lastCandle.time;

              if (now - candleTime < 60) {
                // Update current candle
                lastCandle.close = parseFloat(last.toFixed(2));
                lastCandle.high = parseFloat(Math.max(lastCandle.high, last).toFixed(2));
                lastCandle.low = parseFloat(Math.min(lastCandle.low, last).toFixed(2));
                return [...prev.slice(0, -1), lastCandle];
              } else {
                // New candle
                const newCandle = {
                  time: now,
                  open: lastCandle.close,
                  high: parseFloat(Math.max(lastCandle.close, last).toFixed(2)),
                  low: parseFloat(Math.min(lastCandle.close, last).toFixed(2)),
                  close: parseFloat(last.toFixed(2)),
                };
                return [...prev, newCandle];
              }
            });
          }
        }
      });
      return true;
    };

    if (!trySubscribe()) {
      const iv = window.setInterval(() => {
        if (trySubscribe()) window.clearInterval(iv);
      }, 500);
      return () => window.clearInterval(iv);
    }
  }, [symbol]);

  // ── Create / update chart ───────────────────────────
  useEffect(() => {
    if (!chartContainerRef.current || candles.length === 0) return;

    // Create chart if not exists
    if (!chartRef.current) {
      const chart = createChart(chartContainerRef.current, {
        width: chartContainerRef.current.clientWidth,
        height: 420,
        layout: {
          background: { type: ColorType.Solid, color: '#0D1829' },
          textColor: '#5E6B82',
          fontFamily: "'Inter', sans-serif",
        },
        grid: {
          vertLines: { color: '#1E2D4520' },
          horzLines: { color: '#1E2D4520' },
        },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: {
          borderColor: '#1E2D45',
          scaleMargins: { top: 0.1, bottom: 0.1 },
        },
        timeScale: {
          borderColor: '#1E2D45',
          timeVisible: true,
          secondsVisible: false,
        },
      });

      const candleSeries = chart.addCandlestickSeries({
        upColor: '#00D68F',
        downColor: '#FF3D71',
        borderDownColor: '#FF3D71',
        borderUpColor: '#00D68F',
        wickDownColor: '#FF3D71',
        wickUpColor: '#00D68F',
      });

      chartRef.current = chart;
      candleSeriesRef.current = candleSeries;

      // Resize handler
      const handleResize = () => {
        if (chartContainerRef.current) {
          chart.applyOptions({ width: chartContainerRef.current.clientWidth });
        }
      };
      window.addEventListener('resize', handleResize);

      candleSeries.setData(candles);
      chart.timeScale().fitContent();

      return () => {
        window.removeEventListener('resize', handleResize);
      };
    } else {
      // Update existing chart data
      candleSeriesRef.current.setData(candles);
    }
  }, [candles]);

  // ── Cleanup chart on unmount ────────────────────────
  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        candleSeriesRef.current = null;
      }
    };
  }, []);

  const firstCandle = candles.length > 0 ? candles[0] : null;
  const changeAmt = currentPrice && firstCandle ? currentPrice - firstCandle.open : 0;
  const changePct = firstCandle && firstCandle.open > 0
    ? ((currentPrice - firstCandle.open) / firstCandle.open * 100)
    : 0;

  return (
    <PageLayout title="" maxWidth="1200px">
      {/* Back + Symbol Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
        <button onClick={() => navigate('/dashboard')} style={{
          background: colors.bgCard, border: `1px solid ${colors.borderDefault}`,
          color: colors.textSecondary, padding: '8px 14px', borderRadius: '10px',
          cursor: 'pointer', fontSize: '14px',
        }}>
          ← Back
        </button>
        <div>
          <h1 style={{ color: colors.textPrimary, fontSize: '28px', fontWeight: '700', letterSpacing: '-0.02em', margin: 0 }}>
            {symbol}
          </h1>
          {priceData?.name && (
            <span style={{ color: colors.textMuted, fontSize: '14px' }}>{priceData.name}</span>
          )}
        </div>
      </div>

      {/* Price Header */}
      <Card style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '16px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '36px', fontWeight: '700', color: colors.textPrimary, letterSpacing: '-0.02em' }}>
            ${currentPrice ? currentPrice.toFixed(2) : '—'}
          </span>
          {currentPrice && firstCandle && (
            <span style={{
              fontSize: '16px', fontWeight: '600',
              color: changeAmt >= 0 ? colors.green : colors.red,
              display: 'flex', alignItems: 'center', gap: '4px',
            }}>
              <span style={{
                padding: '3px 10px', borderRadius: '8px', fontSize: '14px',
                backgroundColor: changeAmt >= 0 ? 'rgba(0,214,143,0.12)' : 'rgba(255,61,113,0.12)',
              }}>
                {changeAmt >= 0 ? '▲' : '▼'} {Math.abs(changePct).toFixed(2)}%
              </span>
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '24px', marginTop: '12px' }}>
          {[
            { label: 'Bid', value: priceData?.bid, color: colors.green },
            { label: 'Ask', value: priceData?.ask, color: colors.red },
            { label: 'Volume', value: priceData?.volume, color: colors.textSecondary, fmt: 'int' },
          ].map(({ label, value, color, fmt }) => (
            <div key={label} style={{ fontSize: '13px' }}>
              <span style={{ color: colors.textMuted, marginRight: '6px' }}>{label}</span>
              <span style={{ color, fontWeight: '600' }}>
                {value ? (fmt === 'int' ? Number(value).toLocaleString() : `$${Number(value).toFixed(2)}`) : '—'}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* Time Range Selector */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
        {['1m', '5m', '15m', '1h', '1D'].map(iv => (
          <button key={iv} onClick={() => setInterval_(iv)} style={{
            padding: '6px 14px', borderRadius: '8px', border: 'none', cursor: 'pointer',
            fontSize: '12px', fontWeight: '600', transition: 'all 0.15s ease',
            backgroundColor: interval === iv ? colors.blue : colors.bgCard,
            color: interval === iv ? '#fff' : colors.textMuted,
          }}>
            {iv}
          </button>
        ))}
      </div>

      {/* Candlestick Chart */}
      <Card style={{ padding: '0', overflow: 'hidden', marginBottom: '20px' }}>
        <div ref={chartContainerRef} style={{ width: '100%', minHeight: '420px' }} />
      </Card>

      {/* Quick Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard label="Open" value={firstCandle ? `$${firstCandle.open.toFixed(2)}` : '—'} valueSize="18px" />
        <StatCard label="High" value={candles.length > 0 ? `$${Math.max(...candles.map(c => c.high)).toFixed(2)}` : '—'} valueSize="18px" valueColor={colors.green} />
        <StatCard label="Low" value={candles.length > 0 ? `$${Math.min(...candles.map(c => c.low)).toFixed(2)}` : '—'} valueSize="18px" valueColor={colors.red} />
        <StatCard label="Change" valueSize="18px"
          value={changeAmt !== 0 ? `${changeAmt >= 0 ? '+' : ''}$${changeAmt.toFixed(2)}` : '—'}
          valueColor={changeAmt >= 0 ? colors.green : colors.red} />
      </div>

      {/* Buy / Sell Actions */}
      <div style={{ display: 'flex', gap: '12px' }}>
        <Button variant="green" size="large" style={{ flex: 1, fontSize: '16px' }}
          onClick={() => navigate('/dashboard')}>
          Buy {symbol}
        </Button>
        <Button variant="red" size="large" style={{ flex: 1, fontSize: '16px' }}
          onClick={() => navigate('/dashboard')}>
          Sell {symbol}
        </Button>
      </div>
    </PageLayout>
  );
}

export default SymbolDetailPage;
