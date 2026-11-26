// «Dove sono» — la propria posizione rispetto al percorso della Skyrace del Maglio 2026.
// Percorso, sentieri e stile della mappa sono quelli dell'app della segnaletica (staff/). La posizione resta sul telefono.
import { Traccia, dist, bearing, cardinale, fmtKm, fmtDist } from './geo.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = {
  get: (k, d = null) => { try { return localStorage.getItem('srmpos:' + k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('srmpos:' + k, v); } catch {} },
};

const S = { traccia: null, comuni: null, me: null, segui: true, primoFix: true, gpsAttivo: false, errore: null };
let map, layers = {}, mkMe, cerchioMe, lineaMe;

/* ============================================================ sentieri segnati (come nell'app segnaletica) */
// Waymarked Trails: le linee diventano rosso scuro, i simboli CAI/E1 restano com'erano.
const ROSSO_SENTIERI = [128, 14, 20];
function ricoloraSentieri(d, W, H) {
  const n = W * H, seme = new Uint8Array(n), vuoto = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (d[i + 3] < 128) { vuoto[p] = 1; continue; }
    const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if ((mn > 185 && mx - mn < 45) || mx < 90) seme[p] = 1;
  }
  const dilata = (src, R) => {
    const t = new Uint8Array(n), o = new Uint8Array(n);
    for (let y = 0; y < H; y++) {
      let c = 0; const q = y * W;
      for (let x = -R; x < W; x++) { const a = x + R; if (a < W) c += src[q + a]; const s = x - R - 1; if (s >= 0) c -= src[q + s]; if (x >= 0) t[q + x] = c > 0; }
    }
    for (let x = 0; x < W; x++) {
      let c = 0;
      for (let y = -R; y < H; y++) { const a = y + R; if (a < H) c += t[a * W + x]; const s = y - R - 1; if (s >= 0) c -= t[s * W + x]; if (y >= 0) o[y * W + x] = c > 0; }
    }
    return o;
  };
  const vicino = dilata(seme, 7);
  const eroso = dilata(vuoto, 2); for (let p = 0; p < n; p++) eroso[p] = eroso[p] ? 0 : 1;
  const pieno = dilata(eroso, 2);
  const [R0, G0, B0] = ROSSO_SENTIERI;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (!d[i + 3] || (pieno[p] && vicino[p])) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) > 50) { d[i] = R0; d[i + 1] = G0; d[i + 2] = B0; }
  }
}
const SentieriSegnati = L.GridLayer.extend({
  createTile(coords, done) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const url = `https://tile.waymarkedtrails.org/hiking/${coords.z}/${coords.x}/${coords.y}.png`;
    const disegna = (img, leggibile) => {
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, 256, 256);
      if (leggibile) {
        try { const id = g.getImageData(0, 0, 256, 256); ricoloraSentieri(id.data, 256, 256); g.putImageData(id, 0, 0); }
        catch { /* immagine non leggibile: resta con i colori originali */ }
      }
      done(null, c);
    };
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => disegna(img, true);
    img.onerror = () => {
      const im2 = new Image();
      im2.onload = () => disegna(im2, false);
      im2.onerror = e => done(e, c);
      im2.src = url;
    };
    img.src = url;
    return c;
  },
});

/* ============================================================ mappa */
function creaMappa() {
  map = L.map('mappa', { zoomControl: false, maxZoom: 20, attributionControl: false, tap: true });
  L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map);
  L.control.zoom({ position: 'topleft' }).addTo(map);
  L.control.scale({ imperial: false, position: 'topleft' }).addTo(map);
  layers.base = {
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, maxNativeZoom: 19, attribution: 'Immagini © Esri, Maxar, Earthstar Geographics' }),
    topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 17, subdomains: 'abc', className: 'tile-attenuata', attribution: '© OpenTopoMap (CC-BY-SA), dati © OpenStreetMap' }),
    osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 19, className: 'tile-attenuata', attribution: '© OpenStreetMap' }),
  };
  layers.sentieri = new SentieriSegnati({ maxZoom: 20, maxNativeZoom: 18, opacity: .9, className: 'tile-sentieri', attribution: 'Sentieri © waymarkedtrails.org' });
  layers.comuni = L.layerGroup();
  const base = LS.get('base', 'satellite');
  (layers.base[base] || layers.base.satellite).addTo(map);
  if (LS.get('ov:sentieri', '1') === '1') layers.sentieri.addTo(map);
  if (LS.get('ov:comuni', '1') === '1') layers.comuni.addTo(map);

  map.createPane('confini'); map.getPane('confini').style.zIndex = 403;
  ['traccia', 'chevron', 'etichette', 'me'].forEach((p, i) => { map.createPane(p); map.getPane(p).style.zIndex = 405 + i * 5; });
  map.getPane('etichette').style.pointerEvents = 'none';

  const ll = S.traccia.latlngs();
  L.polyline(ll, { pane: 'traccia', color: '#153821', weight: 8, opacity: .85, interactive: false }).addTo(map);
  L.polyline(ll, { pane: 'traccia', color: '#FF8102', weight: 4.5, opacity: 1, interactive: false }).addTo(map);
  // tratto percorso due volte: tratteggio bianco
  S.traccia.comune.slice(0, 1).forEach(([a, b]) => {
    const seg = S.traccia.pts.filter(p => p[3] >= a && p[3] <= b).map(p => [p[0], p[1]]);
    L.polyline(seg, { pane: 'traccia', color: '#fff', weight: 2, dashArray: '2 9', opacity: .95, interactive: false }).addTo(map);
  });

  // frecce di direzione e chilometri
  layers.chevron = L.layerGroup();
  for (let k = 0.25; k < S.traccia.kmTot - 0.1; k += 0.35) {
    const p = S.traccia.at(k), b = S.traccia.direzioneDopo(k, 0.03);
    L.marker([p[0], p[1]], { pane: 'chevron', interactive: false, keyboard: false, icon: L.divIcon({ className: 'mk-chevron', iconSize: [16, 16], iconAnchor: [8, 8],
      html: `<svg viewBox="-8 -8 16 16" width="16" height="16"><path transform="rotate(${b})" d="M-5 3 L0 -3 L5 3" fill="none" stroke="#153821" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>` }) }).addTo(layers.chevron);
  }
  for (let k = 1; k < S.traccia.kmTot; k++) {
    const p = S.traccia.at(k);
    L.marker([p[0], p[1]], { pane: 'chevron', keyboard: false, icon: L.divIcon({ className: 'mk-km', iconSize: [22, 22], iconAnchor: [11, 11], html: `<span>${k}</span>` }) })
      .bindTooltip(`km ${k}`, { className: 'tip', direction: 'top' }).addTo(layers.chevron);
  }
  const zoomChevron = () => {
    if (map.getZoom() >= 14) layers.chevron.addTo(map); else layers.chevron.remove();
    $('#mappa').classList.toggle('z-lontano', map.getZoom() < 14);
  };
  map.on('zoomend', zoomChevron);
  inquadraPercorso(false);
  zoomChevron();

  map.on('dragstart', () => { if (S.segui) { S.segui = false; $('#btnSegui').classList.remove('attivo'); } });
}

const spazioScheda = () => ($('#scheda').offsetHeight || 0) + 16;
function inquadraPercorso(anim = true) {
  map.fitBounds(L.latLngBounds(S.traccia.latlngs()), { paddingTopLeft: [24, 24], paddingBottomRight: [70, spazioScheda()], animate: anim });
}

/* ============================================================ confini comunali */
// Prima scelta: OpenStreetMap (gli stessi confini della tavola di coordinamento), salvati sul telefono dopo il primo scarico.
// Se OpenStreetMap non risponde si usano i confini ISTAT generalizzati, meno precisi, finché non si riesce a scaricarli.
const BOX = [42.065, 13.305, 42.19, 13.445];               // sud, ovest, nord, est: il percorso con un margine
const OSM_CACHE = 'srmpos-comuni', OSM_CHIAVE = './comuni-osm-v1.json';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

const uguali = (a, b) => a[0] === b[0] && a[1] === b[1];
function componiAnelli(vie) {
  const resto = vie.map(v => v.slice()); const anelli = [];
  while (resto.length) {
    let r = resto.shift(), giri = 0;
    while (!uguali(r[0], r.at(-1)) && giri++ < 5000) {
      const fine = r.at(-1), inizio = r[0];
      const i = resto.findIndex(w => uguali(w[0], fine) || uguali(w.at(-1), fine) || uguali(w[0], inizio) || uguali(w.at(-1), inizio));
      if (i < 0) break;
      const w = resto.splice(i, 1)[0];
      if (uguali(w[0], fine)) r = r.concat(w.slice(1));
      else if (uguali(w.at(-1), fine)) r = r.concat(w.slice().reverse().slice(1));
      else if (uguali(w.at(-1), inizio)) r = w.concat(r.slice(1));
      else r = w.slice().reverse().concat(r.slice(1));
    }
    if (r.length > 3) anelli.push(r);
  }
  return anelli;
}

async function comuniOSM() {
  try { const hit = await (await caches.open(OSM_CACHE)).match(OSM_CHIAVE); if (hit) return await hit.json(); } catch {}
  const q = `[out:json][timeout:60];rel["boundary"="administrative"]["admin_level"="8"](${BOX.join(',')});out geom;`;
  for (const url of OVERPASS) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 30000);
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ctl.signal });
      if (!r.ok) continue;
      const grezzi = await r.json();
      const vie = {}, comuni = [];
      for (const rel of grezzi.elements || []) {
        if (rel.type !== 'relation' || !rel.members) continue;
        const ids = [];
        for (const m of rel.members) {
          if (m.type !== 'way' || !m.geometry || !['outer', 'inner', ''].includes(m.role)) continue;
          vie[m.ref] ??= m.geometry.map(g => [+g.lat.toFixed(5), +g.lon.toFixed(5)]);
          ids.push(m.ref);
        }
        if (ids.length) comuni.push({ nome: rel.tags?.name || '', vie: ids });
      }
      if (!comuni.length) continue;
      const dati = { fonte: 'osm', vie, comuni, scaricato: Date.now() };
      try { await (await caches.open(OSM_CACHE)).put(OSM_CHIAVE, new Response(JSON.stringify(dati), { headers: { 'Content-Type': 'application/json' } })); } catch {}
      return dati;
    } catch { /* server lento o non raggiungibile: si prova il successivo */ }
    finally { clearTimeout(t); }
  }
  return null;
}

function daOSM(d) {
  const linee = Object.values(d.vie);
  const comuni = d.comuni.map(c => ({ nome: c.nome, anelli: componiAnelli(c.vie.map(id => d.vie[id]).filter(Boolean)) }));
  return { fonte: 'osm', linee, comuni };
}
function daISTAT(fc) {
  const comuni = fc.features.map(f => {
    const g = f.geometry, poli = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    return { nome: f.properties.nome, anelli: poli.flat().map(r => r.map(([lon, lat]) => [lat, lon])) };
  });
  return { fonte: 'istat', linee: comuni.flatMap(c => c.anelli), comuni };
}

// punto dentro il comune (pari/dispari su tutti gli anelli: i buchi si escludono da soli)
function dentro(lat, lon, anelli) {
  let in_ = false;
  for (const r of anelli) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [yi, xi] = r[i], [yj, xj] = r[j];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) in_ = !in_;
    }
  }
  return in_;
}
const comuneDi = (lat, lon) => S.comuni?.comuni.find(c => dentro(lat, lon, c.anelli))?.nome || null;

// etichetta del comune: prima si cerca dentro la zona del percorso, poi un po' più in largo
function puntoEtichetta(c) {
  const k = Math.cos(42.12 * Math.PI / 180), tutto = L.latLngBounds(S.traccia.latlngs());
  for (const pad of [-0.12, 0.06]) {
    const b = tutto.pad(pad), s = b.getSouth(), w = b.getWest(), n = b.getNorth(), e = b.getEast();
    const bordo = [];
    for (const r of c.anelli) {
      const passo = Math.max(1, Math.floor(r.length / 600));
      for (let i = 0; i < r.length; i += passo) { const [la, lo] = r[i]; if (la > s - .03 && la < n + .03 && lo > w - .03 && lo < e + .03) bordo.push(r[i]); }
    }
    let best = null, bestD = 0;
    const N = 30;
    for (let iy = 1; iy < N; iy++) for (let ix = 1; ix < N; ix++) {
      const la = s + (n - s) * iy / N, lo = w + (e - w) * ix / N;
      if (!dentro(la, lo, c.anelli)) continue;
      let m = Infinity;
      for (const p of bordo) { const dy = p[0] - la, dx = (p[1] - lo) * k; const q = dy * dy + dx * dx; if (q < m) m = q; }
      // vicino al percorso l'etichetta coprirebbe la traccia: si preferisce un poco più in là
      if (S.traccia.proietta(la, lo).d < 400) m *= .3;
      if (m > bestD) { bestD = m; best = [la, lo]; }
    }
    if (best) return best;
  }
  return null;
}

function disegnaComuni() {
  layers.comuni.clearLayers();
  const C = S.comuni; if (!C) return;
  for (const l of C.linee) {
    L.polyline(l, { pane: 'confini', color: '#fff', weight: 5, opacity: .75, interactive: false }).addTo(layers.comuni);
    L.polyline(l, { pane: 'confini', color: '#6b2fa0', weight: 2.5, opacity: 1, dashArray: '7 4', interactive: false }).addTo(layers.comuni);
  }
  for (const c of C.comuni) {
    const p = puntoEtichetta(c); if (!p) continue;
    L.marker(p, { pane: 'etichette', interactive: false, keyboard: false, icon: L.divIcon({ className: 'mk-comune', iconSize: [0, 0], html: `<span>${esc(c.nome)}</span>` }) }).addTo(layers.comuni);
  }
  const sorg = C.fonte === 'osm' ? 'Confini © OpenStreetMap' : 'Confini ISTAT 2026 (indicativi)';
  map.attributionControl.removeAttribution('Confini © OpenStreetMap').removeAttribution('Confini ISTAT 2026 (indicativi)').addAttribution(sorg);
}

async function caricaComuni() {
  const osm = comuniOSM();
  // mentre OpenStreetMap risponde (può volerci un po') si mostrano subito i confini ISTAT
  try { const istat = await (await fetch('comuni-istat.json')).json(); if (!S.comuni) { S.comuni = daISTAT(istat); disegnaComuni(); aggiornaScheda(); } } catch {}
  const d = await osm;
  if (d) { S.comuni = daOSM(d); disegnaComuni(); aggiornaScheda(); }
}

/* ============================================================ posizione */
function avviaGps() {
  if (S.gpsAttivo) return;
  if (!('geolocation' in navigator)) { S.errore = 'Questo browser non permette di leggere la posizione.'; aggiornaScheda(); return; }
  S.gpsAttivo = true; S.errore = null; aggiornaScheda();
  LS.set('gps', '1');
  navigator.geolocation.watchPosition(p => {
    S.me = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() };
    S.errore = null;
    disegnaMe();
    aggiornaScheda();
  }, e => {
    if (e.code === 1) { S.errore = 'nega'; S.gpsAttivo = false; LS.set('gps', '0'); }
    else if (!S.me) S.errore = e.code === 3 ? 'Il GPS non risponde ancora: resta all\'aperto, riprovo da solo.' : 'Posizione non disponibile: controlla che la localizzazione del telefono sia accesa.';
    aggiornaScheda();
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
}

// punto del percorso più vicino; nel tratto fatto due volte si danno sia l'andata sia il ritorno
function vicinoAlPercorso(lat, lon) {
  const tr = S.traccia, pr = tr.proietta(lat, lon);
  const out = { d: pr.d, km: [pr.km], punto: tr.at(pr.km) };
  if (tr.comune.length > 1 && tr.nelTrattoComune(pr.km)) {
    const [a, b] = tr.comune[0], [c, d] = tr.comune[1];
    const and = tr.proietta(lat, lon, a, b), rit = tr.proietta(lat, lon, c, d);
    if (Math.abs(and.d - rit.d) < 40) out.km = [and.km, rit.km];
  }
  return out;
}

function disegnaMe() {
  const me = S.me, ll = [me.lat, me.lon];
  const v = vicinoAlPercorso(me.lat, me.lon), pv = [v.punto[0], v.punto[1]];
  if (!mkMe) {
    cerchioMe = L.circle(ll, { pane: 'me', radius: me.acc, color: '#1a73e8', weight: 1, fillOpacity: .12, interactive: false }).addTo(map);
    lineaMe = L.polyline([ll, pv], { pane: 'me', color: '#1a73e8', weight: 3, dashArray: '6 6', opacity: .9, interactive: false }).addTo(map);
    mkMe = L.marker(ll, { pane: 'me', icon: L.divIcon({ className: 'mk-me', iconSize: [20, 20], iconAnchor: [10, 10], html: '<div></div>' }), keyboard: false })
      .bindTooltip('Tu', { className: 'tip' }).addTo(map);
    $('#btnSegui').hidden = false;
  } else { mkMe.setLatLng(ll); cerchioMe.setLatLng(ll).setRadius(me.acc); lineaMe.setLatLngs([ll, pv]); }
  lineaMe.setStyle({ opacity: v.d > 25 ? .9 : 0 });
  if (S.primoFix) {
    S.primoFix = false; S.segui = true; $('#btnSegui').classList.add('attivo');
    const b = L.latLngBounds([ll, pv]);
    if (v.d < 60) map.setView(ll, 16);
    else if (v.d < 15000) map.fitBounds(b, { paddingTopLeft: [50, 50], paddingBottomRight: [80, spazioScheda() + 20], maxZoom: 17 });
    else map.setView(ll, 13);
  } else if (S.segui) map.panTo(ll);
}

/* ============================================================ scheda */
function aggiornaScheda() {
  const el = $('#scheda');
  const nota = '<p class="nota">La posizione resta sul tuo telefono: non viene inviata a nessuno.</p>';
  if (S.errore === 'nega') {
    el.innerHTML = `<p class="titolo">Posizione non consentita</p>
      <p class="sotto">Per vederti sulla mappa consenti l'accesso alla posizione per questo sito nelle impostazioni del browser, poi riprova.</p>
      <button class="btn" id="btnGps" type="button">Riprova</button>${nota}`;
  } else if (!S.gpsAttivo && !S.me) {
    el.innerHTML = `<p class="titolo">Dove sei rispetto al percorso?</p>
      <p class="sotto">Attiva la posizione per vederti sulla mappa della gara.</p>
      <button class="btn" id="btnGps" type="button">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" fill="currentColor"/></svg>
        Trova la mia posizione</button>${nota}`;
  } else if (!S.me) {
    el.innerHTML = `<p class="titolo">Cerco la tua posizione…</p>
      <p class="sotto ${S.errore ? 'errore' : ''}">${esc(S.errore || 'Se il telefono lo chiede, consenti l\'accesso alla posizione.')}</p>`;
  } else {
    const me = S.me, v = vicinoAlPercorso(me.lat, me.lon);
    const soglia = Math.max(20, Math.min(me.acc, 50));
    const sul = v.d <= soglia;
    const verso = cardinale(bearing([me.lat, me.lon], [v.punto[0], v.punto[1]]));
    const k1 = km => fmtKm(Math.round(km * 10) / 10);
    const kmTxt = v.km.length > 1
      ? `km ${k1(v.km[0])} all'andata, km ${k1(v.km[1])} al ritorno`
      : `km ${k1(v.km[0])}`;
    const comune = S.comuni ? (comuneDi(me.lat, me.lon) || 'fuori dai comuni del percorso') : '…';
    el.innerHTML = `<p class="titolo">${sul ? 'Sei sul percorso' : `Sei a ${fmtDist(v.d)} dal percorso`}</p>
      ${sul ? '' : `<p class="sotto">Il punto più vicino del percorso è verso ${verso}.</p>`}
      <dl class="righe">
        <dt>${sul ? 'Sei al' : 'Più vicino al'}</dt><dd>${kmTxt}</dd>
        <dt>Sentiero</dt><dd>${esc(S.traccia.sentiero(v.km[0]))}</dd>
        <dt>Comune</dt><dd>${esc(comune)}</dd>
        <dt>Precisione</dt><dd>± ${Math.round(me.acc)} m${me.acc > 100 ? ' (approssimativa)' : ''}</dd>
      </dl>`;
  }
  $('#btnGps')?.addEventListener('click', () => { S.errore = null; S.gpsAttivo = false; avviaGps(); });
  document.documentElement.style.setProperty('--spazio-scheda', spazioScheda() + 'px');
}

/* ============================================================ comandi */
function collegaComandi() {
  $('#btnTutto').addEventListener('click', () => { S.segui = false; $('#btnSegui').classList.remove('attivo'); inquadraPercorso(); });
  $('#btnSegui').addEventListener('click', () => {
    if (!S.me) return;
    S.segui = true; $('#btnSegui').classList.add('attivo');
    map.setView([S.me.lat, S.me.lon], Math.max(map.getZoom(), 16));
  });
  const menu = $('#livelli'), btn = $('#btnLivelli');
  btn.addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); });
  document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); btn.focus(); } });
  const base = LS.get('base', 'satellite');
  menu.querySelectorAll('input[name=base]').forEach(r => {
    r.checked = r.value === base;
    r.addEventListener('change', () => {
      Object.values(layers.base).forEach(l => l.remove());
      layers.base[r.value].addTo(map); layers.base[r.value].bringToBack(); LS.set('base', r.value);
    });
  });
  menu.querySelectorAll('input[type=checkbox]').forEach(c => {
    const lay = layers[c.value];
    c.checked = map.hasLayer(lay);
    c.addEventListener('change', () => { if (c.checked) lay.addTo(map); else lay.remove(); LS.set('ov:' + c.value, c.checked ? '1' : '0'); });
  });
  new ResizeObserver(() => document.documentElement.style.setProperty('--spazio-scheda', spazioScheda() + 'px')).observe($('#scheda'));
}

/* ============================================================ avvio */
async function avvia() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  S.traccia = new Traccia(await (await fetch('traccia.json')).json());
  aggiornaScheda();
  creaMappa();
  collegaComandi();
  caricaComuni();
  // chi ha già dato il permesso ritrova subito la posizione
  try {
    const st = await navigator.permissions?.query({ name: 'geolocation' });
    if (st?.state === 'granted' || LS.get('gps') === '1' && st?.state !== 'denied') avviaGps();
  } catch { if (LS.get('gps') === '1') avviaGps(); }
}
avvia();

// per le prove
window.SRMPOS = { S, get map() { return map; }, finta(lat, lon, acc = 8) { S.gpsAttivo = true; S.me = { lat, lon, acc, t: Date.now() }; disegnaMe(); aggiornaScheda(); } };
