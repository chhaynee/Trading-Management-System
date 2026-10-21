/** db.js — Dual-mode facade: delegates to HTTP or IndexedDB adapter. */

import { createAdapter } from './db-detect.js';
import { enrichAccount, computeJournalGrade, validateSopChecks } from './compute.js';
import { trackSave, updateStorageStatus } from './storage-status.js';

let _adapter = null;
let _mode = null;

export async function init() {
  const { adapter, mode } = await createAdapter();
  _adapter = adapter;
  _mode = mode;
  updateStorageStatus({ mode, state: 'saved', connected: true, error: '' });
}

export function getMode() { return _mode; }

const SCREENSHOT_KEYS = ['screenshotPath', 'exitScreenshotPath'];

/**
 * Resolve `idb://...` paths to blob: URLs WITHOUT touching the canonical
 * path field. The resolved URL is exposed on a sibling `<key>Url` field so
 * render sites can use `b.screenshotPathUrl || b.screenshotPath` while save
 * sites continue using `b.screenshotPath` (canonical).
 */
async function resolveItemScreenshots(item, resolve) {
  let next = item;
  for (const key of SCREENSHOT_KEYS) {
    const val = next?.[key];
    if (val && typeof val === 'string' && val.startsWith('idb://')) {
      const url = await resolve(val);
      if (url) next = { ...next, [key + 'Url']: url };
    }
  }
  return next;
}

async function resolveScreenshots(items) {
  if (_mode !== 'idb') return items;
  const { resolveScreenshotUrl: resolve } = await import('./db-idb.js');
  return Promise.all(items.map(item => resolveItemScreenshots(item, resolve)));
}

async function resolveOneScreenshot(item) {
  if (!item || _mode !== 'idb') return item;
  const { resolveScreenshotUrl: resolve } = await import('./db-idb.js');
  return resolveItemScreenshots(item, resolve);
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const db = {
  async getAll(store) {
    const items = await _adapter.getAll(store);
    if (_mode === 'idb' && store === 'accounts') {
      const journals = await _adapter.getAll('journals');
      const enriched = items.map(a => enrichAccount(a, journals));
      return enriched;
    }
    if (_mode === 'idb' && (store === 'journals' || store === 'plans')) {
      return resolveScreenshots(items);
    }
    return items;
  },
  async get(store, id) {
    const item = await _adapter.get(store, id);
    if (!item) return null;
    if (_mode === 'idb' && store === 'accounts') {
      const journals = await _adapter.getAll('journals');
      return enrichAccount(item, journals);
    }
    if (_mode === 'idb' && (store === 'journals' || store === 'plans')) {
      return resolveOneScreenshot(item);
    }
    return item;
  },
  async put(store, obj) {
    obj.updatedAt = Date.now();
    if (!obj.createdAt) obj.createdAt = obj.updatedAt;
    if (_mode === 'idb' && store === 'journals' && obj.sopChecks) {
      const v = validateSopChecks(obj.sopChecks);
      if (!v.ok) throw new Error(v.msg);
      const { grade, confluenceCount } = computeJournalGrade(obj.sopChecks);
      obj.grade = grade;
      obj.confluenceCount = confluenceCount;
      obj.preGrading = false;
    } else if (_mode === 'idb' && store === 'journals' && !obj.sopChecks) {
      obj.preGrading = true;
    }
    const saved = await trackSave(() => _adapter.put(store, obj));
    if (_mode === 'idb' && (store === 'journals' || store === 'plans')) {
      return resolveOneScreenshot(saved);
    }
    return saved;
  },
  async del(store, id) {
    return trackSave(() => _adapter.del(store, id));
  },
};

export async function uploadScreenshot(file) {
  return trackSave(() => _adapter.uploadScreenshot(file));
}

export async function resolveScreenshotUrl(path) {
  if (!path) return null;
  if (_mode === 'idb') {
    const { resolveScreenshotUrl: resolve } = await import('./db-idb.js');
    return resolve(path);
  }
  return path;
}
