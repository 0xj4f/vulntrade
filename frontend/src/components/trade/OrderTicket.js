import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Info, PauseCircle } from 'lucide-react';
import { useMarketData } from '../../context/MarketDataContext';
import Button from '../Button';
import { KV } from '../ui';
import { colors, inputStyle, labelStyle, num, selectStyle, type } from '../../styles/shared';
import { fmtPrice, fmtQty, fmtUSD, priceInputValue } from '../../utils/format';

const HOUSE_SPREAD = 0.0001;   // house fills at ask + 0.01% / bid - 0.01%
export const MAX_ORDER_QTY = 10000;

/**
 * Order entry.
 *
 * The side buttons are named exactly "BUY" / "SELL"; the submit button is "<SIDE> <SYMBOL>";
 * symbol and type are the first two <select>s on the dashboard; price is input[step="0.01"]
 * and quantity input[max="10000"] (UI automation relies on these).
 *
 * VULN (kept, FE-06): the 10,000 size cap exists only here in the browser.
 * VULN (kept, FE-09): a hidden, editable user id travels with every order.
 * VULN (kept, #40/#45): MARKET orders carry the client's price.
 */
export default function OrderTicket({
  userId, symbol, onSymbolChange, side, onSideChange, balance, positions, busy, error, onDismissError,
  onSubmit, prefillPrice,
}) {
  const { quotes, symbols, halted, quoteFor } = useMarketData();
  const [orderType, setOrderType] = useState('LIMIT');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const [fieldError, setFieldError] = useState({});
  const lastPrefill = useRef(null);
  const q = quotes[symbol];
  const isHalted = !!halted[symbol];

  // Prefill the limit price with the live price when the symbol changes (or a book price is picked).
  useEffect(() => {
    if (orderType !== 'LIMIT') return;
    const mid = q ? Number(q.currentPrice) : null;
    if (mid && lastPrefill.current !== symbol) {
      setPrice(priceInputValue(mid));
      lastPrefill.current = symbol;
    }
  }, [symbol, q, orderType]);

  useEffect(() => {
    if (prefillPrice && prefillPrice.value != null) {
      setOrderType('LIMIT');
      setPrice(priceInputValue(prefillPrice.value));
      lastPrefill.current = symbol;
    }
  }, [prefillPrice, symbol]);

  // MARKET: the (read-only) price follows the executable side of the live quote.
  const marketPx = q ? (side === 'BUY' ? q.ask ?? q.currentPrice : q.bid ?? q.currentPrice) : null;
  useEffect(() => {
    if (orderType === 'MARKET' && marketPx != null) setPrice(priceInputValue(marketPx));
  }, [orderType, marketPx, side, symbol]);

  const qty = Number(quantity);
  const px = orderType === 'MARKET'
    ? (marketPx != null ? Number(marketPx) * (side === 'BUY' ? 1 + HOUSE_SPREAD : 1 - HOUSE_SPREAD) : NaN)
    : Number(price);
  const notional = Number.isFinite(qty) && Number.isFinite(px) ? qty * px : null;
  const held = useMemo(() => {
    const p = (positions || []).find(x => x.symbol === symbol);
    return p ? Number(p.quantity) : 0;
  }, [positions, symbol]);
  const cash = Number(balance || 0);
  const maxQty = side === 'BUY'
    ? (Number.isFinite(px) && px > 0 ? Math.min(MAX_ORDER_QTY, Math.floor((cash / px) * 1e4) / 1e4) : 0)
    : Math.min(MAX_ORDER_QTY, held);
  const overBudget = side === 'BUY' ? notional != null && notional > cash : qty > held;

  const setPct = (pct) => {
    const v = pct === 1 ? maxQty : Math.floor(maxQty * pct * 1e4) / 1e4;
    setQuantity(String(v > 0 ? v : 0));
  };

  const submit = () => {
    const errs = {};
    if (!quantity || !Number.isFinite(qty) || qty <= 0) errs.quantity = 'Enter a quantity greater than 0';
    else if (qty > MAX_ORDER_QTY) errs.quantity = `Max ${MAX_ORDER_QTY.toLocaleString('en-US')} per order`;
    let orderPrice;
    if (orderType === 'MARKET') {
      orderPrice = quoteFor(symbol, side);
      if (!orderPrice) errs.price = `No live price for ${symbol} yet`;
    } else {
      orderPrice = Number(price);
      if (!price || !Number.isFinite(orderPrice) || orderPrice <= 0) errs.price = 'Enter a price greater than 0';
    }
    setFieldError(errs);
    if (Object.keys(errs).length) return;
    const hiddenUserId = document.getElementById('order-user-id')?.value;
    onSubmit({
      symbol, side, type: orderType, quantity: qty, price: orderPrice,
      userId: hiddenUserId ? parseInt(hiddenUserId, 10) : undefined,
    });
  };

  const label = (text, htmlFor) => <label htmlFor={htmlFor} style={labelStyle}>{text}</label>;
  const field = { ...inputStyle, width: '100%', height: '38px', fontSize: '14px', ...num };

  return (
    <section aria-labelledby="ticket-title" style={{ background: colors.bgCard, border: `1px solid ${colors.borderDefault}`, borderRadius: 'var(--vt-radius)', padding: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h2 id="ticket-title" style={{ ...type.section, fontSize: '14px' }}>Place order</h2>
        {isHalted && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: colors.amber, fontSize: '12px', fontWeight: 600 }}><PauseCircle size={14} aria-hidden="true" />Halted</span>}
      </div>

      {/* VULN (IDOR, FE-09): editable hidden user id; the backend honours it. Uncontrolled so an
          edited value survives re-renders. */}
      <input type="hidden" id="order-user-id" key={userId || 'anon'} defaultValue={userId || ''} />

      {/* Side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', padding: '3px', borderRadius: '9px', background: colors.bgInput, border: `1px solid ${colors.borderDefault}`, marginBottom: '12px' }}>
        {['BUY', 'SELL'].map(s => {
          const active = side === s;
          return (
            <button key={s} type="button" aria-pressed={active} onClick={() => onSideChange(s)} className="vt-btn"
              style={{
                height: '34px', border: 'none', borderRadius: '7px', fontWeight: 700, fontSize: '13px', letterSpacing: '0.04em',
                background: active ? (s === 'BUY' ? colors.upFill : colors.downFill) : 'transparent',
                color: active ? (s === 'BUY' ? colors.onUp : colors.onDown) : colors.textMuted,
              }}>
              {s}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
        <div>
          {label('Symbol', 'ticket-symbol')}
          <select id="ticket-symbol" value={symbol} onChange={e => onSymbolChange(e.target.value)} style={{ ...selectStyle, width: '100%', height: '38px' }}>
            {symbols.length === 0 && <option value={symbol}>{symbol}</option>}
            {symbols.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          {label('Type', 'ticket-type')}
          <select id="ticket-type" value={orderType} onChange={e => { setOrderType(e.target.value); setFieldError({}); }} style={{ ...selectStyle, width: '100%', height: '38px' }}>
            <option value="LIMIT">LIMIT</option>
            <option value="MARKET">MARKET</option>
          </select>
        </div>
      </div>

      <div style={{ marginBottom: '10px' }}>
        {label(orderType === 'MARKET' ? `Price · market ${side === 'BUY' ? 'ask' : 'bid'}` : 'Limit price', 'ticket-price')}
        <input id="ticket-price" type="number" step="0.01" inputMode="decimal" value={price}
          onChange={e => { setPrice(e.target.value); setFieldError(f => ({ ...f, price: undefined })); }}
          readOnly={orderType === 'MARKET'} aria-invalid={!!fieldError.price} aria-describedby={fieldError.price ? 'ticket-price-err' : undefined}
          style={{ ...field, background: orderType === 'MARKET' ? colors.bgStat : colors.bgInput, color: orderType === 'MARKET' ? colors.textSecondary : colors.textPrimary }} />
        {fieldError.price && <div id="ticket-price-err" role="alert" style={{ color: colors.redLight, fontSize: '12px', marginTop: '4px' }}>{fieldError.price}</div>}
      </div>

      <div style={{ marginBottom: '8px' }}>
        {label(`Quantity${symbol ? ` · ${symbol}` : ''}`, 'ticket-qty')}
        <input id="ticket-qty" type="number" min="0" max="10000" step="any" inputMode="decimal" value={quantity}
          onChange={e => { setQuantity(e.target.value); setFieldError(f => ({ ...f, quantity: undefined })); }}
          aria-invalid={!!fieldError.quantity} aria-describedby={fieldError.quantity ? 'ticket-qty-err' : undefined}
          style={field} />
        {fieldError.quantity && <div id="ticket-qty-err" role="alert" style={{ color: colors.redLight, fontSize: '12px', marginTop: '4px' }}>{fieldError.quantity}</div>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px', marginBottom: '12px' }}>
        {[0.25, 0.5, 0.75, 1].map(p => (
          <button key={p} type="button" onClick={() => setPct(p)} disabled={!maxQty} className="vt-btn vt-ghost"
            style={{ height: '26px', fontSize: '11.5px', fontWeight: 600, borderRadius: '6px', border: `1px solid ${colors.borderDefault}`, background: 'transparent', color: colors.textSecondary }}>
            {p === 1 ? 'Max' : `${p * 100}%`}
          </button>
        ))}
      </div>

      <div style={{ borderTop: `1px dashed ${colors.borderDefault}`, paddingTop: '8px', marginBottom: '12px' }}>
        <KV label={side === 'BUY' ? 'Est. cost' : 'Est. proceeds'} value={notional != null ? fmtUSD(notional) : '—'} valueColor={overBudget ? colors.red : colors.textPrimary} />
        {orderType === 'MARKET' && <KV label="Fill price (incl. 0.01% house spread)" value={Number.isFinite(px) ? fmtPrice(px) : '—'} />}
        <KV label="Available" value={side === 'BUY' ? fmtUSD(cash) : `${fmtQty(held)} ${symbol}`} />
        {overBudget && (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', color: colors.amber, fontSize: '12px', marginTop: '6px' }}>
            <AlertTriangle size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: '1px' }} />
            {side === 'BUY' ? 'More than your cash — the order will be rejected.' : `You hold ${fmtQty(held)} ${symbol}.`}
          </div>
        )}
        {orderType === 'LIMIT' && q && side === 'BUY' && Number(price) >= Number(q.ask) && (
          <div style={{ display: 'flex', gap: '6px', color: colors.textMuted, fontSize: '12px', marginTop: '6px' }}>
            <Info size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: '1px' }} />At or above the ask — fills immediately.
          </div>
        )}
      </div>

      <Button variant={side === 'BUY' ? 'green' : 'red'} size="large" onClick={submit} loading={busy} disabled={isHalted}
        style={{ fontSize: '14px', letterSpacing: '0.02em' }}>
        {side} {symbol}
      </Button>

      {error && (
        <div role="alert" style={{ marginTop: '10px', padding: '10px 12px', borderRadius: '8px', background: colors.redDark, border: `1px solid ${colors.borderDanger}`, color: colors.redLight, fontSize: '12.5px', display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
          <span><strong>Order rejected:</strong> {error}</span>
          <button type="button" onClick={onDismissError} aria-label="Dismiss" style={{ background: 'transparent', border: 'none', color: colors.redLight }}>✕</button>
        </div>
      )}
    </section>
  );
}
