import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/apiService';
import { subscribe, unsubscribe } from '../services/websocketService';

/**
 * One live price feed for the whole app (stocks + crypto).
 *
 * Loads /api/equities/market/prices and /api/crypto/market/prices once, then applies the
 * /topic/equities/prices and /topic/crypto/prices ticks (each on its product socket). Ticks
 * are buffered and flushed to React state at most every 250 ms. Each quote carries `dir`
 * ('up' | 'down') and `tick` (increments on every change) so cells can flash; `history`
 * keeps the last 60 prices per symbol for sparklines.
 *
 * VULN (kept, #69): the internal fields of each tick (costBasis, marketMakerId, spreadBps)
 * are stored and can be shown in debug mode.
 */
const MarketDataContext = createContext(null);

const HISTORY = 60;
const FLUSH_MS = 250;
const PRODUCTS = ['equities', 'crypto'];

/** GET one product's price list (an empty list if that gateway is down). */
const fetchPrices = (product) => api.get(`/api/${product}/market/prices`)
  .then(res => (Array.isArray(res.data) ? res.data : []))
  .catch(err => { console.error(`Failed to fetch ${product} prices:`, err); return []; });

export function MarketDataProvider({ enabled, children }) {
  const [quotes, setQuotes] = useState({});
  const [order, setOrder] = useState([]);
  const [history, setHistory] = useState({});
  const [halted, setHalted] = useState({});
  const [loaded, setLoaded] = useState(false);
  const quotesRef = useRef({});
  const historyRef = useRef({});
  const dirtyRef = useRef(false);

  const load = useCallback(() => Promise.all(PRODUCTS.map(fetchPrices)).then(lists => {
    const list = [].concat(...lists);   // stocks first, then crypto
    const next = { ...quotesRef.current };
    list.forEach(s => {
      next[s.symbol] = { ...next[s.symbol], ...s, open: s.openPrice ?? next[s.symbol]?.open, changePct: s.changePct ?? next[s.symbol]?.changePct };
      if (!historyRef.current[s.symbol]) historyRef.current[s.symbol] = [Number(s.currentPrice)];
    });
    quotesRef.current = next;
    setOrder(list.map(s => s.symbol));
    setQuotes(next);
    setHistory({ ...historyRef.current });
    setLoaded(true);
  }), []);

  useEffect(() => {
    if (!enabled) return undefined;
    load();
    const onTick = (u) => {
      if (!u || typeof u !== 'object') return;
      if (u.type === 'TRADING_HALT') {
        if (u.symbol) setHalted(h => ({ ...h, [u.symbol]: true }));
        return;
      }
      if (!u.symbol) return;
      const prev = quotesRef.current[u.symbol] || { symbol: u.symbol };
      const last = Number(u.last);
      const prevLast = Number(prev.currentPrice);
      const dir = Number.isFinite(prevLast) && last !== prevLast ? (last > prevLast ? 'up' : 'down') : prev.dir;
      quotesRef.current = {
        ...quotesRef.current,
        [u.symbol]: {
          ...prev,
          currentPrice: u.last,
          bid: u.bid,
          ask: u.ask,
          volume: u.volume,
          open: u.open ?? prev.open,
          changePct: u.changePct ?? prev.changePct,
          marketMakerId: u.marketMakerId,
          costBasis: u.costBasis,
          spreadBps: u.spreadBps,
          updatedAt: u.timestamp,
          dir,
          tick: (prev.tick || 0) + (last !== prevLast ? 1 : 0),
        },
      };
      if (Number.isFinite(last) && last > 0) {
        const h = historyRef.current[u.symbol] || [];
        historyRef.current[u.symbol] = h.length >= HISTORY ? [...h.slice(1), last] : [...h, last];
      }
      dirtyRef.current = true;
    };
    const handles = PRODUCTS.map(p => subscribe(`/topic/${p}/prices`, onTick, p));
    const iv = setInterval(() => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      setQuotes(quotesRef.current);
      setHistory({ ...historyRef.current });
    }, FLUSH_MS);
    return () => { handles.forEach(unsubscribe); clearInterval(iv); };
  }, [enabled, load]);

  const markResumed = useCallback((symbol) => setHalted(h => { const n = { ...h }; delete n[symbol]; return n; }), []);
  const markHalted = useCallback((symbol) => setHalted(h => ({ ...h, [symbol]: true })), []);

  const value = useMemo(() => ({
    quotes,
    list: order.map(s => quotes[s]).filter(Boolean),
    symbols: order,
    history,
    halted,
    loaded,
    reload: load,
    markHalted,
    markResumed,
    /** Live ask (BUY) or bid (SELL), falling back to last. */
    quoteFor: (symbol, side) => {
      const q = quotesRef.current[symbol];
      if (!q) return null;
      const v = side === 'SELL' ? (q.bid ?? q.currentPrice) : (q.ask ?? q.currentPrice);
      return v != null ? Number(v) : null;
    },
    lastFor: (symbol) => {
      const q = quotesRef.current[symbol];
      return q ? Number(q.currentPrice) : null;
    },
  }), [quotes, order, history, halted, loaded, load, markHalted, markResumed]);

  return <MarketDataContext.Provider value={value}>{children}</MarketDataContext.Provider>;
}

export function useMarketData() {
  const ctx = useContext(MarketDataContext);
  if (!ctx) throw new Error('useMarketData must be used within MarketDataProvider');
  return ctx;
}

export default MarketDataContext;
