// Recipes: list, recipe page (mass balance, mash profile, batches, versions), comparison.
import { db, commit, MASH_STEPS } from '../store.js';
import { esc, num, sg, inr, inr0, today, fmtDate, uid, toast, sgFromP } from '../util.js';
import { head, btn, link, pill, statusCls, panel, table, kpi, openForm, metric } from '../ui.js';
import { mat, recipeCalc, recipeAt, recipeStats, strikeTemp, mashMinutes, efficiency, lossBalance } from '../calc.js';
import { actions as home } from './home.js';

// Standard SRM colour chart, 1 to 40.
const SRM = 'FFE699 FFD878 FFCA5A FFBF42 FBB123 F8A600 F39C00 EA8F00 E58500 DE7C00 D77200 CF6900 CB6200 C35900 BB5100 B54C00 B04500 A63E00 A13700 9B3200 952D00 8E2900 882300 821E00 7B1A00 771900 701400 6A0E00 660D00 5E0B00 5A0A02 600903 520907 4C0505 470606 440607 3F0708 3B0607 3A070B 36080A'.split(' ');
export const srmHex = ebc => '#' + SRM[Math.max(0, Math.min(39, Math.round(ebc / 1.97) - 1))];
const rec = id => db.recipes.find(r => r.id === id);

// ---------- recipe form ----------
const REC_FIELDS = [
  { k: 'name', label: 'Beer name', req: 1 }, { k: 'style', label: 'Style' }, { k: 'size', label: 'Batch size into fermenter (L)', type: 'number' },
  { k: 'liquor', label: 'Mash thickness (L water per kg grain)', type: 'number' }, { k: 'boilLoss', label: 'Boil off (L)', type: 'number' },
  { k: 'trubLoss', label: 'Kettle and trub loss (L)', type: 'number' }, { k: 'fermLoss', label: 'Yeast and trub loss in fermenter (L)', type: 'number' },
  { k: 'packLoss', label: 'Packaging loss (%)', type: 'number' },
];
const NOTE_FIELD = { k: 'note', label: 'What changed in this version', wide: 1, req: 1 };
const REC_DEFAULTS = { size: 500, liquor: 2.8, boilLoss: 40, trubLoss: 20, fermLoss: 15, packLoss: 3, note: 'First version' };
// Which uses make sense for each kind of ingredient. Minutes only matter for hops in the boil or whirlpool.
const USE_BY_TYPE = { Malt: ['Mash', 'Boil'], Hops: ['Boil', 'Whirlpool', 'Dry hop'], Yeast: ['Pitch'], Adjunct: ['Mash', 'Boil', 'Fermenter'], Other: ['Mash', 'Boil', 'Fermenter'] };
const usesFor = id => USE_BY_TYPE[mat(id)?.type] || ['Mash'];
const needsMinutes = (id, use) => mat(id)?.type === 'Hops' && ['Boil', 'Whirlpool'].includes(use);
const useCell = (id, r) => {
  const opts = usesFor(id), use = opts.includes(r.use) ? r.use : opts[0];
  return opts.length === 1 ? `<span class="fixed-use">${use}</span><input type="hidden" name="l_use" value="${use}">`
    : `<select name="l_use" aria-label="Use">${opts.map(o => `<option ${o === use ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
};
const timeCell = (id, r) => {
  const use = usesFor(id).includes(r.use) ? r.use : usesFor(id)[0];
  return needsMinutes(id, use) ? `<input name="l_time" type="number" step="any" min="0" aria-label="Minutes" value="${esc(r.time ?? (use === 'Whirlpool' ? 20 : 60))}">` : '<input type="hidden" name="l_time" value="">';
};
const recLines = rows => ({
  label: 'Ingredient', rows,
  opts: db.materials.filter(m => USE_BY_TYPE[m.type]).map(m => ({ id: m.id, label: `${m.name} (${m.unit})` })),
  cols: [{ k: 'qty', label: 'Qty' }, { k: 'use', label: 'Use', text: 1, cell: useCell }, { k: 'time', label: 'Minutes', cell: timeCell }],
  update(tr, target) {
    const id = tr.querySelector('[name=l_id]').value, cell = k => tr.querySelector(`[data-col=${k}]`);
    if (target.name === 'l_id') { cell('use').innerHTML = useCell(id, {}); cell('time').innerHTML = timeCell(id, {}); }
    if (target.name === 'l_use') cell('time').innerHTML = timeCell(id, { use: target.value });
  },
});
const asItems = rows => rows.map(r => ({ id: r.id, qty: r.qty, price: 0, use: r.use, time: needsMinutes(r.id, r.use) && r.time !== '' ? +r.time : '' }));
const snapOf = r => JSON.parse(JSON.stringify({ name: r.name, style: r.style, size: r.size, boilLoss: r.boilLoss, trubLoss: r.trubLoss, fermLoss: r.fermLoss, packLoss: r.packLoss, liquor: r.liquor, items: r.items, mash: r.mash, note: r.note }));
const newVersion = (r, changes, note) => {
  r.history.push({ version: r.version, date: r.updated || today(), snap: snapOf(r) });
  Object.assign(r, changes, { note, version: r.version + 1, updated: today() });
  toast(`${r.name} saved as v${r.version}`);
};

export function massBalance(c) {
  return table(['Step', { t: 'Litres', n: 1 }, { t: 'Extract kg', n: 1 }, { t: '°Plato', n: 1 }, { t: 'Gravity', n: 1 }, 'Notes'],
    c.steps.map(x => `<tr><td>${x.step}</td><td class="n">${num(x.litres, 0)}</td><td class="n">${x.extract == null ? '' : num(x.extract, 1)}</td><td class="n">${x.plato ? num(x.plato, 1) : ''}</td><td class="n">${x.plato ? sg(sgFromP(x.plato)) : ''}</td><td><small class="sub">${esc(x.note)}</small></td></tr>`));
}
const recPreview = mash => (v, rows) => {
  if (!v.size) return '<p class="note">Enter a batch size to see the numbers.</p>';
  const c = recipeCalc({ ...v, mash, items: asItems(rows) });
  return (c.warn.length ? `<ul class="list warn">${c.warn.map(w => `<li><i class="dot warn"></i>${esc(w)}</li>`).join('')}</ul>` : '')
    + `<div class="metrics">${metric(sg(c.og), 'OG')}${metric(sg(c.fg), 'FG')}${metric(num(c.abv) + '%', 'ABV')}${metric(num(c.ibu, 0), 'IBU')}${metric(num(c.ebc, 0), 'EBC')}${metric(num(c.brewhouse, 0) + '%', 'brewhouse eff.')}${metric(inr0(c.cost), 'cost')}${metric(inr(c.costL), 'per litre')}</div>`
    + `<h3 class="mb-title">Mass balance</h3>${massBalance(c)}<p class="note">Strike water ${num(c.mashWater, 0)} L, sparge ${num(c.sparge, 0)} L. Mash and lauter efficiency ${db.settings.efficiency || 72}% (Settings).</p>`;
};

// Temperature over time, ramping at 1°C a minute between rests.
export function mashChart(mash) {
  if (!mash.length) return '';
  const pts = [];
  let t = 0;
  mash.forEach((m, i) => {
    if (i) t += Math.abs(m.temp - mash[i - 1].temp);
    pts.push([t, m.temp]);
    t += m.mins;
    pts.push([t, m.temp]);
  });
  const lo = Math.min(...mash.map(m => m.temp)) - 4, hi = Math.max(...mash.map(m => m.temp)) + 4, W = 320, H = 90;
  const x = v => (v / (t || 1) * (W - 20) + 10).toFixed(1), y = v => (H - 14 - (v - lo) / (hi - lo) * (H - 28)).toFixed(1);
  return `<svg class="mash-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mash profile over ${t} minutes">
    <polyline points="${pts.map(([a, b]) => `${x(a)},${y(b)}`).join(' ')}" fill="none" stroke="var(--orange)" stroke-width="2.5" stroke-linejoin="round"/>
    ${mash.map((m, i) => `<text x="${x(pts[i * 2][0] + m.mins / 2)}" y="${+y(m.temp) - 6}" text-anchor="middle" class="mash-label">${m.temp}°</text>`).join('')}</svg>`;
}

// ---------- comparison ----------
let picked = [];
const refOf = (r, v) => `${r.id}.${v}`;
const parseRef = ref => { const [id, v] = ref.split('.'); const r = rec(id); return r ? recipeAt(r, +v || r.version) : null; };
const usedLabel = i => `${mat(i.id)?.name || 'Deleted'} · ${i.use}${i.time !== '' ? ` ${i.time} min` : ''}`;

function compareTable(cols) {
  const calcs = cols.map(r => recipeCalc(r)), stats = cols.map(r => recipeStats(db.recipes.find(x => x.id === r.id)));
  const row = (label, vals, fmt = v => v) => {
    const shown = vals.map(fmt), diff = new Set(shown).size > 1;
    return `<tr class="${diff ? 'diff' : ''}"><td>${label}</td>${shown.map(v => `<td class="n">${v}</td>`).join('')}</tr>`;
  };
  const keys = [...new Set(cols.flatMap(r => r.items.map(i => `${i.id}|${i.use}|${i.time}`)))];
  const perHl = (r, key) => { const [id, use, time] = key.split('|'); const q = r.items.filter(i => i.id === id && i.use === use && String(i.time) === time).reduce((a, i) => a + i.qty, 0); return q ? num(q / (r.size || 1) * 100, 2) : ''; };
  const sec = t => `<tr class="sec"><td colspan="${cols.length + 1}">${t}</td></tr>`;
  return `<div class="tw"><table class="compare"><thead><tr><th></th>${cols.map(r => `<th class="n"><a href="#recipe/${r.id}">${esc(r.name)}</a><small class="sub">v${r.version}</small></th>`).join('')}</tr></thead><tbody>
    ${sec('Numbers')}
    ${row('Colour', calcs, c => `<span class="dot-swatch" style="background:${srmHex(c.ebc)}"></span>${num(c.ebc, 0)} EBC`)}
    ${row('Original gravity', calcs, c => sg(c.og))}${row('Final gravity', calcs, c => sg(c.fg))}${row('ABV', calcs, c => num(c.abv) + '%')}
    ${row('Bitterness', calcs, c => num(c.ibu, 0) + ' IBU')}${row('Bitterness to gravity (BU:GU)', calcs, c => num(c.ibu / (((c.og - 1) * 1000) || 1), 2))}
    ${row('Batch into fermenter', cols, r => num(r.size, 0) + ' L')}${row('Sellable', calcs, c => num(c.sellable, 0) + ' L')}
    ${row('Brewhouse efficiency', calcs, c => num(c.brewhouse, 0) + '%')}${row('Ingredient cost', calcs, c => inr0(c.cost))}${row('Cost per sellable litre', calcs, c => inr(c.costL))}
    ${sec('Mash profile')}
    ${row('Steps', cols, r => r.mash.map(m => `${m.temp}°C ${m.mins} min`).join(', '))}${row('Total mash time', cols, r => mashMinutes(r.mash) + ' min')}${row('Strike water', cols, r => num(strikeTemp(r), 1) + '°C')}
    ${sec('Ingredients per 100 L')}
    ${keys.map(k => { const [id, use, time] = k.split('|'); return row(esc(usedLabel({ id, use, time: time === '' ? '' : time })), cols, r => perHl(r, k)); }).join('')}
    ${sec('How it brews')}
    ${row('Times brewed (all versions)', stats, s => s.count)}${row('Average OG against target', stats, s => (s.ogGap == null ? '' : `${s.ogGap > 0 ? '+' : ''}${num(s.ogGap, 1)} points`))}
    ${row('Average brewhouse efficiency', stats, s => (s.eff == null ? '' : num(s.eff, 0) + '%'))}${row('Average beer loss', stats, s => (s.loss == null ? '' : num(s.loss) + '%'))}
    </tbody></table></div><p class="note">Rows that differ are highlighted. Ingredient amounts are per 100 L into the fermenter, so different batch sizes compare fairly.</p>`;
}

// ---------- views ----------
export const views = {
  recipes() {
    const cards = db.recipes.map(r => {
      const c = recipeCalc(r), s = recipeStats(r), on = picked.some(p => p.startsWith(r.id + '.'));
      return `<article class="card recipe"><div class="recipe-top"><span class="swatch" style="background:${srmHex(c.ebc)}"></span><div class="grow"><h3><a href="#recipe/${r.id}">${esc(r.name)}</a></h3><small>${esc(r.style)} · v${r.version}${r.updated ? ' · ' + fmtDate(r.updated) : ''}</small></div>
          <label class="pick"><input type="checkbox" data-act="pick" data-id="${refOf(r, r.version)}" ${on ? 'checked' : ''}> Compare</label></div>
        <div class="metrics">${metric(sg(c.og), 'OG')}${metric(sg(c.fg), 'FG')}${metric(num(c.abv) + '%', 'ABV')}${metric(num(c.ibu, 0), 'IBU')}${metric(num(c.ebc, 0), 'EBC')}</div>
        <div class="chain"><span><b>${num(c.pre, 0)} L</b>pre-boil</span><span><b>${num(c.post, 0)} L</b>post-boil</span><span><b>${num(c.vFv, 0)} L</b>fermenter</span><span><b>${num(c.sellable, 0)} L</b>sellable</span></div>
        <p class="brewed">${s.count ? `Brewed <b>${s.count} time${s.count > 1 ? 's' : ''}</b>, ${num(s.litres, 0)} L, last ${fmtDate(s.last)}` : 'Not brewed yet'}</p>
        ${c.warn.length ? `<p class="note bad">${esc(c.warn[0])}</p>` : ''}
        <div class="metrics">${metric(inr0(c.cost), 'batch cost')}${metric(inr(c.costL), 'per sellable litre')}</div>
        <div class="card-foot">${link('Open', 'go', 'recipe/' + r.id)}${link('Edit', 'editRec', r.id)}${link('Duplicate', 'dupRec', r.id)}${link('Delete', 'delRec', r.id, 'del')}</div></article>`;
    });
    return head('Recipes', `Mass balance engine: extract, volume, Plato and gravity at every step from mash to sellable beer. Mash and lauter efficiency ${db.settings.efficiency || 72}%.`,
      `${picked.length >= 2 ? btn(`Compare ${picked.length}`, 'go', 'compare/' + picked.join('~'), 'ghost') : ''} ${btn('New recipe', 'newRec')}`)
      + (picked.length === 1 ? '<p class="note">Tick one or two more recipes to compare.</p>' : '')
      + (cards.length ? `<div class="cards">${cards.join('')}</div>` : '<p class="empty">No recipes yet.</p>');
  },

  recipe(id) {
    const r = rec(id);
    if (!r) return head('Recipe not found');
    const c = recipeCalc(r), s = recipeStats(r);
    const versions = [{ version: r.version, date: r.updated, snap: snapOf(r), now: 1 }, ...[...r.history].reverse()];
    return head(`${esc(r.name)}`, `${esc(r.style)} · version ${r.version}${r.note ? ` · ${esc(r.note)}` : ''}`,
      `${btn('Plan brew', 'planBrew', r.id, 'ghost')} ${btn('Scale', 'scaleRec', r.id, 'ghost')} ${btn('Edit, new version', 'editRec', r.id)}`)
      + `<div class="kpis">${kpi(s.count, 'Times brewed', 'hero')}${kpi(num(s.litres, 0) + ' L', 'Litres brewed')}${kpi(s.last ? fmtDate(s.last) : 'Never', 'Last brewed')}
        ${kpi(s.ogGap == null ? 'n/a' : `${s.ogGap > 0 ? '+' : ''}${num(s.ogGap, 1)}`, 'OG points against target')}${kpi(s.eff == null ? 'n/a' : num(s.eff, 0) + '%', `Brewhouse efficiency, target ${num(c.brewhouse, 0)}%`)}</div>`
      + `<div class="cols">${panel('Numbers', `<div class="metrics">${metric(sg(c.og), 'OG')}${metric(sg(c.fg), 'FG')}${metric(num(c.abv) + '%', 'ABV')}${metric(num(c.ibu, 0), 'IBU')}${metric(num(c.ebc, 0), 'EBC')}${metric(inr(c.costL), 'per litre')}</div>
          ${c.warn.length ? `<ul class="list warn">${c.warn.map(w => `<li><i class="dot warn"></i>${esc(w)}</li>`).join('')}</ul>` : ''}
          ${table(['Ingredient', 'Use', { t: 'Qty', n: 1 }, { t: 'Per 100 L', n: 1 }, { t: 'Cost', n: 1 }], r.items.map(i => { const m = mat(i.id); return `<tr><td>${esc(m?.name || 'Deleted')}</td><td>${esc(i.use)}${i.time !== '' ? ` ${i.time} min` : ''}</td><td class="n">${num(i.qty, 2)} ${esc(m?.unit || '')}</td><td class="n">${num(i.qty / (r.size || 1) * 100, 2)}</td><td class="n">${inr0(i.qty * (m?.cost || 0))}</td></tr>`; }))}`)}
        ${panel('Mash profile', `${mashChart(r.mash)}${table(['Step', { t: 'Temp', n: 1 }, { t: 'Minutes', n: 1 }], r.mash.map(m => `<tr><td>${esc(m.step)}</td><td class="n">${m.temp}°C</td><td class="n">${m.mins}</td></tr>`),
          `<tfoot><tr><td>Total</td><td></td><td class="n">${mashMinutes(r.mash)}</td></tr></tfoot>`)}
          <p class="note">Strike water ${num(c.mashWater, 0)} L at ${num(strikeTemp(r), 1)}°C to land ${r.mash[0]?.temp ?? ''}°C with grain at 20°C. Sparge ${num(c.sparge, 0)} L.</p>
          <div class="card-acts">${btn('Edit mash profile', 'editMash', r.id, 'ghost')}</div>`)}</div>`
      + panel('Mass balance', massBalance(c))
      + panel(`Batches brewed (${s.count})`, table(['Batch', 'Version', 'Brewed', 'Status', { t: 'Litres', n: 1 }, { t: 'OG actual', n: 1 }, { t: 'OG target', n: 1 }, { t: 'Efficiency', n: 1 }, { t: 'Loss', n: 1 }],
        s.batches.map(b => { const t = recipeCalc(recipeAt(r, b.recipeVersion)), og = +b.brew.og || b.og; return `<tr><td><a class="code" href="#blr/${b.id}">${esc(b.code)}</a></td><td>v${b.recipeVersion}</td><td>${fmtDate(b.date)}</td><td>${pill(b.status, statusCls(b.status))}</td><td class="n">${num(b.volume)}</td>
          <td class="n">${og ? sg(og) : ''}</td><td class="n">${sg(t.og)}</td><td class="n">${og ? num(efficiency(b), 0) + '%' : ''}</td><td class="n">${num(lossBalance(b).pct)}%</td></tr>`; })))
      + panel(`Versions (${versions.length})`, table(['Version', 'Date', 'What changed', { t: 'OG', n: 1 }, { t: 'IBU', n: 1 }, { t: 'ABV', n: 1 }, { t: 'Brewed', n: 1 }, ''],
        versions.map(h => { const x = recipeCalc({ ...r, ...h.snap }); return `<tr><td><b>v${h.version}</b>${h.now ? ' ' + pill('Current', 'ok') : ''}</td><td>${fmtDate(h.date)}</td><td>${esc(h.snap.note || '')}</td><td class="n">${sg(x.og)}</td><td class="n">${num(x.ibu, 0)}</td><td class="n">${num(x.abv)}%</td><td class="n">${s.byVersion[h.version] || 0}</td>
          <td class="acts">${h.now ? '' : `${link('Compare with current', 'go', `compare/${refOf(r, h.version)}~${refOf(r, r.version)}`)}${link('Restore', 'restoreVer', `${r.id}.${h.version}`)}`}</td></tr>`; })));
  },

  compare(arg) {
    const cols = (arg || '').split('~').map(parseRef).filter(Boolean).slice(0, 3);
    if (cols.length < 2) return head('Compare recipes', 'Pick two or three recipes on the Recipes screen, or compare a version from a recipe page.') + '<p><a class="link" href="#recipes">Go to Recipes</a></p>';
    return head('Compare recipes', cols.map(r => `${esc(r.name)} v${r.version}`).join(' · '), btn('Clear selection', 'clearPick', '', 'ghost')) + panel('', compareTable(cols));
  },
};

// ---------- actions ----------
const MASH_LINES = rows => ({ label: 'Step', rows: rows.map(m => ({ id: m.step, temp: m.temp, mins: m.mins })), opts: MASH_STEPS.map(s => ({ id: s, label: s })),
  cols: [{ k: 'temp', label: '°C', def: id => ({ 'Acid rest': 40, 'Protein rest': 50, 'Beta amylase rest': 63, Saccharification: 66, 'Alpha amylase rest': 72, 'Mash out': 76 }[id]) }, { k: 'mins', label: 'Minutes', def: id => (id === 'Mash out' ? 10 : id === 'Saccharification' ? 60 : 20) }] });

export const actions = {
  newRec() {
    openForm({ title: 'New recipe', fields: REC_FIELDS, vals: REC_DEFAULTS, lines: recLines([]), live: recPreview([{ step: 'Saccharification', temp: 66, mins: 60 }, { step: 'Mash out', temp: 76, mins: 10 }]),
      note: 'A single infusion mash profile is added. Change it from the recipe page.',
      onSave: (v, items) => {
        if (!items.length) { toast('Add at least one ingredient'); return false; }
        const id = uid();
        db.recipes.push({ id, ...v, note: 'First version', mash: [{ step: 'Saccharification', temp: 66, mins: 60 }, { step: 'Mash out', temp: 76, mins: 10 }], items: asItems(items), version: 1, updated: today(), history: [] });
        setTimeout(() => { location.hash = 'recipe/' + id; });
      } });
  },
  editRec(id) {
    const r = rec(id);
    openForm({ title: `${r.name}, new version`, fields: [...REC_FIELDS, NOTE_FIELD], vals: { ...r, note: '' }, lines: recLines(r.items), live: recPreview(r.mash),
      note: `Saving creates v${r.version + 1}. v${r.version} stays in the history and on the batches that used it.`,
      onSave: (v, items) => {
        if (!items.length) { toast('Add at least one ingredient'); return false; }
        const { note, ...rest } = v;
        newVersion(r, { ...rest, items: asItems(items) }, note);
      } });
  },
  editMash(id) {
    const r = rec(id);
    openForm({ title: `${r.name} mash profile`, fields: [NOTE_FIELD], vals: { note: 'Mash profile changed' }, lines: MASH_LINES(r.mash),
      live: (v, rows) => `${mashChart(rows.map(x => ({ step: x.id, temp: +x.temp || 0, mins: +x.mins || 0 })))}<p class="note">Strike water ${num(strikeTemp({ ...r, mash: rows.map(x => ({ temp: +x.temp || 0 })) }), 1)}°C for the first rest. Total ${rows.reduce((a, x) => a + (+x.mins || 0), 0)} min.</p>`,
      note: `Rests run in the order listed. Saving creates v${r.version + 1}.`,
      onSave: (v, rows) => {
        const mash = rows.map(x => ({ step: x.id, temp: +x.temp || 0, mins: +x.mins || 0 })).filter(m => m.temp > 0);
        if (!mash.length) { toast('Add at least one rest'); return false; }
        newVersion(r, { mash }, v.note);
      } });
  },
  restoreVer(ref) {
    const [id, v] = ref.split('.'), r = rec(id), h = r.history.find(x => x.version === +v);
    if (!h || !confirm(`Restore v${h.version} of ${r.name}? It is saved as a new version v${r.version + 1}, so nothing is lost.`)) return;
    const { note, ...snap } = JSON.parse(JSON.stringify(h.snap));
    newVersion(r, snap, `Restored from v${h.version}`);
    commit();
  },
  dupRec(id) {
    const r = rec(id), nid = uid();
    db.recipes.push({ ...snapOf(r), id: nid, name: `${r.name} copy`, note: `Copied from ${r.name} v${r.version}`, version: 1, updated: today(), history: [] });
    toast(`${r.name} copied`);
    commit();
    location.hash = 'recipe/' + nid;
  },
  scaleRec(id) {
    const r = rec(id);
    openForm({ title: `Scale ${r.name}`, vals: { size: r.size }, fields: [{ k: 'size', label: 'New batch size into fermenter (L)', type: 'number', req: 1 }],
      note: `Ingredients and losses scale in proportion. Mash thickness, mash profile and packaging loss % stay the same. Saving creates v${r.version + 1}.`,
      onSave: v => {
        if (!(v.size > 0)) { toast('Enter a batch size'); return false; }
        const k = v.size / (r.size || 1);
        newVersion(r, { size: v.size, boilLoss: +(r.boilLoss * k).toFixed(1), trubLoss: +(r.trubLoss * k).toFixed(1), fermLoss: +(r.fermLoss * k).toFixed(1), items: r.items.map(i => ({ ...i, qty: +(i.qty * k).toFixed(3) })) }, `Scaled from ${num(r.size)} L to ${num(v.size)} L`);
      } });
  },
  planBrew(id) { home.planBrew(id); },
  delRec(id) {
    if (db.batches.some(b => b.recipeId === id)) return toast('Batches use this recipe, so it cannot be deleted');
    if (confirm('Delete this recipe?')) { db.recipes = db.recipes.filter(x => x.id !== id); picked = picked.filter(p => !p.startsWith(id + '.')); commit(); }
  },
  pick(ref) {
    picked = picked.includes(ref) ? picked.filter(p => p !== ref) : [...picked, ref].slice(-3);
    dispatchEvent(new Event('db'));
  },
  clearPick() { picked = []; location.hash = 'recipes'; },
};
