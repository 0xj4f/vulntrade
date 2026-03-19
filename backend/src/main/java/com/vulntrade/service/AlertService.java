package com.vulntrade.service;

import com.vulntrade.model.PriceAlert;
import com.vulntrade.repository.PriceAlertRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Price alert service.
 * 
 * VULN: Stored XSS via symbol field (rendered in notification).
 * VULN: No limit on number of alerts (resource exhaustion).
 */
@Service
public class AlertService {

    private static final Logger logger = LoggerFactory.getLogger(AlertService.class);

    private final PriceAlertRepository priceAlertRepository;
    private final SimpMessagingTemplate messagingTemplate;

    public AlertService(PriceAlertRepository priceAlertRepository,
                        SimpMessagingTemplate messagingTemplate) {
        this.priceAlertRepository = priceAlertRepository;
        this.messagingTemplate = messagingTemplate;
    }

    /**
     * Create a new price alert.
     * VULN: Stored XSS via symbol field.
     * VULN: No limit on number of alerts per user.
     */
    public PriceAlert createAlert(Long userId, String symbol, BigDecimal targetPrice, String direction) {
        // VULN: No sanitization of symbol field - stored XSS
        // VULN: No limit on number of alerts per user (resource exhaustion)
        // We intentionally do NOT check: priceAlertRepository.countByUserId(userId)

        PriceAlert alert = new PriceAlert();
        alert.setUserId(userId);
        alert.setSymbol(symbol);       // VULN: raw input, no sanitization
        alert.setTargetPrice(targetPrice);
        alert.setDirection(direction);
        alert.setIsTriggered(false);

        alert = priceAlertRepository.save(alert);
        logger.info("Alert created: userId={}, symbol={}, target={}, direction={}",
                userId, symbol, targetPrice, direction);

        return alert;
    }

    /**
     * Check and trigger alerts based on current prices.
     * Called periodically or on price update.
     */
    public void checkAlerts(String symbol, BigDecimal currentPrice) {
        List<PriceAlert> activeAlerts = priceAlertRepository.findBySymbolAndIsTriggered(symbol, false);

        for (PriceAlert alert : activeAlerts) {
            boolean triggered = false;

            if ("ABOVE".equalsIgnoreCase(alert.getDirection()) &&
                    currentPrice.compareTo(alert.getTargetPrice()) >= 0) {
                triggered = true;
            } else if ("BELOW".equalsIgnoreCase(alert.getDirection()) &&
                    currentPrice.compareTo(alert.getTargetPrice()) <= 0) {
                triggered = true;
            }

            if (triggered) {
                alert.setIsTriggered(true);
                priceAlertRepository.save(alert);

                // Send notification to user
                // VULN: Symbol field rendered as HTML in frontend notification
                Map<String, Object> notification = new HashMap<>();
                notification.put("type", "PRICE_ALERT");
                notification.put("symbol", alert.getSymbol());  // VULN: XSS payload here
                notification.put("targetPrice", alert.getTargetPrice());
                notification.put("currentPrice", currentPrice);
                notification.put("direction", alert.getDirection());
                notification.put("message", "Price alert triggered for " + alert.getSymbol() +
                        " at " + currentPrice);

                messagingTemplate.convertAndSendToUser(
                        String.valueOf(alert.getUserId()),
                        "/queue/alerts",
                        notification);

                logger.info("Alert triggered: userId={}, symbol={}, target={}, current={}",
                        alert.getUserId(), alert.getSymbol(), alert.getTargetPrice(), currentPrice);
            }
        }
    }

    /**
     * Get alerts for a user.
     */
    public List<PriceAlert> getUserAlerts(Long userId) {
        return priceAlertRepository.findByUserId(userId);
    }
}
