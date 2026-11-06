/** Retrospective review, using the same cache in both storage modes. */
import { data } from './store.js';
import { el, fmtMoney, fmtPct, accountLabel } from './utils.js';
import { reviewTrades, periodRange } from './review-model.js';
import { performanceSummary, performanceGroups } from './performance-model.js';
import { openJournalForm } from './journal.js';

const filters = { account: 'all', period: 'all', dimension: 'instrument' };
const periods = [['all', 'All time'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month']];
const dimensions = [['instrument', 'Instrument'], ['strategy', 'Strategy'], ['direction', 'Direction'], ['weekday', 'Entry weekday']];
const money = value => fmtMoney(value, { sign: true, dp: 2 });
const tone = value => value > 0 ? 'performance-positive' : value < 0 ? 'performance-negative' : '';
const factor = summary => summary.noLosses ? 'No cash losses' : summary.profitFactor === null ? '—' : `${summary.profitFactor.toFixed(2)}×`;

function selectField(label, key, options, update) {
  const input = el('select', { id: `performance-${key}`, name: key, onChange: event => { filters[key] = event.target.value; update(); } },
    ...options.map(([value, text]) => el('option', { value }, text)));
  input.value = filters[key];
  return el('label', { class: 'performance-filter', for: `performance-${key}` }, el('span', {}, label), input);
}
function metric(label, value, description, valueTone = '') {
  return el('div', { class: 'performance-metric' }, el('dt', {}, label), el('dd', { class: valueTone }, value), el('p', {}, description));
}
function comparison(groups, dimension) {
  const heading = dimensions.find(([key]) => key === dimension)[1];
  const labels = [heading, 'Trades', 'Win rate', 'Recorded P&L', 'Average / trade', 'Profit factor'];
  const table = el('table', { class: 'performance-table' },
    el('caption', { class: 'performance-sr-only' }, `Performance by ${heading.toLowerCase()}. Sorted by recorded P&L, highest first.`),
    el('thead', {}, el('tr', {}, ...labels.map(text => el('th', { scope: 'col' }, text)))));
  const body = el('tbody');
  groups.forEach(group => {
    const row = el('tr');
    row.appendChild(el('th', { scope: 'row' }, group.label,
      el('span', { class: 'performance-sample' }, `${group.measuredCount} with cash results${group.missingAmounts ? ` · ${group.missingAmounts} missing` : ''}`)));
    [String(group.total), fmtPct(group.winRate), money(group.pnl), money(group.expectancy), factor(group)].forEach((value, index) =>
      row.appendChild(el('td', { 'data-label': labels[index + 1], class: index === 2 || index === 3 ? tone(group.pnl) : '' }, value)));
    body.appendChild(row);
  });
  table.appendChild(body);
  return el('section', { class: 'performance-comparison', 'aria-labelledby': 'performance-comparison-title' },
    el('div', { class: 'performance-section-head' },
      el('div', {}, el('h2', { id: 'performance-comparison-title' }, `Compare by ${heading.toLowerCase()}`),
        el('p', {}, 'Read the sample size alongside the result. A small sample can change quickly.')),
      el('span', { class: 'performance-count' }, `${groups.length} ${groups.length === 1 ? 'group' : 'groups'}`)),
    dimension === 'strategy' ? el('p', { class: 'performance-overlap' }, 'A trade with multiple strategies appears once in each strategy. Group totals overlap; the summary counts each trade once.') : null, table);
}
function outcomePanel(summary) {
  const outcomes = [['Wins', summary.wins, 'win'], ['Losses', summary.losses, 'loss'], ['Breakeven', summary.breakeven, 'be']];
  return el('section', { class: 'performance-panel', 'aria-labelledby': 'performance-outcomes-title' },
    el('h2', { id: 'performance-outcomes-title' }, 'Outcome mix'),
    el('div', { class: 'performance-outcome-bar', 'aria-hidden': 'true' }, ...outcomes.filter(([, count]) => count).map(([, count, key]) =>
      el('span', { class: `outcome-${key}`, style: { flex: String(count) } }))),
    el('dl', { class: 'performance-outcomes' }, ...outcomes.map(([label, count, key]) =>
      el('div', {}, el('dt', {}, el('span', { class: `performance-dot outcome-${key}`, 'aria-hidden': 'true' }), label),
        el('dd', {}, `${count} `, el('span', {}, `(${fmtPct(count / summary.total * 100, 0)})`))))),
    el('p', { class: 'performance-note' }, 'Win rate excludes breakeven trades. Outcome mix includes every closed trade in this view.'));
}
function qualityPanel(summary, excluded) {
  return el('section', { class: 'performance-panel', 'aria-labelledby': 'performance-quality-title' },
    el('h2', { id: 'performance-quality-title' }, 'Review coverage'),
    el('p', { class: 'performance-coverage' }, `${summary.measuredCount} of ${summary.total}`, el('span', {}, ' closed trades have a cash result')),
    el('p', {}, summary.missingAmounts
      ? `${summary.missingAmounts} ${summary.missingAmounts === 1 ? 'trade is' : 'trades are'} missing a valid amount. Cash metrics use only measured results; add the missing amounts in Journal for a complete review.`
      : 'Every closed trade in this view has a cash result. Breakeven trades contribute $0.'),
    excluded ? el('p', { class: 'performance-note' }, `${excluded} unclosed or unrecognized ${excluded === 1 ? 'entry is' : 'entries are'} excluded from these metrics.`) : null,
    el('a', { class: 'btn btn-ghost', href: '#journal' }, 'Open journal'));
}
export function renderPerformancePage() {
  const root = document.querySelector('[data-page="performance"]');
  if (filters.account !== 'all' && !data.accounts.some(account => account.id === filters.account)) filters.account = 'all';
  root.replaceChildren();
  root.appendChild(el('div', { class: 'page-head performance-head' },
    el('div', {}, el('h1', { class: 'page-title' }, 'Performance'), el('p', { class: 'page-sub' }, 'Find the patterns behind your recorded results.')),
    el('button', { class: 'btn btn-primary', onClick: () => openJournalForm() }, 'Log trade')));
  const content = el('div', { class: 'performance-content' });
  const status = el('p', { class: 'performance-status', role: 'status', 'aria-atomic': 'true' });
  const update = () => {
    const trades = reviewTrades(data.journals, { account: filters.account, ...periodRange(filters.period) });
    const summary = performanceSummary(trades);
    const account = data.accounts.find(item => item.id === filters.account);
    status.textContent = `${account ? accountLabel(account) : 'All accounts'} · ${periods.find(([key]) => key === filters.period)[1]} · ${summary.total} closed ${summary.total === 1 ? 'trade' : 'trades'}`;
    content.replaceChildren();
    if (!summary.total) {
      content.appendChild(el('section', { class: 'performance-empty' },
        el('h2', {}, data.journals.length ? 'No closed trades in this view' : 'Your review starts with a trade'),
        el('p', {}, data.journals.length ? 'Choose another account or a wider period to see your recorded results.' : 'Log a result, amount, and strategy. Your comparisons will take shape as you build your journal.'),
        el('button', { class: 'btn btn-primary', onClick: () => openJournalForm() }, 'Log trade')));
      return;
    }
    content.appendChild(el('dl', { class: 'performance-metrics' },
      metric('Recorded P&L', money(summary.pnl), `${summary.measuredCount} measured results`, tone(summary.pnl)),
      metric('Average / trade', money(summary.expectancy), 'Recorded P&L ÷ measured trades', tone(summary.expectancy)),
      metric('Win rate', fmtPct(summary.winRate), `${summary.wins} wins / ${summary.wins + summary.losses} decided trades`),
      metric('Cash profit factor', factor(summary), 'Gross cash wins ÷ gross cash losses')));
    content.appendChild(comparison(performanceGroups(trades, filters.dimension, data.strategies), filters.dimension));
    content.appendChild(el('div', { class: 'performance-bottom' }, outcomePanel(summary), qualityPanel(summary, trades.length - summary.total)));
    content.appendChild(el('details', { class: 'performance-method' },
      el('summary', {}, 'How these results are calculated'),
      el('p', {}, 'This is a review of recorded trades, not a forecast. Amounts follow each trade’s win or loss sign. Missing or invalid amounts are excluded from cash calculations; breakeven is $0. “No cash losses” means measured winning cash exists with no measured losing cash, not that every trade won.'),
      el('p', {}, 'Dates use entry day in your local timezone, falling back to the record’s creation date when no entry date is saved. Records without either date appear in All time with an Unknown date group. Strategy groups may overlap. Dollar values follow the app’s existing currency convention; account balances, deposits, and fees not included in your recorded amounts are not used.')));
  };
  root.appendChild(el('div', { class: 'performance-toolbar', 'aria-label': 'Performance filters' },
    selectField('Account', 'account', [['all', 'All accounts'], ...data.accounts.map(account => [account.id, accountLabel(account)])], update),
    selectField('Period', 'period', periods, update), selectField('Compare by', 'dimension', dimensions, update)));
  root.append(status, content);
  update();
}
