// All data lives in one object in localStorage. Every load and import goes
// through clean(), which rebuilds each record from a schema so a tampered
// backup cannot smuggle markup into ids, dates or numbers.
import { toast } from './util.js';
import { demo } from './demo.js';

const KEY = 'brewhouse-erp-v2';
export const STATUSES = ['Planned', 'Brewing', 'Fermenting', 'Conditioning', 'Ready', 'Sold out'];
export const IN_TANK = ['Brewing', 'Fermenting', 'Conditioning'];
export const KEG_STATES = ['Empty', 'Filled', 'At customer', 'Cleaning'];
export const HYGIENE = ['Cleaned', 'Sanitised', 'Dirty'];
export const CIP_CYCLES = ['Full CIP', 'Caustic', 'Acid', 'Sanitiser', 'Rinse'];
export const LOSS_STAGES = ['Fermentation', 'Transfer', 'Packaging', 'Taproom', 'Dispatch', 'QC samples', 'Dump', 'Unexplained'];
export const TASK_TYPES = ['Brewing', 'Filling', 'Dispatch', 'Cleaning', 'Maintenance', 'Other'];

const ID = v => String(v ?? '').replace(/[^\w-]/g, '').slice(0, 40);
const REF = v => String(v ?? '').replace(/[^\w:-]/g, '').slice(0, 44);
const STR = v => String(v ?? '').slice(0, 400);
const NUM = v => (Number.isFinite(+v) ? +v : 0);
const OPT = v => (v === '' || v == null || !Number.isFinite(+v) ? '' : +v);
const DATE = v => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
const BOOL = v => v === true;
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
  products: { id: ID, name: STR, kind: ONE(['beer', 'food']), recipeId: ID, ml: NUM, price: NUM },
  tanks: { id: ID, name: STR, type: STR, capacity: NUM, hygiene: ONE(HYGIENE), cleanedOn: DATE },
  batches: {
    id: ID, code: STR, recipeId: ID, recipeVersion: NUM, date: DATE, status: ONE(STATUSES), volume: NUM, og: NUM, fg: NUM, tankId: ID, notes: STR,
    readyDate: DATE, dutyRate: NUM, dutyL: NUM, issued: BOOL,
    transfers: LIST({ date: DATE, fromId: ID, toId: ID, litresOut: NUM, litresIn: NUM }), issues: LIST({ id: ID, qty: NUM, cost: NUM }),
    log: LIST({ date: DATE, gravity: OPT, temp: OPT, ph: OPT, note: STR }),
    brew: obj({ mashTemp: OPT, steps: v => (Array.isArray(v) ? v.map(OPT) : []), preBoil: OPT, og: OPT, volume: OPT, pitchTemp: OPT, notes: STR }),
  },
  sales: { id: ID, no: STR, date: DATE, customer: STR, gstin: STR, vat: NUM, gst: NUM, dispatchId: ID, duty: NUM, lines: LIST({ pid: ID, name: STR, kind: ONE(['beer', 'food']), qty: NUM, price: NUM }) },
  kegs: { id: ID, code: STR, size: NUM, status: ONE(KEG_STATES), batchId: ID, customerId: ID, since: DATE },
  equipment: { id: ID, code: STR, name: STR, type: STR, lastService: DATE, serviceDays: NUM },
  customers: { id: ID, name: STR, type: STR, gstin: STR, phone: STR, city: STR },
  vendors: { id: ID, name: STR, gstin: STR, phone: STR, supplies: STR },
  pos: { id: ID, no: STR, date: DATE, vendorId: ID, status: ONE(['Open', 'Received']), lines: LIST(LINE) },
  packs: { id: ID, batchId: ID, date: DATE, format: STR, unitL: NUM, units: NUM, kegIds: IDS },
  dispatches: { id: ID, no: STR, date: DATE, customerId: ID, invoiceId: ID, duty: NUM, lines: LIST({ ref: REF, label: STR, qty: NUM, litres: NUM }) },
  tasks: { id: ID, title: STR, type: ONE(TASK_TYPES), date: DATE, assignee: STR, status: ONE(['Open', 'Done']) },
  utilities: { id: ID, date: DATE, type: STR, qty: NUM, unit: STR, cost: NUM },
  wastage: { id: ID, date: DATE, kind: ONE(['Beer', 'Material']), ref: ID, qty: NUM, reason: STR },
  cip: { id: ID, date: DATE, targetId: ID, cycle: ONE(CIP_CYCLES), conc: OPT, temp: OPT, mins: OPT, chemicalId: ID, chemQty: NUM, operator: STR, result: ONE(['Pass', 'Fail']), note: STR },
  losses: { id: ID, date: DATE, batchId: ID, stage: ONE(LOSS_STAGES), litres: NUM, reason: STR },
  counts: { id: ID, no: STR, date: DATE, status: ONE(['Open', 'Posted']), lines: LIST({ ref: REF, label: STR, unit: STR, system: NUM, counted: OPT, cost: NUM, reason: STR }) },
  adjustments: { id: ID, date: DATE, countId: ID, ref: REF, label: STR, delta: NUM, value: NUM, reason: STR },
};
export const BREWHOUSE_TYPES = ['2 vessel', '3 vessel', '4 vessel'];
const BREWHOUSE = obj({ type: ONE(BREWHOUSE_TYPES), lengthHL: NUM, mashTun: NUM, lauterTun: NUM, kettle: NUM, whirlpool: BOOL, boilRate: NUM, boilMins: NUM, deadSpace: NUM, cycleHrs: NUM, hlt: NUM, hltTemp: NUM, clt: NUM, cltTemp: NUM, hx: STR });
const SETTINGS = { brewhouse: BREWHOUSE, name: STR, gstin: STR, address: STR, state: STR, prefix: STR, exciseRate: NUM, vat: NUM, foodGst: NUM, efficiency: NUM, cipDays: NUM, lossTarget: NUM, lossAllow: NUM, grainAbsorb: NUM, dryHopAbsorb: NUM, exciseBasis: ONE(['Ready', 'Removal']), tradeRateL: NUM, lastBackup: DATE };
const SEQ = { batch: NUM, inv: NUM, po: NUM, disp: NUM, keg: NUM, count: NUM };

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
export function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { toast('This browser blocked saving. Export a backup from Settings.'); }
}
export function commit() {
  persist();
  dispatchEvent(new Event('db'));
}
// Stock moves through lots so QC and expiry apply per delivery.
// Use approved stock first, earliest expiry first. A shortfall drives the newest lot negative.
export function consume(m, qty) {
  let left = qty;
  const order = [...m.lots].sort((a, b) => (a.qc !== 'Approved') - (b.qc !== 'Approved') || (a.expiry || '9999').localeCompare(b.expiry || '9999'));
  for (const l of order) { if (left <= 0) break; const take = Math.min(left, Math.max(0, l.qty)); l.qty = +(l.qty - take).toFixed(3); left -= take; }
  if (left > 1e-9) { const last = m.lots.at(-1) || (m.lots[0] = { id: 'l' + m.id, date: '', qty: 0, expiry: '', qc: 'Approved', cost: m.cost, ref: 'Shortfall' }); last.qty = +(last.qty - left).toFixed(3); }
  m.lots = m.lots.filter(l => Math.abs(l.qty) > 1e-9 || l.qc === 'Pending');
  m.qty = +m.lots.reduce((a, l) => a + l.qty, 0).toFixed(3);
}
export function addLot(m, lot) {
  m.lots.push({ id: Math.random().toString(36).slice(2, 9), date: '', expiry: '', qc: 'Pending', cost: m.cost, ref: '', ...lot });
  m.qty = +m.lots.reduce((a, l) => a + l.qty, 0).toFixed(3);
}
export const next = (key, prefix, width) => `${prefix}-${String(db.seq[key]++).padStart(width, '0')}`;
