/**
 * store.js — In-memory cache over db.js. Modules subscribe to change events
 * so dashboards, lists, and detail views stay in sync after any CRUD op.
 */

import { db, uid } from './db.js';
import { updateStorageStatus } from './storage-status.js';

export const data = {
  accounts:   [],
  strategies: [],
  journals:  [],
  plans:      [],
  checks:     [],
  activeAccountId: null,
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify(type) { listeners.forEach(fn => fn(type)); }

export async function loadAll() {
  // Each collection loads independently — a failure on the new trade_plans/checks
  // endpoints (e.g. older server without those routes) must NOT wipe the existing
  // accounts/strategies/journals from the UI.
  const failures = [];
  const fallback = { accounts: data.accounts, strategies: data.strategies, journals: data.journals, trade_plans: data.plans, checks: data.checks };
  const safe = (store) => db.getAll(store).catch(err => {
    console.warn(`[store] failed to load ${store}:`, err.message);
    failures.push(store);
    updateStorageStatus({ connected: false, state: 'offline', error: 'Could not load your saved data. Your existing records have been kept.' });
    return fallback[store];
  });
  const [a, s, b, p, c] = await Promise.all([
    safe('accounts'),
    safe('strategies'),
    safe('journals'),
    safe('trade_plans'),
    safe('checks'),
  ]);
  data.accounts   = (a || []).sort((x,y) => (y.createdAt||0) - (x.createdAt||0));
  data.strategies = (s || []).sort((x,y) => (y.createdAt||0) - (x.createdAt||0));
  data.journals   = (b || []).sort((x,y) => (y.createdAt||0) - (x.createdAt||0));
  data.plans      = (p || []).sort((x,y) => (y.createdAt||0) - (x.createdAt||0));
  data.checks     = (c || []).sort((x,y) => (x.position||0) - (y.position||0));
  const preferred = localStorage.getItem('tms-active-account');
  data.activeAccountId = data.accounts.some(account => account.id === preferred) ? preferred : (data.accounts[0]?.id || null);
  notify('all');
  if (failures.length) throw new Error('Some records could not be loaded. Retry your connection; saved data has not been removed.');
}

export function setActiveAccount(id) {
  data.activeAccountId = id;
  localStorage.setItem('tms-active-account', id || '');
  notify('active');
}

export async function saveAccount(obj) {
  if (!obj.id) obj.id = uid();
  await db.put('accounts', obj);
  const i = data.accounts.findIndex(x => x.id === obj.id);
  if (i >= 0) data.accounts[i] = obj; else data.accounts.unshift(obj);
  if (!data.activeAccountId) setActiveAccount(obj.id);
  notify('accounts');
  return obj;
}
export async function deleteAccount(id) {
  await db.del('accounts', id);
  data.accounts = data.accounts.filter(x => x.id !== id);
  // Unlink from strategies' implicit usage and from journals
  data.journals.forEach(b => { if (b.accountId === id) b.accountId = null; });
  if (data.activeAccountId === id) setActiveAccount(data.accounts[0]?.id || null);
  notify('accounts');
}

export async function saveStrategy(obj) {
  if (!obj.id) obj.id = uid();
  await db.put('strategies', obj);
  const i = data.strategies.findIndex(x => x.id === obj.id);
  if (i >= 0) data.strategies[i] = obj; else data.strategies.unshift(obj);
  notify('strategies');
  return obj;
}
export async function deleteStrategy(id) {
  await db.del('strategies', id);
  data.strategies = data.strategies.filter(x => x.id !== id);
  // Remove references from accounts
  for (const a of data.accounts) {
    if (a.strategyIds?.includes(id)) {
      a.strategyIds = a.strategyIds.filter(x => x !== id);
      await db.put('accounts', a);
    }
  }
  // Remove references from journals (multi-strategy field is JSON, not an FK)
  for (const b of data.journals) {
    const ids = journalStrategyIds(b);
    if (ids.includes(id)) {
      const remaining = ids.filter(x => x !== id);
      b.strategyIds = remaining;
      b.strategyId = remaining[0] || null;
      await db.put('journals', b);
    }
  }
  notify('strategies');
}

export async function savejournal(obj) {
  if (!obj.id) obj.id = uid();
  const saved = (await db.put('journals', obj)) || obj;
  const i = data.journals.findIndex(x => x.id === saved.id);
  if (i >= 0) data.journals[i] = saved; else data.journals.unshift(saved);
  notify('journals');
  return saved;
}
export async function deletejournal(id) {
  await db.del('journals', id);
  data.journals = data.journals.filter(x => x.id !== id);
  notify('journals');
}

// ── Derived helpers ──────────────────────────────────────
export function accountById(id)   { return data.accounts.find(a => a.id === id); }
export function strategyById(id)  { return data.strategies.find(s => s.id === id); }
export function activeAccount()   { return accountById(data.activeAccountId); }

// Returns the list of strategy ids attached to a journal entry, falling back
// to the legacy single `strategyId` field for entries written before the
// multi-strategy migration.
export function journalStrategyIds(b) {
  if (b && Array.isArray(b.strategyIds) && b.strategyIds.length) return b.strategyIds;
  return b && b.strategyId ? [b.strategyId] : [];
}

export function journalHasStrategy(b, strategyId) {
  return journalStrategyIds(b).includes(strategyId);
}

export function strategyStats(strategyId) {
  const bt = data.journals.filter(b => journalHasStrategy(b, strategyId));
  const wins = bt.filter(b => b.result === 'win').length;
  const losses = bt.filter(b => b.result === 'loss').length;
  const be = bt.filter(b => b.result === 'be').length;
  const total = bt.length;
  const winRate = total ? (wins / (wins + losses || 1)) * 100 : 0;
  const rs = bt.map(b => parseFloat(b.rAchieved) || 0).filter(r => !isNaN(r));
  const avgR = rs.length ? rs.reduce((a,b) => a+b, 0) / rs.length : 0;
  const winR = bt.filter(b => b.result === 'win').reduce((a,b) => a + (parseFloat(b.rAchieved)||0), 0);
  const lossR = bt.filter(b => b.result === 'loss').reduce((a,b) => a + Math.abs(parseFloat(b.rAchieved)||1), 0);
  const profitFactor = lossR > 0 ? winR / lossR : (winR > 0 ? 99 : 0);
  return { total, wins, losses, be, winRate, avgR, profitFactor };
}

export function accountsUsingStrategy(strategyId) {
  return data.accounts.filter(a => a.strategyIds?.includes(strategyId));
}

// ── Plans CRUD ───────────────────────────────────────────
export async function savePlan(obj) {
  if (!obj.id) obj.id = uid();
  await db.put('trade_plans', obj);
  const i = data.plans.findIndex(x => x.id === obj.id);
  if (i >= 0) data.plans[i] = obj; else data.plans.unshift(obj);
  notify('plans');
  return obj;
}
export async function deletePlan(id) {
  await db.del('trade_plans', id);
  data.plans = data.plans.filter(x => x.id !== id);
  // Server unlinks journals; reflect that locally
  for (const j of data.journals) {
    if (j.planId === id) j.planId = null;
  }
  notify('plans');
}

// Mark a plan as skipped (no journal created)
export async function skipPlan(id) {
  const p = data.plans.find(x => x.id === id);
  if (!p) return;
  const updated = { ...p, status: 'skipped', updatedAt: Date.now() };
  await savePlan(updated);
  return updated;
}

// Link a plan to a journal once executed. Sets discipline_violation if grade was SKIP.
export async function executePlan(planId, journalId) {
  const p = data.plans.find(x => x.id === planId);
  if (!p) return;
  const updated = {
    ...p,
    status: 'executed',
    journalId,
    executedAt: Date.now(),
    disciplineViolation: p.grade === 'SKIP',
  };
  await savePlan(updated);
  return updated;
}

// ── Checks CRUD ──────────────────────────────────────────
export async function saveCheck(obj) {
  if (!obj.id) obj.id = uid();
  await db.put('checks', obj);
  const i = data.checks.findIndex(x => x.id === obj.id);
  if (i >= 0) data.checks[i] = obj; else data.checks.push(obj);
  data.checks.sort((a, b) => (a.position||0) - (b.position||0));
  notify('checks');
  return obj;
}
export async function deleteCheck(id) {
  await db.del('checks', id);
  data.checks = data.checks.filter(x => x.id !== id);
  notify('checks');
}

// ── Plan helpers ─────────────────────────────────────────
export function planById(id) { return data.plans.find(p => p.id === id); }

// Returns global checks ordered by position.
export function globalChecks() {
  return data.checks.filter(c => c.scope === 'global').sort((a, b) => (a.position||0) - (b.position||0));
}

// Returns checks for a specific strategy ordered by position.
export function strategyChecks(strategyId) {
  return data.checks
    .filter(c => c.scope === 'strategy' && c.strategyId === strategyId)
    .sort((a, b) => (a.position||0) - (b.position||0));
}
