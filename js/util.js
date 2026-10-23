// Small shared helpers. No DOM state lives here apart from the toast.
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

export const uid = () => Math.random().toString(36).slice(2, 9);
export const today = () => iso(new Date());
export const addDays = (date, d) => iso(new Date(new Date(date + 'T12:00').getTime() + d * 864e5));
export const daysAgo = d => addDays(today(), -d);
export const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 864e5);
export const pad = (n, w) => String(n).padStart(w, '0');
export const sum = (arr, f = x => x) => arr.reduce((a, x) => a + (+f(x) || 0), 0);
// ABV from gravities (Hall's formula, closer than 131.25 x difference at higher gravities).
export const abv = (og, fg) => (og > fg && fg > 0 ? 76.08 * (og - fg) / (1.775 - og) * (fg / 0.794) : 0);
// Plato and specific gravity at 20 C.
export const sgFromP = p => 1 + p / (258.6 - (p / 258.2) * 227.1);
export const pFromSg = sg => (sg > 1 ? -616.868 + 1111.14 * sg - 630.272 * sg * sg + 135.997 * sg ** 3 : 0);
// Solve extract kg = litres x SG x Plato / 100 for Plato.
export function platoOf(extractKg, litres) {
  if (!(extractKg > 0) || !(litres > 0)) return 0;
  let p = 10;
  for (let i = 0; i < 10; i++) p = 100 * extractKg / (litres * sgFromP(p));
  return p;
}
export const $ = id => document.getElementById(id);

export const inr = n => '₹' + (+n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const inr0 = n => '₹' + Math.round(+n || 0).toLocaleString('en-IN');
export const num = (n, d = 1) => (+n || 0).toLocaleString('en-IN', { maximumFractionDigits: d });
export const sg = n => (+n || 0).toFixed(3);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtDate = d => d ? new Date(d + 'T12:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';

// CSV for spreadsheets. Text cells that start like a formula are prefixed so Excel shows them as text.
export function downloadCsv(name, header, rows) {
  const cell = v => {
    let t = String(v ?? '');
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + [header, ...rows].map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' }));
  a.download = `${name}-${today()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('on'), 2800);
}
