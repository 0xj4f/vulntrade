import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';

// VULN: WebSocket URL hardcoded and exposed
const WS_URL = process.env.REACT_APP_WS_URL || 'http://localhost:8080/ws-sockjs';

let stompClient = null;
let subscriptions = {};

/**
 * Connect to WebSocket/STOMP server.
 * VULN: Token sent in STOMP headers (visible in network tab).
 * VULN: No reconnection token refresh.
 */
export function connectWebSocket(onConnect, onError) {
  const token = localStorage.getItem('token'); // VULN: from localStorage

  stompClient = new Client({
    webSocketFactory: () => new SockJS(WS_URL),
    connectHeaders: {
      Authorization: token ? 'Bearer ' + token : '',
      token: token || '', // VULN: also sent as plain header
    },
    debug: (str) => {
      console.log('[STOMP]', str); // VULN: debug logging in production
    },
    reconnectDelay: 5000,
    heartbeatIncoming: 4000,
    heartbeatOutgoing: 4000,
    onConnect: (frame) => {
      console.log('[STOMP] Connected:', frame);
      if (onConnect) onConnect(frame);
    },
    onStompError: (frame) => {
      console.error('[STOMP] Error:', frame);
      if (onError) onError(frame);
    },
    onDisconnect: () => {
      console.log('[STOMP] Disconnected');
    },
  });

  stompClient.activate();
  return stompClient;
}

/**
 * Subscribe to a STOMP destination.
 */
export function subscribe(destination, callback) {
  if (!stompClient || !stompClient.connected) {
    console.warn('[STOMP] Not connected, cannot subscribe to', destination);
    return null;
  }

  const sub = stompClient.subscribe(destination, (message) => {
    try {
      const body = JSON.parse(message.body);
      callback(body);
    } catch (e) {
      callback(message.body);
    }
  });

  subscriptions[destination] = sub;
  return sub;
}

/**
 * Send a STOMP message to a destination.
 */
export function sendMessage(destination, body) {
  if (!stompClient || !stompClient.connected) {
    console.warn('[STOMP] Not connected, cannot send to', destination);
    return;
  }

  stompClient.publish({
    destination: destination,
    body: JSON.stringify(body),
  });
}

/**
 * Disconnect from WebSocket.
 */
export function disconnectWebSocket() {
  if (stompClient) {
    Object.values(subscriptions).forEach(sub => {
      try { sub.unsubscribe(); } catch (e) { /* ignore */ }
    });
    subscriptions = {};
    stompClient.deactivate();
    stompClient = null;
  }
}

/**
 * Check if connected.
 */
export function isConnected() {
  return stompClient && stompClient.connected;
}
