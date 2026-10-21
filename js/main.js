/**
 * main.js — Entry point. Boots the DB, router, and calculator.
 */

import { loadState, state, saveState }  from './state.js';
import { render, restoreControls,
         setTrades, setRR }              from './ui.js';
import { initTheme, toggleTheme }        from './theme.js';
import { initBackground }                from './background.js';

import { loadAll, data, subscribe,
         setActiveAccount }              from './store.js';
import { register, initRouter, current, go } from './router.js';
import { renderDashboardPage }           from './dashboard.js';
import { renderAccountsPage, renderAccountDetail, openAccountForm } from './accounts.js';
import { renderStrategiesPage, renderStrategyDetail, openStrategyForm } from './strategies.js';
import { renderJournalPage, openJournalForm } from './journal.js';
import { renderCalendarPage } from './calendar.js';
import { renderDoctrineChecklistPage } from './doctrine.js';
import { renderSniperPage } from './sniper.js';
import { el, fmtMoney, fmtPct, ACCOUNT_TYPES, initials, accountLabel } from './utils.js';
import { init as initDb, getMode } from './db.js';
import { openDataManager } from './data-manager.js';
import { initWorkspace, showConnectionError } from './workspace.js';

// Expose inline handlers (calculator uses onclick in JSX-free HTML)
window.setTrades   = setTrades;
window.setRR       = setRR;
window.toggleTheme = toggleTheme;

// ── Register routes ─────────────────────────────────────
register('dashboard',   renderDashboardPage);
register('accounts',    (param) => param ? renderAccountDetail(param) : renderAccountsPage());
register('strategies',  (param) => param ? renderStrategyDetail(param) : renderStrategiesPage());
register('journal',     renderJournalPage);
register('calendar',    renderCalendarPage);
register('sniper',      renderSniperPage);
register('doctrine',    (param) => {
  if (param === 'checklist') renderDoctrineChecklistPage();
  else go('dashboard');
});
register('calculator',  () => { syncCalcWithActiveAccount(); renderCalcMeta(); });

function renderCalcMeta() {
  const sub = document.getElementById('calc-page-sub');
  const active = data.accounts.find(a => a.id === data.activeAccountId);
  if (active) sub.textContent = `Synced with ${active.name} — ${fmtMoney(active.capital || 0, { dp: 0 })}.`;
  else        sub.textContent = 'XAU/USD lot sizing — add an account to auto-sync balance.';
}

// ── Sidebar rendering ───────────────────────────────────
function renderSidebar() {
  const active = data.accounts.find(a => a.id === data.activeAccountId);
  const nameEl  = document.getElementById('sa-name');
  const balEl   = document.getElementById('sa-bal');
  const deltaEl = document.getElementById('sa-delta');
  if (!active) {
    nameEl.textContent = 'No account selected';
    balEl.textContent  = fmtMoney(0, { dp: 0 });
    deltaEl.textContent = '—';
    deltaEl.className = 'sa-delta';
    return;
  }
  const type = ACCOUNT_TYPES[active.type] || ACCOUNT_TYPES['own-funds'];
  nameEl.textContent = accountLabel(active);
  nameEl.style.color = type.fg;
  balEl.textContent = fmtMoney(active.capital || 0, { dp: 0 });
  const pnl = (active.capital || 0) - (active.startingCapital || 0);
  const pnlPct = active.startingCapital ? (pnl / active.startingCapital) * 100 : 0;
  deltaEl.textContent = `${pnl >= 0 ? '+' : ''}${fmtMoney(pnl, { dp: 0 })} · ${fmtPct(pnlPct, 2)}`;
  deltaEl.className = 'sa-delta ' + (pnl >= 0 ? 'pos' : 'neg');
}

// Sidebar add button adapts to current page
function updateAddButton() {
  const route = current() || { name: 'dashboard' };
  const label = document.getElementById('sidebar-add-label');
  const map = {
    dashboard: 'Quick Add',
    accounts:  'Add Account',
    strategies:'Add Strategy',
    journal:   'Add Journal',
    plans:     'New Plan',
    calendar:  'Add Journal',
    calculator: 'Add Account',
  };
  label.textContent = map[route.name] || 'Add New';
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('app-sidebar');
  const returnFocus = sidebar?.contains(document.activeElement);
  sidebar?.classList.remove('open');
  document.getElementById('sidebar-backdrop')?.classList.remove('open');
  document.getElementById('mobile-menu-btn')?.setAttribute('aria-expanded', 'false');
  syncMobileSidebar();
  if (returnFocus && matchMedia('(max-width: 860px)').matches) document.getElementById('mobile-menu-btn')?.focus();
}

function syncMobileSidebar() {
  const sidebar = document.getElementById('app-sidebar');
  const mobile = matchMedia('(max-width: 860px)').matches;
  const open = mobile && sidebar.classList.contains('open');
  sidebar.inert = mobile && !open;
  if (mobile && !open) sidebar.setAttribute('aria-hidden', 'true');
  else sidebar.removeAttribute('aria-hidden');
  document.querySelector('.app-main').inert = open;
  document.getElementById('mobile-menu-btn').setAttribute('aria-expanded', String(open));
  document.getElementById('sidebar-backdrop').classList.toggle('open', open);
}

function onAddClick() {
  const route = current() || { name: 'dashboard' };
  switch (route.name) {
    case 'accounts':    openAccountForm();   break;
    case 'strategies':  openStrategyForm();  break;
    case 'journal':     openJournalForm();   break;
    case 'calendar':    openJournalForm();   break;
    case 'calculator':
    case 'dashboard':
    default:            openAccountForm();   break;
  }
}

// ── Calculator input wiring ────────────────────────────
function clampPct(id, max) {
  const inputEl = document.getElementById(id);
  const v = parseFloat(inputEl.value);
  if (!isNaN(v) && v > max) inputEl.value = max;
  render();
}

function bindInputs() {
  document.getElementById('balance-input').addEventListener('input', render);
  document.getElementById('daily-input')  .addEventListener('input', () => clampPct('daily-input',   100));
  document.getElementById('maxloss-input').addEventListener('input', () => clampPct('maxloss-input', 100));
  document.getElementById('target-input') .addEventListener('input', () => clampPct('target-input',  1000));
  document.getElementById('risk-pct')     .addEventListener('input', render);
  document.getElementById('sl-pips')      .addEventListener('input', render);
  // RR and trades buttons: wire via delegation (replaces onclick)
  document.querySelectorAll('#rr-group .rr-btn').forEach(btn =>
    btn.addEventListener('click', () => setRR(parseInt(btn.dataset.rr)))
  );
  ['tb1','tb2','tb3'].forEach((id, i) =>
    document.getElementById(id).addEventListener('click', () => setTrades(i + 1))
  );
}

function syncCalcWithActiveAccount() {
  const a = data.accounts.find(x => x.id === data.activeAccountId);
  if (!a) return;
  state.balance = a.capital || state.balance;
  if (a.rules?.dailyLossPct) state.dailyPct   = a.rules.dailyLossPct;
  if (a.rules?.maxLossPct)   state.maxlossPct = a.rules.maxLossPct;
  if (a.rules?.targetPct)    state.targetPct  = a.rules.targetPct;
  if (a.rules?.maxRiskPct)   state.riskPct    = Math.min(3, a.rules.maxRiskPct);
  saveState();
  restoreControls();
  render();
  renderCalcMeta();
}

// ── Boot ────────────────────────────────────────────────
async function boot() {
  initWorkspace();
  loadState();
  initTheme();
  initBackground();

  // Restore sidebar collapse state
  if (localStorage.getItem('tms-sidebar-collapsed')) {
    document.body.classList.add('sidebar-collapsed');
  }

  restoreControls();
  bindInputs();
  render();

  // Wire the sidebar/nav/theme buttons
  document.querySelectorAll('.nav-item[data-nav]').forEach(btn =>
    btn.addEventListener('click', () => { go(btn.dataset.nav); closeMobileSidebar(); })
  );
  document.getElementById('sidebar-add').addEventListener('click', () => { onAddClick(); closeMobileSidebar(); });
  document.getElementById('sidebar-data')?.addEventListener('click', () => { openDataManager(); closeMobileSidebar(); });
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  document.getElementById('sidebar-account').addEventListener('click', () => { go('accounts'); closeMobileSidebar(); });

  // Sidebar collapse toggle (desktop)
  document.getElementById('sidebar-collapse')?.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-collapsed');
    localStorage.setItem('tms-sidebar-collapsed', document.body.classList.contains('sidebar-collapsed') ? '1' : '');
  });

  // Mobile close button
  document.getElementById('sidebar-close')?.addEventListener('click', closeMobileSidebar);

  // Mobile sidebar toggle
  const menuBtn = document.getElementById('mobile-menu-btn');
  const backdrop = document.getElementById('sidebar-backdrop');
  menuBtn?.addEventListener('click', () => {
    const isOpen = document.getElementById('app-sidebar').classList.toggle('open');
    syncMobileSidebar();
    if (isOpen) document.getElementById('sidebar-close')?.focus();
  });
  backdrop?.addEventListener('click', closeMobileSidebar);
  const mobileSidebar = matchMedia('(max-width: 860px)');
  mobileSidebar.addEventListener('change', closeMobileSidebar);
  syncMobileSidebar();
  document.addEventListener('keydown', event => {
    const sidebar = document.getElementById('app-sidebar');
    if (!mobileSidebar.matches || !sidebar.classList.contains('open') || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    if (event.key === 'Escape') { event.preventDefault(); closeMobileSidebar(); }
    if (event.key !== 'Tab') return;
    const items = [...sidebar.querySelectorAll('button:not(:disabled), [tabindex="0"]')].filter(node => node.getClientRects().length);
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });

  await initDb();
  console.log(`[tms] storage mode: ${getMode()}`);
  await loadAll();
  // Loading a workspace never deletes, seeds, or rewrites trading records.
  window.dispatchEvent(new Event('tms-data-ready'));

  // Subscribe — re-render whatever page is visible when data changes
  subscribe(() => {
    renderSidebar();
    updateAddButton();
    const r = current();
    if (!r) return;
    const routes = {
      dashboard: renderDashboardPage,
      accounts:  () => r.param ? renderAccountDetail(r.param) : renderAccountsPage(),
      strategies: () => r.param ? renderStrategyDetail(r.param) : renderStrategiesPage(),
      journal:   renderJournalPage,
      calendar:  renderCalendarPage,
      calculator: renderCalcMeta,
      doctrine:  () => r.param === 'checklist' ? renderDoctrineChecklistPage() : null,
    };
    routes[r.name]?.();
  });

  initRouter();
  renderSidebar();
  updateAddButton();

  // Watch hash changes to update the add-button label
  window.addEventListener('hashchange', updateAddButton);
}

boot().catch(error => showConnectionError(error.message));
