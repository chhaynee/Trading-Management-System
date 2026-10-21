import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectMode } from '../js/db-detect.js';

function mockStorage(t, initialMode) {
  let mode = initialMode;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: () => mode,
      setItem: (key, value) => {
        assert.equal(key, 'tms-mode');
        mode = value;
      },
    },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor);
    else delete globalThis.sessionStorage;
  });
  return () => mode;
}

test('a tab cached in browser mode returns to the server when it is available', async t => {
  const storedMode = mockStorage(t, 'idb');
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({ ok: true }));

  assert.equal(await detectMode(), 'http');
  assert.equal(storedMode(), 'http');
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(fetchMock.mock.calls[0].arguments[0], '/api/accounts');
  assert.equal(fetchMock.mock.calls[0].arguments[1].method, 'HEAD');
});

test('a previous server session still supports browser mode when offline', async t => {
  const storedMode = mockStorage(t, 'http');
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Offline'); });

  assert.equal(await detectMode(), 'idb');
  assert.equal(storedMode(), 'idb');
});

test('a static host without the API uses browser storage', async t => {
  const storedMode = mockStorage(t, null);
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false }));

  assert.equal(await detectMode(), 'idb');
  assert.equal(storedMode(), 'idb');
});
