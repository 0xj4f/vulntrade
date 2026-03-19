package com.vulntrade.service;

import com.vulntrade.model.AuditLog;
import com.vulntrade.repository.AuditLogRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Audit logging service.
 * VULN: Log injection - details field not sanitized.
 * VULN: Many actions not logged (intentionally incomplete).
 */
@Service
public class AuditService {

    private static final Logger logger = LoggerFactory.getLogger(AuditService.class);
    private final AuditLogRepository auditLogRepository;

    public AuditService(AuditLogRepository auditLogRepository) {
        this.auditLogRepository = auditLogRepository;
    }

    /**
     * Log an action to audit trail.
     * VULN: Details not sanitized - log injection possible.
     * Attacker can inject fake log entries via newlines in details.
     */
    public void logAction(Long userId, String action, String details, String ipAddress) {
        // VULN: No sanitization of details - log injection
        logger.info("AUDIT: userId={} action={} details={} ip={}", userId, action, details, ipAddress);

        AuditLog log = new AuditLog();
        log.setUserId(userId);
        log.setAction(action);
        log.setDetails(details);  // VULN: raw unsanitized input
        log.setIpAddress(ipAddress);

        try {
            auditLogRepository.save(log);
        } catch (Exception e) {
            // VULN: Silently swallow audit failures
            logger.error("Failed to save audit log: {}", e.getMessage());
        }
    }

    /**
     * VULN: Many critical actions intentionally NOT audited:
     * - Withdrawals
     * - Balance adjustments
     * - Price overrides
     * - Trading halts
     * - Failed login attempts
     */
}
