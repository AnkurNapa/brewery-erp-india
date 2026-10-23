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
export const periodSeg = () => seg('period', PERIODS, cur);

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
export const inPeriod = (d, [from, to] = periodRange()) => !!d && d >= from && d <= to;
