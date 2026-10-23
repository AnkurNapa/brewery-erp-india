// Records real-time screen recordings of the app for the launch videos.
// Usage: node scripts/record-scenes.mjs <outDir> <desktop|phone> [sceneName]
// Each scene is a fresh browser with the demo brewpub, played at human speed, held for its voice line.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [out, mode, only] = process.argv.slice(2);
const reel = mode === 'reel' || mode === 'module'; // full-bleed 1080x1920, the Craft Beer School Reel geometry
const phone = mode === 'phone' || reel;
// Chrome's screencast streams frames at device pixels, so these give a true 1920x1080 and 1170x2532.
const VIEW = reel ? { viewport: { width: 432, height: 768 }, deviceScaleFactor: 2.5, isMobile: true, hasTouch: true, size: { width: 1080, height: 1920 } }
  : phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, size: { width: 1170, height: 2532 } }
  : { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2.4, size: { width: 3840, height: 2160 } }; // 4K so zooms stay sharp at 1080p
const FFMPEG = process.env.FFMPEG || `${process.env.HOME}/bin/ffmpeg`;
const server = spawn('python3', ['-m', 'http.server', '4175'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const BASE = 'http://localhost:4175/';

// A visible pointer and click ripple, because headless recordings show no cursor.
const CURSOR = `addEventListener('DOMContentLoaded', () => {
  const c = document.createElement('div');
  c.style.cssText = 'position:fixed;z-index:99999;left:0;top:0;width:${phone ? 34 : 22}px;height:${phone ? 34 : 22}px;margin:-${phone ? 17 : 11}px 0 0 -${phone ? 17 : 11}px;border-radius:50%;background:rgba(0,0,0,.28);border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);pointer-events:none;transition:transform .12s;opacity:${phone ? 0 : 1}';
  document.body.appendChild(c);
  // An open modal dialog sits in the top layer, so the pointer has to live inside it to stay visible.
  const host = () => document.querySelector('dialog[open]') || document.body;
  const at = e => { if (c.parentNode !== host()) host().appendChild(c); c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; };
  addEventListener('pointermove', at, true);
  addEventListener('pointerdown', e => {
    at(e); c.style.opacity = 1; c.style.transform = 'scale(.7)';
    const r = document.createElement('div');
    r.style.cssText = 'position:fixed;z-index:99998;left:' + e.clientX + 'px;top:' + e.clientY + 'px;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;border:3px solid #007aff;pointer-events:none;transition:all .45s ease-out;opacity:1';
    host().appendChild(r);
    requestAnimationFrame(() => { r.style.transform = 'scale(5)'; r.style.opacity = 0; });
    setTimeout(() => r.remove(), 500);
  }, true);
  addEventListener('pointerup', () => { c.style.transform = 'scale(1)'; ${phone ? "setTimeout(() => { c.style.opacity = 0; }, 350);" : ''} }, true);
});`;

const wait = ms => new Promise(r => setTimeout(r, ms));
// Every click, tap and type is logged with its time and position so the editor can zoom to it.
let events = [], tStart = 0;
const log = (kind, x, y) => events.push({ kind, t: +((Date.now() - tStart) / 1000).toFixed(3), x: +(x / VIEW.viewport.width).toFixed(4), y: +(y / VIEW.viewport.height).toFixed(4) });
function helpers(p) {
  const point = async (target, { click = true } = {}) => {
    const loc = typeof target === 'string' ? p.locator(target).first() : target;
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    if (phone) { if (click) { log('tap', x, y); await p.touchscreen.tap(x, y); await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.up(); } return; }
    log(click ? 'click' : 'point', x, y);
    await p.mouse.move(x, y, { steps: 28 });
    await wait(180);
    if (click) { await p.mouse.down(); await wait(90); await p.mouse.up(); }
  };
  const tap = async target => {
    if (!phone) return point(target);
    const loc = typeof target === 'string' ? p.locator(target).first() : target;
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    log('tap', b.x + b.width / 2, b.y + b.height / 2);
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await p.mouse.down(); await wait(80); await p.mouse.up();
  };
  const type = async (sel, text) => { const el = p.locator(sel).first(); await tap(el); const b = await el.boundingBox(); await el.fill(''); log('type', b.x + b.width / 2, b.y + b.height / 2); await el.pressSequentially(text, { delay: 140 }); };
  const scroll = async (dy, steps = 30) => { events.push({ kind: 'scroll', t: +((Date.now() - tStart) / 1000).toFixed(3) }); for (let i = 0; i < steps; i++) { await p.mouse.wheel(0, dy / steps); await wait(28); } };
  const swipe = async dy => { events.push({ kind: 'scroll', t: +((Date.now() - tStart) / 1000).toFixed(3) }); await p.evaluate(async d => { const s = document.scrollingElement; const end = s.scrollTop + d; for (let i = 0; i < 40; i++) { s.scrollTop += d / 40; await new Promise(r => setTimeout(r, 18)); } s.scrollTop = end; }, dy); };
  const go = async hash => { await p.evaluate(h => { location.hash = h; }, hash); await wait(350); };
  // Reels open each screen directly, like the Craft Beer School Reels, instead of showing the drawer.
  const DIRECT = { Recipes: 'recipes', CIP: 'cip', 'Beer losses': 'losses', 'Stock take': 'stocktake', 'Excise and tax': 'tax', Help: 'help' };
  const more = async label => {
    if (reel) { await go(DIRECT[label]); await wait(300); return; }
    await tap('[data-more]');
    await wait(500);
    // Items low in the phone drawer need the drawer scrolled before they can be tapped.
    await p.evaluate(l => [...document.querySelectorAll('#sidenav a')].find(a => a.textContent.trim().startsWith(l)).scrollIntoView({ block: 'center' }), label);
    await wait(700);
    // hasText matches substrings case-insensitively ("CIP" would hit "Recipes"), so anchor it.
    const b = await p.locator('#sidenav a').filter({ hasText: new RegExp('^' + label) }).first().boundingBox();
    log('tap', b.x + b.width / 2, b.y + b.height / 2);
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await p.mouse.down(); await wait(80); await p.mouse.up();
    await wait(400);
  };
  return { point, tap, type, scroll: phone ? swipe : scroll, go, more };
}

const DESKTOP = {
  s01: async (p, h) => { await wait(600); await h.point('.kpi.hero', { click: false }); await wait(700); await h.point('.list li a', { click: false }); await wait(900); await h.point('.floor-tank >> nth=1', { click: false }); },
  s02: async (p, h) => { await h.point('#sidenav a[href="#tanks"]'); await wait(700); await h.point('.tank .curve', { click: false }); await wait(800); await h.point('.tank >> nth=4', { click: false }); },
  s03: async (p, h) => { await h.go('recipes'); await wait(400); await h.point('[data-act="editRec"]'); await wait(700); await h.type('#modal [name="l_qty"]', '140'); await wait(600); await p.evaluate(() => document.querySelector('#modal .preview').scrollIntoView({ behavior: 'smooth' })); await wait(1400); await h.point('#modal .preview .metrics', { click: false }); },
  s04: async (p, h) => { await h.go('recipes'); await wait(300); await h.point('.recipe h3 a'); await wait(900); await h.point('.kpi.hero', { click: false }); await wait(500); await h.scroll(900); },
  s05: async (p, h) => { await h.go('recipes'); await wait(300); await h.point('.pick input >> nth=0'); await wait(300); await h.point('.pick input >> nth=2'); await wait(400); await h.point('[data-act="go"][data-id^="compare"]'); await wait(900); await h.scroll(300); },
  s06: async (p, h) => { await h.go('batches'); await wait(400); await h.point(p.locator('a.code', { hasText: 'B-001' })); await wait(900); await h.scroll(700); },
  s07: async (p, h) => { await h.go('cip'); await wait(500); await h.point(p.locator('tr', { hasText: 'FV-3' }).locator('[data-act="logCip"]')); await wait(900); await h.point('#modal .sheet-head button.strong'); await wait(600); },
  s08: async (p, h) => { await h.go('losses'); await wait(500); await h.point('[data-seg="lossWindow"][data-v="90"]'); await wait(700); await h.point('.panel .bar', { click: false }); },
  s09: async (p, h) => { await h.go('stocktake'); await wait(400); await h.point('[data-act="newCount"]'); await wait(700); await h.type('.count-in >> nth=0', '615'); await wait(300); await h.point('[data-seg="countMode"][data-v="review"]'); await wait(800); },
  s10: async (p, h) => { await h.go('dispatch'); await wait(500); await h.point('.collect [data-act="kegPickup"]'); await wait(900); await h.point('[data-act="newDispatch"]', { click: false }); },
  s11: async (p, h) => { await h.go('tax'); await wait(500); await h.point('table', { click: false }); await wait(500); await h.scroll(500); await wait(300); await h.point('[data-act="csvTax"]', { click: false }); },
  s12: async (p, h) => { await h.go('setup'); await wait(500); await h.point('.template >> nth=1', { click: false }); await wait(600); await h.scroll(600); },
};
const PHONE = {
  p01: async (p, h) => { await wait(700); await h.scroll(500); await wait(500); await h.scroll(-500); },
  p02: async (p, h) => { await h.tap('#tabbar a[href="#tanks"]'); await wait(800); await h.scroll(700); },
  p03: async (p, h) => { await h.more('Recipes'); await h.tap('[data-act="editRec"]'); await wait(700); await p.evaluate(() => document.querySelector('#modal .preview').scrollIntoView({ behavior: 'smooth' })); await wait(1500); },
  p04: async (p, h) => { await h.tap('#tabbar a[href="#batches"]'); await wait(500); await h.tap(p.locator('a.code', { hasText: 'B-001' })); await wait(700); await h.scroll(900); },
  p05: async (p, h) => { await h.more('CIP'); await wait(300); await h.scroll(500); await wait(400); await h.more('Beer losses'); },
  p06: async (p, h) => { await h.more('Stock take'); await h.tap('[data-act="newCount"]'); await wait(600); await h.type('.count-in >> nth=0', '615'); },
  p07: async (p, h) => { await h.more('Excise and tax'); await wait(400); await h.scroll(600); },
  p08: async (p, h) => { await h.more('Help'); await wait(1200); },
};

// Module Reels: one short Reel per module, scenes named <module>-<n>.
const id = async (p, code) => p.evaluate(async c => (await import('/js/store.js')).db.batches.find(b => b.code === c).id, code);
const save = h => h.tap('#modal .sheet-head button.strong');
const MODULE = {
  'home-1': async (p, h) => { await wait(500); await h.scroll(350); },
  'home-2': async (p, h) => { await h.scroll(900); await wait(400); },
  'home-3': async (p, h) => { await h.scroll(800); await wait(300); await h.tap('.list li a'); await wait(600); },
  'schedule-1': async (p, h) => { await h.go('calendar'); await wait(400); await h.scroll(250); },
  'schedule-2': async (p, h) => { await h.go('calendar'); await h.scroll(1150); },
  'schedule-3': async (p, h) => { await h.go('calendar'); await h.scroll(1150); await wait(300); await h.tap('[data-act="planBrew"]'); await wait(600); },
  'tanks-1': async (p, h) => { await h.go('tanks'); await wait(400); await h.scroll(350); },
  'tanks-2': async (p, h) => { await h.go('tanks'); await h.tap('[data-act="logReading"]'); await wait(500); await h.type('#modal [name="gravity"]', '1.020'); await save(h); await wait(500); },
  'tanks-3': async (p, h) => { await h.go('tanks'); await h.tap('[data-act="transfer"]'); await wait(900); await save(h); await wait(600); },
  'recipes-1': async (p, h) => { await h.go('recipes'); await wait(400); await h.scroll(550); },
  'recipes-2': async (p, h) => { await h.go('recipes'); await h.tap('[data-act="editRec"]'); await wait(600); await h.type('#modal [name="l_qty"]', '140'); await wait(300); await p.evaluate(() => document.querySelector('#modal .preview').scrollIntoView({ behavior: 'smooth' })); await wait(900); },
  'recipes-3': async (p, h) => { await h.go('recipe/' + await p.evaluate(async () => (await import('/js/store.js')).db.recipes[0].id)); await wait(500); await h.scroll(1700); },
  'recipes-4': async (p, h) => { await h.go('compare/' + await p.evaluate(async () => { const r = (await import('/js/store.js')).db.recipes; return `${r[0].id}.${r[0].version}~${r[2].id}.${r[2].version}`; })); await wait(500); await h.scroll(350); },
  'batches-1': async (p, h) => { await h.go('batches'); await wait(500); await h.scroll(200); },
  'batches-2': async (p, h) => { await h.go('blr/' + await id(p, 'B-001')); await wait(500); await h.scroll(950); },
  'batches-3': async (p, h) => { await h.go('batches'); await wait(300); await h.tap(p.locator('tr', { hasText: 'B-003' }).locator('[data-act="brewLog"]')); await wait(1400); },
  'packaging-1': async (p, h) => { await h.go('packaging'); await wait(600); await h.scroll(150); },
  'packaging-2': async (p, h) => { await h.go('packaging'); await h.tap('[data-act="newPack"]'); await wait(800); await save(h); await wait(700); },
  'stores-1': async (p, h) => { await h.go('materials'); await wait(500); await h.scroll(300); },
  'stores-2': async (p, h) => { await h.go('materials'); await wait(300); await h.tap(p.locator('[data-act="lots"]', { hasText: 'QC' })); await wait(1200); },
  'stores-3': async (p, h) => { await h.go('materials'); await h.tap(p.locator('[data-act="lots"]', { hasText: 'QC' })); await wait(700); await h.tap('#modal [data-qc="Approved"]'); await wait(800); },
  'purchasing-1': async (p, h) => { await h.go('purchasing'); await wait(500); await h.scroll(300); },
  'purchasing-2': async (p, h) => { await h.go('purchasing'); await wait(300); await h.tap('[data-act="mrpPos"]'); await wait(500); await h.scroll(1000); },
  'equipment-1': async (p, h) => { await h.go('equipment'); await wait(500); await h.scroll(300); },
  'equipment-2': async (p, h) => { await h.go('equipment'); await wait(300); await h.tap('[data-act="showQr"]'); await wait(1500); },
  'equipment-3': async (p, h) => { await h.go('scan/K-001'); await wait(700); await h.tap('[data-act="kegPickup"]'); await wait(700); },
  'cip-1': async (p, h) => { await h.go('cip'); await wait(500); await h.scroll(280); },
  'cip-2': async (p, h) => { await h.go('cip'); await wait(300); await h.tap(p.locator('tr', { hasText: 'FV-3' }).locator('[data-act="logCip"]')); await wait(900); await save(h); await wait(700); },
  'losses-1': async (p, h) => { await h.go('losses'); await wait(500); await h.scroll(320); },
  'losses-2': async (p, h) => { await h.go('losses'); await wait(300); await h.tap('[data-seg="lossWindow"][data-v="90"]'); await wait(300); await h.scroll(1300); },
  'stocktake-1': async (p, h) => { await h.go('stocktake'); await wait(500); await h.tap('[data-act="newCount"]'); await wait(700); },
  'stocktake-2': async (p, h) => { await h.go('stocktake'); await h.tap('[data-act="newCount"]'); await wait(500); await h.type('.count-in', '615'); await h.tap('[data-seg="countMode"][data-v="review"]'); await wait(600); },
  'stocktake-3': async (p, h) => { await h.go('stocktake'); await h.tap('[data-act="newCount"]'); await wait(300); await h.tap('[data-seg="countMode"][data-v="review"]'); await wait(300); await p.evaluate(async () => { const s = document.scrollingElement, end = s.scrollHeight; for (let i = 0; i < 50; i++) { s.scrollTop += (end - s.scrollTop) / 12; await new Promise(r => setTimeout(r, 20)); } }); await wait(500); },
  'sales-1': async (p, h) => { await h.go('sales'); await wait(300); await h.tap('[data-act="newInv"]'); await wait(1000); await save(h); await wait(600); },
  'sales-2': async (p, h) => { await h.go('dispatch'); await wait(500); await h.scroll(250); },
  'tax-1': async (p, h) => { await h.go('tax'); await wait(500); await h.scroll(450); },
  'tax-2': async (p, h) => { await h.go('reports'); await wait(400); for (const t of ['production', 'process', 'quality']) { await h.tap(`[data-seg="reportTab"][data-v="${t}"]`); await wait(700); } },
  'kegs-1': async (p, h) => { await h.go('kegs'); await p.waitForSelector('.kpin.late', { timeout: 15000 }); await wait(600); await p.evaluate(() => document.getElementById('kegmap').scrollIntoView({ behavior: 'smooth', block: 'center' })); await wait(1400); await h.tap('.kpin.late'); await wait(1600); },
  'kegs-2': async (p, h) => { await h.go('kegs'); await wait(400); await p.evaluate(() => [...document.querySelectorAll('section')].find(s => s.textContent.startsWith('Keg turns')).scrollIntoView({ behavior: 'smooth', block: 'center' })); await wait(1500); },
  'kegs-3': async (p, h) => { await h.go('scan/K-002'); await wait(700); await h.scroll(420); },
  'kegs-4': async (p, h) => { await h.go('kegscan'); await wait(400); for (const c of ['K-002', 'K-003']) { await h.type('#scanForm [name=code]', c); await p.press('#scanForm [name=code]', 'Enter'); await wait(400); } await h.tap(p.getByRole('button', { name: /^Picked up/ })); await wait(900); },
  'setup-1': async (p, h) => { await h.go('setup'); await wait(500); await h.scroll(200); },
  'setup-2': async (p, h) => { await h.go('setup'); await wait(300); await h.tap('[data-act="applyTemplate"][data-id="brewpub10"]'); await wait(600); await h.scroll(1600); },
};
const scenes = mode === 'module' ? MODULE : phone ? PHONE : DESKTOP;
const durations = JSON.parse(process.env.SCENE_SECONDS || '{}');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const [name, play] of Object.entries(scenes)) {
  if (only && !name.startsWith(only)) continue;
  const tmp = `${out}/tmp-${name}`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const { size, ...ctxOpts } = VIEW;
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(CURSOR);
  await ctx.addInitScript(() => localStorage.setItem('brewhouse-consent', 'denied')); // keep the consent prompt out of recordings
  const p = await ctx.newPage();
  p.on('dialog', d => d.accept());
  await p.goto(BASE + '#dash');
  await p.waitForSelector('main h1');
  await wait(300);
  // Stream frames with their timestamps; frames only arrive when the screen changes.
  const cdp = await ctx.newCDPSession(p), frames = [];
  cdp.on('Page.screencastFrame', async f => {
    const file = `${tmp}/f${String(frames.length).padStart(5, '0')}.jpg`;
    writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp });
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: size.width, maxHeight: size.height, everyNthFrame: 1 });
  const t0 = Date.now();
  events = []; tStart = t0;
  await wait(900); // a settled first frame for the crossfade in, and room for the zoom to lead in
  await play(p, helpers(p));
  const target = (durations[name] || 6) * 1000 + 600;
  if (Date.now() - t0 < target) await wait(target - (Date.now() - t0));
  await cdp.send('Page.stopScreencast');
  const end = frames[0].t + (Date.now() - t0) / 1000;
  await ctx.close();
  // Each frame holds until the next one, then everything is resampled to a steady 30 fps.
  const list = frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(0.001, (frames[i + 1]?.t ?? end) - f.t).toFixed(4)}`).join('\n') + `\nfile '${frames.at(-1).file}'\n`;
  writeFileSync(`${tmp}/list.txt`, list);
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', `${tmp}/list.txt`, '-vf', `fps=30,scale=${size.width}:${size.height}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', `${out}/${name}.mp4`]);
  rmSync(tmp, { recursive: true, force: true });
  writeFileSync(`${out}/${name}.json`, JSON.stringify({ duration: +((Date.now() - t0) / 1000).toFixed(3), events }, null, 1));
  console.log('recorded', name, ((Date.now() - t0) / 1000).toFixed(1), 's,', frames.length, 'frames');
}
await browser.close();
server.kill();
