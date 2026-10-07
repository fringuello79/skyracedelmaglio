// Service worker: l'app e la mappa restano disponibili anche senza campo
const VERSIONE = 'srmseg-app-v11';
const TILES = 'srmseg-tiles';
const LIB = 'srmseg-lib';
const APP = ['./', 'index.html', 'report.html', 'css/app.css', 'css/report.css', 'js/app.js', 'js/geo.js', 'js/frecce.js', 'js/store.js', 'js/report.js',
  'firebase-config.js', 'data/traccia.json', 'data/segnali.json', 'data/poi.json', 'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'vendor/qrcode.js', 'img/logo-srm.png', 'img/favicon.png', 'img/icon-192.png', 'manifest.webmanifest'];
const HOST_TILES = ['server.arcgisonline.com', 'tile.opentopomap.org', 'tile.openstreetmap.org', 'tile.waymarkedtrails.org'];
const HOST_LIB = ['www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSIONE).then(c => Promise.all(APP.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n.startsWith('srmseg-app-') && n !== VERSIONE).map(n => caches.delete(n)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const host = url.hostname;
  if (HOST_TILES.some(h => host.endsWith(h))) { e.respondWith(primaCache(req, TILES)); return; }
  if (HOST_LIB.includes(host)) { e.respondWith(primaCache(req, LIB)); return; }
  if (url.origin === self.location.origin) { e.respondWith(primaRete(req)); return; }
  // Firebase, Overpass e il resto passano direttamente
});

async function primaCache(req, nome) {
  const c = await caches.open(nome);
  const hit = await c.match(req.url);
  // una copia "opaca" non va bene per chi deve leggere i pixel (sentieri ricolorati): la riscarichiamo
  if (hit && !(hit.type === 'opaque' && req.mode === 'cors')) return hit;
  try { const r = await fetch(req); if (r.ok || r.type === 'opaque') c.put(req.url, r.clone()); return r; }
  catch { return hit || Response.error(); }
}
async function primaRete(req) {
  const c = await caches.open(VERSIONE);
  try { const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; }
  catch { return (await c.match(req, { ignoreSearch: true })) || (await c.match('index.html')) || Response.error(); }
}
