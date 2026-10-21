import { data, subscribe, setActiveAccount, loadAll } from './store.js';
import { getMode } from './db.js';
import { el, accountLabel, confirmDialog } from './utils.js';
import { storageStatus, subscribeStorageStatus, updateStorageStatus } from './storage-status.js';

let accountControl;
let saveState;
let storageState;
let summary;
let backupState;
let accountSignature = '';

export async function chooseBrowserCopy() {
  if (!await confirmDialog({ title: 'Open the separate browser workspace?', message: 'This browser has its own data. Your saved workspace stays untouched, and records are not automatically synchronized.', confirmLabel: 'Open browser copy' })) return;
  sessionStorage.setItem('tms-browser-choice', '1');
  location.reload();
}

export function showConnectionError(message, allowBrowser = true) {
  const banner = document.getElementById('connection-banner');
  if (!banner) return;
  if (!getMode() && saveState) { saveState.textContent = 'Workspace unavailable'; saveState.dataset.state = 'offline'; }
  banner.hidden = false;
  banner.replaceChildren(
    el('div', {}, el('strong', {}, 'Your saved workspace needs attention'), el('p', {}, message)),
    el('div', { class: 'transfer-actions' },
      el('button', { class: 'btn btn-primary', onClick: () => { sessionStorage.removeItem('tms-browser-choice'); location.reload(); } }, 'Retry connection'),
      allowBrowser ? el('button', { class: 'btn btn-ghost', onClick: chooseBrowserCopy }, 'Open browser copy') : null,
    ),
  );
}

function renderStatus(status) {
  if (!saveState) return;
  saveState.dataset.state = status.connected ? status.state : 'offline';
  saveState.textContent = !status.connected ? 'Connection lost' : status.state === 'saving' ? 'Saving…' : status.state === 'error' ? 'Save failed — retry' : status.state === 'loading' ? 'Connecting…' : 'All changes saved';
  saveState.title = status.error || (status.lastSavedAt ? 'Last saved at ' + new Date(status.lastSavedAt).toLocaleString() : 'Your saved records are loaded');
  storageState.textContent = status.mode === 'http' ? 'Saved to workspace' : status.mode === 'idb' ? 'Browser copy · separate data' : 'Checking saved workspace';
  if (!status.connected) showConnectionError(status.error || 'We could not reach your saved workspace. The records already loaded on this screen are being kept.');
  else if (status.state !== 'error') document.getElementById('connection-banner').hidden = true;
}

function renderAccounts() {
  if (!accountControl) return;
  const signature = JSON.stringify(data.accounts.map(a => [a.id, a.name, a.displayName]));
  if (signature !== accountSignature) {
    accountSignature = signature;
    accountControl.replaceChildren(...(data.accounts.length
      ? data.accounts.map(a => el('option', { value: a.id }, accountLabel(a)))
      : [el('option', { value: '' }, 'No accounts yet')]));
  }
  accountControl.value = data.activeAccountId || '';
  summary.textContent = `${data.accounts.length} accounts · ${data.journals.length} trades`;
  summary.title = 'The trading account is the default for new entries. Page filters control which records are displayed.';
}

export async function refreshBackupStatus() {
  if (!backupState || !getMode()) return;
  try {
    const { getBackupStatus } = await import('./backup.js');
    const { lastBackupAt } = await getBackupStatus();
    backupState.textContent = lastBackupAt ? 'Backup: ' + new Date(lastBackupAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'No in-app backup yet';
  } catch {
    backupState.textContent = 'Backup status unavailable';
  }
}

export function initWorkspace() {
  const bar = document.getElementById('workspace-bar');
  summary = el('p', { class: 'workspace-subtitle' }, 'Connecting to your records…');
  accountControl = el('select', { id: 'workspace-account', class: 'native-select', onChange: () => setActiveAccount(accountControl.value) });
  saveState = el('span', { class: 'save-state', role: 'status', 'aria-live': 'polite' });
  storageState = el('span', { class: 'storage-state' });
  backupState = el('span', { class: 'backup-status' }, 'Checking backup status…');
  const focus = el('button', { class: 'btn btn-ghost', 'aria-pressed': 'false' }, 'Focus');
  const density = el('button', { class: 'btn btn-ghost', 'aria-pressed': 'false' }, 'Compact');
  for (const [button, preference, className] of [[focus, 'tms-focus-mode', 'focus-mode'], [density, 'tms-compact-mode', 'compact-mode']]) {
    const apply = enabled => { document.body.classList.toggle(className, enabled); button.setAttribute('aria-pressed', String(enabled)); };
    apply(localStorage.getItem(preference) === '1');
    button.addEventListener('click', () => {
      const enabled = !document.body.classList.contains(className);
      apply(enabled);
      localStorage.setItem(preference, enabled ? '1' : '0');
      window.dispatchEvent(new Event('tms-view-preferences'));
    });
  }
  const phone = window.matchMedia('(max-width: 640px)');
  const tools = el('details', { class: 'workspace-tools', 'data-responsive-details': '', open: !phone.matches },
    el('summary', {}, 'View options'),
    el('div', { class: 'workspace-actions' }, focus, density),
  );
  phone.addEventListener('change', event => document.querySelectorAll('[data-responsive-details]').forEach(details => { details.open = !event.matches; }));
  bar.replaceChildren(
    el('div', { class: 'workspace-brand' }, el('strong', {}, 'Your trading workspace'), summary),
    el('label', { class: 'workspace-account-field' }, el('span', {}, 'Trading account · default for new entries'), accountControl),
    el('div', { class: 'workspace-status' }, saveState, storageState, backupState),
    tools,
  );
  subscribe(renderAccounts);
  subscribeStorageStatus(renderStatus);
  window.addEventListener('tms-backup', refreshBackupStatus);
  window.addEventListener('tms-data-ready', refreshBackupStatus);
  document.getElementById('sidebar-account').setAttribute('role', 'button');
  document.getElementById('sidebar-account').tabIndex = 0;
  document.getElementById('sidebar-account').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.click(); } });
  setInterval(async () => {
    if (getMode() !== 'http') return;
    try {
      const response = await fetch('/api/accounts', { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error('The saved workspace is unavailable.');
      const reconnecting = !storageStatus.connected;
      if (reconnecting) await loadAll();
      updateStorageStatus({ connected: true, state: storageStatus.state === 'saving' ? 'saving' : storageStatus.state === 'error' ? 'error' : 'saved' });
    } catch {
      updateStorageStatus({ connected: false, state: 'offline', error: 'Connection lost. Loaded records are still here. Reconnect before saving.' });
    }
  }, 30000);
}
