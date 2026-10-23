// Brewery setup: brewhouse, hot and cold liquor, cellar. Templates fill it in for common sizes.
import { db, commit, BREWHOUSE_TYPES } from '../store.js';
import { esc, num, uid, toast, today } from '../util.js';
import { head, btn, link, pill, panel, table, field, readForm, openForm, kpi } from '../ui.js';

const BH_FIELDS = [
  { k: 'type', label: 'Brewhouse type', type: 'select', options: BREWHOUSE_TYPES.map(t => ({ v: t, t })) }, { k: 'lengthHL', label: 'Brew length (HL cast out)', type: 'number' },
  { k: 'mashTun', label: 'Mash tun capacity (L)', type: 'number' }, { k: 'lauterTun', label: 'Lauter tun capacity (L, 3 or 4 vessel)', type: 'number' },
  { k: 'kettle', label: 'Kettle capacity (L)', type: 'number' }, { k: 'boilRate', label: 'Boil off (% per hour)', type: 'number' },
  { k: 'boilMins', label: 'Usual boil (minutes)', type: 'number' }, { k: 'deadSpace', label: 'Kettle and whirlpool loss (L)', type: 'number' },
  { k: 'cycleHrs', label: 'Brewhouse cycle (hours per brew)', type: 'number' }, { k: 'hx', label: 'Wort cooler', list: ['Single-stage plate', 'Two-stage plate', 'Immersion'] },
  { k: 'hlt', label: 'Hot liquor tank, HLT (L)', type: 'number' }, { k: 'hltTemp', label: 'HLT set point (°C)', type: 'number' },
  { k: 'clt', label: 'Cold liquor tank, CLT (L)', type: 'number' }, { k: 'cltTemp', label: 'CLT set point (°C)', type: 'number' },
];
const MACHINES = [['EQ-BH', 'Brewhouse', 'Brewhouse', 90], ['EQ-HLT', 'Hot liquor tank', 'Utility', 180], ['EQ-CLT', 'Cold liquor tank', 'Utility', 180], ['EQ-GLY', 'Glycol chiller', 'Utility', 90], ['EQ-CIP', 'CIP skid', 'Cleaning', 30], ['EQ-KW', 'Keg washer', 'Packaging', 60]];
export const TEMPLATES = {
  brewpub5: { label: '5 HL brewpub', note: '2 vessel, 4 × 5 HL fermenters, 2 × 5 HL brite tanks', bh: { type: '2 vessel', lengthHL: 5, mashTun: 750, lauterTun: 0, kettle: 650, whirlpool: true, boilRate: 8, boilMins: 60, deadSpace: 20, cycleHrs: 7, hlt: 1000, hltTemp: 80, clt: 1000, cltTemp: 4, hx: 'Two-stage plate' }, tanks: [['FV', 'Fermenter', 4, 600], ['BBT', 'Brite tank', 2, 500]] },
  brewpub10: { label: '10 HL brewpub', note: '3 vessel, 6 × 10 HL unitanks, 4 × 10 HL serving tanks', bh: { type: '3 vessel', lengthHL: 10, mashTun: 1500, lauterTun: 1500, kettle: 1300, whirlpool: true, boilRate: 7, boilMins: 60, deadSpace: 35, cycleHrs: 6, hlt: 2000, hltTemp: 80, clt: 2000, cltTemp: 4, hx: 'Two-stage plate' }, tanks: [['FV', 'Unitank', 6, 1200], ['ST', 'Serving tank', 4, 1000]] },
  prod20: { label: '20 HL production', note: '4 vessel, 6 × 40 HL fermenters for double brews, 3 × 40 HL brite tanks', bh: { type: '4 vessel', lengthHL: 20, mashTun: 2800, lauterTun: 3000, kettle: 2600, whirlpool: true, boilRate: 6, boilMins: 70, deadSpace: 60, cycleHrs: 5, hlt: 5000, hltTemp: 82, clt: 5000, cltTemp: 3, hx: 'Two-stage plate' }, tanks: [['FV', 'Fermenter', 6, 4200], ['BBT', 'Brite tank', 3, 4000]] },
};
const addTanks = (prefix, type, count, capacity) => {
  let n = 1, made = 0;
  while (made < count) {
    const name = `${prefix}-${n++}`;
    if (db.tanks.some(t => t.name === name)) continue;
    db.tanks.push({ id: uid(), name, type, capacity, hygiene: 'Cleaned', cleanedOn: '' });
    made++;
  }
};
export const brewsPerDay = () => Math.max(1, Math.floor(16 / (db.settings.brewhouse.cycleHrs || 8)));

export const views = {
  setup() {
    const bh = db.settings.brewhouse, cellar = t => db.tanks.filter(x => t.test(x.type));
    const fv = cellar(/ferment|uni/i), bright = cellar(/brite|serving/i), L = (bh.lengthHL || 0) * 100;
    return head('Brewery setup', 'Your brewhouse, hot and cold liquor and cellar. Recipes and planning check every brew against this kit.')
      + panel('Start from a template', `<div class="templates">${Object.entries(TEMPLATES).map(([k, t]) => `<button class="template" data-act="applyTemplate" data-id="${k}"><b>${esc(t.label)}</b><small>${esc(t.note)}</small></button>`).join('')}</div>
        <p class="note">A template fills in the brewhouse and adds any tanks and machines you do not have yet. Nothing is deleted.</p>`)
      + `<div class="kpis four">${kpi(bh.lengthHL ? num(bh.lengthHL) + ' HL' : 'Not set', 'Brew length')}${kpi(fv.length, `Fermenters, ${num(fv.reduce((a, t) => a + t.capacity, 0) / 100)} HL`)}${kpi(bright.length, 'Brite and serving tanks')}${kpi(brewsPerDay(), 'Brews a day (16 h)')}</div>`
      + `<form class="panel" id="setupForm"><div class="panel-head"><h3>Brewhouse and liquor</h3></div><div class="grid">${BH_FIELDS.map(f => field(f, bh[f.k])).join('')}</div>
        <div class="card-acts"><button class="primary">Save brewhouse</button></div></form>`
      + panel('Cellar', table(['Tank', 'Type', { t: 'Capacity', n: 1 }, { t: 'Brew lengths', n: 1 }, 'State'], db.tanks.map(t => `<tr><td><b>${esc(t.name)}</b></td><td>${esc(t.type)}</td><td class="n">${num(t.capacity)} L</td>
          <td class="n">${L ? num(t.capacity / L, 1) : ''}${L && t.capacity >= 2 * L ? ' ' + pill('Double brew', 'info') : ''}</td><td>${pill(t.hygiene, t.hygiene === 'Dirty' ? 'low' : t.hygiene === 'Sanitised' ? 'ok' : 'orange')}</td></tr>`))
        + `<div class="card-acts">${btn('Add tanks', 'bulkTanks', '', 'ghost')}<a class="link" href="#tanks">Manage tanks</a></div>`, '');
  },
};

export const actions = {
  applyTemplate(key) {
    const t = TEMPLATES[key];
    if (!confirm(`Apply the ${t.label} template? The brewhouse settings are replaced. Tanks and machines you already have stay.`)) return;
    db.settings.brewhouse = { ...t.bh };
    for (const [prefix, type, count, cap] of t.tanks) {
      const have = db.tanks.filter(x => x.type === type).length;
      if (have < count) addTanks(prefix, type, count - have, cap);
    }
    for (const [code, name, type, days] of MACHINES) if (!db.equipment.some(e => e.name === name)) db.equipment.push({ id: uid(), code, name, type, lastService: today(), serviceDays: days });
    toast(`${t.label} applied`);
    commit();
  },
  bulkTanks() {
    openForm({ title: 'Add tanks', vals: { type: 'Fermenter', count: 2, capacity: (db.settings.brewhouse.lengthHL || 5) * 120, prefix: 'FV' },
      fields: [{ k: 'type', label: 'Type', type: 'select', options: ['Fermenter', 'Unitank', 'Brite tank', 'Serving tank'].map(t => ({ v: t, t })) }, { k: 'count', label: 'How many', type: 'number', req: 1 },
        { k: 'capacity', label: 'Capacity each (L)', type: 'number', req: 1 }, { k: 'prefix', label: 'Name prefix (FV makes FV-1, FV-2 and so on)' }],
      note: 'Allow about 20% headspace above the brew length for fermentation.',
      onSave: v => {
        if (!(v.count > 0 && v.capacity > 0)) { toast('Enter how many and the capacity'); return false; }
        addTanks((v.prefix || 'T').replace(/[^\w]/g, '').slice(0, 6) || 'T', v.type, Math.min(50, v.count), v.capacity);
        toast(`${Math.min(50, v.count)} tanks added`);
      } });
  },
};

export function saveSetup(form) {
  Object.assign(db.settings.brewhouse, readForm(form, BH_FIELDS));
  commit();
  toast('Brewhouse saved');
}
