// A believable sample brewpub so every screen has something to show.
// Rates and names are illustrative only.
import { uid, daysAgo, addDays, today } from './util.js';

export function demo() {
  const ahead = d => addDays(today(), d);
  const vendors = [
    { id: uid(), name: 'Deccan Malt Supply', gstin: '29AAFCD1111K1Z1', phone: '98450 11111', supplies: 'Malt' },
    { id: uid(), name: 'Hill Hops Traders', gstin: '29AAFCH2222K1Z2', phone: '98450 22222', supplies: 'Hops' },
    { id: uid(), name: 'YeastWorks Bengaluru', gstin: '29AAFCY3333K1Z3', phone: '98450 33333', supplies: 'Yeast and adjuncts' },
    { id: uid(), name: 'Sahyadri Gases', gstin: '29AAFCS4444K1Z4', phone: '98450 44444', supplies: 'CO2 and chemicals' },
  ];
  const [vMalt, vHops, vYeast, vGas] = vendors.map(v => v.id);
  const m = (name, type, unit, qty, reorder, cost, spec = {}) => ({ id: uid(), name, type, unit, qty, reorder, cost, extract: 0, ebc: 0, alpha: 0, atten: 0, expiry: '', qc: 'Approved', vendorId: '', ...spec });
  const materials = [
    m('Pale malt', 'Malt', 'kg', 620, 200, 65, { extract: 309, ebc: 6, vendorId: vMalt, expiry: ahead(240) }),
    m('Wheat malt', 'Malt', 'kg', 180, 60, 80, { extract: 317, ebc: 4, vendorId: vMalt, expiry: ahead(200) }),
    m('Munich malt', 'Malt', 'kg', 90, 40, 90, { extract: 292, ebc: 20, vendorId: vMalt, expiry: ahead(260), lots: [{ id: uid(), date: daysAgo(40), qty: 60, expiry: ahead(200), qc: 'Approved', cost: 90, ref: 'PO-0000' }, { id: uid(), date: daysAgo(1), qty: 30, expiry: ahead(260), qc: 'Pending', cost: 90, ref: 'Direct receipt' }] }),
    m('Crystal 60', 'Malt', 'kg', 30, 20, 110, { extract: 284, ebc: 120, vendorId: vMalt, expiry: ahead(180) }),
    m('Cascade', 'Hops', 'kg', 6, 5, 3200, { alpha: 6.5, vendorId: vHops, expiry: ahead(300) }),
    m('Citra', 'Hops', 'kg', 2, 3, 5200, { alpha: 12, vendorId: vHops, expiry: ahead(280) }),
    m('Saaz', 'Hops', 'kg', 4, 2, 2800, { alpha: 3.5, vendorId: vHops, expiry: ahead(320) }),
    m('Coriander seed', 'Adjunct', 'kg', 3, 1, 300, { vendorId: vYeast, expiry: ahead(150) }),
    m('Orange peel', 'Adjunct', 'kg', 2, 1, 400, { vendorId: vYeast, expiry: ahead(90) }),
    m('US-05 (500 g)', 'Yeast', 'pack', 6, 3, 6000, { atten: 78, vendorId: vYeast, expiry: ahead(20) }),
    m('WB-06 (500 g)', 'Yeast', 'pack', 4, 2, 6200, { atten: 75, vendorId: vYeast, expiry: ahead(120) }),
    m('W-34/70 (500 g)', 'Yeast', 'pack', 2, 4, 6800, { atten: 82, vendorId: vYeast, expiry: ahead(150) }),
    m('CO2', 'Gas', 'kg', 60, 20, 40, { vendorId: vGas }),
    m('Caustic soda', 'Chemical', 'kg', 25, 10, 120, { vendorId: vGas }),
    m('Phosphoric acid', 'Chemical', 'L', 15, 5, 300, { vendorId: vGas }),
    m('Peracetic sanitiser', 'Chemical', 'L', 4, 5, 450, { vendorId: vGas }),
  ];
  const M = n => materials.find(x => x.name.startsWith(n)).id;
  const r = (name, style, items, version = 1, history = []) => ({
    id: uid(), name, style, size: 500, boilLoss: 40, trubLoss: 20, packLoss: 3, version, updated: daysAgo(40), history,
    items: items.map(([n, qty, time = '']) => ({ id: M(n), qty, price: 0, time })),
  });
  const ipaItems = [['Pale malt', 130], ['Crystal 60', 8], ['Cascade', 1.5, 60], ['Cascade', 1.5, 10], ['Citra', 1.5, 0], ['US-05', 1]];
  const recipes = [
    r('Indiranagar IPA', 'American IPA', ipaItems, 2, [{ version: 1, date: daysAgo(90), snap: { name: 'Indiranagar IPA', style: 'American IPA', size: 500, items: ipaItems.map(([n, qty, time = '']) => ({ id: M(n), qty: n === 'Crystal 60' ? 10 : qty, price: 0, time })) } }]),
    r('Monsoon Wit', 'Witbier', [['Pale malt', 55], ['Wheat malt', 55], ['Saaz', 1, 60], ['Coriander', 0.5, 5], ['Orange peel', 0.5, 5], ['WB-06', 1]]),
    r('Helles Lager', 'Munich Helles', [['Pale malt', 100], ['Munich malt', 20], ['Saaz', 1.5, 60], ['Saaz', 1, 15], ['W-34/70', 2]]),
  ];
  const [ipa, wit, helles] = recipes;
  const cost = id => materials.find(x => x.id === id).cost;
  const issues = (rc, vol) => rc.items.map(i => ({ id: i.id, qty: +(i.qty * vol / rc.size).toFixed(3), cost: +(i.qty * vol / rc.size * cost(i.id)).toFixed(2) }));

  const tanks = [['FV-1', 'Fermenter', 600], ['FV-2', 'Fermenter', 600], ['FV-3', 'Fermenter', 600], ['FV-4', 'Unitank', 600], ['BBT-1', 'Brite tank', 500], ['BBT-2', 'Brite tank', 500]]
    .map(([name, type, capacity]) => ({ id: uid(), name, type, capacity, hygiene: 'Cleaned', cleanedOn: '' }));
  const T = n => tanks.find(t => t.name === n).id;
  const curve = (start, og, fg, days, temp) => Array.from({ length: days }, (_, i) => ({ date: daysAgo(start - i), gravity: +(fg + (og - fg) * Math.exp(-i / 2.2)).toFixed(3), temp, ph: i === 0 ? 5.2 : '', note: i === 0 ? 'Pitched' : '' }));
  const b = (code, rc, date, status, volume, og, fg, tank, extra = {}) => ({
    id: uid(), code, recipeId: rc.id, recipeVersion: rc.version, date, status, volume, og, fg, tankId: T(tank), notes: '', readyDate: '', dutyRate: 0, dutyL: 0, transfers: [],
    issued: status !== 'Planned', issues: status !== 'Planned' ? issues(rc, volume) : [], log: [], brew: { mashTemp: '', preBoil: '', og: '', volume: '', pitchTemp: '', notes: '' }, ...extra,
  });
  const batches = [
    b('B-001', ipa, daysAgo(34), 'Ready', 500, 1.058, 1.013, 'BBT-1', { readyDate: daysAgo(14), dutyRate: 50, dutyL: 486, transfers: [{ date: daysAgo(16), fromId: T('FV-1'), toId: T('BBT-1'), litresOut: 492, litresIn: 486 }], log: curve(33, 1.058, 1.013, 12, 19), brew: { mashTemp: 66.5, preBoil: 1.049, og: 1.058, volume: 500, pitchTemp: 18, notes: 'Smooth brew day' } }),
    b('B-002', wit, daysAgo(18), 'Ready', 495, 1.049, 1.012, 'BBT-2', { readyDate: daysAgo(3), dutyRate: 50, dutyL: 483, transfers: [{ date: daysAgo(4), fromId: T('FV-3'), toId: T('BBT-2'), litresOut: 488, litresIn: 483 }], log: curve(17, 1.049, 1.012, 10, 20), brew: { mashTemp: 67, preBoil: 1.042, og: 1.049, volume: 495, pitchTemp: 19, notes: '' } }),
    b('B-003', helles, daysAgo(10), 'Conditioning', 505, 1.052, 1.010, 'FV-2', { log: curve(9, 1.052, 1.010, 10, 11), brew: { mashTemp: 64, preBoil: 1.045, og: 1.052, volume: 505, pitchTemp: 10, notes: 'Mash ran cold, HLT element tripped' } }),
    b('B-004', ipa, daysAgo(3), 'Fermenting', 480, 1.053, 1.013, 'FV-1', { log: curve(2, 1.053, 1.013, 3, 19), brew: { mashTemp: 66, preBoil: 1.045, og: 1.053, volume: 480, pitchTemp: 18, notes: 'Short on volume, sparge stuck' } }),
    b('B-005', wit, ahead(4), 'Planned', 500, 0, 0, 'FV-3'),
  ];
  const B = c => batches.find(x => x.code === c).id;
  Object.assign(tanks.find(t => t.name === 'FV-3'), { hygiene: 'Dirty', cleanedOn: daysAgo(19) });
  Object.assign(tanks.find(t => t.name === 'FV-4'), { hygiene: 'Sanitised', cleanedOn: daysAgo(2) });
  const chem = n => materials.find(x => x.name === n).id;
  const cip = (date, tk, cycle, chemName, chemQty, result = 'Pass', note = '') => ({ id: uid(), date, targetId: T(tk), cycle, conc: cycle === 'Sanitiser' ? 0.2 : 2, temp: cycle === 'Sanitiser' ? 20 : 75, mins: cycle === 'Sanitiser' ? 15 : 45, chemicalId: chem(chemName), chemQty, operator: 'Ravi', result, note });
  const cipLog = [
    cip(daysAgo(19), 'FV-3', 'Full CIP', 'Caustic soda', 1.5), cip(daysAgo(17), 'BBT-1', 'Sanitiser', 'Peracetic sanitiser', 0.5),
    cip(daysAgo(11), 'FV-2', 'Full CIP', 'Caustic soda', 1.5), cip(daysAgo(6), 'BBT-2', 'Sanitiser', 'Peracetic sanitiser', 0.5, 'Fail', 'ATP swab 480 RLU, limit 150'),
    cip(daysAgo(5), 'BBT-2', 'Full CIP', 'Caustic soda', 1.5), cip(daysAgo(4), 'FV-1', 'Full CIP', 'Caustic soda', 1.5), cip(daysAgo(2), 'FV-4', 'Full CIP', 'Caustic soda', 1.5),
  ];
  const loss = (date, code, stage, litres, reason) => ({ id: uid(), date, batchId: B(code), stage, litres, reason });
  const losses = [
    loss(daysAgo(16), 'B-001', 'Fermentation', 8, 'Left in fermenter (yeast and trub)'), loss(daysAgo(16), 'B-001', 'Transfer', 6, 'FV-1 to BBT-1'),
    loss(daysAgo(14), 'B-001', 'Unexplained', 2, 'ST-0001: Miscount'), loss(daysAgo(13), 'B-001', 'Packaging', 3, 'Can 330 ml run'), loss(daysAgo(3), 'B-001', 'Taproom', 10, 'Line flush'),
    loss(daysAgo(4), 'B-002', 'Fermentation', 7, 'Left in fermenter (yeast and trub)'), loss(daysAgo(4), 'B-002', 'Transfer', 5, 'FV-3 to BBT-2'),
    loss(daysAgo(4), 'B-003', 'Fermentation', 12, 'Yeast dump'),
  ];

  const customers = [
    { id: uid(), name: 'Koramangala Social', type: 'Bar', gstin: '29AAACK1234L1Z2', phone: '98860 12345', city: 'Bengaluru' },
    { id: uid(), name: 'Whitefield Taproom', type: 'Bar', gstin: '29AAACW5678L1Z3', phone: '98860 67890', city: 'Bengaluru' },
    { id: uid(), name: 'Hoppers Wine Shop', type: 'Retail', gstin: '29AAACH9012L1Z4', phone: '98860 24680', city: 'Mysuru' },
  ];
  const [kora, white] = customers.map(c => c.id);
  const kegs = Array.from({ length: 12 }, (_, i) => ({ id: uid(), code: `K-${String(i + 1).padStart(3, '0')}`, size: i >= 10 ? 50 : 30, status: 'Empty', batchId: '', customerId: '', since: daysAgo(20) }));
  const K = c => kegs.find(k => k.code === c);
  Object.assign(K('K-001'), { status: 'At customer', customerId: white, since: daysAgo(35) });
  for (const c of ['K-002', 'K-003']) Object.assign(K(c), { status: 'At customer', batchId: B('B-001'), customerId: kora, since: daysAgo(12) });
  Object.assign(K('K-004'), { status: 'Filled', batchId: B('B-001'), since: daysAgo(13) });
  for (const c of ['K-005', 'K-006']) Object.assign(K(c), { status: 'Filled', batchId: B('B-002'), since: daysAgo(2) });
  Object.assign(K('K-007'), { status: 'Cleaning', since: daysAgo(1) });

  const packs = [
    { id: uid(), batchId: B('B-001'), date: daysAgo(13), format: 'Keg 30 L', unitL: 30, units: 3, kegIds: ['K-002', 'K-003', 'K-004'].map(c => K(c).id) },
    { id: uid(), batchId: B('B-001'), date: daysAgo(13), format: 'Can 330 ml', unitL: 0.33, units: 240, kegIds: [] },
    { id: uid(), batchId: B('B-002'), date: daysAgo(2), format: 'Keg 30 L', unitL: 30, units: 2, kegIds: ['K-005', 'K-006'].map(c => K(c).id) },
  ];
  const dispatches = [{
    id: uid(), no: 'D-0001', date: daysAgo(12), customerId: kora, lines: [
      { ref: 'k:' + K('K-002').id, label: 'Keg K-002 · Indiranagar IPA B-001', qty: 1, litres: 30 },
      { ref: 'k:' + K('K-003').id, label: 'Keg K-003 · Indiranagar IPA B-001', qty: 1, litres: 30 },
      { ref: 'p:' + packs[1].id, label: 'Can 330 ml · Indiranagar IPA B-001', qty: 120, litres: 39.6 },
    ],
  }];

  const p = (name, kind, rc, ml, price) => ({ id: uid(), name, kind, recipeId: rc?.id || '', ml, price });
  const products = [
    p('IPA pint 330 ml', 'beer', ipa, 330, 350), p('IPA 500 ml', 'beer', ipa, 500, 450), p('IPA growler 2 L', 'beer', ipa, 2000, 1600),
    p('Wit pint 330 ml', 'beer', wit, 330, 320), p('Helles pint 330 ml', 'beer', helles, 330, 300),
    p('Peri peri fries', 'food', null, 0, 280), p('Chicken wings', 'food', null, 0, 420), p('Paneer tikka', 'food', null, 0, 360),
  ];
  const line = (pr, qty) => ({ pid: pr.id, name: pr.name, kind: pr.kind, qty, price: pr.price });
  const sales = Array.from({ length: 12 }, (_, i) => {
    const day = 12 - i, lines = [line(products[0], 24 + (i % 4) * 3), line(products[2], 1 + (i % 2)), line(products[5], 6), line(products[6], 4)];
    if (day <= 3) lines.push(line(products[3], 18 + i % 3));
    return { id: uid(), no: `HM-${String(i + 1).padStart(4, '0')}`, date: daysAgo(day), customer: i % 5 === 0 ? 'Koramangala Social' : 'Walk-in', gstin: i % 5 === 0 ? '29AAACK1234L1Z2' : '', vat: 10, gst: 5, lines };
  });

  return {
    settings: { name: 'Hoppy Monk Brewpub', gstin: '29ABCDE1234F1Z5', address: '12, 100 Feet Road, Indiranagar, Bengaluru 560038', state: 'Karnataka', prefix: 'HM', exciseRate: 50, vat: 10, foodGst: 5, efficiency: 72, cipDays: 3, lossTarget: 5, lossAllow: 2, exciseBasis: 'Ready', tradeRateL: 260, lastBackup: daysAgo(2) },
    seq: { batch: 6, inv: sales.length + 1, po: 2, disp: 2, keg: 13, count: 2 },
    materials, recipes, products, tanks, batches, sales, kegs, customers, vendors, packs, dispatches,
    equipment: [
      { id: uid(), code: 'EQ-01', name: '5 HL brewhouse', type: 'Brewhouse', lastService: daysAgo(80), serviceDays: 90 },
      { id: uid(), code: 'EQ-02', name: 'Glycol chiller', type: 'Utility', lastService: daysAgo(100), serviceDays: 90 },
      { id: uid(), code: 'EQ-03', name: 'CIP skid', type: 'Cleaning', lastService: daysAgo(10), serviceDays: 30 },
      { id: uid(), code: 'EQ-04', name: 'Keg washer', type: 'Packaging', lastService: daysAgo(25), serviceDays: 60 },
    ],
    pos: [{ id: uid(), no: 'PO-0001', date: daysAgo(2), vendorId: vHops, status: 'Open', lines: [{ id: M('Citra'), qty: 5, price: 5200, time: '' }] }],
    tasks: [
      { id: uid(), title: 'Brew Monsoon Wit (B-005)', type: 'Brewing', date: ahead(4), assignee: 'Ravi', status: 'Open' },
      { id: uid(), title: 'Fill kegs from B-003', type: 'Filling', date: ahead(3), assignee: 'Meera', status: 'Open' },
      { id: uid(), title: 'Deliver kegs to Whitefield Taproom', type: 'Dispatch', date: ahead(1), assignee: 'Arjun', status: 'Open' },
      { id: uid(), title: 'CIP FV-3 before brew day', type: 'Cleaning', date: ahead(3), assignee: 'Ravi', status: 'Open' },
      { id: uid(), title: 'Glycol chiller service', type: 'Maintenance', date: today(), assignee: 'Vendor', status: 'Open' },
      { id: uid(), title: 'Collect K-001 from Whitefield Taproom', type: 'Dispatch', date: daysAgo(1), assignee: 'Arjun', status: 'Open' },
      { id: uid(), title: 'Dry hop B-004', type: 'Brewing', date: daysAgo(1), assignee: 'Meera', status: 'Done' },
    ],
    utilities: [
      { id: uid(), date: daysAgo(15), type: 'Electricity', qty: 1800, unit: 'kWh', cost: 16200 },
      { id: uid(), date: daysAgo(15), type: 'Water', qty: 40, unit: 'kL', cost: 4000 },
      { id: uid(), date: daysAgo(15), type: 'LPG / PNG', qty: 120, unit: 'kg', cost: 10800 },
      { id: uid(), date: daysAgo(8), type: 'CO2', qty: 50, unit: 'kg', cost: 2000 },
    ],
    wastage: [{ id: uid(), date: daysAgo(9), kind: 'Material', ref: M('Crystal 60'), qty: 2, reason: 'Damp bag' }],
    cip: cipLog, losses,
    counts: [{ id: 'st0001', no: 'ST-0001', date: daysAgo(14), status: 'Posted', lines: [
      { ref: 'm:' + M('Pale malt'), label: 'Pale malt', unit: 'kg', system: 700, counted: 698, cost: 65, reason: 'Spillage' },
      { ref: 'm:' + M('Cascade'), label: 'Cascade', unit: 'kg', system: 7, counted: 7, cost: 3200, reason: '' },
      { ref: 'b:' + B('B-001'), label: 'BBT-1 · B-001 Indiranagar IPA', unit: 'L', system: 486, counted: 484, cost: 67.48, reason: 'Miscount' },
      { ref: 'b:' + B('B-002'), label: 'FV-3 · B-002 Monsoon Wit', unit: 'L', system: 495, counted: 495, cost: 35.72, reason: '' },
      { ref: 'k:all', label: 'Kegs owned, all states', unit: 'kegs', system: 12, counted: 12, cost: 0, reason: '' },
    ] }],
    adjustments: [
      { id: uid(), date: daysAgo(14), countId: 'st0001', ref: 'm:' + M('Pale malt'), label: 'Pale malt', delta: -2, value: -130, reason: 'Spillage' },
      { id: uid(), date: daysAgo(14), countId: 'st0001', ref: 'b:' + B('B-001'), label: 'BBT-1 · B-001 Indiranagar IPA', delta: -2, value: -134.96, reason: 'Miscount' },
    ],
  };
}
