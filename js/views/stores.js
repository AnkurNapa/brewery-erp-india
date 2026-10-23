// Raw materials, purchasing and MRP, equipment register with QR, keg scan page.
import { db, next, commit, KEG_STATES } from '../store.js';
import { esc, num, inr, inr0, today, fmtDate, sum, uid, toast, addDays, daysBetween } from '../util.js';
import { head, btn, link, pill, statusCls, panel, table, kpi, openForm, qr, seg } from '../ui.js';
import { mat, rec, vendor, cust, keg, tank, reserved, available, mrp, onOrder } from '../calc.js';

const TYPES = ['Malt', 'Hops', 'Yeast', 'Adjunct', 'Chemical', 'Packaging', 'Gas', 'Other'];
const vendorOpts = () => [{ v: '', t: 'None' }, ...db.vendors.map(v => ({ v: v.id, t: v.name }))];
const remove = (coll, id, what) => { if (confirm(`Delete this ${what}?`)) { db[coll] = db[coll].filter(x => x.id !== id); commit(); } };
let matFilter = 'All';

export const views = {
  materials() {
    const t = today(), list = db.materials.filter(m => matFilter === 'All' || m.type === matFilter);
    const value = sum(db.materials, m => m.qty * m.cost);
    const rows = list.map(m => {
      const res = reserved(m.id), av = m.qty - res, exp = m.expiry ? daysBetween(t, m.expiry) : null;
      return `<tr><td><b>${esc(m.name)}</b><small class="sub">${esc(m.type)}${m.vendorId ? ' · ' + esc(vendor(m.vendorId)?.name) : ''}</small></td>
        <td class="n">${num(m.qty, 2)} ${esc(m.unit)}</td><td class="n">${res ? num(res, 2) : ''}</td><td class="n ${av <= m.reorder ? 'bad' : ''}">${num(av, 2)}</td><td class="n">${num(m.reorder, 2)}</td>
        <td class="n">${inr(m.cost)}</td><td>${m.expiry ? `<span class="${exp <= 30 ? 'bad' : ''}">${fmtDate(m.expiry)}</span>` : ''}</td><td>${pill(m.qc, statusCls(m.qc))}</td>
        <td class="acts">${m.qc !== 'Approved' ? link('Approve', 'qcApprove', m.id) : ''}${link('Receive', 'receive', m.id)}${link('Use / waste', 'wasteMat', m.id)}${link('Edit', 'editMat', m.id)}${link('Delete', 'delMat', m.id, 'del')}</td></tr>`;
    });
    return head('Raw materials', `Stores value ${inr0(value)}. Available = on hand minus what planned batches have reserved.`, btn('Add material', 'newMat'))
      + seg('matFilter', ['All', ...TYPES].filter(x => x === 'All' || db.materials.some(m => m.type === x)).map(x => [x, x]), matFilter)
      + panel('', table(['Material', { t: 'On hand', n: 1 }, { t: 'Reserved', n: 1 }, { t: 'Available', n: 1 }, { t: 'Reorder at', n: 1 }, { t: 'Cost / unit', n: 1 }, 'Expiry', 'QC', ''], rows));
  },

  purchasing() {
    const plan = mrp().filter(x => x.suggest > 0 || x.res > 0);
    const pos = [...db.pos].sort((a, b) => b.date.localeCompare(a.date));
    return head('Purchasing and MRP', 'Suggested orders cover reorder levels plus everything planned batches have reserved, less what is already on order.', btn('New purchase order', 'newPo'))
      + panel('Material requirements', table(['Material', 'Vendor', { t: 'On hand', n: 1 }, { t: 'Reserved', n: 1 }, { t: 'On order', n: 1 }, { t: 'Suggested order', n: 1 }, { t: 'Value', n: 1 }],
        plan.map(x => `<tr><td>${esc(x.m.name)}</td><td>${esc(vendor(x.m.vendorId)?.name || '')}</td><td class="n">${num(x.m.qty, 2)} ${esc(x.m.unit)}</td><td class="n">${num(x.res, 2)}</td><td class="n">${num(x.ord, 2)}</td>
          <td class="n">${x.suggest ? `<b>${num(x.suggest, 2)} ${esc(x.m.unit)}</b>` : ''}</td><td class="n">${x.suggest ? inr0(x.suggest * x.m.cost) : ''}</td></tr>`)),
        plan.some(x => x.suggest) ? btn('Raise POs from plan', 'mrpPos', '', 'ghost') : '')
      + panel('Purchase orders', table(['PO', 'Date', 'Vendor', 'Items', { t: 'Value', n: 1 }, 'Status', ''], pos.map(p => `<tr><td class="code">${esc(p.no)}</td><td>${fmtDate(p.date)}</td><td>${esc(vendor(p.vendorId)?.name || '')}</td>
        <td>${p.lines.map(l => `${esc(mat(l.id)?.name || '?')} ${num(l.qty, 2)}`).join(', ')}</td><td class="n">${inr0(sum(p.lines, l => l.qty * l.price))}</td><td>${pill(p.status, statusCls(p.status))}</td>
        <td class="acts">${p.status === 'Open' ? link('Receive', 'receivePo', p.id) : ''}${link('Delete', 'delPo', p.id, 'del')}</td></tr>`)));
  },

  equipment() {
    const t = today(), counts = Object.fromEntries(KEG_STATES.map(s => [s, db.kegs.filter(k => k.status === s).length]));
    return head('Equipment and kegs', 'Every tank, keg and machine gets a QR tag. Scanning it with a phone camera opens that item here.', `${btn('Add keg', 'newKeg', '', 'ghost')} ${btn('Add equipment', 'newEq')}`)
      + `<div class="kpis four">${KEG_STATES.map(s => kpi(counts[s], `Kegs ${s.toLowerCase()}`)).join('')}</div>`
      + panel('Kegs', table(['Keg', 'Size', 'Status', 'Contents', 'Where', 'Since', ''], db.kegs.map(k => {
        const b = db.batches.find(x => x.id === k.batchId), days = daysBetween(k.since, t);
        return `<tr><td><a class="code" href="#scan/${encodeURIComponent(k.code)}">${esc(k.code)}</a></td><td>${k.size} L</td><td>${pill(k.status, statusCls(k.status))}</td><td>${b ? `<a href="#blr/${b.id}">${esc(b.code)} ${esc(rec(b.recipeId)?.name || '')}</a>` : ''}</td>
          <td>${esc(k.status === 'At customer' ? cust(k.customerId)?.name || '' : 'Brewery')}</td><td class="${k.status === 'At customer' && days > 30 ? 'bad' : ''}">${days} d</td><td class="acts">${link('QR', 'showQr', 'keg:' + k.id)}${link('Delete', 'delKeg', k.id, 'del')}</td></tr>`;
      })))
      + panel('Tanks', table(['Tank', 'Type', { t: 'Capacity', n: 1 }, ''], db.tanks.map(tk => `<tr><td>${esc(tk.name)}</td><td>${esc(tk.type)}</td><td class="n">${num(tk.capacity)} L</td><td class="acts">${link('QR', 'showQr', 'tank:' + tk.id)}</td></tr>`)))
      + panel('Machines and service', table(['Code', 'Name', 'Type', 'Last service', 'Next due', ''], db.equipment.map(e => {
        const due = e.lastService && e.serviceDays ? addDays(e.lastService, e.serviceDays) : '';
        return `<tr><td class="code">${esc(e.code)}</td><td>${esc(e.name)}</td><td>${esc(e.type)}</td><td>${fmtDate(e.lastService)}</td><td>${due ? (due < t ? pill('Overdue ' + fmtDate(due), 'low') : due <= addDays(t, 7) ? pill(fmtDate(due), 'orange') : fmtDate(due)) : ''}</td>
          <td class="acts">${link('Serviced today', 'serviced', e.id)}${link('QR', 'showQr', 'eq:' + e.id)}${link('Edit', 'editEq', e.id)}${link('Delete', 'delEq', e.id, 'del')}</td></tr>`;
      })));
  },

  scan(code) {
    const k = db.kegs.find(x => x.code === code), tk = db.tanks.find(x => x.name === code), e = db.equipment.find(x => x.code === code);
    if (tk) { location.replace('#tanks'); return ''; }
    if (e) return head(esc(e.name), `${esc(e.code)} · ${esc(e.type)}`) + panel('', `<p>Last service ${fmtDate(e.lastService)}. Service every ${e.serviceDays} days.</p>${btn('Mark serviced today', 'serviced', e.id)}`);
    if (!k) return head('Not found', `No keg, tank or machine has the code ${esc(code)} in this browser.`) + '<p class="note">Data lives in the browser that recorded it. Open the app on that device, or import its backup here.</p>';
    const b = db.batches.find(x => x.id === k.batchId);
    const acts = { Empty: [], Filled: [['Dispatch', 'newDispatch']], 'At customer': [['Picked up', 'kegPickup']], Cleaning: [['Cleaned, now empty', 'kegClean']] }[k.status];
    return head(`Keg ${esc(k.code)}`, `${k.size} L · ${esc(k.status)} since ${fmtDate(k.since)}`)
      + panel('', `<div class="scan">${pill(k.status, statusCls(k.status))}
        <p>${b ? `Holds <a href="#blr/${b.id}">${esc(b.code)} ${esc(rec(b.recipeId)?.name || '')}</a>.` : 'No beer tagged.'} ${k.status === 'At customer' ? `At ${esc(cust(k.customerId)?.name || 'a customer')}.` : ''}</p>
        <div class="card-acts">${acts.map(([l, a]) => btn(l, a, k.id)).join(' ')}${k.status === 'Empty' ? '<a class="ghost" href="#packaging">Fill from packaging</a>' : ''}</div></div>`);
  },
};

// ---------- actions ----------
const MAT_FIELDS = () => [
  { k: 'name', label: 'Name', req: 1 }, { k: 'type', label: 'Type', type: 'select', options: TYPES.map(t => ({ v: t, t })) },
  { k: 'unit', label: 'Unit (kg, pack, L)' }, { k: 'qty', label: 'On hand', type: 'number' }, { k: 'reorder', label: 'Reorder at (PAR)', type: 'number' },
  { k: 'cost', label: 'Cost per unit (₹)', type: 'number' }, { k: 'vendorId', label: 'Vendor', type: 'select', options: vendorOpts() }, { k: 'expiry', label: 'Expiry', type: 'date' },
  { k: 'extract', label: 'Malt extract (points/kg/L)', type: 'number' }, { k: 'ebc', label: 'Malt colour (EBC)', type: 'number' },
  { k: 'alpha', label: 'Hop alpha acid (%)', type: 'number' }, { k: 'atten', label: 'Yeast attenuation (%)', type: 'number' },
  { k: 'qc', label: 'QC status', type: 'select', options: ['Approved', 'Pending', 'Rejected'].map(t => ({ v: t, t })) },
];
const PO_LINES = rows => ({ label: 'Material', rows, opts: db.materials.map(m => ({ id: m.id, label: `${m.name} (${m.unit})` })), cols: [{ k: 'qty', label: 'Qty' }, { k: 'price', label: 'Rate ₹', def: id => mat(id)?.cost ?? 0 }] });
const EQ_FIELDS = [
  { k: 'code', label: 'Code', req: 1 }, { k: 'name', label: 'Name', req: 1 }, { k: 'type', label: 'Type', list: ['Brewhouse', 'Utility', 'Cleaning', 'Packaging', 'Lab', 'Other'] },
  { k: 'lastService', label: 'Last service', type: 'date' }, { k: 'serviceDays', label: 'Service every (days)', type: 'number' },
];
function poForm(vals, rows) {
  openForm({ title: 'New purchase order', vals, lines: PO_LINES(rows),
    fields: [{ k: 'vendorId', label: 'Vendor', type: 'select', options: vendorOpts() }, { k: 'date', label: 'Date', type: 'date' }],
    onSave: (v, lines) => { if (!lines.length) { toast('Add at least one line'); return false; } db.pos.push({ id: uid(), no: next('po', 'PO', 4), status: 'Open', ...v, lines }); toast('Purchase order raised'); } });
}

export const actions = {
  newMat() { openForm({ title: 'Add material', fields: MAT_FIELDS(), vals: { type: 'Malt', unit: 'kg', qc: 'Approved' }, onSave: v => { db.materials.push({ id: uid(), ...v }); } }); },
  editMat(id) { const m = mat(id); openForm({ title: `Edit ${m.name}`, fields: MAT_FIELDS(), vals: m, onSave: v => { Object.assign(m, v); } }); },
  delMat(id) {
    if (db.recipes.some(r => r.items.some(i => i.id === id))) return toast('A recipe uses this material, so it cannot be deleted');
    remove('materials', id, 'material');
  },
  qcApprove(id) { mat(id).qc = 'Approved'; toast('QC approved'); commit(); },
  receive(id) {
    const m = mat(id);
    openForm({ title: `Receive ${m.name}`, vals: { qty: '', cost: m.cost, expiry: m.expiry },
      fields: [{ k: 'qty', label: `Quantity (${m.unit})`, type: 'number' }, { k: 'cost', label: 'Cost per unit (₹)', type: 'number' }, { k: 'expiry', label: 'Expiry', type: 'date' }],
      onSave: v => { Object.assign(m, { qty: +(m.qty + v.qty).toFixed(3), cost: v.cost || m.cost, expiry: v.expiry || m.expiry, qc: 'Pending' }); toast(`${num(v.qty, 2)} ${m.unit} received, waiting for QC`); } });
  },
  wasteMat(id) {
    const m = mat(id);
    openForm({ title: `Use or waste ${m.name}`, vals: { date: today(), reason: 'Wastage' },
      fields: [{ k: 'qty', label: `Quantity (${m.unit})`, type: 'number', req: 1 }, { k: 'date', label: 'Date', type: 'date' }, { k: 'reason', label: 'Reason', list: ['Wastage', 'Spillage', 'Expired', 'Lab sample', 'Cleaning'] }],
      onSave: v => { m.qty = +(m.qty - v.qty).toFixed(3); db.wastage.push({ id: uid(), date: v.date, kind: 'Material', ref: m.id, qty: v.qty, reason: v.reason }); } });
  },

  newPo() { poForm({ vendorId: db.vendors[0]?.id || '', date: today() }, []); },
  mrpPos() {
    const plan = mrp().filter(x => x.suggest > 0), byVendor = {};
    for (const x of plan) (byVendor[x.m.vendorId] ||= []).push({ id: x.m.id, qty: x.suggest, price: x.m.cost, time: '' });
    for (const [vid, lines] of Object.entries(byVendor)) db.pos.push({ id: uid(), no: next('po', 'PO', 4), date: today(), vendorId: vid, status: 'Open', lines });
    toast(`${Object.keys(byVendor).length} purchase order${Object.keys(byVendor).length > 1 ? 's' : ''} raised`);
    commit();
  },
  receivePo(id) {
    const p = db.pos.find(x => x.id === id);
    for (const l of p.lines) { const m = mat(l.id); if (m) Object.assign(m, { qty: +(m.qty + l.qty).toFixed(3), cost: l.price || m.cost, qc: 'Pending' }); }
    p.status = 'Received';
    toast(`${p.no} received into stores, waiting for QC`);
    commit();
  },
  delPo(id) { remove('pos', id, 'purchase order'); },

  newKeg() {
    openForm({ title: 'Add kegs', vals: { size: 30, count: 1 }, fields: [{ k: 'size', label: 'Size', type: 'select', options: [{ v: 20, t: '20 L' }, { v: 30, t: '30 L' }, { v: 50, t: '50 L' }] }, { k: 'count', label: 'How many', type: 'number' }],
      onSave: v => { for (let i = 0; i < Math.min(200, v.count || 1); i++) db.kegs.push({ id: uid(), code: next('keg', 'K', 3), size: +v.size, status: 'Empty', batchId: '', customerId: '', since: today() }); } });
  },
  delKeg(id) { if (keg(id).status !== 'Empty') return toast('Only empty kegs can be deleted'); remove('kegs', id, 'keg'); },
  kegPickup(id) { Object.assign(keg(id), { status: 'Cleaning', customerId: '', batchId: '', since: today() }); toast('Keg back at the brewery for cleaning'); commit(); },
  kegClean(id) { Object.assign(keg(id), { status: 'Empty', since: today() }); toast('Keg cleaned and empty'); commit(); },
  showQr(ref) {
    const [kind, id] = ref.split(':');
    const item = kind === 'keg' ? keg(id) : kind === 'tank' ? tank(id) : db.equipment.find(e => e.id === id);
    const code = item.code || item.name, m = document.getElementById('modal');
    m.innerHTML = `<div class="sheet"><div class="grabber"></div><div class="sheet-head"><button class="link" data-print>Print</button><h2>${esc(code)}</h2><button class="link strong" data-close>Done</button></div>
      <div class="sheet-body qr-label"><div class="qr">${qr(code)}</div><b>${esc(code)}</b><small>${esc(db.settings.name)}</small></div></div>`;
    m.querySelector('[data-close]').onclick = () => m.close();
    m.querySelector('[data-print]').onclick = () => { document.getElementById('print').innerHTML = m.querySelector('.qr-label').outerHTML; window.print(); };
    m.showModal();
  },
  newEq() { openForm({ title: 'Add equipment', fields: EQ_FIELDS, vals: { lastService: today(), serviceDays: 90 }, onSave: v => { db.equipment.push({ id: uid(), ...v }); } }); },
  editEq(id) { const e = db.equipment.find(x => x.id === id); openForm({ title: `Edit ${e.name}`, fields: EQ_FIELDS, vals: e, onSave: v => { Object.assign(e, v); } }); },
  serviced(id) { db.equipment.find(x => x.id === id).lastService = today(); toast('Service recorded'); commit(); },
  delEq(id) { remove('equipment', id, 'equipment'); },
};

export const segs = { matFilter: v => { matFilter = v; } };
