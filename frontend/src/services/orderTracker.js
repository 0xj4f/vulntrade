/**
 * Orders this tab just submitted (by clientOrderId). Their first ORDER_UPDATE is covered by
 * the request/reply toast, so the global toaster skips it; later updates (a resting order
 * filling minutes later, an auto-cancel) are toasted normally.
 */
const pending = new Map(); // clientOrderId -> expiry

export function trackClientOrder(clientOrderId) {
  if (clientOrderId) pending.set(clientOrderId, Date.now() + 15000);
}

export function settleClientOrder(clientOrderId) {
  pending.delete(clientOrderId);
}

export function isTracked(clientOrderId) {
  if (!clientOrderId) return false;
  const exp = pending.get(clientOrderId);
  if (!exp) return false;
  if (exp < Date.now()) { pending.delete(clientOrderId); return false; }
  return true;
}

export function newClientOrderId(prefix = 'web') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
