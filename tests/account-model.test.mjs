import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountStatus, accountPhase, accountPnl, filterAccounts } from '../js/account-model.js';

const accounts = Object.freeze([
  Object.freeze({ id: 'first', name: 'Challenge 10', displayName: 'Gold desk', company: 'Firm A', accountNumber: '009912', type: 'prop-challenge', phase: 'phase1', status: 'active', capital: 900, startingCapital: 1000, createdAt: 10, strategyIds: ['sniper'] }),
  Object.freeze({ id: 'passed', name: 'Challenge 2', company: 'Firm A', type: 'prop-challenge', phase: 'phase2', status: 'passed', capital: 1080, startingCapital: 1000, createdAt: 20, strategyIds: ['sniper'] }),
  Object.freeze({ id: 'blown', name: 'Closed', company: 'Firm B', type: 'prop-challenge', phase: 'phase1', status: 'blown', capital: 950, startingCapital: 1000, createdAt: 30 }),
  Object.freeze({ id: 'funded', name: 'Instant', company: 'Firm B', broker: 'Broker C', type: 'prop-instant', phase: 'phase1', status: 'funded', capital: 2000, startingCapital: 2000, createdAt: 40 }),
  Object.freeze({ id: 'legacy', name: 'Personal', type: 'own-funds', capital: 50, startingCapital: 100, createdAt: 50 }),
]);
const ids = filters => filterAccounts(accounts, filters, [{ id: 'sniper', name: 'Patient entry' }]).map(a => a.id);

test('account outcomes use the saved status, independently of balance and challenge phase', () => {
  assert.equal(accountStatus(accounts[2]), 'blown');
  assert.equal(accountStatus({ status: 'active', capital: 0, startingCapital: 1000 }), 'active');
  assert.equal(accountStatus(accounts[4]), 'active');
  assert.equal(accountStatus({ status: 'unrecognized' }), 'active');
  assert.equal(accountPhase(accounts[3]), '');
  assert.equal(accountPnl(accounts[0]), -100);
});

test('status, type, company, phase and strategy filters compose without modifying records', () => {
  assert.deepEqual(ids({ status: 'passed', type: 'prop-challenge', company: 'Firm A', phase: 'phase2', strategy: 'sniper' }), ['passed']);
  assert.deepEqual(ids({ status: 'blown', company: 'Firm A' }), []);
  assert.deepEqual(ids({ strategy: 'sniper' }), ['passed', 'first']);
  assert.deepEqual(ids({ phase: 'none' }), ['legacy', 'funded']);
  assert.deepEqual(ids({ company: 'Broker C' }), ['funded']);
  assert.deepEqual(ids({ status: 'paused' }), []);
});

test('search finds aliases, original names, full numbers, status, phase and linked strategies', () => {
  assert.deepEqual(ids({ search: '  GOLD 009912 patient  ' }), ['first']);
  assert.deepEqual(ids({ search: 'CHALLENGE passed phase 2' }), ['passed']);
  assert.deepEqual(ids({ search: 'Firm B blown' }), ['blown']);
  assert.deepEqual(ids({ search: 'missing' }), []);
  assert.equal(ids({ search: '   ' }).length, accounts.length);
});

test('sorts compare balances and signed P&L and preserve the input order', () => {
  assert.deepEqual(ids({ sort: 'newest' }), ['legacy', 'funded', 'blown', 'passed', 'first']);
  assert.deepEqual(ids({ sort: 'oldest' }), ['first', 'passed', 'blown', 'funded', 'legacy']);
  assert.deepEqual(ids({ sort: 'balance-high' }), ['funded', 'passed', 'blown', 'first', 'legacy']);
  assert.deepEqual(ids({ sort: 'pnl-high' }), ['passed', 'funded', 'blown', 'legacy', 'first']);
  assert.deepEqual(ids({ sort: 'pnl-low' }), ['first', 'blown', 'legacy', 'funded', 'passed']);
  assert.deepEqual(ids({ sort: 'name' }), ['passed', 'blown', 'first', 'funded', 'legacy']);
  assert.deepEqual(accounts.map(a => a.id), ['first', 'passed', 'blown', 'funded', 'legacy']);
});
