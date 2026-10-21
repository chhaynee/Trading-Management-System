/** Portable, loss-aware backups. This module never overwrites an upload. */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORES = ['accounts', 'strategies', 'journals', 'trade_plans', 'checks'];
const FIELDS = {
  accounts: 'id name displayName type company accountNumber capital startingCapital status tier phase riskAppetite rules strategyIds eaName broker vps personalDailyCapPct firmDailyCapPct createdAt updatedAt',
  strategies: 'id name color description entryMethods timeframes instruments preferredRR maxSLPips notes createdAt updatedAt',
  journals: 'id strategyId strategyIds accountId instrument timeframe direction entryDate result rAchieved amount screenshotPath exitScreenshotPath description tags planId sopChecks grade confluenceCount preGrading createdAt updatedAt',
  trade_plans: 'id strategyIds accountId instrument timeframe direction plannedEntry plannedSl plannedTp plannedRr riskPct checkResults grade status journalId premortem screenshotPath disciplineViolation createdAt updatedAt executedAt',
  checks: 'id scope strategyId label description mustPass position createdAt updatedAt',
};
const ARRAY_FIELDS = new Set('strategyIds entryMethods timeframes instruments tags'.split(' '));
const OBJECT_FIELDS = new Set(['rules', 'sopChecks', 'checkResults']);
const NUMBER_FIELDS = new Set('capital startingCapital personalDailyCapPct firmDailyCapPct preferredRR maxSLPips entryDate rAchieved amount confluenceCount plannedEntry plannedSl plannedTp plannedRr riskPct position createdAt updatedAt executedAt'.split(' '));
const BOOLEAN_FIELDS = new Set(['preGrading', 'disciplineViolation', 'mustPass']);
const HASH = value => crypto.createHash('sha256').update(value).digest('hex');
const stable = value => JSON.stringify(sortObject(value));
function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sortObject(value[k])]));
  return value;
}
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function uploadName(url) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/')) return null;
  const name = url.slice('/uploads/'.length);
  return name && name !== '.' && name !== '..' && !/[\\/\x00-\x1f]/.test(name) ? name : null;
}
function mimeFor(name) {
  return ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.avif': 'image/avif' })[path.extname(name).toLowerCase()] || 'application/octet-stream';
}
function decodeScreenshot(value) {
  const match = typeof value === 'string' && /^data:(?:image\/[a-zA-Z0-9.+-]+|application\/octet-stream);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match || match[1].length % 4 !== 0) throw new Error('Screenshot must contain a valid base64 data URL.');
  const buffer = Buffer.from(match[1], 'base64');
  if (buffer.toString('base64') !== match[1]) throw new Error('Screenshot contains invalid base64.');
  return buffer;
}

module.exports = function createDataTransferRouter({ db, DB_PATH, UPLOADS_DIR, MAPPERS }) {
  const router = express.Router();
  router.use((req, res, next) => {
    const origin = req.get('origin');
    if (req.method !== 'POST' || !origin) return next();
    let allowed = false;
    try { allowed = new URL(origin).origin === new URL(`${req.protocol}://${req.get('host')}`).origin; } catch {}
    if (!allowed) return res.status(403).json({ error: 'Manage backups from this app’s own browser tab.' });
    next();
  });
  // Large requests belong only to the backup endpoints, not general CRUD.
  router.use(express.json({ limit: '150mb' }));
  const statusFile = DB_PATH + '.data-status.json';
  const backupDir = DB_PATH + '.backups';
  function status() {
    try { return { lastBackupAt: JSON.parse(fs.readFileSync(statusFile, 'utf8')).lastBackupAt || null }; }
    catch { return { lastBackupAt: null }; }
  }
  function markBackup() {
    const lastBackupAt = Date.now();
    const temporary = statusFile + '.tmp-' + crypto.randomBytes(6).toString('hex');
    try {
      fs.writeFileSync(temporary, JSON.stringify({ lastBackupAt }), { flag: 'wx' });
      fs.renameSync(temporary, statusFile);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return lastBackupAt;
  }
  function currentData() {
    return Object.fromEntries(STORES.map(store => [store, db.prepare(`SELECT * FROM ${store} ORDER BY id`).all()]));
  }
  function uploadFiles() {
    return fs.readdirSync(UPLOADS_DIR, { withFileTypes: true }).map(entry => {
      if (!entry.isFile() || !uploadName('/uploads/' + entry.name)) throw new Error('A screenshot file cannot be safely read. Check the uploads directory.');
      const bytes = fs.readFileSync(path.join(UPLOADS_DIR, entry.name));
      return { name: entry.name, bytes, hash: HASH(bytes) };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }
  function normalize(store, obj) {
    const mapped = MAPPERS[store].toDb(obj);
    // These are stored history, and must survive backup round trips exactly.
    if (store === 'journals') {
      if (Object.hasOwn(obj, 'grade')) mapped.grade = obj.grade;
      if (Object.hasOwn(obj, 'confluenceCount')) mapped.confluence_count = obj.confluenceCount;
      if (Object.hasOwn(obj, 'preGrading')) mapped.pre_grading = obj.preGrading ? 1 : 0;
    }
    return mapped;
  }
  function sameRow(store, a, b) {
    const clean = value => {
      const out = { ...value };
      // Different installations seed these same global checks on different days.
      if (store === 'checks' && value.scope === 'global') { delete out.created_at; delete out.updated_at; }
      for (const key of ['rules', 'strategy_ids', 'entry_methods', 'timeframes', 'instruments', 'tags', 'sop_checks', 'check_results']) {
        if (typeof out[key] === 'string') { try { out[key] = JSON.parse(out[key]); } catch {} }
      }
      return out;
    };
    return stable(clean(a)) === stable(clean(b));
  }
  function validate(payload, mode) {
    const errors = [];
    const rows = Object.fromEntries(STORES.map(s => [s, []]));
    const screenshots = new Map();
    if (!['merge', 'replace'].includes(mode)) errors.push('Choose Merge or Replace.');
    if (!isObject(payload) || payload.version !== 2 || !isObject(payload.data)) {
      return { rows, screenshots, errors: [...errors, 'Use a complete TMS version 2 JSON backup with all five data stores.'] };
    }
    if (Object.keys(payload.data).some(s => !STORES.includes(s))) errors.push('The backup contains an unknown data store.');
    for (const store of STORES) {
      if (!Array.isArray(payload.data[store])) { errors.push(`The backup must include a ${store} array.`); continue; }
      const seen = new Set();
      for (const obj of payload.data[store]) {
        const previousErrors = errors.length;
        const prefix = `${store} record`;
        if (!isObject(obj) || typeof obj.id !== 'string' || !obj.id.trim()) { errors.push(`${prefix} requires a non-empty ID.`); continue; }
        if (seen.has(obj.id)) { errors.push(`${store} contains duplicate IDs.`); continue; }
        seen.add(obj.id);
        if (Object.keys(obj).some(k => !FIELDS[store].split(' ').includes(k))) errors.push(`${prefix} has an unsupported field. No fields will be silently discarded.`);
        for (const [key, value] of Object.entries(obj)) {
          if (value === null) continue;
          if (ARRAY_FIELDS.has(key)) {
            if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) errors.push(`${prefix}: ${key} must be an array of strings.`);
          } else if (OBJECT_FIELDS.has(key)) {
            if (!isObject(value)) errors.push(`${prefix}: ${key} must be an object.`);
          } else if (NUMBER_FIELDS.has(key)) {
            if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${prefix}: ${key} must be a finite number.`);
          } else if (BOOLEAN_FIELDS.has(key)) {
            if (typeof value !== 'boolean') errors.push(`${prefix}: ${key} must be true or false.`);
          } else if (typeof value !== 'string') errors.push(`${prefix}: ${key} must be text.`);
        }
        for (const key of ['createdAt', 'updatedAt']) {
          if (typeof obj[key] !== 'number' || !Number.isFinite(obj[key])) errors.push(`${prefix} requires a valid ${key}.`);
        }
        const required = store === 'accounts' ? ['name', 'type'] : store === 'strategies' ? ['name'] : store === 'checks' ? ['scope', 'label'] : [];
        for (const key of required) if (typeof obj[key] !== 'string' || !obj[key].trim()) errors.push(`${prefix} requires ${key}.`);
        if (store === 'checks' && !['global', 'strategy'].includes(obj.scope)) errors.push('Check scope must be global or strategy.');
        if (store === 'checks' && obj.scope === 'strategy' && !obj.strategyId) errors.push('A strategy check requires a strategy.');
        if (store === 'journals' && obj.strategyId && obj.strategyIds?.length && obj.strategyIds[0] !== obj.strategyId) errors.push('A journal has inconsistent strategy links.');
        if (store === 'journals' && obj.sopChecks != null && (!isObject(obj.sopChecks) || Array.from({ length: 8 }, (_, i) => `rule_${i + 1}`).some(k => !isObject(obj.sopChecks[k]) || typeof obj.sopChecks[k].confirmed !== 'boolean'))) errors.push('A journal contains an incomplete SOP checklist.');
        if (errors.length !== previousErrors) continue;
        try { rows[store].push(normalize(store, obj)); } catch { errors.push(`${prefix} could not be mapped safely.`); }
      }
    }
    if (!isObject(payload.screenshots)) errors.push('A complete backup requires a screenshots object, even when empty.');
    else for (const [url, value] of Object.entries(payload.screenshots)) {
      const name = uploadName(url);
      if (!name) { errors.push('A screenshot has an unsafe filename.'); continue; }
      try { const bytes = decodeScreenshot(value); screenshots.set(name, { bytes, hash: HASH(bytes) }); }
      catch (err) { errors.push(err.message); }
    }
    return { rows, screenshots, errors };
  }
  function inspect(payload, mode) {
    const parsed = validate(payload, mode);
    const current = currentData();
    const files = uploadFiles();
    const currentFiles = new Map(files.map(f => [f.name, f]));
    const counts = {};
    for (const store of STORES) {
      const byId = new Map(current[store].map(r => [r.id, r]));
      counts[store] = { current: byId.size, incoming: parsed.rows[store].length, added: 0, identical: 0, conflicts: 0 };
      for (const row of parsed.rows[store]) {
        if (!byId.has(row.id)) counts[store].added++;
        else if (sameRow(store, row, byId.get(row.id))) counts[store].identical++;
        else counts[store].conflicts++;
      }
      if (mode === 'merge' && counts[store].conflicts) parsed.errors.push(`${store}: ${counts[store].conflicts} existing record(s) differ. Merge will not overwrite them. Review the backup or explicitly choose Replace after reviewing its preview.`);
    }
    const screenshotCounts = { current: files.length, incoming: parsed.screenshots.size, added: 0, identical: 0, conflicts: 0 };
    for (const [name, file] of parsed.screenshots) {
      if (!currentFiles.has(name)) screenshotCounts.added++;
      else if (file.hash === currentFiles.get(name).hash) screenshotCounts.identical++;
      else screenshotCounts.conflicts++;
    }
    // Uploads are never overwritten, including during Replace. A different
    // filename must be chosen in the source backup to resolve a collision.
    if (screenshotCounts.conflicts) parsed.errors.push('Screenshot filenames contain different content already stored here. Rename those files and their record links in the backup before importing. Existing screenshots will never be overwritten.');
    const final = Object.fromEntries(STORES.map(store => [store, new Map((mode === 'merge' ? current[store] : []).map(row => [row.id, row]))]));
    for (const store of STORES) for (const row of parsed.rows[store]) if (!final[store].has(row.id) || mode === 'replace') final[store].set(row.id, row);
    const ref = (store, id, description) => { if (id != null && !final[store].has(id)) parsed.errors.push(`${description} refers to a missing ${store} record.`); };
    const refs = (store, ids, description) => { for (const id of ids) ref(store, id, description); };
    for (const store of STORES) for (const row of parsed.rows[store]) {
      if (row.strategy_ids) refs('strategies', JSON.parse(row.strategy_ids), store);
      if (row.strategy_id) ref('strategies', row.strategy_id, store);
      if (row.account_id) ref('accounts', row.account_id, store);
      if (row.plan_id) ref('trade_plans', row.plan_id, store);
      if (row.journal_id) ref('journals', row.journal_id, store);
      // Check results are historical snapshots and may intentionally include
      // retired/deleted checks, so they are preserved rather than relinked.
      for (const column of ['screenshot_path', 'exit_screenshot_path']) if (row[column]) {
        const name = uploadName(row[column]);
        if (!name || (!parsed.screenshots.has(name) && !currentFiles.has(name))) parsed.errors.push(`${store} references a missing or unsafe screenshot.`);
      }
    }
    const errors = [...new Set(parsed.errors)];
    const previewToken = HASH(stable({ mode, payload, current, files: files.map(f => [f.name, f.hash]) }));
    return { parsed, current, currentFiles, response: { mode, counts, screenshots: screenshotCounts, canImport: errors.length === 0, errors, previewToken } };
  }
  function recoveryBackup() {
    fs.mkdirSync(backupDir, { recursive: true });
    const dir = fs.mkdtempSync(path.join(backupDir, 'before-import-'));
    fs.writeFileSync(path.join(dir, 'tms.db'), db.serialize(), { flag: 'wx' });
    fs.cpSync(UPLOADS_DIR, path.join(dir, 'uploads'), { recursive: true, errorOnExist: true, force: false });
    return markBackup();
  }
  router.get('/status', (_req, res) => res.json(status()));
  router.post('/export', (_req, res, next) => {
    try {
      const raw = currentData();
      const screenshots = Object.fromEntries(uploadFiles().map(f => ['/uploads/' + f.name, `data:${mimeFor(f.name)};base64,${f.bytes.toString('base64')}`]));
      const payload = { version: 2, exportedAt: Date.now(), data: Object.fromEntries(STORES.map(s => [s, raw[s].map(MAPPERS[s].fromDb)])), screenshots };
      markBackup();
      res.setHeader('Content-Disposition', `attachment; filename="tms-backup-${new Date().toISOString().slice(0, 10)}.json"`);
      res.json(payload);
    } catch (err) { next(err); }
  });
  router.post('/preview', (req, res, next) => {
    try { res.json(inspect(req.body?.payload, req.body?.mode || 'merge').response); }
    catch (err) { next(err); }
  });
  router.post('/import', (req, res, next) => {
    const written = [];
    try {
      const mode = req.body?.mode || 'merge';
      const inspected = inspect(req.body?.payload, mode);
      const { response, parsed, currentFiles } = inspected;
      if (!req.body?.previewToken || req.body.previewToken !== response.previewToken) return res.status(409).json({ error: 'The data or backup has changed, or a preview is missing. Preview this import again before continuing.' });
      if (!response.canImport) return res.status(409).json({ error: response.errors.join(' '), ...response });
      // Snapshot is synchronous: no app write can interleave with this backup
      // and the commit. It contains every row plus every upload, even unused.
      const lastBackupAt = recoveryBackup();
      db.transaction(() => {
        db.pragma('defer_foreign_keys = ON');
        for (const [name, file] of parsed.screenshots) if (!currentFiles.has(name)) {
          const target = path.join(UPLOADS_DIR, name);
          fs.writeFileSync(target, file.bytes, { flag: 'wx' });
          written.push(target);
          if (HASH(fs.readFileSync(target)) !== file.hash) throw new Error('Screenshot verification failed. Import cancelled.');
        }
        if (mode === 'replace') {
          // First clear the mutual journal/plan reference, then child records.
          db.exec('UPDATE trade_plans SET journal_id = NULL; DELETE FROM journals; DELETE FROM trade_plans; DELETE FROM checks; DELETE FROM accounts; DELETE FROM strategies;');
        }
        for (const store of ['strategies', 'accounts', 'checks', 'journals', 'trade_plans']) for (const row of parsed.rows[store]) {
          if (mode === 'merge' && inspected.current[store].some(existing => existing.id === row.id)) continue;
          const columns = Object.keys(row);
          db.prepare(`INSERT INTO ${store} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map(k => row[k]));
          const actual = db.prepare(`SELECT * FROM ${store} WHERE id = ?`).get(row.id);
          if (!sameRow(store, actual, row)) throw new Error('A record could not be verified after import. Import cancelled.');
        }
      })();
      res.json({ ok: true, mode, counts: response.counts, screenshots: response.screenshots, lastBackupAt, backupCreated: true });
    } catch (err) {
      for (const target of written) { try { fs.unlinkSync(target); } catch {} }
      next(err);
    }
  });
  router.use((err, _req, res, _next) => {
    const tooLarge = err.type === 'entity.too.large';
    const invalidJson = err.type === 'entity.parse.failed';
    console.error('[data-transfer]', err.message);
    res.status(tooLarge ? 413 : invalidJson ? 400 : 500).json({ error: tooLarge ? 'This backup exceeds the 150 MB import limit.' : invalidJson ? 'The backup request is not valid JSON.' : 'The backup operation could not finish. Your existing records have been preserved. Check the server log.' });
  });
  return router;
};
