import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';

// VULN: WebSocket URL hardcoded and exposed
// SockJS requires http:// not ws:// - uses nginx proxy path
const WS_URL = process.env.REACT_APP_WS_SOCKJS_URL || '/ws-sockjs';

/**
 * One STOMP client for the whole app.
 *
 * - subscribe() remembers every subscription and re-subscribes after each reconnect, so a
 *   dropped socket doesn't silently stop the price feed or order updates.
 * - Subscribing before the socket is up is fine: it's applied on connect.
 * - onStatus() reports 'connecting' | 'live' | 'reconnecting' | 'offline'.
 * - sendMessage() returns false when the socket is down, so callers don't claim success.
 */
let stompClient = null;
let status = 'offline';
let nextId = 1;
const registry = new Map();          // id -> { destination, callback, sub }
const statusListeners = new Set();

function setStatus(next) {
  if (status === next) return;
  status = next;
  statusListeners.forEach(fn => { try { fn(status); } catch (e) { /* ignore */ } });
}

function attach(entry) {
  if (!stompClient || !stompClient.connected) return;
  entry.sub = stompClient.subscribe(entry.destination, (message) => {
    let body;
    try { body = JSON.parse(message.body); } catch (e) { body = message.body; }
    entry.callback(body);
  });
}

/**
 * Connect to WebSocket/STOMP server (idempotent).
 * VULN: Token sent in STOMP headers (visible in network tab).
 */
export function connectWebSocket(onConnect, onError) {
  if (stompClient) return stompClient;
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
    reconnectDelay: 3000,
    heartbeatIncoming: 4000,
    heartbeatOutgoing: 4000,
    onConnect: (frame) => {
      console.log('[STOMP] Connected:', frame);
      registry.forEach(attach);              // (re)subscribe everything
      setStatus('live');
      if (onConnect) onConnect(frame);
    },
    onStompError: (frame) => {
      console.error('[STOMP] Error:', frame);
      if (onError) onError(frame);
    },
    onWebSocketClose: () => {
      registry.forEach(entry => { entry.sub = null; });
      setStatus(stompClient && stompClient.active ? 'reconnecting' : 'offline');
    },
    onDisconnect: () => {
      console.log('[STOMP] Disconnected');
    },
  });

  setStatus('connecting');
  stompClient.activate();
  return stompClient;
}

/**
 * Subscribe to a STOMP destination. Works before the socket is connected and survives
 * reconnects. Returns a handle for unsubscribe().
 */
export function subscribe(destination, callback) {
  const entry = { id: nextId++, destination, callback, sub: null };
  registry.set(entry.id, entry);
  attach(entry);
  return entry;
}

/** Unsubscribe a handle returned by subscribe(). */
export function unsubscribe(handle) {
  if (!handle) return;
  const entry = registry.get(handle.id);
  if (!entry) return;
  try { entry.sub && entry.sub.unsubscribe(); } catch (e) { /* ignore */ }
  registry.delete(handle.id);
}

/**
 * Send a STOMP message. Returns true if it was handed to the socket.
 */
export function sendMessage(destination, body) {
  if (!stompClient || !stompClient.connected) {
    console.warn('[STOMP] Not connected, cannot send to', destination);
    return false;
  }
  stompClient.publish({ destination, body: JSON.stringify(body) });
  return true;
}

/** Disconnect and forget every subscription (logout). */
export function disconnectWebSocket() {
  registry.forEach(entry => { try { entry.sub && entry.sub.unsubscribe(); } catch (e) { /* ignore */ } });
  registry.clear();
  if (stompClient) {
    const c = stompClient;
    stompClient = null;
    c.deactivate();
  }
  setStatus('offline');
}

/** Reconnect with the current token (e.g. after a token refresh), keeping subscriptions. */
export function reconnectWebSocket() {
  if (!stompClient) return;
  const keep = new Map(registry);
  const c = stompClient;
  stompClient = null;
  keep.forEach(entry => { entry.sub = null; });
  c.deactivate().finally(() => {
    connectWebSocket();
  });
}

export function isConnected() {
  return !!(stompClient && stompClient.connected);
}

export function getStatus() {
  return status;
}

/** Listen for connection status changes; returns an unsubscribe function. */
export function onStatus(listener) {
  statusListeners.add(listener);
  listener(status);
  return () => statusListeners.delete(listener);
}
