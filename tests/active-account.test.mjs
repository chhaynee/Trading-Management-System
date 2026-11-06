import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../js/db.js';
import { data, loadAll, saveAccount, deleteAccount, setActiveAccount } from '../js/store.js';
import { canSelectAccount } from '../js/account-model.js';

const fixtures = [
  { id: 'blown', status: 'blown', createdAt: 90 },
  { id: 'passed', status: 'passed', createdAt: 80 },
  { id: 'active', status: 'active', createdAt: 30 },
  { id: 'paused', status: 'paused', createdAt: 20 },
  { id: 'funded', status: 'funded', createdAt: 10 },
];

function setup(t, accounts = fixtures, preferred = null) {
  const values = new Map(preferred ? [['tms-active-account', preferred]] : []);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  } });
  t.mock.method(db, 'getAll', async store => structuredClone(store === 'accounts' ? accounts : []));
  t.mock.method(db, 'put', async (store, record) => record);
  t.mock.method(db, 'del', async () => {});
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
    Object.assign(data, { accounts: [], strategies: [], journals: [], plans: [], checks: [], activeAccountId: null });
  });
  return values;
}

test('only Passed and Blown accounts are excluded from active selection', () => {
  assert.deepEqual(fixtures.filter(canSelectAccount).map(a => a.id), ['active', 'paused', 'funded']);
  assert.equal(canSelectAccount({ id: 'legacy' }), true);
});

test('loading replaces a saved closed or missing selection with an available account', async t => {
  const values = setup(t, fixtures, 'blown');
  await loadAll();
  assert.equal(data.activeAccountId, 'active');
  assert.equal(values.get('tms-active-account'), 'active');
  values.set('tms-active-account', 'deleted');
  await loadAll();
  assert.equal(data.activeAccountId, 'active');
  assert.equal(data.accounts.length, fixtures.length);
});

test('loading preserves an available preference and blocks direct closed-account selection', async t => {
  setup(t, fixtures, 'funded');
  await loadAll();
  assert.equal(data.activeAccountId, 'funded');
  for (const id of ['passed', 'blown', 'missing']) {
    setActiveAccount(id);
    assert.equal(data.activeAccountId, 'funded');
  }
  setActiveAccount('paused');
  assert.equal(data.activeAccountId, 'paused');
});

test('saving a Passed or Blown outcome reassigns the selected account immediately', async t => {
  const values = setup(t, fixtures, 'active');
  await loadAll();
  await saveAccount({ ...data.accounts.find(a => a.id === 'active'), status: 'passed' });
  assert.equal(data.activeAccountId, 'paused');
  assert.equal(values.get('tms-active-account'), 'paused');
  await saveAccount({ ...data.accounts.find(a => a.id === 'paused'), status: 'blown' });
  assert.equal(data.activeAccountId, 'funded');
});

test('deleting the selection skips closed accounts and clears it when none remain', async t => {
  const values = setup(t, fixtures, 'active');
  await loadAll();
  for (const id of ['active', 'paused', 'funded']) await deleteAccount(id);
  assert.equal(data.activeAccountId, null);
  assert.equal(values.get('tms-active-account'), '');
  assert.deepEqual(data.accounts.map(a => a.id), ['blown', 'passed']);
});

test('an all-closed portfolio stays unselected until an available account is saved', async t => {
  const values = setup(t, fixtures.slice(0, 2), 'passed');
  await loadAll();
  assert.equal(data.activeAccountId, null);
  assert.equal(values.get('tms-active-account'), '');
  await saveAccount({ id: 'another-closed', status: 'passed' });
  assert.equal(data.activeAccountId, null);
  await saveAccount({ id: 'reopened', status: 'funded' });
  assert.equal(data.activeAccountId, 'reopened');
});

test('a failed status save keeps the current account selected', async t => {
  setup(t, fixtures, 'active');
  await loadAll();
  t.mock.method(db, 'put', async () => { throw new Error('Save failed'); });
  await assert.rejects(saveAccount({ id: 'active', status: 'blown' }), /Save failed/);
  assert.equal(data.activeAccountId, 'active');
  assert.equal(data.accounts.find(a => a.id === 'active').status, 'active');
});
