import api from './apiService';

/**
 * Every user has four accounts: MAIN (funding: deposits and withdrawals), FX, EQUITIES and
 * CRYPTO. Stocks are bought with EQUITIES USD, coins with CRYPTO USD; money moves between
 * the accounts with a transfer.
 */
export const ACCOUNT_PRODUCTS = ['MAIN', 'FX', 'EQUITIES', 'CRYPTO'];

/** GET /api/accounts -> [{ product, accountId, balances: [{ asset, available, held }] }] */
export function fetchAccounts() {
  return api.get('/api/accounts').then(res => (Array.isArray(res.data?.accounts) ? res.data.accounts : []));
}

/** One balance of one account, as numbers ({ available: 0, held: 0 } when missing). */
export function balanceOf(accounts, product, asset = 'USD') {
  const account = (accounts || []).find(a => a.product === product);
  const row = account && (account.balances || []).find(b => b.asset === asset);
  return { available: Number(row?.available || 0), held: Number(row?.held || 0) };
}
