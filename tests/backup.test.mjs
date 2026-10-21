import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { preparePortableBackup, inspectBrowserBackup } from '../js/backup.js';

const time = 1700000000000;
const image = 'data:image/png;base64,' + Buffer.from('picture bytes').toString('base64');
function empty() {
  return { version: 2, exportedAt: time, data: { accounts: [], strategies: [], journals: [], trade_plans: [], checks: [] }, screenshots: {} };
}
function populated() {
  const value = empty();
  value.data.accounts.push({ id: 'a', name: 'Account', type: 'own_funds', createdAt: time, updatedAt: time });
  value.data.strategies.push({ id: 's', name: 'Strategy', createdAt: time, updatedAt: time });
  value.data.journals.push({ id: 'j', accountId: 'a', strategyIds: ['s'], screenshotPath: '/uploads/a.png', exitScreenshotPath: '/uploads/exit.png', createdAt: time, updatedAt: time });
  value.screenshots['/uploads/a.png'] = image;
  value.screenshots['/uploads/exit.png'] = image;
  value.screenshots['/uploads/unused.png'] = image;
  return value;
}

test('HTTP screenshots become deterministic browser keys and rewrite both image fields', async () => {
  const first = await preparePortableBackup(populated(), 'idb');
  const second = await preparePortableBackup(populated(), 'idb');
  assert.deepEqual(first, second);
  assert.equal(Object.keys(first.screenshots).length, 3);
  assert.match(first.data.journals[0].screenshotPath, /^idb:\/\/backup-[a-f0-9]{64}$/);
  assert.ok(first.screenshots[first.data.journals[0].exitScreenshotPath]);
});

test('browser exports use canonical uploads paths and preserve unused duplicate-content images', async () => {
  const value = populated();
  value.screenshots = { 'idb://sc-a': image, 'idb://sc-b': image, 'idb://unused': image };
  value.data.journals[0].screenshotPath = 'idb://sc-a';
  value.data.journals[0].exitScreenshotPath = 'idb://sc-b';
  const portable = await preparePortableBackup(value, 'http');
  assert.equal(Object.keys(portable.screenshots).length, 3);
  assert.ok(Object.keys(portable.screenshots).every(key => /^\/uploads\/import-[a-f0-9]{64}\.png$/.test(key)));
  assert.ok(portable.screenshots[portable.data.journals[0].screenshotPath]);
  assert.ok(portable.screenshots[portable.data.journals[0].exitScreenshotPath]);
});

test('a browser can preview its own portable export as identical without duplicate images', async () => {
  const current = await preparePortableBackup(populated(), 'idb');
  const exported = await preparePortableBackup(current, 'http');
  const preview = (await inspectBrowserBackup(exported, current)).response;
  assert.equal(preview.canImport, true, JSON.stringify(preview.errors));
  assert.equal(preview.counts.journals.identical, 1);
  assert.equal(preview.screenshots.identical, 3);
  assert.equal(preview.screenshots.added, 0);
});

test('a browser-origin backup also reimports without changing original screenshot identities', async () => {
  const current = populated();
  current.screenshots = { 'idb://sc-a': image, 'idb://sc-b': image, 'idb://unused': image };
  current.data.journals[0].screenshotPath = 'idb://sc-a';
  current.data.journals[0].exitScreenshotPath = 'idb://sc-b';
  const exported = await preparePortableBackup(current, 'http');
  const result = await inspectBrowserBackup(exported, current);
  assert.equal(result.response.canImport, true, JSON.stringify(result.response.errors));
  assert.equal(result.response.counts.journals.identical, 1);
  assert.equal(result.response.screenshots.added, 0);
  assert.equal(result.incoming.data.journals[0].screenshotPath, 'idb://sc-a');
});

test('merge conflicts block changes while explicit replace previews show differing records', async () => {
  const current = populated();
  const incoming = populated();
  incoming.data.accounts[0].name = 'Different';
  const merge = (await inspectBrowserBackup(incoming, current)).response;
  assert.equal(merge.canImport, false);
  assert.equal(merge.counts.accounts.conflicts, 1);
  const replace = (await inspectBrowserBackup(incoming, current, { mode: 'replace' })).response;
  assert.equal(replace.canImport, true, JSON.stringify(replace.errors));
});

test('screenshot content conflicts are blocked even during replace', async () => {
  const current = await preparePortableBackup(populated(), 'idb');
  const incoming = structuredClone(current);
  const key = Object.keys(incoming.screenshots)[0];
  incoming.screenshots[key] = 'data:image/png;base64,' + Buffer.from('different').toString('base64');
  for (const mode of ['merge', 'replace']) {
    const preview = (await inspectBrowserBackup(incoming, current, { mode })).response;
    assert.equal(preview.canImport, false);
    assert.equal(preview.screenshots.conflicts, 1);
  }
});

test('dangling links, missing pictures, unknown fields and duplicate IDs are rejected', async () => {
  const changes = [
    value => { value.data.journals[0].accountId = 'missing'; },
    value => { value.data.journals[0].strategyIds = ['missing']; },
    value => { value.data.journals[0].planId = 'missing'; },
    value => { value.data.journals[0].screenshotPath = '/uploads/missing.png'; },
    value => { value.data.accounts[0].unknownField = 'cannot silently drop'; },
    value => { value.data.accounts.push({ ...value.data.accounts[0] }); },
  ];
  for (const change of changes) {
    const value = populated(); change(value);
    assert.equal((await inspectBrowserBackup(value, empty())).response.canImport, false);
  }
});

test('malformed envelopes, legacy versions, traversal, and invalid base64 fail clearly', async () => {
  const cases = [
    value => { value.version = 1; },
    value => { delete value.data.trade_plans; },
    value => { value.data.unknown = []; },
    value => { value.screenshots['/uploads/../outside.png'] = image; },
    value => { value.screenshots['/uploads/a.png'] = 'data:image/png;base64,!!!!'; },
  ];
  for (const change of cases) {
    const value = populated(); change(value);
    await assert.rejects(() => preparePortableBackup(value), /version 2|trade_plans|unknown|unsafe|base64/);
  }
});

test('global check timestamps are equivalent and current snapshot timestamps do not stale previews', async () => {
  const current = empty();
  current.data.checks.push({ id: 'g', scope: 'global', label: 'Check', mustPass: true, position: 0, createdAt: time, updatedAt: time });
  const incoming = structuredClone(current);
  incoming.data.checks[0].createdAt++;
  incoming.data.checks[0].updatedAt++;
  const first = (await inspectBrowserBackup(incoming, current)).response;
  assert.equal(first.canImport, true);
  assert.equal(first.counts.checks.identical, 1);
  current.exportedAt++;
  const second = (await inspectBrowserBackup(incoming, current)).response;
  assert.equal(second.previewToken, first.previewToken);
  current.data.checks[0].label = 'Changed';
  assert.notEqual((await inspectBrowserBackup(incoming, current)).response.previewToken, first.previewToken);
});

test('screenshot bytes and payload changes invalidate the browser preview token', async () => {
  const current = populated();
  const incoming = populated();
  const first = (await inspectBrowserBackup(incoming, current)).response.previewToken;
  current.screenshots['/uploads/unused.png'] = 'data:image/png;base64,' + Buffer.from('new bytes').toString('base64');
  assert.notEqual((await inspectBrowserBackup(incoming, current)).response.previewToken, first);
  incoming.data.accounts[0].name = 'New';
  assert.notEqual((await inspectBrowserBackup(incoming, current)).response.previewToken, first);
});

test('LAN HTTP without Web Crypto produces the same portable SHA-256 identities', async () => {
  const value = empty();
  value.screenshots['idb://unicode-source'] = image;
  const native = await preparePortableBackup(value, 'http');
  const expectedPreview = (await inspectBrowserBackup(native, empty())).response;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
  try {
    const actual = await preparePortableBackup(value, 'http');
    const hash = createHash('sha256').update('idb://unicode-source').digest('hex');
    assert.deepEqual(Object.keys(actual.screenshots), [`/uploads/import-${hash}.png`]);
    const preview = (await inspectBrowserBackup(actual, empty())).response;
    assert.equal(preview.canImport, true);
    assert.equal(preview.previewToken, expectedPreview.previewToken);
  } finally { if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor); else delete globalThis.crypto; }
});
