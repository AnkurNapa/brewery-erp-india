// One test per user flow, run against the demo brewpub.
import { test, expect } from '@playwright/test';

const dialogs = new WeakMap();
async function fresh(page, hash = 'dash', consentChoice = 'denied') {
  const seen = [];
  if (consentChoice) await page.addInitScript(c => localStorage.setItem('brewhouse-consent', c), consentChoice);
  dialogs.set(page, seen);
  page.on('dialog', d => { seen.push(d.message()); d.accept(); });
  await page.goto('/#' + hash);
  await page.evaluate(async () => { const s = await import('/js/store.js'); const d = await import('/js/demo.js'); s.replace(d.demo()); s.commit(); });
  await expect(page.locator('main h1')).toBeVisible();
}
const run = (page, fn, arg) => page.evaluate(fn, arg);
const db = (page, fn) => page.evaluate(`import('/js/store.js').then(s => (${fn})(s.db))`);
async function sheet(page, fill = {}) {
  for (const [k, v] of Object.entries(fill)) {
    const el = page.locator(`#modal [name="${k}"]`).first();
    if (await el.evaluate(e => e.tagName) === 'SELECT') await el.selectOption(String(v)); else await el.fill(String(v));
  }
  await page.locator('#modal .sheet-head button.strong').click();
}
const go = (page, hash) => page.evaluate(h => { location.hash = h; }, hash);

test('1 first run: an empty brewery gets a setup card', async ({ page }) => {
  await fresh(page, 'settings');
  await page.getByRole('button', { name: 'Start empty' }).click();
  await go(page, 'dash');
  await expect(page.getByText('Get started')).toBeVisible();
  await page.getByRole('link', { name: 'Set up brewery' }).click();
  await page.locator('[data-act="applyTemplate"][data-id="brewpub10"]').click();
  await go(page, 'dash');
  await expect(page.locator('.setup li.done')).toHaveCount(1);
});

test('1b demo bar: hides for the visit, start clears demo figures and opens setup', async ({ page }) => {
  await fresh(page);
  const bar = page.locator('.demo-bar');
  await expect(bar).toBeVisible();
  await page.getByRole('button', { name: 'Keep exploring' }).click();
  await expect(bar).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Start my brewery' }).click();
  await expect(page).toHaveURL(/#setup$/);
  const s = await db(page, d => ({ batches: d.batches.length, gstin: d.settings.gstin, excise: d.settings.exciseRate, vat: d.settings.vat, len: d.settings.brewhouse.lengthHL }));
  expect(s).toEqual({ batches: 0, gstin: '', excise: 0, vat: 0, len: 0 });
  await go(page, 'dash');
  await expect(bar).toHaveCount(0);
});

test('2 masters: add a customer', async ({ page }) => {
  await fresh(page, 'partners');
  await page.getByRole('button', { name: 'Add customer' }).click();
  await sheet(page, { name: 'Brewdog Bar', city: 'Pune' });
  await expect(page.getByText('Brewdog Bar')).toBeVisible();
});

test('3 recipe: live calculation and versions', async ({ page }) => {
  await fresh(page, 'recipes');
  await page.locator('[data-act="editRec"]').first().click();
  await expect(page.locator('#modal .preview')).toContainText('OG');
  await sheet(page);
  await expect(page.locator('#modal[open]')).toBeVisible();
  await sheet(page, { note: 'More late hops' });
  expect(await db(page, d => d.recipes[0].version)).toBe(3);
  expect(await db(page, d => d.recipes[0].note)).toBe('More late hops');
  expect(await db(page, d => d.recipes[0].history.length)).toBe(2);
});

test('4 plan a brew: reserves stock in a fit tank', async ({ page }) => {
  await fresh(page, 'calendar');
  await page.locator('[data-act="planBrew"]').first().click();
  const b = await db(page, d => { const b = d.batches.at(-1); return { status: b.status, tank: d.tanks.find(t => t.id === b.tankId)?.name }; });
  expect(b).toEqual({ status: 'Planned', tank: 'FV-4' });
  expect(await run(page, async () => (await import('/js/calc.js')).reserved((await import('/js/store.js')).db.materials[0].id))).toBeGreaterThan(0);
});

test('5 brew day: issue stock, close task, flag deviations', async ({ page }) => {
  await fresh(page, 'calendar');
  await page.locator('[data-act="planBrew"]').first().click();
  const r = await run(page, async () => {
    const s = await import('/js/store.js'), brew = await import('/js/views/brew.js'), c = await import('/js/calc.js');
    const b = s.db.batches.at(-1), pale = s.db.materials.find(m => m.name === 'Pale malt'), q0 = pale.qty;
    brew.setStatus(b.id, 'Brewing');
    b.brew = { mashTemp: '', steps: [70], preBoil: '', og: 1.040, volume: 500, pitchTemp: 18, notes: '' };
    return { issued: b.issued, used: q0 - pale.qty, task: s.db.tasks.find(k => k.title.includes(`(${b.code})`)).status, dev: c.deviations(b).length };
  });
  expect(r.issued).toBe(true);
  expect(r.used).toBeGreaterThan(0);
  expect(r.task).toBe('Done');
  expect(r.dev).toBe(2);
});

test('6 fermentation: a reading updates gravity', async ({ page }) => {
  await fresh(page, 'tanks');
  await page.locator('[data-act="logReading"]').first().click();
  await sheet(page, { gravity: '1.020', temp: '19' });
  expect(await db(page, d => d.batches.find(b => b.code === 'B-004').fg)).toBe(1.02);
});

test('7 transfer: loss recorded, old tank dirty, capacity enforced', async ({ page }) => {
  await fresh(page, 'tanks');
  await page.locator('[data-act="transfer"]').first().click();
  await sheet(page, { litresIn: 9999, litresOut: 99999 });
  await expect(page.locator('#modal[open]')).toBeVisible();
  await sheet(page, { litresOut: 470, litresIn: 465 });
  const r = await db(page, d => { const b = d.batches.find(x => x.code === 'B-004'); return { tank: d.tanks.find(t => t.id === b.tankId).name, fv1: d.tanks.find(t => t.name === 'FV-1').hygiene, losses: d.losses.filter(l => l.batchId === b.id).map(l => l.stage).sort() }; });
  expect(r.tank).not.toBe('FV-1');
  expect(r.fv1).toBe('Dirty');
  expect(r.losses).toEqual(['Fermentation', 'Transfer']);
});

test('8 CIP: pass sanitises, fail dirties, dirty tank warns on fill', async ({ page }) => {
  await fresh(page, 'cip');
  const fv3 = await db(page, d => d.tanks.find(t => t.name === 'FV-3').id);
  await run(page, async id => (await import('/js/views/brew.js')).setStatus((await import('/js/store.js')).db.batches.find(b => b.code === 'B-005').id, 'Brewing'), fv3);
  expect(dialogs.get(page).some(m => m.includes('FV-3 is dirty'))).toBe(true);
  await page.locator('[data-act="logCip"]').first().click();
  await sheet(page, { cycle: 'Full CIP', chemQty: 1 });
  await page.locator('[data-act="logCip"]').first().click();
  await sheet(page, { targetId: await db(page, d => d.tanks.find(t => t.name === 'FV-4').id), cycle: 'Sanitiser', result: 'Fail' });
  expect(await db(page, d => d.tanks.find(t => t.name === 'FV-4').hygiene)).toBe('Dirty');
});

test('9 excise: booked at Ready, or on removal when set', async ({ page }) => {
  await fresh(page, 'batches');
  const r = await run(page, async () => {
    const s = await import('/js/store.js'), brew = await import('/js/views/brew.js');
    const b3 = s.db.batches.find(b => b.code === 'B-003');
    const pass = { abv: 5, ph: 4.3, sensory: 'Clean', result: 'Pass', by: 'QC', date: '2026-01-01' };
    s.db.batches.filter(b => ['B-003', 'B-004'].includes(b.code)).forEach(b => { b.release = pass; });
    brew.setStatus(b3.id, 'Ready');
    s.db.settings.exciseBasis = 'Removal';
    const b4 = s.db.batches.find(b => b.code === 'B-004');
    brew.setStatus(b4.id, 'Ready');
    return { ready: b3.dutyRate, dutyL: b3.dutyL, removal: b4.dutyRate };
  });
  expect(r).toEqual({ ready: 50, dutyL: 493, removal: 0 });
  // Beer already taxed at Ready is not taxed again when poured after the switch to Removal.
  await go(page, 'sales');
  await page.getByRole('button', { name: 'New invoice' }).click();
  await sheet(page);
  expect(await db(page, d => d.sales.at(-1).duty)).toBe(0);
  // Beer that was never taxed at Ready pays duty as it leaves.
  await run(page, async () => { const s = await import('/js/store.js'); s.db.batches.forEach(b => { b.dutyRate = 0; }); s.commit(); });
  await page.getByRole('button', { name: 'New invoice' }).click();
  await sheet(page);
  expect(await db(page, d => d.sales.at(-1).duty)).toBeGreaterThan(0);
});

test('10 packaging: capped at tank litres, extra draw is a loss', async ({ page }) => {
  await fresh(page, 'packaging');
  const b1 = await db(page, d => d.batches.find(b => b.code === 'B-001').id);
  await page.getByRole('button', { name: 'Package beer' }).click();
  await sheet(page, { batchId: b1, format: 'Can 330 ml', units: 100, drawn: 9999 });
  await expect(page.locator('#toast')).toContainText('left in the tank');
  await sheet(page, { drawn: 35 });
  expect(await db(page, d => d.losses.filter(l => l.stage === 'Packaging').length)).toBe(2);
});

test('11 taproom sale: saves, warns when a beer is out', async ({ page }) => {
  await fresh(page, 'sales');
  const helles = await db(page, d => d.products.find(p => p.name.startsWith('Helles')).id);
  await page.getByRole('button', { name: 'New invoice' }).click();
  await sheet(page, { l_id: helles, l_qty: 2 });
  expect(dialogs.get(page).some(m => m.includes('Not enough beer on tap'))).toBe(true);
  expect(await db(page, d => d.sales.at(-1).lines[0].name)).toContain('Helles');
});

test('12 trade dispatch: invoice raised, tap stock untouched', async ({ page }) => {
  await fresh(page, 'dispatch');
  const before = await run(page, async () => (await import('/js/calc.js')).beerStock().map(s => +s.draught.toFixed(2)));
  await page.getByRole('button', { name: 'New dispatch' }).click();
  await sheet(page);
  const r = await db(page, d => { const x = d.dispatches.at(-1), inv = d.sales.find(s => s.id === x.invoiceId); return { linked: inv?.dispatchId === x.id, vat: inv?.vat, total: inv?.lines[0].price }; });
  expect(r.linked).toBe(true);
  expect(r.total).toBeGreaterThan(0);
  expect(await run(page, async () => (await import('/js/calc.js')).beerStock().map(s => +s.draught.toFixed(2)))).toEqual(before);
});

test('13 keg return: collect list, pick up, wash logs CIP', async ({ page }) => {
  await fresh(page, 'dispatch');
  await expect(page.getByText('Kegs to collect')).toBeVisible();
  await page.locator('.collect [data-act="kegPickup"]').first().click();
  await go(page, 'scan/K-001');
  await page.getByRole('button', { name: 'Cleaned, now empty' }).click();
  await sheet(page);
  const r = await db(page, d => ({ keg: d.kegs.find(k => k.code === 'K-001').status, cip: d.cip.at(-1).note }));
  expect(r).toEqual({ keg: 'Empty', cip: 'Keg K-001' });
});

test('14 purchasing: MRP, receive into pending lot, approve', async ({ page }) => {
  await fresh(page, 'purchasing');
  await page.getByRole('button', { name: 'Raise POs from plan' }).click();
  const po = await run(page, async () => { const s = await import('/js/store.js'), c = await import('/js/calc.js'); const p = s.db.pos.find(x => x.status === 'Open'); return { no: p.no, a0: c.approvedQty(s.db.materials.find(x => x.id === p.lines[0].id)) }; });
  await page.locator('tr', { hasText: po.no }).getByRole('button', { name: 'Receive' }).click();
  await sheet(page);
  const r = await run(page, async ([no, a0]) => {
    const s = await import('/js/store.js'), c = await import('/js/calc.js');
    const p = s.db.pos.find(x => x.no === no), m = s.db.materials.find(x => x.id === p.lines[0].id);
    const pending = c.pendingLots(m).length, a1 = c.approvedQty(m);
    c.pendingLots(m).forEach(l => { l.qc = 'Approved'; });
    return { pending, same: a0 === a1, after: c.approvedQty(m) > a1, status: p.status };
  }, [po.no, po.a0]);
  expect(r.status).toBe('Received');
  expect(r.pending).toBeGreaterThan(0);
  expect(r.same).toBe(true);
  expect(r.after).toBe(true);
});

test('15 beer losses: recorded and flagged over target', async ({ page }) => {
  await fresh(page, 'tanks');
  await page.locator('[data-act="recordLoss"]').first().click();
  await sheet(page, { stage: 'Dump', litres: 5, reason: 'Trub dump' });
  await go(page, 'losses');
  await expect(page.locator('main')).toContainText('Trub dump');
  expect(await run(page, async () => (await import('/js/calc.js')).alerts().some(a => a.text.includes('B-001 has lost')))).toBe(true);
});

test('16 stock take: blind count, reasons required, books balance', async ({ page }) => {
  await fresh(page, 'stocktake');
  await page.getByRole('button', { name: 'New count' }).click();
  await expect(page.locator('main')).not.toContainText('System');
  const diff = await run(page, async () => { const s = await import('/js/store.js'), c = await import('/js/calc.js'); const r = c.beerReconcile(s.db.counts.at(-1)); return Math.abs(r.counted - r.expected); });
  expect(diff).toBeLessThan(0.1);
  const first = page.locator('.count-in').first();
  await first.fill('1');
  await page.getByRole('button', { name: 'Post adjustments' }).click();
  await expect(page.locator('#toast')).toContainText('Add a reason');
  await page.locator('.reason-in').first().fill('Miscount');
  await page.getByRole('button', { name: 'Post adjustments' }).click();
  expect(await db(page, d => d.counts.at(-1).status)).toBe('Posted');
});

test('17 maintenance: servicing clears the alert', async ({ page }) => {
  await fresh(page, 'equipment');
  const has = () => run(page, async () => (await import('/js/calc.js')).alerts().some(a => a.text.startsWith('Glycol chiller service')));
  expect(await has()).toBe(true);
  await page.locator('tr', { hasText: 'Glycol chiller' }).getByRole('button', { name: 'Serviced today' }).click();
  await sheet(page, { note: 'Refrigerant topped up', cost: 4500 });
  expect(await has()).toBe(false);
  expect(await db(page, d => d.equipment.find(e => /Glycol/.test(e.name)).log.at(-1))).toMatchObject({ kind: 'Service', cost: 4500 });
});

test('18 utilities: a bill raises cost per litre', async ({ page }) => {
  await fresh(page, 'records');
  const util = () => run(page, async () => (await import('/js/calc.js')).cogs()[0].util);
  const u0 = await util();
  await page.getByRole('button', { name: 'Record utility' }).click();
  await sheet(page, { cost: 50000 });
  expect(await util()).toBeGreaterThan(u0);
});

test('19 month end: CSV downloads', async ({ page }) => {
  await fresh(page, 'tax');
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Excise CSV' }).click()]);
  expect(file.suggestedFilename()).toMatch(/^excise-register-.*\.csv$/);
  const [vat] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'VAT and GST CSV' }).click()]);
  expect(vat.suggestedFilename()).toMatch(/^vat-gst-monthly/);
});

test('20 backup: export stamps the date, a tampered import runs nothing', async ({ page }) => {
  await fresh(page, 'settings');
  await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export backup' }).click()]);
  expect(await db(page, d => d.settings.lastBackup)).toBe(await page.evaluate(async () => (await import('/js/util.js')).today()));
  const pwned = await run(page, async () => {
    const s = await import('/js/store.js'), evil = JSON.parse(JSON.stringify(s.db)), p = '"><img src=x onerror=window.__pwned=1>';
    Object.assign(evil.batches[0], { id: p, date: p, status: p }); evil.materials[0].name = p; evil.tasks[0].type = p;
    s.replace(s.clean(evil)); s.commit();
    for (const v of ['dash', 'batches', 'materials', 'calendar', 'tax']) { location.hash = v; await new Promise(r => setTimeout(r, 50)); }
    return !!window.__pwned || document.querySelectorAll('main img').length > 0;
  });
  expect(pwned).toBe(false);
});

test('21 navigate: search, open, back', async ({ page }) => {
  await fresh(page, 'tanks');
  await page.locator('#q').fill('B-001');
  await page.locator('#results a').first().click();
  await expect(page.locator('main h1')).toContainText('B-001');
  await page.locator('[data-back]').click();
  await expect(page.locator('main h1')).toHaveText('Tanks');
});

test('22 help: every role has linked steps', async ({ page }) => {
  await fresh(page, 'help');
  for (const role of ['Manager', 'Brewer', 'Packaging', 'Stores', 'Taproom', 'Driver', 'Accounts']) {
    await page.getByRole('tab', { name: role }).click();
    expect(await page.locator('.help-step').count()).toBeGreaterThan(0);
  }
});

test('23 recipe editor: minutes only for boil and whirlpool hops', async ({ page }) => {
  await fresh(page, 'recipes');
  await page.locator('[data-act="editRec"]').first().click();
  const rows = page.locator('#modal .lines tbody tr');
  await expect(rows.nth(0).locator('input[name="l_time"]')).toHaveAttribute('type', 'hidden');
  await expect(rows.nth(2).locator('input[name="l_time"]')).toHaveAttribute('type', 'number');
  await rows.nth(2).locator('select[name="l_use"]').selectOption('Dry hop');
  await expect(rows.nth(2).locator('input[name="l_time"]')).toHaveAttribute('type', 'hidden');
  await rows.nth(2).locator('select[name="l_use"]').selectOption('Whirlpool');
  await expect(rows.nth(2).locator('input[name="l_time"]')).toHaveValue('20');
  await expect(rows.nth(5).locator('.fixed-use')).toHaveText('Pitch');
});

test('24 mass balance: extract closes at every step, dry hop adds no IBU', async ({ page }) => {
  await fresh(page, 'recipes');
  const r = await run(page, async () => {
    const s = await import('/js/store.js'), c = await import('/js/calc.js'), u = await import('/js/util.js');
    const ipa = s.db.recipes[0], x = c.recipeCalc(ipa);
    const closes = x.steps.filter(st => st.plato && st.extract != null).every(st => Math.abs(st.litres * u.sgFromP(st.plato) * st.plato / 100 - st.extract) < 0.05);
    const noDry = c.recipeCalc({ ...ipa, items: ipa.items.filter(i => i.use !== 'Dry hop') });
    return { closes, sameIbu: Math.abs(noDry.ibu - x.ibu) < 1e-9, og: +x.og.toFixed(3), bright: Math.round(x.bright) };
  });
  expect(r).toEqual({ closes: true, sameIbu: true, og: 1.059, bright: 478 });
});

test('25 old data: extract points and malt minutes migrate', async ({ page }) => {
  await fresh(page, 'recipes');
  const r = await run(page, async () => {
    const s = await import('/js/store.js'), old = JSON.parse(JSON.stringify(s.db));
    old.materials[0].extract = 309;
    old.recipes[0].items.forEach(i => { delete i.use; });
    old.recipes[0].items[0].time = 60;
    const d = s.clean(old);
    return { extract: d.materials[0].extract, malt: d.recipes[0].items[0].use + ':' + d.recipes[0].items[0].time, hop: d.recipes[0].items[2].use };
  });
  expect(r).toEqual({ extract: 80.3, malt: 'Mash:', hop: 'Boil' });
});

test('26 mash profile: steps drive the brew log and flag deviations', async ({ page }) => {
  await fresh(page, 'recipes');
  expect(await run(page, async () => { const s = await import('/js/store.js'), c = await import('/js/calc.js'); return c.deviations(s.db.batches.find(b => b.code === 'B-003')); })).toContain('Beta amylase rest 60.5°C vs 63°C');
  const ipa = await db(page, d => d.recipes[0].id);
  await go(page, 'recipe/' + ipa);
  await page.getByRole('button', { name: 'Edit mash profile' }).click();
  await page.locator('#modal [data-addline]').click();
  const last = page.locator('#modal .lines tbody tr').last();
  await last.locator('select[name="l_id"]').selectOption('Protein rest');
  await expect(last.locator('input[name="l_temp"]')).toHaveValue('50');
  await sheet(page);
  expect(await db(page, d => d.recipes[0].mash.map(m => m.step).join(','))).toBe('Saccharification,Mash out,Protein rest');
  expect(await db(page, d => d.recipes[0].version)).toBe(3);
  await go(page, 'batches');
  await page.locator('tr', { hasText: 'B-004' }).getByRole('button', { name: 'Brew log' }).click();
  await expect(page.locator('#modal')).toContainText('Saccharification actual °C (target 66°C, 60 min)');
});

test('27 times brewed: the recipe page counts batches by version', async ({ page }) => {
  await fresh(page, 'recipes');
  await expect(page.locator('.recipe').first()).toContainText('Brewed 2 times');
  await page.locator('.recipe h3 a').first().click();
  await expect(page.locator('.kpi.hero b')).toHaveText('2');
  await expect(page.locator('main')).toContainText('Crystal 60 cut from 10 to 8 kg');
});

test('28 versions: compare with current, restore as a new version', async ({ page }) => {
  await fresh(page, 'recipes');
  await page.locator('.recipe h3 a').first().click();
  await page.getByRole('button', { name: 'Compare with current' }).click();
  await expect(page.locator('table.compare tr.diff').first()).toBeVisible();
  await page.locator('[data-back]').click();
  await page.getByRole('button', { name: 'Restore' }).click();
  const r = await db(page, d => ({ v: d.recipes[0].version, note: d.recipes[0].note, crystal: d.recipes[0].items.find(i => d.materials.find(m => m.id === i.id).name === 'Crystal 60').qty }));
  expect(r).toEqual({ v: 3, note: 'Restored from v1', crystal: 10 });
});

test('29 compare recipes: pick two, see the differences', async ({ page }) => {
  await fresh(page, 'recipes');
  await page.locator('.pick input').nth(0).click();
  await page.locator('.pick input').nth(2).click();
  await page.getByRole('button', { name: 'Compare 2' }).click();
  await expect(page.locator('main h1')).toHaveText('Compare recipes');
  await expect(page.locator('table.compare thead th')).toHaveCount(3);
  await expect(page.locator('table.compare tr.diff', { hasText: 'Original gravity' })).toBeVisible();
});

test('30 credit: maker, LinkedIn and a way to book a call', async ({ page }) => {
  await fresh(page, 'help');
  await expect(page.locator('.maker-card')).toHaveAttribute('href', 'https://www.linkedin.com/in/ankur-napa');
  await expect(page.locator('.maker-card')).toContainText('Ankur Napa');
  await expect(page.locator('.maker a[data-wa="sidebar"]')).toHaveAttribute('href', /^https:\/\/wa\.me\/917755909445\?text=/);
  await expect(page.locator('main .maker-hero a[href^="mailto:napaankur@gmail.com?subject"]')).toHaveText('Book a call by email');
  await expect(page.locator('main .maker-hero a[data-wa="help"]')).toHaveText('Message on WhatsApp');
});

test('31 brewery setup: template builds the cellar, recipes check the kit', async ({ page }) => {
  await fresh(page, 'setup');
  await page.locator('[data-act="applyTemplate"][data-id="prod20"]').click();
  const r = await db(page, d => ({ len: d.settings.brewhouse.lengthHL, fv: d.tanks.filter(t => t.type === 'Fermenter').length, hlt: d.equipment.some(e => e.name === 'Hot liquor tank') }));
  expect(r).toEqual({ len: 20, fv: 6, hlt: true });
  const warn = await run(page, async () => { const s = await import('/js/store.js'), c = await import('/js/calc.js'); s.db.settings.brewhouse.kettle = 400; s.db.settings.brewhouse.hlt = 300; return c.recipeCalc(s.db.recipes[0]).warn.join(' | '); });
  expect(warn).toContain('over the 400 L kettle');
  expect(warn).toContain('more than the 300 L HLT');
  await page.locator('#setupForm [name="lengthHL"]').fill('7');
  await page.locator('#setupForm button.primary').click();
  expect(await db(page, d => d.settings.brewhouse.lengthHL)).toBe(7);
});

test('32 double brew: a fermenter that holds two brews gets a double brew', async ({ page }) => {
  await fresh(page, 'calendar');
  const r = await run(page, async () => {
    const s = await import('/js/store.js'), h = await import('/js/views/home.js');
    s.db.tanks.find(t => t.name === 'FV-4').capacity = 1200;
    h.actions.planBrew(s.db.recipes[0].id);
    const b = s.db.batches.at(-1);
    return { volume: b.volume, task: s.db.tasks.at(-1).title.startsWith('Double brew') };
  });
  expect(r).toEqual({ volume: 1000, task: true });
});

test('33 analytics: nothing loads until Allow, Settings can turn it off', async ({ page }) => {
  await page.route('**/googletagmanager.com/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await fresh(page, 'dash', null);
  await expect(page.locator('#consent')).toBeVisible();
  expect(await page.locator('script[src*="googletagmanager"]').count()).toBe(0);
  await page.locator('[data-consent="granted"]').click();
  await expect(page.locator('#consent')).toBeHidden();
  expect(await page.locator('script[src*="googletagmanager.com/gtag/js?id=G-1ZHW47YJDC"]').count()).toBe(1);
  await go(page, 'tanks');
  await page.waitForTimeout(100);
  const sent = await page.evaluate(() => window.dataLayer.map(a => Array.from(a)).filter(a => a[0] === 'event').map(a => a[1]));
  expect(sent).toContain('page_view');
  const leaks = await page.evaluate(() => JSON.stringify(window.dataLayer.map(a => Array.from(a))));
  expect(leaks).not.toMatch(/Indiranagar|B-00|Koramangala/);
  const b1 = await page.evaluate(async () => (await import('/js/store.js')).db.batches.find(b => b.code === 'B-001').id);
  await go(page, 'blr/' + b1);
  await page.waitForTimeout(100);
  const sets = await page.evaluate(() => window.dataLayer.map(a => Array.from(a)).filter(a => a[0] === 'set').map(a => a[1]));
  expect(sets.at(-1)).toEqual(expect.objectContaining({ page_title: 'Batch record' }));
  expect(sets.at(-1).page_location).toMatch(/#blr$/);
  expect(await page.evaluate(() => JSON.stringify(window.dataLayer.map(a => Array.from(a))))).not.toMatch(/B-001|Indiranagar/);
  await go(page, 'settings');
  await page.getByRole('button', { name: 'Turn analytics off' }).click();
  expect(await page.evaluate(() => localStorage.getItem('brewhouse-consent'))).toBe('denied');
});

test('34 legal pages: linked from the app and cover the key points', async ({ page }) => {
  await fresh(page, 'dash');
  await page.locator('.legal-links a', { hasText: 'Privacy policy' }).click();
  await expect(page.locator('h1')).toHaveText('Privacy policy');
  await expect(page.locator('main')).toContainText('Digital Personal Data Protection Act, 2023');
  await expect(page.locator('main')).toContainText('only if you choose Allow');
  await page.locator('a', { hasText: 'Terms of use' }).last().click();
  await expect(page.locator('h1')).toHaveText('Terms of use');
  await expect(page.locator('main')).toContainText('placeholders');
  await expect(page.locator('main')).toContainText('laws of India');
});

test('35 kegs: turns, history, lost, bulk pickup, own codes and recall trace', async ({ page }) => {
  await fresh(page, 'kegs');
  await expect(page.locator('#kegmap')).toBeVisible();
  const s = await page.evaluate(() => import('/js/calc.js').then(c => c.kegStats()));
  expect(s.avgCycle).toBeGreaterThan(0);
  expect([s.lost, s.lostValue]).toEqual([1, 9000]);
  await expect(page.locator('section', { hasText: 'Keg turns' })).not.toContainText('Hoppers Wine Shop');
  await page.locator('[data-seg="period"][data-v="all"]').click();
  await expect(page.locator('section', { hasText: 'Keg turns' })).toContainText('Hoppers Wine Shop');

  await go(page, 'scan/K-002');
  await expect(page.locator('section', { hasText: 'History' }).locator('li')).toHaveCount(10);
  await page.getByRole('button', { name: 'Mark lost' }).click();
  expect(await db(page, d => d.kegs.find(k => k.code === 'K-002').history.at(-1).status)).toBe('Lost');

  await go(page, 'kegscan');
  await page.locator('#scanForm [name=code]').fill('k-003');
  await page.locator('#scanForm [name=code]').press('Enter');
  await page.getByRole('button', { name: 'Picked up (1)' }).click();
  expect(await db(page, d => { const k = d.kegs.find(k => k.code === 'K-003'); return [k.status, k.batchId, k.history.at(-1).status]; })).toEqual(['Cleaning', '', 'Cleaning']);

  // K-003 no longer holds B-001, yet its dispatch still traces back to the batch.
  const b1 = await db(page, d => d.batches.find(b => b.code === 'B-001').id);
  await go(page, 'blr/' + b1);
  await expect(page.locator('main')).toContainText('D-0001');

  await go(page, 'kegs');
  await page.getByRole('button', { name: 'Add keg' }).click();
  await sheet(page, { codes: 'BLEFA-0001\nBLEFA-0002' });
  expect(await db(page, d => d.kegs.filter(k => k.code.startsWith('BLEFA')).length)).toBe(2);
});

test('37 navigation: Kegs has its own menu entry and icon', async ({ page }) => {
  await fresh(page, 'dash');
  const nav = page.locator('#sidenav a[href="#kegs"]');
  await expect(nav).toHaveText('Kegs');
  await expect(nav.locator('svg path')).toHaveCount(2);
  await nav.click();
  await expect(page.locator('main h1')).toHaveText('Kegs');
  await expect(page.locator('#sidenav a[href="#kegs"]')).toHaveAttribute('aria-current', 'page');
});

test('38 home keg map: shown with located customers, hidden for an empty brewery', async ({ page }) => {
  await fresh(page, 'dash');
  await expect(page.locator('section', { hasText: 'Kegs out (3)' }).locator('#kegmap')).toBeVisible();
  await go(page, 'settings');
  await page.getByRole('button', { name: 'Start empty' }).click();
  await go(page, 'dash');
  await expect(page.locator('main h1')).toHaveText('Home');
  await expect(page.locator('#kegmap')).toHaveCount(0);
});

test('39 period filter: calendar periods on the April FY, shared across screens', async ({ page }) => {
  await fresh(page, 'dash');
  const r = await page.evaluate(() => import('/js/period.js').then(m => ['day', 'week', 'month', 'quarter', 'year'].map(p => m.periodRange(p, '2026-02-12')).concat([m.periodRange('quarter', '2026-10-23'), m.periodRange('year', '2026-10-23')])));
  expect(r).toEqual([['2026-02-12', '2026-02-12'], ['2026-02-09', '2026-02-12'], ['2026-02-01', '2026-02-12'], ['2026-01-01', '2026-02-12'], ['2025-04-01', '2026-02-12'], ['2026-10-01', '2026-10-23'], ['2026-04-01', '2026-10-23']]);
  await expect(page.locator('.kpi', { hasText: 'Sales this month' })).toBeVisible();
  await page.locator('[data-seg="period"][data-v="day"]').click();
  await expect(page.locator('.kpi', { hasText: 'Sales today' })).toBeVisible();
  await expect(page.locator('.period-range')).toContainText('Showing today');
  // The choice carries over to the next screen.
  await go(page, 'sales');
  await expect(page.locator('[data-seg="period"][data-v="day"]')).toHaveAttribute('aria-selected', 'true');
  const todays = await db(page, d => d.sales.filter(s => s.date === new Date().toISOString().slice(0, 10)).length);
  await expect(page.locator('.kpi', { hasText: 'Invoices today' }).locator('b')).toHaveText(String(todays));
  await page.locator('[data-seg="period"][data-v="all"]').click();
  await expect(page.locator('.kpi', { hasText: 'Invoices all time' }).locator('b')).toHaveText(String(await db(page, d => d.sales.length)));
});

test('40 CSV follows the period filter', async ({ page }) => {
  const fs = await import('node:fs');
  await fresh(page, 'sales');
  const lines = async (btn) => { const [f] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: btn }).click()]); return [f.suggestedFilename(), fs.readFileSync(await f.path(), 'utf8').trim().split('\r\n').length - 1]; };
  const t = await page.evaluate(() => import('/js/util.js').then(u => u.today()));
  await page.locator('[data-seg="period"][data-v="all"]').click();
  expect(await lines('Sales CSV')).toEqual([`sales-all-time-${t}.csv`, await db(page, d => d.sales.length)]);
  await page.locator('[data-seg="period"][data-v="week"]').click();
  const [from] = await page.evaluate(() => import('/js/period.js').then(m => m.periodRange()));
  const inWeek = await db(page, `d => d.sales.filter(s => s.date >= '${from}' && s.date <= '${t}').length`.replace(/^`|`$/g, ''));
  expect(await lines('Sales CSV')).toEqual([`sales-${from}-to-${t}.csv`, inWeek]);
  await go(page, 'losses');
  const lossesInWeek = await db(page, `d => d.losses.filter(l => l.date >= '${from}' && l.date <= '${t}').length`);
  expect(await lines('Losses CSV')).toEqual([`beer-losses-${from}-to-${t}.csv`, lossesInWeek]);
});

test('41 audit wave 1: stock, tank, excise and form controls', async ({ page }) => {
  await fresh(page, 'batches');
  const r = await run(page, async () => {
    const s = await import('/js/store.js'), c = await import('/js/calc.js'), brew = await import('/js/views/brew.js');
    const out = {};
    // Rejected stock is never drawn and a shortfall changes nothing.
    const m = s.db.materials[0];
    m.lots = [{ id: 'good', date: '', qty: 10, expiry: '', qc: 'Approved', cost: 50, ref: '' }, { id: 'bad', date: '', qty: 100, expiry: '2020-01-01', qc: 'Rejected', cost: 40, ref: '' }];
    m.qty = 110;
    out.short = s.consume(m, 20);
    out.after = m.lots.map(l => l.qty);
    out.drawn = s.consume(m, 4);
    // A batch still in the tank cannot be packaged past what is in it.
    const b3 = s.db.batches.find(b => b.code === 'B-003'), before = c.tankLeft(b3);
    s.db.packs.push({ id: 'pk', batchId: b3.id, date: '2026-01-01', format: 'Can 330 ml', unitL: 0.33, units: 300, adjusted: 0, kegIds: [] });
    out.tankDrop = +(before - c.tankLeft(b3)).toFixed(1);
    // Ready is final for excise: no way back into the tank.
    const b1 = s.db.batches.find(b => b.code === 'B-001');
    brew.setStatus(b1.id, 'Conditioning');
    out.b1 = [b1.status, b1.dutyRate > 0];
    // Beer booked Ready at 0 L pays no duty.
    out.zeroDuty = c.duty({ readyDate: '2026-01-01', dutyL: 0, volume: 500, dutyRate: 50 });
    return out;
  });
  expect(r).toEqual({ short: null, after: [10, 100], drawn: [{ lotId: 'good', qty: 4, cost: 200 }], tankDrop: 99, b1: ['Ready', true], zeroDuty: 0 });

  // Negative quantities are refused by the form.
  await go(page, 'packaging');
  await page.getByRole('button', { name: 'Package beer' }).first().click();
  await sheet(page, { units: -3 });
  await expect(page.locator('#toast')).toContainText('Units cannot be negative');
  expect(await db(page, d => d.kegs.filter(k => k.status === 'Filled').length)).toBe(3);
  await page.keyboard.press('Escape');

  // Changing a menu item's serve size leaves past sales alone.
  const before = await run(page, async () => (await import('/js/calc.js')).beerStock().map(x => +x.total.toFixed(1)));
  await run(page, async () => { const s = await import('/js/store.js'); s.db.products[0].ml = 1000; s.commit(); });
  expect(await run(page, async () => (await import('/js/calc.js')).beerStock().map(x => +x.total.toFixed(1)))).toEqual(before);
});

test('42 audit wave 2: credit notes, reversals, voids, lock date and activity log', async ({ page }) => {
  await fresh(page, 'sales');
  const taxBefore = await run(page, async () => { const c = await import('/js/calc.js'), s = await import('/js/store.js'); const inv = s.db.sales.find(x => x.no === 'HM-0001'); return { month: inv.date.slice(0, 7), vat: c.invoice(inv).vat }; });
  // Cancel an invoice: a credit note reverses it today, the original keeps its number.
  await page.locator('[data-seg="period"][data-v="all"]').click();
  await page.locator('tr', { hasText: 'HM-0001' }).getByRole('button', { name: 'Cancel' }).click();
  await sheet(page, { reason: 'Wrong table billed' });
  const cn = await db(page, d => { const o = d.sales.find(x => x.no === 'HM-0001'), c = d.sales.find(x => x.id === o.cancelledBy); return { no: c.no, type: c.type, ref: c.ref, date: c.date, qty: c.lines[0].qty + o.lines[0].qty }; });
  expect(cn).toMatchObject({ no: expect.stringMatching(/^CN\/\d{4}-\d{2}\/0001$/), type: 'Credit note', ref: 'HM-0001', qty: 0 });
  expect(await db(page, d => d.sales.some(x => x.no === 'HM-0001'))).toBe(true);
  await expect(page.locator('tr', { has: page.locator('td.code', { hasText: /^HM-0001$/ }) })).toContainText(`Cancelled by ${cn.no}`);

  // Cancel a dispatch: kegs back to Filled, a reversal is dated today.
  await go(page, 'dispatch');
  await page.locator('[data-seg="period"][data-v="all"]').click();
  await page.locator('tr', { hasText: 'D-0001' }).getByRole('button', { name: 'Cancel' }).click();
  await sheet(page, { reason: 'Bar closed' });
  expect(await db(page, d => ['K-002', 'K-003'].map(c => d.kegs.find(k => k.code === c).status))).toEqual(['Filled', 'Filled']);
  expect(await db(page, d => d.dispatches.find(x => x.no === 'D-0001-R').lines.map(l => l.qty))).toEqual([-1, -1, -120]);

  // Void a loss: it stays listed and its litres come back.
  const loss = async () => run(page, async () => { const c = await import('/js/calc.js'), s = await import('/js/store.js'); return c.batchLoss(s.db.batches.find(b => b.code === 'B-002')); });
  const l0 = await loss();
  await go(page, 'losses');
  await page.locator('[data-seg="period"][data-v="all"]').click();
  await page.locator('tr', { hasText: 'FV-3 to BBT-2' }).getByRole('button', { name: 'Void' }).click();
  await sheet(page, { reason: 'Entered twice' });
  expect(await loss()).toBe(l0 - 5);
  await expect(page.locator('tr', { hasText: 'FV-3 to BBT-2' })).toContainText('Voided');

  // Lock the books: nothing dated on or before the lock can be posted.
  await run(page, async () => { const s = await import('/js/store.js'), u = await import('/js/util.js'); s.db.settings.lockedUntil = u.daysAgo(1); s.commit(); });
  await go(page, 'records');
  await page.getByRole('button', { name: 'Record utility' }).click();
  await sheet(page, { date: await page.evaluate(() => import('/js/util.js').then(u => u.daysAgo(3))), cost: 500 });
  await expect(page.locator('#toast')).toContainText('Books are locked');
  await page.keyboard.press('Escape');

  expect(await db(page, d => d.log.map(e => e.action))).toEqual(['Cancelled invoice', 'Cancelled dispatch', 'Voided loss record']);
});

test('43 audit wave 3: credit sales, payments, credit notes, ageing and GST invoice fields', async ({ page }) => {
  await fresh(page, 'sales');
  // Overdue credit from the demo shows as an alert and in the ageing.
  expect(await run(page, async () => (await import('/js/calc.js')).alerts().some(a => /invoices? overdue/.test(a.text)))).toBe(true);
  const fy = await page.evaluate(() => import('/js/util.js').then(u => u.fyOf(u.today())));

  // A credit invoice gets a per-year number, the customer's terms and a balance.
  await page.getByRole('button', { name: 'New invoice' }).click();
  await sheet(page, { customer: 'Whitefield Taproom', pay: 'credit' });
  const inv = await db(page, d => { const s = d.sales.at(-1); return { no: s.no, credit: s.credit, due: s.dueDate, date: s.date, hsn: s.lines[0].hsn }; });
  expect(inv).toMatchObject({ no: `HM/${fy}/0001`, credit: true, hsn: '2203' });
  expect(await page.evaluate(([a, b]) => import('/js/util.js').then(u => u.daysBetween(a, b)), [inv.date, inv.due])).toBe(30);
  const bal = () => run(page, async () => { const c = await import('/js/calc.js'), s = await import('/js/store.js'); return c.balance(s.db.sales.at(-1)); });
  const total = await bal();

  // Part payment, then a partial credit note for one returned pint.
  await page.locator('tr', { hasText: inv.no }).getByRole('button', { name: 'Receive' }).click();
  await sheet(page, { amount: 100, mode: 'UPI' });
  expect(await bal()).toBeCloseTo(total - 100, 2);
  await page.locator('tr', { has: page.locator('td.code', { hasText: inv.no }) }).getByRole('button', { name: 'Credit note' }).click();
  await sheet(page, { q0: 1, reason: 'Flat pint returned' });
  const cn = await db(page, d => { const c = d.sales.at(-1); return { no: c.no, ref: c.ref, qty: c.lines.map(l => l.qty) }; });
  expect(cn).toEqual({ no: `CN/${fy}/0001`, ref: inv.no, qty: [-1] });
  expect(await bal()).toBeLessThan(total - 100);

  // Receivables by customer with ageing.
  await go(page, 'partners');
  await expect(page.locator('section', { hasText: 'Receivables' })).toContainText('Koramangala Social');
  await expect(page.locator('section', { hasText: 'Receivables' })).toContainText('Whitefield Taproom');

  // The printed invoice carries HSN or SAC and the place of supply.
  await run(page, async ([no]) => { window.print = () => {}; const s = await import('/js/store.js'), v = await import('/js/views/sales.js'); v.actions.printInv(s.db.sales.find(x => x.no === no).id); }, ['HM-0002']);
  await expect(page.locator('#print')).toContainText('996331');
  await expect(page.locator('#print')).toContainText('Place of supply: Karnataka (29)');

  // A new financial year starts the series again.
  await run(page, async () => { const s = await import('/js/store.js'); s.db.settings.docYear = '2019-20'; s.db.seq.inv = 57; });
  expect(await run(page, async () => (await import('/js/store.js')).nextDoc('inv', 'HM'))).toBe(`HM/${fy}/0001`);
});

test('44 audit wave 4: genealogy, valuation, receipts, packaging, QC release and costing', async ({ page }) => {
  await fresh(page, 'batches');
  const r = await run(page, async () => {
    const s = await import('/js/store.js'), c = await import('/js/calc.js'), brew = await import('/js/views/brew.js');
    const out = {};
    // Genealogy: issuing B-005 records the lots it drew.
    const b5 = s.db.batches.find(b => b.code === 'B-005');
    const day = (await import('/js/util.js')).today();
    s.db.tanks.forEach(t => { t.hygiene = 'Sanitised'; t.cleanedOn = day; });
    brew.setStatus(b5.id, 'Brewing');
    out.lots = b5.issues.every(i => i.lots.length > 0);
    out.cost = Math.abs(c.batchCost(b5) - b5.issues.reduce((a, i) => a + i.lots.reduce((x, l) => x + l.cost, 0), 0)) < 0.01;
    // Moving average: 100 kg at 60 plus 100 kg at 90 is 75.
    const m = { id: 'x', name: 'Test malt', qty: 100, cost: 60, lots: [{ id: 'a', qty: 100, qc: 'Approved', cost: 60, date: '', expiry: '', ref: '' }] };
    s.receiveLot(m, { qty: 100, cost: 90, qc: 'Pending' });
    out.avg = m.cost;
    // QC gate: no release, no Ready.
    const b3 = s.db.batches.find(b => b.code === 'B-003');
    brew.setStatus(b3.id, 'Ready');
    out.b3 = b3.status;
    // COGS uses actual batch cost where a batch was brewed in the period.
    out.basis = c.cogs('2000-01-01').map(x => x.basis);
    return out;
  }).catch(e => ({ err: String(e) }));
  expect(r).toMatchObject({ lots: true, cost: true, avg: 75, b3: 'Conditioning' });
  expect(r.basis).toContain('Actual');

  // Partial receipt: the PO stays open for the rest.
  await go(page, 'purchasing');
  await page.getByRole('button', { name: 'Raise POs from plan' }).click();
  const po = await db(page, d => d.pos.find(p => p.status === 'Open').no);
  await page.locator('tr', { hasText: po }).getByRole('button', { name: 'Receive' }).click();
  await sheet(page, { r0: 1, invoiceNo: 'VB-77' });
  expect(await db(page, `d => d.pos.find(p => p.no === '${po}').status`)).toBe('Part received');

  // A can run takes cans, ends and CO2 from stores and costs them to the batch.
  const cans = () => db(page, d => d.materials.find(m => m.name === 'Cans 330 ml').qty);
  const c0 = await cans();
  await go(page, 'packaging');
  await page.getByRole('button', { name: 'Package beer' }).first().click();
  await page.locator('#modal [name="format"]').selectOption('Can 330 ml');
  await sheet(page, { units: 24 });
  expect(await cans()).toBe(c0 - 24);
  expect(await db(page, d => d.packs.at(-1).mats.length)).toBe(3);

  // Cans sold over the bar come off packed stock, not the tank.
  const cansOf = async () => run(page, async () => { const c = await import('/js/calc.js'), s = await import('/js/store.js'); const p = s.db.packs.at(-1), b = s.db.batches.find(x => x.id === p.batchId); const same = s.db.packs.filter(x => x.format === p.format && s.db.batches.find(y => y.id === x.batchId)?.recipeId === b.recipeId); return { left: same.reduce((a, x) => a + c.packLeft(x), 0), tank: c.tankLeft(b), rid: b.recipeId }; });
  const before = await cansOf();
  await run(page, async ([rid]) => { const s = await import('/js/store.js'); s.db.products.push({ id: 'canipa', name: 'Can', kind: 'beer', recipeId: rid, ml: 330, price: 250, hsn: '2203', from: 'Can 330 ml' }); s.commit(); }, [before.rid]);
  await go(page, 'sales');
  await page.getByRole('button', { name: 'New invoice' }).click();
  await page.locator('#modal [name="l_id"]').first().selectOption('canipa');
  await sheet(page, {});
  const after = await cansOf();
  expect(after.left).toBe(before.left - 1);
  expect(after.tank).toBeCloseTo(before.tank, 3);

  // Machines keep a breakdown history; codes stay unique.
  await go(page, 'scan/EQ-03');
  await page.getByRole('button', { name: 'Log breakdown' }).click();
  await sheet(page, { note: 'Compressor tripped', cost: 6000, hours: 5 });
  await expect(page.locator('section', { hasText: 'History' })).toContainText('Compressor tripped');
});

test('36 customer map location: parses lat, long and rejects junk', async ({ page }) => {
  await fresh(page, 'partners');
  await page.locator('tr', { hasText: 'Koramangala Social' }).getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('#modal [name=loc]')).toHaveValue('12.9352, 77.6245');
  await page.locator('#modal [name=loc]').fill('somewhere');
  await page.locator('#modal .sheet-head button.strong').click();
  await expect(page.locator('#toast')).toContainText('Map location should look like');
  await sheet(page, { loc: '12.97, 77.59' });
  expect(await db(page, d => { const c = d.customers.find(c => c.name === 'Koramangala Social'); return [c.lat, c.lng]; })).toEqual([12.97, 77.59]);
});

test('46 leads: WhatsApp setup offer and a personal demo link', async ({ page }) => {
  await fresh(page, 'dash');
  const bar = page.locator('.demo-bar a[data-wa="demo_bar"]');
  await expect(bar).toHaveText('Set it up for me');
  expect(decodeURIComponent(await bar.getAttribute('href'))).toContain('Brewery name and city');
  await page.locator('[data-act="startOwn"]').click();
  await page.goto('/#dash');
  await expect(page.locator('.setup-offer a[data-wa="get_started"]')).toBeVisible();
  // A personal link renames only the demo and greets with that name.
  await page.evaluate(async () => { const s = await import('/js/store.js'); const d = await import('/js/demo.js'); s.replace(d.demo()); s.commit(); });
  await page.goto('/?brewery=Toit#help');
  await expect(page.locator('#brand')).toHaveText('Toit');
  expect(decodeURIComponent(await page.locator('main a[data-wa="help"]').getAttribute('href'))).toContain("I'm from Toit");
  await page.goto('/?brewery=' + encodeURIComponent('<img src=x onerror=alert(1)>Toit') + '#dash');
  await expect(page.locator('#brand')).toHaveText('img srcx onerroralert1Toit');
  // A real brewery is never renamed by the link.
  await page.evaluate(async () => { const s = await import('/js/store.js'); s.startEmpty(); s.db.settings.name = 'Real Brew Co'; s.db.settings.gstin = '29AAAAA0000A1Z5'; s.commit(); });
  await page.goto('/?brewery=Toit#dash');
  await expect(page.locator('#brand')).toHaveText('Real Brew Co');
});
