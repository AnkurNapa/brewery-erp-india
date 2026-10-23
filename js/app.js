// Router and event wiring. Each view module exports views, actions and segs.
import { db, load, persist } from './store.js';
import { esc, $ } from './util.js';
import { alerts } from './calc.js';
import * as analytics from './analytics.js';
import { icon } from './icons.js';
import * as home from './views/home.js';
import * as brew from './views/brew.js';
import * as stores from './views/stores.js';
import * as sales from './views/sales.js';
import * as records from './views/records.js';
import * as control from './views/control.js';
import * as help from './views/help.js';
import * as recipes from './views/recipes.js';
import * as setup from './views/setup.js';

const MODULES = [home, brew, recipes, stores, sales, control, records, help, setup];
const VIEWS = Object.assign({}, ...MODULES.map(m => m.views));
const ACTIONS = Object.assign({}, ...MODULES.map(m => m.actions));
const SEGS = Object.assign({}, ...MODULES.map(m => m.segs || {}));

const NAV = [
  ['Overview', [['dash', 'Home'], ['calendar', 'Schedule'], ['help', 'Help']]],
  ['Brewing', [['tanks', 'Tanks'], ['batches', 'Batches'], ['recipes', 'Recipes'], ['packaging', 'Packaging']]],
  ['Stores', [['materials', 'Raw materials'], ['purchasing', 'Purchasing and MRP'], ['equipment', 'Equipment and kegs']]],
  ['Quality and control', [['cip', 'CIP'], ['losses', 'Beer losses'], ['stocktake', 'Stock take']]],
  ['Sales', [['sales', 'Taproom sales'], ['dispatch', 'Dispatch'], ['menu', 'Menu'], ['partners', 'Customers and vendors']]],
  ['Records', [['records', 'Utilities and wastage'], ['reports', 'Reports'], ['tax', 'Excise and tax'], ['setup', 'Brewery setup'], ['settings', 'Settings']]],
];
const TABS = [['dash', 'Home'], ['tanks', 'Tanks'], ['batches', 'Batches'], ['sales', 'Sales']];
// Simple line glyphs for the phone tab bar, drawn inline so there is no icon font to load.
// Detail screens get an iOS style back button to their parent list.
const PARENT = { blr: ['batches', 'Batches'], scan: ['equipment', 'Equipment'], kegscan: ['equipment', 'Equipment'], count: ['stocktake', 'Stock take'], recipe: ['recipes', 'Recipes'], compare: ['recipes', 'Recipes'] };
let depth = 0, prev = null, cur = null;
const TITLES = Object.fromEntries(NAV.flatMap(([, items]) => items));

function route() {
  const [view, ...rest] = location.hash.slice(1).split('/');
  return { view: VIEWS[view] ? view : 'dash', arg: decodeURIComponent(rest.join('/')) };
}

function draw() {
  if (brew.settle()) persist();
  const { view, arg } = route(), n = alerts().length;
  const active = { blr: 'batches', scan: 'equipment', kegscan: 'equipment', count: 'stocktake', recipe: 'recipes', compare: 'recipes' }[view] || view;
  $('brand').textContent = db.settings.name;
  $('sidenav').innerHTML = NAV.map(([g, items]) => `<p class="group">${g}</p>${items.map(([k, t]) => `<a href="#${k}" ${k === active ? 'aria-current="page"' : ''}>${icon(k)}<span class="nav-label">${t}</span>${k === 'dash' && n ? `<span class="badge">${n}</span>` : ''}</a>`).join('')}`).join('');
  $('tabbar').innerHTML = TABS.map(([k, t]) => `<a href="#${k}" ${k === active ? 'aria-current="page"' : ''}>${icon(k, 'tab-ico')}<span>${t}</span></a>`).join('')
    + `<button type="button" data-more ${!TABS.some(([k]) => k === active) ? 'aria-current="page"' : ''}>${icon('more', 'tab-ico')}<span>More</span></button>`;
  if (view !== cur) { prev = cur; cur = view; }
  const up = PARENT[view] && (depth > 0 && TITLES[prev] ? [prev, TITLES[prev]] : PARENT[view]);
  $('main').innerHTML = (up ? `<button class="back" data-back="${up[0]}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>${up[1]}</button>` : '') + VIEWS[view](arg);
  document.title = `${$('main').querySelector('h1')?.textContent || 'Home'} · Brewhouse ERP`;
}

// Only fixed screen names go to analytics: detail pages carry record names in their titles.
const DETAIL = { blr: 'Batch record', recipe: 'Recipe', compare: 'Compare recipes', count: 'Stock take count', scan: 'Keg or machine', kegscan: 'Scan kegs' };
const reportView = () => setTimeout(() => { const v = route().view; analytics.pageView(v, TITLES[v] || DETAIL[v] || 'Home'); });
load();
analytics.init();
if (!analytics.consent()) $('consent').hidden = false;
addEventListener('db', draw);
addEventListener('hashchange', () => { depth++; reportView(); $('q').value = ''; $('results').innerHTML = ''; document.body.classList.remove('menu'); draw(); scrollTo(0, 0); });
addEventListener('afterprint', () => { $('print').innerHTML = ''; });

document.addEventListener('click', e => {
  const choice = e.target.closest('[data-consent]');
  if (choice) {
    analytics.setConsent(choice.dataset.consent);
    $('consent').hidden = true;
    if (choice.dataset.consent === 'granted') reportView();
    return draw();
  }
  const out = e.target.closest('a[href]');
  if (out && /linkedin\.com/.test(out.href)) analytics.track('linkedin_click');
  if (out && out.href.startsWith('mailto:')) analytics.track(/schedule/i.test(out.href) ? 'book_call_click' : 'email_click');
  if (e.target.closest('dialog')) return;
  if (e.target.closest('[data-more]')) return document.body.classList.toggle('menu');
  const back = e.target.closest('[data-back]');
  if (back) return depth > 0 ? history.back() : (location.hash = back.dataset.back);
  if (e.target.matches('.scrim')) return document.body.classList.remove('menu');
  const s = e.target.closest('[data-seg]');
  if (s) { SEGS[s.dataset.seg](s.dataset.v); return draw(); }
  const a = e.target.closest('[data-act]');
  if (a && ACTIONS[a.dataset.act]) {
    e.preventDefault();
    const ev = analytics.ACT_EVENTS[a.dataset.act];
    if (ev) analytics.track(ev, a.dataset.act === 'applyTemplate' ? { template: a.dataset.id } : a.dataset.act.startsWith('csv') ? { report: a.dataset.act.slice(3).toLowerCase() } : {});
    ACTIONS[a.dataset.act](a.dataset.id);
  }
});
$('main').addEventListener('change', e => {
  if (e.target.dataset.status) brew.setStatus(e.target.dataset.status, e.target.value);
  if (e.target.id === 'importFile' && e.target.files[0]) records.importBackup(e.target.files[0]);
});
$('main').addEventListener('input', e => control.onInput(e));

// Search across the records people look up most.
function search(q) {
  const t = q.trim().toLowerCase();
  if (t.length < 2) return [];
  const hit = (...xs) => xs.some(x => String(x || '').toLowerCase().includes(t));
  const r = id => db.recipes.find(x => x.id === id)?.name;
  return [
    ...db.batches.filter(b => hit(b.code, r(b.recipeId))).map(b => [`#blr/${b.id}`, `${b.code} ${r(b.recipeId) || ''}`, 'Batch']),
    ...db.kegs.filter(k => hit(k.code)).map(k => [`#scan/${encodeURIComponent(k.code)}`, k.code, 'Keg']),
    ...db.tanks.filter(k => hit(k.name)).map(() => ['#tanks', 'Tanks', 'Tank']).slice(0, 1),
    ...db.materials.filter(m => hit(m.name)).map(m => ['#materials', m.name, 'Material']),
    ...db.recipes.filter(x => hit(x.name, x.style)).map(x => [`#recipe/${x.id}`, x.name, 'Recipe']),
    ...db.customers.filter(c => hit(c.name, c.city)).map(c => ['#partners', c.name, 'Customer']),
    ...db.sales.filter(s => hit(s.no, s.customer)).slice(-5).map(s => ['#sales', `${s.no} ${s.customer}`, 'Invoice']),
    ...db.counts.filter(c => hit(c.no)).map(c => [`#count/${c.id}`, c.no, 'Stock take']),
  ].slice(0, 12);
}
$('q').addEventListener('input', e => {
  const rows = search(e.target.value);
  $('results').innerHTML = e.target.value.trim().length < 2 ? '' : rows.length
    ? rows.map(([href, label, kind]) => `<a href="${href}" role="option">${esc(label)}<small>${kind}</small></a>`).join('')
    : '<p class="empty">No matches</p>';
});
$('q').addEventListener('keydown', e => { if (e.key === 'Enter') { const a = $('results').querySelector('a'); if (a) location.hash = a.getAttribute('href').slice(1); } if (e.key === 'Escape') { e.target.value = ''; $('results').innerHTML = ''; } });
$('main').addEventListener('submit', e => {
  if (e.target.id === 'setupForm') { e.preventDefault(); return setup.saveSetup(e.target); }
  if (e.target.id === 'scanForm') { e.preventDefault(); return stores.addScan(e.target); }
  if (e.target.id !== 'settingsForm') return;
  e.preventDefault();
  records.saveSettings(e.target);
});
draw();
reportView();
