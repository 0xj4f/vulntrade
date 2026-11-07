import { useEffect, useRef, useState } from 'react';
import { subscribe, unsubscribe, onStatus } from '../services/websocketService';

/**
 * Subscribe to a STOMP destination for the lifetime of the component.
 * The latest handler is always used, so it can close over fresh state without re-subscribing.
 */
export function useStomp(destination, handler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!destination) return undefined;
    const handle = subscribe(destination, (msg) => handlerRef.current && handlerRef.current(msg));
    return () => unsubscribe(handle);
  }, [destination]);
}

/** 'connecting' | 'live' | 'reconnecting' | 'offline' */
export function useConnectionStatus() {
  const [status, setStatus] = useState('offline');
  useEffect(() => onStatus(setStatus), []);
  return status;
}
