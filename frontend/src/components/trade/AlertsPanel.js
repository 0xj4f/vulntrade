import React, { useState } from 'react';
import { toast } from 'react-toastify';
import { BellRing, ChevronDown } from 'lucide-react';
import { sendMessage } from '../../services/websocketService';
import { useMarketData } from '../../context/MarketDataContext';
import { useStomp } from '../../hooks/useStomp';
import Button from '../Button';
import { Chip } from '../ui';
import { colors, inputStyle, labelStyle, selectStyle, type } from '../../styles/shared';
import { fmtPrice } from '../../utils/format';

/**
 * Price alerts: set a target, get notified when the price crosses it.
 *
 * VULN (kept, #54 / FE-04): the alert symbol is stored unsanitised and rendered here as raw
 * HTML when it is echoed back (ALERT_CREATED) or triggered (PRICE_ALERT).
 */
export default function AlertsPanel({ defaultSymbol, onAction }) {
  const [open, setOpen] = useState(true);
  const [form, setForm] = useState({ symbol: '', targetPrice: '', direction: 'ABOVE' });
  const [feed, setFeed] = useState([]);
  const [err, setErr] = useState(null);
  const { lastFor } = useMarketData();

  useStomp('/user/queue/alerts', (a) => {
    if (!a) return;
    setFeed(prev => [{ ...a, at: Date.now() }, ...prev].slice(0, 12));
    if (a.type === 'ALERT_CREATED') toast.success('Price alert set');
    else if (a.type === 'PRICE_ALERT') toast.warn('Price alert triggered');
  });

  const submit = () => {
    if (!form.symbol.trim()) { setErr('Enter a symbol'); return; }
    // An empty target means "the current price" (0 when the symbol isn't a listed market).
    const target = form.targetPrice === '' ? (lastFor(form.symbol.trim().toUpperCase()) || 0) : Number(form.targetPrice);
    if (!Number.isFinite(target) || target < 0) { setErr('Enter a valid target price'); return; }
    setErr(null);
    onAction && onAction('alert');
    if (!sendMessage('/app/trade.setAlert', { symbol: form.symbol, targetPrice: target, direction: form.direction })) {
      toast.error('Not connected — try again in a moment');
    }
  };

  return (
    <section style={{ background: colors.bgCard, border: `1px solid ${colors.borderDefault}`, borderRadius: 'var(--vt-radius)', overflow: 'hidden' }}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'transparent', border: 'none', color: colors.textPrimary }}>
        <span style={{ ...type.section, fontSize: '14px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <BellRing size={15} aria-hidden="true" style={{ color: colors.amber }} />Price Alerts
        </span>
        <ChevronDown size={16} aria-hidden="true" style={{ color: colors.textMuted, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>
      {open && (
        <div style={{ padding: '0 12px 12px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div>
              <label htmlFor="alert-symbol" style={labelStyle}>Symbol</label>
              <input id="alert-symbol" value={form.symbol} onChange={e => setForm({ ...form, symbol: e.target.value })}
                placeholder="AAPL" style={{ ...inputStyle, width: '100%' }} />
            </div>
            <div>
              <label htmlFor="alert-target" style={labelStyle}>Target</label>
              <input id="alert-target" type="number" step="any" inputMode="decimal" value={form.targetPrice}
                onChange={e => setForm({ ...form, targetPrice: e.target.value })}
                placeholder="Current price" style={{ ...inputStyle, width: '100%' }} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', marginTop: '8px', alignItems: 'end' }}>
            <div>
              <label htmlFor="alert-direction" style={labelStyle}>When price is</label>
              <select id="alert-direction" value={form.direction} onChange={e => setForm({ ...form, direction: e.target.value })}
                style={{ ...selectStyle, width: '100%' }}>
                <option value="ABOVE">ABOVE</option>
                <option value="BELOW">BELOW</option>
              </select>
            </div>
            <Button variant="blue" onClick={submit}>Set Alert</Button>
          </div>
          {err && <div role="alert" style={{ color: colors.redLight, fontSize: '12px', marginTop: '6px' }}>{err}</div>}

          {feed.length > 0 && (
            <div style={{ marginTop: '12px', borderTop: `1px solid ${colors.borderDefault}` }}>
              {feed.map((a, i) => (
                <div key={`${a.at}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: '8px 0', borderBottom: `1px solid ${colors.borderDefault}`, fontSize: '12.5px', color: colors.textSecondary }}>
                  <Chip tone={a.type === 'PRICE_ALERT' ? 'warn' : 'accent'}>{a.type === 'PRICE_ALERT' ? 'TRIGGERED' : 'SET'}</Chip>
                  {/* VULN: stored XSS — alert symbol rendered as raw HTML (img-onerror fires here) */}
                  <span style={{ fontWeight: 600, color: colors.textPrimary }} dangerouslySetInnerHTML={{ __html: a.symbol || '' }} />
                  {a.targetPrice != null && (
                    <span style={{ color: colors.textMuted }}>{a.direction === 'BELOW' ? '≤' : '≥'} {fmtPrice(a.targetPrice)}</span>
                  )}
                  {a.currentPrice != null && <span style={{ color: colors.textMuted }}>· now {fmtPrice(a.currentPrice)}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
