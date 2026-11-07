import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, LineChart, PauseCircle } from 'lucide-react';
import { useMarketData } from '../../context/MarketDataContext';
import SparkLine from '../SparkLine';
import { ChangeChip, PriceText } from '../ui';
import { colors, num, inputStyle, type } from '../../styles/shared';
import { fmtPrice } from '../../utils/format';

/**
 * Markets list: last price (flashes on ticks), change vs session open, sparkline.
 * Clicking a row selects the symbol for the chart, ticket and book.
 *
 * VULN (kept, #67/#68): symbol and name are rendered as raw HTML.
 * VULN (kept, #69): internal feed fields are shown in debug mode.
 */
export default function Watchlist({ selected, onSelect, isDebug }) {
  const { list, history, halted } = useMarketData();
  const [query, setQuery] = useState('');
  const rows = useMemo(() => {
    const q = query.trim().toUpperCase();
    return q ? list.filter(r => r.symbol.toUpperCase().includes(q) || (r.name || '').toUpperCase().includes(q)) : list;
  }, [list, query]);

  return (
    <section style={{ background: colors.bgCard, border: `1px solid ${colors.borderDefault}`, borderRadius: 'var(--vt-radius)', overflow: 'hidden' }}>
      <div style={{ padding: '12px 12px 8px', borderBottom: `1px solid ${colors.borderDefault}` }}>
        <div style={{ ...type.section, fontSize: '14px', marginBottom: '8px' }}>Markets</div>
        <label style={{ position: 'relative', display: 'block' }}>
          <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: colors.textMuted, display: 'inline-flex' }}>
            <Search size={14} aria-hidden="true" />
          </span>
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search markets"
            aria-label="Search markets" style={{ ...inputStyle, width: '100%', height: '32px', paddingLeft: '30px' }} />
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', padding: '6px 12px', ...type.caps, fontSize: '10px' }}>
        <span>Symbol</span><span>Last · change</span>
      </div>
      <div style={{ maxHeight: '640px', overflowY: 'auto' }}>
        {rows.map(q => {
          const active = q.symbol === selected;
          return (
            <div
              key={q.symbol}
              role="button"
              tabIndex={0}
              aria-pressed={active}
              onClick={() => onSelect(q.symbol)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(q.symbol); } }}
              className="vt-row vt-row-click"
              style={{
                display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '8px', alignItems: 'center',
                padding: '9px 12px', borderBottom: `1px solid ${colors.borderDefault}`,
                background: active ? colors.bgRaised : undefined,
                boxShadow: active ? 'inset 2px 0 0 var(--vt-accent)' : 'none',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {/* VULN: dangerouslySetInnerHTML for symbol (XSS) */}
                  <span style={{ fontWeight: 600, fontSize: '13px', color: colors.textPrimary }} dangerouslySetInnerHTML={{ __html: q.symbol }} />
                  {halted[q.symbol] && <PauseCircle size={13} aria-label="Halted" style={{ color: colors.amber }} />}
                  <Link to={`/symbol/${encodeURIComponent(q.symbol)}`} onClick={e => e.stopPropagation()} aria-label={`Open ${q.symbol} chart`}
                    style={{ display: 'inline-flex', color: colors.textDim, marginLeft: 'auto' }}>
                    <LineChart size={13} aria-hidden="true" />
                  </Link>
                </div>
                {/* VULN: dangerouslySetInnerHTML for name (XSS) */}
                <div style={{ color: colors.textMuted, fontSize: '11.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  dangerouslySetInnerHTML={{ __html: q.name || '' }} />
                {isDebug && (q.marketMakerId || q.costBasis) && (
                  <div style={{ ...num, color: colors.amber, fontSize: '10px', marginTop: '2px' }}>
                    {q.marketMakerId && `MM:${q.marketMakerId}`}{q.costBasis && ` CB:${fmtPrice(q.costBasis)}`}{q.spreadBps && ` ${Number(q.spreadBps).toFixed(1)}bps`}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right', display: 'grid', justifyItems: 'end', gap: '2px' }}>
                <PriceText value={q.currentPrice} dir={q.dir} tick={q.tick} style={{ fontSize: '13px', fontWeight: 600, color: colors.textPrimary }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <SparkLine data={(history[q.symbol] || []).slice(-30)} width={44} height={14} fill={false} />
                  <ChangeChip value={q.changePct} size="sm" />
                </div>
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <div style={{ padding: '20px', textAlign: 'center', color: colors.textMuted, fontSize: '13px' }}>No markets match “{query}”</div>}
      </div>
    </section>
  );
}
