package com.vulntrade.security.logging;

import java.util.Locale;

/**
 * Result of a security event. Pick it from the event name (logging-guide §3 rule 2):
 * <ul>
 *   <li>{@code *_failure}, {@code *_failed} -> FAILURE</li>
 *   <li>{@code *_rejected}, {@code *_denied}, {@code *_exceeded}, {@code *_invalid_*} -> DENIED</li>
 *   <li>{@code *_created}, {@code *_completed}, {@code *_success} -> SUCCESS</li>
 *   <li>{@code unexpected_exception} -> ERROR</li>
 *   <li>neutral names ({@code admin_action}, {@code password_changed}, ...) -> SUCCESS or FAILURE</li>
 * </ul>
 */
public enum Outcome {
    SUCCESS,
    FAILURE,
    DENIED,
    ERROR;

    /** The JSON value, e.g. "failure". */
    public String value() {
        return name().toLowerCase(Locale.ROOT);
    }
}
