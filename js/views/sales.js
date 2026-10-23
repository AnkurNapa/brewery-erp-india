// Menu, taproom invoices, dispatch to trade customers, customer and vendor masters.
import { db, next, commit, moveKeg, undoKeg } from '../store.js';
import { esc, num, inr, inr0, today, fmtDate, sum, uid, toast, daysBetween } from '../util.js';
import { head, btn, link, pill, panel, table, kpi, openForm, seg } from '../ui.js';
import { parseLoc } from '../kegmap.js';
import { periodSeg, periodText, inPeriod } from '../period.js';
import { rec, prod, cust, keg, pack, invoice, packLeft, beerStock, removalDutyOn } from '../calc.js';

const remove = (coll, id, what) => { if (confirm(`Delete this ${what}?`)) { db[coll] = db[coll].filter(x => x.id !== id); commit(); } };
let partnerTab = 'customers';

export const views = {
  sales() {
    const list = db.sales.filter(s => inPeriod(s.date)), tot = list.map(invoice);
    const rows = [...list].sort((a, b) => b.date.localeCompare(a.date) || b.no.localeCompare(a.no)).map(s => {
      const c = invoice(s);
      return `<tr><td class="code">${esc(s.no)}</td><td>${fmtDate(s.date)}</td><td>${esc(s.customer)} ${s.dispatchId ? pill('Trade', 'info') : ''}</td><td class="n">${inr(c.beer)}</td><td class="n">${inr(c.food)}</td>
        <td class="n">${inr(c.vat + c.cgst + c.sgst)}</td><td class="n"><b>${inr(c.total)}</b></td><td class="acts">${link('Print', 'printInv', s.id)}${link('Delete', 'delInv', s.id, 'del')}</td></tr>`;
    });
    return head('Taproom sales', 'Beer carries state VAT and is drawn from that beer\'s tank stock. Food carries GST split as CGST and SGST.', `${btn('Sales CSV', 'csvSales', '', 'ghost')} ${btn('New invoice', 'newInv')}`)
      + periodSeg()
      + `<div class="kpis four">${kpi(list.length, `Invoices ${periodText()}`)}${kpi(inr0(sum(tot, c => c.beer)), 'Beer before tax')}${kpi(inr0(sum(tot, c => c.food)), 'Food before tax')}${kpi(inr0(sum(tot, c => c.total)), 'Total with tax')}</div>`
      + panel('', rows.length ? table(['Invoice', 'Date', 'Customer', { t: 'Beer', n: 1 }, { t: 'Food', n: 1 }, { t: 'Tax', n: 1 }, { t: 'Total', n: 1 }, ''], rows) : `<p class="empty">No invoices ${periodText()}.</p>`);
  },

  menu() {
    const rows = db.products.map(p => `<tr><td>${esc(p.name)}</td><td>${pill(p.kind === 'beer' ? 'Beer' : 'Food', p.kind === 'beer' ? 'orange' : 'ok')}</td><td>${esc(rec(p.recipeId)?.name || '')}</td>
      <td class="n">${p.kind === 'beer' ? num(p.ml, 0) + ' ml' : ''}</td><td class="n">${inr(p.price)}</td><td class="acts">${link('Edit', 'editProd', p.id)}${link('Delete', 'delProd', p.id, 'del')}</td></tr>`);
    return head('Menu', 'Prices before tax. Beer items are tied to a recipe so every pour comes off the right stock.', btn('Add item', 'newProd'))
      + panel('', table(['Item', 'Type', 'Beer', { t: 'Serve', n: 1 }, { t: 'Price', n: 1 }, ''], rows));
  },

  dispatch() {
    const out = db.kegs.filter(k => k.status === 'At customer'), byCust = {};
    for (const k of out) (byCust[k.customerId] ||= []).push(k);
    const collect = Object.entries(byCust).map(([cid, ks]) => `<div class="collect"><h4>${esc(cust(cid)?.name || 'Unknown customer')} <small>${ks.length} keg${ks.length > 1 ? 's' : ''}</small></h4>
      ${ks.sort((a, b) => a.since.localeCompare(b.since)).map(k => { const days = daysBetween(k.since, today()); return `<div class="collect-row"><span class="code">${esc(k.code)}</span><span class="${days > 30 ? 'bad' : ''}">${days} days</span>${link('Picked up', 'kegPickup', k.id)}</div>`; }).join('')}</div>`);
    const sent = db.dispatches.filter(d => inPeriod(d.date));
    const rows = [...sent].sort((a, b) => b.date.localeCompare(a.date)).map(d => `<tr><td class="code">${esc(d.no)}</td><td>${fmtDate(d.date)}</td><td>${esc(cust(d.customerId)?.name || '')}${d.invoiceId ? `<small class="sub">${esc(db.sales.find(s => s.id === d.invoiceId)?.no || '')}</small>` : ''}</td>
      <td>${d.lines.map(l => `${esc(l.label)}${l.qty > 1 ? ' × ' + l.qty : ''}`).join('<br>')}</td><td class="n">${num(sum(d.lines, l => l.litres))} L</td><td class="acts">${link('Delete', 'delDispatch', d.id, 'del')}</td></tr>`);
    return head('Dispatch', 'Kegs and packaged beer sent to bars, shops and distributors. Kegs move to At customer until they are picked up.', btn('New dispatch', 'newDispatch'))
      + panel(`Kegs to collect (${out.length})`, collect.length ? `<div class="collect-grid">${collect.join('')}</div>` : '<p class="empty">No kegs out with customers.</p>')
      + periodSeg()
      + panel(`Dispatches ${periodText()} (${sent.length}, ${num(sum(sent, d => sum(d.lines, l => l.litres)), 0)} L)`, rows.length ? table(['Dispatch', 'Date', 'Customer', 'Items', { t: 'Litres', n: 1 }, ''], rows) : `<p class="empty">No dispatches ${periodText()}.</p>`);
  },

  partners() {
    const cRows = db.customers.map(c => {
      const out = db.kegs.filter(k => k.customerId === c.id && k.status === 'At customer').length;
      return `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.type)}</td><td>${esc(c.city)}</td><td>${esc(c.phone)}</td><td class="code">${esc(c.gstin)}</td><td class="n">${out || ''}</td><td class="acts">${link('Edit', 'editCust', c.id)}${link('Delete', 'delCust', c.id, 'del')}</td></tr>`;
    });
    const vRows = db.vendors.map(v => `<tr><td><b>${esc(v.name)}</b></td><td>${esc(v.supplies)}</td><td>${esc(v.phone)}</td><td class="code">${esc(v.gstin)}</td><td class="acts">${link('Edit', 'editVendor', v.id)}${link('Delete', 'delVendor', v.id, 'del')}</td></tr>`);
    return head('Customers and vendors', 'The masters every other screen draws on.', partnerTab === 'customers' ? btn('Add customer', 'newCust') : btn('Add vendor', 'newVendor'))
      + seg('partnerTab', [['customers', `Customers (${db.customers.length})`], ['vendors', `Vendors (${db.vendors.length})`]], partnerTab)
      + panel('', partnerTab === 'customers' ? table(['Name', 'Type', 'City', 'Phone', 'GSTIN', { t: 'Kegs out', n: 1 }, ''], cRows) : table(['Name', 'Supplies', 'Phone', 'GSTIN', ''], vRows));
  },
};

// ---------- actions ----------
const PROD_FIELDS = () => [
  { k: 'name', label: 'Item name', req: 1 }, { k: 'kind', label: 'Type', type: 'select', options: [{ v: 'beer', t: 'Beer' }, { v: 'food', t: 'Food' }] },
  { k: 'recipeId', label: 'Beer', type: 'select', options: [{ v: '', t: 'None' }, ...db.recipes.map(r => ({ v: r.id, t: r.name }))] },
  { k: 'ml', label: 'Serve size (ml)', type: 'number' }, { k: 'price', label: 'Price before tax (₹)', type: 'number' },
];
const CUST_FIELDS = [
  { k: 'name', label: 'Name', req: 1 }, { k: 'type', label: 'Type', list: ['Bar', 'Restaurant', 'Retail', 'Distributor', 'Event'] },
  { k: 'city', label: 'City' }, { k: 'phone', label: 'Phone' }, { k: 'gstin', label: 'GSTIN' },
  { k: 'loc', label: 'Map location (latitude, longitude)', wide: 1 },
];
const LOC_NOTE = 'For the keg map. In Google Maps, press and hold the place and copy the numbers, or stand at the bar and <button type="button" class="link" data-geo>use my location</button>.';
// The form shows one "lat, lng" box; the record keeps two numbers. A box that does not parse clears the pin.
const custVals = c => ({ ...c, loc: c.lat !== '' && c.lng !== '' ? `${c.lat}, ${c.lng}` : '' });
const custSave = ({ loc, ...v }) => {
  const p = parseLoc(loc);
  if (loc && !p) { toast('Map location should look like 12.9716, 77.5946'); return null; }
  return { ...v, lat: p?.lat ?? '', lng: p?.lng ?? '' };
};
const geoButton = () => {
  const b = document.querySelector('#modal [data-geo]');
  if (!b) return;
  b.onclick = () => {
    if (!navigator.geolocation) return toast('This browser cannot share its location');
    navigator.geolocation.getCurrentPosition(p => { document.querySelector('#modal [name=loc]').value = `${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}`; },
      () => toast('Location blocked. Allow it for this site, or paste the numbers'), { enableHighAccuracy: true, timeout: 10000 });
  };
};
const VENDOR_FIELDS = [{ k: 'name', label: 'Name', req: 1 }, { k: 'supplies', label: 'Supplies' }, { k: 'phone', label: 'Phone' }, { k: 'gstin', label: 'GSTIN' }];

const unitL = id => (id.startsWith('k:') ? keg(id.slice(2))?.size || 0 : pack(id.slice(2))?.unitL || 0);
function dispatchOpts() {
  const kegs = db.kegs.filter(k => k.status === 'Filled').map(k => {
    const b = db.batches.find(x => x.id === k.batchId);
    return { id: 'k:' + k.id, label: `Keg ${k.code} · ${rec(b?.recipeId)?.name || ''} ${b?.code || ''} · ${k.size} L` };
  });
  const packs = db.packs.filter(p => !p.kegIds.length && packLeft(p) > 0).map(p => {
    const b = db.batches.find(x => x.id === p.batchId);
    return { id: 'p:' + p.id, label: `${p.format} · ${rec(b?.recipeId)?.name || ''} ${b?.code || ''} (${packLeft(p)} left)` };
  });
  return [...kegs, ...packs];
}

export const actions = {
  newInv() {
    if (!db.products.length) return toast('Add menu items first');
    openForm({
      title: 'New invoice', vals: { customer: 'Walk-in', date: today() },
      fields: [{ k: 'customer', label: 'Customer', req: 1, list: ['Walk-in', ...db.customers.map(c => c.name)] }, { k: 'gstin', label: 'Customer GSTIN (optional)' }, { k: 'date', label: 'Date', type: 'date' }],
      lines: { label: 'Item', rows: [], opts: db.products.map(p => ({ id: p.id, label: p.name })), cols: [{ k: 'qty', label: 'Qty', def: () => 1 }, { k: 'price', label: 'Rate ₹', def: id => prod(id)?.price ?? 0 }] },
      live: (v, rows) => { const c = invoice({ vat: db.settings.vat, gst: db.settings.foodGst, lines: rows.map(r => ({ kind: prod(r.id)?.kind, qty: r.qty, price: r.price })) }); return `<p class="total">Total <b>${inr(c.total)}</b></p>`; },
      onSave: (v, lines) => {
        if (!lines.length) { toast('Add at least one line'); return false; }
        const need = {};
        for (const l of lines) { const p = prod(l.id); if (p?.kind === 'beer' && p.recipeId) need[p.recipeId] = (need[p.recipeId] || 0) + l.qty * p.ml / 1000; }
        const short = beerStock().filter(s => need[s.r.id] > Math.max(0, s.draught) + 0.01).map(s => `${s.r.name} (${Math.max(0, s.draught).toFixed(1)} L on tap)`);
        if (short.length && !confirm(`Not enough beer on tap: ${short.join(', ')}.\nSave the invoice anyway?`)) return false;
        const c = db.customers.find(x => x.name === v.customer);
        const saleLines = lines.map(l => ({ pid: l.id, kind: prod(l.id)?.kind, qty: l.qty, ml: prod(l.id)?.ml || 0, recipeId: prod(l.id)?.recipeId || '' }));
        db.sales.push({ id: uid(), no: next('inv', db.settings.prefix || 'INV', 4), ...v, gstin: v.gstin || c?.gstin || '', vat: db.settings.vat, gst: db.settings.foodGst, dispatchId: '', duty: removalDutyOn(saleLines),
          lines: lines.map(l => { const p = prod(l.id); return { pid: p.id, name: p.name, kind: p.kind, qty: l.qty, price: l.price, ml: p.ml, recipeId: p.recipeId }; }) });
        toast('Invoice saved');
      },
    });
  },
  delInv(id) { remove('sales', id, 'invoice'); },
  printInv(id) {
    const s = db.sales.find(x => x.id === id), c = invoice(s), st = db.settings;
    document.getElementById('print').innerHTML = `<div class="inv-head"><div><h2>${esc(st.name)}</h2>${esc(st.address)}<br>GSTIN ${esc(st.gstin)}</div><div style="text-align:right"><h2>Tax invoice</h2>${esc(s.no)}<br>${esc(s.date)}</div></div>
      <p><b>Bill to:</b> ${esc(s.customer)}${s.gstin ? `<br>GSTIN ${esc(s.gstin)}` : ''}</p>
      <table><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Amount</th></tr></thead><tbody>
      ${s.lines.map(l => `<tr><td>${esc(l.name)}</td><td class="n">${num(l.qty, 2)}</td><td class="n">${inr(l.price)}</td><td class="n">${inr(l.qty * l.price)}</td></tr>`).join('')}</tbody>
      <tfoot>${c.beer ? `<tr><td colspan="3">Beer subtotal</td><td class="n">${inr(c.beer)}</td></tr><tr><td colspan="3">VAT on beer @ ${s.vat}%</td><td class="n">${inr(c.vat)}</td></tr>` : ''}
      ${c.food ? `<tr><td colspan="3">Food subtotal</td><td class="n">${inr(c.food)}</td></tr><tr><td colspan="3">CGST @ ${s.gst / 2}%</td><td class="n">${inr(c.cgst)}</td></tr><tr><td colspan="3">SGST @ ${s.gst / 2}%</td><td class="n">${inr(c.sgst)}</td></tr>` : ''}
      <tr><td colspan="3"><b>Total</b></td><td class="n"><b>${inr(c.total)}</b></td></tr></tfoot></table>
      <p style="font-size:11px">Alcoholic liquor for human consumption is outside GST. VAT and state excise apply as per state law.</p>`;
    window.print();
  },

  newProd() { openForm({ title: 'Add menu item', fields: PROD_FIELDS(), vals: { kind: 'beer', ml: 330 }, onSave: v => { db.products.push({ id: uid(), ...v }); } }); },
  editProd(id) { const p = prod(id); openForm({ title: `Edit ${p.name}`, fields: PROD_FIELDS(), vals: p, onSave: v => { Object.assign(p, v); } }); },
  delProd(id) { if (db.sales.some(s => s.lines.some(l => l.pid === id))) return toast('This item is on past invoices, so it cannot be deleted. Rename it or change its price instead.'); remove('products', id, 'menu item'); },

  newDispatch(kegId) {
    const opts = dispatchOpts();
    if (!opts.length) return toast('Nothing packaged and ready to dispatch');
    if (!db.customers.length) return toast('Add a customer first');
    // One keg from its page, or a comma list from bulk scan.
    const picked = String(kegId || '').split(',').filter(Boolean).map(id => opts.find(o => o.id === 'k:' + id)).filter(Boolean);
    openForm({
      title: 'New dispatch',
      fields: [{ k: 'customerId', label: 'Customer', type: 'select', options: db.customers.map(c => ({ v: c.id, t: c.name })) }, { k: 'date', label: 'Date', type: 'date' },
        { k: 'invoice', label: 'Trade invoice', type: 'select', options: [{ v: 'yes', t: 'Raise a tax invoice' }, { v: 'no', t: 'No invoice (already billed)' }] }],
      vals: { customerId: db.customers[0].id, date: today(), invoice: 'yes' },
      lines: { label: 'Keg or package', rows: picked.map(o => ({ id: o.id, qty: 1 })), opts, cols: [{ k: 'qty', label: 'Qty', def: () => 1 }, { k: 'price', label: 'Rate ₹', def: id => Math.round(unitL(id) * (db.settings.tradeRateL || 0)) }] },
      note: `Kegs always count as one each. Rates default to the trade price of ₹${db.settings.tradeRateL || 0} per litre from Settings.`,
      onSave: (v, rows) => {
        if (!rows.length) { toast('Add at least one line'); return false; }
        const seen = new Set(), lines = [];
        for (const r of rows) {
          const label = opts.find(o => o.id === r.id)?.label.replace(/ \(\d+ left\)$/, '') || r.id;
          if (r.id.startsWith('k:')) {
            const k = keg(r.id.slice(2));
            if (!k || seen.has(k.id)) continue;
            seen.add(k.id);
            moveKeg(k, 'At customer', v.date, { customerId: v.customerId });
            lines.push({ ref: r.id, label, qty: 1, litres: k.size, price: r.price, batchId: k.batchId });
          } else {
            const p = pack(r.id.slice(2)), qty = Math.min(r.qty, packLeft(p));
            lines.push({ ref: r.id, label, qty, litres: +(qty * p.unitL).toFixed(2), price: r.price, batchId: p.batchId });
          }
        }
        const c = cust(v.customerId), litres = lines.reduce((a, l) => a + l.litres, 0);
        const d = { id: uid(), no: next('disp', 'D', 4), date: v.date, customerId: v.customerId, invoiceId: '', duty: removalDutyOn(lines), lines: lines.map(({ price, ...l }) => l) };
        if (v.invoice === 'yes') {
          const inv = { id: uid(), no: next('inv', db.settings.prefix || 'INV', 4), date: v.date, customer: c.name, gstin: c.gstin, vat: db.settings.vat, gst: db.settings.foodGst, dispatchId: d.id, duty: 0,
            lines: lines.map(l => ({ pid: '', name: l.label, kind: 'beer', qty: l.qty, price: l.price })) };
          db.sales.push(inv);
          d.invoiceId = inv.id;
        }
        db.dispatches.push(d);
        toast(`Dispatched to ${c.name}${d.invoiceId ? ', invoice raised' : ''}`);
      },
    });
  },
  delDispatch(id) {
    const d = db.dispatches.find(x => x.id === id);
    if (!confirm(`Delete ${d.no}? Kegs on it go back to Filled${d.invoiceId ? ' and its trade invoice is deleted' : ''}.`)) return;
    db.sales = db.sales.filter(s => s.id !== d.invoiceId);
    for (const l of d.lines) if (l.ref.startsWith('k:')) { const k = keg(l.ref.slice(2)); if (k?.status === 'At customer') undoKeg(k, 'Filled', { customerId: '' }); }
    db.dispatches = db.dispatches.filter(x => x.id !== id);
    commit();
  },

  newCust() {
    openForm({ title: 'Add customer', fields: CUST_FIELDS, vals: { type: 'Bar' }, note: LOC_NOTE, onSave: v => { const c = custSave(v); if (!c) return false; db.customers.push({ id: uid(), ...c }); } });
    geoButton();
  },
  editCust(id) {
    const c = cust(id);
    openForm({ title: `Edit ${c.name}`, fields: CUST_FIELDS, vals: custVals(c), note: LOC_NOTE, onSave: v => { const n = custSave(v); if (!n) return false; Object.assign(c, n); } });
    geoButton();
  },
  delCust(id) { if (db.kegs.some(k => k.customerId === id)) return toast('This customer still has kegs'); remove('customers', id, 'customer'); },
  newVendor() { openForm({ title: 'Add vendor', fields: VENDOR_FIELDS, onSave: v => { db.vendors.push({ id: uid(), ...v }); } }); },
  editVendor(id) { const v0 = db.vendors.find(x => x.id === id); openForm({ title: `Edit ${v0.name}`, fields: VENDOR_FIELDS, vals: v0, onSave: v => { Object.assign(v0, v); } }); },
  delVendor(id) { remove('vendors', id, 'vendor'); },
};

export const segs = { partnerTab: v => { partnerTab = v; } };
