// Home dashboard, schedule (calendar, tasks, brew planner).
import { db, next, commit, IN_TANK, isDemo, startEmpty } from '../store.js';
import { esc, num, inr0, today, addDays, fmtDate, sum, uid, toast } from '../util.js';
import { head, btn, link, pill, statusCls, panel, table, kpi, vessel, bar, openForm } from '../ui.js';
import { kegMap } from './stores.js';
import { periodSeg, periodRange, periodText, inPeriod, setPeriod } from '../period.js';

// Hidden for this visit only, so a brewer who keeps exploring is reminded next time.
let demoHidden = false;
const demoBar = () => (!isDemo() || demoHidden ? '' : `<div class="demo-bar" role="status"><p><b>You're looking at a demo brewpub.</b> Its batches, stock and tax rates are made up.</p>
  <div class="card-acts">${btn('Start my brewery', 'startOwn')}${btn('Keep exploring', 'hideDemo', '', 'ghost')}</div></div>`);

const setupCard = () => {
  const s = db.settings, steps = [
    ['Brewery details and tax rates', 'Name, GSTIN, state excise and VAT', !!(s.gstin && s.name && s.name !== 'My Brewery'), '<a class="ghost" href="#settings">Open Settings</a>'],
    ['Brewery setup', 'Brew length, brewhouse, HLT, CLT and tanks. Templates for 5, 10 and 20 HL', !!(s.brewhouse?.lengthHL && db.tanks.length), '<a class="ghost" href="#setup">Set up brewery</a>'],
    ['Raw materials', 'Malt, hops, yeast and chemicals with opening stock', db.materials.length > 0, btn('Add material', 'newMat', '', 'ghost')],
    ['First recipe', 'The engine works out gravity, bitterness and cost', db.recipes.length > 0, btn('New recipe', 'newRec', '', 'ghost')],
  ];
  if (steps.every(x => x[2])) return '';
  return panel('Get started', `<ol class="setup">${steps.map(([t, sub, done, act], i) => `<li class="${done ? 'done' : ''}"><span class="num">${done ? '✓' : i + 1}</span><span class="grow"><b>${t}</b><small class="sub">${sub}</small></span>${done ? '' : act}</li>`).join('')}</ol>`);
};
import { rec, beerStock, invoice, alerts, exciseIn, tankLeft, tankFit } from '../calc.js';

const TASK_TYPES = ['Brewing', 'Filling', 'Dispatch', 'Cleaning', 'Maintenance', 'Other'];
const TASK_FIELDS = [
  { k: 'title', label: 'Task', req: 1, wide: 1 }, { k: 'type', label: 'Type', type: 'select', options: TASK_TYPES.map(t => ({ v: t, t })) },
  { k: 'date', label: 'Due', type: 'date' }, { k: 'assignee', label: 'Assigned to' },
];
let month = today().slice(0, 7);

export const views = {
  dash() {
    const stock = beerStock(), list = alerts(), range = periodRange(), when = periodText();
    const left = sum(stock, s => s.total);
    const sales = sum(db.sales.filter(s => inPeriod(s.date, range)), s => invoice(s).total);
    const exc = exciseIn(...range);
    const busy = db.tanks.filter(t => db.batches.some(b => b.tankId === t.id && IN_TANK.concat('Ready').includes(b.status)));
    const max = Math.max(1, ...stock.map(s => s.total));
    const open = db.tasks.filter(t => t.status === 'Open').sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
    return head('Home', `${esc(db.settings.name)} · ${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}`, btn('New batch', 'newBatch'))
      + demoBar() + setupCard() + periodSeg()
      + `<div class="kpis">${kpi(`${num(left, 0)} L`, 'Beer ready to sell', 'hero')}${kpi(`${busy.length}/${db.tanks.length}`, 'Tanks in use')}${kpi(inr0(sales), `Sales ${when}`)}${kpi(inr0(exc), `Excise ${when}`)}${kpi(list.length, 'Alerts', list.length ? 'alert' : '')}</div>
      <div class="cols">
        ${panel('Brewery floor', `<div class="floor">${db.tanks.map(t => {
          const b = db.batches.find(x => x.tankId === t.id && x.status !== 'Sold out' && x.status !== 'Planned');
          return `<a class="floor-tank" href="${b ? '#blr/' + b.id : '#tanks'}">${vessel(t, b ? tankLeft(b) / (t.capacity || 1) : 0)}<b>${esc(t.name)}</b><small>${b ? esc(rec(b.recipeId)?.name) : 'Empty'}</small>${b ? pill(b.status, statusCls(b.status)) : ''}</a>`;
        }).join('')}</div>`, '<a class="link" href="#tanks">All tanks</a>')}
        ${panel('Alerts', list.length ? `<ul class="list">${list.slice(0, 8).map(a => `<li><a href="${a.href}"><i class="dot ${a.lvl}"></i>${esc(a.text)}</a></li>`).join('')}</ul>` : '<p class="empty">All clear.</p>')}
      </div>
      ${kegMap(true)}
      <div class="cols">
        ${panel('Beer on hand', table(['Beer', 'Level', { t: 'Litres', n: 1 }, { t: 'Days left', n: 1 }],
          stock.map(s => `<tr><td>${esc(s.r.name)}</td><td>${bar(s.total, max)}</td><td class="n">${num(s.total, 0)}</td><td class="n">${Number.isFinite(s.daysLeft) ? Math.round(s.daysLeft) : 'n/a'}</td></tr>`)))}
        ${panel('Up next', open.length ? `<ul class="list">${open.map(t => `<li><span class="when">${fmtDate(t.date)}</span>${esc(t.title)} ${pill(t.type, 'grey')}</li>`).join('')}</ul>` : '<p class="empty">No open tasks.</p>', '<a class="link" href="#calendar">Schedule</a>')}
      </div>`;
  },

  calendar() {
    const [y, mo] = month.split('-').map(Number), first = new Date(y, mo - 1, 1), days = new Date(y, mo, 0).getDate();
    const lead = (first.getDay() + 6) % 7, t = today();
    const events = {};
    const add = (d, html) => { if (d?.startsWith(month)) (events[d] ||= []).push(html); };
    for (const k of db.tasks) add(k.date, `<span class="ev ${k.status === 'Done' ? 'done' : ''} t-${TASK_TYPES.includes(k.type) ? k.type.toLowerCase() : 'other'}">${esc(k.title)}</span>`);
    for (const b of db.batches) if (b.status === 'Planned') add(b.date, `<a class="ev t-brewing" href="#blr/${b.id}">Brew ${esc(b.code)}</a>`);
    const cells = Array.from({ length: lead }, () => '<div class="day off"></div>').concat(Array.from({ length: days }, (_, i) => {
      const d = `${month}-${String(i + 1).padStart(2, '0')}`;
      return `<div class="day ${d === t ? 'today' : ''}" data-act="newTask" data-id="${d}"><span class="dn">${i + 1}</span>${(events[d] || []).join('')}</div>`;
    }));
    const plan = beerStock();
    const tasks = [...db.tasks].sort((a, b) => (a.status > b.status) - (a.status < b.status) || a.date.localeCompare(b.date));
    return head('Schedule', 'Brewing, filling, dispatch, cleaning and maintenance in one plan. Tap a day to add a task.', btn('New task', 'newTask', t))
      + panel(`${first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`,
        `<div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="dow">${d}</div>`).join('')}${cells.join('')}</div>`,
        `<div class="seg">${btn('‹', 'monthPrev', '', 'segbtn')}${btn('Today', 'monthNow', '', 'segbtn')}${btn('›', 'monthNext', '', 'segbtn')}</div>`)
      + panel('Brew planner', table(['Beer', { t: 'In stock', n: 1 }, { t: 'Sells per day', n: 1 }, { t: 'Days left', n: 1 }, { t: 'Cycle', n: 1 }, { t: 'In tanks', n: 1 }, 'Brew by', ''],
        plan.map(s => `<tr><td>${esc(s.r.name)}</td><td class="n">${num(s.total, 0)} L</td><td class="n">${num(s.rate)} L</td><td class="n">${Number.isFinite(s.daysLeft) ? Math.round(s.daysLeft) : 'n/a'}</td><td class="n">${s.cycle} d</td><td class="n">${num(s.inTank, 0)} L</td>
          <td>${s.brewBy ? (s.brewBy <= t ? pill('Now', 'low') : fmtDate(s.brewBy)) : 'n/a'}</td><td>${link('Plan brew', 'planBrew', s.r.id)}</td></tr>`))
        + '<p class="note">Brew by = today + days of stock + litres already in tanks − average grain to glass cycle. Sales rate is the last 14 days of taproom sales and dispatch.</p>')
      + panel('Tasks', table(['Due', 'Task', 'Type', 'Assigned', 'Status', ''], tasks.map(k => `<tr class="${k.status === 'Done' ? 'muted' : ''}"><td>${fmtDate(k.date)}</td><td>${esc(k.title)}</td><td>${pill(k.type, 'grey')}</td><td>${esc(k.assignee)}</td>
        <td>${pill(k.status, statusCls(k.status))}</td><td class="acts">${link(k.status === 'Open' ? 'Done' : 'Reopen', 'toggleTask', k.id)}${link('Edit', 'editTask', k.id)}${link('Delete', 'delTask', k.id, 'del')}</td></tr>`)));
  },
};

export const actions = {
  startOwn() {
    if (!confirm('Clear the demo and start your own brewery? This removes every demo batch, recipe, stock line and sale.')) return;
    startEmpty();
    location.hash = 'setup';
    toast('Demo cleared. Set up your brewhouse, then add your tax rates in Settings');
  },
  hideDemo() { demoHidden = true; dispatchEvent(new Event('db')); },
  monthPrev() { const d = new Date(month + '-15'); d.setMonth(d.getMonth() - 1); month = d.toISOString().slice(0, 7); dispatchEvent(new Event('db')); },
  monthNext() { const d = new Date(month + '-15'); d.setMonth(d.getMonth() + 1); month = d.toISOString().slice(0, 7); dispatchEvent(new Event('db')); },
  monthNow() { month = today().slice(0, 7); dispatchEvent(new Event('db')); },
  newTask(date) { openForm({ title: 'New task', fields: TASK_FIELDS, vals: { type: 'Brewing', date: date || today() }, onSave: v => { db.tasks.push({ id: uid(), status: 'Open', ...v }); } }); },
  editTask(id) { const k = db.tasks.find(x => x.id === id); openForm({ title: 'Edit task', fields: TASK_FIELDS, vals: k, onSave: v => { Object.assign(k, v); } }); },
  toggleTask(id) { const k = db.tasks.find(x => x.id === id); k.status = k.status === 'Open' ? 'Done' : 'Open'; commit(); },
  delTask(id) { if (confirm('Delete this task?')) { db.tasks = db.tasks.filter(x => x.id !== id); commit(); } },
  planBrew(rid) {
    const r = rec(rid), s = beerStock().find(x => x.r.id === rid);
    let date = s?.brewBy && s.brewBy > today() ? s.brewBy : addDays(today(), 1);
    const rank = t => (tankFit(t).ok ? 0 : t.hygiene === 'Sanitised' ? 1 : t.hygiene === 'Cleaned' ? 2 : 3);
    const free = db.tanks.filter(t => /ferment|uni/i.test(t.type) && !db.batches.some(b => b.tankId === t.id && !['Sold out', 'Ready'].includes(b.status))).sort((a, b) => rank(a) - rank(b))[0];
    // Brews per day come from the brewhouse cycle. A fermenter that holds two brew lengths gets a double brew.
    const L = (db.settings.brewhouse.lengthHL || 0) * 100, perDay = Math.max(1, Math.floor(16 / (db.settings.brewhouse.cycleHrs || 8)));
    const brewsOn = d => db.batches.filter(b => b.status === 'Planned' && b.date === d).reduce((a, b) => a + Math.max(1, L ? Math.round(b.volume / L) : 1), 0);
    const double = L && free && free.capacity >= 2 * L * 1.1;
    let day = date;
    while (brewsOn(day) + (double ? 2 : 1) > perDay) day = addDays(day, 1);
    date = day;
    const volume = double ? r.size * 2 : r.size;
    const code = next('batch', 'B', 3);
    db.batches.push({ id: uid(), code, recipeId: r.id, recipeVersion: r.version, date, status: 'Planned', volume, og: 0, fg: 0, tankId: free?.id || '', notes: '', readyDate: '', dutyRate: 0, issued: false, issues: [], log: [], brew: { mashTemp: '', preBoil: '', og: '', volume: '', pitchTemp: '', notes: '' } });
    db.tasks.push({ id: uid(), title: `${double ? 'Double brew' : 'Brew'} ${r.name} (${code})`, type: 'Brewing', date, assignee: '', status: 'Open' });
    toast(`${code}${double ? ' (double brew)' : ''} planned for ${date}${free ? ` in ${free.name} (${free.hygiene.toLowerCase()}${free.hygiene === 'Dirty' ? ', CIP needed' : ''})` : ''}. Ingredients are now reserved.`);
    commit();
  },
};
export const segs = { period: setPeriod };
