// Router and event wiring. Each view module exports views, actions and segs.
import { db, load, persist } from './store.js';
import { esc, $ } from './util.js';
import { alerts } from './calc.js';
import * as home from './views/home.js';
import * as brew from './views/brew.js';
import * as stores from './views/stores.js';
import * as sales from './views/sales.js';
import * as records from './views/records.js';
import * as control from './views/control.js';

const MODULES = [home, brew, stores, sales, control, records];
const VIEWS = Object.assign({}, ...MODULES.map(m => m.views));
const ACTIONS = Object.assign({}, ...MODULES.map(m => m.actions));
const SEGS = Object.assign({}, ...MODULES.map(m => m.segs || {}));

const NAV = [
  ['Overview', [['dash', 'Home'], ['calendar', 'Schedule']]],
  ['Brewing', [['tanks', 'Tanks'], ['batches', 'Batches'], ['recipes', 'Recipes'], ['packaging', 'Packaging']]],
  ['Stores', [['materials', 'Raw materials'], ['purchasing', 'Purchasing and MRP'], ['equipment', 'Equipment and kegs']]],
  ['Quality and control', [['cip', 'CIP'], ['losses', 'Beer losses'], ['stocktake', 'Stock take']]],
  ['Sales', [['sales', 'Taproom sales'], ['dispatch', 'Dispatch'], ['menu', 'Menu'], ['partners', 'Customers and vendors']]],
  ['Records', [['records', 'Utilities and wastage'], ['reports', 'Reports'], ['tax', 'Excise and tax'], ['settings', 'Settings']]],
];
const TABS = [['dash', 'Home'], ['tanks', 'Tanks'], ['batches', 'Batches'], ['sales', 'Sales']];
// Simple line glyphs for the phone tab bar, drawn inline so there is no icon font to load.
const ICON = {
  dash: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
  tanks: '<path d="M7 3h10v12l-5 6-5-6z"/><path d="M7 9h10"/>',
  batches: '<path d="M5 4h14v16H5z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  sales: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
};
// Detail screens get an iOS style back button to their parent list.
const PARENT = { blr: ['batches', 'Batches'], scan: ['equipment', 'Equipment'], count: ['stocktake', 'Stock take'] };
let depth = 0, prev = null, cur = null;
const TITLES = Object.fromEntries(NAV.flatMap(([, items]) => items));
const svg = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;

function route() {
  const [view, ...rest] = location.hash.slice(1).split('/');
  return { view: VIEWS[view] ? view : 'dash', arg: decodeURIComponent(rest.join('/')) };
}

function draw() {
  if (brew.settle()) persist();
  const { view, arg } = route(), n = alerts().length;
  const active = { blr: 'batches', scan: 'equipment', count: 'stocktake' }[view] || view;
  $('side').innerHTML = `<a class="logo" href="#dash"><b>Brewhouse</b><span>Brewery Management ERP</span></a><p class="brand">${esc(db.settings.name)}</p>`
    + NAV.map(([g, items]) => `<p class="group">${g}</p>${items.map(([k, t]) => `<a href="#${k}" ${k === active ? 'aria-current="page"' : ''}>${t}${k === 'dash' && n ? `<span class="badge">${n}</span>` : ''}</a>`).join('')}`).join('');
  $('tabbar').innerHTML = TABS.map(([k, t]) => `<a href="#${k}" ${k === active ? 'aria-current="page"' : ''}>${svg(k)}<span>${t}</span></a>`).join('')
    + `<button type="button" data-more ${!TABS.some(([k]) => k === active) ? 'aria-current="page"' : ''}>${svg('more')}<span>More</span></button>`;
  if (view !== cur) { prev = cur; cur = view; }
  const up = PARENT[view] && (depth > 0 && TITLES[prev] ? [prev, TITLES[prev]] : PARENT[view]);
  $('main').innerHTML = (up ? `<button class="back" data-back="${up[0]}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>${up[1]}</button>` : '') + VIEWS[view](arg);
  document.title = `${$('main').querySelector('h1')?.textContent || 'Home'} · Brewhouse ERP`;
}

load();
addEventListener('db', draw);
addEventListener('hashchange', () => { depth++; document.body.classList.remove('menu'); draw(); scrollTo(0, 0); });
addEventListener('afterprint', () => { $('print').innerHTML = ''; });

document.addEventListener('click', e => {
  if (e.target.closest('dialog')) return;
  if (e.target.closest('[data-more]')) return document.body.classList.toggle('menu');
  const back = e.target.closest('[data-back]');
  if (back) return depth > 0 ? history.back() : (location.hash = back.dataset.back);
  if (e.target.matches('.scrim')) return document.body.classList.remove('menu');
  const s = e.target.closest('[data-seg]');
  if (s) { SEGS[s.dataset.seg](s.dataset.v); return draw(); }
  const a = e.target.closest('[data-act]');
  if (a && ACTIONS[a.dataset.act]) { e.preventDefault(); ACTIONS[a.dataset.act](a.dataset.id); }
});
$('main').addEventListener('change', e => {
  if (e.target.dataset.status) brew.setStatus(e.target.dataset.status, e.target.value);
  if (e.target.id === 'importFile' && e.target.files[0]) records.importBackup(e.target.files[0]);
});
$('main').addEventListener('input', e => control.onInput(e));
$('main').addEventListener('submit', e => {
  if (e.target.id !== 'settingsForm') return;
  e.preventDefault();
  records.saveSettings(e.target);
});
draw();
