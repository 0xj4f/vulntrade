import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, PauseCircle } from 'lucide-react';
import { useMarketData } from '../context/MarketDataContext';
import CandleChart, { INTERVALS } from '../components/trade/CandleChart';
import Button from '../components/Button';
import StatCard from '../components/StatCard';
import SparkLine from '../components/SparkLine';
import { ChangeChip, Chip, EmptyState, PriceText } from '../components/ui';
import { colors, num, type } from '../styles/shared';
import { fmtCompact, fmtPct, fmtPrice } from '../utils/format';

function SymbolDetailPage() {
  const { symbol } = useParams();
  const navigate = useNavigate();
  const { quotes, loaded, history, halted, list } = useMarketData();
  const [interval, setIntervalValue] = useState('1m');
  const [bar, setBar] = useState(null);
  const q = quotes[symbol];

  if (loaded && !q) {
    return (
      <main className="vt-page">
        <EmptyState title={`No market called “${symbol}”`} action={<Button variant="gray" onClick={() => navigate('/dashboard')}>Back to markets</Button>}>
          Pick one of the listed symbols instead.
        </EmptyState>
      </main>
    );
  }

  const spread = q && q.ask != null && q.bid != null ? Number(q.ask) - Number(q.bid) : null;
  const range = bar ? Number(bar.high) - Number(bar.low) : null;
  const others = list.filter(x => x.symbol !== symbol).slice(0, 6);

  return (
    <main className="vt-page fade-in" style={{ '--vt-page-max': '1360px' }}>
      <Link to="/dashboard" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: colors.textSecondary, marginBottom: '12px' }}>
        <ArrowLeft size={14} aria-hidden="true" />Markets
      </Link>

      {/* Hero */}
      <section style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px', marginBottom: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
            <h1 style={{ ...type.title, fontSize: '24px' }}>{symbol}</h1>
            <span style={{ color: colors.textMuted, fontSize: '14px' }}>{q?.name}</span>
            {halted[symbol] && <Chip tone="warn"><PauseCircle size={12} aria-hidden="true" />Trading halted</Chip>}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
            {q ? <PriceText value={q.currentPrice} dir={q.dir} tick={q.tick} style={{ ...type.display, fontSize: '36px' }} />
              : <div className="skeleton" style={{ width: '200px', height: '40px' }} />}
            <ChangeChip value={q?.changePct} solid />
            <span style={{ color: colors.textMuted, fontSize: '12px' }}>since session open</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button variant="green" style={{ minWidth: '120px', height: '40px' }} onClick={() => navigate(`/dashboard?symbol=${encodeURIComponent(symbol)}&side=BUY`)}>Buy {symbol}</Button>
          <Button variant="red" style={{ minWidth: '120px', height: '40px' }} onClick={() => navigate(`/dashboard?symbol=${encodeURIComponent(symbol)}&side=SELL`)}>Sell {symbol}</Button>
        </div>
      </section>

      {/* Key stats */}
      <div className="vt-stats" style={{ marginBottom: '16px' }}>
        <StatCard label="Bid" value={q?.bid != null ? fmtPrice(q.bid) : '—'} valueColor={colors.green} valueSize="18px" />
        <StatCard label="Ask" value={q?.ask != null ? fmtPrice(q.ask) : '—'} valueColor={colors.red} valueSize="18px" />
        <StatCard label="Spread" value={spread != null ? fmtPrice(spread) : '—'} valueSize="18px"
          sub={spread != null && q?.currentPrice ? `${fmtPct((spread / Number(q.currentPrice)) * 100, 3).replace('+', '')} of price` : null} />
        <StatCard label="Session open" value={q?.open != null ? fmtPrice(q.open) : '—'} valueSize="18px" />
        <StatCard label="Volume" value={fmtCompact(q?.volume)} valueSize="18px" />
      </div>

      {/* Chart */}
      <section style={{ background: colors.bgCard, border: `1px solid ${colors.borderDefault}`, borderRadius: 'var(--vt-radius)', overflow: 'hidden', marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '10px 12px', borderBottom: `1px solid ${colors.borderDefault}` }}>
          <div role="group" aria-label="Chart interval" style={{ display: 'flex', gap: '2px', padding: '2px', borderRadius: '8px', background: colors.bgInput, border: `1px solid ${colors.borderDefault}` }}>
            {INTERVALS.map(i => (
              <button key={i.value} type="button" aria-pressed={interval === i.value} onClick={() => setIntervalValue(i.value)} className="vt-btn"
                style={{ height: '28px', padding: '0 12px', borderRadius: '6px', border: 'none', fontSize: '12px', fontWeight: 600, background: interval === i.value ? colors.bgRaised : 'transparent', color: interval === i.value ? colors.textPrimary : colors.textMuted }}>
                {i.label}
              </button>
            ))}
          </div>
          {bar && (
            <div style={{ ...num, display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '12px', color: colors.textMuted }}>
              <span>Open <b style={{ color: colors.textPrimary, fontWeight: 500 }}>{fmtPrice(bar.open)}</b></span>
              <span>High <b style={{ color: colors.textPrimary, fontWeight: 500 }}>{fmtPrice(bar.high)}</b></span>
              <span>Low <b style={{ color: colors.textPrimary, fontWeight: 500 }}>{fmtPrice(bar.low)}</b></span>
              <span>Close <b style={{ color: bar.close >= bar.open ? colors.green : colors.red, fontWeight: 600 }}>{fmtPrice(bar.close)}</b></span>
              {range != null && <span>Range <b style={{ color: colors.textPrimary, fontWeight: 500 }}>{fmtPrice(range)}</b></span>}
            </div>
          )}
        </div>
        <div style={{ padding: '4px' }}>
          <CandleChart symbol={symbol} interval={interval} height={460} onBar={setBar} />
        </div>
      </section>

      {/* Other markets */}
      {others.length > 0 && (
        <section aria-label="Other markets">
          <h2 style={{ ...type.section, marginBottom: '10px' }}>Other markets</h2>
          <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
            {others.map(o => (
              <Link key={o.symbol} to={`/symbol/${encodeURIComponent(o.symbol)}`} className="vt-link-row vt-row"
                style={{ display: 'block', padding: '12px 14px', borderRadius: 'var(--vt-radius)', border: `1px solid ${colors.borderDefault}`, background: colors.bgCard }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontWeight: 600, color: colors.textPrimary }}>{o.symbol}</span>
                  <ChangeChip value={o.changePct} size="sm" />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                  <PriceText value={o.currentPrice} dir={o.dir} tick={o.tick} style={{ fontSize: '15px', fontWeight: 600, color: colors.textPrimary }} />
                  <SparkLine data={(history[o.symbol] || []).slice(-40)} width={72} height={24} />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

export default SymbolDetailPage;
