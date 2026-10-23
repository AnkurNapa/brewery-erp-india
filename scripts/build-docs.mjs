// Writes docs/user-workflows.md from the same data as the in-app Help screen.
import { writeFileSync } from 'node:fs';
import { ROLES } from '../js/views/help.js';

const SCREENS = { dash: 'Home', calendar: 'Schedule', recipes: 'Recipes', batches: 'Batches', tanks: 'Tanks', cip: 'CIP', losses: 'Beer losses', packaging: 'Packaging', equipment: 'Equipment and kegs', purchasing: 'Purchasing and MRP', materials: 'Raw materials', stocktake: 'Stock take', sales: 'Taproom sales', dispatch: 'Dispatch', tax: 'Excise and tax', records: 'Utilities and wastage', reports: 'Reports', settings: 'Settings' };
const out = ['# User workflows', '', 'How each person at the brewery runs their day in Brewhouse ERP. The same steps appear in the app under **Help**.', ''];
for (const [, title, sections] of ROLES) {
  out.push(`## ${title}`, '');
  for (const [name, steps] of sections) {
    out.push(`**${name}**`, '');
    steps.forEach(([text, href], i) => out.push(`${i + 1}. ${text} *(${SCREENS[href] || href})*`));
    out.push('');
  }
}
writeFileSync(new URL('../docs/user-workflows.md', import.meta.url), out.join('\n'));
console.log('docs/user-workflows.md written');
