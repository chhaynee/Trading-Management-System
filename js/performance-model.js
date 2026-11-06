/** Pure recorded-trade analytics. No storage, DOM access, or input mutations. */
import { dayBoundary } from './review-model.js';

const CLOSED_RESULTS = new Set(['win', 'loss', 'be']);
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function recordedAmount(value) {
  if (typeof value === 'string') {
    const text = value.trim();
    if (!DECIMAL.test(text)) return null;
    value = Number(text);
  }
  return typeof value === 'number' && Number.isFinite(value) ? Math.abs(value) : null;
}

/**
 * Cash metrics use measured closed outcomes only. Breakeven is known zero;
 * an absent or malformed win/loss amount is unknown, never an inferred zero.
 * Win rate uses every decisive outcome, independent of cash coverage.
 * noLosses describes measured cash, so it may coexist with missingAmounts.
 */
export function performanceSummary(trades) {
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let measuredCount = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  for (const trade of trades) {
    if (!CLOSED_RESULTS.has(trade.result)) continue;
    if (trade.result === 'win') wins++;
    else if (trade.result === 'loss') losses++;
    else breakeven++;

    const amount = trade.result === 'be' ? 0 : recordedAmount(trade.amount);
    if (amount === null) continue;
    measuredCount++;
    if (trade.result === 'win') grossProfit += amount;
    else if (trade.result === 'loss') grossLoss += amount;
  }
  const total = wins + losses + breakeven;
  const pnl = measuredCount ? grossProfit - grossLoss : null;
  return {
    total, wins, losses, breakeven,
    measuredCount,
    missingAmounts: total - measuredCount,
    pnl,
    expectancy: measuredCount ? pnl / measuredCount : null,
    winRate: wins + losses ? wins * 100 / (wins + losses) : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    noLosses: grossProfit > 0 && grossLoss === 0,
  };
}

function textValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function weekday(trade) {
  // An invalid entry date stays unknown; creation time is only a fallback for
  // an absent entry date. Date-only strings must retain their local calendar day.
  const value = trade.entryDate === null || trade.entryDate === undefined || trade.entryDate === ''
    ? trade.createdAt : trade.entryDate;
  let timestamp;
  if (typeof value === 'number') timestamp = value;
  else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) {
    const boundary = dayBoundary(value.slice(0, 10));
    if (boundary === null) return null;
    timestamp = value.length === 10 ? boundary : new Date(value).getTime();
  } else return null;
  if (!Number.isFinite(timestamp)) return null;
  const day = new Date(timestamp).getDay();
  return Number.isFinite(day) ? day : null;
}

function memberships(trade, dimension, strategyNames) {
  if (dimension === 'strategy') {
    let ids = Array.isArray(trade.strategyIds) ? trade.strategyIds.map(textValue).filter(Boolean) : [];
    if (!ids.length && textValue(trade.strategyId)) ids = [textValue(trade.strategyId)];
    return ids.length
      ? [...new Set(ids)].map(id => ({ id: `strategy:${id}`, label: strategyNames.get(id) || `Unknown strategy (${id})` }))
      : [{ id: 'strategy:', label: 'Unassigned strategy' }];
  }
  if (dimension === 'weekday') {
    const day = weekday(trade);
    return [{ id: `weekday:${day ?? ''}`, label: day === null ? 'Unknown date' : WEEKDAYS[day] }];
  }
  if (dimension === 'direction') {
    const direction = trade.direction === 'long' || trade.direction === 'short' ? trade.direction : '';
    return [{ id: `direction:${direction}`, label: direction === 'long' ? 'Long' : direction === 'short' ? 'Short' : 'Unknown direction' }];
  }
  const instrument = textValue(trade.instrument);
  return [{ id: `instrument:${instrument}`, label: instrument || 'Unknown instrument' }];
}

/**
 * A trade belongs once to each distinct strategy, and once overall. Strategy
 * group totals can therefore overlap. Unknown cash sorts after measured cash.
 */
export function performanceGroups(trades, dimension, strategies = []) {
  const strategyNames = new Map(strategies.map(strategy => [strategy.id, textValue(strategy.name)]));
  const groups = new Map();
  for (const trade of trades) {
    if (!CLOSED_RESULTS.has(trade.result)) continue;
    for (const { id, label } of memberships(trade, dimension, strategyNames)) {
      if (!groups.has(id)) groups.set(id, { id, label, trades: [] });
      groups.get(id).trades.push(trade);
    }
  }
  return [...groups.values()]
    .map(({ id, label, trades: members }) => ({ id, label, ...performanceSummary(members) }))
    .sort((a, b) => {
      if (a.pnl === null && b.pnl !== null) return 1;
      if (b.pnl === null && a.pnl !== null) return -1;
      return (b.pnl ?? 0) - (a.pnl ?? 0) || a.label.localeCompare(b.label);
    });
}
