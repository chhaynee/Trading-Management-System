/**
 * accounts.js — CRUD + list / detail rendering for trading accounts.
 */

import { data, saveAccount, deleteAccount, strategyById, setActiveAccount, journalStrategyIds } from './store.js';
import { openFormPanel, field, textInput, numberInput, select, multiChips, toggleGroup, readForm } from './forms.js';
import { el, ACCOUNT_TYPES, ACCOUNT_STATUSES, initials, fmtMoney, fmtPct, iconSVG, toast, sparkline, accountLabel, accountIdentity, makeCardAccessible } from './utils.js';
import { go } from './router.js';
import { openJournalForm, openJournalDetail } from './journal.js';

export function renderAccountsPage() {
  const root = document.querySelector('[data-page="accounts"]');
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'page-head' },
    el('div', {},
      el('div', { class: 'page-eyebrow' }, 'Portfolio'),
      el('h1', { class: 'page-title' }, 'Accounts'),
      el('p', { class: 'page-sub' }, `${data.accounts.length} account${data.accounts.length === 1 ? '' : 's'} — manage rules, risk, and strategy assignments.`)
    ),
    el('button', { class: 'btn btn-primary', onClick: () => openAccountForm() },
      el('span', { html: iconSVG('plus') }), ' New account'
    )
  ));

  if (!data.accounts.length) {
    root.appendChild(emptyState('No accounts yet', 'Create your first portfolio account to start tracking.', 'Add account', () => openAccountForm()));
    return;
  }
  const grid = el('div', { class: 'card-grid accounts-grid' });
  data.accounts.forEach(a => grid.appendChild(accountCard(a)));
  root.appendChild(grid);
}

// Drawdown-used calculation — mirrors dashboard.accountStripCard.
// Returns { ddUsed: 0..100, maxLossDollars: number|null }.
function computeDDUsed(a) {
  const pnl = (a.capital || 0) - (a.startingCapital || 0);
  const maxLossDollars = a.rules?.maxLossPct
    ? (a.startingCapital * a.rules.maxLossPct / 100)
    : null;
  const ddUsed = a.startingCapital && maxLossDollars
    ? Math.min(100, Math.max(0, Math.abs(Math.min(0, pnl)) / maxLossDollars * 100))
    : 0;
  return { ddUsed, maxLossDollars };
}

function accountCard(a) {
  const type = ACCOUNT_TYPES[a.type] || ACCOUNT_TYPES['own-funds'];
  const status = ACCOUNT_STATUSES[a.status] || ACCOUNT_STATUSES.active;
  const { ddUsed, maxLossDollars } = computeDDUsed(a);
  const pnl = (a.capital || 0) - (a.startingCapital || 0);
  const strategies = (a.strategyIds || []).map(strategyById).filter(Boolean);
  const isActive = data.activeAccountId === a.id;

  const card = el('article', { class: 'account-card' + (isActive ? ' is-active' : ''), onClick: (e) => {
    if (e.target.closest('button')) return;
    go('accounts/' + a.id);
  } },
    el('div', { class: 'account-card-top' },
      el('div', { class: 'account-avatar', style: { background: type.bg, color: type.fg } }, initials(a.company || a.name)),
      el('div', { class: 'account-meta' },
        el('div', { class: 'account-name', title: a.name }, a.displayName || a.name || 'Untitled'),
        el('div', { class: 'account-identifier' }, accountIdentity(a))
      ),
      el('div', { class: 'account-status', title: status.label },
        el('span', { class: 'status-dot', style: { background: status.color } }),
        el('span', { class: 'status-label' }, status.label)
      )
    ),
    el('div', { class: 'type-badge', style: { background: type.bg, color: type.fg } }, type.label),
    el('div', { class: 'account-balance-row' },
      el('div', { class: 'balance-main' }, fmtMoney(a.capital || 0, { dp: 0 })),
      el('div', { class: 'balance-delta ' + (pnl >= 0 ? 'pos' : 'neg') },
        (pnl >= 0 ? '▲ ' : '▼ ') + fmtMoney(Math.abs(pnl), { dp: 0 })
      )
    ),
    el('div', { class: 'balance-bar' },
      el('div', { class: 'balance-bar-fill', style: { width: ddUsed + '%', background: 'linear-gradient(90deg, var(--gold), var(--red))' } })
    ),
    el('div', { class: 'balance-foot' },
      el('span', {}, maxLossDollars
        ? `DD limit ${fmtMoney(maxLossDollars, { dp: 0 })}`
        : 'No DD limit set'),
      el('span', {}, maxLossDollars ? `DD used ${ddUsed.toFixed(0)}%` : '—')
    ),
    a.rules ? el('div', { class: 'rule-pills' },
      a.rules.dailyLossPct ? el('span', { class: 'rule-pill' }, `DL ${a.rules.dailyLossPct}%`) : null,
      a.rules.maxLossPct   ? el('span', { class: 'rule-pill' }, `ML ${a.rules.maxLossPct}%`)   : null,
      a.rules.targetPct    ? el('span', { class: 'rule-pill' }, `TP ${a.rules.targetPct}%`)    : null,
      a.rules.maxRiskPct   ? el('span', { class: 'rule-pill' }, `Risk ${a.rules.maxRiskPct}%`) : null,
    ) : null,
    strategies.length ? el('div', { class: 'strategy-chips' },
      ...strategies.slice(0, 4).map(s => el('span', { class: 'strategy-chip', style: { background: s.color + '22', color: s.color, borderColor: s.color + '55' } }, s.name)),
      strategies.length > 4 ? el('span', { class: 'strategy-chip more' }, `+${strategies.length - 4}`) : null
    ) : el('div', { class: 'strategy-chips empty' }, 'No strategies linked'),
    el('div', { class: 'card-actions' },
      el('button', { class: 'btn btn-ghost btn-sm', onClick: () => openAccountForm(a) },
        el('span', { html: iconSVG('edit') }), ' Edit'
      ),
      isActive
        ? el('span', { class: 'active-pill' }, 'Active')
        : (a.status === 'passed' || a.status === 'blown')
          ? null
          : el('button', { class: 'btn btn-ghost btn-sm', onClick: () => { setActiveAccount(a.id); toast(`${a.name} set as active`); } }, 'Set active')
    )
  );
  return makeCardAccessible(card, () => go('accounts/' + a.id));
}

export function openAccountForm(existing = null) {
  const a = existing || { type: 'prop-challenge', status: 'active', strategyIds: [], rules: {} };
  const typeOpts = Object.entries(ACCOUNT_TYPES).map(([v, c]) => ({ value: v, label: c.label }));
  const statusOpts = Object.entries(ACCOUNT_STATUSES).map(([v, c]) => ({ value: v, label: c.label }));
  const strategyOptions = data.strategies.map(s => ({ value: s.id, label: s.name }));

  // Dynamic type-specific fields container
  const typeSpecific = el('div', { class: 'form-type-specific' });
  const typeInput = toggleGroup({ name: 'type', value: a.type, options: typeOpts });

  function renderTypeFields(type) {
    typeSpecific.innerHTML = '';
    const r = a.rules || {};
    const common = [];
    if (type === 'prop-challenge') {
      common.push(
        field('Challenge tier', textInput({ name: 'tier', value: a.tier || '', placeholder: 'e.g. 10K / 25K / 100K' })),
        field('Phase', select({ name: 'phase', value: a.phase || 'phase1', options: [
          { value: 'phase1', label: 'Phase 1' }, { value: 'phase2', label: 'Phase 2' }, { value: 'funded', label: 'Funded' }
        ]})),
        row(
          field('Daily loss %',  numberInput({ name: 'dailyLossPct', value: r.dailyLossPct ?? 5, step: '0.1' })),
          field('Max loss %',    numberInput({ name: 'maxLossPct',   value: r.maxLossPct ?? 10, step: '0.1' }))
        ),
        row(
          field('Profit target %', numberInput({ name: 'targetPct',  value: r.targetPct ?? 8, step: '0.1' })),
          field('Max risk / trade %', numberInput({ name: 'maxRiskPct', value: r.maxRiskPct ?? 1, step: '0.1' }))
        )
      );
    } else if (type === 'prop-instant') {
      common.push(
        row(
          field('Daily loss %', numberInput({ name: 'dailyLossPct', value: r.dailyLossPct ?? 3, step: '0.1' })),
          field('Max loss %',   numberInput({ name: 'maxLossPct', value: r.maxLossPct ?? 6, step: '0.1' }))
        ),
        row(
          field('Payout schedule', select({ name: 'payoutSchedule', value: r.payoutSchedule || 'biweekly', options: [
            { value: 'weekly',  label: 'Weekly' },
            { value: 'biweekly', label: 'Bi-weekly' },
            { value: 'monthly', label: 'Monthly' },
          ]})),
          field('Payout split %', numberInput({ name: 'payoutSplit', value: r.payoutSplit ?? 80, step: '1' }))
        )
      );
    } else if (type === 'own-funds') {
      common.push(
        field('Risk appetite', toggleGroup({ name: 'riskAppetite', value: a.riskAppetite || 'moderate', options: [
          { value: 'conservative', label: 'Conservative' },
          { value: 'moderate', label: 'Moderate' },
          { value: 'aggressive', label: 'Aggressive' },
        ]})),
        field('Personal daily stop %', numberInput({ name: 'dailyLossPct', value: r.dailyLossPct ?? 3, step: '0.1' }))
      );
    } else if (type === 'ea-robot') {
      common.push(
        field('EA name', textInput({ name: 'eaName', value: a.eaName || '', placeholder: 'e.g. GoldPulse v2' })),
        field('Broker', textInput({ name: 'broker', value: a.broker || '', placeholder: 'e.g. ICMarkets' })),
        field('VPS host', textInput({ name: 'vps', value: a.vps || '', placeholder: 'Optional' })),
        field('Daily loss %', numberInput({ name: 'dailyLossPct', value: r.dailyLossPct ?? 5, step: '0.1' }))
      );
    } else if (type === 'backtest') {
      common.push(
        row(
          field('Period start', textInput({ name: 'periodStart', type: 'date', value: a.periodStart || '' })),
          field('Period end',   textInput({ name: 'periodEnd',   type: 'date', value: a.periodEnd   || '' }))
        ),
        row(
          field('Platform', select({ name: 'platform', value: a.platform || 'tradingview', options: [
            { value: 'tradingview',  label: 'TradingView' },
            { value: 'mt4',          label: 'MetaTrader 4' },
            { value: 'mt5',          label: 'MetaTrader 5' },
            { value: 'ninjatrader',  label: 'NinjaTrader' },
            { value: 'manual',       label: 'Manual (paper)' },
            { value: 'other',        label: 'Other' },
          ]})),
          field('Risk per trade %', numberInput({ name: 'riskPerTradePct', value: r.riskPerTradePct ?? 1, step: '0.1' }))
        ),
        field('Hypothesis', textInput({ name: 'hypothesis', value: a.hypothesis || '', placeholder: 'What is this backtest testing? e.g. "A-grade SOP setups only, 1% fixed risk"' }))
      );
    }
    common.forEach(c => typeSpecific.appendChild(c));
  }

  // Hook toggle changes
  const toggleWrap = typeInput;
  toggleWrap.addEventListener('click', () => {
    setTimeout(() => {
      const t = toggleWrap.querySelector('input[type=hidden]').value;
      renderTypeFields(t);
    }, 0);
  });
  renderTypeFields(a.type);

  const body = el('div', {},
    field('Account name', textInput({ name: 'name', value: a.name || '', placeholder: 'e.g. FTMO 100K Phase 1', required: true })),
    field('Short display name', textInput({ name: 'displayName', value: a.displayName || '', placeholder: 'e.g. Prime 2K — Challenge 1' }), 'Optional. Your original account name and number are kept.'),
    field('Account type', typeInput),
    row(
      field('Company / Broker', textInput({ name: 'company', value: a.company || '', placeholder: 'e.g. FTMO' })),
      field('Account number', textInput({ name: 'accountNumber', value: a.accountNumber || '', placeholder: 'Optional' }))
    ),
    row(
      field('Starting capital', numberInput({ name: 'startingCapital', value: a.startingCapital ?? '', placeholder: 'USD', step: '1', required: true })),
      field('Current balance',  numberInput({ name: 'capital',         value: a.capital         ?? '', placeholder: 'USD', step: '0.01' }))
    ),
    field('Status', toggleGroup({ name: 'status', value: a.status || 'active', options: statusOpts })),
    typeSpecific,
    sectionHeader('Attached strategies'),
    strategyOptions.length
      ? multiChips({ name: 'strategyIds', values: a.strategyIds || [], options: strategyOptions })
      : el('div', { class: 'form-empty-note' }, 'Create some strategies first to link them here.')
  );

  openFormPanel({
    title: existing ? 'Edit account' : 'New account',
    body,
    width: 600,
    submitLabel: existing ? 'Save changes' : 'Create account',
    onDelete: existing ? async () => { await deleteAccount(existing.id); toast('Account deleted'); } : null,
    onSubmit: async (form) => {
      const raw = readForm(form, ['strategyIds']);
      const obj = {
        ...a,
        name: raw.name,
        displayName: raw.displayName?.trim() || null,
        type: raw.type,
        company: raw.company,
        accountNumber: raw.accountNumber,
        startingCapital: parseFloat(raw.startingCapital) || parseFloat(raw.capital) || 0,
        capital: parseFloat(raw.capital || raw.startingCapital) || 0,
        status: raw.status,
        strategyIds: raw.strategyIds || [],
        tier: raw.tier,
        phase: raw.phase,
        riskAppetite: raw.riskAppetite,
        eaName: raw.eaName,
        broker: raw.broker,
        vps: raw.vps,
        rules: {
          dailyLossPct: parseFloat(raw.dailyLossPct) || null,
          maxLossPct:   parseFloat(raw.maxLossPct)   || null,
          targetPct:    parseFloat(raw.targetPct)    || null,
          maxRiskPct:   parseFloat(raw.maxRiskPct)   || null,
          payoutSchedule: raw.payoutSchedule,
          payoutSplit:  parseFloat(raw.payoutSplit)  || null,
        },
      };
      await saveAccount(obj);
      toast(existing ? 'Account updated' : 'Account created');
    }
  });
}

function row(...children) { return el('div', { class: 'form-row' }, ...children); }
function sectionHeader(label) { return el('div', { class: 'form-section' }, label); }

export function renderAccountDetail(id) {
  const root = document.querySelector('[data-page="accounts"]');
  const a = data.accounts.find(x => x.id === id);
  if (!a) { go('accounts'); return; }
  const type = ACCOUNT_TYPES[a.type] || ACCOUNT_TYPES['own-funds'];
  const status = ACCOUNT_STATUSES[a.status] || ACCOUNT_STATUSES.active;
  const strategies = (a.strategyIds || []).map(strategyById).filter(Boolean);
  const trades = data.journals.filter(b => b.accountId === a.id);
  const wins = trades.filter(t => t.result === 'win').length;
  const losses = trades.filter(t => t.result === 'loss').length;
  const be = trades.filter(t => t.result === 'be').length;
  const decided = wins + losses;
  const winRate = decided ? (wins / decided) * 100 : 0;
  const rSum = trades.reduce((s, t) => s + (parseFloat(t.rAchieved) || 0) * (t.result === 'loss' ? -1 : t.result === 'be' ? 0 : 1), 0);
  const avgR = trades.length ? rSum / trades.length : 0;
  const amountSum = trades.reduce((s, t) => {
    const amt = Math.abs(parseFloat(t.amount) || 0);
    if (t.result === 'win') return s + amt;
    if (t.result === 'loss') return s - amt;
    return s;
  }, 0);
  const pnl = (a.capital || 0) - (a.startingCapital || 0);
  const pnlPct = a.startingCapital ? (pnl / a.startingCapital) * 100 : 0;
  const isActive = data.activeAccountId === a.id;
  const { ddUsed, maxLossDollars } = computeDDUsed(a);

  const curve = accountEquityCurve(trades, a.startingCapital || 0);

  root.innerHTML = '';
  root.appendChild(el('div', { class: 'page-head' },
    el('div', {},
      el('button', { class: 'back-link', onClick: () => go('accounts') },
        el('span', { html: iconSVG('chevron'), style: { transform: 'rotate(180deg)', display: 'inline-flex' } }), ' All accounts'
      ),
      el('div', { class: 'strategy-detail-title' },
        el('span', { class: 'account-avatar', style: { background: type.bg, color: type.fg } }, initials(a.company || a.name)),
        el('h1', { class: 'page-title', title: a.name }, a.displayName || a.name || 'Untitled')
      ),
      el('div', { class: 'chip-row', style: { marginTop: '10px' } },
        el('span', { class: 'mini-chip', style: { background: type.bg, color: type.fg, borderColor: type.fg + '55' } }, type.label),
        el('span', { class: 'mini-chip' },
          el('span', { class: 'status-dot', style: { background: status.color, display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', marginRight: '6px' } }),
          status.label
        ),
        a.company ? el('span', { class: 'mini-chip' }, a.company) : null,
        a.accountNumber ? el('span', { class: 'mini-chip' }, '#' + a.accountNumber) : null
      )
    ),
    el('div', { class: 'bt-detail-actions' },
      el('button', { class: 'btn btn-ghost', onClick: () => openAccountForm(a) },
        el('span', { html: iconSVG('edit') }), ' Edit'
      ),
      isActive
        ? el('button', { class: 'btn btn-active', type: 'button', disabled: true, title: 'This is your active account' },
            el('span', { html: iconSVG('check') }), ' Active'
          )
        : (a.status === 'passed' || a.status === 'blown')
          ? null
          : el('button', { class: 'btn btn-ghost', onClick: () => { setActiveAccount(a.id); toast(`${a.name} set as active`); } }, 'Set active'),
      el('button', { class: 'btn btn-primary', onClick: () => openJournalForm(null, { accountId: a.id }) },
        el('span', { html: iconSVG('plus') }), ' Add trade'
      )
    )
  ));

  root.appendChild(el('div', { class: 'detail-grid' },
    el('div', { class: 'card detail-main' },
      el('div', { class: 'card-label' }, 'Balance'),
      el('div', { class: 'account-balance-row', style: { marginTop: '8px' } },
        el('div', { class: 'balance-main' }, fmtMoney(a.capital || 0, { dp: 0 })),
        el('div', { class: 'balance-delta ' + (pnl >= 0 ? 'pos' : 'neg') },
          (pnl >= 0 ? '▲ ' : '▼ ') + fmtMoney(Math.abs(pnl), { dp: 0 }) + ' · ' + fmtPct(pnlPct, 2)
        )
      ),
      el('div', { class: 'balance-bar' },
        el('div', { class: 'balance-bar-fill', style: { width: ddUsed + '%', background: 'linear-gradient(90deg, var(--gold), var(--red))' } })
      ),
      el('div', { class: 'balance-foot' },
        el('span', {}, maxLossDollars
          ? `DD limit ${fmtMoney(maxLossDollars, { dp: 0 })}`
          : 'No DD limit set'),
        el('span', {}, maxLossDollars ? `DD used ${ddUsed.toFixed(0)}%` : '—')
      ),
      a.rules ? el('div', { class: 'rule-pills', style: { marginTop: '14px' } },
        a.rules.dailyLossPct ? el('span', { class: 'rule-pill' }, `Daily ${a.rules.dailyLossPct}%`) : null,
        a.rules.maxLossPct   ? el('span', { class: 'rule-pill' }, `Max ${a.rules.maxLossPct}%`) : null,
        a.rules.targetPct    ? el('span', { class: 'rule-pill' }, `Target ${a.rules.targetPct}%`) : null,
        a.rules.maxRiskPct   ? el('span', { class: 'rule-pill' }, `Risk ${a.rules.maxRiskPct}%`) : null,
      ) : null
    ),
    el('div', { class: 'card' },
      el('div', { class: 'card-label' }, 'Trading performance'),
      el('div', { class: 'detail-stats' },
        detailStat(trades.length ? fmtPct(winRate, 1) : '—', 'Win rate'),
        detailStat(trades.length, 'Total trades'),
        detailStat(`${wins}W · ${losses}L · ${be}BE`, 'Breakdown'),
        detailStat(trades.length ? avgR.toFixed(2) + 'R' : '—', 'Avg R / trade'),
        detailStat((rSum >= 0 ? '+' : '') + rSum.toFixed(2) + 'R', 'Net R'),
        detailStat((amountSum >= 0 ? '+' : '') + fmtMoney(amountSum, { dp: 0 }), 'Net P&L'),
      )
    ),
    el('div', { class: 'card' },
      el('div', { class: 'card-label' }, 'Linked strategies'),
      strategies.length
        ? el('div', { class: 'chip-row', style: { marginTop: '8px' } },
            ...strategies.map(s => el('span', { class: 'mini-chip', style: { background: s.color + '22', color: s.color, borderColor: s.color + '55', cursor: 'pointer' }, onClick: () => go('strategies/' + s.id) }, s.name))
          )
        : el('div', { class: 'muted-text' }, 'No strategies linked yet. Edit the account to attach some.')
    )
  ));

  const chartCard = el('section', { class: 'card' },
    el('div', { class: 'card-label' }, 'Equity curve')
  );
  if (trades.length < 1) {
    chartCard.appendChild(el('div', { class: 'muted-text', style: { padding: '12px 0' } }, 'No trades logged yet — add one to start building the curve.'));
  } else {
    const big = el('div', { class: 'account-equity-chart' }, sparkline(curve, 720, 180, pnl >= 0 ? '#F59E0B' : '#F87171'));
    chartCard.appendChild(big);
  }
  root.appendChild(chartCard);

  const tradesSection = el('section', { class: 'card' },
    el('div', { class: 'card-head-row' },
      el('div', { class: 'card-label' }, `Trades · ${trades.length}`),
      el('button', { class: 'btn btn-primary btn-sm', onClick: () => openJournalForm(null, { accountId: a.id }) },
        el('span', { html: iconSVG('plus') }), ' Add trade'
      )
    )
  );
  if (trades.length) {
    const grid = el('div', { class: 'bt-thumb-grid' });
    trades.forEach(t => {
      const s = strategyById(journalStrategyIds(t)[0]);
      const amt = Math.abs(parseFloat(t.amount) || 0);
      const amtLabel = amt
        ? (t.result === 'loss' ? '-' : t.result === 'win' ? '+' : '') + fmtMoney(amt, { dp: 0 })
        : (t.rAchieved ? t.rAchieved + 'R' : '');
      grid.appendChild(el('div', { class: 'bt-thumb', onClick: () => openJournalDetail(t), style: t.screenshotPath ? { backgroundImage: `url(${t.screenshotPath})` } : {} },
        el('div', { class: 'bt-thumb-label' },
          el('span', { class: 'bt-result ' + (t.result || 'be') }, (t.result || 'be').toUpperCase()),
          el('span', {}, amtLabel)
        ),
        s ? el('span', { class: 'bt-thumb-strat', style: { background: s.color + 'cc' } }, s.name) : null
      ));
    });
    tradesSection.appendChild(grid);
  } else {
    tradesSection.appendChild(el('div', { class: 'muted-text', style: { padding: '12px 0' } }, 'No trades for this account yet.'));
  }
  root.appendChild(tradesSection);
}

function detailStat(v, l) {
  return el('div', { class: 'detail-stat' },
    el('div', { class: 'detail-stat-v' }, String(v)),
    el('div', { class: 'detail-stat-l' }, l)
  );
}

function accountEquityCurve(trades, startAt) {
  if (!trades.length) return [startAt];
  const sorted = [...trades].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  let eq = startAt;
  const out = [eq];
  for (const t of sorted) {
    const amt = Math.abs(parseFloat(t.amount) || 0);
    const r = Math.abs(parseFloat(t.rAchieved) || 0);
    const delta = amt || r * 100;  // fall back to R×100 approximation when no dollar amount recorded
    if (t.result === 'win') eq += delta;
    else if (t.result === 'loss') eq -= delta || 1;
    out.push(eq);
  }
  return out;
}

export function emptyState(title, sub, cta, onClick) {
  return el('div', { class: 'empty-state' },
    el('div', { class: 'empty-illus' },
      el('span', { html: '<svg width="64" height="64" viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="26" stroke="currentColor" stroke-width="1.2" opacity="0.25"/><circle cx="32" cy="32" r="16" stroke="currentColor" stroke-width="1.2" opacity="0.4" stroke-dasharray="3 5"/><circle cx="32" cy="32" r="4" fill="currentColor" opacity="0.7"/></svg>' })
    ),
    el('h3', {}, title),
    el('p', {}, sub),
    cta ? el('button', { class: 'btn btn-primary', onClick }, el('span', { html: iconSVG('plus') }), ' ' + cta) : null
  );
}
