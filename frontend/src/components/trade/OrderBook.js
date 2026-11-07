import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import api from '../../services/apiService';
import { useStomp } from '../../hooks/useStomp';
import { colors, num, type } from '../../styles/shared';
import { fmtPrice, fmtQty } from '../../utils/format';

const DEPTH = 8;

/**
 * Order book for one symbol: asks above, bids below, spread in between, depth bars from
 * cumulative size. Click a price to use it in the ticket.
 *
 * VULN (kept, #60/#72): every row shows the order id and owner and has a Cancel button —
 * including other people's orders (the backend doesn't check ownership).
 */
export default function OrderBook({ symbol, userId, onCancel, onPickPrice }) {
  const [book, setBook] = useState({ bids: [], asks: [] });
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    api.get(`/api/market/orderbook/${encodeURIComponent(symbol)}`)
      .then(res => setBook({ bids: res.data.bids || [], asks: res.data.asks || [] }))
      .catch(err => console.error('Failed to fetch orderbook:', err))
      .finally(() => setLoading(false));
  }, [symbol]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useStomp(`/topic/orderbook/${symbol}`, (msg) => {
    if (msg && msg.symbol === symbol) setBook({ bids: msg.bids || [], asks: msg.asks || [] });
  });

  const { asks, bids, maxCum, spread, mid } = useMemo(() => {
    const a = (book.asks || []).slice(0, DEPTH);
    const b = (book.bids || []).slice(0, DEPTH);
    let c = 0;
    const aCum = a.map(r => ({ ...r, cum: (c += Number(r.quantity) || 0) }));
    c = 0;
    const bCum = b.map(r => ({ ...r, cum: (c += Number(r.quantity) || 0) }));
    const max = Math.max(aCum.length ? aCum[aCum.length - 1].cum : 0, bCum.length ? bCum[bCum.length - 1].cum : 0, 1);
    const bestAsk = a.length ? Number(a[0].price) : null;
    const bestBid = b.length ? Number(b[0].price) : null;
    return {
      asks: aCum.reverse(), bids: bCum, maxCum: max,
      spread: bestAsk != null && bestBid != null ? bestAsk - bestBid : null,
      mid: bestAsk != null && bestBid != null ? (bestAsk + bestBid) / 2 : null,
    };
  }, [book]);

  const row = (r, sideColor, soft) => {
    const mine = userId != null && Number(r.userId) === Number(userId);
    return (
      <div key={r.orderId} className="vt-row" style={{
        position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 22px', alignItems: 'center', gap: '6px',
        height: '26px', padding: '0 8px', fontSize: '12px',
      }}>
        <span aria-hidden="true" style={{ position: 'absolute', top: 2, bottom: 2, right: 0, width: `${(r.cum / maxCum) * 100}%`, background: soft, borderRadius: '3px' }} />
        <button type="button" onClick={() => onPickPrice && onPickPrice(Number(r.price))} title="Use this price"
          style={{ ...num, position: 'relative', textAlign: 'left', background: 'transparent', border: 'none', color: sideColor, fontWeight: 600, padding: 0 }}>
          {mine && <span aria-label="Your order" style={{ display: 'inline-block', width: '5px', height: '5px', borderRadius: '50%', background: 'var(--vt-accent)', marginRight: '5px', verticalAlign: 'middle' }} />}
          {fmtPrice(r.price).replace('$', '')}
        </button>
        <span style={{ ...num, position: 'relative', textAlign: 'right', color: colors.textPrimary }}>{fmtQty(r.quantity)}</span>
        <span title={`Order #${r.orderId} · user #${r.userId}`} style={{ position: 'relative', textAlign: 'right', color: mine ? colors.blueLight : colors.textMuted, fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {r.username || `User#${r.userId}`}
        </span>
        <button type="button" onClick={() => onCancel(r.orderId)} aria-label={`Cancel order #${r.orderId}`} title={`Cancel #${r.orderId}`}
          className="vt-btn vt-ghost"
          style={{ position: 'relative', width: '20px', height: '20px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: '4px', background: 'transparent', color: colors.textDim }}>
          <X size={12} aria-hidden="true" />
        </button>
      </div>
    );
  };

  return (
    <section aria-label={`${symbol} order book`} style={{ background: colors.bgCard, border: `1px solid ${colors.borderDefault}`, borderRadius: 'var(--vt-radius)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 12px 8px' }}>
        <h2 style={{ ...type.section, fontSize: '14px' }}>Order book <span style={{ color: colors.textMuted, fontWeight: 500 }}>· {symbol}</span></h2>
        <span style={{ ...type.meta }}>{(book.asks || []).length + (book.bids || []).length} orders</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 22px', gap: '6px', padding: '4px 8px', ...type.caps, fontSize: '10px' }}>
        <span>Price</span><span style={{ textAlign: 'right' }}>Size</span><span style={{ textAlign: 'right' }}>Trader</span><span />
      </div>
      {loading ? (
        <div style={{ padding: '12px' }}>{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton" style={{ height: '18px', marginBottom: '6px' }} />)}</div>
      ) : (
        <>
          <div aria-label="Asks">{asks.length ? asks.map(r => row(r, colors.red, 'var(--vt-down-soft)')) : <div style={{ padding: '10px', textAlign: 'center', color: colors.textMuted, fontSize: '12px' }}>No asks</div>}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', margin: '2px 0', background: colors.bgStat, borderTop: `1px solid ${colors.borderDefault}`, borderBottom: `1px solid ${colors.borderDefault}`, fontSize: '12px' }}>
            <span style={{ ...num, fontWeight: 700, color: colors.textPrimary }}>{mid != null ? fmtPrice(mid) : '—'}</span>
            <span style={{ color: colors.textMuted }}>Spread <span style={num}>{spread != null ? fmtPrice(spread).replace('$', '') : '—'}</span></span>
          </div>
          <div aria-label="Bids">{bids.length ? bids.map(r => row(r, colors.green, 'var(--vt-up-soft)')) : <div style={{ padding: '10px', textAlign: 'center', color: colors.textMuted, fontSize: '12px' }}>No bids</div>}</div>
        </>
      )}
    </section>
  );
}
