/** Shared save/connection feedback. Switching storage is always a user choice. */
export const storageStatus = { mode: null, connected: true, state: 'loading', lastSavedAt: null, error: '' };
const listeners = new Set();
let pending = 0;
let batchError = '';
export function updateStorageStatus(patch) {
  Object.assign(storageStatus, patch);
  for (const listener of listeners) listener(storageStatus);
}
export function subscribeStorageStatus(listener) {
  listeners.add(listener);
  listener(storageStatus);
  return () => listeners.delete(listener);
}
export async function trackSave(action) {
  if (pending === 0) batchError = '';
  pending++;
  updateStorageStatus({ state: 'saving', error: '' });
  try {
    const result = await action();
    updateStorageStatus({ state: pending > 1 ? 'saving' : batchError ? 'error' : 'saved', connected: true, lastSavedAt: Date.now(), error: batchError });
    return result;
  } catch (error) {
    batchError = error.message || 'Could not save. Please retry.';
    updateStorageStatus({ state: 'error', error: batchError });
    throw error;
  } finally {
    pending--;
  }
}
