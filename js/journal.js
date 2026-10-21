/**
 * journal.js — Gallery + CRUD for trade journal entries.
 * (File kept at journal.js to avoid churn; store is still `journals` in DB.)
 */

import { data, savejournal, deletejournal, strategyById, accountById, saveAccount, journalStrategyIds, executePlan } from './store.js';
import { openFormPanel, field, textInput, numberInput, textArea, select, toggleGroup, imageUpload, multiChips, readForm } from './forms.js';
import { el, INSTRUMENTS, TIMEFRAMES, iconSVG, toast, fmtDate, fmtMoney, customSelect, imageLightbox, accountLabel } from './utils.js';
import { emptyState } from './accounts.js';
import { uid } from './db.js';
import { reviewTrades, signedPnl, signedR, entryTimestamp, localDateValue, dayBoundary, periodRange, balanceAdjustments } from './review-model.js';

const defaultFilters = () => ({ strategy: 'all', account: 'all', result: 'all', instrument: 'all', search: '', from: '', to: '', period: 'all', sort: 'newest' });
let filters = defaultFilters();
let journalView = 'table';
try { journalView = localStorage.getItem('tms-journal-view') === 'gallery' ? 'gallery' : 'table'; } catch { /* Storage may be unavailable in private browsing. */ }
let detailSequence = 0;

// Signed P&L delta a journal entry contributes to its account.
function signedDelta(result, amount) {
  const amt = Math.abs(parseFloat(amount) || 0);
  if (result === 'win')  return amt;
  if (result === 'loss') return -amt;
  return 0;
}

async function applyBalanceChange(accountId, delta) {
  if (!accountId || !delta) return;
  const acct = accountById(accountId);
  if (!acct) return;
  const updated = { ...acct, capital: (parseFloat(acct.capital) || 0) + delta };
  await saveAccount(updated);
}

export function renderJournalPage() {
  const root = document.querySelector('[data-page="journal"]');
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'page-head' },
    el('div', {},
      el('div', { class: 'page-eyebrow' }, 'Trade log'),
      el('h1', { class: 'page-title' }, 'Journal'),
      el('p', { class: 'page-sub' }, 'Review your trades, compare results, and keep the context behind every entry.')
    ),
    el('button', { class: 'btn btn-primary', onClick: () => openJournalForm() },
      el('span', { html: iconSVG('plus') }), ' New entry'
    )
  ));

  if (!data.journals.length) {
    root.appendChild(emptyState('No journal entries yet', 'Log your first trade. Screenshots and notes can be added whenever you are ready.', 'Add journal entry', () => openJournalForm()));
    return;
  }

  const results = el('div', { class: 'journal-content' });
  const count = el('p', { class: 'journal-results', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const filterSummary = el('summary', { class: 'journal-filter-summary' }, 'Filters & sorting');
  const filterDetails = el('details', {
    class: 'journal-filter-details', 'data-responsive-details': '',
    open: window.matchMedia('(min-width: 641px)').matches,
  }, filterSummary);
  // Only replace results while typing, keeping the search input and its focus intact.
  const updateResults = () => {
    const filtered = reviewTrades(data.journals, filters, data);
    count.textContent = `Showing ${filtered.length} of ${data.journals.length} trades`;
    const activeFilters = ['strategy', 'account', 'result', 'instrument'].filter(key => filters[key] !== 'all').length
      + Number(!!(filters.from || filters.to)) + Number(filters.sort !== 'newest');
    const periodLabel = periodOptions.find(option => option.value === filters.period)?.label || 'All time';
    filterSummary.textContent = `Filters & sorting · ${activeFilters ? `${activeFilters} active · ` : ''}${periodLabel}${filters.sort === 'newest' ? '' : ' · Custom sorting'}`;
    results.replaceChildren();
    if (filters.from && filters.to && filters.from > filters.to) {
      results.appendChild(el('div', { class: 'empty-inline journal-empty', role: 'status' }, 'Choose an end date on or after the start date.'));
    } else if (!filtered.length) {
      results.appendChild(el('div', { class: 'empty-inline journal-empty' }, 'No trades match your filters. Try a wider date range or clear the filters.'));
    } else if (journalView === 'gallery') {
      const grid = el('div', { class: 'bt-gallery' });
      filtered.forEach(b => grid.appendChild(journalCard(b)));
      results.appendChild(grid);
    } else results.appendChild(journalTable(filtered));
  };

  const toolbar = el('div', { class: 'journal-toolbar' });
  toolbar.appendChild(el('label', { class: 'filter-field journal-search' },
    el('span', {}, 'Search trades'),
    el('input', { type: 'search', class: 'text-input', value: filters.search, placeholder: 'Instrument, notes, tags, account or strategy…', onInput: e => { filters.search = e.target.value; updateResults(); } })
  ));
  const viewToggle = el('div', { class: 'journal-view-toggle', role: 'group', 'aria-label': 'Journal view' });
  ['table', 'gallery'].forEach(view => viewToggle.appendChild(el('button', {
    type: 'button', class: 'btn btn-ghost journal-view-btn' + (journalView === view ? ' active' : ''),
    'aria-pressed': String(journalView === view),
    onClick: e => {
      journalView = view;
      try { localStorage.setItem('tms-journal-view', view); } catch { /* View remains available for this session. */ }
      viewToggle.querySelectorAll('button').forEach(button => {
        button.classList.toggle('active', button === e.currentTarget);
        button.setAttribute('aria-pressed', String(button === e.currentTarget));
      });
      updateResults();
    },
  }, view === 'table' ? 'Table' : 'Gallery')));
  toolbar.appendChild(viewToggle);
  root.appendChild(toolbar);

  const bar = el('div', { class: 'filter-bar' });
  bar.appendChild(filterSelect('Account', 'account', [{ value: 'all', label: 'All accounts' }, ...data.accounts.map(a => ({ value: a.id, label: accountLabel(a) }))], updateResults));
  bar.appendChild(filterSelect('Strategy', 'strategy', [{ value: 'all', label: 'All strategies' }, ...data.strategies.map(s => ({ value: s.id, label: s.name }))], updateResults));
  bar.appendChild(filterSelect('Result', 'result', [
    { value: 'all', label: 'All results' },
    { value: 'win',  label: 'Wins' },
    { value: 'loss', label: 'Losses' },
    { value: 'be',   label: 'Breakeven' },
  ], updateResults));
  const instruments = [...new Set([...INSTRUMENTS, ...data.journals.map(b => b.instrument).filter(Boolean)])];
  bar.appendChild(filterSelect('Instrument', 'instrument', [{ value: 'all', label: 'All instruments' }, ...instruments.map(i => ({ value: i, label: i }))], updateResults));
  bar.appendChild(filterSelect('Sort by', 'sort', [
    { value: 'newest', label: 'Newest trade' }, { value: 'oldest', label: 'Oldest trade' },
    { value: 'pnl-high', label: 'P&L: high to low' }, { value: 'pnl-low', label: 'P&L: low to high' },
    { value: 'r-high', label: 'R: high to low' }, { value: 'r-low', label: 'R: low to high' },
  ], updateResults));
  filterDetails.appendChild(bar);
  const fromInput = el('input', { type: 'date', class: 'text-input', value: filters.from, 'aria-label': 'Trade date from' });
  const toInput = el('input', { type: 'date', class: 'text-input', value: filters.to, 'aria-label': 'Trade date to' });
  const periodOptions = [{ value: 'all', label: 'All time' }, { value: 'today', label: 'Today' }, { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }, { value: 'month', label: 'This month' }, { value: 'custom', label: 'Custom dates' }];
  let periodControl;
  const updateDates = () => {
    filters.from = fromInput.value;
    filters.to = toInput.value;
    filters.period = 'custom';
    periodControl.setValue('custom');
    updateResults();
  };
  fromInput.addEventListener('change', updateDates);
  toInput.addEventListener('change', updateDates);
  periodControl = customSelect(periodOptions, filters.period, period => {
    filters.period = period;
    if (period !== 'custom') {
      Object.assign(filters, periodRange(period));
      fromInput.value = filters.from;
      toInput.value = filters.to;
    }
    updateResults();
  });
  periodControl.setAttribute('aria-label', 'Journal period');
  filterDetails.appendChild(el('div', { class: 'journal-date-range' },
    el('label', { class: 'filter-field' }, el('span', {}, 'Period'), periodControl),
    el('label', { class: 'filter-field' }, el('span', {}, 'From'), fromInput),
    el('label', { class: 'filter-field' }, el('span', {}, 'To'), toInput),
    el('button', { type: 'button', class: 'btn btn-ghost', onClick: () => {
      filters = defaultFilters();
      toolbar.querySelector('input[type="search"]').value = '';
      bar.querySelectorAll('[data-filter-key]').forEach(control => control.setValue(filters[control.dataset.filterKey]));
      fromInput.value = '';
      toInput.value = '';
      periodControl.setValue('all');
      updateResults();
    } }, 'Clear filters')
  ));
  root.appendChild(filterDetails);
  root.appendChild(count);
  root.appendChild(results);
  updateResults();
}

// Back-compat alias for any old imports.
export const renderjournalPage = renderJournalPage;

function filterSelect(label, key, options, onChange) {
  const control = customSelect(options, filters[key], (v) => { filters[key] = v; onChange(); });
  control.setAttribute('aria-label', label);
  control.dataset.filterKey = key;
  return el('label', { class: 'filter-field' },
    el('span', {}, label),
    control
  );
}

function pnlTone(value) { return value > 0 ? 'pnl-positive' : value < 0 ? 'pnl-negative' : 'pnl-neutral'; }
function rLabel(trade) {
  const value = signedR(trade);
  return value === null ? '—' : `${value > 0 ? '+' : ''}${Number(value.toFixed(2))}R`;
}

function journalTable(trades) {
  const labels = ['Trade date', 'Account', 'Instrument', 'Strategy', 'Result', 'P&L', 'R', 'Actions'];
  const body = el('tbody');
  trades.forEach(b => {
    const pnl = signedPnl(b);
    const strategies = journalStrategyIds(b).map(strategyById).filter(Boolean);
    const values = [fmtDate(entryTimestamp(b)), accountLabel(accountById(b.accountId)),
      `${b.instrument || '—'} · ${b.timeframe || '—'}`, strategies.map(s => s.name).join(' + ') || 'No strategy',
      (b.result || '—').toUpperCase(), fmtMoney(pnl, { sign: true }), rLabel(b)];
    const row = el('tr');
    values.forEach((value, index) => row.appendChild(el('td', { 'data-label': labels[index], class: index === 5 ? pnlTone(pnl) : index === 6 ? pnlTone(signedR(b)) : '' }, value)));
    row.appendChild(el('td', { 'data-label': 'Actions' },
      el('div', { class: 'journal-table-actions' },
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': `View ${b.instrument || 'trade'} on ${fmtDate(entryTimestamp(b))}`, onClick: () => openJournalDetail(b) }, 'View'),
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': `Edit ${b.instrument || 'trade'} on ${fmtDate(entryTimestamp(b))}`, onClick: () => openJournalForm(b) }, 'Edit')
      )
    ));
    body.appendChild(row);
  });
  return el('div', { class: 'journal-table-wrap' }, el('table', { class: 'journal-table', 'aria-label': 'Trade journal' },
    el('thead', {}, el('tr', {}, ...labels.map(label => el('th', { scope: 'col' }, label)))), body
  ));
}

function journalCard(b) {
  const strategies = journalStrategyIds(b).map(strategyById).filter(Boolean);
  const a = accountById(b.accountId);
  const stratChips = strategies.length
    ? strategies.map(s => el('span', { class: 'mini-chip', style: { background: s.color + '22', color: s.color, borderColor: s.color + '55' } }, s.name))
    : [el('span', { class: 'mini-chip' }, 'No strategy')];
  return el('article', { class: 'bt-card', role: 'button', tabindex: '0', 'aria-label': `Review ${b.instrument || 'trade'} on ${fmtDate(entryTimestamp(b))}`, onKeydown: e => {
      if (e.target !== e.currentTarget || !['Enter', ' '].includes(e.key)) return;
      e.preventDefault();
      openJournalDetail(b);
    }, onClick: (e) => {
      if (e.target.closest('button')) return;
      openJournalDetail(b);
    } },
    el('div', { class: 'bt-thumb-lg' },
      (b.screenshotPathUrl || b.screenshotPath)
        ? el('img', { class: 'bt-thumb-image', src: b.screenshotPathUrl || b.screenshotPath, loading: 'lazy', decoding: 'async', alt: `Entry chart for ${b.instrument || 'trade'} on ${fmtDate(entryTimestamp(b))}` })
        : el('div', { class: 'bt-thumb-placeholder' }, 'No screenshot'),
      el('span', { class: 'bt-result-badge ' + (b.result || 'be') }, (b.result || '—').toUpperCase()),
      signedR(b) !== null ? el('span', { class: 'bt-r-badge' }, rLabel(b)) : null
    ),
    el('div', { class: 'bt-card-body' },
      el('div', { class: 'bt-card-row' },
        ...stratChips,
        el('span', { class: 'mini-chip tf' }, b.timeframe || '—'),
        el('span', { class: 'mini-chip inst' }, b.instrument || '—')
      ),
      el('p', { class: 'bt-desc' }, b.description ? b.description.split('\n')[0].slice(0, 140) : 'No description'),
      el('div', { class: 'bt-card-foot' },
        el('span', {}, accountLabel(a)),
        el('span', {}, fmtDate(entryTimestamp(b)))
      ),
      el('div', { class: 'card-actions' },
        el('button', { class: 'btn btn-ghost btn-sm', onClick: (e) => { e.stopPropagation(); openJournalForm(b); } },
          el('span', { html: iconSVG('edit') }), ' Edit'
        ),
        el('span', { class: pnlTone(signedPnl(b)) }, fmtMoney(signedPnl(b), { sign: true }))
      )
    )
  );
}

export function openJournalDetail(b) {
  const strategies = journalStrategyIds(b).map(strategyById).filter(Boolean);
  const a = accountById(b.accountId);
  const titleText = strategies.length ? strategies.map(s => s.name).join(' + ') : 'Untitled strategy';
  const titleId = `journal-detail-title-${++detailSequence}`;
  const previousFocus = document.activeElement;
  const previousOverflow = document.body.style.overflow;
  let closed = false;
  const overlay = el('div', { class: 'bt-detail-overlay' });
  const modal = el('div', { class: 'bt-detail-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' },
    el('div', { class: 'bt-detail-header' },
      el('div', {},
        el('div', { class: 'bt-detail-title', id: titleId }, titleText),
        el('div', { class: 'bt-detail-sub' },
          `${b.instrument || '—'} · ${b.timeframe || '—'} · ${(b.direction || 'long').toUpperCase()} · ${fmtDate(entryTimestamp(b))}`
        ),
        strategies.length > 1 ? el('div', { class: 'chip-row', style: { marginTop: '8px' } },
          ...strategies.map(s => el('span', { class: 'mini-chip', style: { background: s.color + '22', color: s.color, borderColor: s.color + '55' } }, s.name))
        ) : null
      ),
      el('div', { class: 'bt-detail-actions' },
        el('button', { class: 'btn btn-ghost btn-sm', onClick: () => { close(false); openJournalForm(b); } },
          el('span', { html: iconSVG('edit') }), ' Edit'
        ),
        el('button', { class: 'icon-btn', onClick: () => close(), 'aria-label': 'Close' },
          el('span', { html: iconSVG('close') })
        )
      )
    ),
    (b.screenshotPath || b.exitScreenshotPath)
      ? el('div', { class: 'bt-detail-images' },
          b.screenshotPath
            ? el('figure', { class: 'bt-detail-image' },
                el('figcaption', { class: 'bt-detail-image-cap' }, 'Entry'),
                el('img', {
                  src: b.screenshotPathUrl || b.screenshotPath,
                  alt: 'Entry screenshot',
                  role: 'button', tabindex: '0', 'aria-label': 'Enlarge entry screenshot',
                  style: { cursor: 'zoom-in' },
                  onClick: () => imageLightbox(b.screenshotPathUrl || b.screenshotPath, 'Entry screenshot'),
                  onKeydown: e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); imageLightbox(b.screenshotPathUrl || b.screenshotPath, 'Entry screenshot'); } },
                })
              )
            : null,
          b.exitScreenshotPath
            ? el('figure', { class: 'bt-detail-image' },
                el('figcaption', { class: 'bt-detail-image-cap' }, 'Exit · TP / SL'),
                el('img', {
                  src: b.exitScreenshotPathUrl || b.exitScreenshotPath,
                  alt: 'Exit screenshot',
                  role: 'button', tabindex: '0', 'aria-label': 'Enlarge exit screenshot',
                  style: { cursor: 'zoom-in' },
                  onClick: () => imageLightbox(b.exitScreenshotPathUrl || b.exitScreenshotPath, 'Exit screenshot'),
                  onKeydown: e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); imageLightbox(b.exitScreenshotPathUrl || b.exitScreenshotPath, 'Exit screenshot'); } },
                })
              )
            : null,
        )
      : el('div', { class: 'bt-detail-image empty' }, 'No screenshot'),
    el('div', { class: 'bt-detail-meta' },
      metaPill('Result', (b.result || '—').toUpperCase(), `result ${b.result}`),
      metaPill('Signed R', rLabel(b)),
      metaPill(
        b.result === 'loss' ? 'Amount lost ($)' : b.result === 'win' ? 'Amount won ($)' : 'Amount ($)',
        fmtMoney(signedPnl(b), { sign: true }),
        'amount ' + (b.result || '')
      ),
      metaPill('Account', accountLabel(a)),
      metaPill('Entry', fmtDate(entryTimestamp(b)))
    ),
    el('div', { class: 'bt-detail-body' },
      el('h4', {}, 'Notes'),
      el('p', {}, b.description || 'No notes.'),
      (b.tags || []).length ? el('div', { class: 'chip-row', style: { marginTop: '10px' } },
        ...b.tags.map(t => el('span', { class: 'mini-chip' }, '#' + t))
      ) : null
    )
  );
  overlay.appendChild(modal);
  function close(restoreFocus = true) {
    if (closed) return;
    closed = true;
    overlay.classList.remove('open');
    overlay.inert = true;
    document.removeEventListener('keydown', onKey, true);
    document.body.style.overflow = previousOverflow;
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus();
    setTimeout(() => overlay.remove(), 220);
  }
  function onKey(e) {
    // A screenshot lightbox opened above this dialog owns its own keyboard handling.
    if (!overlay.contains(document.activeElement)) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
    if (e.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll('button, a[href], [tabindex="0"]')].filter(node => !node.disabled && node.getClientRects().length);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first) { e.preventDefault(); modal.focus(); }
    else if (e.shiftKey && (document.activeElement === first || document.activeElement === modal)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.style.overflow = 'hidden';
  document.body.appendChild(overlay);
  requestAnimationFrame(() => { overlay.classList.add('open'); modal.querySelector('[aria-label="Close"]')?.focus(); });
}
function metaPill(label, value, extra = '') {
  return el('div', { class: 'meta-pill ' + extra },
    el('div', { class: 'meta-pill-l' }, label),
    el('div', { class: 'meta-pill-v' }, value)
  );
}

export function openJournalForm(existing = null, defaults = {}) {
  const base = existing ? { ...existing } : { result: 'win', direction: 'long', timeframe: 'H1', instrument: 'XAU/USD', accountId: data.activeAccountId || '', tags: [], strategyIds: [], ...defaults };
  // Keep one identity and a ledger of completed balance steps while this form is open.
  // A retry after a later request fails must not create a second journal or debit twice.
  const entryId = existing?.id || uid();
  const appliedContributions = new Map(existing?.accountId ? [[existing.accountId, signedDelta(existing.result, existing.amount)]] : []);
  let planLinked = false;
  let deleted = false;
  let operationInProgress = false;
  async function reconcileBalance(accountId = null, contribution = 0) {
    for (const step of balanceAdjustments(appliedContributions, accountId, contribution)) {
      await applyBalanceChange(step.accountId, step.delta);
      appliedContributions.set(step.accountId, step.contribution);
    }
  }
  const draftKey = `journal:${existing?.id || 'new'}`;
  let draft = {};
  try {
    const stored = JSON.parse(localStorage.getItem(`tms-draft:${draftKey}`) || 'null');
    const values = stored?.values;
    if (values && typeof values === 'object') {
      // Only hydrate form fields. Record identity, timestamps and metadata always come from the saved record.
      for (const key of ['accountId', 'instrument', 'timeframe', 'direction', 'entryDate', 'result', 'amount', 'rAchieved', 'screenshotPath', 'exitScreenshotPath', 'description', 'tagPending']) {
        if (typeof values[key] === 'string') draft[key] = values[key];
      }
      for (const key of ['strategyIds', 'tags']) {
        if (typeof values[key] === 'string') draft[key] = values[key].split(',').filter(Boolean);
      }
    }
  } catch { /* Malformed or unavailable drafts cannot prevent entry. */ }
  const b = { ...base, ...draft };
  if (Object.hasOwn(draft, 'strategyIds')) b.strategyId = draft.strategyIds[0] || null;
  const planId = defaults.planId || (existing && existing.planId) || null;
  const linkedPlan = planId ? data.plans.find(p => p.id === planId) : null;
  const isDisciplineViolation = !!linkedPlan && linkedPlan.grade === 'SKIP';
  const initialStrategyIds = journalStrategyIds(b);
  const stratOpts = data.strategies.map(s => ({ value: s.id, label: s.name }));
  const instrumentOptions = [...new Set([...INSTRUMENTS, b.instrument].filter(Boolean))].map(value => ({ value, label: value }));
  const timeframeOptions = [...new Set([...TIMEFRAMES, b.timeframe].filter(Boolean))].map(value => ({ value, label: value }));
  const acctOpts = [{ value: '', label: '— Unassigned —' }, ...data.accounts.map(a => ({ value: a.id, label: accountLabel(a) }))];
  const resultToggle = toggleGroup({ name: 'result', value: b.result || 'win', options: [
    { value: 'win',  label: 'Win' },
    { value: 'loss', label: 'Loss' },
    { value: 'be',   label: 'Breakeven' }
  ]});

  const amountField = field('Amount ($)', numberInput({ name: 'amount', value: b.amount != null && b.amount !== '' ? Math.abs(Number(b.amount)) : '', step: 'any', min: 0, placeholder: 'e.g. 150' }));
  const rAchievedField = field('R achieved', numberInput({ name: 'rAchieved', value: b.rAchieved != null && b.rAchieved !== '' ? Math.abs(Number(b.rAchieved)) : '', step: 'any', min: 0, placeholder: 'e.g. 2.8' }), 'Enter a positive magnitude. Losses with no R recorded count as −1R in reviews.');
  const amountRow = el('div', { class: 'form-row' }, amountField, rAchievedField);

  function syncResultFields(result) {
    rAchievedField.style.display = result === 'be' ? 'none' : '';
    const amountLabel = amountField.querySelector('.form-label');
    if (amountLabel) {
      amountLabel.textContent = result === 'loss' ? 'Amount lost ($)' : result === 'be' ? 'Amount ($)' : 'Amount won ($)';
    }
  }
  syncResultFields(b.result || 'win');
  resultToggle.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = resultToggle.querySelector('input[type=hidden]').value;
      syncResultFields(v);
    });
  });

  const body = el('div', {},
    Object.keys(draft).length ? el('p', { class: 'form-help', role: 'status' }, 'Your unsaved draft was restored on this device. Review it, then save when ready.') : null,
    isDisciplineViolation
      ? el('div', { class: 'discipline-warning-banner' },
          el('strong', {}, 'Discipline violation warning:'),
          ' This plan failed must-pass checks. Logging it anyway will be recorded as a discipline violation.')
      : null,
    field('Account', select({ name: 'accountId', value: b.accountId || '', options: acctOpts })),
    row(
      field('Instrument', select({ name: 'instrument', value: b.instrument || 'XAU/USD', options: instrumentOptions })),
      field('Timeframe',  select({ name: 'timeframe',  value: b.timeframe || 'H1', options: timeframeOptions }))
    ),
    row(
      field('Direction', toggleGroup({ name: 'direction', value: b.direction || 'long', options: [
        { value: 'long', label: 'Long' }, { value: 'short', label: 'Short' }
      ]})),
      field('Entry date', textInput({ name: 'entryDate', type: 'date', required: true, value: typeof b.entryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.entryDate) ? b.entryDate : localDateValue(b.entryDate || Date.now()) }))
    ),
    field('Result', resultToggle),
    amountRow,
    field('Strategies', stratOpts.length
      ? multiChips({ name: 'strategyIds', values: initialStrategyIds, options: stratOpts })
      : el('div', { class: 'form-empty-note' }, 'Create a strategy first.'),
      'Choose any strategies that contributed to this trade.'),
    el('details', { class: 'form-details', open: !!(b.screenshotPath || b.exitScreenshotPath) },
      el('summary', {}, 'Screenshots · optional'),
      row(
        field('Entry screenshot', imageUpload({ name: 'screenshotPath', value: b.screenshotPath || '' }), 'Chart at the moment of trade entry.'),
        field('Exit screenshot', imageUpload({ name: 'exitScreenshotPath', value: b.exitScreenshotPath || '' }), 'Chart when TP / SL hit. You can add it later.')
      )
    ),
    el('details', { class: 'form-details', open: !!(b.description || b.tags?.length) },
      el('summary', {}, 'Notes and tags · optional'),
      field('Notes', textArea({ name: 'description', value: b.description || '', rows: 4, placeholder: 'What you saw, why you entered, how it played out…' })),
      field('Tags', tagInput({ name: 'tags', values: b.tags || [], pending: b.tagPending || '' }), 'Type a tag and press Add or Enter.')
    )
  );
  openFormPanel({
    title: existing ? 'Edit journal entry' : 'New journal entry',
    body,
    width: 760,
    draftKey,
    submitLabel: existing ? 'Save changes' : 'Save entry',
    onDelete: existing ? async () => {
      if (operationInProgress) throw new Error('Wait for the current save to finish.');
      operationInProgress = true;
      try {
        if (!deleted) { await deletejournal(entryId); deleted = true; }
        await reconcileBalance();
        toast('Journal entry deleted');
      } finally { operationInProgress = false; }
    } : null,
    onSubmit: async (form) => {
      if (operationInProgress) throw new Error('Wait for the current request to finish.');
      if (deleted) throw new Error('This entry was deleted. Retry Delete to finish updating the account balance.');
      operationInProgress = true;
      try {
        const raw = readForm(form, ['tags', 'strategyIds'], []);
        if (!['win', 'loss', 'be'].includes(raw.result)) throw new Error('Choose a trade result.');
        const entryDate = dayBoundary(raw.entryDate);
        if (entryDate === null) throw new Error('Choose a valid trade date.');
        if (raw.accountId && !accountById(raw.accountId)) throw new Error('Choose an existing account or Unassigned.');
        if (raw.amount && (!Number.isFinite(Number(raw.amount)) || Number(raw.amount) < 0)) throw new Error('Enter an amount of zero or more.');
        if (raw.rAchieved && (!Number.isFinite(Number(raw.rAchieved)) || Number(raw.rAchieved) < 0)) throw new Error('Enter an R value of zero or more.');

        const newResult = raw.result;
        const newAmount = Math.abs(parseFloat(raw.amount) || 0);
        const newAccountId = raw.accountId || null;
        const newStrategyIds = Array.isArray(raw.strategyIds) ? raw.strategyIds.filter(Boolean) : [];

        const obj = {
          ...base,
          id: entryId,
          planId: planId || b.planId || null,
          strategyIds: newStrategyIds,
          strategyId: newStrategyIds[0] || null,
          accountId: newAccountId,
          instrument: raw.instrument,
          timeframe: raw.timeframe,
          direction: raw.direction,
          entryDate: existing && raw.entryDate === localDateValue(existing.entryDate || existing.createdAt) ? existing.entryDate || entryDate : entryDate,
          result: newResult,
          rAchieved: newResult === 'be' ? 0 : newResult === 'loss' ? (Math.abs(parseFloat(raw.rAchieved)) || 0) : (parseFloat(raw.rAchieved) || 0),
          amount: newAmount,
          screenshotPath: raw.screenshotPath || '',
          exitScreenshotPath: raw.exitScreenshotPath || '',
          description: raw.description,
          tags: [...new Set([...(raw.tags || []), (raw.tagPending || '').trim().replace(/^#/, '')].filter(Boolean))],
        };
        const savedJournal = await savejournal(obj);

        // Link once per successful request, keeping retries safe if a later balance request fails.
        if (planId && !existing && !planLinked) {
          await executePlan(planId, savedJournal.id);
          planLinked = true;
        }

        await reconcileBalance(newAccountId, signedDelta(newResult, newAmount));
        toast(existing ? 'Journal entry updated' : 'Journal entry saved');
      } finally { operationInProgress = false; }
    }
  });
}

// Back-compat alias for older imports.
export const openjournalForm = openJournalForm;

function tagInput({ name, values = [], pending = '' }) {
  const selected = new Set(values);
  const wrap = el('div', { class: 'tag-input' });
  const hidden = el('input', { type: 'hidden', name, value: Array.from(selected).join(',') });
  const list = el('div', { class: 'tag-list' });
  const input = el('input', { type: 'text', class: 'text-input tag-text', name: 'tagPending', value: pending, 'aria-label': 'New tag', placeholder: 'e.g. patient' });
  function render() {
    list.innerHTML = '';
    Array.from(selected).forEach(t => {
      list.appendChild(el('span', { class: 'chip active' }, '#' + t,
        el('button', { type: 'button', class: 'chip-remove', 'aria-label': `Remove tag ${t}`, onClick: () => { selected.delete(t); hidden.value = Array.from(selected).join(','); hidden.dispatchEvent(new Event('change', { bubbles: true })); render(); } }, '×')
      ));
    });
  }
  function addTag() {
    const value = input.value.trim().replace(/^#/, '');
    if (value) { selected.add(value); input.value = ''; hidden.value = Array.from(selected).join(','); hidden.dispatchEvent(new Event('change', { bubbles: true })); render(); }
    input.focus();
  }
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } });
  wrap.appendChild(list);
  wrap.appendChild(el('div', { class: 'tag-entry-row', style: { display: 'flex', gap: '8px' } }, input,
    el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: addTag }, 'Add')
  ));
  wrap.appendChild(hidden);
  render();
  return wrap;
}

function row(...c) { return el('div', { class: 'form-row' }, ...c); }
