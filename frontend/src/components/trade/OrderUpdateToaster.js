import { toast } from 'react-toastify';
import { useAuth } from '../../context/AuthContext';
import { useStomp } from '../../hooks/useStomp';
import { isTracked } from '../../services/orderTracker';
import { fmtPrice, fmtQty } from '../../utils/format';

export const REASON_TEXT = {
  INSUFFICIENT_FUNDS: 'not enough cash when it matched',
  INSUFFICIENT_POSITION: 'not enough shares when it matched',
  NO_LIQUIDITY: 'no liquidity for the remainder',
};

/**
 * Listens to /user/queue/order-updates on the equities and crypto sockets for the whole
 * session: toasts fills of resting orders and engine cancels, refreshes the balance, and
 * re-broadcasts each update as a `vt:order-update` window event so pages can refresh what
 * they show.
 */
export default function OrderUpdateToaster() {
  const { refreshUser } = useAuth();
  const onUpdate = (u) => {
    if (!u || u.type !== 'ORDER_UPDATE') return;
    window.dispatchEvent(new CustomEvent('vt:order-update', { detail: u }));
    refreshUser && refreshUser();
    if (isTracked(u.clientOrderId)) return;
    const what = `${u.side === 'BUY' ? 'Buy' : 'Sell'} ${fmtQty(u.quantity)} ${u.symbol}`;
    if (u.status === 'FILLED') {
      toast.success(`${what} filled @ ${fmtPrice(u.avgFillPrice)}`);
    } else if (u.status === 'PARTIAL') {
      toast.info(`${what}: ${fmtQty(u.filledQty)} filled @ ${fmtPrice(u.avgFillPrice)}, ${fmtQty(u.remainingQty)} working`);
    } else if (u.status === 'CANCELLED') {
      const why = REASON_TEXT[u.reason];
      (why ? toast.warn : toast.info)(`${what} cancelled${why ? ` — ${why}` : ''}`);
    }
  };
  useStomp('/user/queue/order-updates', onUpdate, 'equities');
  useStomp('/user/queue/order-updates', onUpdate, 'crypto');
  return null;
}
