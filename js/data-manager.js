/** Complete backups and explicit, previewed imports for both storage modes. */
import { getMode } from './db.js';
import { el, toast, confirmDialog } from './utils.js';
import { openFormPanel } from './forms.js';
import { data, loadAll } from './store.js';

const names = { accounts: 'Accounts', strategies: 'Strategies', journals: 'Trades', trade_plans: 'Trade plans', checks: 'Checklist rules' };

export function openDataManager() {
  const isServer = getMode() === 'http';
  let payload = null;
  let preview = null;
  let busy = false;
  let sequence = 0;
  const status = el('p', { class: 'backup-status', role: 'status' }, 'Checking your last backup…');
  const feedback = el('div', { class: 'form-error', role: 'alert', hidden: true });
  const previewRoot = el('div', { class: 'import-preview', 'aria-live': 'polite' }, el('p', {}, 'Choose a complete TMS JSON backup to preview it. No data changes until you confirm.'));
  const apply = el('button', { class: 'btn btn-primary', disabled: true }, 'Preview a backup first');
  const file = el('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Choose TMS backup file' });
  const importMode = el('select', { class: 'native-select', 'aria-label': 'Import method' },
    el('option', { value: 'merge' }, 'Merge · keep current records'),
    el('option', { value: 'replace' }, 'Replace · use records from this backup'));
  const backup = el('button', { class: 'btn btn-primary' }, 'Download complete backup');

  function showError(error) { feedback.textContent = error.message || String(error); feedback.hidden = false; }
  async function refreshStatus() {
    try {
      const api = await import('./backup.js');
      const result = await api.getBackupStatus();
      status.textContent = result.lastBackupAt ? 'Last in-app backup: ' + new Date(result.lastBackupAt).toLocaleString() : 'No in-app backup recorded yet. Command-line backups may also exist.';
    } catch { status.textContent = 'Backup status unavailable. You can retry downloading a backup.'; }
  }
  async function showPreview() {
    const requestId = ++sequence;
    preview = null;
    apply.disabled = true;
    if (!payload) return;
    previewRoot.replaceChildren(el('p', {}, 'Checking records, links, and screenshots…'));
    feedback.hidden = true;
    try {
      const api = await import('./backup.js');
      const result = await api.previewBackup(payload, { mode: importMode.value });
      if (requestId !== sequence) return;
      preview = result;
      const rows = Object.entries(result.counts).map(([store, count]) => el('tr', {},
        el('th', { scope: 'row' }, names[store] || store),
        el('td', { 'data-label': 'Current' }, count.current),
        el('td', { 'data-label': 'In backup' }, count.incoming),
        el('td', { 'data-label': 'New records' }, count.added),
        el('td', { 'data-label': 'Conflicts' }, count.conflicts)));
      previewRoot.replaceChildren(
        el('h3', {}, importMode.value === 'merge' ? 'Merge preview' : 'Replacement preview'),
        el('div', { class: 'journal-table-wrap' }, el('table', { class: 'journal-table import-table' },
          el('caption', { class: 'sr-only' }, 'Current and incoming records. Identical records are reused.'),
          el('thead', {}, el('tr', {}, ...['Records', 'Current', 'In backup', 'New', 'Conflicts'].map(label => el('th', { scope: 'col' }, label)))),
          el('tbody', {}, ...rows))),
        el('p', {}, result.screenshots.incoming + ' screenshots in backup · ' + result.screenshots.added + ' new · ' + result.screenshots.conflicts + ' conflicts.'),
        el('p', {}, importMode.value === 'merge' ? 'Matching records are reused. Conflicting records or screenshots block the merge.' : 'Current records will be replaced. A full recovery snapshot is saved first; screenshot files are retained.'),
        result.errors?.length ? el('ul', { class: 'form-error' }, ...result.errors.slice(0, 12).map(error => el('li', {}, typeof error === 'string' ? error : JSON.stringify(error)))) : null);
      apply.textContent = importMode.value === 'merge' ? 'Confirm merge' : 'Confirm replacement';
      apply.disabled = !result.canImport || busy;
    } catch (error) {
      if (requestId !== sequence) return;
      previewRoot.replaceChildren(el('p', {}, 'This backup cannot be imported yet.'));
      showError(error);
    }
  }
  file.addEventListener('change', async () => {
    if (busy) return;
    payload = null;
    preview = null;
    apply.disabled = true;
    const selected = file.files?.[0];
    if (!selected) return;
    try {
      if (selected.size > 150 * 1024 * 1024) throw new Error('This file exceeds the 150 MB import limit.');
      payload = JSON.parse(await selected.text());
      await showPreview();
    } catch (error) { showError(error); }
  });
  importMode.addEventListener('change', showPreview);
  backup.addEventListener('click', async () => {
    backup.disabled = true;
    backup.textContent = 'Preparing records and screenshots…';
    feedback.hidden = true;
    try {
      const api = await import('./backup.js');
      await api.downloadBackup();
      toast('Complete backup downloaded.', 'success');
      await refreshStatus();
    } catch (error) { showError(error); }
    finally { backup.disabled = false; backup.textContent = 'Download complete backup'; }
  });
  apply.addEventListener('click', async () => {
    if (busy || !preview?.canImport || !payload) return;
    const mode = importMode.value;
    if (!await confirmDialog({
      title: mode === 'merge' ? 'Merge this backup into your workspace?' : 'Replace your current records?',
      message: mode === 'merge' ? 'New records and screenshots will be added. Existing records will be kept. A recovery snapshot is saved first.' : 'Your current records will be replaced with this backup. A complete recovery snapshot is saved before any changes.',
      confirmLabel: mode === 'merge' ? 'Merge backup' : 'Replace records', danger: mode === 'replace',
    })) return;
    busy = true;
    apply.disabled = true;
    file.disabled = true;
    importMode.disabled = true;
    feedback.hidden = true;
    apply.textContent = 'Saving recovery snapshot and importing…';
    try {
      const api = await import('./backup.js');
      await api.importBackup(payload, { mode, previewToken: preview.previewToken });
      await loadAll();
      previewRoot.replaceChildren(el('h3', {}, 'Import complete'), el('p', {}, 'Your workspace now contains ' + data.accounts.length + ' accounts, ' + data.strategies.length + ' strategies, and ' + data.journals.length + ' trades. The recovery snapshot is retained.'));
      payload = null;
      preview = null;
      file.value = '';
      apply.textContent = 'Import complete';
      toast('Backup imported successfully.', 'success');
      window.dispatchEvent(new Event('tms-backup'));
      await refreshStatus();
    } catch (error) {
      apply.textContent = 'Check preview again';
      await showPreview();
      showError(error);
    } finally {
      busy = false;
      file.disabled = false;
      importMode.disabled = false;
      apply.disabled = !preview?.canImport;
    }
  });
  const body = el('div', { class: 'data-manager' },
    el('div', { class: 'dm-section' }, el('h3', {}, isServer ? 'Your saved workspace' : 'Your separate browser workspace'),
      el('p', {}, isServer ? 'Records are saved on the computer running TMS. Complete backups include every record and screenshot.' : 'Records are saved in this browser on this device. They are separate from the saved workspace. Export regularly.'),
      el('div', { class: 'data-summary-grid' }, ...[['Accounts', data.accounts.length], ['Strategies', data.strategies.length], ['Trades', data.journals.length]].map(([label, count]) => el('div', {}, el('strong', {}, count), el('span', {}, label))))),
    el('section', { class: 'dm-section' }, el('h3', {}, 'Back up your data'), status, backup),
    el('section', { class: 'dm-section' }, el('h3', {}, 'Import with a preview'),
      el('label', { class: 'form-field' }, el('span', {}, 'Complete JSON backup'), file),
      el('label', { class: 'form-field' }, el('span', {}, 'How to import'), importMode),
      feedback, previewRoot, apply),
    !isServer ? el('button', { class: 'btn btn-ghost', onClick: () => { sessionStorage.removeItem('tms-browser-choice'); location.reload(); } }, 'Reconnect to saved workspace') : null);
  openFormPanel({ title: 'Data & backups', body, width: 860, submitLabel: 'Done', onSubmit: () => {} });
  refreshStatus();
}
