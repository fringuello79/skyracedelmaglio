// Guida vocale SRM — prototipo da provare in Safari.
import { Traccia, dist, bearing, cardinale } from '../posizione/geo.js';
import { Motore, invertiTraccia, invertiBivi, AZIONI, POSIZIONI, PRIORITA, metriParlati, kmParlati, svolteAutomatiche, tracciaDaGpx, preparaBivio } from './motore.js';
import { Simulatore } from './simulatore.js';
import { MappaGuida } from './mappa.js';

const $ = id => document.getElementById(id);
const salva = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* memoria non disponibile */ } };
const leggi = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const fmtKm = km => km.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const fmtDist = m => m >= 1000 ? `${kmParlati(m / 1000)} km` : `${metriParlati(m)} m`;
const ora = () => new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// ---------------- voce e suoni ----------------
class Voce {
  constructor() { this.coda = []; this.corrente = null; this.ctx = null; this.voce = null; this.silenzioInfoFino = 0; this.ultimoImportante = null; this.timer = null; }
  get disponibile() { return 'speechSynthesis' in window; }

  // va chiamata dentro un tocco: iPhone sblocca audio e voce solo così
  sblocca() {
    try { this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)(); this.ctx.resume(); } catch { this.ctx = null; }
    if (this.disponibile) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); }
    this.scegli();
  }
  // Voci italiane, le femminili per prime (più gradevoli e più udibili all'aperto), le migliorate prima delle base.
  voci() {
    if (!this.disponibile) return [];
    const punti = v => {
      const n = `${v.name} ${v.voiceURI}`;
      let s = 0;
      if (FEMMINILI.test(v.name)) s += 10;
      if (MASCHILI.test(v.name)) s -= 10;
      if (/premium/i.test(n)) s += 4; else if (/enhanced|migliorat/i.test(n)) s += 3;
      if (/compact/i.test(n)) s -= 1;
      if (v.localService) s += 1;
      return s;
    };
    return speechSynthesis.getVoices().filter(v => /^it/i.test(v.lang)).sort((a, b) => punti(b) - punti(a));
  }
  scegli() {
    const voci = this.voci(), pref = leggi('srm-guida-voce');
    this.voce = voci.find(v => v.voiceURI === pref) || voci[0] || null;
    this.rate = +(leggi('srm-guida-rate') || 1);
    selettoreVoci(voci, this.voce);
  }
  tono(tipo) {
    const c = this.ctx;
    const seq = { attenzione: [[880, 0, .12], [880, .18, .12]], positivo: [[660, 0, .1], [990, .12, .16]], allarme: [[440, 0, .16], [330, .2, .16], [440, .4, .16]] }[tipo];
    if (!c || !seq) return 0;
    const t0 = c.currentTime + .02;
    for (const [f, s, d] of seq) {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(.0001, t0 + s);
      g.gain.exponentialRampToValueAtTime(.6, t0 + s + .02);
      g.gain.exponentialRampToValueAtTime(.0001, t0 + s + d);
      o.connect(g).connect(c.destination); o.start(t0 + s); o.stop(t0 + s + d + .05);
    }
    if (tipo === 'allarme' && navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]);
    return Math.max(...seq.map(([, s, d]) => s + d)) * 1000 + 150;
  }
  dici(ev) {
    if (ev.priorita >= PRIORITA.info && Date.now() < this.silenzioInfoFino && !ev.forza) return;
    if (ev.priorita <= PRIORITA.bivio && ev.tipo !== 'giusto') this.ultimoImportante = ev;
    if (ev.bivio) this.coda = this.coda.filter(e => e.bivio !== ev.bivio);
    const c = this.corrente;
    if (c && (ev.priorita < c.priorita || (ev.bivio && ev.bivio === c.bivio))) {
      this.coda.unshift(ev); this._interrompi(); return;
    }
    this.coda.push(ev);
    this.coda.sort((a, b) => a.priorita - b.priorita);
    while (this.coda.length > 4) this.coda.pop();
    if (!this.corrente) this._prossimo();
  }
  _interrompi() {
    clearTimeout(this.timer); this.corrente = null;
    try { speechSynthesis.cancel(); } catch { /* niente */ }
    setTimeout(() => this._prossimo(), 80);
  }
  _prossimo() {
    if (this.corrente || !this.coda.length) return;
    const ev = this.coda.shift(); this.corrente = ev;
    const attesa = ev.suono ? this.tono(ev.suono) : 0;
    setTimeout(() => {
      if (this.corrente !== ev) return;
      if (!this.disponibile) return this._fine(ev);
      const u = new SpeechSynthesisUtterance(ev.testo);
      u.lang = 'it-IT'; if (this.voce) u.voice = this.voce; u.rate = this.rate || 1; u.pitch = 1;
      u.onend = u.onerror = () => this._fine(ev);
      speechSynthesis.speak(u);
      this.timer = setTimeout(() => this._fine(ev), 2500 + ev.testo.length * 90);
    }, attesa);
  }
  _fine(ev) {
    if (this.corrente !== ev) return;
    clearTimeout(this.timer); this.corrente = null;
    setTimeout(() => this._prossimo(), 150);
  }
  ripeti() { if (this.ultimoImportante) this.dici({ ...this.ultimoImportante, priorita: PRIORITA.errore, bivio: null, forza: true }); }
  ferma() { this.coda = []; this.corrente = null; clearTimeout(this.timer); try { speechSynthesis.cancel(); } catch { /* niente */ } }
}
const FEMMINILI = /alice|federica|emma|paola|elsa|isabella|chiara|giulia|silvia|francesca|google italiano/i;
const MASCHILI = /\bluca\b|cosimo|diego|giuseppe|paolo|marco|roberto|\bmale\b/i;
const voce = new Voce();
if (voce.disponibile) speechSynthesis.addEventListener?.('voiceschanged', () => voce.scegli());
voce.scegli();

function selettoreVoci(voci, scelta) {
  const sel = $('sel-voce'); if (!sel) return;
  sel.replaceChildren();
  if (!voci.length) { const o = document.createElement('option'); o.value = ''; o.textContent = 'Nessuna voce italiana'; sel.append(o); return; }
  for (const v of voci) {
    const o = document.createElement('option'); o.value = v.voiceURI;
    o.textContent = v.name + (MASCHILI.test(v.name) ? ' (maschile)' : '');
    o.selected = v === scelta; sel.append(o);
  }
  $('sel-rate').value = String(+(leggi('srm-guida-rate') || 1));
}

// ---------------- schermo acceso ----------------
let blocco = null;
async function tieniAcceso() {
  try { if ('wakeLock' in navigator) blocco = await navigator.wakeLock.request('screen'); } catch { blocco = null; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && inCorso) tieniAcceso(); });

// ---------------- traccia e bivi ----------------
const datiSrm = Promise.all([
  fetch('../posizione/traccia.json').then(r => r.json()),
  fetch('bivi-srm2026.json').then(r => r.json()),
]);
let traccia = null, tracciaId = null, biviBase = [], bivi = [];
const chiave = () => 'srm-guida-bivi:' + tracciaId;

async function caricaSrm() {
  const [t, b] = await datiSrm;
  traccia = new Traccia(t); tracciaId = 'srm2026'; biviBase = b.bivi;
  bivi = leggi(chiave()) || structuredClone(biviBase);
  disegnaBivi();
}
async function caricaGpx(file) {
  const testo = await file.text();
  traccia = tracciaDaGpx(testo, Traccia);
  tracciaId = `gpx:${file.name}:${traccia.pts.length}`;
  biviBase = svolteAutomatiche(traccia);
  bivi = leggi(chiave()) || structuredClone(biviBase);
  disegnaBivi();
  return `Traccia di ${fmtKm(traccia.kmTot)} km con ${bivi.length} svolte trattate come bivi.`;
}

// ---------------- stato della guida ----------------
let mappa = null;
// senso di marcia: 'gara' oppure 'contrario'; la traccia attiva è quella percorsa adesso
let verso = 'gara', tAttiva = null;
const kmGara = k => verso === 'contrario' ? traccia.kmTot - k : k;
const kmAttivo = kmGara;   // la conversione è la stessa nei due sensi
function preparaSenso(v) {
  verso = v;
  tAttiva = v === 'contrario' ? invertiTraccia(traccia) : traccia;
}
const biviAttivi = () => verso === 'contrario' ? invertiBivi(bivi, tAttiva) : bivi;
const nuovoMotore = () => new Motore(tAttiva, biviAttivi(), { kmGara, meta: verso === 'contrario' ? 'partenza' : 'arrivo' });
function nuovaMappa() {
  mappa?.rimuovi();
  mappa = new MappaGuida($('mappa'), tAttiva, { kmGara, onSegui: s => { $('b-centra').hidden = s; } });
  mappa.impostaBivi(motore.bivi);
  $('b-base').textContent = mappa.base === 'satellite' ? 'Topo' : 'Foto';
  $('b-centra').hidden = true;
}
function etichettaInverti() {
  $('b-inverti').textContent = verso === 'contrario' ? 'Riprendi il senso della gara' : 'Torna indietro';
}
let motore = null, sim = null, inCorso = false, inPausa = false, fattore = 5;
let idGps = null, timerSim = null, timerTick = null;
let ultimoErrore = '', ultimoLontano = '', ultimoGiusto = 0, ultimaPrecisione = null;

function gestisci(eventi) {
  for (const ev of eventi) {
    voce.dici(ev);
    if (ev.priorita === PRIORITA.errore && ev.tipo !== 'rientro') ultimoErrore = ev.testo;
    if (ev.tipo === 'lontano') ultimoLontano = ev.testo;
    if (ev.tipo === 'giusto' || ev.tipo === 'rientro') ultimoGiusto = Date.now();
    scriviDiario(ev.testo, ev.priorita === PRIORITA.errore && ev.tipo !== 'rientro');
  }
  if (eventi.length) aggiorna();
}

function scriviDiario(testo, errore = false) {
  const li = document.createElement('li');
  const t = document.createElement('time'); t.textContent = ora();
  const s = document.createElement('span'); s.textContent = testo; if (errore) s.className = 'errore';
  li.append(t, s);
  const d = $('diario'); d.prepend(li);
  while (d.children.length > 8) d.lastChild.remove();
}

function freccia(a) {
  const svg = $('freccia');
  if (a === 'x') {
    svg.innerHTML = '<circle cx="50" cy="50" r="40" fill="none" stroke="var(--rosso)" stroke-width="8"/><path d="M33 33L67 67M67 33L33 67" stroke="var(--rosso)" stroke-width="9" stroke-linecap="round"/>';
    return;
  }
  if (a === 'ok') {
    svg.innerHTML = '<circle cx="50" cy="50" r="40" fill="none" stroke="var(--verde)" stroke-width="8"/><path d="M30 52L45 66L71 36" fill="none" stroke="var(--verde)" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>';
    return;
  }
  if (a == null) { svg.innerHTML = '<circle cx="50" cy="50" r="12" fill="var(--tenue)"/>'; return; }
  const r = a * Math.PI / 180, ux = Math.sin(r), uy = -Math.cos(r);
  const ex = 50 + 30 * ux, ey = 52 + 30 * uy;
  const f = n => n.toFixed(1);
  const punta = `${f(ex + ux * 12)} ${f(ey + uy * 12)}`, b1 = `${f(ex - uy * 14)} ${f(ey + ux * 14)}`, b2 = `${f(ex + uy * 14)} ${f(ey - ux * 14)}`;
  svg.innerHTML = `<path d="M50 94L50 52L${f(ex)} ${f(ey)}" fill="none" stroke="var(--inchiostro)" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/><path d="M${punta}L${b1}L${b2}Z" fill="var(--inchiostro)"/>`;
}

// Scrive nella pagina solo quando qualcosa cambia: ogni ridisegno costa batteria.
let ultimaCard = '', ultimaFreccia, ultimoStato = '';
function card(classe, icona, dist, cosa, sotto) {
  const chiaveCard = [classe, icona, dist, cosa, sotto].join('|');
  if (chiaveCard === ultimaCard) return;
  ultimaCard = chiaveCard;
  $('card').className = 'indicazione' + (classe ? ' ' + classe : '');
  if (icona !== ultimaFreccia) { ultimaFreccia = icona; freccia(icona); }
  $('c-dist').textContent = dist; $('c-cosa').textContent = cosa; $('c-sotto').textContent = sotto || '';
  if (schermoNero) { $('n-dist').textContent = dist; $('n-cosa').textContent = cosa; $('n-nero').className = 'nero' + (classe === 'errore' ? ' errore' : ''); }
}

function aggiorna() {
  if (!motore) return;
  const st = motore.stato();
  if (st.arrivato) card('ok', 'ok', 'Arrivo', 'Gara finita', 'Complimenti!');
  else if (st.km == null && motore.pos && motore.attesa == null) {
    // lontano dal percorso: freccia verso il punto più vicino (in linea d'aria)
    const pos = motore.pos, p = tAttiva.proietta(pos.lat, pos.lon), q = tAttiva.at(p.km), b = bearing([pos.lat, pos.lon], q);
    const rel = st.direzione != null ? Math.round((((b - st.direzione) % 360) + 540) % 360 / 15) * 15 - 180 : null;
    card('', rel, fmtDist(p.d), 'Raggiungi il percorso', rel == null ? `Verso ${cardinale(b)} · segui sentieri e strade` : 'In linea d\'aria · segui sentieri e strade');
  }
  else if (st.km == null) card('', null, '—', motore.attesa != null ? 'Inizia a muoverti' : 'Cerco il percorso',
    motore.attesa != null ? 'Così capisco in che senso vai' : 'Attendo una posizione GPS precisa');
  else if (st.sbagliato && motore.fuori?.bivio && motore.pos) {
    const b = motore.fuori.bivio;
    card('errore', 'x', `${metriParlati(dist([motore.pos.lat, motore.pos.lon], [b.lat, b.lon]))} m`, 'Sentiero sbagliato', 'Torna indietro fino al bivio');
  }
  else if (st.fuori) card('errore', 'x', st.dist != null ? `${metriParlati(st.dist)} m` : '—', 'Fuori percorso', ultimoErrore);
  else if (Date.now() - ultimoGiusto < 3000) card('ok', 'ok', 'OK', 'Sentiero giusto', 'Prosegui');
  else if (st.prossimo && st.prossimo.d <= 400) {
    const { b, d } = st.prossimo;
    const segno = b.segnoTesto ? b.segnoTesto.charAt(0).toUpperCase() + b.segnoTesto.slice(1) : '';
    card('', b.icona, d < 15 ? 'Ora' : `${metriParlati(d)} m`, b.titolo, [segno, `bivio ${b.id}`].filter(Boolean).join(' · '));
  } else {
    const p = st.prossimo;
    card('', 0, p ? fmtDist(p.d) : '—', 'Prosegui sul percorso', p ? `Prossimo bivio: ${p.b.titolo.toLowerCase()}` : 'Nessun altro bivio');
  }
  const parti = [];
  if (st.km != null) parti.push(`<b>km ${fmtKm(kmGara(st.km))}</b> / ${fmtKm(traccia.kmTot)}`);
  if (verso === 'contrario') parti.push('<b>al contrario</b>');
  if (st.sentiero) parti.push(`sentiero ${st.sentiero}`);
  if (ultimaPrecisione != null) parti.push(`GPS ±${Math.round(ultimaPrecisione)} m`);
  if (st.velocita > 0.3) parti.push(`${(Math.round(st.velocita * 3.6 * 2) / 2).toLocaleString('it-IT', { maximumFractionDigits: 1 })} km/h`);
  if (sim) parti.push(inPausa ? 'simulazione in pausa' : `simulazione ×${fattore}`);
  const html = parti.map(x => `<span>${x}</span>`).join('');
  if (html !== ultimoStato && !schermoNero) { ultimoStato = html; $('stato').innerHTML = html; }
  mappa?.aggiorna(motore, ultimaPrecisione);
}

// ---------------- avvio e arresto ----------------
function messaggioPrepara(t) { const m = $('msg-prepara'); m.textContent = t; m.hidden = !t; }

$('avvia').addEventListener('click', async () => {
  voce.sblocca();
  messaggioPrepara('');
  if (!traccia) { messaggioPrepara('La traccia non è ancora pronta: riprova tra un attimo.'); return; }
  const modo = document.querySelector('input[name=modo]:checked').value;
  preparaSenso(document.querySelector('input[name=verso]:checked').value);
  motore = nuovoMotore();
  ultimoErrore = ultimoLontano = ''; ultimoGiusto = 0; ultimaPrecisione = null;
  $('diario').replaceChildren();
  inCorso = true; inPausa = false;
  if (modo === 'sim') {
    const km = Math.max(0, Math.min(traccia.kmTot - 0.1, parseFloat(String($('sim-km').value).replace(',', '.')) || 0));
    fattore = +$('sim-vel').value;
    sim = new Simulatore(tAttiva, { km: Math.max(0, Math.min(traccia.kmTot - 0.1, verso === 'contrario' && km < 0.05 ? 0 : kmAttivo(km))), velocita: 2.8, rumore: 4, precisione: 6, seme: Date.now() % 100000 });
    timerSim = setInterval(passoSimulato, 1000 / fattore);
    gestisci([{ tipo: 'avvio', priorita: PRIORITA.info, testo: `Simulazione avviata dal chilometro ${kmParlati(km)}${verso === 'contrario' ? ', al contrario' : ''}.`, forza: true }]);
  } else {
    sim = null;
    if (!('geolocation' in navigator)) { messaggioPrepara('Questo browser non dà accesso al GPS.'); inCorso = false; return; }
    idGps = navigator.geolocation.watchPosition(posizioneVera, erroreGps, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
    timerTick = setInterval(() => { gestisci(motore.tick(Date.now())); if (Date.now() - ultimoFix > 2500) aggiorna(); }, 1000);
    gestisci([{ tipo: 'avvio', priorita: PRIORITA.info, testo: `Guida avviata${verso === 'contrario' ? ', al contrario' : ''}. Cerco il percorso.`, forza: true }]);
  }
  tieniAcceso();
  $('prepara').hidden = true;
  for (const id of ['guida', 'sez-mappa', 'stato', 'comandi', 'pannello-diario']) $(id).hidden = false;
  nuovaMappa();
  etichettaInverti();
  $('comandi-sim').hidden = !sim;
  $('b-pausa').textContent = 'Pausa';
  aggiorna();
  window.scrollTo({ top: 0 });
});

function passoSimulato() {
  if (inPausa || !sim) return;
  const f = sim.passo(1);
  ultimaPrecisione = f.acc;
  gestisci(motore.posizione(f));
  gestisci(motore.tick(f.t));
  aggiorna();
  if (sim.finito() || motore.arrivato) { clearInterval(timerSim); timerSim = null; }
}

let ultimoFix = 0;
function posizioneVera(p) {
  const f = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() };
  ultimoFix = f.t;
  ultimaPrecisione = f.acc;
  gestisci(motore.posizione(f));
  aggiorna();
}

function erroreGps(e) {
  const testo = e.code === 1
    ? 'Safari non ha il permesso di usare la posizione. Consentilo nelle impostazioni di localizzazione per i siti di Safari, poi ricarica la pagina.'
    : 'Il GPS non risponde. Spostati in un punto aperto e attendi.';
  scriviDiario(testo, true);
  if (e.code === 1) { ferma(); messaggioPrepara(testo); }
}

function ferma() {
  if (schermoNero) nero(false);
  inCorso = false;
  clearInterval(timerSim); clearInterval(timerTick); timerSim = timerTick = null;
  if (idGps != null) navigator.geolocation.clearWatch(idGps);
  idGps = null; sim = null;
  voce.ferma();
  try { blocco?.release(); } catch { /* niente */ }
  blocco = null;
  $('prepara').hidden = false;
  for (const id of ['guida', 'sez-mappa', 'stato', 'comandi']) $(id).hidden = true;
  mappa?.rimuovi(); mappa = null;
}

// ---------------- schermo nero ----------------
// Sugli iPhone con schermo OLED i pixel neri sono spenti: il consumo dello schermo scende molto.
let schermoNero = false, tUscita = 0;
function nero(si) {
  schermoNero = si;
  $('n-nero').hidden = !si;
  document.documentElement.classList.toggle('con-nero', si);
  mappa?.sospendi(si);
  ultimaCard = ''; ultimoStato = '';
  if (!si) mappa?.centra(motore, ultimaPrecisione);
  aggiorna();
}
$('n-nero').addEventListener('click', () => {
  const t = Date.now();
  if (t - tUscita < 3000) { nero(false); return; }
  tUscita = t; $('n-tocca').textContent = 'Tocca ancora per tornare alla guida';
  setTimeout(() => { if (Date.now() - tUscita >= 3000) $('n-tocca').textContent = 'Tocca due volte per tornare'; }, 3100);
});
$('b-nero').addEventListener('click', () => nero(true));

// la mappa non lavora quando non si vede
if ('IntersectionObserver' in window) {
  new IntersectionObserver(v => { const vis = v.at(-1).isIntersecting; if (!schermoNero) mappa?.sospendi(!vis); if (vis) mappa?.aggiorna(motore, ultimaPrecisione); })
    .observe($('sez-mappa'));
}

// ---------------- torna indietro ----------------
// Inverte il senso di marcia dal punto in cui si è: da lì la guida porta alla partenza (o, di nuovo, verso l'arrivo).
$('b-inverti').addEventListener('click', () => {
  if (!motore) return;
  voce.sblocca();
  const kmG = motore.km != null ? kmGara(motore.km) : null;   // chilometro di gara attuale
  const t = sim ? sim.ora : Date.now();
  preparaSenso(verso === 'contrario' ? 'gara' : 'contrario');
  const vecchio = motore;
  motore = nuovoMotore();
  if (kmG != null) {
    motore.aggancia(kmAttivo(kmG), t);
    motore.pos = vecchio.pos; motore.dist = vecchio.dist;
  }
  motore.silenziaIndietro(t, 90000);   // il tempo di girarsi
  if (sim) {
    const k = kmG != null ? kmAttivo(kmG) : 0;
    sim = new Simulatore(tAttiva, { km: k, velocita: 2.8, rumore: 4, precisione: 6, seme: Date.now() % 100000 });
    sim.ora = t;
  }
  ultimoErrore = ''; ultimaCard = ''; ultimoStato = '';
  const resto = kmG != null ? (verso === 'contrario' ? kmG : traccia.kmTot - kmG) : null;
  const meta = verso === 'contrario' ? 'Partenza' : 'Arrivo';
  const testo = verso === 'contrario'
    ? `Ok, torniamo indietro.${resto != null ? ` ${meta} a ${kmParlati(resto)} chilometri.` : ''}`
    : `Ok, riprendiamo il senso della gara.${resto != null ? ` ${meta} a ${kmParlati(resto)} chilometri.` : ''}`;
  gestisci([{ tipo: 'inverti', priorita: PRIORITA.bivio, suono: 'attenzione', testo, forza: true }]);
  const p = motore.prossimoBivio();
  if (p) gestisci([{ tipo: 'info', priorita: PRIORITA.info, testo: `Prossimo bivio tra ${p.d >= 1000 ? kmParlati(p.d / 1000) + ' chilometri' : metriParlati(p.d) + ' metri'}: ${p.b.titolo.toLowerCase()}.`, forza: true }]);
  nuovaMappa();
  etichettaInverti();
  aggiorna();
});

// ---------------- comandi ----------------
$('b-centra').addEventListener('click', () => mappa?.centra(motore, ultimaPrecisione));
$('b-zoom-piu').addEventListener('click', () => mappa?.zoom(1));
$('b-zoom-meno').addEventListener('click', () => mappa?.zoom(-1));
$('b-base').addEventListener('click', e => { if (mappa) e.currentTarget.textContent = mappa.cambiaBase() === 'satellite' ? 'Topo' : 'Foto'; });
window.addEventListener('resize', () => mappa?.ridimensiona());
$('b-ferma').addEventListener('click', ferma);
$('b-ripeti').addEventListener('click', () => { voce.sblocca(); voce.ripeti(); });
$('b-dove').addEventListener('click', () => {
  if (!motore) return;
  const t = motore.doveSono();
  voce.dici({ tipo: 'dove', priorita: PRIORITA.errore, testo: t, forza: true }); scriviDiario(t);
});
$('b-silenzia').addEventListener('click', e => {
  const attivo = Date.now() < voce.silenzioInfoFino;
  voce.silenzioInfoFino = attivo ? 0 : Date.now() + 5 * 60000;
  e.currentTarget.textContent = attivo ? 'Meno voce 5 min' : 'Voce piena';
  scriviDiario(attivo ? 'Voce piena: tutti i messaggi.' : 'Per 5 minuti solo bivi ed errori.');
});
$('b-pausa').addEventListener('click', e => { inPausa = !inPausa; e.currentTarget.textContent = inPausa ? 'Riprendi' : 'Pausa'; aggiorna(); });
$('b-sbaglia').addEventListener('click', () => {
  if (!sim || sim.modo !== 'traccia') return;
  const b = motore.bivi.find(x => x.km > sim.km + 0.01);
  if (!b) { scriviDiario('Nessun altro bivio davanti.'); return; }
  sim.sbagliaAl(b);
  scriviDiario(`Prova: al bivio ${b.id} (km ${fmtKm(kmGara(b.km))}) prenderò il sentiero sbagliato e poi tornerò indietro.`);
});
$('b-segna').addEventListener('click', () => {
  if (!motore || motore.km == null) { scriviDiario('Per segnare un bivio devi essere agganciato al percorso.', true); return; }
  const n = bivi.filter(b => b.fonte === 'utente').length + 1;
  const nuovo = { id: 'U' + String(n).padStart(2, '0'), km: Math.round(kmGara(motore.km) * 1000) / 1000, azione: 'auto', fonte: 'utente' };
  bivi.push(nuovo); salvaBivi();
  const t = `Bivio segnato al chilometro ${kmParlati(nuovo.km)}.`;
  voce.dici({ tipo: 'segna', priorita: PRIORITA.errore, testo: t, forza: true }); scriviDiario(t);
  $('sez-bivi').open = true; apriEditor(nuovo);
});
$('sel-voce').addEventListener('change', e => { salva('srm-guida-voce', e.target.value); voce.scegli(); $('b-prova-voce').click(); });
$('sel-rate').addEventListener('change', e => { salva('srm-guida-rate', e.target.value); voce.rate = +e.target.value; $('b-prova-voce').click(); });
$('b-prova-voce').addEventListener('click', () => {
  voce.sblocca();
  setTimeout(() => {
    voce.scegli();
    voce.dici({ tipo: 'prova', priorita: PRIORITA.bivio, suono: 'attenzione', testo: 'Tra 200 metri, incrocio a tre sentieri. Prendi il sentiero più a destra, in salita.', forza: true });
    $('msg-voce').textContent = !voce.disponibile ? 'Questo browser non ha la sintesi vocale.'
      : voce.voce ? `Voce in uso: ${voce.voce.name}. Per una voce femminile più naturale scarica «Federica» o «Emma» nella versione migliorata o premium: Impostazioni › Accessibilità › Contenuto letto › Voci › Italiano. Poi ricarica questa pagina.`
      : 'Nessuna voce italiana trovata: aggiungila nelle impostazioni di accessibilità dell\'iPhone, alla sezione dei contenuti letti ad alta voce.';
  }, 120);
});

// ---------------- scelta traccia e modo ----------------
for (const r of document.querySelectorAll('input[name=traccia]')) r.addEventListener('change', async () => {
  const gpx = r.value === 'gpx' && r.checked;
  $('riga-gpx').hidden = !gpx;
  if (!gpx && r.checked) { await caricaSrm(); messaggioPrepara(''); }
  if (gpx) { traccia = null; disegnaBivi(); messaggioPrepara('Scegli un file GPX.'); }
});
$('file-gpx').addEventListener('change', async e => {
  const f = e.target.files?.[0]; if (!f) return;
  try { messaggioPrepara(await caricaGpx(f)); } catch (err) { traccia = null; messaggioPrepara(err.message || 'File non leggibile.'); }
});
for (const r of document.querySelectorAll('input[name=modo]')) r.addEventListener('change', () => {
  $('riga-sim').hidden = document.querySelector('input[name=modo]:checked').value !== 'sim';
});

// ---------------- elenco ed editor dei bivi ----------------
const NOMI_AZ = { auto: 'Automatica (dalla traccia)', 'dritto': 'Prosegui dritto', 'tieni-dx': 'Tieni la destra', 'tieni-sx': 'Tieni la sinistra', 'gira-dx': 'Gira a destra', 'gira-sx': 'Gira a sinistra', 'stretta-dx': 'Svolta stretta a destra', 'stretta-sx': 'Svolta stretta a sinistra' };
const NOMI_POS = { '': 'Non serve', sx: 'Il più a sinistra', centro: 'Quello centrale', dx: 'Il più a destra', '2sx': 'Il secondo da sinistra', '2dx': 'Il secondo da destra' };
const NOMI_FONTE = { segnaletica: 'piano segnaletica', sentiero: 'cambio sentiero', svolta: 'svolta della traccia', utente: 'segnato da te' };

function salvaBivi() {
  bivi.sort((a, b) => a.km - b.km);
  salva(chiave(), bivi);
  motore?.impostaBivi(biviAttivi());
  if (motore) mappa?.impostaBivi(motore.bivi);
  disegnaBivi();
}

function disegnaBivi() {
  const ul = $('lista-bivi'); ul.replaceChildren();
  $('n-bivi').textContent = traccia ? bivi.length : 0;
  if (!traccia) return;
  for (const b of [...bivi].sort((x, y) => x.km - y.km)) {
    const p = preparaBivio(traccia, b);
    const li = document.createElement('li'), btn = document.createElement('button');
    btn.type = 'button';
    const km = document.createElement('span'); km.className = 'km'; km.textContent = `km ${fmtKm(b.km)}`;
    const t = document.createElement('span'); t.textContent = p.titolo;
    const s = document.createElement('small'); s.textContent = [b.id, NOMI_FONTE[b.fonte] || '', b.rami ? `${b.rami} sentieri` : '', p.segnoTesto].filter(Boolean).join(' · ');
    t.append(s); btn.append(km, t);
    btn.addEventListener('click', () => apriEditor(b));
    li.append(btn); ul.append(li);
  }
}

function opzioni(sel, nomi, valore) {
  for (const [v, n] of Object.entries(nomi)) { const o = document.createElement('option'); o.value = v; o.textContent = n; o.selected = v === String(valore ?? ''); sel.append(o); }
}

function apriEditor(b) {
  const slot = $('editor-slot'); slot.replaceChildren();
  const box = document.createElement('div'); box.className = 'editor';
  box.innerHTML = `
    <h2>Bivio ${b.id}</h2>
    <p class="tenue">${b.nota ? b.nota.replace(/[<>&]/g, '') : 'Correggi cosa deve dire la voce a questo bivio.'}</p>
    <div class="griglia">
      <label>Km<input type="number" id="e-km" step="0.005" inputmode="decimal"></label>
      <label>Conferma dopo (m)<input type="number" id="e-ver" step="10" min="30" inputmode="numeric"></label>
    </div>
    <label>Azione<select id="e-az"></select></label>
    <div class="griglia">
      <label>Sentieri al bivio<select id="e-rami"></select></label>
      <label>Quale prendere<select id="e-pos"></select></label>
    </div>
    <label>Segno da cercare<input type="text" id="e-segno" placeholder="es. segnavia 3B, freccia rossa SRM" maxlength="60"></label>
    <p class="frase" id="e-frase"></p>
    <div class="griglia">
      <button class="btn secondario" type="button" id="e-ascolta">Ascolta</button>
      <button class="btn" type="button" id="e-salva">Salva</button>
      <button class="btn secondario" type="button" id="e-elimina">Elimina</button>
      <button class="btn secondario" type="button" id="e-chiudi">Chiudi</button>
    </div>`;
  slot.append(box);
  $('e-km').value = b.km; $('e-ver').value = b.verifica || 60;
  const p0 = preparaBivio(traccia, { ...b, azione: 'auto' });
  opzioni($('e-az'), { ...NOMI_AZ, auto: `Automatica: ${NOMI_AZ[p0.azioneEff].toLowerCase()}` }, b.azione || 'auto');
  opzioni($('e-rami'), { 0: 'Non indicato', 2: 'Due', 3: 'Tre', 4: 'Quattro' }, b.rami || 0);
  opzioni($('e-pos'), NOMI_POS, b.posizione || '');
  $('e-segno').value = b.segno || '';
  const bozza = () => ({
    ...b, km: Math.max(0.03, Math.min(traccia.kmTot - 0.03, parseFloat(String($('e-km').value).replace(',', '.')) || b.km)),
    verifica: Math.max(30, +$('e-ver').value || 60), azione: $('e-az').value, rami: +$('e-rami').value || 0,
    posizione: $('e-pos').value || undefined, segno: $('e-segno').value.trim() || undefined,
  });
  const anteprima = () => { const p = preparaBivio(traccia, bozza()); $('e-frase').textContent = `«${p.frasi.pre(200)}» … «${p.frasi.ind}»`; };
  box.addEventListener('input', anteprima); box.addEventListener('change', anteprima); anteprima();
  $('e-ascolta').addEventListener('click', () => { voce.sblocca(); voce.dici({ tipo: 'prova', priorita: PRIORITA.bivio, suono: 'attenzione', testo: preparaBivio(traccia, bozza()).frasi.ind, forza: true }); });
  $('e-salva').addEventListener('click', () => { Object.assign(b, bozza()); salvaBivi(); slot.replaceChildren(); $('msg-bivi').textContent = `Bivio ${b.id} salvato.`; });
  let conferma = false;
  $('e-elimina').addEventListener('click', e => {
    if (!conferma) { conferma = true; e.currentTarget.textContent = 'Tocca ancora'; setTimeout(() => { conferma = false; e.target.textContent = 'Elimina'; }, 4000); return; }
    bivi = bivi.filter(x => x !== b); salvaBivi(); slot.replaceChildren(); $('msg-bivi').textContent = `Bivio ${b.id} eliminato.`;
  });
  $('e-chiudi').addEventListener('click', () => slot.replaceChildren());
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('b-copia').addEventListener('click', async () => {
  const testo = JSON.stringify({ traccia: tracciaId, bivi }, null, 1);
  try { await navigator.clipboard.writeText(testo); $('msg-bivi').textContent = 'Bivi copiati: incollali in un messaggio a Claude per inserirli nella versione ufficiale.'; }
  catch { $('msg-bivi').textContent = 'Copia non riuscita su questo browser.'; }
});
let confermaRipristino = false;
$('b-ripristina').addEventListener('click', e => {
  if (!confermaRipristino) { confermaRipristino = true; e.currentTarget.textContent = 'Tocca ancora'; setTimeout(() => { confermaRipristino = false; $('b-ripristina').textContent = 'Bivi originali'; }, 4000); return; }
  confermaRipristino = false; $('b-ripristina').textContent = 'Bivi originali';
  bivi = structuredClone(biviBase); salvaBivi(); $('msg-bivi').textContent = 'Ripristinati i bivi originali.';
});

caricaSrm().catch(() => messaggioPrepara('Non riesco a caricare la traccia SRM: controlla la connessione e ricarica.'));
