/**
 * dashboard.js — Portfolio overview, strategy performance, and recent journal activity.
 */

import { data, strategyStats, setActiveAccount, journalStrategyIds, journalHasStrategy } from './store.js';
import { el, ACCOUNT_TYPES, ACCOUNT_STATUSES, initials, fmtMoney, fmtPct, fmtDate, iconSVG, sparkline, equityCurve, customSelect, accountLabel, makeCardAccessible } from './utils.js';
import { dailyCapBand } from './daily-cap-band.js';
import { go } from './router.js';
import { openAccountForm } from './accounts.js';
import { openStrategyForm } from './strategies.js';
import { openJournalForm, openJournalDetail } from './journal.js';
import { dashboardMiniCalendar } from './calendar.js';
import { pnlChartSection } from './pnl-chart.js';
import { reviewTrades, reviewMetrics, signedPnl, entryTimestamp, periodRange } from './review-model.js';

const dashFilters = { journalAccount: 'all', metricAccount: 'active', metricPeriod: 'all' };

export function renderDashboardPage() {
  const root = document.querySelector('[data-page="dashboard"]');
  root.innerHTML = '';

  // ── Head ──
  const active = data.accounts.find(a => a.id === data.activeAccountId);
  root.appendChild(el('div', { class: 'page-head' },
    el('div', {},
      el('div', { class: 'page-eyebrow' }, 'Overview'),
      el('h1', { class: 'page-title' }, 'Dashboard'),
      el('p', { class: 'page-sub' }, active
        ? `Active: ${accountLabel(active)} · ${fmtMoney(active.capital || 0, { dp: 0 })} balance`
        : 'No active account — create one to get started.')
    ),
    el('div', { class: 'kpi-strip' },
      kpi(data.accounts.length,   'Accounts'),
      kpi(data.strategies.length, 'Strategies'),
      kpi(data.journals.length,  'Journal entries')
    )
  ));
  root.appendChild(performanceSummary());
  const risk = active ? accountRisk(active) : null;
  if (risk) root.appendChild(riskSummary(risk));

  // ── Daily cap band — hidden when active account is in safe state ──
  const band = dailyCapBand(risk);
  if (band) root.appendChild(band);

  // ── Account strip ──
  const accSection = el('section', { class: 'dash-section' },
    el('div', { class: 'dash-section-head' },
      el('h2', {}, 'Portfolio accounts'),
      el('button', { class: 'btn btn-ghost btn-sm', onClick: () => openAccountForm() },
        el('span', { html: iconSVG('plus') }), ' Add'
      )
    )
  );
  if (!data.accounts.length) {
    accSection.appendChild(el('div', { class: 'dash-empty' }, 'No accounts yet. ',
      el('a', { href: '#', onClick: (e) => { e.preventDefault(); openAccountForm(); } }, 'Add one')
    ));
  } else {
    const scroller = el('div', { class: 'account-scroller' });
    data.accounts.forEach(a => scroller.appendChild(accountStripCard(a)));
    accSection.appendChild(scroller);
  }
  root.appendChild(accSection);

  // ── Strategy performance grid ──
  const stratSection = el('section', { class: 'dash-section' },
    el('div', { class: 'dash-section-head' },
      el('div', {}, el('h2', {}, 'Strategy win rate'), el('p', { class: 'metric-caption' }, 'All accounts · all time')),
      el('button', { class: 'btn btn-ghost btn-sm', onClick: () => openStrategyForm() },
        el('span', { html: iconSVG('plus') }), ' Add'
      )
    )
  );
  if (!data.strategies.length) {
    stratSection.appendChild(el('div', { class: 'dash-empty' }, 'No strategies defined yet.'));
  } else {
    const grid = el('div', { class: 'strategy-mini-grid' });
    data.strategies.forEach(s => grid.appendChild(strategyMiniCard(s)));
    stratSection.appendChild(grid);
  }
  root.appendChild(stratSection);

  // ── Cumulative PnL chart ──
  root.appendChild(pnlChartSection());

  // ── Journal trade history ──
  root.appendChild(journalHistorySection());

  // ── Mini PnL calendar (current month) ──
  root.appendChild(dashboardMiniCalendar(dashFilters.journalAccount));

  // ── Doctrine links + copyright ──
  root.appendChild(doctrineFooter());
}

function miniStat(label, value, hint) {
  return el('div', { class: 'mini-stat' },
    el('div', { class: 'mini-stat-l' }, label),
    el('div', { class: 'mini-stat-v' }, value),
    el('div', { class: 'mini-stat-h' }, hint),
  );
}

function doctrineFooter() {
  const wrap = el('section', { class: 'dash-doctrine' },
    el('div', { class: 'doctrine-head' },
      el('div', { class: 'doctrine-eyebrow' }, 'Tyche Capital · Doctrine'),
      el('h2', { class: 'doctrine-title' }, 'The Manual & The Math')
    ),
    el('div', { class: 'doctrine-grid' },
      el('a', { class: 'doctrine-card', href: 'pages/blueprint.html', target: '_blank', rel: 'noopener' },
        el('div', { class: 'doctrine-card-mark' }, 'Manual · 01'),
        el('div', { class: 'doctrine-card-title' }, 'The Trading Manual'),
        el('div', { class: 'doctrine-card-body' }, 'Foundation, technical mastery, and the eight rules of ស្មារតីអង្គភាព.'),
        el('div', { class: 'doctrine-card-cta' }, 'Open blueprint →')
      ),
      el('a', { class: 'doctrine-card', href: 'pages/gold_risk_analysis.html', target: '_blank', rel: 'noopener' },
        el('div', { class: 'doctrine-card-mark' }, 'Brief · 02'),
        el('div', { class: 'doctrine-card-title' }, 'Gold Risk & R:R Analysis'),
        el('div', { class: 'doctrine-card-body' }, 'Optimal risk per trade for XAU/USD on HolaPrime — Kelly, drawdown, and execution plan.'),
        el('div', { class: 'doctrine-card-cta' }, 'Open brief →')
      ),
      el('a', { class: 'doctrine-card', href: 'pages/risk_approach_comparison.html', target: '_blank', rel: 'noopener' },
        el('div', { class: 'doctrine-card-mark' }, 'Study · 03'),
        el('div', { class: 'doctrine-card-title' }, 'Concentration vs Distribution'),
        el('div', { class: 'doctrine-card-body' }, 'One trade at 1% versus three trades at 0.33% — same daily exposure, different outcomes.'),
        el('div', { class: 'doctrine-card-cta' }, 'Open study →')
      ),
      el('a', { class: 'doctrine-card', href: '#sniper' },
        el('div', { class: 'doctrine-card-mark' }, 'Playbook · 04'),
        el('div', { class: 'doctrine-card-title' }, 'Orderflow Sniper Entry Model'),
        el('div', { class: 'doctrine-card-body' }, 'XAUUSD order-flow checklist — six layers, A+/A/B/SKIP tiering, and the no-trade filters.'),
        el('div', { class: 'doctrine-card-cta' }, 'Open playbook →')
      ),
    ),
    el('div', { class: 'doctrine-copy' },
      `© ${new Date().getFullYear()} Chhaynee Seak · Tyche Capital — Trading Management System`
    )
  );
  return wrap;
}

function kpi(v, l, tone) {
  return el('div', { class: 'kpi' + (tone ? ' kpi-' + tone : '') },
    el('div', { class: 'kpi-v' }, String(v)),
    el('div', { class: 'kpi-l' }, l)
  );
}

function performanceSummary() {
  const periods = [{ value: 'all', label: 'All time' }, { value: 'today', label: 'Today' }, { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }, { value: 'month', label: 'This month' }];
  const accountOptions = [{ value: 'active', label: 'Active account' }, { value: 'all', label: 'All accounts' }, ...data.accounts.map(a => ({ value: a.id, label: accountLabel(a) }))];
  const metrics = el('div', { class: 'dashboard-metrics', 'aria-live': 'polite' });
  const caption = el('p', { class: 'metric-caption' });
  function update() {
    const account = dashFilters.metricAccount === 'active' ? data.activeAccountId : dashFilters.metricAccount;
    const range = periodRange(dashFilters.metricPeriod);
    const trades = reviewTrades(data.journals, { ...range, account: account || '__no_account__' });
    const summary = reviewMetrics(trades);
    const scope = account === 'all' ? 'All accounts' : account ? accountLabel(data.accounts.find(a => a.id === account)) : 'No active account selected';
    const period = periods.find(option => option.value === dashFilters.metricPeriod)?.label || 'All time';
    caption.textContent = `${scope} · ${period}${range.from ? ` (${fmtDate(new Date(`${range.from}T12:00:00`))} – ${fmtDate(new Date(`${range.to}T12:00:00`))})` : ''} · Closed trades only. These filters apply to the four metrics below.`;
    const average = summary.averageR;
    metrics.replaceChildren(
      metricCard(fmtMoney(summary.pnl, { sign: true }), 'Closed-trade P&L', 'Sum of recorded trade amounts', summary.pnl > 0 ? 'pos' : summary.pnl < 0 ? 'neg' : ''),
      metricCard(summary.winRate === null ? '—' : fmtPct(summary.winRate, 1), 'Win rate', `${summary.wins} wins · ${summary.losses} losses · ${summary.breakeven} breakeven excluded`),
      metricCard(average === null ? '—' : `${average > 0 ? '+' : ''}${average.toFixed(2)}R`, 'Average signed R', `${summary.rCount} recorded/estimated R values · ${summary.assumedLosses} losses assumed −1R`, average > 0 ? 'pos' : average < 0 ? 'neg' : ''),
      metricCard(summary.total, 'Closed trades', 'Wins, losses and breakeven')
    );
  }
  const accountControl = customSelect(accountOptions, dashFilters.metricAccount, value => { dashFilters.metricAccount = value; update(); });
  accountControl.setAttribute('aria-label', 'Performance account');
  const periodControl = customSelect(periods, dashFilters.metricPeriod, value => { dashFilters.metricPeriod = value; update(); });
  periodControl.setAttribute('aria-label', 'Performance period');
  const section = el('section', { class: 'dash-section dashboard-summary', 'aria-label': 'Trading performance' },
    el('div', { class: 'dash-section-head' }, el('h2', {}, 'Trading performance')),
    el('div', { class: 'dashboard-controls' },
      el('label', { class: 'filter-field' }, el('span', {}, 'Account'), accountControl),
      el('label', { class: 'filter-field' }, el('span', {}, 'Period'), periodControl)
    ), caption, metrics,
    el('p', { class: 'metric-caption' }, 'R averages include breakeven as 0R and exclude wins with no R recorded. Losses with no R recorded use −1R. Open positions, fees and deposits are not included unless recorded in trade amounts.')
  );
  update();
  return section;
}

function metricCard(value, label, caption, tone = '') {
  return el('article', { class: 'kpi' }, el('div', { class: 'kpi-v ' + tone }, String(value)), el('div', { class: 'kpi-l' }, label), el('div', { class: 'metric-caption' }, caption));
}

function accountRisk(account) {
  // Match the server's GMT+7 risk day and recalculate from current entries after each save.
  const riskOffset = 7 * 60 * 60 * 1000;
  const dayLength = 24 * 60 * 60 * 1000;
  const dayStart = Math.floor((Date.now() + riskOffset) / dayLength) * dayLength - riskOffset;
  const todayTrades = data.journals.filter(trade => trade.accountId === account.id && entryTimestamp(trade) >= dayStart && entryTimestamp(trade) < dayStart + dayLength);
  const pnl = reviewMetrics(todayTrades).pnl;
  const startingBalance = Number(account.startingCapital ?? account.capital) || 0;
  const personalPct = Number(account.personalDailyCapPct) || 3;
  const firmPct = Number(account.firmDailyCapPct) || 5;
  const personalCap = startingBalance * personalPct / 100;
  const firmCap = startingBalance * firmPct / 100;
  const loss = Math.max(0, -pnl);
  const personalUsed = personalCap ? loss / personalCap * 100 : 0;
  const firmUsed = firmCap ? loss / firmCap * 100 : 0;
  const capState = firmUsed >= 100 ? 'firm_breached' : personalUsed >= 100 ? 'personal_breached' : personalUsed >= 90 ? 'breach_imminent' : personalUsed >= 70 ? 'warning' : personalUsed >= 40 ? 'caution' : 'safe';
  return { ...account, startingCapital: startingBalance, dailyPnlToday: pnl, personalDailyCapPct: personalPct, firmDailyCapPct: firmPct, personalCapDollars: -personalCap, firmCapDollars: -firmCap, personalCapPctUsed: personalUsed, firmCapPctUsed: firmUsed, capState };
}

function riskSummary(account) {
  const pnl = account.dailyPnlToday;
  const personalCap = Math.abs(account.personalCapDollars);
  const firmCap = Math.abs(account.firmCapDollars);
  const personalUsed = account.personalCapPctUsed;
  const firmUsed = account.firmCapPctUsed;
  const state = !account.startingCapital ? 'Risk limits unavailable: set a starting balance' : firmUsed >= 100 ? 'Firm daily cap reached' : personalUsed >= 100 ? 'Personal daily cap reached' : personalUsed >= 40 ? 'Approaching personal daily cap' : 'Within daily caps';
  return el('section', { class: 'dashboard-risk-summary', 'aria-label': 'Active account daily risk' },
    el('div', {}, el('h2', {}, 'Daily risk · active account'), el('p', { class: 'metric-caption' }, `${accountLabel(account)} · Today GMT+7 · Closed trades only; excludes open positions.`)),
    el('div', { class: 'dashboard-risk-meta' },
      miniStat('Today’s P&L', fmtMoney(pnl, { sign: true }), state),
      miniStat('Personal daily cap', personalCap ? fmtMoney(personalCap) : '—', personalCap ? `${personalUsed.toFixed(0)}% used · ${account.personalDailyCapPct}% of starting balance` : 'Starting balance required'),
      miniStat('Firm daily cap', firmCap ? fmtMoney(firmCap) : '—', firmCap ? `${firmUsed.toFixed(0)}% used · ${account.firmDailyCapPct}% of starting balance` : 'Starting balance required')
    )
  );
}

function accountStripCard(a) {
  const type = ACCOUNT_TYPES[a.type] || ACCOUNT_TYPES['own-funds'];
  const status = ACCOUNT_STATUSES[a.status] || ACCOUNT_STATUSES.active;
  const isActive = data.activeAccountId === a.id;
  const pnl = (a.capital || 0) - (a.startingCapital || 0);
  const pnlPct = a.startingCapital ? (pnl / a.startingCapital) * 100 : 0;
  const maxLoss = a.rules?.maxLossPct ? (a.startingCapital * a.rules.maxLossPct / 100) : null;
  const ddUsed = a.startingCapital && maxLoss ? Math.min(100, Math.max(0, Math.abs(Math.min(0, pnl)) / maxLoss * 100)) : 0;

  return makeCardAccessible(el('article', { class: 'strip-card status-' + (a.status || 'active') + (isActive ? ' is-active' : ''), onClick: e => { if (!e.target.closest('button')) go('accounts/' + a.id); } },
    el('div', { class: 'strip-top' },
      el('div', { class: 'account-avatar', style: { background: type.bg, color: type.fg } }, initials(a.company || a.name)),
      el('div', { class: 'strip-top-meta' },
        el('div', { class: 'strip-name' }, accountLabel(a)),
        el('div', { class: 'strip-type', style: { color: type.fg } }, type.label)
      ),
      el('div', { class: 'strip-status', title: status.label + ' account' },
        el('span', { class: 'status-dot', style: { background: status.color, boxShadow: '0 0 8px ' + status.color + '88' } }),
        el('span', { class: 'strip-status-label', style: { color: status.color } }, status.label)
      )
    ),
    el('div', { class: 'strip-bal' }, fmtMoney(a.capital || 0, { dp: 0 })),
    el('div', { class: 'strip-pnl ' + (pnl >= 0 ? 'pos' : 'neg') },
      (pnl >= 0 ? '+' : '') + fmtMoney(pnl, { dp: 0 }) + ' · ' + fmtPct(pnlPct, 2)
    ),
    el('div', { class: 'strip-dd' },
      el('div', { class: 'strip-dd-l' }, `DD used ${ddUsed.toFixed(0)}%`),
      el('div', { class: 'strip-dd-bar' },
        el('div', { class: 'strip-dd-fill', style: { width: ddUsed + '%' } })
      )
    ),
    isActive
      ? el('div', { class: 'strip-active-pill' }, 'Active')
      : (a.status === 'passed' || a.status === 'blown')
        ? null
        : el('button', { class: 'strip-set-active', onClick: (e) => { e.stopPropagation(); setActiveAccount(a.id); } }, 'Set active')
  ), () => go('accounts/' + a.id));
}

function winRateHue(winRate) {
  const t = Math.max(0, Math.min(100, winRate)) / 100;
  return t * 140;
}

function strategyMiniCard(s) {
  const st = strategyStats(s.id);
  const bts = data.journals.filter(b => journalHasStrategy(b, s.id));
  const metrics = reviewMetrics(bts);
  const curve = equityCurve(bts);

  const hasTrades = metrics.winRate !== null;
  const accent = hasTrades ? `hsl(${winRateHue(metrics.winRate)}, 72%, 56%)` : '#94A3B8';
  const tintBg = hasTrades ? `hsla(${winRateHue(metrics.winRate)}, 72%, 56%, 0.08)` : 'var(--surface)';
  const tintBorder = hasTrades ? `hsla(${winRateHue(metrics.winRate)}, 72%, 56%, 0.35)` : 'var(--border)';

  return makeCardAccessible(el('article', { class: 'strat-mini', onClick: () => go('strategies/' + s.id), style: {
    '--c': accent,
    '--strat-bg': tintBg,
    '--strat-border': tintBorder,
  } },
    el('div', { class: 'strat-mini-head' },
      el('span', { class: 'color-swatch-sm', style: { background: s.color } }),
      el('div', { class: 'strat-mini-name' }, s.name),
      el('span', { class: 'strat-mini-wr' }, metrics.winRate !== null ? fmtPct(metrics.winRate, 0) : '—')
    ),
    el('div', { class: 'strat-mini-sub' },
      el('span', {}, `${metrics.total} closed trades`),
      el('span', {}, metrics.averageR !== null ? `${metrics.averageR > 0 ? '+' : ''}${metrics.averageR.toFixed(2)}R avg` : '—'),
      el('span', {}, st.profitFactor ? 'PF ' + st.profitFactor.toFixed(2) : '—')
    ),
    el('div', { class: 'strat-mini-spark' }, sparkline(curve, 240, 34, s.color))
  ), () => go('strategies/' + s.id));
}

function journalHistorySection() {
  const accountOptions = [{ value: 'all', label: 'All accounts' }, ...data.accounts.map(a => ({ value: a.id, label: accountLabel(a) }))];
  const accountSelect = customSelect(accountOptions, dashFilters.journalAccount, (v) => { dashFilters.journalAccount = v; renderDashboardPage(); });
  accountSelect.setAttribute('aria-label', 'Journal history account');

  const section = el('section', { class: 'dash-section' },
    el('div', { class: 'dash-section-head' },
      el('div', {}, el('h2', {}, 'Journal history'), el('p', { class: 'metric-caption' }, 'Latest 12 trades · all time · account filter also applies to calendar')),
      el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
        accountSelect,
        el('button', { class: 'btn btn-ghost btn-sm', onClick: () => go('journal') }, 'View all'),
        el('button', { class: 'btn btn-ghost btn-sm', onClick: () => openJournalForm() },
          el('span', { html: iconSVG('plus') }), ' Add'
        )
      )
    )
  );

  if (!data.journals.length) {
    section.appendChild(el('div', { class: 'dash-empty' }, 'No journal entries yet. ',
      el('a', { href: '#', onClick: (e) => { e.preventDefault(); openJournalForm(); } }, 'Log your first trade')
    ));
    return section;
  }

  const recent = [...data.journals]
    .filter(b => dashFilters.journalAccount === 'all' || b.accountId === dashFilters.journalAccount)
    .sort((a, b) => entryTimestamp(b) - entryTimestamp(a))
    .slice(0, 12);

  if (!recent.length) {
    section.appendChild(el('div', { class: 'dash-empty' }, 'No journal entries for this account yet.'));
    return section;
  }

  const list = el('div', { class: 'journal-list' });
  recent.forEach(b => list.appendChild(journalRow(b)));
  section.appendChild(list);
  return section;
}

function journalRow(b) {
  const strategies = journalStrategyIds(b).map(id => data.strategies.find(x => x.id === id)).filter(Boolean);
  const primary = strategies[0];
  const stratLabel = strategies.length
    ? strategies.map(s => s.name).join(' + ')
    : 'No strategy';
  const a = data.accounts.find(x => x.id === b.accountId);
  const pnl = signedPnl(b);
  const amtLabel = fmtMoney(pnl, { sign: true });

  return makeCardAccessible(el('div', { class: 'journal-row', onClick: () => openJournalDetail(b) },
    el('div', { class: 'journal-thumb' + (b.screenshotPath ? '' : ' empty'), style: b.screenshotPath ? { backgroundImage: `url(${b.screenshotPathUrl || b.screenshotPath})` } : {} },
      el('span', { class: 'journal-thumb-result ' + (b.result || 'be') }, (b.result || 'be').toUpperCase())
    ),
    el('div', { class: 'journal-body' },
      el('div', { class: 'journal-t' },
        primary ? el('span', { class: 'journal-strat-dot', style: { background: primary.color || '#F59E0B' } }) : null,
        el('span', {}, stratLabel)
      ),
      el('div', { class: 'journal-s' },
        el('span', {}, accountLabel(a)),
        el('span', { class: 'dot-sep' }, '·'),
        el('span', {}, b.instrument || '—'),
        el('span', { class: 'dot-sep' }, '·'),
        el('span', {}, b.timeframe || '—'),
        el('span', { class: 'dot-sep' }, '·'),
        el('span', {}, (b.direction || 'long').toUpperCase())
      )
    ),
    el('div', { class: 'journal-pnl ' + (pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : 'be') }, amtLabel),
    el('div', { class: 'journal-ts' }, fmtDate(entryTimestamp(b)))
  ), () => openJournalDetail(b));
}
