import { useEffect, useRef, useState } from 'react';
import { subscribe, unsubscribe, onStatus } from '../services/websocketService';

/**
 * Subscribe to a STOMP destination for the lifetime of the component.
 * The latest handler is always used, so it can close over fresh state without re-subscribing.
 * `product` ('equities' | 'crypto' | 'fx') picks that gateway's socket; leave it out for the
 * platform socket.
 */
export function useStomp(destination, handler, product) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!destination) return undefined;
    const handle = subscribe(destination, (msg) => handlerRef.current && handlerRef.current(msg), product);
    return () => unsubscribe(handle);
  }, [destination, product]);
}

/** 'connecting' | 'live' | 'reconnecting' | 'offline' */
export function useConnectionStatus() {
  const [status, setStatus] = useState('offline');
  useEffect(() => onStatus(setStatus), []);
  return status;
}
