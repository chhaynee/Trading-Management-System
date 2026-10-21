import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayBoundary, entryTimestamp, localDateValue, periodRange, reviewTrades, signedPnl, signedR, reviewMetrics, balanceAdjustments } from '../js/review-model.js';

test('P&L uses the result sign and never treats account capital as profit', () => {
  assert.equal(signedPnl({ result: 'loss', amount: -125 }), -125);
  assert.equal(signedPnl({ result: 'win', amount: '-80.5' }), 80.5);
  assert.equal(signedPnl({ result: 'be', amount: 20 }), 0);
  assert.equal(signedPnl({ result: 'open', amount: 20 }), 0);
});

test('R includes signed losses and breakeven; missing winning R is unknown', () => {
  assert.equal(signedR({ result: 'loss', rAchieved: 2 }), -2);
  assert.equal(signedR({ result: 'loss', rAchieved: 0 }), -1);
  assert.equal(signedR({ result: 'be', rAchieved: 3 }), 0);
  assert.equal(signedR({ result: 'win', rAchieved: -2.5 }), 2.5);
  assert.equal(signedR({ result: 'win' }), null);
  assert.equal(signedR({ result: 'open', rAchieved: 2 }), null);
});

test('closed trade metrics exclude breakeven from win rate and unknown R from average', () => {
  const metrics = reviewMetrics([
    { result: 'win', amount: 100, rAchieved: 2 },
    { result: 'win', amount: 50 },
    { result: 'loss', amount: 30 },
    { result: 'be', amount: 500 },
    { result: 'open', amount: 900, rAchieved: 9 },
  ]);
  assert.equal(metrics.pnl, 120);
  assert.equal(metrics.total, 4);
  assert.ok(Math.abs(metrics.winRate - 200 / 3) < 1e-10);
  assert.equal(metrics.averageR, 1 / 3);
  assert.equal(metrics.rCount, 3);
  assert.equal(metrics.assumedLosses, 1);
  assert.equal(reviewMetrics([{ result: 'be' }]).winRate, null);
});

test('date filters include the whole local day and prefer entryDate over createdAt', () => {
  const day = '2026-10-21';
  const start = new Date(2026, 9, 21).getTime();
  const end = new Date(2026, 9, 22).getTime() - 1;
  assert.equal(dayBoundary(day), start);
  assert.equal(dayBoundary(day, true), end);
  assert.equal(dayBoundary('2026-02-30'), null);
  assert.equal(entryTimestamp({ entryDate: day, createdAt: 1 }), start);
  const trades = [
    { id: 'before', entryDate: start - 1 }, { id: 'start', entryDate: start },
    { id: 'end', entryDate: end }, { id: 'after', entryDate: end + 1 },
  ];
  assert.deepEqual(reviewTrades(trades, { from: day, to: day }).map(trade => trade.id), ['end', 'start']);
  assert.deepEqual(reviewTrades(trades, { from: '2026-10-22', to: day }), []);
});

test('search joins account aliases, strategy names, notes and tags without mutating records', () => {
  const trades = [Object.freeze({ id: 'a', accountId: 'account-a', strategyId: 'legacy', instrument: 'XAU/USD', description: 'London sweep', tags: ['patient'], result: 'win' })];
  const context = { accounts: [{ id: 'account-a', displayName: 'Gold desk', accountNumber: '9912' }], strategies: [{ id: 'legacy', name: 'Sniper' }] };
  assert.equal(reviewTrades(trades, { search: 'gold sniper patient 9912' }, context).length, 1);
  assert.equal(reviewTrades(trades, { search: 'missing' }, context).length, 0);
  assert.equal(reviewTrades(trades, { strategy: 'legacy', account: 'account-a', result: 'win', instrument: 'XAU/USD' }, context).length, 1);
});

test('sorts remain stable, sign losses correctly, and put unknown R last', () => {
  const trades = [{ id: 'loss', result: 'loss', amount: 20 }, { id: 'unknown', result: 'win', amount: 40 }, { id: 'win', result: 'win', amount: 40, rAchieved: 2 }];
  assert.deepEqual(reviewTrades(trades, { sort: 'pnl-high' }).map(t => t.id), ['unknown', 'win', 'loss']);
  assert.deepEqual(reviewTrades(trades, { sort: 'r-low' }).map(t => t.id), ['loss', 'win', 'unknown']);
  assert.deepEqual(trades.map(t => t.id), ['loss', 'unknown', 'win']);
});

test('quick ranges use calendar days across month and year boundaries', () => {
  const now = new Date(2026, 0, 3, 23, 45).getTime();
  assert.deepEqual(periodRange('7d', now), { from: '2025-12-28', to: '2026-01-03' });
  assert.deepEqual(periodRange('month', now), { from: '2026-01-01', to: '2026-01-03' });
  assert.deepEqual(periodRange('all', now), { from: '', to: '' });
  assert.equal(localDateValue(new Date(2026, 9, 21, 1)), '2026-10-21');
});

test('balance retries skip completed steps and allow a revised amount or account', () => {
  const applied = new Map([['old', 100]]);
  assert.deepEqual(balanceAdjustments(applied, 'new', -25), [
    { accountId: 'old', delta: -100, contribution: 0 },
    { accountId: 'new', delta: -25, contribution: -25 },
  ]);
  // Old-account reversal succeeded before the new-account request failed.
  applied.set('old', 0);
  assert.deepEqual(balanceAdjustments(applied, 'new', -25), [{ accountId: 'new', delta: -25, contribution: -25 }]);
  applied.set('new', -25);
  assert.deepEqual(balanceAdjustments(applied, 'new', -40), [{ accountId: 'new', delta: -15, contribution: -40 }]);
  assert.deepEqual(balanceAdjustments(applied, 'new', -25), []);
  assert.deepEqual(balanceAdjustments(applied), [{ accountId: 'new', delta: 25, contribution: 0 }]);
});
