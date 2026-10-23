// Keg map: Leaflet on OpenStreetMap tiles, the same setup as the Beverage-AI Radar.
// Leaflet loads only when a map is on screen, so no other page fetches it.
const LIB = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
const CSS = [LIB + 'leaflet.min.css', 'sha384-c6Rcwz4e4CITMbu/NBmnNS8yN2sC3cUElMEMfP3vqqKFp7GOYaaBBCqmaWBjmkjb'];
const JS = [LIB + 'leaflet.min.js', 'sha384-NElt3Op+9NBMCYaef5HxeJmU4Xeard/Lku8ek6hoPTvYkQPh3zLIrJP7KiRocsxO'];
const INDIA = [[22.5, 79], 4];

let ready = null;
const load = () => ready || (ready = new Promise((ok, fail) => {
  if (window.L) return ok();
  const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: CSS[0], integrity: CSS[1], crossOrigin: 'anonymous' });
  const js = Object.assign(document.createElement('script'), { src: JS[0], integrity: JS[1], crossOrigin: 'anonymous', onload: ok, onerror: () => { ready = null; fail(); } });
  document.head.append(css, js);
}));

// pins: [{ lat, lng, n, title, html, cls }]. Callers escape html; Leaflet inserts it as markup.
export function drawMap(el, pins) {
  load().then(() => {
    if (!el.isConnected) return;
    const map = L.map(el, { scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    const pts = pins.map(p => L.marker([p.lat, p.lng], { title: p.title, alt: p.title, icon: L.divIcon({ className: `kpin ${p.cls || ''}`, html: `<b>${p.n}</b>`, iconSize: [30, 30] }) })
      .bindPopup(p.html).addTo(map).getLatLng());
    if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 12 }); else map.setView(...INDIA);
    // The map can be drawn while its panel is still being laid out; Leaflet needs its real size.
    new ResizeObserver(() => map.invalidateSize()).observe(el);
  }).catch(() => { el.innerHTML = '<p class="empty">The map could not load. Check the connection and open this page again.</p>'; });
}

// "12.97, 77.59" as copied from Google Maps or a phone. Returns null when it is not a real place.
export function parseLoc(s) {
  const m = String(s || '').trim().match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const [lat, lng] = [+m[1], +m[2]];
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}
