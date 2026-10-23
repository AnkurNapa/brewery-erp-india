// All data lives in one object in localStorage. Every load and import goes
// through clean(), which rebuilds each record from a schema so a tampered
// backup cannot smuggle markup into ids, dates or numbers.
import { toast, today, fyOf } from './util.js';
import { demo } from './demo.js';

const KEY = 'brewhouse-erp-v2';
export const STATUSES = ['Planned', 'Brewing', 'Fermenting', 'Conditioning', 'Ready', 'Sold out'];
export const IN_TANK = ['Brewing', 'Fermenting', 'Conditioning'];
export const KEG_STATES = ['Empty', 'Filled', 'At customer', 'Cleaning', 'Lost'];
export const HYGIENE = ['Cleaned', 'Sanitised', 'Dirty'];
export const CIP_CYCLES = ['Full CIP', 'Caustic', 'Acid', 'Sanitiser', 'Rinse'];
export const LOSS_STAGES = ['Fermentation', 'Transfer', 'Packaging', 'Taproom', 'Dispatch', 'QC samples', 'Dump', 'Unexplained'];
export const PAY_MODES = ['Cash', 'UPI', 'Card', 'Bank transfer', 'Cheque'];
export const TASK_TYPES = ['Brewing', 'Filling', 'Dispatch', 'Cleaning', 'Maintenance', 'Other'];

const ID = v => String(v ?? '').replace(/[^\w-]/g, '').slice(0, 40);
const REF = v => String(v ?? '').replace(/[^\w:-]/g, '').slice(0, 44);
const STR = v => String(v ?? '').slice(0, 400);
const NUM = v => (Number.isFinite(+v) ? +v : 0);
const OPT = v => (v === '' || v == null || !Number.isFinite(+v) ? '' : +v);
const DATE = v => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
const BOOL = v => v === true;
const GEO = max => v => (v === '' || v == null || !(Math.abs(+v) <= max) ? '' : +v);
const ONE = list => v => (list.includes(v) ? v : list[0]);
const obj = schema => x => { const o = {}; for (const k in schema) o[k] = schema[k](x?.[k]); return o; };
const LIST = schema => v => (Array.isArray(v) ? v.map(obj(schema)) : []);
const IDS = v => (Array.isArray(v) ? v.map(ID) : []);

export const USES = ['Mash', 'Boil', 'Whirlpool', 'Dry hop', 'Pitch', 'Fermenter'];
const LINE = { id: ID, qty: NUM, price: NUM, time: OPT, use: ONE(['', ...USES]) };
export const MASH_STEPS = ['Acid rest', 'Protein rest', 'Beta amylase rest', 'Saccharification', 'Alpha amylase rest', 'Mash out'];
const MASH = LIST({ step: ONE(MASH_STEPS), temp: NUM, mins: NUM });
const RSNAP = { name: STR, style: STR, size: NUM, boilLoss: NUM, trubLoss: NUM, fermLoss: NUM, packLoss: NUM, liquor: NUM, items: LIST(LINE), mash: MASH, note: STR };
const SCHEMA = {
  materials: {
    id: ID, name: STR, type: STR, unit: STR, qty: NUM, reorder: NUM, cost: NUM, extract: NUM, ebc: NUM, alpha: NUM, atten: NUM, expiry: DATE, qc: ONE(['Approved', 'Pending', 'Rejected']), vendorId: ID,
    lots: LIST({ id: ID, date: DATE, qty: NUM, expiry: DATE, qc: ONE(['Approved', 'Pending', 'Rejected']), cost: NUM, ref: STR }),
  },
  recipes: { id: ID, name: STR, style: STR, size: NUM, boilLoss: NUM, trubLoss: NUM, fermLoss: NUM, packLoss: NUM, liquor: NUM, mash: MASH, note: STR, items: LIST(LINE), version: NUM, updated: DATE, history: LIST({ version: NUM, date: DATE, snap: obj(RSNAP) }) },
  products: { id: ID, name: STR, kind: ONE(['beer', 'food']), recipeId: ID, ml: NUM, price: NUM, hsn: STR },
  tanks: { id: ID, name: STR, type: STR, capacity: NUM, hygiene: ONE(HYGIENE), cleanedOn: DATE },
  batches: {
    id: ID, code: STR, recipeId: ID, recipeVersion: NUM, date: DATE, status: ONE(STATUSES), volume: NUM, og: NUM, fg: NUM, tankId: ID, notes: STR,
    readyDate: DATE, dutyRate: NUM, dutyL: NUM, issued: BOOL,
    transfers: LIST({ date: DATE, fromId: ID, toId: ID, litresOut: NUM, litresIn: NUM }), issues: LIST({ id: ID, qty: NUM, cost: NUM, lots: LIST({ lotId: ID, qty: NUM, cost: NUM }) }),
    log: LIST({ date: DATE, gravity: OPT, temp: OPT, ph: OPT, note: STR }),
    brew: obj({ mashTemp: OPT, steps: v => (Array.isArray(v) ? v.map(OPT) : []), preBoil: OPT, og: OPT, volume: OPT, pitchTemp: OPT, notes: STR }),
  },
  sales: { id: ID, no: STR, date: DATE, customer: STR, gstin: STR, vat: NUM, gst: NUM, dispatchId: ID, duty: NUM, lines: LIST({ pid: ID, name: STR, kind: ONE(['beer', 'food']), qty: NUM, price: NUM, ml: NUM, recipeId: ID, hsn: STR }), type: ONE(['Invoice', 'Credit note']), ref: STR, reason: STR, cancelledBy: ID,
    mode: STR, credit: BOOL, dueDate: DATE, payments: LIST({ date: DATE, amount: NUM, mode: STR, ref: STR }) },
  kegs: { id: ID, code: STR, size: NUM, status: ONE(KEG_STATES), batchId: ID, customerId: ID, since: DATE, history: LIST({ date: DATE, status: ONE(KEG_STATES), batchId: ID, customerId: ID }) },
  equipment: { id: ID, code: STR, name: STR, type: STR, lastService: DATE, serviceDays: NUM },
  customers: { id: ID, name: STR, type: STR, gstin: STR, phone: STR, city: STR, lat: GEO(90), lng: GEO(180), terms: NUM },
  vendors: { id: ID, name: STR, gstin: STR, phone: STR, supplies: STR },
  pos: { id: ID, no: STR, date: DATE, vendorId: ID, status: ONE(['Open', 'Received']), lines: LIST(LINE) },
  packs: { id: ID, batchId: ID, date: DATE, format: STR, unitL: NUM, units: NUM, adjusted: NUM, kegIds: IDS },
  dispatches: { id: ID, no: STR, date: DATE, customerId: ID, invoiceId: ID, duty: NUM, lines: LIST({ ref: REF, label: STR, qty: NUM, litres: NUM, batchId: ID }), ref: STR, reason: STR, cancelledBy: ID },
  tasks: { id: ID, title: STR, type: ONE(TASK_TYPES), date: DATE, assignee: STR, status: ONE(['Open', 'Done']) },
  utilities: { id: ID, date: DATE, type: STR, qty: NUM, unit: STR, cost: NUM },
  wastage: { id: ID, date: DATE, kind: ONE(['Beer', 'Material']), ref: ID, qty: NUM, reason: STR, lots: LIST({ lotId: ID, qty: NUM, cost: NUM }), voided: DATE, voidReason: STR },
  cip: { id: ID, date: DATE, targetId: ID, cycle: ONE(CIP_CYCLES), conc: OPT, temp: OPT, mins: OPT, chemicalId: ID, chemQty: NUM, operator: STR, result: ONE(['Pass', 'Fail']), note: STR, voided: DATE, voidReason: STR },
  losses: { id: ID, date: DATE, batchId: ID, stage: ONE(LOSS_STAGES), litres: NUM, reason: STR, voided: DATE, voidReason: STR },
  counts: { id: ID, no: STR, date: DATE, status: ONE(['Open', 'Posted']), lines: LIST({ ref: REF, label: STR, unit: STR, system: NUM, counted: OPT, cost: NUM, reason: STR }) },
  adjustments: { id: ID, date: DATE, countId: ID, ref: REF, label: STR, delta: NUM, value: NUM, reason: STR },
  log: { ts: STR, by: STR, action: STR, ref: STR, note: STR },
};
export const BREWHOUSE_TYPES = ['2 vessel', '3 vessel', '4 vessel'];
const BREWHOUSE = obj({ type: ONE(BREWHOUSE_TYPES), lengthHL: NUM, mashTun: NUM, lauterTun: NUM, kettle: NUM, whirlpool: BOOL, boilRate: NUM, boilMins: NUM, deadSpace: NUM, cycleHrs: NUM, hlt: NUM, hltTemp: NUM, clt: NUM, cltTemp: NUM, hx: STR });
const SETTINGS = { brewhouse: BREWHOUSE, name: STR, gstin: STR, address: STR, state: STR, prefix: STR, exciseRate: NUM, vat: NUM, foodGst: NUM, efficiency: NUM, cipDays: NUM, lossTarget: NUM, lossAllow: NUM, grainAbsorb: NUM, dryHopAbsorb: NUM, exciseBasis: ONE(['Ready', 'Removal']), tradeRateL: NUM, kegValue: NUM, lastBackup: DATE, user: STR, lockedUntil: DATE, docYear: STR };
const SEQ = { batch: NUM, inv: NUM, po: NUM, disp: NUM, keg: NUM, count: NUM, cn: NUM };

export function clean(d) {
  const out = { settings: obj(SETTINGS)(d?.settings), seq: obj(SEQ)(d?.seq) };
  for (const k in SCHEMA) out[k] = LIST(SCHEMA[k])(d?.[k]);
  for (const k in out.seq) out.seq[k] ||= 1;
  // Older data has one stock figure per material: turn it into a single lot.
  for (const m of out.materials) {
    if (!m.lots.length && m.qty) m.lots.push({ id: 'l' + m.id, date: '', qty: m.qty, expiry: m.expiry, qc: m.qc, cost: m.cost, ref: 'Opening stock' });
    m.qty = +m.lots.reduce((a, l) => a + l.qty, 0).toFixed(3);
    // Extract used to be gravity points per kg per litre (pale malt ~309). It is now % as is.
    if (m.extract > 100) m.extract = +(m.extract / 3.846).toFixed(1);
  }
  // Give every recipe line a use. Keep minutes only where they mean something.
  const typeOf = id => out.materials.find(m => m.id === id)?.type;
  const fixLine = i => {
    const t = typeOf(i.id);
    if (!i.use) i.use = t === 'Hops' ? (i.time === '' ? 'Dry hop' : i.time === 0 ? 'Whirlpool' : 'Boil') : t === 'Yeast' ? 'Pitch' : t === 'Adjunct' && i.time !== '' ? 'Boil' : 'Mash';
    if (!(t === 'Hops' && ['Boil', 'Whirlpool'].includes(i.use))) i.time = '';
  };
  out.recipes.forEach((r, i) => {
    r.items.forEach(fixLine);
    r.history.forEach(h => h.snap.items.forEach(fixLine));
    if (d?.recipes?.[i]?.fermLoss == null) r.fermLoss = +(r.size * 0.03).toFixed(1);
    r.liquor ||= 2.8;
    const single = [{ step: 'Saccharification', temp: 66, mins: 60 }, { step: 'Mash out', temp: 76, mins: 10 }];
    if (!r.mash.length) r.mash = single;
    r.history.forEach(h => { if (!h.snap.mash.length) h.snap.mash = r.mash; });
  });
  // Sale lines keep their own serve size and beer, so editing or retiring a menu item never rewrites past sales.
  for (const s of out.sales) for (const l of s.lines) {
    const p = out.products.find(x => x.id === l.pid);
    if (p && !l.ml) Object.assign(l, { ml: p.ml, recipeId: p.recipeId });
    l.hsn ||= p?.hsn || HSN[l.kind];
  }
  for (const p of out.products) p.hsn ||= HSN[p.kind];
  // Older data booked Ready without the litres: use the volume, as the register did then.
  out.batches.forEach((b, i) => { if (b.readyDate && d?.batches?.[i]?.dutyL == null) b.dutyL = b.volume; });
  // Older brew logs kept one mash temperature: it becomes the first step's actual.
  for (const b of out.batches) if (!b.brew.steps.length && b.brew.mashTemp !== '') b.brew.steps = [b.brew.mashTemp];
  return out;
}
export const isBackup = d => d && typeof d === 'object' && d.settings && Array.isArray(d.batches);

export const db = {};
export function replace(d) {
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(db, clean(d));
}
export function load() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(KEY)); } catch { /* blocked or corrupt: fall back to demo */ }
  replace(isBackup(d) ? d : demo());
}
// The demo is recognised by its fictional GSTIN, so browsers saved before this check still get the demo bar.
export const isDemo = () => db.settings.gstin === demo().settings.gstin;
// An empty brewery keeps only process defaults. Tax rates, prices and the kit are blanked so no demo figure survives.
export function startEmpty() {
  const s = demo().settings;
  replace({ settings: { ...s, name: 'My Brewery', gstin: '', address: '', state: '', prefix: '', exciseRate: 0, vat: 0, tradeRateL: 0, kegValue: 0, lastBackup: '', brewhouse: { ...s.brewhouse, lengthHL: 0, mashTun: 0, lauterTun: 0, kettle: 0, hlt: 0, clt: 0 } } });
  logAct('Started an empty brewery');
  commit();
}
// Every keg move goes through here so each keg keeps its own trail: filled with what, sent where, back when.
// ponytail: last 100 moves per keg, enough for years of turns; archive older moves if anyone needs more.
export function moveKeg(k, status, date = today(), changes = {}) {
  Object.assign(k, changes, { status, since: date });
  k.history = [...k.history, { date, status, batchId: k.batchId, customerId: k.customerId }].slice(-100);
}
// Deleting a dispatch or packaging run takes back the move it made rather than logging a new one.
export function undoKeg(k, status, changes = {}) {
  k.history = k.history.slice(0, -1);
  Object.assign(k, changes, { status, since: k.history.at(-1)?.date || k.since });
}
// ---------- controls ----------
// Books locked up to a date: nothing dated on or before it can be posted, deleted or voided.
// In a browser-only app this guards against mistakes, not against someone editing the browser's storage.
export const locked = date => !!db.settings.lockedUntil && !!date && date <= db.settings.lockedUntil;
const lockMsg = () => `Books are locked up to ${db.settings.lockedUntil}. Change the lock date in Settings first.`;
// Who did what and when, kept with the data and in every backup. The name comes from Settings on this device.
// ponytail: last 2000 entries; export the CSV if a longer trail is needed.
export function logAct(action, ref = '', note = '') {
  const ts = new Date();
  db.log = [...db.log, { ts: `${today()} ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`, by: db.settings.user || '', action, ref, note }].slice(-2000);
}
export function remove(coll, id, what) {
  const r = db[coll].find(x => x.id === id);
  if (locked(r?.date)) return toast(lockMsg());
  if (!confirm(`Delete this ${what}?`)) return;
  db[coll] = db[coll].filter(x => x.id !== id);
  logAct(`Deleted ${what}`, r?.no || r?.code || r?.name || r?.title || r?.date || '');
  commit();
}
export function guardLock(date) { if (!locked(date)) return true; toast(lockMsg()); return false; }
export function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { toast('This browser blocked saving. Export a backup from Settings.'); }
}
export function commit() {
  persist();
  dispatchEvent(new Event('db'));
}
// Stock moves through lots so QC and expiry apply per delivery.
// Draws stock lot by lot: approved first, earliest expiry first. Rejected lots are never used unless the caller is
// writing them off; pending lots only once the user has agreed. Returns the lots drawn with their own cost, so a batch
// knows exactly which deliveries went into it. Returns null and changes nothing when there is not enough.
export const usableQty = (m, { allowPending = false, allowRejected = false } = {}) =>
  m.lots.filter(l => l.qty > 0 && (l.qc === 'Approved' || (allowPending && l.qc === 'Pending') || (allowRejected && l.qc === 'Rejected'))).reduce((a, l) => a + l.qty, 0);
export function consume(m, qty, { allowPending = false, allowRejected = false } = {}) {
  const ok = l => l.qty > 0 && (l.qc === 'Approved' || (allowPending && l.qc === 'Pending') || (allowRejected && l.qc === 'Rejected'));
  const order = m.lots.filter(ok).sort((a, b) => (a.qc !== 'Approved') - (b.qc !== 'Approved') || (a.expiry || '9999').localeCompare(b.expiry || '9999'));
  if (usableQty(m, { allowPending, allowRejected }) + 1e-9 < qty) return null;
  let left = qty;
  const drawn = [];
  for (const l of order) {
    if (left <= 1e-9) break;
    const take = Math.min(left, l.qty);
    l.qty = +(l.qty - take).toFixed(3);
    left -= take;
    drawn.push({ lotId: l.id, qty: +take.toFixed(3), cost: +(take * (l.cost || m.cost)).toFixed(2) });
  }
  m.lots = m.lots.filter(l => Math.abs(l.qty) > 1e-9 || l.qc === 'Pending');
  m.qty = +m.lots.reduce((a, l) => a + l.qty, 0).toFixed(3);
  return drawn;
}
// Puts drawn stock back into the lots it came from, or a new lot at its own cost if that lot is gone.
export function restore(m, drawn, ref) {
  for (const d of drawn) {
    const l = m.lots.find(x => x.id === d.lotId);
    if (l) l.qty = +(l.qty + d.qty).toFixed(3); else addLot(m, { qty: d.qty, qc: 'Approved', cost: d.qty ? d.cost / d.qty : m.cost, date: today(), ref });
  }
  m.qty = +m.lots.reduce((a, l) => a + l.qty, 0).toFixed(3);
}
export function addLot(m, lot) {
  m.lots.push({ id: Math.random().toString(36).slice(2, 9), date: '', expiry: '', qc: 'Pending', cost: m.cost, ref: '', ...lot });
  m.qty = +m.lots.reduce((a, l) => a + l.qty, 0).toFixed(3);
}
export const next = (key, prefix, width) => `${prefix}-${String(db.seq[key]++).padStart(width, '0')}`;
// Beer is malt beer, HSN 2203. Food served in a restaurant is a service, SAC 996331.
export const HSN = { beer: '2203', food: '996331' };
// Invoice and credit note numbers restart each financial year, at most 16 characters as GST invoices require: HM/2026-27/0001.
export function nextDoc(key, prefix) {
  const fy = fyOf(today());
  if (db.settings.docYear !== fy) {
    Object.assign(db.seq, { inv: 1, cn: 1 });
    db.settings.docYear = fy;
  }
  return `${(prefix || 'INV').slice(0, 3)}/${fy}/${String(db.seq[key]++).padStart(4, '0')}`;
}
