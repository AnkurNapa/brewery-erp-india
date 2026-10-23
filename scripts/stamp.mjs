// Stamps every script and the stylesheet with a content hash through an import map,
// so browsers never mix an old module with a new one after a deploy.
// Run `npm run stamp` after editing js or css. `--check` fails if the stamp is stale.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const files = p => (statSync(p).isDirectory() ? readdirSync(p).flatMap(f => files(join(p, f))) : [p]);
const hash = f => createHash('sha1').update(readFileSync(f)).digest('hex').slice(0, 8);
const imports = Object.fromEntries(files('js').filter(f => f.endsWith('.js')).sort().map(f => [`./${f}`, `./${f}?v=${hash(f)}`]));
const block = `<!-- stamp:start -->\n<script type="importmap">${JSON.stringify({ imports }, null, 1)}</script>\n<link rel="stylesheet" href="css/app.css?v=${hash('css/app.css')}">\n<script type="module" src="${imports['./js/app.js']}"></script>\n<!-- stamp:end -->`;
const html = readFileSync('index.html', 'utf8');
const next = html.replace(/<!-- stamp:start -->[\s\S]*?<!-- stamp:end -->/, block);
if (process.argv.includes('--check')) {
  if (next !== html) { console.log('index.html stamp is stale. Run: npm run stamp'); process.exit(1); }
  console.log('Stamp up to date');
} else { writeFileSync('index.html', next); console.log('index.html stamped'); }
