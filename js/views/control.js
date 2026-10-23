// Quality and control: CIP log, beer losses, stock take with reconciliation.
import { db, remove, next, commit, persist, consume, addLot, usableQty, logAct, guardLock, CIP_CYCLES, LOSS_STAGES } from '../store.js';
import { esc, num, inr, inr0, today, fmtDate, sum, uid, toast, daysAgo, daysBetween } from '../util.js';
import { head, btn, link, pill, panel, table, kpi, openForm, seg, voidForm } from '../ui.js';
import { periodSeg, periodRange, periodText, inPeriod } from '../period.js';
import { mat, rec, tank, recipeCalc, tankLeft, tankFit, lastCip, lossBalance, packLeft, beerReconcile } from '../calc.js';

const targetName = id => tank(id)?.name || db.equipment.find(e => e.id === id)?.name || 'Deleted';
const occupied = id => db.batches.some(b => b.tankId === id && !['Sold out', 'Planned'].includes(b.status));
let countMode = 'count';

export const views = {
  cip() {
    const from = daysAgo(30), recent = db.cip.filter(c => c.date >= from && !c.voided);
    const chemCost = sum(recent, c => c.chemQty * (mat(c.chemicalId)?.cost || 0));
    const dirty = db.tanks.filter(t => t.hygiene === 'Dirty').length;
    return head('CIP', `Clean in place for every tank. A tank must be sanitised within ${db.settings.cipDays || 3} days before it is filled.`, btn('Log CIP', 'logCip'))
      + `<div class="kpis four">${kpi(dirty, 'Tanks needing CIP', dirty ? 'alert' : '')}${kpi(recent.length, 'Cycles, 30 days')}${kpi(recent.filter(c => c.result === 'Fail').length, 'Failed checks, 30 days')}${kpi(inr0(chemCost), 'Chemicals, 30 days')}</div>`
      + panel('Tank hygiene', table(['Tank', 'State', 'Last CIP', 'Fit to fill', ''], db.tanks.map(t => {
        const c = lastCip(t.id), f = tankFit(t), busy = occupied(t.id);
        return `<tr><td><b>${esc(t.name)}</b><small class="sub">${esc(t.type)}</small></td><td>${busy ? pill('In use', 'info') : pill(t.hygiene, t.hygiene === 'Dirty' ? 'low' : t.hygiene === 'Sanitised' ? 'ok' : 'orange')}</td>
          <td>${c ? `${fmtDate(c.date)} · ${esc(c.cycle)} ${c.result === 'Fail' ? pill('Fail', 'low') : ''}` : 'None'}</td><td>${busy ? '' : f.ok ? pill('Yes', 'ok') : `<small class="sub">${esc(f.why)}</small>`}</td>
          <td class="acts">${busy ? '' : link('Log CIP', 'logCip', t.id)}</td></tr>`;
      })))
      + panel('CIP log', table(['Date', 'Vessel', 'Cycle', { t: 'Strength', n: 1 }, { t: 'Temp', n: 1 }, { t: 'Minutes', n: 1 }, 'Chemical', 'Operator', 'Check', ''],
        [...db.cip].sort((a, b) => b.date.localeCompare(a.date)).map(c => `<tr class="${c.voided ? 'voided' : ''}"><td>${fmtDate(c.date)}</td><td>${esc(targetName(c.targetId))}</td><td>${esc(c.cycle)}</td><td class="n">${c.conc === '' ? '' : c.conc + '%'}</td>
          <td class="n">${c.temp === '' ? '' : c.temp + '°C'}</td><td class="n">${c.mins}</td><td>${c.chemicalId ? `${esc(mat(c.chemicalId)?.name)} ${num(c.chemQty, 2)} ${esc(mat(c.chemicalId)?.unit || '')}` : ''}</td><td>${esc(c.operator)}</td>
          <td>${pill(c.result, c.result === 'Pass' ? 'ok' : 'low')}${c.note ? `<small class="sub">${esc(c.note)}</small>` : ''}${c.voided ? `<small class="sub void">Voided ${fmtDate(c.voided)}: ${esc(c.voidReason)}</small>` : ''}</td><td class="acts">${c.voided ? '' : link('Void', 'voidCip', c.id, 'del')}</td></tr>`)));
  },

  losses() {
    const range = periodRange(), target = db.settings.lossTarget || 5, allow = db.settings.lossAllow || 0;
    const shown = db.losses.filter(l => inPeriod(l.date, range)), recs = shown.filter(l => !l.voided), legacy = db.wastage.filter(w => w.kind === 'Beer' && !w.voided && inPeriod(w.date, range));
    const bs = db.batches.filter(b => b.issued && (inPeriod(b.date, range) || recs.some(l => l.batchId === b.id)));
    const total = sum(recs, l => l.litres) + sum(legacy, w => w.qty), brewed = sum(bs, b => b.volume) || 1;
    const byStage = LOSS_STAGES.map(st => [st, sum(recs.filter(l => l.stage === st), l => l.litres) + (st === 'Taproom' ? sum(legacy, w => w.qty) : 0)]).filter(([, l]) => l);
    const worst = byStage.slice().sort((a, b) => b[1] - a[1])[0];
    const max = Math.max(1, ...byStage.map(([, l]) => l));
    return head('Beer losses', `Every litre lost between the fermenter and the glass. Target ${target}% per batch.`, btn('Losses CSV', 'csvLosses', '', 'ghost'))
      + periodSeg()
      + `<div class="kpis four">${kpi(num(total, 0) + ' L', `Beer lost ${periodText()}`)}${kpi(num(total / brewed * 100) + '%', allow ? `Of litres brewed, allowance ${num(allow)}%` : 'Of litres brewed', total / brewed * 100 > (allow || target) ? 'alert' : '')}${kpi(worst ? esc(worst[0]) : 'n/a', 'Biggest stage')}${kpi(num(sum(recs.filter(l => l.stage === 'Unexplained'), l => l.litres)) + ' L', 'Unexplained, from stock takes')}</div>`
      + `<div class="cols">${panel('By stage', table(['Stage', '', { t: 'Litres', n: 1 }, { t: 'Share', n: 1 }], byStage.map(([st, l]) => `<tr><td>${esc(st)}</td><td><div class="bar"><i style="width:${l / max * 100}%"></i></div></td><td class="n">${num(l)}</td><td class="n">${num(l / (total || 1) * 100, 0)}%</td></tr>`)))}
        ${panel('By batch', table(['Batch', 'Beer', { t: 'Into FV', n: 1 }, { t: 'Lost', n: 1 }, { t: '%', n: 1 }], bs.map(b => {
          const lb = lossBalance(b);
          return `<tr><td><a class="code" href="#blr/${b.id}">${esc(b.code)}</a></td><td>${esc(rec(b.recipeId)?.name || '')}</td><td class="n">${num(b.volume)}</td><td class="n">${num(lb.total)}</td><td class="n"><span class="${lb.pct > target ? 'bad' : 'good'}">${num(lb.pct)}%</span></td></tr>`;
        })))}</div>`
      + panel('Loss records', table(['Date', 'Batch', 'Stage', { t: 'Litres', n: 1 }, 'Reason', ''], [...shown].sort((a, b) => b.date.localeCompare(a.date)).map(l => {
        const b = db.batches.find(x => x.id === l.batchId);
        return `<tr class="${l.voided ? 'voided' : ''}"><td>${fmtDate(l.date)}</td><td><a class="code" href="#blr/${l.batchId}">${esc(b?.code || '')}</a></td><td>${pill(l.stage, l.stage === 'Unexplained' ? 'low' : 'grey')}</td><td class="n">${num(l.litres)}</td><td>${esc(l.reason)}${l.voided ? `<small class="sub void">Voided ${fmtDate(l.voided)}: ${esc(l.voidReason)}</small>` : ''}</td>
          <td class="acts">${l.stage === 'Unexplained' || l.voided ? '' : link('Void', 'voidLoss', l.id, 'del')}</td></tr>`;
      })) + '<p class="note">Record a loss from the tank card or the batch record. Transfer and packaging losses are captured automatically. Unexplained losses come from stock takes and cannot be voided. A voided loss stays listed and puts its litres back.</p>');
  },

  stocktake() {
    return head('Stock take', 'Count what is really on the floor, see the variance against the system, then post adjustments with a reason.', `${btn('Adjustments CSV', 'csvAdjust', '', 'ghost')} ${btn('New count', 'newCount')}`)
      + panel('', table(['Count', 'Date', { t: 'Lines', n: 1 }, { t: 'Counted', n: 1 }, { t: 'Variance value', n: 1 }, 'Status', ''], [...db.counts].sort((a, b) => b.date.localeCompare(a.date)).map(c => {
        const done = c.lines.filter(l => l.counted !== '').length, val = sum(c.lines.filter(l => l.counted !== ''), l => (l.counted - l.system) * l.cost);
        return `<tr><td><a class="code" href="#count/${c.id}">${esc(c.no)}</a></td><td>${fmtDate(c.date)}</td><td class="n">${c.lines.length}</td><td class="n">${done}</td><td class="n"><span class="${val < 0 ? 'bad' : ''}">${inr0(val)}</span></td>
          <td>${pill(c.status, c.status === 'Posted' ? 'ok' : 'orange')}</td><td class="acts">${c.status === 'Open' ? link('Delete', 'delCount', c.id, 'del') : ''}</td></tr>`;
      })))
      + panel('Adjustments posted', table(['Date', 'Count', 'Item', { t: 'Change', n: 1 }, { t: 'Value', n: 1 }, 'Reason'], [...db.adjustments].sort((a, b) => b.date.localeCompare(a.date)).map(a =>
        `<tr><td>${fmtDate(a.date)}</td><td>${esc(db.counts.find(c => c.id === a.countId)?.no || '')}</td><td>${esc(a.label)}</td><td class="n">${a.delta > 0 ? '+' : ''}${num(a.delta, 2)}</td><td class="n">${inr0(a.value)}</td><td>${esc(a.reason)}</td></tr>`))
        + '<p class="note">Adjustments are permanent. They cannot be edited or deleted.</p>');
  },

  count(id) {
    const c = db.counts.find(x => x.id === id);
    if (!c) return head('Count not found');
    const posted = c.status === 'Posted', mode = posted ? 'review' : countMode;
    const groups = [['m:', 'Raw materials'], ['p:', 'Packaged goods'], ['b:', 'Beer in tanks'], ['k:', 'Kegs']];
    const flag = l => l.counted !== '' && (Math.abs(l.counted - l.system) > Math.max(0.02 * l.system, 0.001) || Math.abs((l.counted - l.system) * l.cost) > 1000);
    const body = groups.map(([pre, title]) => {
      const lines = c.lines.map((l, i) => [l, i]).filter(([l]) => l.ref.startsWith(pre));
      if (!lines.length) return '';
      return panel(title, mode === 'count'
        ? table(['Item', 'Unit', { t: 'Counted', n: 1 }], lines.map(([l, i]) => `<tr><td>${esc(l.label)}</td><td>${esc(l.unit)}</td><td class="n"><input class="count-in" type="number" step="any" min="0" inputmode="decimal" data-cline="${i}" data-count="${c.id}" value="${l.counted}" aria-label="Counted ${esc(l.label)}"></td></tr>`))
        : table(['Item', { t: 'System', n: 1 }, { t: 'Counted', n: 1 }, { t: 'Variance', n: 1 }, { t: 'Value', n: 1 }, 'Reason'], lines.map(([l, i]) => {
          const d = l.counted === '' ? 0 : l.counted - l.system;
          return `<tr class="${flag(l) ? 'flag' : ''}"><td>${esc(l.label)}</td><td class="n">${num(l.system, 2)} ${esc(l.unit)}</td><td class="n">${l.counted === '' ? '<small class="sub">not counted</small>' : num(l.counted, 2)}</td>
            <td class="n ${d < 0 ? 'bad' : ''}">${d ? (d > 0 ? '+' : '') + num(d, 2) : ''}</td><td class="n">${d ? inr0(d * l.cost) : ''}</td>
            <td>${posted ? esc(l.reason) : d ? `<input class="reason-in" list="dl-reasons" data-creason="${i}" data-count="${c.id}" value="${esc(l.reason)}" placeholder="Reason" aria-label="Reason for ${esc(l.label)}">` : ''}</td></tr>`;
        })));
    }).join('');
    const r = beerReconcile(c);
    const recon = panel('Beer reconciliation', r.prev ? table(['', { t: 'Litres', n: 1 }], [
      `<tr><td>Opening, ${esc(r.prev.no)} on ${fmtDate(r.prev.date)}</td><td class="n">${num(r.opening)}</td></tr>`, `<tr><td>+ Brewed into fermenters</td><td class="n">${num(r.brewed)}</td></tr>`,
      `<tr><td>− Sold in the taproom</td><td class="n">${num(r.sold)}</td></tr>`, `<tr><td>− Packaged</td><td class="n">${num(r.packaged)}</td></tr>`, `<tr><td>− Recorded losses</td><td class="n">${num(r.lost)}</td></tr>`,
      `<tr><td><b>Expected closing</b></td><td class="n"><b>${num(r.expected)}</b></td></tr>`, `<tr><td><b>Counted closing</b></td><td class="n"><b>${num(r.counted)}</b></td></tr>`],
      `<tfoot><tr><td>Unexplained difference</td><td class="n"><span class="${r.counted - r.expected < 0 ? 'bad' : 'good'}">${num(r.counted - r.expected)}</span></td></tr></tfoot>`)
      : '<p class="empty">This is the first count, so it sets the opening balance for the next one.</p>');
    const val = sum(c.lines.filter(l => l.counted !== ''), l => (l.counted - l.system) * l.cost);
    return head(`Stock take ${esc(c.no)}`, `${fmtDate(c.date)} · ${c.lines.filter(l => l.counted !== '').length} of ${c.lines.length} counted · variance ${inr0(val)}`,
      posted ? pill('Posted', 'ok') : btn('Post adjustments', 'postCount', c.id))
      + (posted ? '' : seg('countMode', [['count', 'Count (blind)'], ['review', 'Review variance']], countMode))
      + body + (mode === 'review' ? recon : '')
      + '<datalist id="dl-reasons"><option value="Miscount"><option value="Spillage"><option value="Unrecorded issue"><option value="Unrecorded loss"><option value="Damaged"><option value="Theft"></datalist>';
  },
};

// ---------- actions ----------
export const actions = {
  logCip(targetId) {
    const targets = [...db.tanks.filter(t => !occupied(t.id)).map(t => ({ v: t.id, t: `${t.name} · ${t.hygiene}` })), ...db.equipment.map(e => ({ v: e.id, t: e.name }))];
    if (!targets.length) return toast('Every tank is in use');
    const chems = db.materials.filter(m => m.type === 'Chemical');
    openForm({ title: 'Log CIP', vals: { targetId: targetId || targets[0].v, date: today(), cycle: 'Full CIP', conc: 2, temp: 75, mins: 45, chemicalId: chems[0]?.id || '', result: 'Pass' },
      fields: [{ k: 'targetId', label: 'Vessel', type: 'select', options: targets }, { k: 'date', label: 'Date', type: 'date' },
        { k: 'cycle', label: 'Cycle', type: 'select', options: CIP_CYCLES.map(c => ({ v: c, t: c })) }, { k: 'conc', label: 'Strength (%)', type: 'number', blank: 1 },
        { k: 'temp', label: 'Temperature (°C)', type: 'number', blank: 1 }, { k: 'mins', label: 'Minutes', type: 'number', blank: 1 },
        { k: 'chemicalId', label: 'Chemical', type: 'select', options: [{ v: '', t: 'None' }, ...chems.map(m => ({ v: m.id, t: `${m.name} (${m.unit})` }))] }, { k: 'chemQty', label: 'Chemical used', type: 'number' },
        { k: 'operator', label: 'Operator' }, { k: 'result', label: 'Check (ATP swab or visual)', type: 'select', options: [{ v: 'Pass', t: 'Pass' }, { v: 'Fail', t: 'Fail' }] }, { k: 'note', label: 'Note', wide: 1 }],
      note: 'Full CIP and Sanitiser cycles that pass leave the tank sanitised. Other passing cycles leave it cleaned. A failed check leaves it dirty.',
      onSave: v => {
        const m = mat(v.chemicalId);
        if (m && v.chemQty && !consume(m, v.chemQty)) { toast(`Only ${num(usableQty(m), 2)} ${m.unit} of ${m.name} approved in stores`); return false; }
        db.cip.push({ id: uid(), ...v });
        const t = tank(v.targetId);
        if (t) {
          Object.assign(t, v.result === 'Pass' ? { hygiene: ['Full CIP', 'Sanitiser'].includes(v.cycle) ? 'Sanitised' : 'Cleaned', cleanedOn: v.date } : { hygiene: 'Dirty' });
          if (v.result === 'Pass' && t.hygiene === 'Sanitised') for (const k of db.tasks.filter(k => k.status === 'Open' && k.type === 'Cleaning' && k.title.includes(t.name))) k.status = 'Done';
        }
        toast(v.result === 'Pass' ? `${targetName(v.targetId)} ${t ? t.hygiene.toLowerCase() : 'cleaned'}` : `${targetName(v.targetId)} failed, repeat the cycle`);
      } });
  },
  // A voided passing clean no longer counts, so the vessel goes back to Dirty until it is cleaned again.
  voidCip(id) { const c = db.cip.find(x => x.id === id); voidForm('CIP record', c, () => { const t = tank(c.targetId); if (t && c.result === 'Pass' && !occupied(t.id)) t.hygiene = 'Dirty'; }); },
  voidLoss(id) { voidForm('loss record', db.losses.find(x => x.id === id)); },

  newCount() {
    if (db.counts.some(c => c.status === 'Open') && !confirm('Another count is still open. Start a new one anyway?')) return;
    const lines = [
      ...db.materials.map(m => ({ ref: 'm:' + m.id, label: m.name, unit: m.unit, system: +m.qty.toFixed(3), counted: '', cost: m.cost, reason: '' })),
      ...db.packs.filter(p => !p.kegIds.length && packLeft(p) > 0).map(p => {
        const b = db.batches.find(x => x.id === p.batchId), r = rec(b?.recipeId);
        return { ref: 'p:' + p.id, label: `${p.format} · ${r?.name || ''} ${b?.code || ''}`, unit: 'units', system: packLeft(p), counted: '', cost: r ? +(recipeCalc(r).costL * p.unitL).toFixed(2) : 0, reason: '' };
      }),
      ...db.batches.filter(b => tankLeft(b) > 0).map(b => {
        const r = rec(b.recipeId);
        return { ref: 'b:' + b.id, label: `${tank(b.tankId)?.name || 'No tank'} · ${b.code} ${r?.name || ''}`, unit: 'L', system: +tankLeft(b).toFixed(1), counted: '', cost: r ? +recipeCalc(r).costL.toFixed(2) : 0, reason: '' };
      }),
      { ref: 'k:all', label: 'Kegs owned, not marked lost', unit: 'kegs', system: db.kegs.filter(k => k.status !== 'Lost').length, counted: '', cost: 0, reason: '' },
    ];
    const c = { id: uid(), no: next('count', 'ST', 4), date: today(), status: 'Open', lines };
    db.counts.push(c);
    countMode = 'count';
    commit();
    location.hash = 'count/' + c.id;
  },
  delCount(id) { remove('counts', id, 'open count'); },
  postCount(id) {
    const c = db.counts.find(x => x.id === id), changes = c.lines.filter(l => l.counted !== '' && Math.abs(l.counted - l.system) > 1e-6);
    if (!guardLock(c.date)) return;
    const missing = changes.filter(l => !l.reason.trim());
    if (missing.length) { countMode = 'review'; dispatchEvent(new Event('db')); return toast(`Add a reason for ${missing.length} line${missing.length > 1 ? 's' : ''} with a variance`); }
    // Stock may have moved since the count was opened. Variances are worked out against today's figures, not the snapshot,
    // so a brew issued mid-count is not booked as a loss as well.
    const now = l => { const [kind, ref] = l.ref.split(':'), p = db.packs.find(x => x.id === ref), b = db.batches.find(x => x.id === ref);
      return kind === 'm' ? mat(ref)?.qty ?? 0 : kind === 'p' ? (p ? packLeft(p) : 0) : kind === 'b' ? (b ? +tankLeft(b).toFixed(1) : 0) : db.kegs.filter(k => k.status !== 'Lost').length; };
    const moved = changes.filter(l => Math.abs(now(l) - l.system) > 1e-6).length;
    if (!confirm(`Post ${changes.length} adjustment${changes.length === 1 ? '' : 's'}? This cannot be undone.${moved ? `\n${moved} item${moved === 1 ? ' has' : 's have'} moved since the count started. Variances use today's figures.` : ''}`)) return;
    for (const l of changes) {
      const d = l.counted - now(l), [kind, ref] = l.ref.split(':');
      if (kind === 'm') { const m = mat(ref); if (m) { if (d < 0) consume(m, Math.min(-d, usableQty(m, { allowPending: true, allowRejected: true })), { allowPending: true, allowRejected: true }); else if (d > 0) addLot(m, { qty: d, qc: 'Approved', date: c.date, ref: c.no }); } }
      // Missing cans or bottles are written off the run's stock. The run itself keeps what was packed, so no beer returns to the tank.
      if (kind === 'p') { const p = db.packs.find(x => x.id === ref); if (p) p.adjusted = +(p.adjusted + d).toFixed(3); }
      if (kind === 'b') db.losses.push({ id: uid(), date: c.date, batchId: ref, stage: 'Unexplained', litres: +(-d).toFixed(2), reason: `${c.no}: ${l.reason}` });
      db.adjustments.push({ id: uid(), date: c.date, countId: c.id, ref: l.ref, label: l.label, delta: +d.toFixed(3), value: +(d * l.cost).toFixed(2), reason: l.reason });
    }
    c.status = 'Posted';
    logAct('Posted stock take', c.no, `${changes.length} adjustment${changes.length === 1 ? '' : 's'}`);
    toast(`${c.no} posted with ${changes.length} adjustment${changes.length === 1 ? '' : 's'}`);
    commit();
  },
};

// Inline count and reason inputs save as you go, without redrawing mid-typing.
export function onInput(e) {
  const c = db.counts.find(x => x.id === e.target.dataset.count);
  if (!c || c.status !== 'Open') return false;
  if (e.target.dataset.cline) c.lines[+e.target.dataset.cline].counted = e.target.value === '' ? '' : Math.max(0, +e.target.value);
  else if (e.target.dataset.creason) c.lines[+e.target.dataset.creason].reason = e.target.value.slice(0, 200);
  else return false;
  persist();
  return true;
}

export const segs = { countMode: v => { countMode = v; } };
