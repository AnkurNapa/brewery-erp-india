// Help: the daily workflow for each role, every step linked to its screen.
import { head, seg, panel, wa } from '../ui.js';
import { esc } from '../util.js';

export const ROLES = [
  ['manager', 'Manager', [
    ['Every morning', [['Open Home and read the alerts. Tap one to jump to the fix.', 'dash'], ['Check the brewery floor. Tap a tank to open its batch record.', 'dash']]],
    ['Every week', [['Open Schedule and read the Brew planner. Plan brew picks a clean fermenter and reserves ingredients.', 'calendar'], ['Read Reports, Business, for revenue, cost per litre and margin.', 'reports'], ['Check Beer losses against the target.', 'losses']]],
  ]],
  ['brewer', 'Brewer', [
    ['New beer', [['Recipes, New recipe. Watch gravity, bitterness, colour and cost update as you type.', 'recipes']]],
    ['Brew day', [['Make sure the fermenter is sanitised. Log CIP if it is not.', 'cip'], ['Batches: move the planned batch to Brewing. Ingredients are issued and the brew task closes.', 'batches'], ['Open Brew log and enter mash temperature, gravities, volume and pitch temperature. Deviations are flagged.', 'batches']]],
    ['Cellar round', [['Tanks: Log reading with gravity, temperature and pH.', 'tanks'], ['Record loss for yeast dumps or dry hop loss.', 'tanks'], ['Transfer to a brite tank. The fermenter is marked dirty and a CIP task is added.', 'tanks'], ['Move the batch to Conditioning, then Ready.', 'batches']]],
  ]],
  ['packaging', 'Packaging', [
    ['Packaging run', [['Packaging, Package beer. Pick the batch, the format and how many.', 'packaging'], ['Enter litres drawn if more came out of the tank than went into packs. The difference is a packaging loss.', 'packaging'], ['Kegs are picked from empty stock and tagged to the batch.', 'kegs']]],
    ['Cleaning', [['Log CIP on every empty tank, with chemical, temperature, minutes and the check result.', 'cip'], ['Wash returned kegs from the keg page: Cleaned, now empty.', 'kegs']]],
  ]],
  ['stores', 'Stores', [
    ['Delivery arrives', [['Purchasing and MRP: Receive on the purchase order. The delivery is held as a pending lot.', 'purchasing'], ['Raw materials: QC on the material, then Approve or Reject the lot.', 'materials']]],
    ['Weekly', [['Purchasing and MRP: Raise POs from plan.', 'purchasing'], ['Raw materials: Use / waste for spillage, expired stock or samples.', 'materials']]],
    ['Month end', [['Stock take, New count. Count blind on a phone, review the variance, give each one a reason, then post.', 'stocktake']]],
  ]],
  ['taproom', 'Taproom', [
    ['Every sale', [['Taproom sales, New invoice. Prices fill in from the menu.', 'sales'], ['If a beer has run out the app warns before saving.', 'sales'], ['Print the tax invoice: VAT on beer, CGST and SGST on food.', 'sales']]],
    ['End of shift', [['Record line flush and spillage as a Taproom loss on the batch.', 'losses']]],
  ]],
  ['driver', 'Driver', [
    ['Delivering', [['Scan the keg QR tag with the phone camera and tap Dispatch.', 'kegs'], ['Choose the customer. A trade invoice is raised with the dispatch.', 'dispatch']]],
    ['Collecting', [['Dispatch, Kegs to collect, lists every keg out with each customer.', 'dispatch'], ['Scan the empty keg at the bar and tap Picked up.', 'kegs'], ['Collecting a whole load? Kegs, Scan kegs. Scan or type each code, then tap Picked up once.', 'kegscan'], ['The keg map shows every customer with kegs out. Red pins have a keg out over 30 days.', 'kegs']]],
  ]],
  ['accounts', 'Accounts', [
    ['Month end', [['Excise and tax: the excise register and monthly VAT and GST, with CSV downloads.', 'tax'], ['Taproom sales: Sales CSV, trade and taproom invoices together.', 'sales'], ['Utilities and wastage: enter the month\'s bills so cost per litre is right.', 'records'], ['Stock take: Adjustments CSV for the auditor.', 'stocktake'], ['Settings: Export backup at least weekly.', 'settings']]],
  ]],
];

let role = 'manager';
export const views = {
  help() {
    const [, title, sections] = ROLES.find(r => r[0] === role);
    return head('Help', 'How each person runs their day in Brewhouse. Every step opens the screen it names.')
      + `<section class="panel maker-hero"><span class="avatar big" aria-hidden="true">AN</span><div class="grow"><p class="maker-kicker">Made by</p><h2>Ankur Napa</h2><p class="sub">Brewer and data builder. I built Brewhouse ERP for Indian microbreweries and brewpubs.</p>
        <p class="maker-q">Want it set up with your own recipes, tanks and stock? Message me for a free 30 minute call.</p>
        <div class="card-acts">${wa('Message on WhatsApp', 'help')}<a class="ghost" href="mailto:napaankur@gmail.com?subject=Brewhouse%20ERP%3A%20let%27s%20schedule%20a%20call">Book a call by email</a><a class="ghost" href="https://www.linkedin.com/in/ankur-napa" target="_blank" rel="noopener"><span class="in" aria-hidden="true">in</span>LinkedIn profile</a><a class="link" href="mailto:napaankur@gmail.com">napaankur@gmail.com</a></div></div></section>`
      + seg('helpRole', ROLES.map(([k, t]) => [k, t]), role)
      + sections.map(([name, steps]) => panel(`${esc(title)}: ${esc(name)}`, steps.map(([text, href], i) =>
        `<a class="help-step" href="#${href}"><span class="num">${i + 1}</span><span>${esc(text)}</span></a>`).join(''))).join('');
  },
};
export const actions = {};
export const segs = { helpRole: v => { role = v; } };
