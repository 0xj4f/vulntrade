import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';

// VULN: WebSocket URL hardcoded and exposed
// SockJS requires http:// not ws:// - uses nginx proxy path
const WS_URL = process.env.REACT_APP_WS_SOCKJS_URL || '/ws-sockjs';
const API_URL = process.env.REACT_APP_API_URL || '';

/**
 * STOMP sockets.
 *
 * - The platform socket (/ws-sockjs): account, history, alerts and admin messages.
 * - One socket per product gateway (/api/<product>/ws-sockjs, product = equities | crypto | fx):
 *   prices, order books, trades and orders. Created the first time something uses it.
 *
 * Every socket works the same way:
 * - subscribe() remembers every subscription and re-subscribes after each reconnect, so a
 *   dropped socket doesn't silently stop the price feed or order updates.
 * - Subscribing before the socket is up is fine: it's applied on connect.
 * - onStatus() reports 'connecting' | 'live' | 'reconnecting' | 'offline'.
 * - send() returns false when the socket is down, so callers don't claim success.
 *
 * The exported functions without a `product` argument use the platform socket (as before).
 */
function createSocket(name, url) {
  let stompClient = null;
  let status = 'offline';
  let nextId = 1;
  const registry = new Map();          // id -> { id, destination, callback, sub, socket }
  const statusListeners = new Set();
  const socket = {};

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
   * Connect (idempotent).
   * VULN: Token sent in STOMP headers (visible in network tab).
   */
  socket.connect = (onConnect, onError) => {
    if (stompClient) return stompClient;
    const token = localStorage.getItem('token'); // VULN: from localStorage

    stompClient = new Client({
      webSocketFactory: () => new SockJS(url),
      connectHeaders: {
        Authorization: token ? 'Bearer ' + token : '',
        token: token || '', // VULN: also sent as plain header
      },
      debug: (str) => {
        console.log(`[STOMP ${name}]`, str); // VULN: debug logging in production
      },
      reconnectDelay: 3000,
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000,
      onConnect: (frame) => {
        console.log(`[STOMP ${name}] Connected:`, frame);
        registry.forEach(attach);              // (re)subscribe everything
        setStatus('live');
        if (onConnect) onConnect(frame);
      },
      onStompError: (frame) => {
        console.error(`[STOMP ${name}] Error:`, frame);
        if (onError) onError(frame);
      },
      onWebSocketClose: () => {
        registry.forEach(entry => { entry.sub = null; });
        setStatus(stompClient && stompClient.active ? 'reconnecting' : 'offline');
      },
      onDisconnect: () => {
        console.log(`[STOMP ${name}] Disconnected`);
      },
    });

    setStatus('connecting');
    stompClient.activate();
    return stompClient;
  };

  socket.subscribe = (destination, callback) => {
    const entry = { id: nextId++, destination, callback, sub: null, socket };
    registry.set(entry.id, entry);
    attach(entry);
    return entry;
  };

  socket.unsubscribe = (handle) => {
    const entry = registry.get(handle.id);
    if (!entry) return;
    try { entry.sub && entry.sub.unsubscribe(); } catch (e) { /* ignore */ }
    registry.delete(handle.id);
  };

  socket.send = (destination, body) => {
    if (!stompClient || !stompClient.connected) {
      console.warn(`[STOMP ${name}] Not connected, cannot send to`, destination);
      return false;
    }
    stompClient.publish({ destination, body: JSON.stringify(body) });
    return true;
  };

  /** Disconnect and forget every subscription (logout). */
  socket.disconnect = () => {
    registry.forEach(entry => { try { entry.sub && entry.sub.unsubscribe(); } catch (e) { /* ignore */ } });
    registry.clear();
    if (stompClient) {
      const c = stompClient;
      stompClient = null;
      c.deactivate();
    }
    setStatus('offline');
  };

  /** Reconnect with the current token (e.g. after a token refresh), keeping subscriptions. */
  socket.reconnect = () => {
    if (!stompClient) return;
    const c = stompClient;
    stompClient = null;
    registry.forEach(entry => { entry.sub = null; });
    c.deactivate().finally(() => {
      socket.connect();
    });
  };

  socket.isConnected = () => !!(stompClient && stompClient.connected);
  socket.getStatus = () => status;
  socket.onStatus = (listener) => {
    statusListeners.add(listener);
    listener(status);
    return () => statusListeners.delete(listener);
  };

  return socket;
}

const platform = createSocket('platform', WS_URL);
const products = {};                     // 'equities' | 'crypto' | 'fx' -> socket

/** Stocks have no suffix (AAPL); crypto pairs end in -USD (BTC-USD). */
export function productOf(symbol) {
  return String(symbol || '').endsWith('-USD') ? 'crypto' : 'equities';
}

/** The socket of one product gateway, created and connected on first use. */
export function productSocket(product) {
  if (!products[product]) {
    products[product] = createSocket(product, `${API_URL}/api/${product}/ws-sockjs`);
  }
  products[product].connect();
  return products[product];
}

function socketFor(product) {
  return product ? productSocket(product) : platform;
}

/** Connect the platform socket (idempotent). */
export function connectWebSocket(onConnect, onError) {
  return platform.connect(onConnect, onError);
}

/**
 * Subscribe to a STOMP destination on the platform socket, or on a product socket when
 * `product` is given. Works before the socket is connected and survives reconnects.
 * Returns a handle for unsubscribe().
 */
export function subscribe(destination, callback, product) {
  return socketFor(product).subscribe(destination, callback);
}

/** Unsubscribe a handle returned by subscribe(). */
export function unsubscribe(handle) {
  if (!handle || !handle.socket) return;
  handle.socket.unsubscribe(handle);
}

/** Send a STOMP message (platform socket, or a product socket). Returns true if it was handed to the socket. */
export function sendMessage(destination, body, product) {
  return socketFor(product).send(destination, body);
}

/** Disconnect every socket and forget every subscription (logout). */
export function disconnectWebSocket() {
  platform.disconnect();
  Object.values(products).forEach(s => s.disconnect());
}

/** Reconnect every socket with the current token (e.g. after a token refresh), keeping subscriptions. */
export function reconnectWebSocket() {
  platform.reconnect();
  Object.values(products).forEach(s => s.reconnect());
}

export function isConnected() {
  return platform.isConnected();
}

export function getStatus() {
  return platform.getStatus();
}

/** Listen for platform connection status changes; returns an unsubscribe function. */
export function onStatus(listener) {
  return platform.onStatus(listener);
}
