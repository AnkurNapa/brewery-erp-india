// Fails when user-facing copy has an em dash, en dash, curly quotes or a ", and" join.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['index.html', 'README.md', 'js', 'css', 'docs'];
const BAD = [[/—/, 'em dash'], [/–/, 'en dash'], [/[“”‘’]/, 'curly quote'], [/, and /, '", and" join']];
const files = p => (statSync(p).isDirectory() ? readdirSync(p).flatMap(f => files(join(p, f))) : [p]);
let fails = 0;
for (const f of ROOTS.flatMap(files)) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    for (const [re, what] of BAD) if (re.test(line)) { console.log(`${f}:${i + 1}: ${what}: ${line.trim().slice(0, 100)}`); fails++; }
  });
}
if (fails) { console.log(`${fails} copy problem${fails > 1 ? 's' : ''}`); process.exit(1); }
console.log('Copy check passed');
