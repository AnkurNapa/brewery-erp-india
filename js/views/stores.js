// Raw materials, purchasing and MRP, equipment register with QR, keg map and turns, keg scan pages.
import { db, next, commit, consume, addLot, usableQty, KEG_STATES, moveKeg } from '../store.js';
import { esc, num, inr, inr0, today, fmtDate, sum, uid, toast, addDays, daysBetween, downloadCsv } from '../util.js';
import { head, btn, link, pill, statusCls, panel, table, kpi, metric, openForm, qr, seg } from '../ui.js';
import { mat, rec, vendor, cust, keg, tank, reserved, mrp, approvedQty, pendingLots, expiryOf, kegStats } from '../calc.js';
import { drawMap } from '../kegmap.js';
import { periodSeg, periodRange, periodText } from '../period.js';

const TYPES = ['Malt', 'Hops', 'Yeast', 'Adjunct', 'Chemical', 'Packaging', 'Gas', 'Other'];
const vendorOpts = () => [{ v: '', t: 'None' }, ...db.vendors.map(v => ({ v: v.id, t: v.name }))];
const remove = (coll, id, what) => { if (confirm(`Delete this ${what}?`)) { db[coll] = db[coll].filter(x => x.id !== id); commit(); } };
let matFilter = 'All';

// One pin per customer with a map location. Red when a keg there is over 30 days out, grey when none are out.
const kegPins = () => db.customers.filter(c => c.lat !== '' && c.lng !== '').map(c => {
  const ks = db.kegs.filter(k => k.customerId === c.id && k.status === 'At customer'), lost = db.kegs.filter(k => k.customerId === c.id && k.status === 'Lost').length;
  const late = ks.filter(k => daysBetween(k.since, today()) > 30).length;
  return { lat: c.lat, lng: c.lng, n: ks.length, title: c.name, cls: !ks.length ? 'none' : late ? 'late' : '',
    html: `<b>${esc(c.name)}</b><br>${ks.length} keg${ks.length === 1 ? '' : 's'} out${late ? `, ${late} over 30 days` : ''}${ks.length ? `: ${ks.map(k => esc(k.code)).join(', ')}` : ''}${lost ? `<br>${lost} lost here` : ''}` };
});
// Home shows the same map at a smaller size. It appears only once a customer has a location, so an empty brewery never loads map tiles.
export const kegMap = (home = false) => {
  if (home && !db.customers.some(c => c.lat !== '' && c.lng !== '')) return '';
  setTimeout(() => { const el = document.getElementById('kegmap'); if (el) drawMap(el, kegPins()); });
  const missing = db.customers.filter(c => c.lat === '' || c.lng === '').length, out = db.kegs.filter(k => k.status === 'At customer').length;
  return panel(home ? `Kegs out (${out})` : 'Where your kegs are', `<div id="kegmap" class="kmap ${home ? 'small' : ''}" role="region" aria-label="Map of kegs at customers"></div>
    <p class="note">${missing && !home ? `${missing} customer${missing === 1 ? ' has' : 's have'} no map location yet. Add one in <a href="#partners">Customers</a>, Edit. ` : ''}Map data © OpenStreetMap contributors.</p>`,
    home ? '<a class="link" href="#kegs">All kegs</a>' : '');
};
const kegTurns = () => {
  const s = kegStats(...periodRange());
  return periodSeg() + panel(`Keg turns, ${periodText()}`, `<div class="metrics">${metric(s.avgCycle ? s.avgCycle + ' days' : 'n/a', 'fill to return')}${metric(s.turns || 'n/a', 'turns a year')}${metric(s.lost, 'kegs lost')}${metric(inr0(s.lostValue), 'value lost')}</div>
    ${s.accounts.length ? table(['Customer', { t: 'Visits', n: 1 }, { t: 'Average days out', n: 1 }, { t: 'Out now', n: 1 }, { t: 'Lost', n: 1 }], s.accounts.map(a => `<tr><td>${esc(a.c.name)}</td><td class="n">${a.visits}</td><td class="n ${a.avgDays > 30 ? 'bad' : ''}">${a.avgDays}</td><td class="n">${a.out || ''}</td><td class="n ${a.lost ? 'bad' : ''}">${a.lost || ''}</td></tr>`)) : `<p class="empty">No keg went out ${periodText()}. Try a longer period.</p>`}
    ${db.settings.kegValue ? '' : '<p class="note">Set a keg value in Settings to price lost kegs.</p>'}`);
};

// Bulk scan: codes collect here without a redraw, so the camera keeps running until the load is moved.
let scanned = [], stream = null;
const stopCam = () => { stream?.getTracks().forEach(t => t.stop()); stream = null; };
addEventListener('hashchange', stopCam);
const drawScanList = () => {
  const el = document.getElementById('scanList');
  if (!el) return;
  const ks = scanned.map(keg).filter(Boolean), by = s => ks.filter(k => k.status === s);
  el.innerHTML = ks.length ? table(['Keg', 'Status', 'Where'], ks.map(k => `<tr><td class="code">${esc(k.code)}</td><td>${pill(k.status, statusCls(k.status))}</td><td>${esc(k.status === 'At customer' || k.status === 'Lost' ? cust(k.customerId)?.name || '' : 'Brewery')}</td></tr>`))
    + `<div class="card-acts wrap">${by('At customer').length ? btn(`Picked up (${by('At customer').length})`, 'bulkPickup') : ''}${by('Cleaning').length ? btn(`Washed (${by('Cleaning').length})`, 'bulkWash') : ''}${by('Filled').length ? btn(`Dispatch (${by('Filled').length})`, 'newDispatch', by('Filled').map(k => k.id).join(',')) : ''}${link('Clear list', 'scanClear')}</div>`
    : '<p class="empty">No kegs scanned yet.</p>';
};
// Accepts the QR link (…#scan/K-004) or a bare code. Unknown codes only complain when typed, not on every camera frame.
const addCode = (raw, typed) => {
  const code = String(raw).includes('#scan/') ? decodeURIComponent(String(raw).split('#scan/')[1]) : String(raw).trim();
  const k = db.kegs.find(x => x.code.toLowerCase() === code.toLowerCase());
  if (!k) { if (typed && code) toast(`No keg ${code}`); return; }
  if (scanned.includes(k.id)) { if (typed) toast(`${k.code} is already on the list`); return; }
  scanned = [...scanned, k.id];
  navigator.vibrate?.(60);
  drawScanList();
};
export const addScan = form => { addCode(form.code.value, true); form.reset(); form.code.focus(); };

export const views = {
  materials() {
    const t = today(), list = db.materials.filter(m => matFilter === 'All' || m.type === matFilter);
    const value = sum(db.materials, m => m.qty * m.cost);
    const rows = list.map(m => {
      const res = reserved(m.id), av = approvedQty(m) - res, ex = expiryOf(m), exp = ex ? daysBetween(t, ex) : null, pend = pendingLots(m);
      return `<tr><td><b>${esc(m.name)}</b><small class="sub">${esc(m.type)}${m.vendorId ? ' · ' + esc(vendor(m.vendorId)?.name) : ''}</small></td>
        <td class="n">${num(m.qty, 2)} ${esc(m.unit)}</td><td class="n">${res ? num(res, 2) : ''}</td><td class="n ${av <= m.reorder ? 'bad' : ''}">${num(av, 2)}</td><td class="n">${num(m.reorder, 2)}</td>
        <td class="n">${inr(m.cost)}</td><td>${ex ? `<span class="${exp <= 30 ? 'bad' : ''}">${fmtDate(ex)}</span>` : ''}</td><td>${pend.length ? pill(`${pend.length} pending`, 'orange') : pill('Approved', 'ok')}</td>
        <td class="acts">${link(pend.length ? 'QC' : 'Lots', 'lots', m.id)}${link('Receive', 'receive', m.id)}${link('Use / waste', 'wasteMat', m.id)}${link('Edit', 'editMat', m.id)}${link('Delete', 'delMat', m.id, 'del')}</td></tr>`;
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

  kegs() {
    const t = today(), counts = Object.fromEntries(KEG_STATES.map(s => [s, db.kegs.filter(k => k.status === s).length]));
    return head('Kegs', 'Where every keg is, how fast they come back and what went missing. Each keg has a QR tag; scanning it with a phone camera opens that keg.', `<a class="primary" href="#kegscan">Scan kegs</a> ${btn('Add keg', 'newKeg', '', 'ghost')} ${btn('Keg CSV', 'csvKegs', '', 'ghost')}`)
      + `<div class="kpis">${KEG_STATES.map(s => kpi(counts[s], `Kegs ${s.toLowerCase()}`, s === 'Lost' && counts[s] ? 'alert' : '')).join('')}</div>`
      + kegMap() + kegTurns()
      + panel('Kegs', table(['Keg', 'Size', 'Status', 'Contents', 'Where', 'Since', ''], db.kegs.map(k => {
        const b = db.batches.find(x => x.id === k.batchId), days = daysBetween(k.since, t);
        return `<tr><td><a class="code" href="#scan/${encodeURIComponent(k.code)}">${esc(k.code)}</a></td><td>${k.size} L</td><td>${pill(k.status, statusCls(k.status))}</td><td>${b ? `<a href="#blr/${b.id}">${esc(b.code)} ${esc(rec(b.recipeId)?.name || '')}</a>` : ''}</td>
          <td>${esc(k.status === 'At customer' || k.status === 'Lost' ? cust(k.customerId)?.name || '' : 'Brewery')}</td><td class="${k.status === 'At customer' && days > 30 ? 'bad' : ''}">${days} d</td><td class="acts">${k.status === 'At customer' ? link('Lost', 'kegLost', k.id) : ''}${link('QR', 'showQr', 'keg:' + k.id)}${link('Delete', 'delKeg', k.id, 'del')}</td></tr>`;
      })));
  },

  equipment() {
    const t = today();
    return head('Equipment', 'Tanks and machines, with service dates. Every one gets a QR tag that opens it here. Kegs have their own page.', `<a class="ghost" href="#kegs">Kegs</a> ${btn('Add equipment', 'newEq')}`)
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
    const acts = { Empty: [], Filled: [['Dispatch', 'newDispatch']], 'At customer': [['Picked up', 'kegPickup'], ['Mark lost', 'kegLost']], Cleaning: [['Cleaned, now empty', 'kegClean']], Lost: [['Found, back for cleaning', 'kegFound']] }[k.status];
    const trail = [...k.history].reverse().map(h => {
      const bc = db.batches.find(x => x.id === h.batchId)?.code, where = [bc ? `<a class="code" href="#blr/${h.batchId}">${esc(bc)}</a>` : '', esc(cust(h.customerId)?.name || '')].filter(Boolean).join(' · ');
      return `<li><span class="when">${fmtDate(h.date)}</span>${pill(h.status, statusCls(h.status))}<span class="grow">${where}</span></li>`;
    });
    return head(`Keg ${esc(k.code)}`, `${k.size} L · ${esc(k.status)} since ${fmtDate(k.since)}`)
      + panel('', `<div class="scan">${pill(k.status, statusCls(k.status))}
        <p>${b ? `Holds <a href="#blr/${b.id}">${esc(b.code)} ${esc(rec(b.recipeId)?.name || '')}</a>.` : 'No beer tagged.'} ${k.status === 'At customer' ? `At ${esc(cust(k.customerId)?.name || 'a customer')}.` : ''}</p>
        <div class="card-acts">${acts.map(([l, a]) => btn(l, a, k.id)).join(' ')}${k.status === 'Empty' ? '<a class="ghost" href="#packaging">Fill from packaging</a>' : ''}</div></div>`)
      + panel('History', trail.length ? `<ul class="list">${trail.join('')}</ul>` : '<p class="empty">No moves recorded yet. Moves from now on show here.</p>');
  },

  kegscan() {
    stopCam();
    setTimeout(drawScanList);
    const cam = 'BarcodeDetector' in window && navigator.mediaDevices;
    return head('Scan kegs', 'Scan or type keg codes one after another, then move the whole load in one tap.')
      + panel('', `${cam ? `<div class="cam"><video id="camv" playsinline muted hidden></video>${btn('Start camera', 'camStart', '', 'ghost')}</div>` : '<p class="note">This browser cannot scan with the camera here. Type the codes, or open each QR tag with the phone camera.</p>'}
        <form id="scanForm" class="scan-add" autocomplete="off"><input name="code" placeholder="Keg code, for example K-004" aria-label="Keg code"><button class="ghost">Add</button></form>
        <div id="scanList"></div>`);
  },
};

// ---------- actions ----------
const MAT_FIELDS = (edit = false) => [
  { k: 'name', label: 'Name', req: 1 }, { k: 'type', label: 'Type', type: 'select', options: TYPES.map(t => ({ v: t, t })) },
  { k: 'unit', label: 'Unit (kg, pack, L)' }, { k: 'qty', label: edit ? 'On hand' : 'Opening stock', type: 'number', ro: edit }, { k: 'reorder', label: 'Reorder at (PAR)', type: 'number' },
  { k: 'cost', label: 'Cost per unit (₹)', type: 'number' }, { k: 'vendorId', label: 'Vendor', type: 'select', options: vendorOpts() },
  ...(edit ? [] : [{ k: 'expiry', label: 'Expiry of opening stock', type: 'date' }]),
  { k: 'extract', label: 'Extract, % as is (malt analysis or sugar)', type: 'number' }, { k: 'ebc', label: 'Malt colour (EBC)', type: 'number' },
  { k: 'alpha', label: 'Hop alpha acid (%)', type: 'number' }, { k: 'atten', label: 'Yeast attenuation (%)', type: 'number' },
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
  newMat() { openForm({ title: 'Add material', fields: MAT_FIELDS(), vals: { type: 'Malt', unit: 'kg' }, onSave: v => { const m = { id: uid(), ...v, qty: 0, qc: 'Approved', lots: [] }; if (v.qty) addLot(m, { qty: v.qty, qc: 'Approved', expiry: v.expiry, date: today(), ref: 'Opening stock' }); db.materials.push(m); } }); },
  editMat(id) { const m = mat(id); openForm({ title: `Edit ${m.name}`, fields: MAT_FIELDS(true), vals: m, note: 'Stock changes go through Receive, Use / waste or a stock take, so every movement is on record.', onSave: v => { const { qty, expiry, ...rest } = v; Object.assign(m, rest); } }); },
  delMat(id) {
    if (db.recipes.some(r => r.items.some(i => i.id === id))) return toast('A recipe uses this material, so it cannot be deleted');
    remove('materials', id, 'material');
  },
  lots(id) {
    const m = mat(id), md = document.getElementById('modal');
    const render = () => {
      md.innerHTML = `<div class="sheet"><div class="grabber"></div><div class="sheet-head"><span></span><h2>${esc(m.name)} lots</h2><button class="link strong" data-close>Done</button></div><div class="sheet-body">
        ${table(['Received', 'Ref', { t: 'Qty', n: 1 }, 'Expiry', 'QC', ''], m.lots.map(l => `<tr><td>${fmtDate(l.date) || 'Opening'}</td><td>${esc(l.ref)}</td><td class="n">${num(l.qty, 3)} ${esc(m.unit)}</td><td>${fmtDate(l.expiry)}</td>
          <td>${pill(l.qc, statusCls(l.qc))}</td><td class="acts">${l.qc !== 'Approved' ? `<button class="link" data-lot="${l.id}" data-qc="Approved">Approve</button>` : ''}${l.qc !== 'Rejected' ? `<button class="link del" data-lot="${l.id}" data-qc="Rejected">Reject</button>` : ''}</td></tr>`))}
        <p class="note">Only approved lots count as available. Issues use approved stock first, earliest expiry first. Rejected stock stays on record until it is written off with Use / waste.</p></div></div>`;
      md.querySelector('[data-close]').onclick = () => md.close();
      md.querySelectorAll('[data-lot]').forEach(b => { b.onclick = () => { m.lots.find(l => l.id === b.dataset.lot).qc = b.dataset.qc; commit(); render(); }; });
    };
    render();
    md.showModal();
  },
  receive(id) {
    const m = mat(id);
    openForm({ title: `Receive ${m.name}`, vals: { qty: '', cost: m.cost, expiry: '' },
      fields: [{ k: 'qty', label: `Quantity (${m.unit})`, type: 'number' }, { k: 'cost', label: 'Cost per unit (₹)', type: 'number' }, { k: 'expiry', label: 'Expiry', type: 'date' }],
      onSave: v => { if (!v.qty) { toast('Enter the quantity received'); return false; } m.cost = v.cost || m.cost; addLot(m, { qty: v.qty, expiry: v.expiry, cost: m.cost, date: today(), ref: 'Direct receipt' }); toast(`${num(v.qty, 2)} ${m.unit} received, waiting for QC`); } });
  },
  wasteMat(id) {
    const m = mat(id);
    openForm({ title: `Use or waste ${m.name}`, vals: { date: today(), reason: 'Wastage' },
      fields: [{ k: 'qty', label: `Quantity (${m.unit})`, type: 'number', req: 1 }, { k: 'date', label: 'Date', type: 'date' }, { k: 'reason', label: 'Reason', list: ['Wastage', 'Spillage', 'Expired', 'Lab sample', 'Cleaning'] }],
      // Writing off can take rejected or pending stock too: that is usually what is being thrown away.
      onSave: v => { if (!consume(m, v.qty, { allowPending: true, allowRejected: true })) { toast(`Only ${num(m.qty, 2)} ${m.unit} in stores`); return false; } db.wastage.push({ id: uid(), date: v.date, kind: 'Material', ref: m.id, qty: v.qty, reason: v.reason }); } });
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
    for (const l of p.lines) { const m = mat(l.id); if (m) { m.cost = l.price || m.cost; addLot(m, { qty: l.qty, cost: m.cost, date: today(), ref: p.no }); } }
    p.status = 'Received';
    toast(`${p.no} received into stores, waiting for QC`);
    commit();
  },
  delPo(id) { remove('pos', id, 'purchase order'); },

  newKeg() {
    openForm({ title: 'Add kegs', vals: { size: 30, count: 1, codes: '' }, fields: [{ k: 'size', label: 'Size', type: 'select', options: [{ v: 20, t: '20 L' }, { v: 30, t: '30 L' }, { v: 50, t: '50 L' }] }, { k: 'count', label: 'How many', type: 'number' },
      { k: 'codes', label: 'Own codes (optional, one per line)', type: 'textarea', wide: 1 }],
      note: 'Kegs with barcodes etched by the maker? Paste those codes and they are used instead of K-001, K-002.',
      onSave: v => {
        const taken = new Set(db.kegs.map(k => k.code.toLowerCase()));
        const own = [...new Set(String(v.codes).split(/[\n,]+/).map(c => c.trim().replace(/[^\w./-]/g, '').slice(0, 30)).filter(Boolean))];
        const clash = own.filter(c => taken.has(c.toLowerCase()));
        if (clash.length) { toast(`Already in use: ${clash.slice(0, 3).join(', ')}`); return false; }
        const codes = own.length ? own.slice(0, 200) : Array.from({ length: Math.min(200, v.count || 1) }, () => next('keg', 'K', 3));
        for (const code of codes) db.kegs.push({ id: uid(), code, size: +v.size, status: 'Empty', batchId: '', customerId: '', since: today(), history: [{ date: today(), status: 'Empty', batchId: '', customerId: '' }] });
        toast(`${codes.length} keg${codes.length === 1 ? '' : 's'} added`);
      } });
  },
  delKeg(id) { if (!['Empty', 'Lost'].includes(keg(id).status)) return toast('Only empty or lost kegs can be deleted'); remove('kegs', id, 'keg'); },
  kegPickup(id) { moveKeg(keg(id), 'Cleaning', today(), { customerId: '', batchId: '' }); toast('Keg back at the brewery for cleaning'); commit(); },
  kegLost(id) {
    const k = keg(id);
    if (!confirm(`Mark ${k.code} as lost at ${cust(k.customerId)?.name || 'the customer'}? It stays on record until found or deleted.`)) return;
    moveKeg(k, 'Lost');
    commit();
  },
  kegFound(id) { moveKeg(keg(id), 'Cleaning', today(), { customerId: '', batchId: '' }); toast('Found. Back at the brewery for cleaning'); commit(); },
  bulkPickup() {
    const ks = scanned.map(keg).filter(k => k?.status === 'At customer');
    ks.forEach(k => moveKeg(k, 'Cleaning', today(), { customerId: '', batchId: '' }));
    scanned = [];
    toast(`${ks.length} keg${ks.length === 1 ? '' : 's'} picked up for cleaning`);
    commit();
  },
  bulkWash() {
    const ks = scanned.map(keg).filter(k => k?.status === 'Cleaning');
    ks.forEach(k => moveKeg(k, 'Empty'));
    scanned = [];
    toast(`${ks.length} keg${ks.length === 1 ? '' : 's'} washed and empty. Log the washer clean under CIP`);
    commit();
  },
  scanClear() { scanned = []; drawScanList(); },
  async camStart() {
    const v = document.getElementById('camv');
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); } catch { return toast('Camera blocked. Allow it for this site, or type the codes'); }
    v.srcObject = stream; v.hidden = false;
    await v.play();
    const det = new BarcodeDetector({ formats: ['qr_code'] });
    const tick = async () => {
      if (!stream || !v.isConnected) return stopCam();
      // A frame that cannot be read yet (focus, blur) throws; the next frame tries again.
      try { for (const c of await det.detect(v)) addCode(c.rawValue); } catch { /* next frame */ }
      setTimeout(tick, 250);
    };
    tick();
  },
  csvKegs() {
    downloadCsv('keg-register', ['Keg', 'Size L', 'Status', 'Batch', 'Beer', 'Customer', 'Since', 'Days', 'Moves'], db.kegs.map(k => {
      const b = db.batches.find(x => x.id === k.batchId);
      return [k.code, k.size, k.status, b?.code || '', rec(b?.recipeId)?.name || '', cust(k.customerId)?.name || '', k.since, daysBetween(k.since, today()), k.history.length];
    }));
  },
  kegClean(id) {
    const k = keg(id), washer = db.equipment.find(e => /keg/i.test(e.name)), chems = db.materials.filter(m => m.type === 'Chemical');
    openForm({ title: `Wash ${k.code}`, vals: { chemicalId: chems[0]?.id || '', chemQty: 0.05, result: 'Pass' },
      fields: [{ k: 'chemicalId', label: 'Chemical', type: 'select', options: [{ v: '', t: 'None' }, ...chems.map(m => ({ v: m.id, t: m.name }))] }, { k: 'chemQty', label: 'Chemical used', type: 'number' },
        { k: 'result', label: 'Check', type: 'select', options: [{ v: 'Pass', t: 'Pass' }, { v: 'Fail', t: 'Fail, wash again' }] }],
      note: washer ? `Logged as a CIP cycle on ${washer.name}.` : 'Add a keg washer under Machines to log washes against it.',
      onSave: v => {
        const m = mat(v.chemicalId);
        if (m && v.chemQty && !consume(m, v.chemQty)) { toast(`Only ${num(usableQty(m), 2)} ${m.unit} of ${m.name} approved in stores`); return false; }
        if (washer) db.cip.push({ id: uid(), date: today(), targetId: washer.id, cycle: 'Full CIP', conc: '', temp: '', mins: '', chemicalId: v.chemicalId, chemQty: v.chemQty, operator: '', result: v.result, note: `Keg ${k.code}` });
        if (v.result === 'Pass') { moveKeg(k, 'Empty'); toast(`${k.code} washed and empty`); } else toast(`${k.code} failed, wash again`);
      } });
  },
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
