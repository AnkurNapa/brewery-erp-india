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
    brew.setStatus(b3.id, 'Ready');
    s.db.settings.exciseBasis = 'Removal';
    const b4 = s.db.batches.find(b => b.code === 'B-004');
    brew.setStatus(b4.id, 'Ready');
    return { ready: b3.dutyRate, dutyL: b3.dutyL, removal: b4.dutyRate };
  });
  expect(r).toEqual({ ready: 50, dutyL: 493, removal: 0 });
  await go(page, 'sales');
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
  const r = await run(page, async () => {
    const s = await import('/js/store.js'), c = await import('/js/calc.js'), st = await import('/js/views/stores.js');
    const po = s.db.pos.find(p => p.status === 'Open'), m = s.db.materials.find(x => x.id === po.lines[0].id), a0 = c.approvedQty(m);
    st.actions.receivePo(po.id);
    const pending = c.pendingLots(m).length, a1 = c.approvedQty(m);
    c.pendingLots(m).forEach(l => { l.qc = 'Approved'; });
    return { pending, same: a0 === a1, after: c.approvedQty(m) > a1 };
  });
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
  expect(await has()).toBe(false);
});

test('18 utilities: a bill raises cost per litre', async ({ page }) => {
  await fresh(page, 'records');
  const util = () => run(page, async () => (await import('/js/calc.js')).cogs(30)[0].util);
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
  await expect(page.locator('.maker a[href^="mailto:napaankur@gmail.com?subject"]')).toHaveText('Book a call');
  await expect(page.locator('main .maker-hero')).toContainText("Facing difficulty? Let's schedule a call.");
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
