package com.vulntrade.gateway;

import com.vulntrade.security.logging.Outcome;
import com.vulntrade.security.logging.SecurityEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import static com.vulntrade.security.logging.SecurityEventLogger.details;
import static com.vulntrade.security.logging.SecurityEventLogger.log;

/** Same as the platform's StompEventListener: log WebSocket sessions closed for a bad frame. */
@Component
public class GatewaySessionEvents {

    @EventListener
    public void onDisconnect(SessionDisconnectEvent event) {
        // 1009 = frame too big, 1002 = protocol error (e.g. a malformed STOMP frame)
        int closeCode = event.getCloseStatus() == null ? 0 : event.getCloseStatus().getCode();
        if (closeCode == 1009) {
            log(SecurityEvent.WEBSOCKET_MESSAGE_SIZE_EXCEEDED, Outcome.DENIED, details("closeCode", closeCode));
        } else if (closeCode == 1002) {
            log(SecurityEvent.WEBSOCKET_INVALID_MESSAGE, Outcome.DENIED, details("closeCode", closeCode));
        }
    }
}
