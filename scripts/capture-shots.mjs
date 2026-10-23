// Captures launch video stills from the app with fresh demo data.
// Usage: node scripts/capture-shots.mjs <outDir>  (serves this folder on port 4174)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2];
const server = spawn('python3', ['-m', 'http.server', '4174'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const base = 'http://localhost:4174/';
const SHOTS = [
  ['home', 'dash'], ['tanks', 'tanks'], ['recipe-edit', 'recipes', 'editRec'], ['recipe', 'recipe:0'], ['compare', 'compare:0~2'],
  ['batch', 'blr:B-001'], ['cip', 'cip'], ['losses', 'losses'], ['count', 'count:st0001'], ['purchasing', 'purchasing'],
  ['tax', 'tax'], ['setup', 'setup'], ['help', 'help'], ['dispatch', 'dispatch'],
];
async function shoot(dir, viewport, scale, mobile) {
  mkdirSync(dir, { recursive: true });
  const b = await chromium.launch(), p = await b.newPage({ viewport, deviceScaleFactor: scale, isMobile: mobile, hasTouch: mobile });
  await p.goto(base + '#dash');
  await p.evaluate(async () => { const s = await import('/js/store.js'), d = await import('/js/demo.js'); s.replace(d.demo()); s.commit(); });
  for (const [name, target, act] of SHOTS) {
    const hash = await p.evaluate(async t => {
      const s = await import('/js/store.js'), [v, a] = t.split(':');
      if (v === 'recipe') return 'recipe/' + s.db.recipes[+a].id;
      if (v === 'compare') return 'compare/' + a.split('~').map(i => `${s.db.recipes[+i].id}.${s.db.recipes[+i].version}`).join('~');
      if (v === 'blr') return 'blr/' + s.db.batches.find(b => b.code === a).id;
      if (v === 'count') return 'count/' + a;
      return v;
    }, target);
    await p.evaluate(h => { document.getElementById('modal').open && document.getElementById('modal').close(); location.hash = h; scrollTo(0, 0); }, hash);
    await p.waitForTimeout(400);
    if (act) {
      await p.locator(`[data-act="${act}"]`).first().click();
      await p.waitForTimeout(500);
      await p.evaluate(() => document.querySelector('#modal .preview')?.scrollIntoView({ block: 'start' }));
      await p.waitForTimeout(200);
    }
    await p.screenshot({ path: `${dir}/${name}.png` });
  }
  await b.close();
}
await shoot(`${out}/walkthrough/shots`, { width: 1600, height: 1000 }, 1, false);
await shoot(`${out}/short/shots`, { width: 390, height: 844 }, 3, true);
server.kill();
console.log('captured', SHOTS.length * 2, 'shots');
