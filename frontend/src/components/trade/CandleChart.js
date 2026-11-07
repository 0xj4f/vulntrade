import React, { useEffect, useRef, useState } from 'react';
import { createChart, CrosshairMode } from 'lightweight-charts';
import api from '../../services/apiService';
import { useThemeColors } from '../../context/ThemeContext';
import { useMarketData } from '../../context/MarketDataContext';
import { colors } from '../../styles/shared';
import { priceDecimals } from '../../utils/format';

export const INTERVALS = [
  { value: '1m', label: '1m', seconds: 60 },
  { value: '5m', label: '5m', seconds: 300 },
  { value: '15m', label: '15m', seconds: 900 },
  { value: '1h', label: '1H', seconds: 3600 },
];

/**
 * Candlestick + volume chart fed by /api/market/candles, kept live from the shared price
 * feed (the last bar updates on every tick; a new bar opens when the interval rolls).
 * Reports OHLC of the hovered (or latest) bar through onBar.
 */
export default function CandleChart({ symbol, interval = '1m', height = 420, onBar, compact = false }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const volumeRef = useRef(null);
  const lastBarRef = useRef(null);
  const barsRef = useRef([]);
  const onBarRef = useRef(onBar);
  onBarRef.current = onBar;
  const palette = useThemeColors();
  const { quotes } = useMarketData();
  const [state, setState] = useState('loading'); // loading | ready | empty | error
  const seconds = (INTERVALS.find(i => i.value === interval) || INTERVALS[0]).seconds;

  // Create the chart once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const chart = createChart(el, {
      height,
      autoSize: false,
      width: el.clientWidth,
      layout: { background: { color: 'transparent' }, textColor: palette.text, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 11 },
      grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
      rightPriceScale: { borderColor: palette.border, scaleMargins: { top: 0.08, bottom: compact ? 0.08 : 0.24 } },
      timeScale: { borderColor: palette.border, timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: CrosshairMode.Normal },
      // Drag/pinch to pan and zoom; the mouse wheel keeps scrolling the page.
      handleScale: { mouseWheel: false, pinch: !compact, axisPressedMouseMove: !compact, axisDoubleClickReset: true },
      handleScroll: { mouseWheel: false, pressedMouseMove: !compact, horzTouchDrag: !compact, vertTouchDrag: false },
    });
    const candles = chart.addCandlestickSeries({
      upColor: palette.up, downColor: palette.down, borderUpColor: palette.up, borderDownColor: palette.down,
      wickUpColor: palette.up, wickDownColor: palette.down,
    });
    const volume = compact ? null : chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '', color: palette.upSoft });
    if (volume) volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    chart.subscribeCrosshairMove((param) => {
      const bar = param && param.seriesData ? param.seriesData.get(candles) : null;
      if (onBarRef.current) onBarRef.current(bar || lastBarRef.current);
    });

    chartRef.current = chart;
    candleRef.current = candles;
    volumeRef.current = volume;

    const ro = new ResizeObserver(entries => {
      const w = Math.floor(entries[0].contentRect.width);
      if (w > 0) chart.applyOptions({ width: w });
    });
    ro.observe(el);
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [compact, height]);

  // Theme changes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({
      layout: { textColor: palette.text },
      grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
      rightPriceScale: { borderColor: palette.border },
      timeScale: { borderColor: palette.border },
    });
    candleRef.current && candleRef.current.applyOptions({
      upColor: palette.up, downColor: palette.down, borderUpColor: palette.up, borderDownColor: palette.down,
      wickUpColor: palette.up, wickDownColor: palette.down,
    });
    if (volumeRef.current) {
      volumeRef.current.setData(barsRef.current.map(b => ({ time: b.time, value: b.volume || 0, color: b.close >= b.open ? palette.upSoft : palette.downSoft })));
    }
  }, [palette]);

  // Load history whenever symbol/interval changes.
  useEffect(() => {
    let cancelled = false;
    setState('loading');
    lastBarRef.current = null;
    barsRef.current = [];
    api.get('/api/market/candles', { params: { symbol, interval, limit: compact ? 120 : 400 } })
      .then(res => {
        if (cancelled || !candleRef.current) return;
        const bars = (res.data?.candles || []).map(b => ({
          time: b.time, open: Number(b.open), high: Number(b.high), low: Number(b.low), close: Number(b.close), volume: Number(b.volume || 0),
        }));
        const ref = bars.length ? bars[bars.length - 1].close : 1;
        const precision = priceDecimals(Math.abs(ref));
        candleRef.current.applyOptions({ priceFormat: { type: 'price', precision, minMove: 1 / 10 ** precision } });
        candleRef.current.setData(bars);
        if (volumeRef.current) {
          volumeRef.current.setData(bars.map(b => ({ time: b.time, value: b.volume, color: b.close >= b.open ? palette.upSoft : palette.downSoft })));
        }
        barsRef.current = bars;
        lastBarRef.current = bars[bars.length - 1] || null;
        if (onBarRef.current) onBarRef.current(lastBarRef.current);
        chartRef.current && chartRef.current.timeScale().fitContent();
        setState(bars.length ? 'ready' : 'empty');
      })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [symbol, interval, compact]);

  // Live updates from the shared price feed.
  const q = quotes[symbol];
  const price = q ? Number(q.currentPrice) : NaN;
  const tick = q ? q.tick : 0;
  useEffect(() => {
    const series = candleRef.current;
    const last = lastBarRef.current;
    if (!series || !last || !Number.isFinite(price) || price <= 0) return;
    const nowBucket = Math.floor(Date.now() / 1000 / seconds) * seconds;
    let bar;
    if (nowBucket > last.time) {
      bar = { time: nowBucket, open: last.close, high: Math.max(last.close, price), low: Math.min(last.close, price), close: price, volume: 0 };
      barsRef.current = [...barsRef.current, bar];
    } else {
      bar = { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price };
      barsRef.current = [...barsRef.current.slice(0, -1), bar];
    }
    lastBarRef.current = bar;
    series.update(bar);
    if (onBarRef.current) onBarRef.current(bar);
  }, [price, tick, seconds]);

  return (
    <div style={{ position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height }} role="img" aria-label={`${symbol} ${interval} candlestick chart`} />
      {state !== 'ready' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.textMuted, fontSize: '13px', pointerEvents: 'none' }}>
          {state === 'loading' ? <div className="skeleton" style={{ width: '92%', height: '80%' }} /> : state === 'empty' ? 'No price history yet' : 'Chart data unavailable'}
        </div>
      )}
    </div>
  );
}
