package com.vulntrade.service;

import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory OHLC candles built from the price ticks.
 *
 * Keeps one day of 1-minute bars per symbol (ring buffer); 5m/15m/1h bars are aggregated on
 * request. When a symbol is first seen, six hours of history are back-filled so charts are
 * never empty: a random walk ending exactly at the live price (its own Random, so the
 * simulator's fixed-seed sequence is untouched), or, for VULN, its real sine formula.
 * Back-filled bars are flagged {@code synthetic}.
 */
@Service
public class CandleService {

    public static final int MINUTE = 60;
    private static final int CAPACITY = 1440;          // one day of 1m bars
    private static final int BACKFILL_MINUTES = 360;   // six hours
    private static final Map<String, Integer> INTERVALS = Map.of("1m", 60, "5m", 300, "15m", 900, "1h", 3600);

    public static final class Candle {
        public final long time;   // bar open, epoch seconds (UTC)
        public double open, high, low, close, volume;
        public final boolean synthetic;

        Candle(long time, double open, double high, double low, double close, double volume, boolean synthetic) {
            this.time = time;
            this.open = open;
            this.high = high;
            this.low = low;
            this.close = close;
            this.volume = volume;
            this.synthetic = synthetic;
        }

        Map<String, Object> toMap(int scale) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("time", time);
            m.put("open", round(open, scale));
            m.put("high", round(high, scale));
            m.put("low", round(low, scale));
            m.put("close", round(close, scale));
            m.put("volume", Math.round(volume));
            if (synthetic) m.put("synthetic", true);
            return m;
        }
    }

    private final Map<String, Deque<Candle>> bars = new ConcurrentHashMap<>();

    public static boolean isValidInterval(String interval) {
        return INTERVALS.containsKey(interval);
    }

    /** Record one tick. {@code epochMillis} is the tick time. */
    public void onTick(String symbol, BigDecimal price, long volumeDelta, long epochMillis, long simulatorTick) {
        if (price == null || price.signum() <= 0) return;
        double p = price.doubleValue();
        long bucket = (epochMillis / 1000L) / MINUTE * MINUTE;
        Deque<Candle> series = bars.computeIfAbsent(symbol, s -> backfill(s, p, bucket, simulatorTick));
        synchronized (series) {
            Candle last = series.peekLast();
            if (last != null && last.time == bucket) {
                last.high = Math.max(last.high, p);
                last.low = Math.min(last.low, p);
                last.close = p;
                last.volume += volumeDelta;
            } else {
                double open = last != null ? last.close : p;
                series.addLast(new Candle(bucket, open, Math.max(open, p), Math.min(open, p), p, volumeDelta, false));
                while (series.size() > CAPACITY) series.pollFirst();
            }
        }
    }

    /**
     * Bars for a symbol, oldest first, in lightweight-charts shape
     * {time, open, high, low, close, volume}. Empty if the symbol has not ticked yet.
     */
    public List<Map<String, Object>> candles(String symbol, String interval, int limit) {
        int seconds = INTERVALS.getOrDefault(interval, 60);
        Deque<Candle> series = bars.get(symbol);
        if (series == null) return List.of();

        List<Candle> minute;
        synchronized (series) {
            minute = new ArrayList<>(series);
        }
        List<Candle> out = new ArrayList<>();
        Candle current = null;
        for (Candle c : minute) {
            long bucket = c.time / seconds * seconds;
            if (current == null || current.time != bucket) {
                current = new Candle(bucket, c.open, c.high, c.low, c.close, c.volume, c.synthetic);
                out.add(current);
            } else {
                current.high = Math.max(current.high, c.high);
                current.low = Math.min(current.low, c.low);
                current.close = c.close;
                current.volume += c.volume;
            }
        }
        int from = Math.max(0, out.size() - Math.max(1, limit));
        int scale = scaleFor(minute.isEmpty() ? 1 : minute.get(minute.size() - 1).close);
        List<Map<String, Object>> result = new ArrayList<>();
        for (Candle c : out.subList(from, out.size())) result.add(c.toMap(scale));
        return result;
    }

    // ------------------------------------------------------------------

    private Deque<Candle> backfill(String symbol, double livePrice, long currentBucket, long simulatorTick) {
        Deque<Candle> series = new ArrayDeque<>();
        if ("VULN".equals(symbol)) {
            // Same formula as the simulator: 100 + 20·sin(tick·0.1), one tick per second.
            for (int m = BACKFILL_MINUTES; m >= 1; m--) {
                long start = currentBucket - (long) m * MINUTE;
                long firstTick = simulatorTick - (long) m * MINUTE;
                double open = vuln(firstTick), close = vuln(firstTick + MINUTE - 1);
                double high = Math.max(open, close), low = Math.min(open, close);
                for (int s = 0; s < MINUTE; s++) {
                    double v = vuln(firstTick + s);
                    high = Math.max(high, v);
                    low = Math.min(low, v);
                }
                series.addLast(new Candle(start, open, high, low, close, 0, true));
            }
            return series;
        }

        // Random walk backwards from the live price, then replayed forwards.
        Random rng = new Random(symbol.hashCode() * 31L + currentBucket / 3600);
        double perMinuteVol = PriceSimulatorService.volatilityPerTick(symbol) * Math.sqrt(MINUTE);
        double[] closes = new double[BACKFILL_MINUTES + 1];
        closes[BACKFILL_MINUTES] = livePrice;
        for (int i = BACKFILL_MINUTES - 1; i >= 0; i--) {
            closes[i] = Math.max(closes[i + 1] * (1 - rng.nextGaussian() * perMinuteVol), livePrice * 1e-3);
        }
        for (int i = 0; i < BACKFILL_MINUTES; i++) {
            long start = currentBucket - (long) (BACKFILL_MINUTES - i) * MINUTE;
            double open = closes[i], close = closes[i + 1];
            double wiggle = Math.abs(rng.nextGaussian()) * perMinuteVol * 0.6;
            double high = Math.max(open, close) * (1 + wiggle);
            double low = Math.min(open, close) * (1 - Math.abs(rng.nextGaussian()) * perMinuteVol * 0.6);
            double volume = 60 * (100 + rng.nextDouble() * 10000);   // same scale as live ticks (~300k/min)
            series.addLast(new Candle(start, open, high, low, close, volume, true));
        }
        return series;
    }

    private static double vuln(long tick) {
        return 100.0 + 20.0 * Math.sin(tick * 0.1);
    }

    private static int scaleFor(double price) {
        if (price >= 1) return 2;
        if (price >= 0.01) return 6;
        return 10;
    }

    private static BigDecimal round(double v, int scale) {
        return BigDecimal.valueOf(v).setScale(scale, RoundingMode.HALF_UP);
    }
}
