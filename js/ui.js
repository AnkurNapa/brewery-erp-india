// Rendering helpers shared by every screen.
import { esc, num, $ } from './util.js';
import { commit } from './store.js';

export const head = (title, sub = '', btn = '') =>
  `<div class="head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${btn ? `<div class="head-btns">${btn}</div>` : ''}</div>`;
export const btn = (label, act, id = '', cls = 'primary') => `<button class="${cls}" data-act="${act}" data-id="${id}">${label}</button>`;
export const link = (label, act, id = '', cls = '') => `<button class="link ${cls}" data-act="${act}" data-id="${id}">${label}</button>`;
export const pill = (txt, cls = '') => `<span class="pill ${cls}">${esc(txt)}</span>`;
export const statusCls = s => ({ Ready: 'ok', 'Sold out': 'grey', Conditioning: 'info', Planned: 'grey', Brewing: 'orange', Fermenting: 'orange', Open: 'orange', Done: 'ok', Received: 'ok', Approved: 'ok', Pending: 'orange', Rejected: 'low', Empty: 'grey', Filled: 'ok', 'At customer': 'info', Cleaning: 'orange' }[s] || '');
export const panel = (title, body, extra = '') => `<section class="panel">${title ? `<div class="panel-head"><h3>${title}</h3>${extra}</div>` : ''}${body}</section>`;
export const seg = (name, opts, cur) => `<div class="seg" role="tablist">${opts.map(([v, t]) => `<button role="tab" data-seg="${name}" data-v="${v}" aria-selected="${v === cur}">${t}</button>`).join('')}</div>`;

export function table(cols, rows, foot = '') {
  if (!rows.length) return '<p class="empty">Nothing here yet.</p>';
  return `<div class="tw"><table><thead><tr>${cols.map(c => `<th class="${c.n ? 'n' : ''}">${c.t ?? c}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody>${foot}</table></div>`;
}

// ---------- forms ----------
export function field(f, v) {
  const attrs = `name="${f.k}" ${f.req ? 'required' : ''} ${f.ro ? 'readonly' : ''}`;
  let input;
  if (f.type === 'select') input = `<select ${attrs}>${f.options.map(o => `<option value="${esc(o.v)}" ${String(o.v) === String(v ?? '') ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select>`;
  else input = `<input ${attrs} type="${f.type || 'text'}" ${f.type === 'number' ? `step="${f.step || 'any'}" min="0"` : ''} ${f.list ? `list="dl-${f.k}"` : ''} value="${esc(v ?? '')}">`
    + (f.list ? `<datalist id="dl-${f.k}">${f.list.map(o => `<option value="${esc(o)}">`).join('')}</datalist>` : '');
  return `<label class="${f.wide ? 'wide' : ''}"><span>${esc(f.label)}</span>${input}</label>`;
}
export function readForm(form, fields) {
  const fd = new FormData(form), out = {};
  for (const f of fields) {
    const raw = (fd.get(f.k) ?? '').toString().trim();
    out[f.k] = f.type === 'number' ? (raw === '' ? (f.blank ? '' : 0) : +raw) : raw;
  }
  return out;
}

// L = { label, opts:[{id,label}], rows:[{id,...}], cols:[{k,label,def(id)}] }
function lineRow(L, r = {}) {
  const id = r.id || L.opts[0]?.id;
  return `<tr><td><select name="l_id" aria-label="${esc(L.label)}">${L.opts.map(o => `<option value="${esc(o.id)}" ${o.id === id ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></td>
    ${L.cols.map(c => `<td><input name="l_${c.k}" type="number" step="any" min="0" aria-label="${esc(c.label)}" value="${esc(r[c.k] ?? (c.def ? c.def(id) : ''))}"></td>`).join('')}
    <td><button type="button" class="x" data-delline aria-label="Remove line">×</button></td></tr>`;
}

export function openForm({ title, fields = [], vals = {}, onSave, lines: L, note = '', live }) {
  const m = $('modal');
  m.innerHTML = `<form class="sheet" novalidate><div class="grabber"></div><div class="sheet-head"><button type="button" class="link" data-close>Cancel</button><h2>${esc(title)}</h2><button class="link strong">Save</button></div>
    <div class="sheet-body"><div class="grid">${fields.map(f => field(f, vals[f.k])).join('')}</div>
    ${L ? `<div class="lines"><table><thead><tr><th>${esc(L.label)}</th>${L.cols.map(c => `<th>${esc(c.label)}</th>`).join('')}<th></th></tr></thead><tbody>${(L.rows.length ? L.rows : [{}]).map(r => lineRow(L, r)).join('')}</tbody></table>
    <button type="button" class="ghost" data-addline>Add line</button></div>` : ''}${live ? '<div class="preview" aria-live="polite"></div>' : ''}${note ? `<p class="note">${note}</p>` : ''}</div></form>`;
  const form = m.querySelector('form');
  form.onclick = e => {
    if (e.target.closest('[data-close]')) m.close();
    if (e.target.closest('[data-addline]')) form.querySelector('tbody').insertAdjacentHTML('beforeend', lineRow(L));
    if (e.target.closest('[data-delline]')) e.target.closest('tr').remove();
  };
  const collect = () => {
    const fd = new FormData(form);
    return fd.getAll('l_id').map((id, i) => Object.fromEntries([['id', id], ...(L?.cols ?? []).map(c => { const v = fd.getAll('l_' + c.k)[i]; return [c.k, v === '' ? '' : +v]; })]))
      .filter(r => !('qty' in r) || r.qty > 0);
  };
  const refresh = () => { if (live) form.querySelector('.preview').innerHTML = live(readForm(form, fields), collect()); };
  form.onchange = e => {
    if (L && e.target.name === 'l_id') {
      const tr = e.target.closest('tr');
      for (const c of L.cols) if (c.def) tr.querySelector(`[name=l_${c.k}]`).value = c.def(e.target.value);
    }
    refresh();
  };
  form.oninput = refresh;
  form.addEventListener('click', () => setTimeout(refresh));
  form.onsubmit = e => {
    e.preventDefault();
    const missing = fields.find(f => f.req && !form.elements[f.k].value.trim());
    if (missing) { form.elements[missing.k].focus(); return; }
    if (onSave(readForm(form, fields), collect()) === false) return;
    m.close();
    commit();
  };
  m.showModal();
  refresh();
  form.querySelector('input:not([readonly]),select')?.focus();
}

// ---------- drawings ----------
export function vessel(t, fill) {
  const cone = /ferment|uni/i.test(t.type), lvl = Math.max(0, Math.min(1, fill));
  const body = cone ? 'M10 4h40v46L30 70 10 50z' : 'M10 4h40v62H10z';
  return `<svg class="vessel" viewBox="0 0 60 76" aria-hidden="true"><defs><clipPath id="v${t.id}"><path d="${body}"/></clipPath></defs>
    <rect x="0" y="${(4 + 66 * (1 - lvl)).toFixed(1)}" width="60" height="76" fill="var(--beer)" clip-path="url(#v${t.id})"/>
    <path d="${body}" fill="none" stroke="var(--steel)" stroke-width="2.5" stroke-linejoin="round"/>
    <text x="30" y="${cone ? 32 : 40}" text-anchor="middle" class="vessel-pct">${Math.round(lvl * 100)}%</text></svg>`;
}

export function curve(points, label) {
  const pts = points.filter(Number.isFinite);
  if (pts.length < 2) return '<p class="note">Log a few gravity readings to see the curve.</p>';
  const hi = Math.max(...pts), lo = Math.min(...pts), span = hi - lo || 0.001, W = 300, H = 64;
  const xy = pts.map((g, i) => `${(i / (pts.length - 1) * W).toFixed(1)},${(6 + (hi - g) / span * (H - 12)).toFixed(1)}`).join(' ');
  return `<svg class="curve" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}"><polyline points="${xy}" fill="none" stroke="var(--orange)" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}

export const bar = (v, max, cls = '') => `<div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, v / (max || 1) * 100))}%"></i></div>`;

// QR via qrcode-generator (loaded from cdnjs). Encodes a link that opens this app on the item.
export function qr(code) {
  const url = `${location.origin}${location.pathname}#scan/${encodeURIComponent(code)}`;
  if (typeof window.qrcode !== 'function') return `<p class="note">QR library did not load. Code: ${esc(code)}</p>`;
  const q = window.qrcode(0, 'M');
  q.addData(url);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}
export const kpi = (value, label, cls = '') => `<div class="kpi ${cls}"><b>${value}</b><span>${label}</span></div>`;
export const metric = (value, label) => `<span class="metric"><b>${value}</b>${esc(label)}</span>`;
export const fmtL = v => `${num(v, 0)} L`;
