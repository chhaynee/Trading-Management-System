import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performanceSummary, performanceGroups } from '../js/performance-model.js';

test('cash summary signs magnitudes and excludes unfinished trades', () => {
  const actual = performanceSummary([
    { result: 'win', amount: 120 },
    { result: 'win', amount: '-30' },
    { result: 'loss', amount: -50 },
    { result: 'be', amount: 999 },
    { result: 'open', amount: 900 },
    { amount: 800 },
  ]);
  assert.deepEqual(actual, {
    total: 4, wins: 2, losses: 1, breakeven: 1,
    measuredCount: 4, missingAmounts: 0, pnl: 100, expectancy: 25,
    winRate: 200 / 3, profitFactor: 3, noLosses: false,
  });
});

test('unknown cash is excluded from expectancy while all closed outcomes count', () => {
  const actual = performanceSummary([
    { result: 'win', amount: 100 }, { result: 'win' },
    { result: 'loss', amount: '' }, { result: 'loss', amount: null },
    { result: 'be' },
  ]);
  assert.deepEqual(actual, {
    total: 5, wins: 2, losses: 2, breakeven: 1,
    measuredCount: 2, missingAmounts: 3, pnl: 100, expectancy: 50,
    winRate: 50, profitFactor: null, noLosses: true,
  });
});

test('cash accepts finite decimal values and rejects partial or coerced numbers', () => {
  const cases = [
    [0, 0], ['0', 0], [' -12.5 ', 12.5], ['.5', 0.5], ['1.2e2', 120],
    [undefined, null], [null, null], ['', null], ['   ', null],
    ['12 dollars', null], ['1,200', null], ['0x10', null], ['0b11', null],
    [true, null], [false, null], [[], null], [[10], null], [{}, null],
    [NaN, null], [Infinity, null], [-Infinity, null], ['Infinity', null], ['1e999', null],
  ];
  for (const [amount, expected] of cases) {
    const actual = performanceSummary([{ result: 'win', amount }]);
    assert.equal(actual.pnl, expected, `P&L for ${String(amount)}`);
    assert.equal(actual.measuredCount, expected === null ? 0 : 1);
    assert.equal(actual.missingAmounts, expected === null ? 1 : 0);
  }
});

test('empty and unknown-only samples have null cash metrics', () => {
  assert.deepEqual(performanceSummary([]), {
    total: 0, wins: 0, losses: 0, breakeven: 0,
    measuredCount: 0, missingAmounts: 0, pnl: null, expectancy: null,
    winRate: null, profitFactor: null, noLosses: false,
  });
  const actual = performanceSummary([{ result: 'win' }, { result: 'loss', amount: 'bad' }]);
  assert.equal(actual.pnl, null);
  assert.equal(actual.expectancy, null);
  assert.equal(actual.winRate, 50);
  assert.equal(actual.profitFactor, null);
  assert.equal(actual.noLosses, false);
});

test('breakeven is known zero and has no decisive win rate or profit factor', () => {
  const actual = performanceSummary([{ result: 'be' }, { result: 'be', amount: 'invalid' }]);
  assert.deepEqual(actual, {
    total: 2, wins: 0, losses: 0, breakeven: 2,
    measuredCount: 2, missingAmounts: 0, pnl: 0, expectancy: 0,
    winRate: null, profitFactor: null, noLosses: false,
  });
});

test('profit factor distinguishes measured losses, only winners, and zero cash', () => {
  const cases = [
    [[{ result: 'win', amount: 20 }], null, true],
    [[{ result: 'loss', amount: 20 }], 0, false],
    [[{ result: 'win', amount: 0 }], null, false],
    [[{ result: 'win', amount: 20 }, { result: 'loss', amount: 0 }], null, true],
    [[{ result: 'loss', amount: 20 }, { result: 'win' }], 0, false],
  ];
  for (const [trades, factor, noLosses] of cases) {
    const actual = performanceSummary(trades);
    assert.equal(actual.profitFactor, factor);
    assert.equal(actual.noLosses, noLosses);
  }
});

test('strategy groups count each membership once and retain legacy or missing references', () => {
  const trades = [
    { result: 'win', amount: 100, strategyIds: ['s1', 's2', 's1'] },
    { result: 'loss', amount: 30, strategyId: 's1' },
    { result: 'win', amount: 20, strategyIds: ['deleted'] },
    { result: 'be', strategyIds: [] },
    { result: 'win', amount: 10, strategyIds: ['', null], strategyId: 's2' },
    { result: 'open', amount: 999, strategyIds: ['open-only'] },
  ];
  const groups = performanceGroups(trades, 'strategy', [{ id: 's1', name: 'Alpha' }, { id: 's2', name: 'Beta' }]);
  assert.deepEqual(groups.map(({ id, label, total, pnl }) => ({ id, label, total, pnl })), [
    { id: 'strategy:s2', label: 'Beta', total: 2, pnl: 110 },
    { id: 'strategy:s1', label: 'Alpha', total: 2, pnl: 70 },
    { id: 'strategy:deleted', label: 'Unknown strategy (deleted)', total: 1, pnl: 20 },
    { id: 'strategy:', label: 'Unassigned strategy', total: 1, pnl: 0 },
  ]);
  assert.equal(performanceSummary(trades).total, 5);
});

test('group order uses descending recorded P&L then label with unknown cash last', () => {
  const groups = performanceGroups([
    { result: 'win', amount: 10, instrument: 'Zinc' },
    { result: 'win', amount: 10, instrument: 'Gold' },
    { result: 'loss', amount: 20, instrument: 'Silver' },
    { result: 'win', instrument: 'Copper' },
    { result: 'be' },
    { result: 'open', instrument: 'Open only', amount: 100 },
  ], 'instrument');
  assert.deepEqual(groups.map(group => [group.label, group.total, group.pnl]), [
    ['Gold', 1, 10], ['Zinc', 1, 10], ['Unknown instrument', 1, 0], ['Silver', 1, -20], ['Copper', 1, null],
  ]);
});

test('direction groups keep unrecognized direction separate from long and short', () => {
  const groups = performanceGroups([
    { result: 'win', amount: 30, direction: 'long' },
    { result: 'loss', amount: 10, direction: 'short' },
    { result: 'be', direction: 'sideways' },
    { result: 'be' },
  ], 'direction');
  assert.deepEqual(groups.map(group => [group.label, group.total, group.pnl]), [
    ['Long', 1, 30], ['Unknown direction', 2, 0], ['Short', 1, -10],
  ]);
});

test('weekdays use local calendar dates and missing dates never become epoch dates', () => {
  const groups = performanceGroups([
    { result: 'win', amount: 50, entryDate: '2026-11-02' },
    { result: 'win', amount: 20, createdAt: new Date(2026, 10, 3, 15).getTime() },
    { result: 'win', amount: 10, entryDate: new Date(2026, 10, 2, 9).toISOString() },
    { result: 'loss', amount: 5, entryDate: '2026-02-30' },
    { result: 'be' },
    { result: 'be', entryDate: Infinity },
    { result: 'be', entryDate: 'nonsense', createdAt: new Date(2026, 10, 2).getTime() },
    { result: 'be', entryDate: '0' },
    { result: 'be', entryDate: '2026-02-30T12:00:00Z' },
  ], 'weekday');
  assert.deepEqual(groups.map(group => [group.label, group.total, group.pnl]), [
    ['Monday', 2, 60], ['Tuesday', 1, 20], ['Unknown date', 6, -5],
  ]);
});

test('grouping leaves frozen trades, memberships and strategy records unchanged', () => {
  const trades = Object.freeze([
    Object.freeze({ result: 'loss', amount: 10, strategyIds: Object.freeze(['b', 'a', 'b']) }),
    Object.freeze({ result: 'win', amount: 30, strategyIds: Object.freeze(['a']) }),
  ]);
  const strategies = Object.freeze([Object.freeze({ id: 'a', name: 'Alpha' })]);
  const before = JSON.stringify({ trades, strategies });
  const groups = performanceGroups(trades, 'strategy', strategies);
  assert.deepEqual(groups.map(group => [group.id, group.total, group.pnl]), [
    ['strategy:a', 2, 20], ['strategy:b', 1, -10],
  ]);
  assert.equal(JSON.stringify({ trades, strategies }), before);
});

test('empty grouping returns no fabricated comparison rows', () => {
  assert.deepEqual(performanceGroups([], 'instrument'), []);
  assert.deepEqual(performanceGroups([{ result: 'open', amount: 10 }], 'strategy'), []);
});
