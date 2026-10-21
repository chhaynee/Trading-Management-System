import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const time = 1700000000000;
const bytes = Buffer.from('screenshot fixture');
const image = 'data:image/png;base64,' + bytes.toString('base64');

async function isolated() {
  const dir = mkdtempSync(join(tmpdir(), 'tms-transfer-test-'));
  const oldDb = process.env.TMS_DB_PATH;
  const oldUploads = process.env.TMS_UPLOADS_DIR;
  process.env.TMS_DB_PATH = join(dir, 'tms.db');
  process.env.TMS_UPLOADS_DIR = join(dir, 'uploads');
  delete require.cache[require.resolve('../server/server.js')];
  const { app, db } = require('../server/server.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    dir, db, base,
    async call(method, route, body, headers = {}) {
      const response = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    },
    async cleanup() {
      await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
      db.close();
      if (oldDb === undefined) delete process.env.TMS_DB_PATH; else process.env.TMS_DB_PATH = oldDb;
      if (oldUploads === undefined) delete process.env.TMS_UPLOADS_DIR; else process.env.TMS_UPLOADS_DIR = oldUploads;
      rmSync(dir, { force: true, recursive: true });
    },
  };
}
function payload() {
  return {
    version: 2, exportedAt: time,
    data: {
      accounts: [{ id: 'a-new', name: 'New account', type: 'own_funds', capital: 1000, createdAt: time, updatedAt: time, strategyIds: ['s-new'] }],
      strategies: [{ id: 's-new', name: 'New strategy', createdAt: time, updatedAt: time }],
      journals: [{ id: 'j-new', accountId: 'a-new', strategyIds: ['s-new'], result: 'win', amount: 100, screenshotPath: '/uploads/new.png', planId: 'p-new', createdAt: time, updatedAt: time }],
      trade_plans: [{ id: 'p-new', accountId: 'a-new', strategyIds: ['s-new'], status: 'executed', journalId: 'j-new', createdAt: time, updatedAt: time }],
      checks: [],
    },
    screenshots: { '/uploads/new.png': image },
  };
}
async function previewAndImport(t, value, mode = 'merge') {
  const preview = await t.call('POST', '/api/data/preview', { payload: value, mode });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.canImport, true, JSON.stringify(preview.body.errors));
  return t.call('POST', '/api/data/import', { payload: value, mode, previewToken: preview.body.previewToken });
}

test('portable export includes all stores and unused files, and remembers backup time', async () => {
  const t = await isolated();
  try {
    writeFileSync(join(t.dir, 'uploads', 'unused.png'), bytes);
    writeFileSync(join(t.dir, 'uploads', 'empty.png'), Buffer.alloc(0));
    assert.equal((await t.call('GET', '/api/data/status')).body.lastBackupAt, null);
    const result = await t.call('POST', '/api/data/export');
    assert.equal(result.status, 200);
    assert.equal(result.body.version, 2);
    assert.deepEqual(Object.keys(result.body.data), ['accounts', 'strategies', 'journals', 'trade_plans', 'checks']);
    assert.equal(result.body.screenshots['/uploads/unused.png'], image);
    assert.equal(result.body.screenshots['/uploads/empty.png'], 'data:image/png;base64,');
    assert.equal(typeof (await t.call('GET', '/api/data/status')).body.lastBackupAt, 'number');
    const preview = await t.call('POST', '/api/data/preview', { payload: result.body, mode: 'merge' });
    assert.equal(preview.body.canImport, true);
    assert.equal(preview.body.counts.checks.identical, 8);
  } finally { await t.cleanup(); }
});

test('merge adds linked records and pictures while keeping all existing data and files', async () => {
  const t = await isolated();
  try {
    await t.call('PUT', '/api/accounts', { id: 'existing', name: 'Keep me', type: 'own_funds', capital: 500 });
    const before = t.db.prepare('SELECT * FROM accounts WHERE id = ?').get('existing');
    writeFileSync(join(t.dir, 'uploads', 'keep.png'), bytes);
    const result = await previewAndImport(t, payload());
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.backupCreated, true);
    assert.deepEqual(t.db.prepare('SELECT * FROM accounts WHERE id = ?').get('existing'), before);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 2);
    assert.deepEqual(readFileSync(join(t.dir, 'uploads', 'new.png')), bytes);
    assert.deepEqual(readFileSync(join(t.dir, 'uploads', 'keep.png')), bytes);
    assert.equal(t.db.prepare('SELECT plan_id FROM journals WHERE id = ?').get('j-new').plan_id, 'p-new');
    const exported = (await t.call('POST', '/api/data/export')).body;
    const preview = await t.call('POST', '/api/data/preview', { payload: exported, mode: 'merge' });
    assert.equal(preview.body.canImport, true, JSON.stringify(preview.body.errors));
    assert.equal(preview.body.counts.journals.identical, 1);
  } finally { await t.cleanup(); }
});

test('conflicting rows and screenshot filenames block merge without any mutation', async () => {
  const t = await isolated();
  try {
    await t.call('PUT', '/api/accounts', { id: 'a-new', name: 'Original', type: 'own_funds' });
    writeFileSync(join(t.dir, 'uploads', 'new.png'), Buffer.from('original image'));
    const before = t.db.prepare('SELECT * FROM accounts').all();
    const preview = await t.call('POST', '/api/data/preview', { payload: payload(), mode: 'merge' });
    assert.equal(preview.body.canImport, false);
    assert.equal(preview.body.counts.accounts.conflicts, 1);
    assert.equal(preview.body.screenshots.conflicts, 1);
    const result = await t.call('POST', '/api/data/import', { payload: payload(), mode: 'merge', previewToken: preview.body.previewToken });
    assert.equal(result.status, 409);
    assert.deepEqual(t.db.prepare('SELECT * FROM accounts').all(), before);
    assert.equal(readFileSync(join(t.dir, 'uploads', 'new.png'), 'utf8'), 'original image');
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM journals').get().n, 0);
  } finally { await t.cleanup(); }
});

test('missing references, malformed values, traversal, and unknown stores cannot import', async () => {
  const t = await isolated();
  try {
    const cases = [
      value => { value.data.journals[0].accountId = 'missing'; },
      value => { value.data.accounts[0].strategyIds = ['missing']; },
      value => { value.data.journals[0].screenshotPath = '/uploads/missing.png'; },
      value => { value.screenshots['/uploads/../escaped.png'] = image; },
      value => { value.screenshots['/uploads/new.png'] = 'data:image/png;base64,!!!!'; },
      value => { value.data.unknown = []; },
      value => { value.data.accounts[0].capital = '1000'; },
      value => { value.data.journals[0].tags = 'bad'; },
      value => { delete value.data.checks; },
    ];
    for (const change of cases) {
      const value = payload(); change(value);
      const result = await t.call('POST', '/api/data/preview', { payload: value, mode: 'merge' });
      assert.equal(result.status, 200);
      assert.equal(result.body.canImport, false);
      assert.ok(result.body.errors.length > 0);
    }
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 0);
    assert.deepEqual(readdirSync(join(t.dir, 'uploads')), []);
  } finally { await t.cleanup(); }
});

test('replace creates a recoverable SQLite plus complete upload snapshot and keeps unused files', async () => {
  const t = await isolated();
  try {
    await t.call('PUT', '/api/accounts', { id: 'old', name: 'Recovery account', type: 'own_funds', capital: 4000 });
    writeFileSync(join(t.dir, 'uploads', 'old.png'), bytes);
    const result = await previewAndImport(t, payload(), 'replace');
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE id = ?').get('old').n, 0);
    assert.deepEqual(readFileSync(join(t.dir, 'uploads', 'old.png')), bytes);
    const backups = readdirSync(join(t.dir, 'tms.db.backups'));
    assert.equal(backups.length, 1);
    const backup = join(t.dir, 'tms.db.backups', backups[0]);
    const Database = require('better-sqlite3');
    const recovered = new Database(join(backup, 'tms.db'), { readonly: true });
    try { assert.equal(recovered.prepare('SELECT name FROM accounts WHERE id = ?').get('old').name, 'Recovery account'); }
    finally { recovered.close(); }
    assert.deepEqual(readFileSync(join(backup, 'uploads', 'old.png')), bytes);
  } finally { await t.cleanup(); }
});

test('import requires a matching preview and rejects a changed database', async () => {
  const t = await isolated();
  try {
    const value = payload();
    const absent = await t.call('POST', '/api/data/import', { payload: value, mode: 'merge' });
    assert.equal(absent.status, 409);
    const preview = await t.call('POST', '/api/data/preview', { payload: value, mode: 'merge' });
    await t.call('PUT', '/api/accounts', { id: 'intervening', name: 'Newer change', type: 'own_funds' });
    const result = await t.call('POST', '/api/data/import', { payload: value, mode: 'merge', previewToken: preview.body.previewToken });
    assert.equal(result.status, 409);
    assert.match(result.body.error, /Preview.*again/);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM journals').get().n, 0);
  } finally { await t.cleanup(); }
});

test('global seeded checks with timestamp-only differences remain identical and retained', async () => {
  const t = await isolated();
  try {
    const exported = (await t.call('POST', '/api/data/export')).body;
    const before = t.db.prepare('SELECT * FROM checks ORDER BY id').all();
    for (const check of exported.data.checks) { check.createdAt = time; check.updatedAt = time; }
    const result = await previewAndImport(t, exported);
    assert.equal(result.status, 200);
    assert.deepEqual(t.db.prepare('SELECT * FROM checks ORDER BY id').all(), before);
  } finally { await t.cleanup(); }
});

test('a failed database write rolls back rows and removes only newly written screenshots', async () => {
  const t = await isolated();
  try {
    writeFileSync(join(t.dir, 'uploads', 'keep.png'), bytes);
    t.db.exec("CREATE TRIGGER fail_import BEFORE INSERT ON strategies BEGIN SELECT RAISE(ABORT, 'fixture refuses write'); END;");
    const value = payload();
    const preview = await t.call('POST', '/api/data/preview', { payload: value, mode: 'merge' });
    const result = await t.call('POST', '/api/data/import', { payload: value, mode: 'merge', previewToken: preview.body.previewToken });
    assert.equal(result.status, 500);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 0);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM checks').get().n, 8);
    assert.deepEqual(readdirSync(join(t.dir, 'uploads')), ['keep.png']);
    assert.deepEqual(readFileSync(join(t.dir, 'uploads', 'keep.png')), bytes);
    assert.equal(readdirSync(join(t.dir, 'tms.db.backups')).length, 1);
  } finally { await t.cleanup(); }
});

test('historical journal grading fields survive an export and replace round trip', async () => {
  const t = await isolated();
  try {
    await t.call('PUT', '/api/journals', { id: 'legacy', description: 'Keep the original historical grading state' });
    t.db.exec("UPDATE journals SET grade = 'B', confluence_count = 5, pre_grading = 0 WHERE id = 'legacy'");
    const before = t.db.prepare('SELECT * FROM journals WHERE id = ?').get('legacy');
    const exported = (await t.call('POST', '/api/data/export')).body;
    const result = await previewAndImport(t, exported, 'replace');
    assert.equal(result.status, 200);
    assert.deepEqual(t.db.prepare('SELECT * FROM journals WHERE id = ?').get('legacy'), before);
  } finally { await t.cleanup(); }
});

test('the backup parser accepts screenshots beyond the ordinary API body limit', async () => {
  const t = await isolated();
  try {
    const value = payload();
    value.screenshots['/uploads/new.png'] = 'data:image/png;base64,' + Buffer.alloc(2 * 1024 * 1024, 7).toString('base64');
    const result = await t.call('POST', '/api/data/preview', { payload: value, mode: 'merge' });
    assert.equal(result.status, 200);
    assert.equal(result.body.canImport, true);
  } finally { await t.cleanup(); }
});

test('backup POST endpoints reject a foreign browser origin and accept this app origin', async () => {
  const t = await isolated();
  try {
    const foreign = await t.call('POST', '/api/data/preview', { payload: payload(), mode: 'merge' }, { origin: 'https://unrelated.example' });
    assert.equal(foreign.status, 403);
    const same = await t.call('POST', '/api/data/preview', { payload: payload(), mode: 'merge' }, { origin: t.base });
    assert.equal(same.status, 200);
    assert.equal(same.body.canImport, true);
  } finally { await t.cleanup(); }
});
