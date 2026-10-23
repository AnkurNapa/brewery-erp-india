// Menu, taproom invoices, dispatch to trade customers, customer and vendor masters.
import { db, remove, next, nextDoc, commit, moveKeg, undoKeg, logAct, guardLock, HSN, PAY_MODES } from '../store.js';
import { esc, num, inr, inr0, today, fmtDate, sum, uid, toast, daysBetween, addDays } from '../util.js';
import { head, btn, link, pill, panel, table, kpi, openForm, seg } from '../ui.js';
import { parseLoc } from '../kegmap.js';
import { periodSeg, periodText, inPeriod } from '../period.js';
import { rec, prod, cust, keg, pack, invoice, packLeft, beerStock, removalDutyOn, balance, paid, receivables, AGE_BUCKETS, lineL } from '../calc.js';

let partnerTab = 'customers';

// A credit note reverses some or all of an invoice. Excise on removal comes back in proportion to the beer credited.
// Paid at the till, settled, or what is still owed and how late it is.
const dueCell = s => {
  if (!s.credit) return s.mode ? `<small class="sub">${esc(s.mode)}</small>` : '';
  const b = balance(s), late = daysBetween(s.dueDate, today());
  return b > 0 ? `<b class="${late > 0 ? 'bad' : ''}">${inr(b)}</b><small class="sub">${late > 0 ? `${late} days late` : `due ${fmtDate(s.dueDate)}`}</small>` : b < 0 ? `<small class="sub">Refund ${inr(-b)}</small>` : pill('Paid', 'ok');
};

function creditNote(s, reason, qtys = s.lines.map(l => l.qty)) {
  const beerOf = q => sum(s.lines.map((l, i) => (l.kind === 'beer' ? q[i] * (l.ml || 1) : 0)), x => x);
  const share = beerOf(s.lines.map(l => l.qty)) ? beerOf(qtys) / beerOf(s.lines.map(l => l.qty)) : 0;
  const lines = s.lines.map((l, i) => ({ ...l, qty: -qtys[i] })).filter(l => l.qty);
  const full = qtys.every((q, i) => q === s.lines[i].qty);
  const cn = { ...s, id: uid(), no: nextDoc('cn', 'CN'), date: today(), type: 'Credit note', ref: s.no, reason, cancelledBy: '', dispatchId: '', credit: false, payments: [], duty: -+(s.duty * share).toFixed(2), lines };
  db.sales.push(cn);
  if (full) s.cancelledBy = cn.id;
  logAct(full ? 'Cancelled invoice' : 'Credit note', s.no, `${cn.no}: ${reason}`);
  return cn;
}

export const views = {
  sales() {
    const list = db.sales.filter(s => inPeriod(s.date)), tot = list.map(invoice);
    const docNote = s => s.cancelledBy ? `<small class="sub void">Cancelled by ${esc(db.sales.find(x => x.id === s.cancelledBy)?.no || '')}</small>` : s.type === 'Credit note' ? `<small class="sub">Against ${esc(s.ref)}: ${esc(s.reason)}</small>` : '';
    const rows = [...list].sort((a, b) => b.date.localeCompare(a.date) || b.no.localeCompare(a.no)).map(s => {
      const c = invoice(s);
      return `<tr class="${s.cancelledBy ? 'voided' : ''}"><td class="code">${esc(s.no)}</td><td>${fmtDate(s.date)}</td><td>${esc(s.customer)} ${s.dispatchId ? pill('Trade', 'info') : ''}${s.type === 'Credit note' ? pill('Credit note', 'orange') : ''}${docNote(s)}</td><td class="n">${inr(c.beer)}</td><td class="n">${inr(c.food)}</td>
        <td class="n">${inr(c.vat + c.cgst + c.sgst)}</td><td class="n"><b>${inr(c.total)}</b></td><td class="n">${dueCell(s)}</td>
        <td class="acts">${link('Print', 'printInv', s.id)}${balance(s) > 0 ? link('Receive', 'receivePay', s.id) : ''}${s.type !== 'Credit note' && !s.cancelledBy ? link('Credit note', 'creditInv', s.id) + link('Cancel', 'cancelInv', s.id, 'del') : ''}</td></tr>`;
    });
    return head('Taproom sales', 'Beer carries state VAT and is drawn from that beer\'s tank stock. Food carries GST split as CGST and SGST.', `${btn('Sales CSV', 'csvSales', '', 'ghost')} ${btn('New invoice', 'newInv')}`)
      + periodSeg()
      + `<div class="kpis four">${kpi(list.filter(s => s.type !== 'Credit note').length, `Invoices ${periodText()}`)}${kpi(inr0(sum(tot, c => c.beer)), 'Beer before tax')}${kpi(inr0(sum(tot, c => c.food)), 'Food before tax')}${kpi(inr0(sum(tot, c => c.total)), 'Total with tax')}</div>`
      + panel('', rows.length ? table(['Invoice', 'Date', 'Customer', { t: 'Beer', n: 1 }, { t: 'Food', n: 1 }, { t: 'Tax', n: 1 }, { t: 'Total', n: 1 }, { t: 'Due', n: 1 }, ''], rows) : `<p class="empty">No invoices ${periodText()}.</p>`);
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
    const rows = [...sent].sort((a, b) => b.date.localeCompare(a.date)).map(d => `<tr class="${d.cancelledBy ? 'voided' : ''}"><td class="code">${esc(d.no)}</td><td>${fmtDate(d.date)}</td><td>${esc(cust(d.customerId)?.name || '')}${d.ref ? `${pill('Reversal', 'orange')}<small class="sub">Reverses ${esc(d.ref)}: ${esc(d.reason)}</small>` : ''}${d.cancelledBy ? '<small class="sub void">Cancelled</small>' : ''}${d.invoiceId ? `<small class="sub">${esc(db.sales.find(s => s.id === d.invoiceId)?.no || '')}</small>` : ''}</td>
      <td>${d.lines.map(l => `${esc(l.label)}${l.qty > 1 ? ' × ' + l.qty : ''}`).join('<br>')}</td><td class="n">${num(sum(d.lines, l => l.litres))} L</td><td class="acts">${d.ref || d.cancelledBy ? '' : link('Cancel', 'cancelDispatch', d.id, 'del')}</td></tr>`);
    return head('Dispatch', 'Kegs and packaged beer sent to bars, shops and distributors. Kegs move to At customer until they are picked up.', btn('New dispatch', 'newDispatch'))
      + panel(`Kegs to collect (${out.length})`, collect.length ? `<div class="collect-grid">${collect.join('')}</div>` : '<p class="empty">No kegs out with customers.</p>')
      + periodSeg()
      + panel(`Dispatches ${periodText()} (${sent.length}, ${num(sum(sent, d => sum(d.lines, l => l.litres)), 0)} L)`, rows.length ? table(['Dispatch', 'Date', 'Customer', 'Items', { t: 'Litres', n: 1 }, ''], rows) : `<p class="empty">No dispatches ${periodText()}.</p>`);
  },

  partners() {
    const recv = receivables();
    const cRows = db.customers.map(c => {
      const out = db.kegs.filter(k => k.customerId === c.id && k.status === 'At customer').length, owed = recv.find(r => r.customer === c.name)?.total || 0;
      return `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.type)}</td><td>${esc(c.city)}</td><td>${esc(c.phone)}</td><td class="code">${esc(c.gstin)}</td><td class="n">${c.terms ? c.terms + ' days' : ''}</td><td class="n">${owed ? inr0(owed) : ''}</td><td class="n">${out || ''}</td><td class="acts">${link('Edit', 'editCust', c.id)}${link('Delete', 'delCust', c.id, 'del')}</td></tr>`;
    });
    const vRows = db.vendors.map(v => `<tr><td><b>${esc(v.name)}</b></td><td>${esc(v.supplies)}</td><td>${esc(v.phone)}</td><td class="code">${esc(v.gstin)}</td><td class="acts">${link('Edit', 'editVendor', v.id)}${link('Delete', 'delVendor', v.id, 'del')}</td></tr>`);
    return head('Customers and vendors', 'The masters every other screen draws on.', partnerTab === 'customers' ? btn('Add customer', 'newCust') : btn('Add vendor', 'newVendor'))
      + seg('partnerTab', [['customers', `Customers (${db.customers.length})`], ['vendors', `Vendors (${db.vendors.length})`]], partnerTab)
      + (partnerTab === 'customers' && recv.length ? panel(`Receivables (${inr0(sum(recv, r => r.total))} to collect)`, table(['Customer', ...AGE_BUCKETS.map(t => ({ t, n: 1 })), { t: 'Total', n: 1 }],
        recv.map(r => `<tr><td><b>${esc(r.customer)}</b><small class="sub">${r.invoices.map(s => esc(s.no)).join(', ')}</small></td>${r.ages.map((a, i) => `<td class="n ${i > 1 && a > 0 ? 'bad' : ''}">${a ? inr0(a) : ''}</td>`).join('')}<td class="n"><b>${inr0(r.total)}</b></td></tr>`))
        + '<p class="note">Ageing counts days past each invoice\'s due date. Record payments from Taproom sales, Receive.</p>') : '')
      + panel('', partnerTab === 'customers' ? table(['Name', 'Type', 'City', 'Phone', 'GSTIN', { t: 'Terms', n: 1 }, { t: 'Owes', n: 1 }, { t: 'Kegs out', n: 1 }, ''], cRows) : table(['Name', 'Supplies', 'Phone', 'GSTIN', ''], vRows));
  },
};

// ---------- actions ----------
const PROD_FIELDS = () => [
  { k: 'name', label: 'Item name', req: 1 }, { k: 'kind', label: 'Type', type: 'select', options: [{ v: 'beer', t: 'Beer' }, { v: 'food', t: 'Food' }] },
  { k: 'recipeId', label: 'Beer', type: 'select', options: [{ v: '', t: 'None' }, ...db.recipes.map(r => ({ v: r.id, t: r.name }))] },
  { k: 'ml', label: 'Serve size (ml)', type: 'number' }, { k: 'price', label: 'Price before tax (₹)', type: 'number' },
  { k: 'hsn', label: 'HSN or SAC (beer 2203, food 996331)' },
];
const CUST_FIELDS = [
  { k: 'name', label: 'Name', req: 1 }, { k: 'type', label: 'Type', list: ['Bar', 'Restaurant', 'Retail', 'Distributor', 'Event'] },
  { k: 'city', label: 'City' }, { k: 'phone', label: 'Phone' }, { k: 'gstin', label: 'GSTIN' }, { k: 'terms', label: 'Payment terms (days)', type: 'number' },
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
      title: 'New invoice', vals: { customer: 'Walk-in', date: today(), pay: 'Cash' },
      fields: [{ k: 'customer', label: 'Customer', req: 1, list: ['Walk-in', ...db.customers.map(c => c.name)] }, { k: 'gstin', label: 'Customer GSTIN (optional)' }, { k: 'date', label: 'Date', type: 'date' },
        { k: 'pay', label: 'Payment', type: 'select', options: [...PAY_MODES.map(m => ({ v: m, t: `Paid now, ${m}` })), { v: 'credit', t: 'On credit, customer pays later' }] }],
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
        const { pay, ...head } = v, credit = pay === 'credit';
        if (credit && !c) { toast('Credit is for customers on file. Add them under Customers first.'); return false; }
        db.sales.push({ id: uid(), no: nextDoc('inv', db.settings.prefix), ...head, gstin: v.gstin || c?.gstin || '', vat: db.settings.vat, gst: db.settings.foodGst, dispatchId: '', duty: removalDutyOn(saleLines),
          type: 'Invoice', mode: credit ? '' : pay, credit, dueDate: credit ? addDays(v.date, c.terms || 30) : '', payments: [],
          lines: lines.map(l => { const p = prod(l.id); return { pid: p.id, name: p.name, kind: p.kind, qty: l.qty, price: l.price, ml: p.ml, recipeId: p.recipeId, hsn: p.hsn || HSN[p.kind] }; }) });
        toast('Invoice saved');
      },
    });
  },
  receivePay(id) {
    const s = db.sales.find(x => x.id === id), b = balance(s);
    openForm({ title: `Payment for ${s.no}`, vals: { amount: b, date: today(), mode: 'Bank transfer' },
      fields: [{ k: 'amount', label: `Amount (₹, ${inr(b)} due)`, type: 'number', req: 1 }, { k: 'date', label: 'Date', type: 'date' },
        { k: 'mode', label: 'Paid by', type: 'select', options: PAY_MODES.map(m => ({ v: m, t: m })) }, { k: 'ref', label: 'UTR, cheque or receipt number' }],
      onSave: v => {
        if (!(v.amount > 0) || v.amount > b + 0.01) { toast(`Enter an amount up to ${inr(b)}`); return false; }
        s.payments = [...s.payments, { date: v.date, amount: v.amount, mode: v.mode, ref: v.ref }];
        logAct('Payment received', s.no, `${inr(v.amount)} by ${v.mode}${v.ref ? ` (${v.ref})` : ''}`);
        toast(balance(s) > 0 ? `${inr(v.amount)} received, ${inr(balance(s))} still due` : `${s.no} paid in full`);
      } });
  },
  // A partial credit note for returns or a price correction. Each line can be credited up to what was invoiced.
  creditInv(id) {
    const s = db.sales.find(x => x.id === id);
    if (s.dispatchId && db.dispatches.find(d => d.id === s.dispatchId && !d.cancelledBy) && s.lines.some(l => l.kind === 'beer') && !confirm('Kegs or packs on this invoice stay with the customer. Credit the price only?')) return;
    if (!guardLock(today())) return;
    const done = s.lines.map(l => -sum(db.sales.filter(x => x.type === 'Credit note' && x.ref === s.no).flatMap(x => x.lines).filter(x => x.name === l.name), x => x.qty));
    openForm({ title: `Credit note on ${s.no}`, vals: {},
      fields: [...s.lines.map((l, i) => ({ k: 'q' + i, label: `${l.name}, up to ${num(l.qty - done[i], 2)}`, type: 'number' })), { k: 'reason', label: 'Reason', req: 1, wide: 1 }],
      onSave: v => {
        const q = s.lines.map((l, i) => v['q' + i] || 0);
        if (q.some((x, i) => x > s.lines[i].qty - done[i] + 1e-9)) { toast('A line cannot be credited beyond what was invoiced'); return false; }
        if (!q.some(x => x > 0)) { toast('Enter a quantity to credit on at least one line'); return false; }
        const cn = creditNote(s, v.reason, q);
        toast(`${cn.no} raised against ${s.no}`);
      } });
  },
  // Invoices are never deleted. Cancelling raises a credit note dated today that reverses every line, so VAT, GST,
  // excise and stock correct themselves in the month of cancellation and a month already filed does not change.
  cancelInv(id) {
    const s = db.sales.find(x => x.id === id);
    if (s.dispatchId && db.dispatches.find(d => d.id === s.dispatchId && !d.cancelledBy)) return toast('This invoice belongs to a dispatch. Cancel the dispatch instead, so the goods come back too.');
    if (!guardLock(today())) return;
    openForm({ title: `Cancel ${s.no}`, fields: [{ k: 'reason', label: 'Reason', req: 1, wide: 1 }], note: `A credit note dated today reverses every line of ${esc(s.no)}. The invoice keeps its number.`,
      onSave: v => { const cn = creditNote(s, v.reason); toast(`${s.no} cancelled by ${cn.no}`); } });
  },
  // GST rule 46 fields: supplier and recipient GSTIN, place of supply with state code, HSN or SAC per line,
  // a number unique in the financial year. Liquor lines carry state VAT and are outside GST.
  printInv(id) {
    const s = db.sales.find(x => x.id === id), c = invoice(s), st = db.settings, cn = s.type === 'Credit note';
    const who = db.customers.find(x => x.name === s.customer), code = (st.gstin || '').slice(0, 2), bal = balance(s);
    document.getElementById('print').innerHTML = `<div class="inv-head"><div><h2>${esc(st.name)}</h2>${esc(st.address)}<br>GSTIN ${esc(st.gstin)}</div>
      <div style="text-align:right"><h2>${cn ? 'Credit note' : 'Tax invoice'}</h2>${esc(s.no)}<br>${esc(s.date)}${cn ? `<br>Against invoice ${esc(s.ref)}` : ''}${s.cancelledBy ? '<br><b>CANCELLED</b>' : ''}</div></div>
      <p><b>Bill to:</b> ${esc(s.customer)}${who?.city ? `, ${esc(who.city)}` : ''}${s.gstin ? `<br>GSTIN ${esc(s.gstin)}` : ''}<br>Place of supply: ${esc(st.state || '')}${code ? ` (${esc(code)})` : ''}</p>
      <table><thead><tr><th>Item</th><th>HSN / SAC</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Amount</th></tr></thead><tbody>
      ${s.lines.map(l => `<tr><td>${esc(l.name)}</td><td>${esc(l.hsn)}</td><td class="n">${num(l.qty, 2)}</td><td class="n">${inr(l.price)}</td><td class="n">${inr(l.qty * l.price)}</td></tr>`).join('')}</tbody>
      <tfoot>${c.beer ? `<tr><td colspan="4">Beer subtotal</td><td class="n">${inr(c.beer)}</td></tr><tr><td colspan="4">VAT on beer @ ${s.vat}%</td><td class="n">${inr(c.vat)}</td></tr>` : ''}
      ${c.food ? `<tr><td colspan="4">Food subtotal</td><td class="n">${inr(c.food)}</td></tr><tr><td colspan="4">CGST @ ${s.gst / 2}%</td><td class="n">${inr(c.cgst)}</td></tr><tr><td colspan="4">SGST @ ${s.gst / 2}%</td><td class="n">${inr(c.sgst)}</td></tr>` : ''}
      <tr><td colspan="4"><b>Total</b></td><td class="n"><b>${inr(c.total)}</b></td></tr>
      ${s.credit ? `<tr><td colspan="4">Paid</td><td class="n">${inr(paid(s))}</td></tr><tr><td colspan="4"><b>Balance due by ${esc(s.dueDate)}</b></td><td class="n"><b>${inr(bal)}</b></td></tr>` : s.mode ? `<tr><td colspan="4">Paid by ${esc(s.mode)}</td><td class="n">${inr(c.total)}</td></tr>` : ''}</tfoot></table>
      <p style="font-size:11px">Alcoholic liquor for human consumption is outside GST. VAT and state excise apply as per state law.</p>`;
    window.print();
  },

  newProd() { openForm({ title: 'Add menu item', fields: PROD_FIELDS(), vals: { kind: 'beer', ml: 330 }, onSave: v => { db.products.push({ id: uid(), ...v, hsn: v.hsn || HSN[v.kind] }); } }); },
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
          const inv = { id: uid(), no: nextDoc('inv', db.settings.prefix), date: v.date, customer: c.name, gstin: c.gstin, vat: db.settings.vat, gst: db.settings.foodGst, dispatchId: d.id, duty: 0,
            credit: true, dueDate: addDays(v.date, c.terms || 30), payments: [], mode: '', type: 'Invoice',
            lines: lines.map(l => ({ pid: '', name: l.label, kind: 'beer', qty: l.qty, price: l.price, hsn: HSN.beer })) };
          db.sales.push(inv);
          d.invoiceId = inv.id;
        }
        db.dispatches.push(d);
        toast(`Dispatched to ${c.name}${d.invoiceId ? ', invoice raised' : ''}`);
      },
    });
  },
  // A dispatch is reversed, not deleted: a reversal dated today brings packs back to stock, kegs back to Filled
  // and cancels the trade invoice with a credit note. Kegs already picked up or moved on block it.
  cancelDispatch(id) {
    const d = db.dispatches.find(x => x.id === id);
    const away = d.lines.filter(l => l.ref.startsWith('k:')).map(l => keg(l.ref.slice(2))).filter(k => k && !(k.status === 'At customer' && k.customerId === d.customerId));
    if (away.length) return toast(`${away.map(k => k.code).join(', ')} ${away.length === 1 ? 'is' : 'are'} no longer at the customer, so ${d.no} cannot be cancelled`);
    if (!guardLock(today())) return;
    openForm({ title: `Cancel ${d.no}`, fields: [{ k: 'reason', label: 'Reason', req: 1, wide: 1 }], note: `Kegs go back to Filled, packs back to stock${d.invoiceId ? ' and the trade invoice is cancelled by a credit note' : ''}. ${esc(d.no)} stays on file.`,
      onSave: v => {
        for (const l of d.lines) if (l.ref.startsWith('k:')) undoKeg(keg(l.ref.slice(2)), 'Filled', { customerId: '' });
        const rev = { ...d, id: uid(), no: `${d.no}-R`, date: today(), ref: d.no, reason: v.reason, invoiceId: '', cancelledBy: '', duty: -d.duty, lines: d.lines.map(l => ({ ...l, qty: -l.qty, litres: -l.litres })) };
        db.dispatches.push(rev);
        d.cancelledBy = rev.id;
        const inv = db.sales.find(s => s.id === d.invoiceId);
        if (inv && !inv.cancelledBy) creditNote(inv, `Dispatch ${d.no} cancelled: ${v.reason}`);
        logAct('Cancelled dispatch', d.no, v.reason);
        toast(`${d.no} cancelled`);
      } });
  },

  newCust() {
    openForm({ title: 'Add customer', fields: CUST_FIELDS, vals: { type: 'Bar', terms: 30 }, note: LOC_NOTE, onSave: v => { const c = custSave(v); if (!c) return false; db.customers.push({ id: uid(), ...c }); } });
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
