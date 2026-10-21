/** Pure journal review calculations. No storage or record mutations. */
export function entryTimestamp(trade) {
  const value = trade.entryDate || trade.createdAt;
  if (!value) return 0;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return dayBoundary(value);
  }
  const timestamp = typeof value === 'number' ? value : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function localDateValue(value = Date.now()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function dayBoundary(value, end = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  if (end) date.setDate(date.getDate() + 1);
  return date.getTime() - (end ? 1 : 0);
}

export function periodRange(period, now = Date.now()) {
  const today = new Date(now);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (period === 'all') return { from: '', to: '' };
  if (period === 'month') start.setDate(1);
  else if (period === '7d') start.setDate(start.getDate() - 6);
  else if (period === '30d') start.setDate(start.getDate() - 29);
  return { from: localDateValue(start), to: localDateValue(today) };
}

export function signedPnl(trade) {
  const parsed = parseFloat(trade.amount);
  const amount = Number.isFinite(parsed) ? Math.abs(parsed) : 0;
  return trade.result === 'win' ? amount : trade.result === 'loss' ? -amount : 0;
}

/** Missing loss R assumes a full 1R loss; unknown winning R is excluded. */
export function signedR(trade) {
  const value = parseFloat(trade.rAchieved);
  if (trade.result === 'loss') return -Math.abs(Number.isFinite(value) && value !== 0 ? value : 1);
  if (trade.result === 'be') return 0;
  if (trade.result === 'win' && Number.isFinite(value) && value !== 0) return Math.abs(value);
  return null;
}

/** Reconcile only the contribution still owed after any successful earlier steps. */
export function balanceAdjustments(applied, accountId = null, contribution = 0) {
  const ids = new Set([...applied.keys(), ...(accountId ? [accountId] : [])]);
  return [...ids].map(id => {
    const target = id === accountId ? contribution : 0;
    return { accountId: id, delta: target - (applied.get(id) || 0), contribution: target };
  }).filter(step => step.delta !== 0);
}

function strategyIds(trade) {
  return Array.isArray(trade.strategyIds) && trade.strategyIds.length
    ? trade.strategyIds : trade.strategyId ? [trade.strategyId] : [];
}

export function reviewTrades(trades, filters = {}, { accounts = [], strategies = [] } = {}) {
  const from = dayBoundary(filters.from);
  const to = dayBoundary(filters.to, true);
  const query = (filters.search || '').trim().toLocaleLowerCase();
  const accountMap = new Map(accounts.map(account => [account.id, account]));
  const strategyMap = new Map(strategies.map(strategy => [strategy.id, strategy]));
  const matches = trades.map((trade, index) => ({ trade, index })).filter(({ trade }) => {
    const ids = strategyIds(trade);
    if (filters.strategy && filters.strategy !== 'all' && !ids.includes(filters.strategy)) return false;
    if (filters.account && filters.account !== 'all' && trade.accountId !== filters.account) return false;
    if (filters.result && filters.result !== 'all' && trade.result !== filters.result) return false;
    if (filters.instrument && filters.instrument !== 'all' && trade.instrument !== filters.instrument) return false;
    const timestamp = entryTimestamp(trade);
    if (from !== null && timestamp < from) return false;
    if (to !== null && timestamp > to) return false;
    if (query) {
      const account = accountMap.get(trade.accountId);
      const haystack = [trade.instrument, trade.timeframe, trade.description, trade.direction, trade.result,
        ...(trade.tags || []), account?.name, account?.displayName, account?.accountNumber, trade.accountId,
        ...ids.map(id => strategyMap.get(id)?.name)].filter(Boolean).join(' ').toLocaleLowerCase();
      if (!query.split(/\s+/).every(part => haystack.includes(part))) return false;
    }
    return true;
  });
  const sort = filters.sort || 'newest';
  matches.sort((left, right) => {
    const a = left.trade;
    const b = right.trade;
    let difference = 0;
    if (sort === 'pnl-high') difference = signedPnl(b) - signedPnl(a);
    else if (sort === 'pnl-low') difference = signedPnl(a) - signedPnl(b);
    else if (sort === 'r-high' || sort === 'r-low') {
      const ar = signedR(a);
      const br = signedR(b);
      if (ar === null && br !== null) return 1;
      if (br === null && ar !== null) return -1;
      difference = ar === null ? 0 : sort === 'r-high' ? br - ar : ar - br;
    } else difference = sort === 'oldest' ? entryTimestamp(a) - entryTimestamp(b) : entryTimestamp(b) - entryTimestamp(a);
    return difference || left.index - right.index;
  });
  return matches.map(({ trade }) => trade);
}

export function reviewMetrics(trades) {
  const closed = trades.filter(trade => ['win', 'loss', 'be'].includes(trade.result));
  const wins = closed.filter(trade => trade.result === 'win').length;
  const losses = closed.filter(trade => trade.result === 'loss').length;
  const rs = closed.map(signedR).filter(value => value !== null);
  return {
    total: closed.length, wins, losses,
    breakeven: closed.length - wins - losses,
    pnl: closed.reduce((sum, trade) => sum + signedPnl(trade), 0),
    winRate: wins + losses ? wins / (wins + losses) * 100 : null,
    averageR: rs.length ? rs.reduce((sum, value) => sum + value, 0) / rs.length : null,
    rCount: rs.length,
    assumedLosses: closed.filter(trade => trade.result === 'loss' && !(parseFloat(trade.rAchieved))).length,
  };
}
