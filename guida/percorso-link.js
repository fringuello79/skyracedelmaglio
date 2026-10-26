// Percorso da un link di Google Maps (indicazioni): tappe → percorso a piedi → svolte → luoghi d'interesse.
// Tutto avviene sul telefono con servizi aperti (OpenStreetMap, Wikipedia); il risultato resta in memoria.
import { Traccia, dist } from '../posizione/geo.js';

const attesa = ms => new Promise(r => setTimeout(r, ms));
async function json(url, opz = {}, prove = 2) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, opz);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { if (i >= prove) throw e; await attesa(800 * (i + 1)); }
  }
}

// ---------- link ----------
// https://www.google.com/maps/dir/?api=1&origin=…&destination=…&waypoints=A|B|C&travelmode=walking
// https://www.google.com/maps/dir/A/B/C/
export function leggiLink(testo) {
  const t = String(testo || '').trim();
  let u;
  try { u = new URL(t); } catch { throw new Error('Non è un link valido.'); }
  const p = u.searchParams;
  let tappe = [];
  if (p.get('origin') || p.get('destination')) {
    tappe = [p.get('origin'), ...(p.get('waypoints') || '').split('|'), p.get('destination')];
  } else {
    const m = u.pathname.match(/\/maps\/dir\/(.+)/);
    if (m) tappe = m[1].split('/').filter(x => x && !x.startsWith('@') && !x.startsWith('data='));
  }
  tappe = tappe.map(x => decodeURIComponent(String(x || '').replace(/\+/g, ' ')).trim()).filter(Boolean);
  if (tappe.length < 2) throw new Error('Nel link non trovo partenza e arrivo.');
  return tappe;
}

// ---------- tappe → coordinate ----------
// «Nome @ 41.8634, 12.5209»: coordinate certe con il nome da annunciare
const RE_COORD = /@?\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/;
const coordInTesto = s => { const m = String(s).match(RE_COORD); return m ? { lat: +m[1], lon: +m[2] } : null; };
const nomePulito = s => String(s).replace(RE_COORD, '').replace(/[\s,@]+$/, '').trim() || String(s);
// zona = { lat, lon, km }: con `vincolo` si accettano solo risultati entro quei km (stesso nome altrove = scartato)
const lontano = (p, zona) => zona && dist([p.lat, p.lon], [zona.lat, zona.lon]) / 1000 > zona.km;
async function geocodifica(nome, zona = null, vincolo = false) {
  const c = coordInTesto(nome);
  if (c) return { ...c, fonte: 'coordinate' };
  const q = encodeURIComponent(nome);
  const ok = p => p && !(vincolo && lontano(p, zona));
  const box = zona ? (() => { const dl = zona.km / 111, dg = zona.km / (111 * Math.cos(zona.lat * Math.PI / 180));
    return `&viewbox=${(zona.lon - dg).toFixed(4)},${(zona.lat + dl).toFixed(4)},${(zona.lon + dg).toFixed(4)},${(zona.lat - dl).toFixed(4)}${vincolo ? '&bounded=1' : ''}`; })() : '';
  // 1. OpenStreetMap (Nominatim)
  try {
    const r = await json(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=it&q=${q}${box}`);
    const p = r.map(x => ({ lat: +x.lat, lon: +x.lon, fonte: 'OpenStreetMap' })).find(ok);
    if (p) return p;
  } catch { /* si prova il servizio successivo */ }
  // 2. Photon (OpenStreetMap, ricerca più tollerante); con la zona, i risultati vicini vengono prima
  try {
    const bias = zona ? `&lat=${zona.lat}&lon=${zona.lon}&location_bias_scale=0.9` : '';
    const r = await json(`https://photon.komoot.io/api/?limit=5&q=${q}${bias}`);
    const p = (r.features || []).map(f => ({ lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], fonte: 'Photon' })).find(ok);
    if (p) return p;
  } catch { /* si prova Wikipedia */ }
  // 3. Wikipedia (coordinate della voce)
  try {
    const solo = nome.split(',')[0];
    const r = await json(`https://it.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=5&gsrsearch=${encodeURIComponent(solo)}&prop=coordinates`);
    const p = Object.values(r.query?.pages || {}).sort((a, b) => a.index - b.index)
      .filter(pg => pg.coordinates?.[0]).map(pg => ({ lat: pg.coordinates[0].lat, lon: pg.coordinates[0].lon, fonte: 'Wikipedia' })).find(ok);
    if (p) return p;
  } catch { /* nessun risultato */ }
  return null;
}
const mediana = v => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

// ---------- percorso a piedi ----------
const AZ_OSRM = { 'left': 'gira-sx', 'right': 'gira-dx', 'slight left': 'tieni-sx', 'slight right': 'tieni-dx',
  'sharp left': 'stretta-sx', 'sharp right': 'stretta-dx', 'uturn': 'stretta-dx', 'straight': 'dritto' };

async function percorsoOsrm(punti) {
  const c = punti.map(p => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const r = await json(`https://routing.openstreetmap.de/routed-foot/route/v1/driving/${c}?overview=full&geometries=geojson&steps=true`);
  if (r.code !== 'Ok' || !r.routes?.[0]) throw new Error('nessun percorso');
  const rt = r.routes[0];
  const ll = rt.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  // svolte dalle istruzioni del percorso: il chilometro è la somma dei tratti precedenti
  const svolte = []; let km = 0;
  rt.legs.forEach((leg, li) => leg.steps.forEach(st => {
    const m = st.maneuver, tipo = m.type;
    const az = AZ_OSRM[m.modifier];
    const conta = !['depart', 'arrive'].includes(tipo) && az && (az !== 'dritto' || tipo === 'fork');
    if (conta && !(tipo === 'new name' && /^tieni/.test(az))) {
      svolte.push({ km: Math.round(km) / 1000, azione: az === 'dritto' ? 'auto' : az, via: st.name || '', tipoOsrm: tipo });
    }
    km += st.distance;
  }));
  return { ll, svolte, fonte: 'OSRM' };
}

// Valhalla (riserva): solo la linea; le svolte si ricavano dalla forma
function polyline6(s) {
  const out = []; let i = 0, lat = 0, lon = 0;
  while (i < s.length) {
    for (const k of [0, 1]) {
      let r = 0, sh = 0, b;
      do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
      const d = r & 1 ? ~(r >> 1) : r >> 1;
      if (k === 0) lat += d; else lon += d;
    }
    out.push([lat / 1e6, lon / 1e6]);
  }
  return out;
}
async function percorsoValhalla(punti) {
  const body = { locations: punti.map(p => ({ lat: p.lat, lon: p.lon, type: 'break_through' })), costing: 'pedestrian', directions_options: { language: 'it-IT' } };
  body.locations[0].type = body.locations.at(-1).type = 'break';
  const r = await json('https://valhalla1.openstreetmap.de/route', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
  const ll = r.trip.legs.flatMap(l => polyline6(l.shape));
  return { ll, svolte: null, fonte: 'Valhalla' };
}

function tracciaDaPunti(ll) {
  let km = 0;
  const pts = [];
  ll.forEach((p, i) => {
    if (i) km += dist(ll[i - 1], p) / 1000;
    if (!pts.length || km - pts.at(-1)[3] > 0.0005) pts.push([p[0], p[1], 0, Math.round(km * 1000) / 1000]);
  });
  return { pts, km_tot: pts.at(-1)[3], comune: [], sentieri: [] };
}

// ---------- luoghi d'interesse (Wikipedia) ----------
const NON_LUOGHI = /\((zona|quartiere|rione|suburbio)\b|^(via|viale|vicolo|piazza|piazzale|largo|lungotevere|circonvallazione|stazione|fermata|scuola|istituto|liceo|ospedale)\b|quartiere|rione|zona urbanistica|suburbio|\(metropolitana|linea [a-c] |municipio/i;
function frase1(testo) {
  let t = String(testo || '').replace(/\s*\([^()]*\)/g, '').replace(/\s*\([^()]*\)/g, '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.{40,}?[.;])\s/);
  if (m) t = m[1];
  if (t.length > 200) t = t.slice(0, 200).replace(/\s+\S*$/, '') + '…';
  return t.replace(/[;…]$/, '.');
}
async function luoghiLungo(traccia, avanza) {
  const T = traccia, visti = new Map();
  const campioni = [];
  for (let k = 0; k <= T.kmTot; k += 0.35) campioni.push(T.at(k));
  campioni.push(T.at(T.kmTot));
  for (let i = 0; i < campioni.length; i += 5) {
    avanza?.(`Cerco i luoghi d'interesse… ${Math.min(100, Math.round(i / campioni.length * 100))}%`);
    const lotto = campioni.slice(i, i + 5).map(p =>
      json(`https://it.wikipedia.org/w/api.php?action=query&format=json&origin=*&list=geosearch&gsradius=220&gslimit=30&gscoord=${p[0].toFixed(5)}|${p[1].toFixed(5)}`)
        .then(r => r.query?.geosearch || []).catch(() => []));
    for (const lista of await Promise.all(lotto)) for (const g of lista) if (!visti.has(g.pageid)) visti.set(g.pageid, g);
  }
  // vicini al percorso, non vie né quartieri; uno ogni 150 m di percorso (il più vicino)
  let cand = [...visti.values()].filter(g => !NON_LUOGHI.test(g.title)).map(g => {
    const p = T.proietta(g.lat, g.lon);
    return { pageid: g.pageid, nome: g.title, lat: g.lat, lon: g.lon, km: p.km, d: p.d };
  }).filter(c => c.d <= 130).sort((a, b) => a.km - b.km);
  const scelti = [];
  for (const c of cand) {
    const u = scelti.at(-1);
    if (u && c.km - u.km < 0.15) { if (c.d < u.d) scelti[scelti.length - 1] = c; }
    else scelti.push(c);
  }
  // una frase di descrizione per ciascuno
  for (let i = 0; i < scelti.length; i += 20) {
    const ids = scelti.slice(i, i + 20).map(c => c.pageid).join('|');
    try {
      const r = await json(`https://it.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=extracts&exintro=1&explaintext=1&exsentences=2&exlimit=20&pageids=${ids}`);
      for (const pg of Object.values(r.query?.pages || {})) {
        const c = scelti.find(x => x.pageid === pg.pageid);
        if (c) c.testo = frase1(pg.extract);
      }
    } catch { /* senza descrizione */ }
  }
  return scelti;
}

// ---------- controlli: tratti ripetuti ----------
// Un punto è "ripetuto" se a meno di 12 m passa un'altra parte del percorso lontana almeno 300 m lungo la traccia.
export function trattiRipetuti(traccia) {
  const T = traccia, K = T.kmTot, passo = 0.01, tratti = [];
  for (let k = 0.1; k <= K - 0.1; k += passo) {
    const [la, lo] = T.at(k);
    const a = k - 0.3 > 0 ? T.proietta(la, lo, 0, k - 0.3) : { d: Infinity };
    const b = k + 0.3 < K ? T.proietta(la, lo, k + 0.3, K) : { d: Infinity };
    if (Math.min(a.d, b.d) < 12) {
      const u = tratti.at(-1);
      if (u && k - u.a <= passo * 1.5) u.a = k; else tratti.push({ da: k, a: k });
    }
  }
  const metri = Math.round(tratti.reduce((s, t) => s + (t.a - t.da) * 1000 + 10, 0) / 2);   // ogni tratto si conta due volte
  return { metri, tratti: tratti.filter(t => t.a - t.da >= 0.03) };
}

// ---------- GPX ----------
const xml = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
export function gpxDaPacchetto(pk) {
  const wpt = [
    ...pk.tappe.map((t, i) => `<wpt lat="${t.lat.toFixed(6)}" lon="${t.lon.toFixed(6)}"><name>${xml(`${i + 1}. ${t.nome.split(',')[0]}`)}</name><type>tappa</type></wpt>`),
    ...pk.bivi.filter(b => b.tipo === 'luogo').map(b => `<wpt lat="${b.plat.toFixed(6)}" lon="${b.plon.toFixed(6)}"><name>${xml(b.nome)}</name><desc>${xml(b.testo)}</desc><type>luogo</type></wpt>`),
  ];
  const trk = pk.traccia.pts.map(p => `<trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Guida vocale SRM" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${xml(pk.nome)}</name><desc>${xml(`${pk.traccia.km_tot.toFixed(2)} km · percorso a piedi da OpenStreetMap (${pk.fonte})`)}</desc></metadata>
${wpt.join('\n')}
<trk><name>${xml(pk.nome)}</name><trkseg>
${trk}
</trkseg></trk>
</gpx>
`;
}

// ---------- tutto insieme ----------
export async function preparaDaLink(link, avanza = () => {}) {
  const tappe = leggiLink(link);
  const punti = [];
  // 1° giro: ogni tappa, preferendo la zona della prima trovata
  for (let i = 0; i < tappe.length; i++) {
    avanza(`Cerco le tappe sulla mappa… ${i + 1}/${tappe.length}: ${tappe[i]}`);
    const uguale = tappe.findIndex(t => t === tappe[i]);
    const zona = punti[0] ? { lat: punti[0].lat, lon: punti[0].lon, km: 15 } : null;
    let p = uguale < i ? { ...punti[uguale] } : await geocodifica(tappe[i], zona);
    if (!p) throw new Error(`Non trovo sulla mappa la tappa «${tappe[i]}».`);
    punti.push({ ...p, nome: nomePulito(tappe[i]) });
    if (uguale === i && p.fonte !== 'coordinate') await attesa(1100);   // regola d'uso di Nominatim: una richiesta al secondo
  }
  // 2° giro: una tappa lontana dalle altre è quasi sempre un omonimo (es. un'altra «Vaccareccia» a 40 km):
  // la si ricerca solo entro 6 km dal centro delle altre
  for (let i = 0; i < punti.length; i++) {
    const altri = punti.filter((_, j) => j !== i);
    const centro = { lat: mediana(altri.map(p => p.lat)), lon: mediana(altri.map(p => p.lon)), km: 6 };
    if (!lontano(punti[i], centro) || punti[i].fonte === 'coordinate') continue;
    avanza(`La tappa «${tappe[i]}» risulta lontana dalle altre: la ricerco nella zona giusta…`);
    await attesa(1100);
    const p = await geocodifica(tappe[i], centro, true);
    if (!p) throw new Error(`La tappa «${tappe[i]}» risulta lontana dalle altre e non la trovo vicino. Scrivila in modo più preciso o mettine le coordinate (es. 41.8634, 12.5209).`);
    punti[i] = { ...p, nome: nomePulito(tappe[i]) };
  }
  avanza('Calcolo il percorso a piedi…');
  let r;
  try { r = await percorsoOsrm(punti); }
  catch { avanza('Primo servizio non disponibile, provo il secondo…'); r = await percorsoValhalla(punti); }
  const dati = tracciaDaPunti(r.ll);
  const traccia = new Traccia(dati);
  // bivi: svolte del percorso, con il nome della via
  let bivi = [];
  if (r.svolte) {
    let n = 0;
    for (const s of r.svolte) {
      if (s.km < 0.02 || s.km > traccia.kmTot - 0.02) continue;
      const u = bivi.at(-1);
      if (u && s.km - u.km < 0.02) continue;     // due istruzioni nello stesso punto
      n++;
      bivi.push({ id: 'R' + String(n).padStart(2, '0'), tipo: 'bivio', km: s.km, azione: s.azione, fonte: 'percorso',
        segno: s.via && !/^(sentiero|vialetto|marciapiede)$/i.test(s.via) ? s.via : undefined });
    }
  }
  // tappe come luoghi da annunciare (se non sono indirizzi)
  avanza('Cerco i luoghi d\'interesse…');
  let luoghi = [];
  try { luoghi = await luoghiLungo(traccia, avanza); } catch { /* si va anche senza */ }
  punti.forEach((p, i) => {
    if (i === 0 || i === punti.length - 1 || /\d/.test(p.nome) || /^(via|viale|piazza)\b/i.test(p.nome)) return;
    const pr = traccia.proietta(p.lat, p.lon);
    const nome = p.nome.split(',')[0];
    if (!luoghi.some(l => dist([l.lat, l.lon], [p.lat, p.lon]) < 90 || l.nome.toLowerCase().includes(nome.toLowerCase())))
      luoghi.push({ nome, lat: p.lat, lon: p.lon, km: pr.km, d: pr.d, testo: '' });
  });
  luoghi.sort((a, b) => a.km - b.km);
  luoghi.forEach((l, i) => bivi.push({ id: 'L' + String(i + 1).padStart(2, '0'), tipo: 'luogo', km: Math.round(l.km * 1000) / 1000,
    nome: l.nome, plat: l.lat, plon: l.lon, testo: l.testo || '', fonte: 'wikipedia' }));
  bivi.sort((a, b) => a.km - b.km);
  const nome = punti.length > 2 ? punti.slice(1, -1).map(t => t.nome.split(',')[0]).slice(0, 3).join(', ') : punti.at(-1).nome.split(',')[0];
  const rip = trattiRipetuti(traccia);
  // controllo: un percorso a piedi è di solito 1,1-1,6 volte la somma delle linee d'aria tra le tappe
  const aria = punti.slice(1).reduce((t, p, i) => t + dist([punti[i].lat, punti[i].lon], [p.lat, p.lon]) / 1000, 0);
  if (aria > 0 && traccia.kmTot > 2.2 * aria) throw new Error(`il percorso calcolato (${traccia.kmTot.toFixed(1)} km) è anomalo rispetto alle tappe (${aria.toFixed(1)} km in linea d'aria). Controlla le tappe del link`);
  return { nome, link, tappe: punti, traccia: dati, bivi, fonte: r.fonte, ripetuti: rip, creato: new Date().toISOString() };
}
