// Utilities and wastage, reports, excise and tax, settings and backup.
import { db, commit, replace, clean, isBackup, startEmpty } from '../store.js';
import { esc, num, sg, inr, inr0, today, fmtDate, sum, uid, toast, abv, daysAgo, daysBetween, downloadCsv } from '../util.js';
import { head, btn, link, pill, statusCls, panel, table, kpi, openForm, seg, field, readForm, bar } from '../ui.js';
import { demo } from '../demo.js';
import { consent, setConsent } from '../analytics.js';
import { periodSeg, periodRange, periodText, inPeriod, periodFile } from '../period.js';
import { mat, rec, cust, recipeCalc, invoice, duty, cogs, beerStock, batchCost, efficiency, deviations, batchPackedL, packedL, packLeft, mrp } from '../calc.js';

const UTIL_TYPES = { Electricity: 'kWh', Water: 'kL', 'LPG / PNG': 'kg', CO2: 'kg', Diesel: 'L', Other: '' };
let reportTab = 'business';
const remove = (coll, id, what) => { if (confirm(`Delete this ${what}?`)) { db[coll] = db[coll].filter(x => x.id !== id); commit(); } };

const REPORTS = {
  business() {
    const range = periodRange(), sales = db.sales.filter(s => inPeriod(s.date, range));
    const rev = sum(sales, s => { const c = invoice(s); return c.beer + c.food; });
    const rm = sum(db.batches.filter(b => b.issued && inPeriod(b.date, range)), batchCost), util = sum(db.utilities.filter(u => inPeriod(u.date, range)), u => u.cost);
    const exc = sum(db.batches.filter(b => inPeriod(b.readyDate, range)), duty), c = cogs(...range);
    return `<div class="kpis four">${kpi(inr0(rev), `Revenue, ${periodText()}`)}${kpi(inr0(rm), 'Ingredients issued')}${kpi(inr0(util), 'Utilities')}${kpi(inr0(exc), 'Excise booked')}</div>`
      + panel('COGS per sellable litre', table(['Beer', { t: 'Ingredients', n: 1 }, { t: 'Utilities', n: 1 }, { t: 'Excise', n: 1 }, { t: 'Total cost', n: 1 }, { t: 'Avg price', n: 1 }, { t: 'Margin', n: 1 }],
        c.map(x => `<tr><td>${esc(x.r.name)}</td><td class="n">${inr(x.rm)}</td><td class="n">${inr(x.util)}</td><td class="n">${inr(x.exc)}</td><td class="n"><b>${inr(x.total)}</b></td><td class="n">${x.priceL ? inr(x.priceL) : ''}</td>
          <td class="n">${x.priceL ? `<span class="${x.margin < 50 ? 'bad' : 'good'}">${num(x.margin, 0)}%</span>` : ''}</td></tr>`))
        + `<p class="note">Utilities are spread over litres brewed ${periodText()}. Price is the average taproom price per litre before tax.</p>`);
  },
  production() {
    const months = {};
    for (const b of db.batches.filter(b => b.issued && inPeriod(b.date))) { const m = (months[b.date.slice(0, 7)] ||= { n: 0, l: 0, packed: 0, cost: 0 }); m.n++; m.l += b.volume; m.packed += batchPackedL(b); m.cost += batchCost(b); }
    return panel('Production summary', table(['Month', { t: 'Batches', n: 1 }, { t: 'Litres brewed', n: 1 }, { t: 'Litres packaged', n: 1 }, { t: 'Ingredient cost', n: 1 }],
      Object.keys(months).sort().reverse().map(k => { const m = months[k]; return `<tr><td>${k}</td><td class="n">${m.n}</td><td class="n">${num(m.l, 0)}</td><td class="n">${num(m.packed, 0)}</td><td class="n">${inr0(m.cost)}</td></tr>`; })));
  },
  consumption() {
    const used = {};
    for (const b of db.batches.filter(b => inPeriod(b.date))) for (const i of b.issues) { const u = (used[i.id] ||= { qty: 0, cost: 0, waste: 0 }); u.qty += i.qty; u.cost += i.cost; }
    for (const w of db.wastage.filter(w => w.kind === 'Material' && inPeriod(w.date))) (used[w.ref] ||= { qty: 0, cost: 0, waste: 0 }).waste += w.qty;
    const beer = beerStock();
    return panel('Raw material consumption', table(['Material', { t: 'Issued to batches', n: 1 }, { t: 'Wasted', n: 1 }, { t: 'Cost', n: 1 }],
      Object.entries(used).map(([id, u]) => `<tr><td>${esc(mat(id)?.name || 'Deleted')}</td><td class="n">${num(u.qty, 2)} ${esc(mat(id)?.unit || '')}</td><td class="n">${u.waste ? num(u.waste, 2) : ''}</td><td class="n">${inr0(u.cost)}</td></tr>`)))
      + panel('Beer consumption, last 14 days', table(['Beer', { t: 'Per day', n: 1 }, { t: 'Wasted', n: 1 }],
        beer.map(s => `<tr><td>${esc(s.r.name)}</td><td class="n">${num(s.rate)} L</td><td class="n">${num(sum(db.wastage.filter(w => w.kind === 'Beer' && w.ref === s.r.id), w => w.qty))} L</td></tr>`)));
  },
  dispatch() {
    const by = {};
    for (const d of db.dispatches.filter(d => inPeriod(d.date))) { const c = (by[d.customerId] ||= { n: 0, kegs: 0, units: 0, l: 0 }); c.n++; for (const l of d.lines) { if (l.ref.startsWith('k:')) c.kegs++; else c.units += l.qty; c.l += l.litres; } }
    return panel('Dispatch summary', table(['Customer', { t: 'Dispatches', n: 1 }, { t: 'Kegs', n: 1 }, { t: 'Packs', n: 1 }, { t: 'Litres', n: 1 }, { t: 'Kegs out now', n: 1 }],
      Object.entries(by).map(([id, c]) => `<tr><td>${esc(cust(id)?.name || '')}</td><td class="n">${c.n}</td><td class="n">${c.kegs}</td><td class="n">${c.units}</td><td class="n">${num(c.l)}</td><td class="n">${db.kegs.filter(k => k.customerId === id && k.status === 'At customer').length}</td></tr>`)));
  },
  stock() {
    const beer = beerStock(), max = Math.max(1, ...beer.map(s => s.total));
    return '<p class="note">Stock is as of today, so the period filter does not change it.</p>' + panel('Beer', table(['Beer', { t: 'In tank', n: 1 }, { t: 'Packaged', n: 1 }, { t: 'Total', n: 1 }, ''], beer.map(s => `<tr><td>${esc(s.r.name)}</td><td class="n">${num(Math.max(0, s.draught), 0)} L</td><td class="n">${num(s.packagedL, 0)} L</td><td class="n"><b>${num(s.total, 0)} L</b></td><td>${bar(s.total, max)}</td></tr>`)))
      + panel('Packaged goods', table(['Batch', 'Format', { t: 'Units left', n: 1 }], db.packs.filter(p => packLeft(p) > 0).map(p => { const b = db.batches.find(x => x.id === p.batchId); return `<tr><td>${esc(b?.code)} ${esc(rec(b?.recipeId)?.name || '')}</td><td>${esc(p.format)}</td><td class="n">${packLeft(p)}</td></tr>`; })))
      + panel('Raw materials', table(['Material', { t: 'On hand', n: 1 }, { t: 'Available', n: 1 }, { t: 'Value', n: 1 }], mrp().map(x => `<tr><td>${esc(x.m.name)}</td><td class="n">${num(x.m.qty, 2)} ${esc(x.m.unit)}</td><td class="n ${x.avail <= x.m.reorder ? 'bad' : ''}">${num(x.avail, 2)}</td><td class="n">${inr0(x.m.qty * x.m.cost)}</td></tr>`),
        `<tfoot><tr><td>Total</td><td></td><td></td><td class="n">${inr0(sum(db.materials, m => m.qty * m.cost))}</td></tr></tfoot>`));
  },
  process() {
    const bs = db.batches.filter(b => b.issued && inPeriod(b.date));
    return panel('Recipe versus batch', table(['Batch', 'Beer', { t: 'Target OG', n: 1 }, { t: 'Actual OG', n: 1 }, { t: 'Target L', n: 1 }, { t: 'Actual L', n: 1 }, { t: 'Brewhouse eff.', n: 1 }, { t: 'Volume eff.', n: 1 }, 'Deviations'],
      bs.map(b => {
        const r = rec(b.recipeId), t = r ? recipeCalc(r) : null, packed = batchPackedL(b);
        return `<tr><td><a class="code" href="#blr/${b.id}">${esc(b.code)}</a></td><td>${esc(r?.name || '')}</td><td class="n">${t ? sg(t.og) : ''}</td><td class="n">${b.og ? sg(b.og) : ''}</td><td class="n">${r?.size || ''}</td><td class="n">${num(b.volume)}</td>
          <td class="n">${num(efficiency(b), 0)}%</td><td class="n">${packed ? num(packed / b.volume * 100, 0) + '%' : ''}</td><td>${deviations(b).map(d => pill(d, 'low')).join(' ')}</td></tr>`;
      })) + `<p class="note">Target brewhouse efficiency is ${db.settings.efficiency || 72}%. Volume efficiency is litres packaged against litres into the fermenter.</p>`);
  },
  quality() {
    const bs = db.batches.filter(b => b.log.length && inPeriod(b.date));
    return panel('Batch quality and fermentation', table(['Batch', 'Beer', { t: 'Days logged', n: 1 }, { t: 'OG', n: 1 }, { t: 'Latest gravity', n: 1 }, { t: 'Attenuation', n: 1 }, { t: 'ABV', n: 1 }, { t: 'Temp range', n: 1 }, { t: 'pH', n: 1 }],
      bs.map(b => {
        const temps = b.log.map(x => x.temp).filter(x => x !== ''), ph = b.log.map(x => x.ph).filter(x => x !== '');
        return `<tr><td><a class="code" href="#blr/${b.id}">${esc(b.code)}</a></td><td>${esc(rec(b.recipeId)?.name || '')}</td><td class="n">${b.log.length}</td><td class="n">${sg(b.og)}</td><td class="n">${sg(b.fg)}</td>
          <td class="n">${b.og > 1 ? num((b.og - b.fg) / (b.og - 1) * 100, 0) + '%' : ''}</td><td class="n">${num(abv(b.og, b.fg))}%</td><td class="n">${temps.length ? `${Math.min(...temps)} to ${Math.max(...temps)}°C` : ''}</td><td class="n">${ph.join(', ')}</td></tr>`;
      })));
  },
};
const REPORT_TABS = [['business', 'Business'], ['production', 'Production'], ['consumption', 'Consumption'], ['dispatch', 'Dispatch'], ['stock', 'Stock'], ['process', 'Process'], ['quality', 'Quality']];

export const views = {
  records() {
    const from = daysAgo(30);
    return head('Utilities and wastage', 'Record utilities for an accurate COGS. Beer losses have their own screen under Quality and control.', `${btn('Beer losses', 'go', 'losses', 'ghost')} ${btn('Record utility', 'newUtil')}`)
      + `<div class="kpis four">${Object.keys(UTIL_TYPES).slice(0, 4).map(t => kpi(inr0(sum(db.utilities.filter(u => u.type === t && u.date >= from), u => u.cost)), `${t}, 30 days`)).join('')}</div>`
      + panel('Utilities', table(['Date', 'Type', { t: 'Quantity', n: 1 }, { t: 'Cost', n: 1 }, ''], [...db.utilities].sort((a, b) => b.date.localeCompare(a.date)).map(u => `<tr><td>${fmtDate(u.date)}</td><td>${esc(u.type)}</td><td class="n">${num(u.qty)} ${esc(u.unit)}</td><td class="n">${inr0(u.cost)}</td><td class="acts">${link('Delete', 'delUtil', u.id, 'del')}</td></tr>`)))
      + panel('Wastage', table(['Date', 'Kind', 'Item', { t: 'Quantity', n: 1 }, 'Reason', ''], [...db.wastage].sort((a, b) => b.date.localeCompare(a.date)).map(w => `<tr><td>${fmtDate(w.date)}</td><td>${pill(w.kind, w.kind === 'Beer' ? 'orange' : 'grey')}</td>
        <td>${esc(w.kind === 'Beer' ? rec(w.ref)?.name : mat(w.ref)?.name)}</td><td class="n">${num(w.qty, 2)} ${w.kind === 'Beer' ? 'L' : esc(mat(w.ref)?.unit || '')}</td><td>${esc(w.reason)}</td><td class="acts">${link('Delete', 'delWaste', w.id, 'del')}</td></tr>`)));
  },

  reports() {
    return head('Reports', 'Business performance and process control, from the same data the floor records.') + periodSeg() + seg('reportTab', REPORT_TABS, reportTab) + REPORTS[reportTab]();
  },

  tax() {
    const reg = db.batches.filter(b => b.readyDate && b.dutyRate).sort((a, b) => a.readyDate.localeCompare(b.readyDate));
    const removals = [...db.sales.filter(x => x.duty).map(x => ({ date: x.date, ref: x.no, who: x.customer, duty: x.duty, kind: 'Taproom' })),
      ...db.dispatches.filter(d => d.duty).map(d => ({ date: d.date, ref: d.no, who: cust(d.customerId)?.name || '', duty: d.duty, kind: 'Dispatch' }))].sort((a, b) => a.date.localeCompare(b.date));
    const months = taxMonths();
    const basis = db.settings.exciseBasis === 'Removal' ? 'on removal (each taproom pour and dispatch)' : 'when a batch is marked Ready';
    return head('Excise and tax', `Excise is booked at the Settings rate ${basis}. State: ${esc(db.settings.state)}.`, `${btn('Excise CSV', 'csvExcise', '', 'ghost')} ${btn('VAT and GST CSV', 'csvTax', '', 'ghost')}`)
      + panel('Excise register, booked at Ready', table(['Batch', 'Beer', 'Brewed', 'Ready', { t: 'Bulk litres', n: 1 }, { t: 'ABV', n: 1 }, { t: 'Rate / L', n: 1 }, { t: 'Duty', n: 1 }],
        reg.map(b => `<tr><td class="code">${esc(b.code)}</td><td>${esc(rec(b.recipeId)?.name || '')}</td><td>${fmtDate(b.date)}</td><td>${fmtDate(b.readyDate)}</td><td class="n">${num(b.dutyL || b.volume)}</td><td class="n">${num(abv(b.og, b.fg))}%</td><td class="n">${inr(b.dutyRate)}</td><td class="n">${inr(duty(b))}</td></tr>`),
        `<tfoot><tr><td colspan="4">Total</td><td class="n">${num(sum(reg, b => b.dutyL || b.volume))}</td><td></td><td></td><td class="n">${inr(sum(reg, duty))}</td></tr></tfoot>`))
      + (removals.length || db.settings.exciseBasis === 'Removal' ? panel('Excise on removal', table(['Date', 'Kind', 'Ref', 'Customer', { t: 'Duty', n: 1 }], removals.map(x => `<tr><td>${fmtDate(x.date)}</td><td>${pill(x.kind, 'grey')}</td><td class="code">${esc(x.ref)}</td><td>${esc(x.who)}</td><td class="n">${inr(x.duty)}</td></tr>`),
        `<tfoot><tr><td colspan="4">Total</td><td class="n">${inr(sum(removals, x => x.duty))}</td></tr></tfoot>`)) : '')
      + panel('Monthly VAT and GST', table(['Month', { t: 'Beer sales', n: 1 }, { t: 'VAT', n: 1 }, { t: 'Food sales', n: 1 }, { t: 'CGST', n: 1 }, { t: 'SGST', n: 1 }],
        Object.keys(months).sort().reverse().map(k => { const m = months[k]; return `<tr><td>${k}</td><td class="n">${inr(m.beer)}</td><td class="n">${inr(m.vat)}</td><td class="n">${inr(m.food)}</td><td class="n">${inr(m.cgst)}</td><td class="n">${inr(m.sgst)}</td></tr>`; }))
        + '<p class="note">Alcoholic liquor for human consumption sits outside GST. It is taxed through state excise and VAT, so check the rates against your state\'s current notification.</p>');
  },


  settings() {
    return head('Settings', 'Brewery details, tax rates and brewhouse efficiency. Data lives in this browser only, so export a backup often.')
      + `<form class="panel" id="settingsForm"><div class="grid">${SETTINGS_FIELDS.map(f => field(f, db.settings[f.k])).join('')}</div>
        <p class="note">The sample rates are placeholders. Replace them with your state's notified excise duty and VAT on beer.</p>
        <div class="card-acts"><button class="primary">Save settings</button></div></form>`
      + panel('Privacy and analytics', `<p class="note">Brewery data stays in this browser. Anonymous usage analytics are <b>${consent() === 'granted' ? 'on' : 'off'}</b>.
        <a href="privacy.html">Privacy policy</a> · <a href="terms.html">Terms of use</a></p>
        <div class="card-acts">${consent() === 'granted' ? btn('Turn analytics off', 'analyticsOff', '', 'ghost') : btn('Allow analytics', 'analyticsOn', '', 'ghost')}</div>`)
      + panel('Backup', `<p class="note">Download everything as one JSON file, or restore it on another computer. ${db.settings.lastBackup ? `Last backup ${fmtDate(db.settings.lastBackup)}, ${daysBetween(db.settings.lastBackup, today())} days ago.` : '<b class="bad">No backup taken yet.</b>'}</p>
        <div class="card-acts wrap">${btn('Export backup', 'exportData', '', 'ghost')}<label class="ghost file">Import backup<input type="file" accept=".json,application/json" id="importFile" hidden></label>
        ${btn('Load demo brewpub', 'resetDemo', '', 'ghost')}${btn('Start empty', 'clearAll', '', 'ghost danger')}</div>`);
  },
};

function taxMonths() {
  const months = Object.create(null);
  for (const s of db.sales) { const c = invoice(s), m = (months[s.date.slice(0, 7)] ||= { beer: 0, vat: 0, food: 0, cgst: 0, sgst: 0 }); for (const f in m) m[f] += c[f]; }
  return months;
}

export const SETTINGS_FIELDS = [
  { k: 'name', label: 'Brewery name' }, { k: 'gstin', label: 'GSTIN' }, { k: 'address', label: 'Address', wide: 1 }, { k: 'state', label: 'State' },
  { k: 'prefix', label: 'Invoice prefix' }, { k: 'exciseRate', label: 'Excise duty (₹ per bulk litre)', type: 'number' }, { k: 'vat', label: 'VAT on beer (%)', type: 'number' },
  { k: 'foodGst', label: 'GST on food (%)', type: 'number' }, { k: 'efficiency', label: 'Mash and lauter efficiency (%)', type: 'number' },
  { k: 'grainAbsorb', label: 'Grain absorption (L per kg)', type: 'number' }, { k: 'dryHopAbsorb', label: 'Dry hop absorption (L per kg)', type: 'number' },
  { k: 'cipDays', label: 'CIP valid for (days)', type: 'number' }, { k: 'lossTarget', label: 'Beer loss target per batch (%)', type: 'number' },
  { k: 'lossAllow', label: 'Excise loss allowance (%)', type: 'number' },
  { k: 'exciseBasis', label: 'Book excise', type: 'select', options: [{ v: 'Ready', t: 'When a batch is marked Ready' }, { v: 'Removal', t: 'On removal (taproom pour or dispatch)' }] },
  { k: 'tradeRateL', label: 'Trade price (₹ per litre)', type: 'number' }, { k: 'kegValue', label: 'Keg value (₹ each, to price lost kegs)', type: 'number' },
];

export const actions = {
  newUtil() {
    openForm({ title: 'Record utility', vals: { date: today(), type: 'Electricity', unit: 'kWh' },
      fields: [{ k: 'type', label: 'Type', type: 'select', options: Object.keys(UTIL_TYPES).map(t => ({ v: t, t })) }, { k: 'date', label: 'Date', type: 'date' }, { k: 'qty', label: 'Quantity', type: 'number' }, { k: 'unit', label: 'Unit', list: ['kWh', 'kL', 'kg', 'L'] }, { k: 'cost', label: 'Cost (₹)', type: 'number', req: 1 }],
      onSave: v => { db.utilities.push({ id: uid(), ...v, unit: v.unit || UTIL_TYPES[v.type] }); } });
  },
  delUtil(id) { remove('utilities', id, 'utility entry'); },
  newWaste() {
    openForm({ title: 'Record beer wastage', vals: { date: today(), ref: db.recipes[0]?.id, reason: 'Line flush' },
      fields: [{ k: 'ref', label: 'Beer', type: 'select', options: db.recipes.map(r => ({ v: r.id, t: r.name })) }, { k: 'date', label: 'Date', type: 'date' }, { k: 'qty', label: 'Litres', type: 'number', req: 1 }, { k: 'reason', label: 'Reason', list: ['Line flush', 'Spillage', 'Off flavour', 'Quality hold', 'Samples'] }],
      note: 'Material wastage is recorded from Raw materials, Use / waste.', onSave: v => { db.wastage.push({ id: uid(), kind: 'Beer', ...v }); } });
  },
  delWaste(id) { remove('wastage', id, 'wastage entry'); },

  csvExcise() {
    downloadCsv('excise-register', ['Basis', 'Date', 'Ref', 'Beer or customer', 'Bulk litres', 'Rate per litre', 'Duty'], [
      ...db.batches.filter(b => b.readyDate && b.dutyRate).map(b => ['Ready', b.readyDate, b.code, rec(b.recipeId)?.name || '', b.dutyL || b.volume, b.dutyRate, +duty(b).toFixed(2)]),
      ...db.sales.filter(x => x.duty).map(x => ['Removal', x.date, x.no, x.customer, '', db.settings.exciseRate, x.duty]),
      ...db.dispatches.filter(d => d.duty).map(d => ['Removal', d.date, d.no, cust(d.customerId)?.name || '', sum(d.lines, l => l.litres), db.settings.exciseRate, d.duty])]);
  },
  csvTax() { const m = taxMonths(); downloadCsv('vat-gst-monthly', ['Month', 'Beer sales', 'VAT', 'Food sales', 'CGST', 'SGST'], Object.keys(m).sort().map(k => [k, ...['beer', 'vat', 'food', 'cgst', 'sgst'].map(f => +m[k][f].toFixed(2))])); },
  csvSales() {
    downloadCsv(periodFile('sales'), ['Invoice', 'Date', 'Customer', 'GSTIN', 'Type', 'Beer', 'Food', 'VAT', 'CGST', 'SGST', 'Total'], db.sales.filter(s => inPeriod(s.date)).map(s => { const c = invoice(s); return [s.no, s.date, s.customer, s.gstin, s.dispatchId ? 'Trade' : 'Taproom', ...[c.beer, c.food, c.vat, c.cgst, c.sgst, c.total].map(x => +x.toFixed(2))]; }));
  },
  csvLosses() { downloadCsv(periodFile('beer-losses'), ['Date', 'Batch', 'Beer', 'Stage', 'Litres', 'Reason'], db.losses.filter(l => inPeriod(l.date)).map(l => { const b = db.batches.find(x => x.id === l.batchId); return [l.date, b?.code || '', rec(b?.recipeId)?.name || '', l.stage, l.litres, l.reason]; })); },
  csvAdjust() { downloadCsv('stock-adjustments', ['Date', 'Count', 'Item', 'Change', 'Value', 'Reason'], db.adjustments.map(a => [a.date, db.counts.find(c => c.id === a.countId)?.no || '', a.label, a.delta, a.value, a.reason])); },
  analyticsOn() { setConsent('granted'); document.getElementById('consent').hidden = true; toast('Analytics on. Thank you.'); commit(); },
  analyticsOff() { setConsent('denied'); document.getElementById('consent').hidden = true; toast('Analytics off. The Analytics cookies were removed.'); commit(); },
  exportData() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' }));
    a.download = `brewhouse-backup-${today()}.json`;
    a.click();
    db.settings.lastBackup = today();
    commit();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  resetDemo() { if (confirm('Replace all data with the demo brewpub?')) { replace(demo()); commit(); } },
  clearAll() {
    if (!confirm('Delete everything and start with an empty brewery? Export a backup first if you need one.')) return;
    startEmpty();
  },
};

export function importBackup(file) {
  file.text().then(t => {
    const d = JSON.parse(t);
    if (!isBackup(d)) throw new Error('not a backup');
    replace(clean(d));
    commit();
    toast('Backup restored');
  }).catch(() => toast('That file is not a Brewhouse backup'));
}
export function saveSettings(form) {
  Object.assign(db.settings, readForm(form, SETTINGS_FIELDS));
  commit();
  toast('Settings saved');
}
export const segs = { reportTab: v => { reportTab = v; } };
