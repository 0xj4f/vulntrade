package com.vulntrade.security.logging;

import java.util.Locale;

/**
 * Every security event VulnTrade writes to security.log.
 *
 * <p>This list mirrors {@code data/VulnTrade Security Events.xlsx} (the source of
 * truth) and the catalog in {@code docs/logging-guide.md} §4. Each constant knows
 * its spreadsheet category. The JSON {@code eventType} is the constant name in
 * lower case, e.g. {@code LOGIN_FAILURE} is written as {@code "login_failure"}.
 *
 * <p>Adding an event: add the sheet row first, then the constant here under its
 * category, then call {@link SecurityEventLogger#log}.
 */
public enum SecurityEvent {

    // --- authentication ---
    LOGIN_SUCCESS("authentication"),
    LOGIN_FAILURE("authentication"),
    LOGOUT("authentication"),
    API_KEY_USED("authentication"),                  // VulnTrade specific

    // --- session ---
    SESSION_CREATED("session"),

    // --- token ---
    TOKEN_VALIDATION_FAILED("token"),                // VulnTrade specific
    REFRESH_TOKEN_USED("token"),

    // --- credentials ---
    PASSWORD_CHANGED("credentials"),
    PASSWORD_RESET_REQUESTED("credentials"),
    PASSWORD_RESET_COMPLETED("credentials"),

    // --- account ---
    ACCOUNT_CREATED("account"),
    ACCOUNT_DISABLED("account"),
    ACCOUNT_ENABLED("account"),

    // --- user ---
    PROFILE_UPDATED("user"),
    SECURITY_ATTRIBUTE_UPDATED("user"),

    // --- authorization ---
    AUTHORIZATION_DENIED("authorization"),
    PERMISSION_CHANGED("authorization"),

    // --- data ---
    SENSITIVE_DATA_READ("data"),
    SENSITIVE_DATA_UPDATED("data"),
    SENSITIVE_DATA_DELETED("data"),
    DATA_EXPORTED("data"),

    // --- file ---
    FILE_CREATED_OR_UPLOADED("file"),

    // --- administration ---
    ADMIN_ACTION("administration"),

    // --- audit ---
    AUDIT_CONFIGURATION_CHANGED("audit"),

    // --- funding ---
    DEPOSIT_COMPLETED("funding"),
    DEPOSIT_FAILED("funding"),

    // --- withdrawal ---
    WITHDRAWAL_COMPLETED("withdrawal"),
    WITHDRAWAL_REJECTED("withdrawal"),

    // --- order ---
    ORDER_CREATED("order"),
    ORDER_REJECTED("order"),
    ORDER_CANCELLED("order"),

    // --- trade ---
    TRADE_EXECUTED("trade"),

    // --- alert ---
    PRICE_ALERT_CREATED("alert"),                    // VulnTrade specific

    // --- debug ---
    DEBUG_COMMAND_EXECUTED("debug"),                 // VulnTrade specific
    DEBUG_QUERY_EXECUTED("debug"),                   // VulnTrade specific

    // --- framework ---
    FRAMEWORK_ENDPOINT_ACCESSED("framework"),        // VulnTrade specific

    // --- websocket ---
    WEBSOCKET_AUTHENTICATION_FAILED("websocket"),
    WEBSOCKET_AUTHORIZATION_FAILED("websocket"),
    WEBSOCKET_MESSAGE_SIZE_EXCEEDED("websocket"),
    WEBSOCKET_INVALID_MESSAGE("websocket"),

    // --- input_validation ---
    INPUT_VALIDATION_FAILED("input_validation"),

    // --- application ---
    UNEXPECTED_EXCEPTION("application");

    private final String category;

    SecurityEvent(String category) {
        this.category = category;
    }

    /** The spreadsheet category, e.g. "authentication". */
    public String category() {
        return category;
    }

    /** The JSON eventType, e.g. "login_failure". Locale.ROOT so it is the same on every JVM. */
    public String eventType() {
        return name().toLowerCase(Locale.ROOT);
    }

    /**
     * Context events describe the request, not its result. They do not stop the
     * RequestLoggingFilter fallback (401/403 -> authorization_denied, ...).
     * See logging-guide §4.5.
     */
    public boolean isContextEvent() {
        return this == TOKEN_VALIDATION_FAILED
                || this == API_KEY_USED
                || this == FRAMEWORK_ENDPOINT_ACCESSED
                || this == AUDIT_CONFIGURATION_CHANGED;
    }
}
