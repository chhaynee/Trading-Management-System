import { ACCOUNT_TYPES, ACCOUNT_STATUSES } from './utils.js';

export function accountStatus(account) {
  return Object.hasOwn(ACCOUNT_STATUSES, account.status) ? account.status : 'active';
}

export function canSelectAccount(account) {
  return !['passed', 'blown'].includes(accountStatus(account));
}

export function accountPnl(account) {
  return (Number(account.capital) || 0) - (Number(account.startingCapital) || 0);
}

export function accountPhase(account) {
  return account.type === 'prop-challenge' ? (account.phase || '') : '';
}

export const ACCOUNT_PHASES = { phase1: 'Phase 1', phase2: 'Phase 2', funded: 'Funded' };

/** Filters compose, and sorting never changes the portfolio's saved order. */
export function filterAccounts(accounts, filters = {}, strategies = []) {
  const strategyNames = new Map(strategies.map(strategy => [strategy.id, strategy.name]));
  const words = (filters.search || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = accounts.filter(account => {
    const status = accountStatus(account);
    const phase = accountPhase(account);
    if (filters.status && filters.status !== 'all' && status !== filters.status) return false;
    if (filters.type && filters.type !== 'all' && account.type !== filters.type) return false;
    if (filters.company && filters.company !== 'all' && ![account.company, account.broker].includes(filters.company)) return false;
    if (filters.phase && filters.phase !== 'all' && (phase || 'none') !== filters.phase) return false;
    if (filters.strategy && filters.strategy !== 'all' && !(account.strategyIds || []).includes(filters.strategy)) return false;
    if (!words.length) return true;
    const text = [account.name, account.displayName, account.company, account.broker, account.accountNumber,
      account.id, account.tier, ACCOUNT_TYPES[account.type]?.label, ACCOUNT_STATUSES[status].label,
      ACCOUNT_PHASES[phase] || phase, ...(account.strategyIds || []).map(id => strategyNames.get(id))]
      .filter(Boolean).join(' ').toLocaleLowerCase();
    return words.every(word => text.includes(word));
  });
  const byName = (a, b) => (a.displayName || a.name || '').localeCompare(b.displayName || b.name || '', undefined, { numeric: true });
  const sorters = {
    newest: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    oldest: (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
    name: byName,
    'balance-high': (a, b) => (Number(b.capital) || 0) - (Number(a.capital) || 0),
    'pnl-high': (a, b) => accountPnl(b) - accountPnl(a),
    'pnl-low': (a, b) => accountPnl(a) - accountPnl(b),
  };
  return matches.sort(sorters[filters.sort] || sorters.newest);
}
