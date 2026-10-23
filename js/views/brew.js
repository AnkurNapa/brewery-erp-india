// Tanks, batches, batch lifecycle record, recipes and packaging.
import { db, remove, next, commit, logAct, consume, addLot, usableQty, restore, STATUSES, IN_TANK, LOSS_STAGES, moveKeg, undoKeg } from '../store.js';
import { esc, num, sg, inr, inr0, today, fmtDate, sum, uid, toast, abv, daysBetween, sgFromP } from '../util.js';
import { head, btn, link, pill, statusCls, panel, table, kpi, vessel, curve, openForm, metric } from '../ui.js';
import { mat, rec, recipeAt, tank, keg, cust, approvedQty, tankLeft, tankFit, lastCip, lossBalance, batchLoss, recipeCalc, issueList, batchCost, deviations, efficiency, duty, packedL, batchPackedL, packLeft } from '../calc.js';

const FORMATS = { 'Keg 30 L': 30, 'Keg 50 L': 50, 'Can 330 ml': 0.33, 'Bottle 330 ml': 0.33, 'Bottle 650 ml': 0.65, 'Growler 2 L': 2 };
const recipeOpts = () => db.recipes.map(r => ({ v: r.id, t: `${r.name} (v${r.version})` }));
const tankOpts = () => [{ v: '', t: 'None' }, ...db.tanks.map(t => ({ v: t.id, t: `${t.name} · ${t.type}` }))];
const emptyBrew = () => ({ mashTemp: '', steps: [], preBoil: '', og: '', volume: '', pitchTemp: '', notes: '' });

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
// Ingredients come out of stores lot by lot. Stock that is not there cannot be issued. Rejected lots are never used.
// Pending lots are used only after the brewer agrees. Each issue keeps the lots it drew and their real cost.
function issue(b) {
  const r = rec(b.recipeId), list = issueList(r, b.volume).filter(i => mat(i.id));
  const short = list.filter(i => usableQty(mat(i.id), { allowPending: true }) + 1e-9 < i.qty).map(i => mat(i.id).name);
  if (short.length) { toast(`Not enough in stores: ${short.join(', ')}. Receive it first, or correct the stock with a stock take.`); return false; }
  const pending = list.filter(i => usableQty(mat(i.id)) + 1e-9 < i.qty).map(i => mat(i.id).name);
  if (pending.length && !confirm(`Not QC approved yet: ${pending.join(', ')}.\nUse the pending deliveries for this brew?`)) return false;
  const issues = list.map(i => { const lots = consume(mat(i.id), i.qty, { allowPending: pending.length > 0 }); return { ...i, lots, cost: +sum(lots, l => l.cost).toFixed(2) }; });
  Object.assign(b, { issued: true, issues, recipeVersion: r.version });
  toast(`${b.code}: ingredients issued from stores (${inr0(sum(issues, i => i.cost))})`);
  return true;
}
export function setStatus(id, status) {
  const b = db.batches.find(x => x.id === id);
  // Once excise is booked at Ready the batch cannot go back to the tank, or the booking would vanish from a month already filed.
  if (b.readyDate && !['Ready', 'Sold out'].includes(status)) { toast(`${b.code} was booked Ready on ${fmtDate(b.readyDate)}. It can only move to Sold out.`); return commit(); }
  if (b.issued && status === 'Planned') { toast(`${b.code} has its ingredients issued, so it cannot go back to Planned`); return commit(); }
  if (!b.issued && status !== 'Planned') {
    if (!fitOrConfirm(tank(b.tankId)) || !issue(b)) return commit();
    for (const k of db.tasks.filter(k => k.status === 'Open' && k.title.includes(`(${b.code})`))) k.status = 'Done';
  }
  if (status === 'Sold out' && b.status !== 'Sold out') makeDirty(tank(b.tankId));
  if (status !== b.status) logAct(`Batch to ${status}`, b.code);
  b.status = status;
  if (!IN_TANK.includes(status) && status !== 'Planned' && !b.readyDate) { Object.assign(b, { readyDate: today(), dutyRate: db.settings.exciseBasis === 'Removal' ? 0 : db.settings.exciseRate, dutyL: +(b.volume - batchLoss(b)).toFixed(2) }); toast(db.settings.exciseBasis === 'Removal' ? `${b.code} is ready. Excise books as it is sold or dispatched` : `${b.code} booked in the excise register`); }
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
    const r = recipeAt(rec(b.recipeId), b.recipeVersion), t = r ? recipeCalc(r) : null, dev = deviations(b), cost = batchCost(b), packs = db.packs.filter(p => p.batchId === b.id);
    const kegs = db.kegs.filter(k => k.batchId === b.id), packed = batchPackedL(b);
    // Lines carry the batch they shipped from, so kegs picked up and refilled since still trace back here. Older lines fall back to the keg's current batch.
    const disp = db.dispatches.filter(d => d.lines.some(l => l.batchId === b.id || (!l.batchId && (packs.some(p => l.ref === 'p:' + p.id) || kegs.some(k => l.ref === 'k:' + k.id)))));
    const w = b.brew, row = (label, target, actual, unit = '') => `<tr><td>${label}</td><td class="n">${target}</td><td class="n">${actual === '' ? '' : actual + unit}</td></tr>`;
    return head(`${esc(b.code)} · ${esc(r?.name || '')}`, `Batch lifecycle record · recipe v${b.recipeVersion} · ${esc(tank(b.tankId)?.name || 'no tank')} · brewed ${fmtDate(b.date)}${b.readyDate ? ' · ready ' + fmtDate(b.readyDate) : ''}`,
      `${pill(b.status, statusCls(b.status))} ${btn('Print', 'printBlr', b.id, 'ghost')} ${btn('Log reading', 'logReading', b.id)}`)
      + `<div class="kpis">${kpi(num(b.volume) + ' L', 'Into fermenter')}${kpi(b.og ? `${sg(b.og)} → ${sg(b.fg)}` : 'n/a', 'OG → gravity now')}${kpi(b.og ? num(abv(b.og, b.fg)) + '%' : 'n/a', 'ABV')}${kpi(num(efficiency(b), 0) + '%', 'Brewhouse efficiency')}${kpi(inr0(cost), `Ingredients · ${inr(cost / (b.volume || 1))}/L`)}</div>
      <div class="cols">
        ${panel('Brew day', table(['Step', { t: 'Target', n: 1 }, { t: 'Actual', n: 1 }], [
          ...(r?.mash || []).map((m, i) => row(`${m.step}, ${m.mins} min`, `${m.temp}°C`, w.steps[i] ?? '', '°C')), row('Pre-boil gravity', t ? sg(sgFromP(t.steps[1].plato)) : '', w.preBoil === '' ? '' : sg(w.preBoil)), row('Original gravity', t ? sg(t.og) : '', w.og === '' ? '' : sg(w.og)),
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
      ${panel('Excise', b.readyDate ? `<p>${num(b.dutyL)} bulk litres at ${inr(b.dutyRate)} per litre = <b>${inr(duty(b))}</b>, booked ${fmtDate(b.readyDate)}.</p>` : '<p class="empty">Booked when the batch is marked Ready.</p>')}`;
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
  { k: 'preBoil', label: 'Pre-boil gravity', type: 'number', step: '0.001', blank: 1 },
  { k: 'og', label: 'Original gravity', type: 'number', step: '0.001', blank: 1 }, { k: 'volume', label: 'Volume into fermenter (L)', type: 'number', blank: 1 },
  { k: 'pitchTemp', label: 'Pitch temperature (°C)', type: 'number', blank: 1 }, { k: 'notes', label: 'Notes', wide: 1 },
];

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
    const b = db.batches.find(x => x.id === id), r = recipeAt(rec(b.recipeId), b.recipeVersion), c = recipeCalc(r);
    const stepFields = r.mash.map((m, i) => ({ k: 's' + i, label: `${m.step} actual °C (target ${m.temp}°C, ${m.mins} min)`, type: 'number', blank: 1 }));
    const tgt = { preBoil: sg(sgFromP(c.steps[1].plato)), og: sg(c.og), volume: r.size };
    const fields = [...stepFields, ...BREW_FIELDS.map(f => (tgt[f.k] ? { ...f, label: `${f.label} (target ${tgt[f.k]})` } : f))];
    const vals = { ...b.brew, ...Object.fromEntries(r.mash.map((_, i) => ['s' + i, b.brew.steps[i] ?? ''])) };
    openForm({ title: `Brew log ${b.code}`, fields, vals, note: `Targets come from ${esc(r.name)} v${r.version}. Mash steps more than 1.5°C off target, OG more than 0.004 off and volume more than 5% off are flagged.`, onSave: v => {
      b.brew = { mashTemp: '', steps: r.mash.map((_, i) => v['s' + i]), preBoil: v.preBoil, og: v.og, volume: v.volume, pitchTemp: v.pitchTemp, notes: v.notes };
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
      fields: [{ k: 'recipeId', label: 'Recipe', type: 'select', options: recipeOpts() }, { k: 'date', label: 'Brew date', type: 'date', future: 1 }, { k: 'volume', label: 'Volume into fermenter (L)', type: 'number' },
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
    openForm({ title: `Edit ${b.code}`, vals: b, fields: [{ k: 'date', label: 'Brew date', type: 'date', future: 1 }, { k: 'volume', label: 'Volume (L)', type: 'number' }, { k: 'tankId', label: 'Tank', type: 'select', options: tankOpts() }, { k: 'notes', label: 'Notes', wide: 1 }],
      onSave: v => { Object.assign(b, v); } });
  },
  delBatch(id) {
    const b = db.batches.find(x => x.id === id);
    if (db.packs.some(p => p.batchId === id)) return toast('This batch has been packaged, so it cannot be deleted');
    if (b.readyDate) return toast(`${b.code} is booked in the excise register, so it cannot be deleted`);
    if (db.losses.some(l => l.batchId === id && !l.voided)) return toast(`${b.code} has beer losses recorded, so it cannot be deleted`);
    if (!confirm(`Delete ${b.code}?${b.issued ? ' Its ingredients go back to the lots they came from.' : ''}`)) return;
    for (const i of b.issues) { const m = mat(i.id); if (m) restore(m, i.lots.length ? i.lots : [{ lotId: '', qty: i.qty, cost: i.cost }], `Returned from ${b.code}`); }
    db.batches = db.batches.filter(x => x.id !== id);
    commit();
  },
  printBlr() { document.getElementById('print').innerHTML = document.getElementById('main').innerHTML; window.print(); },

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
        if (!(v.units >= 1)) { toast('Pack at least one unit'); return false; }
        if (drawn > left + 0.01) { toast(`Only ${num(left)} L left in the tank`); return false; }
        if (drawn < filled) { toast('Litres drawn cannot be less than litres filled'); return false; }
        let kegIds = [];
        if (v.format.startsWith('Keg')) {
          const free = db.kegs.filter(k => k.status === 'Empty' && k.size === unitL).slice(0, v.units);
          if (free.length < v.units) { toast(`Only ${free.length} empty ${unitL} L kegs available`); return false; }
          free.forEach(k => moveKeg(k, 'Filled', v.date, { batchId: b.id, customerId: '' }));
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
        if (v.litresIn > tank(v.toId).capacity) { toast(`${tank(v.toId).name} holds ${num(tank(v.toId).capacity)} L`); return false; }
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
    if (db.dispatches.some(d => d.lines.some(l => l.ref === 'p:' + id))) return toast('Some of this run has been dispatched, so it cannot be deleted');
    if (p.kegIds.some(k => keg(k) && (keg(k).status !== 'Filled' || keg(k).batchId !== p.batchId))) return toast('Some kegs from this run have already left, so it cannot be deleted');
    if (!confirm('Delete this packaging run? Its kegs go back to empty.')) return;
    p.kegIds.forEach(k => { const kg = keg(k); if (kg?.status === 'Filled') undoKeg(kg, 'Empty', { batchId: '' }); });
    db.packs = db.packs.filter(x => x.id !== id);
    commit();
  },
};
