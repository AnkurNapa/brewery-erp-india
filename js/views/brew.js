// Tanks, batches, batch lifecycle record, recipes and packaging.
import { db, next, commit, STATUSES, IN_TANK, LOSS_STAGES } from '../store.js';
import { esc, num, sg, inr, inr0, today, fmtDate, sum, uid, toast, abv, daysBetween } from '../util.js';
import { head, btn, link, pill, statusCls, panel, table, kpi, vessel, curve, openForm, metric } from '../ui.js';
import { mat, rec, tank, keg, cust, tankLeft, tankFit, lastCip, lossBalance, batchLoss, recipeCalc, issueList, batchCost, deviations, efficiency, duty, packedL, batchPackedL, packLeft } from '../calc.js';

const FORMATS = { 'Keg 30 L': 30, 'Keg 50 L': 50, 'Can 330 ml': 0.33, 'Bottle 330 ml': 0.33, 'Bottle 650 ml': 0.65, 'Growler 2 L': 2 };
// Standard SRM colour chart, 1 to 40.
const SRM = 'FFE699 FFD878 FFCA5A FFBF42 FBB123 F8A600 F39C00 EA8F00 E58500 DE7C00 D77200 CF6900 CB6200 C35900 BB5100 B54C00 B04500 A63E00 A13700 9B3200 952D00 8E2900 882300 821E00 7B1A00 771900 701400 6A0E00 660D00 5E0B00 5A0A02 600903 520907 4C0505 470606 440607 3F0708 3B0607 3A070B 36080A'.split(' ');
const srmHex = ebc => '#' + SRM[Math.max(0, Math.min(39, Math.round(ebc / 1.97) - 1))];
const recipeOpts = () => db.recipes.map(r => ({ v: r.id, t: `${r.name} (v${r.version})` }));
const tankOpts = () => [{ v: '', t: 'None' }, ...db.tanks.map(t => ({ v: t.id, t: `${t.name} · ${t.type}` }))];
const emptyBrew = () => ({ mashTemp: '', preBoil: '', og: '', volume: '', pitchTemp: '', notes: '' });

// ---------- hygiene ----------
export function makeDirty(t) {
  if (!t) return;
  Object.assign(t, { hygiene: 'Dirty' });
  if (!db.tasks.some(k => k.status === 'Open' && k.type === 'Cleaning' && k.title === `CIP ${t.name}`)) db.tasks.push({ id: uid(), title: `CIP ${t.name}`, type: 'Cleaning', date: today(), assignee: '', status: 'Open' });
}
const fitOrConfirm = t => { const f = tankFit(t); return f.ok || confirm(`${f.why}. Fill it anyway?`); };
// Ready beer that has run dry becomes Sold out and leaves its tank dirty.
export function settle() {
  let changed = false;
  for (const b of db.batches.filter(b => b.status === 'Ready' && tankLeft(b) < 0.5 && (batchPackedL(b) > 0 || db.sales.length))) {
    b.status = 'Sold out';
    makeDirty(tank(b.tankId));
    changed = true;
  }
  return changed;
}

// ---------- status changes ----------
function issue(b) {
  const r = rec(b.recipeId), list = issueList(r, b.volume);
  const short = list.filter(i => (mat(i.id)?.qty || 0) < i.qty).map(i => mat(i.id)?.name);
  const qc = list.filter(i => mat(i.id)?.qc !== 'Approved').map(i => mat(i.id)?.name);
  const warn = [short.length && `Not enough in stores: ${short.join(', ')}.`, qc.length && `Not QC approved: ${qc.join(', ')}.`].filter(Boolean);
  if (warn.length && !confirm(`${warn.join('\n')}\nIssue the ingredients anyway?`)) return false;
  for (const i of list) { const m = mat(i.id); if (m) m.qty = +(m.qty - i.qty).toFixed(3); }
  Object.assign(b, { issued: true, issues: list, recipeVersion: r.version });
  toast(`${b.code}: ingredients issued from stores (${inr0(sum(list, i => i.cost))})`);
  return true;
}
export function setStatus(id, status) {
  const b = db.batches.find(x => x.id === id);
  if (!b.issued && status !== 'Planned') {
    if (!fitOrConfirm(tank(b.tankId)) || !issue(b)) return commit();
    for (const k of db.tasks.filter(k => k.status === 'Open' && k.title.includes(`(${b.code})`))) k.status = 'Done';
  }
  if (status === 'Sold out' && b.status !== 'Sold out') makeDirty(tank(b.tankId));
  b.status = status;
  if (IN_TANK.includes(status) || status === 'Planned') Object.assign(b, { readyDate: '', dutyRate: 0 });
  else if (!b.readyDate) { Object.assign(b, { readyDate: today(), dutyRate: db.settings.exciseRate, dutyL: +(b.volume - batchLoss(b)).toFixed(2) }); toast(`${b.code} booked in the excise register`); }
  commit();
}

// ---------- views ----------
export const views = {
  tanks() {
    const cards = db.tanks.map(t => {
      const b = db.batches.find(x => x.tankId === t.id && !['Sold out', 'Planned'].includes(x.status));
      const last = b?.log.at(-1), g = +last?.gravity || b?.og;
      const fit = tankFit(t), hyg = t.hygiene === 'Dirty' ? 'low' : fit.ok ? 'ok' : 'orange';
      return `<article class="card tank"><div class="tank-top">${vessel(t, b ? tankLeft(b) / (t.capacity || 1) : 0)}<div class="grow"><h3>${esc(t.name)}</h3><small>${esc(t.type)} · ${num(t.capacity)} L</small></div>${b ? pill(b.status, statusCls(b.status)) : pill('Empty', 'grey')}</div>
        ${b ? '' : `<p class="hyg">${pill(t.hygiene, hyg)} <small>${t.cleanedOn ? 'CIP ' + fmtDate(t.cleanedOn) : 'No CIP logged'}${fit.ok ? '' : ' · ' + esc(fit.why)}</small></p>`}
        ${b ? `<a class="tank-batch" href="#blr/${b.id}"><b>${esc(b.code)}</b> ${esc(rec(b.recipeId)?.name)} · ${num(tankLeft(b), 0)} L in tank · day ${daysBetween(b.date, today())}</a>
          ${curve([b.og, ...b.log.map(r => +r.gravity)], `Gravity curve for ${b.code}`)}
          <div class="metrics">${metric(sg(g), 'gravity')}${metric(last?.temp !== '' && last?.temp != null ? num(last.temp) + '°C' : 'n/a', 'temp')}${metric(num(abv(b.og, g)) + '%', 'ABV so far')}</div>
          <div class="card-acts">${btn('Log reading', 'logReading', b.id, 'ghost')}${/ferment|uni/i.test(t.type) && b.status !== 'Planned' ? link('Transfer', 'transfer', b.id) : ''}${link('Record loss', 'recordLoss', b.id)}${link('Record', 'go', 'blr/' + b.id)}</div>` : `<div class="card-acts">${btn('Log CIP', 'logCip', t.id, 'ghost')}</div>`}
        <div class="card-foot">${link('Edit', 'editTank', t.id)}${link('Delete', 'delTank', t.id, 'del')}</div></article>`;
    });
    return head('Tanks', 'Every fermenter and brite tank with the batch inside, its gravity curve and latest reading.', btn('Add tank', 'newTank'))
      + (cards.length ? `<div class="cards">${cards.join('')}</div>` : '<p class="empty">Add your fermenters and brite tanks to start.</p>');
  },

  batches() {
    const rows = [...db.batches].sort((a, b) => b.date.localeCompare(a.date)).map(b => {
      const dev = deviations(b).length;
      return `<tr><td><a class="code" href="#blr/${b.id}">${esc(b.code)}</a></td><td>${esc(rec(b.recipeId)?.name)}<small class="sub">v${b.recipeVersion}</small></td><td>${esc(tank(b.tankId)?.name || '')}</td><td>${fmtDate(b.date)}</td>
        <td><select class="inline" data-status="${b.id}" aria-label="Status of ${esc(b.code)}">${STATUSES.map(s => `<option ${s === b.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
        <td class="n">${num(b.volume)} L</td><td class="n">${b.og ? sg(b.og) : ''}</td><td class="n">${b.og ? num(abv(b.og, b.fg)) + '%' : ''}</td>
        <td>${dev ? pill(`${dev} deviation${dev > 1 ? 's' : ''}`, 'low') : b.brew.og !== '' ? pill('On spec', 'ok') : ''}</td>
        <td class="acts">${link('Brew log', 'brewLog', b.id)}${b.issued && b.status !== 'Sold out' ? link('Loss', 'recordLoss', b.id) : ''}${link('Edit', 'editBatch', b.id)}${link('Delete', 'delBatch', b.id, 'del')}</td></tr>`;
    });
    return head('Batches', 'Planned batches reserve their ingredients. Moving past Planned issues them from stores. Marking Ready books excise.', btn('New batch', 'newBatch'))
      + panel('', table(['Batch', 'Beer', 'Tank', 'Brewed', 'Status', { t: 'Volume', n: 1 }, { t: 'OG', n: 1 }, { t: 'ABV', n: 1 }, 'Process', ''], rows));
  },

  blr(id) {
    const b = db.batches.find(x => x.id === id);
    if (!b) return head('Batch not found') + '<p><a class="link" href="#batches">Back to batches</a></p>';
    const r = rec(b.recipeId), t = r ? recipeCalc(r) : null, dev = deviations(b), cost = batchCost(b), packs = db.packs.filter(p => p.batchId === b.id);
    const kegs = db.kegs.filter(k => k.batchId === b.id), packed = batchPackedL(b);
    const disp = db.dispatches.filter(d => d.lines.some(l => packs.some(p => l.ref === 'p:' + p.id) || kegs.some(k => l.ref === 'k:' + k.id)));
    const w = b.brew, row = (label, target, actual, unit = '') => `<tr><td>${label}</td><td class="n">${target}</td><td class="n">${actual === '' ? '' : actual + unit}</td></tr>`;
    return head(`${esc(b.code)} · ${esc(r?.name || '')}`, `Batch lifecycle record · recipe v${b.recipeVersion} · ${esc(tank(b.tankId)?.name || 'no tank')} · brewed ${fmtDate(b.date)}${b.readyDate ? ' · ready ' + fmtDate(b.readyDate) : ''}`,
      `${pill(b.status, statusCls(b.status))} ${btn('Print', 'printBlr', b.id, 'ghost')} ${btn('Log reading', 'logReading', b.id)}`)
      + `<div class="kpis">${kpi(num(b.volume) + ' L', 'Into fermenter')}${kpi(b.og ? `${sg(b.og)} → ${sg(b.fg)}` : 'n/a', 'OG → gravity now')}${kpi(b.og ? num(abv(b.og, b.fg)) + '%' : 'n/a', 'ABV')}${kpi(num(efficiency(b), 0) + '%', 'Brewhouse efficiency')}${kpi(inr0(cost), `Ingredients · ${inr(cost / (b.volume || 1))}/L`)}</div>
      <div class="cols">
        ${panel('Brew day', table(['Step', { t: 'Target', n: 1 }, { t: 'Actual', n: 1 }], [
          row('Mash temperature', '66°C', w.mashTemp, '°C'), row('Pre-boil gravity', '', w.preBoil === '' ? '' : sg(w.preBoil)), row('Original gravity', t ? sg(t.og) : '', w.og === '' ? '' : sg(w.og)),
          row('Volume into fermenter', r ? r.size + ' L' : '', w.volume, ' L'), row('Pitch temperature', /lager|helles|pils/i.test(r?.style) ? '10°C' : '18°C', w.pitchTemp, '°C')])
          + (dev.length ? `<ul class="list">${dev.map(d => `<li><i class="dot low"></i>Deviation: ${esc(d)}</li>`).join('')}</ul>` : w.og !== '' ? '<p class="note ok">Brew day on spec.</p>' : '')
          + (w.notes ? `<p class="note">${esc(w.notes)}</p>` : '') + `<div class="card-acts">${btn('Edit brew log', 'brewLog', b.id, 'ghost')}</div>`)}
        ${panel('Fermentation', curve([b.og, ...b.log.map(x => +x.gravity)], 'Gravity curve') + table(['Date', { t: 'Gravity', n: 1 }, { t: 'Temp', n: 1 }, { t: 'pH', n: 1 }, 'Note'],
          b.log.map(x => `<tr><td>${fmtDate(x.date)}</td><td class="n">${x.gravity === '' ? '' : sg(x.gravity)}</td><td class="n">${x.temp === '' ? '' : x.temp + '°C'}</td><td class="n">${x.ph}</td><td>${esc(x.note)}</td></tr>`)))}
      </div>
      ${panel('Ingredients issued', b.issued ? table(['Material', { t: 'Qty', n: 1 }, { t: 'Cost', n: 1 }], b.issues.map(i => `<tr><td>${esc(mat(i.id)?.name || 'Deleted material')}</td><td class="n">${num(i.qty, 3)} ${esc(mat(i.id)?.unit || '')}</td><td class="n">${inr(i.cost)}</td></tr>`),
        `<tfoot><tr><td>Total</td><td></td><td class="n">${inr(cost)}</td></tr></tfoot>`) : '<p class="empty">Not issued yet. Ingredients are reserved while the batch is Planned.</p>')}
      <div class="cols">
        ${panel('Packaging', table(['Date', 'Format', { t: 'Units', n: 1 }, { t: 'Litres', n: 1 }, { t: 'Left', n: 1 }], packs.map(p => `<tr><td>${fmtDate(p.date)}</td><td>${esc(p.format)}</td><td class="n">${p.units}</td><td class="n">${num(packedL(p))}</td><td class="n">${packLeft(p)}</td></tr>`))
          + (packed ? `<p class="note">Volume efficiency ${num(packed / (b.volume || 1) * 100, 0)}% of litres into fermenter packaged so far.</p>` : ''))}
        ${panel('Kegs and traceability', table(['Keg', 'Status', 'Where'], kegs.map(k => `<tr><td><a class="code" href="#scan/${encodeURIComponent(k.code)}">${esc(k.code)}</a></td><td>${pill(k.status, statusCls(k.status))}</td><td>${esc(k.status === 'At customer' ? cust(k.customerId)?.name : 'Brewery')}</td></tr>`))
          + (disp.length ? `<ul class="list">${disp.map(d => `<li>${fmtDate(d.date)} · ${esc(d.no)} to ${esc(cust(d.customerId)?.name)}</li>`).join('')}</ul>` : ''))}
      </div>
      <div class="cols">
        ${(() => { const lb = lossBalance(b), target = db.settings.lossTarget || 5;
          return panel('Beer losses', table(['Stage', { t: 'Litres', n: 1 }, { t: '% of fermenter', n: 1 }],
            [lb.brewhouse ? `<tr class="muted"><td>Brewhouse (short of recipe)</td><td class="n">${num(lb.brewhouse)}</td><td class="n">${num(lb.brewhouse / (r?.size || 1) * 100)}%</td></tr>` : '',
              ...Object.entries(lb.stages).map(([st, l]) => `<tr><td>${esc(st)}</td><td class="n">${num(l)}</td><td class="n">${num(l / (b.volume || 1) * 100)}%</td></tr>`)].filter(Boolean),
            `<tfoot><tr><td>Total after fermenter</td><td class="n">${num(lb.total)}</td><td class="n"><span class="${lb.pct > target ? 'bad' : 'good'}">${num(lb.pct)}%</span></td></tr></tfoot>`)
            + `<p class="note">Target ${target}%.</p><div class="card-acts">${b.issued ? btn('Record loss', 'recordLoss', b.id, 'ghost') : ''}</div>`, ''); })()}
        ${panel('Tanks and CIP', (() => {
          const fill = lastCip(b.transfers[0]?.fromId || b.tankId, b.date);
          const rows = [`<li><span class="when">${fmtDate(b.date)}</span>Filled ${esc(tank(b.transfers[0]?.fromId || b.tankId)?.name || 'no tank')}${fill ? ` after ${esc(fill.cycle)} on ${fmtDate(fill.date)} (${esc(fill.result)})` : ', no CIP on record'}</li>`,
            ...b.transfers.map(x => `<li><span class="when">${fmtDate(x.date)}</span>Transferred ${esc(tank(x.fromId)?.name)} to ${esc(tank(x.toId)?.name)}: ${num(x.litresOut)} L out, ${num(x.litresIn)} L in</li>`)];
          return `<ul class="list">${rows.join('')}</ul>`;
        })())}
      </div>
      ${panel('Excise', b.readyDate ? `<p>${num(b.dutyL || b.volume)} bulk litres at ${inr(b.dutyRate)} per litre = <b>${inr(duty(b))}</b>, booked ${fmtDate(b.readyDate)}.</p>` : '<p class="empty">Booked when the batch is marked Ready.</p>')}`;
  },

  recipes() {
    const cards = db.recipes.map(r => {
      const c = recipeCalc(r);
      return `<article class="card recipe"><div class="recipe-top"><span class="swatch" style="background:${srmHex(c.ebc)}"></span><div class="grow"><h3>${esc(r.name)}</h3><small>${esc(r.style)} · v${r.version}${r.updated ? ' · ' + fmtDate(r.updated) : ''}</small></div></div>
        <div class="metrics">${metric(sg(c.og), 'OG')}${metric(sg(c.fg), 'FG')}${metric(num(c.abv) + '%', 'ABV')}${metric(num(c.ibu, 0), 'IBU')}${metric(num(c.ebc, 0), 'EBC')}</div>
        <div class="chain"><span><b>${num(c.pre, 0)} L</b>pre-boil</span><span><b>${num(c.post, 0)} L</b>post-boil</span><span><b>${num(c.size, 0)} L</b>fermenter</span><span><b>${num(c.sellable, 0)} L</b>sellable</span></div>
        <p class="ingr">${r.items.map(i => `${esc(mat(i.id)?.name || '?')} ${num(i.qty, 2)} ${esc(mat(i.id)?.unit || '')}${i.time !== '' && mat(i.id)?.alpha ? ` @${i.time} min` : ''}`).join(' · ')}</p>
        <div class="metrics">${metric(inr0(c.cost), 'batch cost')}${metric(inr(c.costL), 'per sellable litre')}</div>
        <div class="card-foot">${link('Edit', 'editRec', r.id)}${r.history.length ? link(`History (${r.history.length})`, 'recHistory', r.id) : ''}${link('Delete', 'delRec', r.id, 'del')}</div></article>`;
    });
    return head('Recipes', `Mass balance engine: gravity, colour, bitterness, ABV, volumes at each step and cost, from the grain bill at ${db.settings.efficiency || 72}% brewhouse efficiency.`, btn('New recipe', 'newRec'))
      + (cards.length ? `<div class="cards">${cards.join('')}</div>` : '<p class="empty">No recipes yet.</p>');
  },

  packaging() {
    const rows = [...db.packs].sort((a, b) => b.date.localeCompare(a.date)).map(p => {
      const b = db.batches.find(x => x.id === p.batchId);
      return `<tr><td>${fmtDate(p.date)}</td><td><a class="code" href="#blr/${p.batchId}">${esc(b?.code)}</a> ${esc(rec(b?.recipeId)?.name || '')}</td><td>${esc(p.format)}</td><td class="n">${p.units}</td><td class="n">${num(packedL(p))} L</td><td class="n">${packLeft(p)}</td>
        <td>${p.kegIds.map(id => esc(keg(id)?.code)).join(', ')}</td><td class="acts">${link('Delete', 'delPack', p.id, 'del')}</td></tr>`;
    });
    return head('Packaging', 'Kegging, canning and bottling. Kegs are picked from empty stock and tagged to the batch for traceability.', btn('Package beer', 'newPack'))
      + panel('', table(['Date', 'Batch', 'Format', { t: 'Units', n: 1 }, { t: 'Litres', n: 1 }, { t: 'In stock', n: 1 }, 'Kegs', ''], rows));
  },
};

// ---------- actions ----------
const TANK_FIELDS = [
  { k: 'name', label: 'Tank name', req: 1 }, { k: 'type', label: 'Type', type: 'select', options: ['Fermenter', 'Unitank', 'Brite tank', 'Serving tank'].map(t => ({ v: t, t })) },
  { k: 'capacity', label: 'Capacity (L)', type: 'number' },
];
const READING_FIELDS = [
  { k: 'date', label: 'Date', type: 'date' }, { k: 'gravity', label: 'Gravity (e.g. 1.024)', type: 'number', step: '0.001', blank: 1 },
  { k: 'temp', label: 'Temperature (°C)', type: 'number', blank: 1 }, { k: 'ph', label: 'pH', type: 'number', blank: 1 }, { k: 'note', label: 'Note', wide: 1 },
];
const BREW_FIELDS = [
  { k: 'mashTemp', label: 'Mash temperature (°C)', type: 'number', blank: 1 }, { k: 'preBoil', label: 'Pre-boil gravity', type: 'number', step: '0.001', blank: 1 },
  { k: 'og', label: 'Original gravity', type: 'number', step: '0.001', blank: 1 }, { k: 'volume', label: 'Volume into fermenter (L)', type: 'number', blank: 1 },
  { k: 'pitchTemp', label: 'Pitch temperature (°C)', type: 'number', blank: 1 }, { k: 'notes', label: 'Notes', wide: 1 },
];
const REC_FIELDS = [
  { k: 'name', label: 'Beer name', req: 1 }, { k: 'style', label: 'Style' }, { k: 'size', label: 'Batch size into fermenter (L)', type: 'number' },
  { k: 'boilLoss', label: 'Boil off (L)', type: 'number' }, { k: 'trubLoss', label: 'Kettle and trub loss (L)', type: 'number' }, { k: 'packLoss', label: 'Packaging loss (%)', type: 'number' },
];
const recLines = rows => ({
  label: 'Ingredient', rows, opts: db.materials.map(m => ({ id: m.id, label: `${m.name} (${m.unit})` })),
  cols: [{ k: 'qty', label: 'Qty' }, { k: 'time', label: 'Boil min' }],
});
const recPreview = (v, rows) => {
  if (!v.size) return '';
  const c = recipeCalc({ ...v, items: rows.map(r => ({ ...r, time: r.time === '' ? '' : +r.time })) });
  return `<div class="metrics">${metric(sg(c.og), 'OG')}${metric(sg(c.fg), 'FG')}${metric(num(c.abv) + '%', 'ABV')}${metric(num(c.ibu, 0), 'IBU')}${metric(num(c.ebc, 0), 'EBC')}${metric(inr0(c.cost), 'cost')}${metric(inr(c.costL), 'per litre')}</div>`;
};
const remove = (coll, id, what) => { if (confirm(`Delete this ${what}?`)) { db[coll] = db[coll].filter(x => x.id !== id); commit(); } };

export const actions = {
  go(hash) { location.hash = hash; },
  newTank() { openForm({ title: 'Add tank', fields: TANK_FIELDS, vals: { type: 'Fermenter', capacity: 600 }, onSave: v => { db.tanks.push({ id: uid(), hygiene: 'Cleaned', cleanedOn: '', ...v }); } }); },
  editTank(id) { const t = tank(id); openForm({ title: `Edit ${t.name}`, fields: TANK_FIELDS, vals: t, onSave: v => { Object.assign(t, v); } }); },
  delTank(id) {
    if (db.batches.some(b => b.tankId === id && b.status !== 'Sold out')) return toast('A batch is in this tank, so it cannot be deleted');
    remove('tanks', id, 'tank');
  },
  logReading(id) {
    const b = db.batches.find(x => x.id === id);
    openForm({ title: `Reading for ${b.code}`, fields: READING_FIELDS, vals: { date: today() }, onSave: v => { b.log.push(v); if (v.gravity) b.fg = v.gravity; toast('Reading logged'); } });
  },
  brewLog(id) {
    const b = db.batches.find(x => x.id === id);
    openForm({ title: `Brew log ${b.code}`, fields: BREW_FIELDS, vals: b.brew, note: 'Targets come from the recipe. Anything outside tolerance is flagged as a deviation.', onSave: v => {
      b.brew = v;
      if (v.og) { b.og = v.og; if (!b.log.length) b.fg = v.og; }
      if (v.volume) b.volume = v.volume;
      const dev = deviations(b);
      toast(dev.length ? `${dev.length} deviation${dev.length > 1 ? 's' : ''} flagged` : 'Brew log saved, on spec');
    } });
  },
  newBatch() {
    if (!db.recipes.length) return toast('Add a recipe first');
    const r = db.recipes[0];
    openForm({
      title: 'New batch', vals: { recipeId: r.id, date: today(), volume: r.size, status: 'Planned' },
      fields: [{ k: 'recipeId', label: 'Recipe', type: 'select', options: recipeOpts() }, { k: 'date', label: 'Brew date', type: 'date' }, { k: 'volume', label: 'Volume into fermenter (L)', type: 'number' },
        { k: 'tankId', label: 'Tank', type: 'select', options: tankOpts() }, { k: 'status', label: 'Start as', type: 'select', options: [{ v: 'Planned', t: 'Planned (reserve ingredients)' }, { v: 'Brewing', t: 'Brewing today (issue ingredients)' }] }],
      onSave: v => {
        const rc = rec(v.recipeId), c = recipeCalc(rc);
        const b = { id: uid(), code: next('batch', 'B', 3), recipeId: rc.id, recipeVersion: rc.version, date: v.date, status: 'Planned', volume: v.volume, og: v.status === 'Brewing' ? +c.og.toFixed(3) : 0, fg: 0, tankId: v.tankId, notes: '', readyDate: '', dutyRate: 0, issued: false, issues: [], log: [], brew: emptyBrew() };
        b.fg = b.og;
        if (v.status === 'Brewing') { if (!fitOrConfirm(tank(v.tankId)) || !issue(b)) return false; b.status = 'Brewing'; }
        db.batches.push(b);
        db.tasks.push({ id: uid(), title: `Brew ${rc.name} (${b.code})`, type: 'Brewing', date: v.date, assignee: '', status: v.status === 'Brewing' ? 'Done' : 'Open' });
      },
    });
  },
  editBatch(id) {
    const b = db.batches.find(x => x.id === id);
    openForm({ title: `Edit ${b.code}`, vals: b, fields: [{ k: 'date', label: 'Brew date', type: 'date' }, { k: 'volume', label: 'Volume (L)', type: 'number' }, { k: 'tankId', label: 'Tank', type: 'select', options: tankOpts() }, { k: 'notes', label: 'Notes', wide: 1 }],
      onSave: v => { Object.assign(b, v); } });
  },
  delBatch(id) {
    const b = db.batches.find(x => x.id === id);
    if (db.packs.some(p => p.batchId === id)) return toast('This batch has been packaged, so it cannot be deleted');
    if (!confirm(`Delete ${b.code}?${b.issued ? ' Its ingredients go back to stores.' : ''}`)) return;
    for (const i of b.issues) { const m = mat(i.id); if (m) m.qty = +(m.qty + i.qty).toFixed(3); }
    db.batches = db.batches.filter(x => x.id !== id);
    commit();
  },
  printBlr() { document.getElementById('print').innerHTML = document.getElementById('main').innerHTML; window.print(); },

  newRec() {
    openForm({ title: 'New recipe', fields: REC_FIELDS, vals: { size: 500, boilLoss: 40, trubLoss: 20, packLoss: 3 }, lines: recLines([]), live: recPreview,
      onSave: (v, items) => { db.recipes.push({ id: uid(), ...v, items: items.map(i => ({ ...i, price: 0 })), version: 1, updated: today(), history: [] }); } });
  },
  editRec(id) {
    const r = rec(id);
    openForm({ title: `Edit ${r.name}`, fields: REC_FIELDS, vals: r, lines: recLines(r.items), live: recPreview, note: 'Saving creates a new version. Earlier versions stay in the history and on the batches that used them.',
      onSave: (v, items) => {
        r.history.push({ version: r.version, date: r.updated || today(), snap: { name: r.name, style: r.style, size: r.size, items: r.items } });
        Object.assign(r, v, { items: items.map(i => ({ ...i, price: 0 })), version: r.version + 1, updated: today() });
        toast(`${r.name} saved as v${r.version}`);
      } });
  },
  recHistory(id) {
    const r = rec(id), m = document.getElementById('modal');
    m.innerHTML = `<div class="sheet"><div class="grabber"></div><div class="sheet-head"><span></span><h2>${esc(r.name)} history</h2><button class="link strong" data-close>Done</button></div><div class="sheet-body">
      ${[...r.history].reverse().map(h => `<h3>v${h.version} · ${fmtDate(h.date)}</h3><p class="ingr">${h.snap.items.map(i => `${esc(mat(i.id)?.name || '?')} ${num(i.qty, 2)}`).join(' · ')}</p>`).join('')}</div></div>`;
    m.querySelector('[data-close]').onclick = () => m.close();
    m.showModal();
  },
  delRec(id) {
    if (db.batches.some(b => b.recipeId === id)) return toast('Batches use this recipe, so it cannot be deleted');
    remove('recipes', id, 'recipe');
  },

  newPack() {
    const ready = db.batches.filter(b => ['Conditioning', 'Ready'].includes(b.status));
    if (!ready.length) return toast('No batch is conditioning or ready');
    openForm({
      title: 'Package beer', vals: { batchId: ready[0].id, date: today(), format: 'Keg 30 L', units: 1 },
      fields: [{ k: 'batchId', label: 'Batch', type: 'select', options: ready.map(b => ({ v: b.id, t: `${b.code} · ${rec(b.recipeId)?.name}` })) }, { k: 'date', label: 'Date', type: 'date' },
        { k: 'format', label: 'Format', type: 'select', options: Object.keys(FORMATS).map(f => ({ v: f, t: f })) }, { k: 'units', label: 'Units', type: 'number' },
        { k: 'drawn', label: 'Litres drawn from tank (optional)', type: 'number', blank: 1 }],
      note: 'Litres drawn above what was filled are recorded as a packaging loss.',
      onSave: v => {
        const unitL = FORMATS[v.format], b = db.batches.find(x => x.id === v.batchId), filled = v.units * unitL, drawn = v.drawn === '' ? filled : v.drawn, left = tankLeft(b);
        if (drawn > left + 0.01) { toast(`Only ${num(left)} L left in the tank`); return false; }
        if (drawn < filled) { toast('Litres drawn cannot be less than litres filled'); return false; }
        let kegIds = [];
        if (v.format.startsWith('Keg')) {
          const free = db.kegs.filter(k => k.status === 'Empty' && k.size === unitL).slice(0, v.units);
          if (free.length < v.units) { toast(`Only ${free.length} empty ${unitL} L kegs available`); return false; }
          free.forEach(k => Object.assign(k, { status: 'Filled', batchId: b.id, customerId: '', since: v.date }));
          kegIds = free.map(k => k.id);
        }
        db.packs.push({ id: uid(), batchId: b.id, date: v.date, format: v.format, unitL, units: v.units, kegIds });
        if (drawn - filled > 0.01) db.losses.push({ id: uid(), date: v.date, batchId: b.id, stage: 'Packaging', litres: +(drawn - filled).toFixed(2), reason: `${v.format} run` });
        toast(`${v.units} × ${v.format} packed${kegIds.length ? ': ' + kegIds.map(id => keg(id).code).join(', ') : ''}`);
      },
    });
  },
  transfer(id) {
    const b = db.batches.find(x => x.id === id), from = tank(b.tankId), out = +tankLeft(b).toFixed(1);
    const free = db.tanks.filter(t => t.id !== b.tankId && !db.batches.some(x => x.tankId === t.id && !['Sold out', 'Planned'].includes(x.status)));
    if (!free.length) return toast('No empty tank to transfer into');
    const pref = free.find(t => /brite|serving/i.test(t.type)) || free[0];
    openForm({ title: `Transfer ${b.code}`, vals: { toId: pref.id, date: today(), litresOut: out, litresIn: out },
      fields: [{ k: 'toId', label: 'Into tank', type: 'select', options: free.map(t => ({ v: t.id, t: `${t.name} · ${t.type} · ${t.hygiene}` })) }, { k: 'date', label: 'Date', type: 'date' },
        { k: 'litresOut', label: `Litres out of ${from?.name || 'tank'}`, type: 'number' }, { k: 'litresIn', label: 'Litres into new tank', type: 'number' }],
      note: 'The difference is recorded as a transfer loss. The old tank is marked dirty and a CIP task is added.',
      onSave: v => {
        if (v.litresIn > v.litresOut) { toast('Litres in cannot be more than litres out'); return false; }
        if (!fitOrConfirm(tank(v.toId))) return false;
        b.transfers.push({ date: v.date, fromId: b.tankId, toId: v.toId, litresOut: v.litresOut, litresIn: v.litresIn });
        if (v.litresOut - v.litresIn > 0) db.losses.push({ id: uid(), date: v.date, batchId: b.id, stage: 'Transfer', litres: +(v.litresOut - v.litresIn).toFixed(2), reason: `${from?.name} to ${tank(v.toId).name}` });
        const gap = out - v.litresOut;
        if (gap > 0.5) db.losses.push({ id: uid(), date: v.date, batchId: b.id, stage: 'Fermentation', litres: +gap.toFixed(2), reason: 'Left in fermenter (yeast and trub)' });
        makeDirty(from);
        b.tankId = v.toId;
        tank(v.toId).hygiene = 'Cleaned';
        toast(`${b.code} moved to ${tank(v.toId).name}, ${from?.name} needs CIP`);
      } });
  },
  recordLoss(id) {
    const b = db.batches.find(x => x.id === id);
    openForm({ title: `Beer loss ${b.code}`, vals: { date: today(), stage: IN_TANK.includes(b.status) ? 'Fermentation' : 'Taproom' },
      fields: [{ k: 'stage', label: 'Stage', type: 'select', options: LOSS_STAGES.filter(s => !['Transfer', 'Packaging', 'Unexplained'].includes(s)).map(s => ({ v: s, t: s })) },
        { k: 'date', label: 'Date', type: 'date' }, { k: 'litres', label: 'Litres', type: 'number', req: 1 }, { k: 'reason', label: 'Reason', list: ['Yeast dump', 'Trub dump', 'Dry hop loss', 'Line flush', 'Foam and spillage', 'QC sample', 'Off flavour, dumped', 'Breakage'] }],
      note: 'Transfer and packaging losses are recorded automatically. Unexplained losses come from stock takes.',
      onSave: v => {
        if (v.litres > tankLeft(b) + 0.01 && b.status !== 'Sold out') { toast(`Only ${num(tankLeft(b))} L left in the tank`); return false; }
        db.losses.push({ id: uid(), batchId: b.id, ...v });
        toast(`${num(v.litres)} L loss recorded on ${b.code}`);
      } });
  },
  delPack(id) {
    const p = db.packs.find(x => x.id === id);
    if (!confirm('Delete this packaging run? Its kegs go back to empty.')) return;
    p.kegIds.forEach(k => { const kg = keg(k); if (kg?.status === 'Filled') Object.assign(kg, { status: 'Empty', batchId: '' }); });
    db.packs = db.packs.filter(x => x.id !== id);
    commit();
  },
};
