/** Complete, portable backups for the server and browser storage modes. */
import { getMode } from './db.js';
import { readRawSnapshot, applyBackupAtomic, saveRecoverySnapshot } from './db-idb.js';

const STORES = ['accounts', 'strategies', 'journals', 'trade_plans', 'checks'];
const IMAGE_FIELDS = ['screenshotPath', 'exitScreenshotPath'];
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
const DERIVED_FIELDS = new Set('dailyPnlToday personalCapDollars firmCapDollars personalCapPctUsed firmCapPctUsed capState screenshotPathUrl exitScreenshotPathUrl'.split(' '));
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
  return value;
}
const stable = value => JSON.stringify(ordered(value));
// Web Crypto requires HTTPS, while a phone may open this local app over LAN
// HTTP. This fallback keeps deterministic backup identities available there.
function sha256Fallback(input) {
  const constants = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ];
  const bytes = new Uint8Array(Math.ceil((input.length + 9) / 64) * 64);
  bytes.set(input); bytes[input.length] = 0x80;
  const view = new DataView(bytes.buffer);
  const bits = input.length * 8;
  view.setUint32(bytes.length - 8, Math.floor(bits / 0x100000000));
  view.setUint32(bytes.length - 4, bits >>> 0);
  const state = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const rotate = (value, count) => (value >>> count) | (value << (32 - count));
  const words = new Uint32Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = words[i - 15], b = words[i - 2];
      words[i] = (words[i - 16] + (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) + words[i - 7] + (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))) >>> 0;
    }
    let [a,b,c,d,e,f,g,h] = state;
    for (let i = 0; i < 64; i++) {
      const first = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + constants[i] + words[i]) >>> 0;
      const second = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h=g; g=f; f=e; e=(d+first)>>>0; d=c; c=b; b=a; a=(first+second)>>>0;
    }
    for (const [i, value] of [a,b,c,d,e,f,g,h].entries()) state[i] = (state[i] + value) >>> 0;
  }
  return state.map(value => value.toString(16).padStart(8, '0')).join('');
}
async function digest(value) {
  const encoded = new TextEncoder().encode(value);
  if (!globalThis.crypto?.subtle) return sha256Fallback(encoded);
  const bytes = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
function imageData(value) {
  const match = typeof value === 'string' && /^data:(image\/[a-zA-Z0-9.+-]+|application\/octet-stream);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) throw new Error('A screenshot must contain a valid base64 data URL.');
  let binary;
  try { binary = atob(match[2]); } catch { throw new Error('A screenshot contains invalid base64.'); }
  if (btoa(binary) !== match[2]) throw new Error('A screenshot contains invalid base64.');
  return { mime: match[1], base64: match[2], binary };
}
function toBlob(value) {
  const { mime, binary } = imageData(value);
  return new Blob([Uint8Array.from(binary, ch => ch.charCodeAt(0))], { type: mime });
}
async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  const mime = /^(image\/[a-zA-Z0-9.+-]+|application\/octet-stream)$/.test(blob.type) ? blob.type : 'application/octet-stream';
  return `data:${mime};base64,${btoa(binary)}`;
}
function isScreenshotPath(value) {
  return typeof value === 'string' && (/^idb:\/\/[a-zA-Z0-9._-]+$/.test(value) || (value.startsWith('/uploads/') && value.slice(9).length > 0 && !/[\\/\x00-\x1f]/.test(value.slice(9)) && !['.', '..'].includes(value.slice(9))));
}
async function portableScreenshotPath(key, value) {
  if (key.startsWith('/uploads/')) return key;
  const { mime } = imageData(value);
  const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' })[mime] || 'bin';
  return `/uploads/import-${await digest(key)}.${ext}`;
}
function assertEnvelope(payload) {
  if (!isObject(payload) || payload.version !== 2 || !isObject(payload.data)) throw new Error('Use a complete TMS version 2 backup. Older version 1 backups require conversion before importing.');
  if (Object.keys(payload.data).some(key => !STORES.includes(key))) throw new Error('The backup contains an unknown data store.');
  for (const store of STORES) if (!Array.isArray(payload.data[store])) throw new Error(`The backup must include a ${store} array.`);
  if (!isObject(payload.screenshots)) throw new Error('A complete backup requires a screenshots object, even when empty.');
}
function cleanRecord(record) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !DERIVED_FIELDS.has(key)));
}

/** Deterministic screenshot names allow preview and import to use one payload. */
export async function preparePortableBackup(payload, target = 'http', existingScreenshots = {}) {
  assertEnvelope(payload);
  const aliases = new Map();
  if (target === 'idb') for (const [key, value] of Object.entries(existingScreenshots)) {
    if (!isScreenshotPath(key)) continue;
    aliases.set(await portableScreenshotPath(key, value), key);
  }
  const rewrites = new Map();
  const screenshots = {};
  for (const [key, value] of Object.entries(payload.screenshots)) {
    if (!isScreenshotPath(key)) throw new Error('A screenshot has an unsafe filename.');
    imageData(value);
    const next = target === 'http'
      ? await portableScreenshotPath(key, value)
      : key.startsWith('idb://') ? key : aliases.get(key) || `idb://backup-${await digest(key)}`;
    if (Object.hasOwn(screenshots, next) && imageData(screenshots[next]).base64 !== imageData(value).base64) throw new Error('Two screenshots resolve to the same name with different content.');
    screenshots[next] = value;
    rewrites.set(key, next);
  }
  const data = Object.fromEntries(STORES.map(store => [store, payload.data[store].map(record => {
    if (!isObject(record)) throw new Error(`${store} contains a malformed record.`);
    const row = cleanRecord(record);
    for (const key of IMAGE_FIELDS) if (row[key] && rewrites.has(row[key])) row[key] = rewrites.get(row[key]);
    return row;
  })]));
  return { version: 2, exportedAt: payload.exportedAt, data, screenshots };
}

function normalizedRecord(store, value) {
  const row = cleanRecord(value);
  const defaults = Object.fromEntries(FIELDS[store].split(' ').map(key => [key, null]));
  for (const key of ARRAY_FIELDS) if (Object.hasOwn(defaults, key)) defaults[key] = [];
  for (const key of ['rules', 'checkResults']) if (Object.hasOwn(defaults, key)) defaults[key] = {};
  if (store === 'accounts') { defaults.personalDailyCapPct = 3; defaults.firmDailyCapPct = 5; }
  if (store === 'journals') {
    defaults.preGrading = !row.sopChecks;
    const ids = row.strategyIds?.length ? row.strategyIds : row.strategyId ? [row.strategyId] : [];
    row.strategyIds = ids;
    row.strategyId = ids[0] || null;
  }
  if (store === 'trade_plans') { defaults.status = 'draft'; defaults.disciplineViolation = false; }
  if (store === 'checks') { defaults.mustPass = false; defaults.position = 0; }
  return { ...defaults, ...row };
}
function equivalent(store, a, b) {
  const first = normalizedRecord(store, a), second = normalizedRecord(store, b);
  if (store === 'checks' && first.scope === 'global' && second.scope === 'global') for (const key of ['createdAt', 'updatedAt']) { delete first[key]; delete second[key]; }
  return stable(first) === stable(second);
}
function validateRecords(payload) {
  const errors = [];
  for (const store of STORES) {
    const ids = new Set();
    for (const row of payload.data[store]) {
      if (typeof row.id !== 'string' || !row.id.trim()) errors.push(`${store} requires non-empty record IDs.`);
      if (ids.has(row.id)) errors.push(`${store} contains duplicate IDs.`);
      ids.add(row.id);
      if (Object.keys(row).some(key => !FIELDS[store].split(' ').includes(key))) errors.push(`${store} has an unsupported field. No fields will be silently discarded.`);
      for (const [key, value] of Object.entries(row)) {
        if (value === null) continue;
        if (ARRAY_FIELDS.has(key)) { if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) errors.push(`${store}: ${key} must be an array of strings.`); }
        else if (OBJECT_FIELDS.has(key)) { if (!isObject(value)) errors.push(`${store}: ${key} must be an object.`); }
        else if (NUMBER_FIELDS.has(key)) { if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${store}: ${key} must be a finite number.`); }
        else if (BOOLEAN_FIELDS.has(key)) { if (typeof value !== 'boolean') errors.push(`${store}: ${key} must be true or false.`); }
        else if (typeof value !== 'string') errors.push(`${store}: ${key} must be text.`);
      }
      for (const key of ['createdAt', 'updatedAt']) if (typeof row[key] !== 'number' || !Number.isFinite(row[key])) errors.push(`${store} requires valid ${key} timestamps.`);
      const required = store === 'accounts' ? ['name', 'type'] : store === 'strategies' ? ['name'] : store === 'checks' ? ['scope', 'label'] : [];
      for (const key of required) if (typeof row[key] !== 'string' || !row[key].trim()) errors.push(`${store} requires ${key}.`);
      if (store === 'checks' && !['global', 'strategy'].includes(row.scope)) errors.push('Check scope must be global or strategy.');
      if (store === 'checks' && row.scope === 'strategy' && !row.strategyId) errors.push('A strategy check requires a strategy.');
      if (store === 'journals' && row.strategyId && row.strategyIds?.length && row.strategyIds[0] !== row.strategyId) errors.push('A journal has inconsistent strategy links.');
      if (store === 'journals' && row.sopChecks != null && (!isObject(row.sopChecks) || Array.from({ length: 8 }, (_, i) => `rule_${i + 1}`).some(key => !isObject(row.sopChecks[key]) || typeof row.sopChecks[key].confirmed !== 'boolean'))) errors.push('A journal contains an incomplete SOP checklist.');
    }
  }
  return errors;
}

/** Pure browser model, also used by tests without opening a real database. */
export async function inspectBrowserBackup(payload, current, { mode = 'merge' } = {}) {
  const incoming = await preparePortableBackup(payload, 'idb', current.screenshots);
  const errors = validateRecords(incoming);
  if (!['merge', 'replace'].includes(mode)) errors.push('Choose Merge or Replace.');
  const counts = {};
  const final = {};
  for (const store of STORES) {
    const existing = new Map(current.data[store].map(row => [row.id, row]));
    counts[store] = { current: existing.size, incoming: incoming.data[store].length, added: 0, identical: 0, conflicts: 0 };
    for (const row of incoming.data[store]) {
      if (!existing.has(row.id)) counts[store].added++;
      else if (equivalent(store, row, existing.get(row.id))) counts[store].identical++;
      else counts[store].conflicts++;
    }
    if (mode === 'merge' && counts[store].conflicts) errors.push(`${store}: ${counts[store].conflicts} existing record(s) differ. Merge will not overwrite them. Review the backup or explicitly choose Replace.`);
    final[store] = new Set([...(mode === 'merge' ? existing.keys() : []), ...incoming.data[store].map(row => row.id)]);
  }
  const screenshots = { current: Object.keys(current.screenshots).length, incoming: Object.keys(incoming.screenshots).length, added: 0, identical: 0, conflicts: 0 };
  for (const [key, value] of Object.entries(incoming.screenshots)) {
    if (!Object.hasOwn(current.screenshots, key)) screenshots.added++;
    else if (imageData(value).base64 === imageData(current.screenshots[key]).base64) screenshots.identical++;
    else screenshots.conflicts++;
  }
  if (screenshots.conflicts) errors.push('Screenshot names contain different existing content. Existing screenshots will never be overwritten. Rename the conflicting files and their record links first.');
  const ref = (store, id, description) => { if (id != null && !final[store].has(id)) errors.push(`${description} refers to a missing ${store} record.`); };
  for (const store of STORES) for (const row of incoming.data[store]) {
    if (Array.isArray(row.strategyIds)) for (const id of row.strategyIds) ref('strategies', id, store);
    if (row.strategyId) ref('strategies', row.strategyId, store);
    if (row.accountId) ref('accounts', row.accountId, store);
    if (row.planId) ref('trade_plans', row.planId, store);
    if (row.journalId) ref('journals', row.journalId, store);
    for (const key of IMAGE_FIELDS) if (row[key] && (!isScreenshotPath(row[key]) || (!Object.hasOwn(incoming.screenshots, row[key]) && !Object.hasOwn(current.screenshots, row[key])))) errors.push(`${store} references a missing or unsafe screenshot.`);
  }
  const uniqueErrors = [...new Set(errors)];
  const previewToken = await digest(stable({ mode, incoming, current: { ...current, exportedAt: 0 } }));
  return { response: { mode, counts, screenshots, canImport: uniqueErrors.length === 0, errors: uniqueErrors, previewToken }, incoming };
}

async function archiveSnapshot(snapshot) {
  const screenshots = {};
  for (const record of snapshot.screenshots) {
    if (!(record.blob instanceof Blob)) throw new Error('A stored screenshot is incomplete. Export was cancelled so it cannot silently omit that file.');
    screenshots[record.id] = await blobToDataUrl(record.blob);
  }
  return { version: 2, exportedAt: Date.now(), data: Object.fromEntries(STORES.map(store => [store, snapshot[store]])), screenshots };
}
async function api(route, body) {
  let response;
  try { response = await fetch('/api/data/' + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' }); }
  catch { throw new Error('The server is unavailable. Reconnect before managing server data.'); }
  let result;
  try { result = await response.json(); } catch { throw new Error('The backup service returned an unreadable response.'); }
  if (!response.ok) {
    const error = new Error(result.error || result.errors?.join(' ') || 'The backup operation failed.');
    error.errors = result.errors || [error.message];
    throw error;
  }
  return result;
}
function rememberBackup(time = Date.now()) {
  try { localStorage.setItem('tms-last-backup:' + getMode(), String(time)); } catch {}
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('tms-backup', { detail: { lastBackupAt: time } }));
  return time;
}

export async function createBackup() {
  if (getMode() === 'http') return api('export', {});
  const snapshot = await readRawSnapshot();
  const archive = await archiveSnapshot(snapshot);
  // Fill schema defaults to make a browser archive portable to SQLite too.
  for (const store of STORES) archive.data[store] = archive.data[store].map(row => normalizedRecord(store, row));
  return preparePortableBackup(archive, 'http');
}
export async function downloadBackup() {
  const payload = await createBackup();
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `tms-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    rememberBackup();
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  return payload;
}
// Historical callers still receive a complete backup, including every image.
export function exportBackup() { return downloadBackup(); }
export async function getBackupStatus() {
  if (getMode() === 'http') return api('status');
  let lastBackupAt = null;
  try { lastBackupAt = Number(localStorage.getItem('tms-last-backup:' + getMode())) || null; } catch {}
  return { lastBackupAt };
}
export async function previewBackup(payload, { mode = 'merge' } = {}) {
  if (getMode() === 'http') return api('preview', { payload: await preparePortableBackup(payload, 'http'), mode });
  const current = await archiveSnapshot(await readRawSnapshot());
  return (await inspectBrowserBackup(payload, current, { mode })).response;
}
export async function importBackup(fileOrPayload, { mode = 'merge', previewToken } = {}) {
  let payload = fileOrPayload;
  if (typeof fileOrPayload?.text === 'function') {
    try { payload = JSON.parse(await fileOrPayload.text()); } catch { throw new Error('This file does not contain valid backup JSON.'); }
  }
  if (getMode() === 'http') {
    const result = await api('import', { payload: await preparePortableBackup(payload, 'http'), mode, previewToken });
    rememberBackup(result.lastBackupAt);
    return result;
  }
  const snapshot = await readRawSnapshot();
  const current = await archiveSnapshot(snapshot);
  const { response, incoming } = await inspectBrowserBackup(payload, current, { mode });
  if (!previewToken || previewToken !== response.previewToken) throw new Error('The browser data or backup has changed, or a preview is missing. Preview the import again.');
  if (!response.canImport) {
    const error = new Error(response.errors.join(' ')); error.errors = response.errors; throw error;
  }
  const recoveryAt = await saveRecoverySnapshot(snapshot, await preparePortableBackup(current, 'http'));
  const screenshots = Object.entries(incoming.screenshots).map(([id, value]) => ({ id, blob: toBlob(value), mimeType: imageData(value).mime, createdAt: Date.now() }));
  await applyBackupAtomic({ data: incoming.data, screenshots, mode, expected: snapshot });
  rememberBackup(recoveryAt);
  return { ok: true, mode, counts: response.counts, screenshots: response.screenshots, lastBackupAt: recoveryAt, backupCreated: true };
}
