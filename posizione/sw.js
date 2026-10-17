// Service worker di «Dove sono»: la pagina e le tessere già viste restano disponibili anche con poco campo
const VERSIONE = 'srmpos-app-v1';
const TILES = 'srmpos-tiles';
const APP = ['./', 'index.html', 'app.js', 'geo.js', 'traccia.json', 'comuni-istat.json', 'leaflet/leaflet.js', 'leaflet/leaflet.css', 'logo-srm.png', 'favicon.png'];
const HOST_TILES = ['server.arcgisonline.com', 'tile.opentopomap.org', 'tile.openstreetmap.org', 'tile.waymarkedtrails.org'];
const HOST_LIB = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const MAX_TILES = 2500;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSIONE).then(c => Promise.all(APP.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n.startsWith('srmpos-app-') && n !== VERSIONE).map(n => caches.delete(n)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (HOST_TILES.some(h => url.hostname.endsWith(h))) { e.respondWith(primaCache(req, TILES, true)); return; }
  if (HOST_LIB.includes(url.hostname)) { e.respondWith(primaCache(req, VERSIONE)); return; }
  if (url.origin === self.location.origin) e.respondWith(primaRete(req));
});

async function primaCache(req, nome, limita) {
  const c = await caches.open(nome);
  const hit = await c.match(req);
  if (hit) return hit;
  try {
    const r = await fetch(req);
    if (r.ok || r.type === 'opaque') {
      c.put(req, r.clone()).catch(() => {});
      if (limita) c.keys().then(k => { if (k.length > MAX_TILES) k.slice(0, k.length - MAX_TILES).forEach(x => c.delete(x)); }).catch(() => {});
    }
    return r;
  } catch (err) { return hit || Response.error(); }
}
async function primaRete(req) {
  const c = await caches.open(VERSIONE);
  try {
    const r = await fetch(req);
    if (r.ok) c.put(req, r.clone()).catch(() => {});
    return r;
  } catch { return (await c.match(req, { ignoreSearch: true })) || Response.error(); }
}
