// One period filter shared by Home, Reports, Taproom sales, Dispatch, Kegs and Beer losses,
// so the period picked on one screen holds on the next. Periods are calendar periods so far:
// the week from Monday, quarters and the year on the Indian financial year from 1 April.
import { today, addDays, pad } from './util.js';
import { seg } from './ui.js';

export const PERIODS = [['day', 'Today'], ['week', 'This week'], ['month', 'This month'], ['quarter', 'This quarter'], ['year', 'This FY'], ['all', 'All time']];
const TEXT = { day: 'today', week: 'this week', month: 'this month', quarter: 'this quarter', year: 'this financial year', all: 'all time' };
const FY_QUARTER_START = [1, 1, 1, 4, 4, 4, 7, 7, 7, 10, 10, 10];
let cur = 'month';

export const setPeriod = v => { if (PERIODS.some(([k]) => k === v)) cur = v; };
export const periodText = () => TEXT[cur];
const long = d => new Date(d + 'T12:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
// The chosen period is filled blue and its dates are written out, so it is never a guess which one is on.
export const periodSeg = () => {
  const [from, to] = periodRange();
  const shown = cur === 'all' ? 'Showing all records' : cur === 'day' ? `Showing today, ${long(to)}` : `Showing ${long(from)} to ${long(to)}`;
  return `<div class="period">${seg('period', PERIODS, cur)}<p class="period-range" aria-live="polite">${shown}</p></div>`;
};

// [from, to] as ISO dates. "All time" runs open-ended so future-dated records still count.
export function periodRange(p = cur, t = today()) {
  const [y, m] = t.split('-').map(Number);
  const from = {
    day: t,
    week: addDays(t, -((new Date(t + 'T12:00').getDay() + 6) % 7)),
    month: t.slice(0, 8) + '01',
    quarter: `${y}-${pad(FY_QUARTER_START[m - 1], 2)}-01`,
    year: `${m >= 4 ? y : y - 1}-04-01`,
    all: '',
  }[p];
  return [from, p === 'all' ? '9999-12-31' : t];
}
// File name stem for a CSV of the period. downloadCsv adds today's date, which is where every period ends,
// so "sales-2026-10-01-to" becomes sales-2026-10-01-to-2026-10-23.csv.
export const periodFile = name => (cur === 'all' ? `${name}-all-time` : `${name}-${periodRange()[0]}-to`);
export const inPeriod = (d, [from, to] = periodRange()) => !!d && d >= from && d <= to;
