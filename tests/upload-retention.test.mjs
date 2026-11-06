import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const screenshot = Buffer.from('shared screenshot evidence');

async function isolatedServer() {
  const dir = mkdtempSync(join(tmpdir(), 'tms-upload-retention-'));
  const previousDb = process.env.TMS_DB_PATH;
  const previousUploads = process.env.TMS_UPLOADS_DIR;
  process.env.TMS_DB_PATH = join(dir, 'test.db');
  process.env.TMS_UPLOADS_DIR = join(dir, 'uploads');
  delete require.cache[require.resolve('../server/server.js')];
  const { app, db } = require('../server/server.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    db,
    image(name = 'shared.png') {
      const file = join(dir, 'uploads', name);
      writeFileSync(file, screenshot);
      return { file, url: `/uploads/${name}` };
    },
    async call(method, route, body) {
      const response = await fetch(base + route, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
    async save(store, record) {
      const result = await this.call('PUT', `/api/${store}`, record);
      assert.equal(result.status, 200, JSON.stringify(result.body));
    },
    async cleanup() {
      await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
      db.close();
      if (previousDb === undefined) delete process.env.TMS_DB_PATH;
      else process.env.TMS_DB_PATH = previousDb;
      if (previousUploads === undefined) delete process.env.TMS_UPLOADS_DIR;
      else process.env.TMS_UPLOADS_DIR = previousUploads;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('deleting a plan retains the screenshot copied into its journal', async () => {
  const t = await isolatedServer();
  try {
    const image = t.image();
    await t.save('trade_plans', { id: 'plan', screenshotPath: image.url });
    await t.save('journals', { id: 'journal', planId: 'plan', screenshotPath: image.url });
    await t.save('trade_plans', { id: 'plan', journalId: 'journal', screenshotPath: image.url });

    assert.equal((await t.call('DELETE', '/api/trade_plans/plan')).status, 204);
    const journal = (await t.call('GET', '/api/journals/journal')).body;
    assert.equal(journal.planId, null);
    assert.equal(journal.screenshotPath, image.url);
    assert.deepEqual(readFileSync(image.file), screenshot);
  } finally { await t.cleanup(); }
});

test('deleting a journal retains its plan screenshot and unlinks every matching plan', async () => {
  const t = await isolatedServer();
  try {
    const image = t.image();
    await t.save('journals', { id: 'journal', screenshotPath: image.url });
    await t.save('trade_plans', { id: 'plan', journalId: 'journal', screenshotPath: image.url });
    await t.save('trade_plans', { id: 'second-plan', journalId: 'journal' });

    assert.equal((await t.call('DELETE', '/api/journals/journal')).status, 204);
    const plans = (await t.call('GET', '/api/trade_plans')).body;
    assert.equal(plans.length, 2);
    assert.ok(plans.every(plan => plan.journalId === null));
    assert.deepEqual(readFileSync(image.file), screenshot);
  } finally { await t.cleanup(); }
});

test('entry screenshots survive exit-screenshot reuse until the final reference is deleted', async () => {
  const t = await isolatedServer();
  try {
    const image = t.image();
    await t.save('journals', { id: 'entry', screenshotPath: image.url });
    await t.save('journals', { id: 'exit', exitScreenshotPath: image.url });

    assert.equal((await t.call('DELETE', '/api/journals/entry')).status, 204);
    assert.deepEqual(readFileSync(image.file), screenshot);
    assert.equal((await t.call('DELETE', '/api/journals/exit')).status, 204);
    assert.equal(existsSync(image.file), false);
  } finally { await t.cleanup(); }
});

test('deleting the final plan reference removes its unshared screenshot', async () => {
  const t = await isolatedServer();
  try {
    const image = t.image();
    await t.save('trade_plans', { id: 'plan', screenshotPath: image.url });
    assert.equal((await t.call('DELETE', '/api/trade_plans/plan')).status, 204);
    assert.equal(existsSync(image.file), false);
  } finally { await t.cleanup(); }
});

test('plan deletion clears all matching backlinks while retaining unrelated journal links', async () => {
  const t = await isolatedServer();
  try {
    await t.save('trade_plans', { id: 'keep-plan' });
    await t.save('journals', { id: 'unrelated', planId: 'keep-plan' });
    await t.save('trade_plans', { id: 'delete-plan', journalId: 'unrelated' });
    await t.save('journals', { id: 'linked', planId: 'delete-plan' });
    await t.save('journals', { id: 'second-linked', planId: 'delete-plan' });

    assert.equal((await t.call('DELETE', '/api/trade_plans/delete-plan')).status, 204);
    assert.equal((await t.call('GET', '/api/journals/linked')).body.planId, null);
    assert.equal((await t.call('GET', '/api/journals/second-linked')).body.planId, null);
    assert.equal((await t.call('GET', '/api/journals/unrelated')).body.planId, 'keep-plan');
  } finally { await t.cleanup(); }
});

for (const store of ['journals', 'trade_plans']) {
  test(`failed ${store} deletion preserves screenshots and rolls back relational unlinking`, async () => {
    const t = await isolatedServer();
    try {
      const image = t.image();
      await t.save('trade_plans', { id: 'plan', screenshotPath: store === 'trade_plans' ? image.url : null });
      await t.save('journals', { id: 'journal', planId: 'plan', screenshotPath: store === 'journals' ? image.url : null });
      await t.save('trade_plans', { id: 'plan', journalId: 'journal', screenshotPath: store === 'trade_plans' ? image.url : null });
      t.db.exec(`CREATE TRIGGER reject_delete BEFORE DELETE ON ${store}
        BEGIN SELECT RAISE(ABORT, 'fixture rejects deletion'); END;`);

      const id = store === 'journals' ? 'journal' : 'plan';
      assert.equal((await t.call('DELETE', `/api/${store}/${id}`)).status, 500);
      assert.equal((await t.call('GET', '/api/trade_plans/plan')).body.journalId, 'journal');
      assert.equal((await t.call('GET', '/api/journals/journal')).body.planId, 'plan');
      assert.deepEqual(readFileSync(image.file), screenshot);
    } finally { await t.cleanup(); }
  });
}
