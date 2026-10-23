// Lookups and every number the screens show: recipe engine, stock, MRP,
// planning, COGS and notifications.
import { db, IN_TANK } from './store.js';
import { sum, abv, today, daysAgo, daysBetween, addDays, fmtDate, platoOf, sgFromP, pFromSg } from './util.js';

const by = coll => id => db[coll].find(x => x.id === id);
export const mat = by('materials'), rec = by('recipes'), prod = by('products'), tank = by('tanks'), keg = by('kegs');
export const batch = by('batches'), cust = by('customers'), vendor = by('vendors'), pack = by('packs');

// ---------- recipe engine ----------
// Mass balance: extract kg is carried step by step and Plato is solved from
// extract mass and volume at each step. Malt extract is % as is, from the
// malt analysis. Mash and lauter efficiency comes from Settings. IBU uses
// Tinseth, colour uses Morey, FG uses the yeast's apparent attenuation.
export const WHIRLPOOL_FACTOR = 0.5; // whirlpool hops isomerise at roughly half boil utilisation
export function recipeCalc(r) {
  const st = db.settings, eff = (st.efficiency || 72) / 100, absorb = st.grainAbsorb || 1, dryAbs = st.dryHopAbsorb || 5;
  const size = r.size || 0, post = size + (r.trubLoss || 0), pre = post + (r.boilLoss || 0);
  const lines = r.items.map(i => ({ ...i, m: mat(i.id) })).filter(i => i.m);
  const at = use => lines.filter(i => i.use === use);
  const ext = i => i.qty * (i.m.extract || 0) / 100;
  const grain = sum(at('Mash').filter(i => i.m.type === 'Malt'), i => i.qty);
  const potential = sum(at('Mash'), ext), boilExt = sum(at('Boil'), ext), fvExt = sum(at('Fermenter'), ext);
  const fvLitres = sum(at('Fermenter').filter(i => /^l/i.test(i.m.unit)), i => i.qty);
  const mashWater = grain * (r.liquor || 2.8), sparge = Math.max(0, pre - (mashWater - grain * absorb));
  const kettleExt = potential * eff, postExt = kettleExt + boilExt;
  const pPre = platoOf(kettleExt, pre), pPost = platoOf(postExt, post);
  const intoFvExt = postExt * (size / (post || 1)) + fvExt, vFv = size + fvLitres, pFv = platoOf(intoFvExt, vFv);
  const og = sgFromP(pFv), boilSg = sgFromP(pPost);
  const atten = Math.max(0, ...at('Pitch').map(i => i.m.atten || 0)) || 75;
  const fg = 1 + (og - 1) * (1 - atten / 100);
  let ibu = 0;
  for (const i of lines.filter(i => i.m.alpha && ['Boil', 'Whirlpool'].includes(i.use) && +i.time > 0)) {
    const util = 1.65 * 0.000125 ** (boilSg - 1) * (1 - Math.exp(-0.04 * i.time)) / 4.15 * (i.use === 'Whirlpool' ? WHIRLPOOL_FACTOR : 1);
    ibu += util * (i.m.alpha / 100) * i.qty * 1e6 / (post || 1);
  }
  ibu *= size / (vFv || 1);
  const mcu = 8.345 * sum(lines.filter(i => i.m.ebc), i => i.qty * i.m.ebc / 1.97) / (vFv || 1);
  const dryKg = sum(at('Dry hop'), i => i.qty), fermLoss = r.fermLoss || 0;
  const bright = Math.max(0, vFv - fermLoss - dryKg * dryAbs), sellable = bright * (1 - (r.packLoss || 0) / 100);
  const cost = sum(lines, i => i.qty * i.m.cost);
  const warn = [];
  if (!potential && !boilExt && !fvExt) warn.push('No fermentable has an extract value, so gravity cannot be worked out.');
  for (const i of lines.filter(i => i.m.type === 'Malt' && !i.m.extract)) warn.push(`${i.m.name} has no extract % set.`);
  for (const i of lines.filter(i => ['Boil', 'Whirlpool'].includes(i.use) && i.m.type === 'Hops' && !i.m.alpha)) warn.push(`${i.m.name} has no alpha acid set, so it adds no bitterness.`);
  if (!at('Pitch').length) warn.push('No yeast: FG assumes 75% attenuation.');
  if (grain && mashWater - grain * absorb > pre) warn.push('Mash water alone is more than the pre-boil volume. Use a thicker mash or a bigger batch.');
  // Does this brew fit the kit in Brewery setup?
  const bh = st.brewhouse || {}, mashVol = mashWater + grain * 0.67, cooling = post * 1.2;
  if (bh.mashTun && mashVol > bh.mashTun) warn.push(`Mash is ${Math.round(mashVol)} L (water plus grain), over the ${bh.mashTun} L mash tun.`);
  if (bh.kettle && pre > bh.kettle) warn.push(`Pre-boil volume ${Math.round(pre)} L is over the ${bh.kettle} L kettle.`);
  if (bh.hlt && mashWater + sparge > bh.hlt) warn.push(`Strike and sparge need ${Math.round(mashWater + sparge)} L of hot liquor, more than the ${bh.hlt} L HLT holds. Plan a refill.`);
  if (bh.clt && cooling > bh.clt) warn.push(`Cooling ${Math.round(post)} L of wort needs about ${Math.round(cooling)} L of cold liquor, more than the ${bh.clt} L CLT.`);
  if (bh.lengthHL && size > bh.lengthHL * 100 * 1.05) warn.push(`Batch of ${size} L is bigger than the ${bh.lengthHL} HL brew length. Split it into brews.`);
  const steps = [
    { step: 'Mash', litres: mashWater, extract: potential, note: grain ? `${grain.toFixed(1)} kg grain at ${(r.liquor || 2.8).toFixed(1)} L/kg` : '' },
    { step: 'Kettle, pre-boil', litres: pre, extract: kettleExt, plato: pPre, note: `Sparge ${sparge.toFixed(0)} L` },
    { step: 'End of boil', litres: post, extract: postExt, plato: pPost, note: `Boil off ${(r.boilLoss || 0).toFixed(0)} L` },
    { step: 'Into fermenter', litres: vFv, extract: intoFvExt, plato: pFv, note: `Kettle loss ${(r.trubLoss || 0).toFixed(0)} L` },
    { step: 'Bright beer', litres: bright, plato: pFromSg(fg), note: `Yeast and trub ${fermLoss.toFixed(0)} L${dryKg ? `, dry hop ${(dryKg * dryAbs).toFixed(0)} L` : ''}` },
    { step: 'Sellable', litres: sellable, note: `Packaging ${(r.packLoss || 0)}%` },
  ];
  return {
    og, fg, abv: abv(og, fg), ibu, ebc: 1.4922 * mcu ** 0.6859 * 1.97, pre, post, size, vFv, bright, sellable, cost, costL: cost / (sellable || 1),
    extract: potential, grain, mashWater, sparge, brewhouse: potential ? (intoFvExt - fvExt) / potential * 100 : 0, steps, warn,
  };
}

// A recipe as it stood at a given version: current fields, overlaid with that version's snapshot.
export function recipeAt(r, version) {
  if (!r || !version || version === r.version) return r;
  const h = r.history.find(x => x.version === version);
  return h ? { ...r, ...h.snap, version, history: [] } : r;
}
// Strike water temperature for the first rest, grain at 20°C (metric form of Palmer's infusion equation).
export const strikeTemp = (r, grainTemp = 20) => (r.mash[0] ? (0.41 / (r.liquor || 2.8)) * (r.mash[0].temp - grainTemp) + r.mash[0].temp : 0);
export const mashMinutes = mash => sum(mash, x => x.mins);
// How a recipe has actually brewed: count, litres and actual against target.
export function recipeStats(r) {
  const bs = db.batches.filter(b => b.recipeId === r.id && b.issued).sort((a, b) => b.date.localeCompare(a.date));
  const withOg = bs.filter(b => +b.brew.og || b.og);
  const target = b => recipeCalc(recipeAt(r, b.recipeVersion)).og;
  return {
    batches: bs, count: bs.length, litres: sum(bs, b => b.volume), last: bs[0]?.date || '',
    ogGap: withOg.length ? sum(withOg, b => ((+b.brew.og || b.og) - target(b)) * 1000) / withOg.length : null,
    eff: withOg.length ? sum(withOg, efficiency) / withOg.length : null,
    loss: bs.length ? sum(bs, b => lossBalance(b).pct) / bs.length : null,
    byVersion: bs.reduce((a, b) => ({ ...a, [b.recipeVersion]: (a[b.recipeVersion] || 0) + 1 }), {}),
  };
}

// ---------- batches ----------
export const issueList = (r, volume) => r.items.map(i => {
  const qty = +(i.qty * volume / (r.size || 1)).toFixed(3);
  return { id: i.id, qty, cost: +(qty * (mat(i.id)?.cost || 0)).toFixed(2) };
});
export const batchCost = b => sum(b.issues, i => i.cost);
export const batchLoss = b => sum(db.losses.filter(l => l.batchId === b.id), l => l.litres);
export const duty = b => (b.readyDate ? (b.dutyL || b.volume) * b.dutyRate : 0);
// Excise on removal: booked on taproom pours and dispatches when Settings says so.
export const removalDuty = l => (db.settings.exciseBasis === 'Removal' ? +(l * db.settings.exciseRate).toFixed(2) : 0);
export const exciseIn = (from, to = '9999') => sum(db.batches.filter(b => b.readyDate >= from && b.readyDate <= to), duty)
  + sum(db.sales.filter(s => s.date >= from && s.date <= to), s => s.duty) + sum(db.dispatches.filter(d => d.date >= from && d.date <= to), d => d.duty);
export const beerLitres = lines => sum(lines, l => { const p = prod(l.pid); return p?.kind === 'beer' ? l.qty * p.ml / 1000 : 0; });
export const packedL = p => p.units * p.unitL;
export const batchPackedL = b => sum(db.packs.filter(p => p.batchId === b.id), packedL);

export function deviations(b) {
  const r = recipeAt(rec(b.recipeId), b.recipeVersion), w = b.brew, out = [];
  if (!r) return out;
  const t = recipeCalc(r);
  r.mash.forEach((m, i) => { const a = (w.steps || [])[i]; if (a !== '' && a != null && Math.abs(a - m.temp) > 1.5) out.push(`${m.step} ${a}°C vs ${m.temp}°C`); });
  if (w.og !== '' && Math.abs(w.og - t.og) > 0.004) out.push(`OG ${(+w.og).toFixed(3)} vs ${t.og.toFixed(3)}`);
  if (w.volume !== '' && Math.abs(w.volume - b.volume) / (b.volume || 1) > 0.05) out.push(`Volume ${w.volume} L vs ${b.volume} L`);
  if (w.volume !== '' && Math.abs(w.volume - r.size) / (r.size || 1) > 0.05) out.push(`Volume ${w.volume} L vs recipe ${r.size} L`);
  if (w.pitchTemp !== '' && Math.abs(w.pitchTemp - (/lager|helles|pils/i.test(r.style) ? 10 : 18)) > 2) out.push(`Pitch ${w.pitchTemp}°C`);
  return out;
}

// Brewhouse efficiency: extract actually collected against the grain's potential.
// Brewhouse efficiency: extract that reached the fermenter against the grain's potential.
export function efficiency(b) {
  const r = rec(b.recipeId), og = +b.brew.og || b.og;
  if (!r || !og) return 0;
  const potential = recipeCalc(r).extract * b.volume / (r.size || 1), p = pFromSg(og);
  return potential ? b.volume * sgFromP(p) * p / 100 / potential * 100 : 0;
}

// ---------- stock ----------
export const reserved = mid => sum(db.batches.filter(b => b.status === 'Planned'), b => {
  const r = rec(b.recipeId);
  return r ? sum(r.items.filter(i => i.id === mid), i => i.qty * b.volume / (r.size || 1)) : 0;
});
export const onOrder = mid => sum(db.pos.filter(p => p.status === 'Open').flatMap(p => p.lines).filter(l => l.id === mid), l => l.qty);
export const approvedQty = m => sum(m.lots.filter(l => l.qc === 'Approved'), l => l.qty);
export const pendingLots = m => m.lots.filter(l => l.qc === 'Pending' && l.qty > 0);
export const expiryOf = m => m.lots.filter(l => l.qty > 0 && l.expiry).map(l => l.expiry).sort()[0] || '';
export const available = m => approvedQty(m) - reserved(m.id);

export function mrp() {
  return db.materials.map(m => {
    const res = reserved(m.id), ord = onOrder(m.id);
    return { m, res, ord, avail: approvedQty(m) - res, suggest: Math.max(0, Math.ceil(m.reorder * 1.5 + res - m.qty - ord)) };
  });
}

const dispatched = p => sum(db.dispatches.flatMap(d => d.lines).filter(l => l.ref === 'p:' + p.id), l => l.qty);
export const packLeft = p => (p.kegIds.length ? p.kegIds.filter(id => keg(id)?.status === 'Filled' && keg(id)?.batchId === p.batchId).length : p.units - dispatched(p));
const tapL = (r, from = '') => sum(db.sales.filter(s => s.date >= from).flatMap(s => s.lines), l => { const p = prod(l.pid); return p?.recipeId === r.id ? l.qty * p.ml / 1000 : 0; });

function draughtL(r) {
  const bs = db.batches.filter(b => b.recipeId === r.id);
  const produced = sum(bs.filter(b => b.readyDate), b => b.volume - batchLoss(b));
  const wasted = sum(db.wastage.filter(w => w.kind === 'Beer' && w.ref === r.id), w => w.qty);
  return produced - sum(bs, batchPackedL) - tapL(r) - wasted;
}
// Litres physically in a tank. Ready beer drains oldest batch first.
export function tankLeft(b) {
  if (IN_TANK.includes(b.status)) return Math.max(0, b.volume - batchLoss(b));
  if (b.status !== 'Ready') return 0;
  const r = rec(b.recipeId);
  let left = Math.max(0, r ? draughtL(r) : 0);
  for (const x of db.batches.filter(x => x.recipeId === b.recipeId && x.status === 'Ready').sort((a, c) => c.readyDate.localeCompare(a.readyDate))) {
    const here = Math.min(left, x.volume - batchLoss(x) - batchPackedL(x));
    if (x.id === b.id) return Math.max(0, here);
    left -= here;
  }
  return 0;
}

export function beerStock() {
  return db.recipes.map(r => {
    const bs = db.batches.filter(b => b.recipeId === r.id);
    const produced = sum(bs.filter(b => b.readyDate), b => b.volume - batchLoss(b));
    const draught = draughtL(r);
    const packagedL = sum(db.packs.filter(p => bs.some(b => b.id === p.batchId)), p => packLeft(p) * p.unitL);
    const firstReady = bs.map(b => b.readyDate).filter(Boolean).sort()[0];
    const win = firstReady ? Math.max(1, Math.min(14, daysBetween(firstReady, today()))) : 14;
    const from = daysAgo(win);
    const out14 = tapL(r, from) + sum(db.dispatches.filter(d => d.date >= from).flatMap(d => d.lines), l => {
      const p = l.ref.startsWith('p:') ? pack(l.ref.slice(2)) : null, k = l.ref.startsWith('k:') ? keg(l.ref.slice(2)) : null;
      const bid = p?.batchId || k?.batchId;
      return bs.some(b => b.id === bid) ? l.litres : 0;
    });
    const rate = out14 / win;
    const done = bs.filter(b => b.readyDate && b.date);
    const cycle = done.length ? Math.round(sum(done, b => daysBetween(b.date, b.readyDate)) / done.length) : 14;
    const inTank = sum(bs.filter(b => IN_TANK.includes(b.status) || b.status === 'Planned'), b => b.volume);
    const total = Math.max(0, draught) + packagedL;
    const daysLeft = rate ? total / rate : Infinity;
    const brewBy = rate ? addDays(today(), Math.floor(daysLeft + (inTank ? inTank / rate : 0) - cycle)) : '';
    return { r, produced, draught, packagedL, total, rate, daysLeft, cycle, inTank, brewBy };
  });
}

// ---------- hygiene ----------
// A tank is fit to fill when it was sanitised within the CIP window.
export function tankFit(t) {
  if (!t) return { ok: true, why: '' };
  const days = db.settings.cipDays || 3, age = t.cleanedOn ? daysBetween(t.cleanedOn, today()) : Infinity;
  if (t.hygiene === 'Dirty') return { ok: false, why: `${t.name} is dirty` };
  if (t.hygiene !== 'Sanitised') return { ok: false, why: `${t.name} is cleaned but not sanitised` };
  if (age > days) return { ok: false, why: `${t.name} was sanitised ${age} days ago (limit ${days})` };
  return { ok: true, why: '' };
}
export const lastCip = (targetId, before = '9999') => db.cip.filter(c => c.targetId === targetId && c.date <= before).sort((a, b) => b.date.localeCompare(a.date))[0];

// ---------- losses ----------
export function lossBalance(b) {
  const r = rec(b.recipeId), stages = {};
  for (const l of db.losses.filter(l => l.batchId === b.id)) stages[l.stage] = (stages[l.stage] || 0) + l.litres;
  const brewhouse = r ? Math.max(0, r.size - b.volume) : 0, total = sum(Object.values(stages));
  return { v0: b.volume, brewhouse, stages, total, pct: b.volume ? total / b.volume * 100 : 0 };
}

// Beer in tanks between two counts: opening + brewed - sold - packaged - losses.
export function beerReconcile(count) {
  const prev = db.counts.filter(c => c.status === 'Posted' && c.date < count.date).sort((a, b) => b.date.localeCompare(a.date))[0];
  const beer = c => sum(c.lines.filter(l => l.ref.startsWith('b:')), l => (l.counted === '' ? l.system : l.counted));
  const from = prev?.date || '', to = count.date, inP = d => d > from && d <= to;
  const brewed = sum(db.batches.filter(b => b.issued && inP(b.date)), b => b.volume);
  const sold = sum(db.sales.filter(s => inP(s.date)).flatMap(s => s.lines), l => { const p = prod(l.pid); return p?.kind === 'beer' ? l.qty * p.ml / 1000 : 0; });
  const packaged = sum(db.packs.filter(p => inP(p.date)), packedL);
  const lost = sum(db.losses.filter(l => inP(l.date) && l.stage !== 'Unexplained'), l => l.litres) + sum(db.wastage.filter(w => w.kind === 'Beer' && inP(w.date)), w => w.qty);
  const opening = prev ? beer(prev) : null, expected = opening == null ? null : opening + brewed - sold - packaged - lost;
  return { prev, opening, brewed, sold, packaged, lost, expected, counted: beer(count) };
}

// ---------- money ----------
export function invoice(s) {
  let beer = 0, food = 0;
  for (const l of s.lines) { const a = l.qty * l.price; if (l.kind === 'food') food += a; else beer += a; }
  const vat = beer * s.vat / 100, cgst = food * s.gst / 200;
  return { beer, food, vat, cgst, sgst: cgst, total: beer + food + vat + 2 * cgst };
}

// Cost per litre for each beer: ingredients from recipe, utilities spread over
// litres brewed in the same window, excise at the current rate.
export function cogs(days = 30) {
  const from = daysAgo(days);
  const brewedL = sum(db.batches.filter(b => b.issued && b.date >= from), b => b.volume) || 1;
  const utilL = sum(db.utilities.filter(u => u.date >= from), u => u.cost) / brewedL;
  return db.recipes.map(r => {
    const c = recipeCalc(r);
    const beerLines = db.sales.flatMap(s => s.lines).filter(l => prod(l.pid)?.recipeId === r.id);
    const litres = sum(beerLines, l => l.qty * prod(l.pid).ml / 1000);
    const priceL = litres ? sum(beerLines, l => l.qty * l.price) / litres : 0;
    const rm = c.cost / (c.sellable || 1), exc = db.settings.exciseRate * r.size / (c.sellable || 1);
    const total = rm + utilL + exc;
    return { r, rm, util: utilL, exc, total, priceL, margin: priceL ? (priceL - total) / priceL * 100 : 0 };
  });
}

// ---------- notifications ----------
export function alerts() {
  const out = [], t = today();
  for (const m of db.materials) {
    const av = available(m);
    if (av <= m.reorder) out.push({ lvl: 'low', text: `${m.name} at ${+av.toFixed(2)} ${m.unit} available, reorder at ${m.reorder}`, href: '#purchasing' });
    const exp = expiryOf(m), pend = pendingLots(m).length;
    if (exp && daysBetween(t, exp) <= 30) out.push({ lvl: 'warn', text: `${m.name} ${daysBetween(t, exp) < 0 ? 'has expired stock' : 'expires in ' + daysBetween(t, exp) + ' days'}`, href: '#materials' });
    if (pend) out.push({ lvl: 'info', text: `${m.name}: ${pend} deliver${pend > 1 ? 'ies' : 'y'} waiting for QC`, href: '#materials' });
  }
  const lb = db.settings.lastBackup, age = lb ? daysBetween(lb, t) : Infinity;
  if (age > 7) out.push({ lvl: 'warn', text: lb ? `Last backup was ${age} days ago` : 'No backup taken yet', href: '#settings' });
  for (const k of db.tasks.filter(k => k.status === 'Open' && k.date && k.date <= t)) out.push({ lvl: k.date < t ? 'low' : 'warn', text: `${k.date < t ? 'Overdue' : 'Today'}: ${k.title}`, href: '#calendar' });
  for (const e of db.equipment) {
    const due = e.lastService && e.serviceDays ? addDays(e.lastService, e.serviceDays) : '';
    if (due && due <= addDays(t, 7)) out.push({ lvl: due < t ? 'low' : 'warn', text: `${e.name} service ${due < t ? 'overdue since' : 'due'} ${fmtDate(due)}`, href: '#equipment' });
  }
  for (const k of db.kegs.filter(k => k.status === 'At customer' && daysBetween(k.since, t) > 30)) out.push({ lvl: 'warn', text: `Keg ${k.code} has been at ${cust(k.customerId)?.name || 'a customer'} for ${daysBetween(k.since, t)} days`, href: '#equipment' });
  for (const tk of db.tanks) {
    const planned = db.batches.find(b => b.tankId === tk.id && b.status === 'Planned');
    if (tk.hygiene === 'Dirty') out.push({ lvl: planned ? 'low' : 'info', text: `${tk.name} needs CIP${planned ? `, ${planned.code} is planned into it on ${fmtDate(planned.date)}` : ''}`, href: '#cip' });
    const c = lastCip(tk.id);
    if (c?.result === 'Fail') out.push({ lvl: 'low', text: `${tk.name} failed its last CIP check on ${fmtDate(c.date)}`, href: '#cip' });
  }
  const target = db.settings.lossTarget || 5;
  for (const b of db.batches.filter(b => b.issued && b.date >= daysAgo(60))) {
    const lb = lossBalance(b);
    if (lb.pct > target) out.push({ lvl: 'warn', text: `${b.code} has lost ${lb.pct.toFixed(1)}% of its beer, target ${target}%`, href: '#losses' });
  }
  for (const c of db.counts.filter(c => c.status === 'Open' && daysBetween(c.date, t) > 3)) out.push({ lvl: 'warn', text: `Stock take ${c.no} is still open`, href: '#count/' + c.id });
  for (const s of beerStock()) if (s.brewBy && s.brewBy <= addDays(t, 3) && !s.inTank) out.push({ lvl: 'warn', text: `Brew ${s.r.name} by ${fmtDate(s.brewBy)}: ${Math.round(s.daysLeft)} days of stock, ${s.cycle} day cycle`, href: '#calendar' });
  return out;
}
