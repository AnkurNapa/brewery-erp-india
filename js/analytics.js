// Google Analytics 4, loaded only after the visitor says yes. Nothing about the brewery is ever sent:
// screens are reported by name, events by a fixed label, never with records, quantities or names.
const ID = 'G-1ZHW47YJDC';
const KEY = 'brewhouse-consent';
let loaded = false;

export function consent() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

function load() {
  if (loaded) return;
  loaded = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', ID, { send_page_view: false });
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${ID}`;
  document.head.appendChild(s);
}

// Withdrawing consent stops tracking and removes the Analytics cookies from this site.
function clearCookies() {
  for (const name of document.cookie.split(';').map(c => c.split('=')[0].trim()).filter(n => n.startsWith('_ga'))) {
    document.cookie = `${name}=; Max-Age=0; path=/`;
    document.cookie = `${name}=; Max-Age=0; path=/; domain=${location.hostname}`;
  }
}

export function setConsent(value) {
  try { localStorage.setItem(KEY, value); } catch { /* private mode: the choice lasts for this visit only */ }
  if (value === 'granted') load();
  else { if (loaded) window[`ga-disable-${ID}`] = true; clearCookies(); }
}

export function init() {
  if (consent() === 'granted') load();
}

export function pageView(view, title) {
  if (!loaded || window[`ga-disable-${ID}`]) return;
  window.gtag('event', 'page_view', { page_title: title, page_location: `${location.origin}${location.pathname}#${view}` });
}

export function track(name, params = {}) {
  if (!loaded || window[`ga-disable-${ID}`]) return;
  window.gtag('event', name, params);
}

// Which actions are counted, under a fixed label. Template keys are the only parameter sent.
export const ACT_EVENTS = {
  resetDemo: 'demo_loaded', clearAll: 'start_empty', exportData: 'export_backup', applyTemplate: 'template_applied',
  csvExcise: 'csv_download', csvTax: 'csv_download', csvSales: 'csv_download', csvLosses: 'csv_download', csvAdjust: 'csv_download',
  planBrew: 'brew_planned', newRec: 'recipe_started', newCount: 'stock_take_started', newInv: 'invoice_started', newDispatch: 'dispatch_started',
};
