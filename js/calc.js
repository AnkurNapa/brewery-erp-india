// Lookups and every number the screens show: recipe engine, stock, MRP,
// planning, COGS and notifications.
import { db, IN_TANK } from './store.js';
import { sum, abv, today, daysAgo, daysBetween, addDays, fmtDate } from './util.js';

const by = coll => id => db[coll].find(x => x.id === id);
export const mat = by('materials'), rec = by('recipes'), prod = by('products'), tank = by('tanks'), keg = by('kegs');
export const batch = by('batches'), cust = by('customers'), vendor = by('vendors'), pack = by('packs');

// ---------- recipe engine ----------
// Extract is in gravity points per kg per litre (pale malt ~309, i.e. 37 PPG).
// IBU uses Tinseth, colour uses Morey, FG uses the yeast's attenuation.
export function recipeCalc(r) {
  const eff = (db.settings.efficiency || 72) / 100;
  const post = r.size + r.trubLoss, pre = post + r.boilLoss, sellable = r.size * (1 - r.packLoss / 100);
  let extract = 0, mcu = 0, atten = 0, cost = 0, grain = 0;
  for (const i of r.items) {
    const m = mat(i.id);
    if (!m) continue;
    cost += i.qty * m.cost;
    if (m.extract) { extract += i.qty * m.extract; grain += i.qty; }
    if (m.ebc) mcu += i.qty * 2.20462 * (m.ebc / 1.97) / (post / 3.78541);
    if (m.atten) atten = Math.max(atten, m.atten);
  }
  const og = 1 + extract * eff / (post || 1) / 1000;
  let ibu = 0;
  for (const i of r.items) {
    const m = mat(i.id);
    if (m?.alpha && +i.time > 0) ibu += 1.65 * 0.000125 ** (og - 1) * (1 - Math.exp(-0.04 * i.time)) / 4.15 * (m.alpha / 100) * i.qty * 1e6 / (post || 1);
  }
  const fg = 1 + (og - 1) * (1 - (atten || 75) / 100);
  return { og, fg, abv: abv(og, fg), ibu, ebc: 1.4922 * mcu ** 0.6859 * 1.97, pre, post, size: r.size, sellable, cost, costL: cost / (sellable || 1), extract, grain };
}

// ---------- batches ----------
export const issueList = (r, volume) => r.items.map(i => {
  const qty = +(i.qty * volume / (r.size || 1)).toFixed(3);
  return { id: i.id, qty, cost: +(qty * (mat(i.id)?.cost || 0)).toFixed(2) };
});
export const batchCost = b => sum(b.issues, i => i.cost);
export const duty = b => (b.readyDate ? b.volume * b.dutyRate : 0);
export const packedL = p => p.units * p.unitL;
export const batchPackedL = b => sum(db.packs.filter(p => p.batchId === b.id), packedL);

export function deviations(b) {
  const r = rec(b.recipeId), w = b.brew, out = [];
  if (!r) return out;
  const t = recipeCalc(r);
  if (w.mashTemp !== '' && Math.abs(w.mashTemp - 66) > 1.5) out.push(`Mash ${w.mashTemp}°C vs 66°C`);
  if (w.og !== '' && Math.abs(w.og - t.og) > 0.004) out.push(`OG ${(+w.og).toFixed(3)} vs ${t.og.toFixed(3)}`);
  if (w.volume !== '' && Math.abs(w.volume - b.volume) / (b.volume || 1) > 0.05) out.push(`Volume ${w.volume} L vs ${b.volume} L`);
  if (w.volume !== '' && Math.abs(w.volume - r.size) / (r.size || 1) > 0.05) out.push(`Volume ${w.volume} L vs recipe ${r.size} L`);
  if (w.pitchTemp !== '' && Math.abs(w.pitchTemp - (/lager|helles|pils/i.test(r.style) ? 10 : 18)) > 2) out.push(`Pitch ${w.pitchTemp}°C`);
  return out;
}

// Brewhouse efficiency: extract actually collected against the grain's potential.
export function efficiency(b) {
  const r = rec(b.recipeId), og = +b.brew.og || b.og;
  if (!r || !og) return 0;
  const potential = recipeCalc(r).extract * b.volume / (r.size || 1);
  return potential ? (og - 1) * 1000 * (b.volume + r.trubLoss) / potential * 100 : 0;
}

// ---------- stock ----------
export const reserved = mid => sum(db.batches.filter(b => b.status === 'Planned'), b => {
  const r = rec(b.recipeId);
  return r ? sum(r.items.filter(i => i.id === mid), i => i.qty * b.volume / (r.size || 1)) : 0;
});
export const onOrder = mid => sum(db.pos.filter(p => p.status === 'Open').flatMap(p => p.lines).filter(l => l.id === mid), l => l.qty);
export const available = m => m.qty - reserved(m.id);

export function mrp() {
  return db.materials.map(m => {
    const res = reserved(m.id), ord = onOrder(m.id);
    return { m, res, ord, avail: m.qty - res, suggest: Math.max(0, Math.ceil(m.reorder * 1.5 + res - m.qty - ord)) };
  });
}

const dispatched = p => sum(db.dispatches.flatMap(d => d.lines).filter(l => l.ref === 'p:' + p.id), l => l.qty);
export const packLeft = p => (p.kegIds.length ? p.kegIds.filter(id => keg(id)?.status === 'Filled' && keg(id)?.batchId === p.batchId).length : p.units - dispatched(p));
const tapL = (r, from = '') => sum(db.sales.filter(s => s.date >= from).flatMap(s => s.lines), l => { const p = prod(l.pid); return p?.recipeId === r.id ? l.qty * p.ml / 1000 : 0; });

function draughtL(r) {
  const bs = db.batches.filter(b => b.recipeId === r.id);
  const produced = sum(bs.filter(b => b.readyDate), b => b.volume);
  const wasted = sum(db.wastage.filter(w => w.kind === 'Beer' && w.ref === r.id), w => w.qty);
  return produced - sum(bs, batchPackedL) - tapL(r) - wasted;
}
// Litres physically in a tank. Ready beer drains oldest batch first.
export function tankLeft(b) {
  if (IN_TANK.includes(b.status)) return b.volume;
  if (b.status !== 'Ready') return 0;
  const r = rec(b.recipeId);
  let left = Math.max(0, r ? draughtL(r) : 0);
  for (const x of db.batches.filter(x => x.recipeId === b.recipeId && x.status === 'Ready').sort((a, c) => c.readyDate.localeCompare(a.readyDate))) {
    const here = Math.min(left, x.volume - batchPackedL(x));
    if (x.id === b.id) return Math.max(0, here);
    left -= here;
  }
  return 0;
}

export function beerStock() {
  return db.recipes.map(r => {
    const bs = db.batches.filter(b => b.recipeId === r.id);
    const produced = sum(bs.filter(b => b.readyDate), b => b.volume);
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
    if (m.expiry && daysBetween(t, m.expiry) <= 30) out.push({ lvl: 'warn', text: `${m.name} expires ${daysBetween(t, m.expiry) < 0 ? 'already' : 'in ' + daysBetween(t, m.expiry) + ' days'}`, href: '#materials' });
    if (m.qc === 'Pending') out.push({ lvl: 'info', text: `${m.name} is waiting for QC approval`, href: '#materials' });
  }
  for (const k of db.tasks.filter(k => k.status === 'Open' && k.date && k.date <= t)) out.push({ lvl: k.date < t ? 'low' : 'warn', text: `${k.date < t ? 'Overdue' : 'Today'}: ${k.title}`, href: '#calendar' });
  for (const e of db.equipment) {
    const due = e.lastService && e.serviceDays ? addDays(e.lastService, e.serviceDays) : '';
    if (due && due <= addDays(t, 7)) out.push({ lvl: due < t ? 'low' : 'warn', text: `${e.name} service ${due < t ? 'overdue since' : 'due'} ${fmtDate(due)}`, href: '#equipment' });
  }
  for (const k of db.kegs.filter(k => k.status === 'At customer' && daysBetween(k.since, t) > 30)) out.push({ lvl: 'warn', text: `Keg ${k.code} has been at ${cust(k.customerId)?.name || 'a customer'} for ${daysBetween(k.since, t)} days`, href: '#equipment' });
  for (const s of beerStock()) if (s.brewBy && s.brewBy <= addDays(t, 3) && !s.inTank) out.push({ lvl: 'warn', text: `Brew ${s.r.name} by ${fmtDate(s.brewBy)}: ${Math.round(s.daysLeft)} days of stock, ${s.cycle} day cycle`, href: '#calendar' });
  return out;
}
