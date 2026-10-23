// Menu, taproom invoices, dispatch to trade customers, customer and vendor masters.
import { db, next, commit } from '../store.js';
import { esc, num, inr, inr0, today, fmtDate, sum, uid, toast } from '../util.js';
import { head, btn, link, pill, panel, table, openForm, seg } from '../ui.js';
import { rec, prod, cust, keg, pack, invoice, packLeft } from '../calc.js';

const remove = (coll, id, what) => { if (confirm(`Delete this ${what}?`)) { db[coll] = db[coll].filter(x => x.id !== id); commit(); } };
let partnerTab = 'customers';

export const views = {
  sales() {
    const rows = [...db.sales].sort((a, b) => b.date.localeCompare(a.date) || b.no.localeCompare(a.no)).map(s => {
      const c = invoice(s);
      return `<tr><td class="code">${esc(s.no)}</td><td>${fmtDate(s.date)}</td><td>${esc(s.customer)}</td><td class="n">${inr(c.beer)}</td><td class="n">${inr(c.food)}</td>
        <td class="n">${inr(c.vat + c.cgst + c.sgst)}</td><td class="n"><b>${inr(c.total)}</b></td><td class="acts">${link('Print', 'printInv', s.id)}${link('Delete', 'delInv', s.id, 'del')}</td></tr>`;
    });
    return head('Taproom sales', 'Beer carries state VAT and is drawn from that beer\'s tank stock. Food carries GST split as CGST and SGST.', btn('New invoice', 'newInv'))
      + panel('', table(['Invoice', 'Date', 'Customer', { t: 'Beer', n: 1 }, { t: 'Food', n: 1 }, { t: 'Tax', n: 1 }, { t: 'Total', n: 1 }, ''], rows));
  },

  menu() {
    const rows = db.products.map(p => `<tr><td>${esc(p.name)}</td><td>${pill(p.kind === 'beer' ? 'Beer' : 'Food', p.kind === 'beer' ? 'orange' : 'ok')}</td><td>${esc(rec(p.recipeId)?.name || '')}</td>
      <td class="n">${p.kind === 'beer' ? num(p.ml, 0) + ' ml' : ''}</td><td class="n">${inr(p.price)}</td><td class="acts">${link('Edit', 'editProd', p.id)}${link('Delete', 'delProd', p.id, 'del')}</td></tr>`);
    return head('Menu', 'Prices before tax. Beer items are tied to a recipe so every pour comes off the right stock.', btn('Add item', 'newProd'))
      + panel('', table(['Item', 'Type', 'Beer', { t: 'Serve', n: 1 }, { t: 'Price', n: 1 }, ''], rows));
  },

  dispatch() {
    const rows = [...db.dispatches].sort((a, b) => b.date.localeCompare(a.date)).map(d => `<tr><td class="code">${esc(d.no)}</td><td>${fmtDate(d.date)}</td><td>${esc(cust(d.customerId)?.name || '')}</td>
      <td>${d.lines.map(l => `${esc(l.label)}${l.qty > 1 ? ' × ' + l.qty : ''}`).join('<br>')}</td><td class="n">${num(sum(d.lines, l => l.litres))} L</td><td class="acts">${link('Delete', 'delDispatch', d.id, 'del')}</td></tr>`);
    return head('Dispatch', 'Kegs and packaged beer sent to bars, shops and distributors. Kegs move to At customer until they are picked up.', btn('New dispatch', 'newDispatch'))
      + panel('', table(['Dispatch', 'Date', 'Customer', 'Items', { t: 'Litres', n: 1 }, ''], rows));
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
];
const VENDOR_FIELDS = [{ k: 'name', label: 'Name', req: 1 }, { k: 'supplies', label: 'Supplies' }, { k: 'phone', label: 'Phone' }, { k: 'gstin', label: 'GSTIN' }];

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
        const c = db.customers.find(x => x.name === v.customer);
        db.sales.push({ id: uid(), no: next('inv', db.settings.prefix || 'INV', 4), ...v, gstin: v.gstin || c?.gstin || '', vat: db.settings.vat, gst: db.settings.foodGst,
          lines: lines.map(l => { const p = prod(l.id); return { pid: p.id, name: p.name, kind: p.kind, qty: l.qty, price: l.price }; }) });
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
  delProd(id) { remove('products', id, 'menu item'); },

  newDispatch(kegId) {
    const opts = dispatchOpts();
    if (!opts.length) return toast('Nothing packaged and ready to dispatch');
    if (!db.customers.length) return toast('Add a customer first');
    const first = kegId && opts.find(o => o.id === 'k:' + kegId);
    openForm({
      title: 'New dispatch', vals: { customerId: db.customers[0].id, date: today() },
      fields: [{ k: 'customerId', label: 'Customer', type: 'select', options: db.customers.map(c => ({ v: c.id, t: c.name })) }, { k: 'date', label: 'Date', type: 'date' }],
      lines: { label: 'Keg or package', rows: first ? [{ id: first.id, qty: 1 }] : [], opts, cols: [{ k: 'qty', label: 'Qty', def: () => 1 }] },
      note: 'Kegs always count as one each.',
      onSave: (v, rows) => {
        if (!rows.length) { toast('Add at least one line'); return false; }
        const seen = new Set(), lines = [];
        for (const r of rows) {
          const label = opts.find(o => o.id === r.id)?.label.replace(/ \(\d+ left\)$/, '') || r.id;
          if (r.id.startsWith('k:')) {
            const k = keg(r.id.slice(2));
            if (!k || seen.has(k.id)) continue;
            seen.add(k.id);
            Object.assign(k, { status: 'At customer', customerId: v.customerId, since: v.date });
            lines.push({ ref: r.id, label, qty: 1, litres: k.size });
          } else {
            const p = pack(r.id.slice(2)), qty = Math.min(r.qty, packLeft(p));
            lines.push({ ref: r.id, label, qty, litres: +(qty * p.unitL).toFixed(2) });
          }
        }
        db.dispatches.push({ id: uid(), no: next('disp', 'D', 4), ...v, lines });
        toast(`Dispatched to ${cust(v.customerId).name}`);
      },
    });
  },
  delDispatch(id) {
    const d = db.dispatches.find(x => x.id === id);
    if (!confirm(`Delete ${d.no}? Kegs on it go back to Filled.`)) return;
    for (const l of d.lines) if (l.ref.startsWith('k:')) { const k = keg(l.ref.slice(2)); if (k?.status === 'At customer') Object.assign(k, { status: 'Filled', customerId: '' }); }
    db.dispatches = db.dispatches.filter(x => x.id !== id);
    commit();
  },

  newCust() { openForm({ title: 'Add customer', fields: CUST_FIELDS, vals: { type: 'Bar' }, onSave: v => { db.customers.push({ id: uid(), ...v }); } }); },
  editCust(id) { const c = cust(id); openForm({ title: `Edit ${c.name}`, fields: CUST_FIELDS, vals: c, onSave: v => { Object.assign(c, v); } }); },
  delCust(id) { if (db.kegs.some(k => k.customerId === id)) return toast('This customer still has kegs'); remove('customers', id, 'customer'); },
  newVendor() { openForm({ title: 'Add vendor', fields: VENDOR_FIELDS, onSave: v => { db.vendors.push({ id: uid(), ...v }); } }); },
  editVendor(id) { const v0 = db.vendors.find(x => x.id === id); openForm({ title: `Edit ${v0.name}`, fields: VENDOR_FIELDS, vals: v0, onSave: v => { Object.assign(v0, v); } }); },
  delVendor(id) { remove('vendors', id, 'vendor'); },
};

export const segs = { partnerTab: v => { partnerTab = v; } };
