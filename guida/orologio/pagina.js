// Pagina del simulatore: orologio, mappa della rete, sala controllo.
import { Traccia, bearing } from '../../posizione/geo.js';
import { Simulatore } from '../simulatore.js';
import { Terreno, APPARATI, PRESET, sensibilita, collegamento, BOSCO } from './radio.js';
import { creaGara, Andature } from './gara.js';
import { AppOrologio, W, H, CONSUMI } from './orologio.js';
import { MappaOrologio } from './mappa-orologio.js';

const $ = id => document.getElementById(id);
const fmt = (n, d = 0) => n.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });
const oraTesto = ms => { const s = 9 * 3600 + Math.floor(ms / 1000); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`; };

// ---------- dati ----------
const [tracciaJ, biviJ, reteJ, demJ, demB] = await Promise.all([
  fetch('../../posizione/traccia.json').then(r => r.json()),
  fetch('../bivi-srm2026.json').then(r => r.json()),
  fetch('rete.json').then(r => r.json()),
  fetch('dem.json').then(r => r.json()),
  fetch('dem.bin').then(r => r.arrayBuffer()),
]);
const traccia = new Traccia(tracciaJ);
const terreno = new Terreno(demJ, new Int16Array(demB));
const bivi = biviJ.bivi;
const nodiBase = reteJ.nodi.map(n => ({ ...n }));
const cartografia = new MappaOrologio(traccia, terreno);
let aggiunti = 0;

// ---------- stato ----------
let ora = 0, inCorso = false, accumulo = 0, ultimoFrame = performance.now();
let gara, app, sim, kmPartenza = 0;
const stato = { attivi: new Set(nodiBase.filter(n => n.attivo).map(n => n.id)) };

function opzioniRete() {
  return { preset: $('sel-preset').value, intervallo: +$('sel-int').value * 1000, hop: +$('sel-hop').value, atleti: $('sel-atleti').value === '1' };
}

function nuovaApp() {
  app = new AppOrologio(traccia, bivi, { consumi: $('sel-consumi').value, sempreAcceso: $('c-acceso').checked });
  app.onVoce = parla; app.onVibra = vibra; app.onDiario = disegnaDiario;
  app.cartografia = cartografia; app.ridisegna = () => disegna();
  sim = new Simulatore(traccia, { km: kmPartenza, velocita: +$('sel-passo').value, rumore: 4, precisione: 6, seme: 1 + Math.floor(Math.random() * 1e5) });
}

function nuovaRete() {
  const o = opzioniRete();
  const dati = { ...reteJ, nodi: nodiBase };
  gara = creaGara(terreno, traccia, dati, { ...o, attivi: [...stato.attivi], t0: ora, seme: 1 + Math.floor(Math.random() * 1e5) });
  app.rete.ultimaConferma = null;
  app.collegaRete(gara.rete, o, APPARATI.orologio);
  gara.rete.osservatori.push(disegnaPacchetto);
  ridisegnaNodi(); copertura(); aggiornaSala();
}

// ---------- voce e vibrazione ----------
let voceIt = null;
function scegliVoce() {
  const v = speechSynthesis?.getVoices?.() || [];
  const it = v.filter(x => /^it/i.test(x.lang) && !/elsa|cosimo/i.test(x.name));
  voceIt = it.find(x => /alice/i.test(x.name)) || it[0] || null;
}
if ('speechSynthesis' in window) { scegliVoce(); speechSynthesis.onvoiceschanged = scegliVoce; }
function parla(testo, e) {
  if (!$('c-voce').checked || +$('sel-vel').value > 5 || !('speechSynthesis' in window)) return;
  const urgente = ['fuori', 'sbagliato', 'indietro', 'sos', 'sos-ok'].includes(e.tipo);
  if (urgente) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(testo); u.lang = 'it-IT'; if (voceIt) u.voice = voceIt; u.rate = 1.05;
  speechSynthesis.speak(u);
}
let timerVibra = null;
function vibra(nome, schema) {
  const c = $('cassa'); c.classList.remove('vibra'); void c.offsetWidth; c.classList.add('vibra');
  $('etichetta-vibra').textContent = `vibrazione: ${app.vibra?.testo || nome}`;
  clearTimeout(timerVibra); timerVibra = setTimeout(() => { $('etichetta-vibra').textContent = ''; }, 2500);
  try { navigator.vibrate?.(schema); } catch { /* iPhone: non vibra */ }
}

// ---------- schermo ----------
const cv = $('schermo'), ctx = cv.getContext('2d');
function preparaCanvas() {
  const r = Math.min(3, window.devicePixelRatio || 1);
  cv.width = W * r; cv.height = H * r; ctx.setTransform(r, 0, 0, r, 0, 0);
}
preparaCanvas();
let tocco = null;
cv.addEventListener('pointerdown', e => { tocco = { x: e.clientX, t: performance.now() }; });
cv.addEventListener('pointerup', e => {
  if (!tocco) return; const dx = e.clientX - tocco.x; tocco = null;
  if (Math.abs(dx) > 40 && app.acceso) app.scorri(dx < 0 ? 1 : -1); else app.tocca();
  disegna();
});
// pulsante: premuto breve = modalità mappa sì/no; tenuto 3 s = SOS; durante il conto alla rovescia = annulla
function pulsante(el) {
  let timer = null, lungo = false;
  el.addEventListener('pointerdown', e => {
    e.preventDefault(); lungo = false;
    if (app.sos.stato === 'conto') { app.annullaSos(); disegna(); return; }
    timer = setTimeout(() => { lungo = true; app.avviaConto(performance.now()); disegna(); }, 3000);
  });
  const fine = () => { if (!timer) return; clearTimeout(timer); timer = null; if (!lungo) { app.pulsante(); disegna(); } };
  el.addEventListener('pointerup', fine); el.addEventListener('pointerleave', () => { if (timer) { clearTimeout(timer); timer = null; } });
  el.addEventListener('contextmenu', e => e.preventDefault());
}
pulsante($('tasto')); pulsante($('b-pulsante'));
$('b-polso').onclick = () => { app.alzaPolso(); disegna(); };
$('b-sbaglia').onclick = () => {
  const p = app.motore.prossimoBivio(); if (!p) return;
  const b = app.motore.bivi.find(x => x.id === p.b.id && x.tipo === 'bivio') || app.motore.bivi.find(x => x.tipo === 'bivio' && x.km > (app.km ?? 0));
  if (b) { sim.sbagliaAl(b); app._log(`(prova) sbaglierai al bivio del km ${fmt(b.km, 1)}`); }
};
$('b-fuori').onclick = () => {
  if (sim.modo !== 'traccia') return;
  const dir = traccia.direzioneDopo(sim.km, 0.05);
  sim.dev = { origine: traccia.at(sim.km).slice(0, 2), verso: dir + 80, fatto: 0, lungo: 110, km: sim.km }; sim.modo = 'andata';
  app._log('(prova) esci dal sentiero verso destra');
};

// ---------- simulazione ----------
function passoSecondo() {
  ora += 1000;
  const f = sim.finito() ? null : sim.passo(1);
  const fix = f ? { lat: f.lat, lon: f.lon, acc: f.acc, t: ora } : null;
  app.secondo(fix, ora);
  gara.rete.avanza(ora);
}
function ciclo(now) {
  const dt = Math.min(250, now - ultimoFrame); ultimoFrame = now;
  if (inCorso) {
    accumulo += dt * +$('sel-vel').value;
    let n = 0;
    while (accumulo >= 1000 && n < 400) { accumulo -= 1000; passoSecondo(); n++; }
    if (ora >= 8 * 3600e3) { inCorso = false; $('b-via').textContent = '▶ Riprendi'; }
  } else {
    app._sosOgniSecondo(now);      // il conto alla rovescia va anche in pausa
  }
  disegna();
  requestAnimationFrame(ciclo);
}
function disegna() {
  app.disegna(ctx, performance.now());
  const st = app.motore.stato();
  $('riga-stato').innerHTML = `<span>ore <b>${oraTesto(ora)}</b></span><span>km <b>${st.km != null ? fmt(st.km, 2) : '—'}</b></span>` +
    `<span>batteria <b>${fmt(app.batteria(), 0)}%</b>${app.batteriaA8ore() != null ? ` · a 8 ore <b>${fmt(app.batteriaA8ore(), 0)}%</b>` : ''}</span>` +
    `<span>schermo acceso <b>${fmt(100 * app.energia.tSchermo / Math.max(1000, ora - (app.t0 || 0)), 0)}%</b> del tempo${app.energia.tMappa ? `, in modalità mappa <b>${fmt(100 * app.energia.tMappa / Math.max(1000, ora - (app.t0 || 0)), 0)}%</b>` : ''}</span>`;
}
$('b-via').onclick = () => {
  inCorso = !inCorso; $('b-via').textContent = inCorso ? '❚❚ Pausa' : '▶ Riprendi';
  if (inCorso && 'speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(' '); speechSynthesis.speak(u); }
};
$('b-riparti').onclick = () => {
  ora = +$('sel-ora').value * 1000; kmPartenza = Math.max(0, Math.min(traccia.kmTot - 0.1, +$('in-km').value || 0));
  app = null; nuovaApp(); app.t0 = ora; nuovaRete(); disegnaDiario(); disegna();
};
$('sel-ora').onchange = () => {
  // a gara in corso: proponi il km di un atleta di metà classifica a quell'ora
  const t = +$('sel-ora').value * 1000; const med = reteJ.atleti[Math.floor(reteJ.atleti.length / 2)].t * 1000;
  $('in-km').value = fmt(andature.km(t / med), 1).replace(',', '.');
};
for (const id of ['sel-preset', 'sel-int', 'sel-hop', 'sel-atleti']) $(id).onchange = () => nuovaRete();
$('sel-gruppo').onchange = () => {
  const g = $('sel-gruppo').value; if (g === 'libero') return;
  stato.attivi = new Set(nodiBase.filter(n => (n.gruppi || []).includes(g)).map(n => n.id)); nuovaRete();
};
$('sel-consumi').onchange = () => { app.energia.consumi = CONSUMI[$('sel-consumi').value]; };
$('c-acceso').onchange = () => { app.sempreAcceso = $('c-acceso').checked; };
const andature = new Andature(traccia);

// ---------- mappa ----------
const mappa = L.map('mappa', { zoomControl: true, attributionControl: true, preferCanvas: true }).setView([42.13, 13.37], 12);
L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 16, attribution: '© OpenStreetMap, SRTM · OpenTopoMap' }).addTo(mappa);
const strato = { copertura: L.layerGroup().addTo(mappa), nodi: L.layerGroup().addTo(mappa), atleti: L.layerGroup().addTo(mappa), pacchetti: L.layerGroup().addTo(mappa) };
L.polyline(traccia.latlngs(), { color: '#000', weight: 7, opacity: .25 }).addTo(mappa);
mappa.fitBounds(L.latLngBounds(traccia.latlngs()).pad(0.08));

const marcatori = new Map();
function ridisegnaNodi() {
  strato.nodi.clearLayers(); marcatori.clear();
  for (const n of nodiBase) {
    const attivo = n.ruolo === 'BASE' || stato.attivi.has(n.id);
    const corto = n.ruolo === 'BASE' ? 'BASE' : n.nome.split(' · ')[0].replace(/^(Monte|Capanna di|Passo|Controllo|Cimata|Sopra|S\. Maria in Valle) /, '').slice(0, 14);
    const icona = L.divIcon({ className: '', html: `<div class="nodo-icona ${n.ruolo === 'BASE' ? 'base' : ''} ${attivo ? '' : 'spento'}">${corto}</div>`, iconSize: null, iconAnchor: [20, 10] });
    const m = L.marker(n.pos, { icon: icona, zIndexOffset: attivo ? 1000 : 0 }).addTo(strato.nodi);
    m.bindPopup(() => popupNodo(n));
    marcatori.set(n.id, m);
  }
}
function popupNodo(n) {
  const div = document.createElement('div'); div.className = 'popup-nodo';
  const nodo = gara.rete.perId.get(n.id);
  const durata = Math.max(1, ora - gara.rete.t0);
  div.innerHTML = `<b>${n.nome}</b><span>${n.quota} m · ${n.ruolo === 'BASE' ? 'base (riceve)' : 'ripetitore'}</span>${n.nota ? `<span>${n.nota}</span>` : ''}` +
    (nodo ? `<span>canale occupato ${fmt(100 * nodo.sentito / durata, 1)}% · trasmette ${fmt(100 * nodo.ariaTot / durata, 2)}%</span>` : '');
  if (n.ruolo !== 'BASE') {
    const b = document.createElement('button'); b.textContent = stato.attivi.has(n.id) ? 'Spegni questo ripetitore' : 'Accendi questo ripetitore';
    b.onclick = () => { stato.attivi.has(n.id) ? stato.attivi.delete(n.id) : stato.attivi.add(n.id); $('sel-gruppo').value = 'libero'; mappa.closePopup(); nuovaRete(); };
    div.append(b);
  }
  return div;
}
let modoAggiungi = false;
$('b-aggiungi').onclick = () => { modoAggiungi = !modoAggiungi; $('b-aggiungi').textContent = modoAggiungi ? 'Tocca la mappa…' : 'Aggiungi un ripetitore'; };
mappa.on('click', e => {
  if (!modoAggiungi) return;
  modoAggiungi = false; $('b-aggiungi').textContent = 'Aggiungi un ripetitore';
  const id = 'agg' + (++aggiunti), q = Math.round(terreno.quota(e.latlng.lat, e.latlng.lng));
  nodiBase.push({ id, nome: `Ripetitore ${aggiunti}`, ruolo: 'ROUTER', pos: [e.latlng.lat, e.latlng.lng], h: 2, quota: q, gruppi: [], nota: 'aggiunto da te' });
  stato.attivi.add(id); $('sel-gruppo').value = 'libero'; nuovaRete();
});
$('b-centra').onclick = () => { if (app.fix) mappa.setView([app.fix.lat, app.fix.lon], 14); };

// copertura del percorso: margine dell'orologio verso il nodo migliore collegato alla base
function copertura() {
  strato.copertura.clearLayers();
  const sens = sensibilita(PRESET[$('sel-preset').value]);
  const fissi = gara.rete.nodi.filter(n => n.fisso);
  const base = fissi.find(n => n.ruolo === 'BASE');
  // nodi collegati alla base (anche passando per altri ripetitori, entro i salti consentiti)
  const hop = +$('sel-hop').value;
  const collegato = new Map([[base.id, 0]]);
  for (let giro = 0; giro < hop; giro++) for (const a of fissi) {
    if (collegato.has(a.id)) continue;
    for (const [bid, h] of collegato) { const b = gara.rete.perId.get(bid); if (h < hop && collegamento(terreno, a, b).prx - sens >= 6) { collegato.set(a.id, h + 1); break; } }
  }
  let prec = null, col = null, tratto = [];
  const chiudi = () => { if (tratto.length > 1) L.polyline(tratto, { color: col, weight: 6, opacity: .9, interactive: false }).addTo(strato.copertura); };
  let buoni = 0, tot = 0;
  for (let km = 0; km <= traccia.kmTot + 0.001; km += 0.1) {
    const p = traccia.at(Math.min(km, traccia.kmTot));
    const w = { pos: [p[0], p[1]], ...APPARATI.orologio, extra: APPARATI.orologio.extra + (p[2] < BOSCO.sotto ? BOSCO.perdita : 0) };
    let m = -99;
    for (const n of fissi) if (collegato.has(n.id)) m = Math.max(m, collegamento(terreno, w, n).prx - sens);
    const c = m >= 8 ? '#1e9e4a' : m >= 0 ? '#e0a400' : '#d33';
    tot++; if (m >= 8) buoni++;
    if (c !== col) { if (prec) tratto.push(prec); chiudi(); tratto = prec ? [prec] : []; col = c; }
    tratto.push([p[0], p[1]]); prec = [p[0], p[1]];
  }
  chiudi();
  $('msg-mappa').textContent = `Copertura buona sul ${fmt(100 * buoni / tot, 0)}% del percorso con ${[...stato.attivi].filter(id => id !== 'base').length} ripetitori (${$('sel-preset').value}). Tocca un ripetitore per accenderlo o spegnerlo.`;
}

// atleti sulla mappa
const puntiAtleti = new Map(); let mioPunto = null;
function aggiornaAtleti() {
  const durata = gara.opz.intervallo;
  for (const a of gara.atleti) {
    let m = puntiAtleti.get(a.bib);
    const inGara = ora <= a.T && a.attivo;
    if (!inGara) { if (m) { strato.atleti.removeLayer(m); puntiAtleti.delete(a.bib); } continue; }
    const p = a.posizione(ora);
    const x = gara.base.perAtleta.get(a.id); const eta = x?.t != null ? ora - x.t : ora - gara.rete.t0;
    const col = eta <= 2.5 * durata ? '#1e9e4a' : eta <= 600000 ? '#e0a400' : '#d33';
    if (!m) { m = L.circleMarker(p, { radius: 4, weight: 1, color: '#fff', fillOpacity: 1, fillColor: col }).addTo(strato.atleti); m.bindTooltip(`pettorale ${a.bib}`); puntiAtleti.set(a.bib, m); }
    else { m.setLatLng(p); m.setStyle({ fillColor: col }); }
  }
  if (app.fix) {
    if (!mioPunto) mioPunto = L.circleMarker([app.fix.lat, app.fix.lon], { radius: 9, color: '#fff', weight: 3, fillColor: '#2f7de1', fillOpacity: 1 }).addTo(mappa).bindTooltip('Tu');
    else mioPunto.setLatLng([app.fix.lat, app.fix.lon]);
  }
}
// pacchetti: si disegnano quelli dell'orologio e quelli che arrivano alla base
const linee = [];
function disegnaPacchetto(da, r, pkt, t) {
  const mio = pkt.da === 'io';
  if (!r.fisso || (!mio && r.ruolo !== 'BASE' && pkt.tipo !== 'sos')) return;
  if (+$('sel-vel').value > 20 && !mio) return;
  const a = da.fisso ? da.pos : da.posizione(t); if (!a) return;
  const colore = pkt.tipo === 'sos' || pkt.tipo === 'ack' ? '#d33' : mio ? '#2f7de1' : '#FF8102';
  const l = L.polyline([a, r.pos], { color: colore, weight: mio ? 3 : 1.5, opacity: .9, interactive: false, dashArray: da.fisso ? '6 6' : null }).addTo(strato.pacchetti);
  linee.push({ l, fino: performance.now() + (mio ? 2500 : 900) });
  while (linee.length > 60) strato.pacchetti.removeLayer(linee.shift().l);
}
function pulisciPacchetti() { const ora2 = performance.now(); while (linee.length && linee[0].fino < ora2) strato.pacchetti.removeLayer(linee.shift().l); }

// ---------- sala controllo ----------
function carta(v, e, classe = '') { return `<div class="carta ${classe}"><div class="v">${v}</div><div class="e">${e}</div></div>`; }
function aggiornaSala() {
  const b = gara.base, durata = Math.max(1, ora - gara.rete.t0);
  const inGara = gara.atleti.filter(a => ora <= a.T && a.attivo);
  let recenti = 0, vecchi = 0;
  for (const a of inGara) { const x = b.perAtleta.get(a.id); const eta = x?.t != null ? ora - x.t : ora - gara.rete.t0; if (eta <= 300000) recenti++; if (eta > 600000) vecchi++; }
  const mio = b.perAtleta.get('io');
  const etaMio = mio?.t != null ? Math.round((ora - mio.t) / 1000) : null;
  const consegna = b.generati ? 100 * b.ricevuti / b.generati : null;
  const bat8 = app.batteriaA8ore();
  const pIn = inGara.length ? 100 * recenti / inGara.length : 100;
  $('carte').innerHTML =
    carta(`${inGara.length}`, 'atleti in gara') +
    carta(`${fmt(pIn, 0)}%`, 'con posizione degli ultimi 5 minuti alla base', pIn >= 95 ? 'buono' : pIn >= 80 ? 'medio' : 'cattivo') +
    carta(`${vecchi}`, 'senza posizione da più di 10 minuti', vecchi === 0 ? 'buono' : vecchi <= 3 ? 'medio' : 'cattivo') +
    carta(consegna != null ? `${fmt(consegna, 0)}%` : '—', 'pacchetti arrivati alla base (gli altri si perdono, arriva il successivo)') +
    carta(etaMio != null ? (etaMio < 120 ? `${etaMio} s` : `${Math.round(etaMio / 60)} min`) : '—', 'la tua ultima posizione vista dalla base', etaMio == null ? '' : etaMio <= 300 ? 'buono' : etaMio <= 600 ? 'medio' : 'cattivo') +
    carta(bat8 != null ? `${fmt(bat8, 0)}%` : '—', 'batteria stimata dell\'orologio dopo 8 ore', bat8 == null ? '' : bat8 >= 25 ? 'buono' : bat8 >= 5 ? 'medio' : 'cattivo');
  const ok = pIn >= 95 && vecchi === 0;
  $('esito').className = 'esito' + (ok || durata < 300000 ? '' : ' cattivo');
  $('esito').textContent = durata < 300000 ? 'La rete si sta avviando: i numeri hanno senso dopo qualche minuto di gara.'
    : ok ? 'La base vede tutti gli atleti in gara con meno di 5 minuti di ritardo.'
    : `Attenzione: ${inGara.length - recenti} atleti con posizione più vecchia di 5 minuti. Guarda i tratti rossi del percorso o prova un ripetitore in più.`;
  // allarmi
  const al = b.allarmi.slice(-12).reverse();
  $('allarmi').innerHTML = al.length ? al.map(a => {
    const chi = a.da === 'io' ? 'Tu (orologio)' : `Pettorale ${a.dati?.b ?? a.da}`;
    const cosa = a.tipo === 'sos' ? 'SOS — richiesta di soccorso' : a.tipo;
    return `<div class="allarme ${a.tipo === 'rientrato' ? 'ok' : ''}"><b>${oraTesto(a.t)}</b> · ${chi} · ${cosa}${a.dati?.km != null ? ` · km ${fmt(a.dati.km, 1)}` : ''}</div>`;
  }).join('') : '<p class="tenue">Nessun allarme.</p>';
  // nodi
  $('tab-nodi').innerHTML = gara.rete.nodi.filter(n => n.fisso).map(n =>
    `<tr><td>${n.nome}</td><td>${n.quota} m</td><td class="n">${fmt(100 * n.sentito / durata, 1)}%</td><td class="n">${fmt(100 * n.ariaTot / durata, 2)}%</td></tr>`).join('');
  // nodi che trasmettono adesso
  for (const [id, m] of marcatori) { const n = gara.rete.perId.get(id); const el = m.getElement()?.firstChild; if (el) el.classList.toggle('tx', n?.stato === 'tx'); }
}

function disegnaDiario() {
  const d = app?.diario || [];
  $('diario').innerHTML = d.length ? d.map(x => `<div><time>${oraTesto(x.t)}</time>${x.testo}</div>`).join('') : '<p class="tenue">Qui compaiono le frasi dette e gli avvisi.</p>';
}

// ---------- avvio ----------
nuovaApp(); app.t0 = 0; nuovaRete();
await document.fonts?.load?.("700 40px Oswald").catch(() => {});
setInterval(() => { aggiornaAtleti(); aggiornaSala(); pulisciPacchetti(); }, 500);
requestAnimationFrame(ciclo);
window.SRMorologio = { cartografia, get app() { return app; }, get gara() { return gara; }, get ora() { return ora; }, passoSecondo, nuovaRete };
