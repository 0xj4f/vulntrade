package com.vulntrade.fx;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Liquidity Providers: three fake banks that send a raw bid/ask for every pair, every second.
 * (In real life these are bank price feeds. Here they are a random walk.)
 *
 * In the House model the banks only give prices: we never actually trade with them.
 * A future "A-book" router could send some orders to them (see FxOms.execute).
 */
@Component
public class LpSimulator {

    public static final String[] BANKS = {"Bank A", "Bank B", "Bank C"};

    /** One bank's raw price for one pair. */
    public static final class LpQuote {
        public final String bank;
        public final BigDecimal bid;
        public final BigDecimal ask;

        LpQuote(String bank, BigDecimal bid, BigDecimal ask) {
            this.bank = bank;
            this.bid = bid;
            this.ask = ask;
        }
    }

    // VULN #37 (same as the stock simulator): fixed seed, so the price path is predictable
    private final Random random = new Random(42);
    private final Map<String, BigDecimal> mids = new ConcurrentHashMap<>();
    private final PriceEngine priceEngine;

    public LpSimulator(PriceEngine priceEngine) {
        this.priceEngine = priceEngine;
        FxPairs.ALL.values().forEach(p -> mids.put(p.symbol, p.startMid));
    }

    @Scheduled(fixedRate = 1000)
    public void tick() {
        for (FxPairs.Pair pair : FxPairs.ALL.values()) {
            // the "real" market moves a little (about 2 pips a second)
            BigDecimal mid = mids.get(pair.symbol)
                    .multiply(BigDecimal.valueOf(1 + random.nextGaussian() * 0.0002))
                    .setScale(pair.priceScale, RoundingMode.HALF_UP);
            mids.put(pair.symbol, mid);

            // each bank quotes around it, a bit differently (spread 0.5 - 1.5 pips, small offset)
            List<LpQuote> quotes = new ArrayList<>();
            for (int i = 0; i < BANKS.length; i++) {
                BigDecimal halfSpread = pair.pip.multiply(BigDecimal.valueOf(0.25 + 0.25 * i));
                BigDecimal offset = pair.pip.multiply(BigDecimal.valueOf(random.nextGaussian() * 0.3));
                BigDecimal bid = mid.add(offset).subtract(halfSpread).setScale(pair.priceScale, RoundingMode.HALF_UP);
                BigDecimal ask = mid.add(offset).add(halfSpread).setScale(pair.priceScale, RoundingMode.HALF_UP);
                quotes.add(new LpQuote(BANKS[i], bid, ask));
            }
            priceEngine.onBankPrices(pair, quotes);
        }
    }
}
