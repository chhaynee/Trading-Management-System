import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storageStatus, trackSave, subscribeStorageStatus } from '../js/storage-status.js';

test('successful writes report a persisted save; errors stay visible for retry', async () => {
  const states = [];
  const unsubscribe = subscribeStorageStatus(status => states.push(status.state));
  try {
    assert.equal(await trackSave(async () => 'saved record'), 'saved record');
    assert.equal(storageStatus.state, 'saved');
    assert(storageStatus.lastSavedAt);
    await assert.rejects(trackSave(async () => { throw new Error('Connection interrupted'); }), /Connection interrupted/);
    assert.equal(storageStatus.state, 'error');
    assert.equal(storageStatus.error, 'Connection interrupted');
    await trackSave(async () => 'retry succeeded');
    assert.equal(storageStatus.state, 'saved');
    assert.equal(storageStatus.error, '');
    assert(states.includes('saving'));
  } finally { unsubscribe(); }
});

test('a concurrent successful write cannot hide a failed write in the same batch', async () => {
  let finish;
  const pending = trackSave(() => new Promise(resolve => { finish = resolve; }));
  await assert.rejects(trackSave(async () => { throw new Error('Screenshot could not save'); }), /Screenshot could not save/);
  finish('another write finished');
  await pending;
  assert.equal(storageStatus.state, 'error');
  assert.equal(storageStatus.error, 'Screenshot could not save');
  await trackSave(async () => 'retry');
  assert.equal(storageStatus.state, 'saved');
});
