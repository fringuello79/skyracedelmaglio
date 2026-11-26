// App SRM dell'orologio (T-Watch Ultra), emulata nel browser.
// È la specifica di quello che il firmware disegnerà e farà: stesse pagine, stesse regole.
// Logica: motore.js (lo stesso della guida sul telefono) + rete mesh (rete.js).
// Schermo 410×502 AMOLED: sfondo nero (pixel spenti = batteria), acceso solo quando serve.
import { Motore, metriParlati, kmParlati } from '../motore.js';
import { bearing, dist } from '../../posizione/geo.js';
import { ZOOM } from './mappa-orologio.js';

export const W = 410, H = 502;
const VERDE = '#3ddc84', AMBRA = '#ffb020', ROSSO = '#ff4d4d', GRIGIO = '#7d8580', BIANCO = '#f4f4f0', TENUE = '#9aa39c';
const F = (peso, px) => `${peso} ${px}px Oswald, 'Arial Narrow', sans-serif`;
const T = (peso, px) => `${peso} ${px}px 'Atkinson Hyperlegible', system-ui, sans-serif`;
const norm = a => ((a % 360) + 540) % 360 - 180;
const rad = d => d * Math.PI / 180;

// vibrazioni (ms acceso/spento alternati) — sull'orologio: driver DRV2605
export const VIBRAZIONI = {
  preavviso: [400], indicazione: [150, 100, 150], ora: [100, 80, 100, 80, 100],
  errore: [600, 200, 600, 200, 600], giusto: [60], conferma: [60], sos: [300, 100, 300, 100, 300], rete: [],
};
const NOMI_VIBRA = { preavviso: 'una lunga', indicazione: 'due brevi', ora: 'tre brevi', errore: 'tre lunghe', giusto: 'un tocco', conferma: 'un tocco', sos: 'tre medie' };

// consumi (mA) — stime da verificare con la prova sul polso
export const CONSUMI = {
  // «mappa»: schermo pieno di colori (AMOLED: più pixel accesi) e ridisegno continuo, al posto di «schermo»
  realistico: { mcu: 45, gps: 25, rx: 5, schermo: 45, mappa: 110, voce: 60, vibra: 70, tx: 118, fisso: 2 },
  ottimistico: { mcu: 20, gps: 15, rx: 5, schermo: 35, mappa: 80, voce: 50, vibra: 60, tx: 118, fisso: 1 },
};
export const BATTERIA_MAH = 1100;

export const CANCELLI = [{ km: 10, nome: 'Passo Le Forche', ora: 6300 }, { km: 14.71, nome: 'Capanna di Sevice', ora: 13500 }, { km: 29.706, nome: 'Arrivo', ora: 25200 }];

export class AppOrologio {
  constructor(traccia, bivi, { pettorale = 'io', consumi = 'realistico', sempreAcceso = false } = {}) {
    this.t = traccia; this.pettorale = pettorale;
    this.motore = new Motore(traccia, bivi, { rassicura: 600000 });
    this.pagina = 'guida'; this.pagine = ['guida', 'mappa', 'gara', 'sos'];
    this.acceso = true; this.spegniA = 8000; this.sempreAcceso = sempreAcceso;
    this.visuale = false; this.zoom = 0; this.cartografia = null; this.ridisegna = null;
    this.ora = 0; this.fix = null; this.km = null;
    this.vibra = null; this.sottotitolo = null; this.ultimoEvento = null;
    this.sos = { stato: 'pronto', tentativi: 0, prossimo: 0, rif: 0, tConferma: null };
    this.rete = { nodo: null, rete: null, ultimaConferma: null, inviati: 0, confermati: 0, statoInviato: false };
    this.energia = { mAs: 0, consumi: CONSUMI[consumi], tSchermo: 0, tVoce: 0, tVibra: 0, ariaPrima: 0 };
    this.diario = [];
    this.onVoce = null; this.onVibra = null; this.onDiario = null;
  }

  // ---------- rete mesh ----------
  collegaRete(rete, { intervallo = 120000, hop = 2 } = {}, apparato) {
    this.rete.rete = rete; this.hop = hop;
    const app = this;
    this.rete.nodo = rete.aggiungi({ ...apparato, id: 'io', bib: this.pettorale, ruolo: 'CLIENT_MUTE', fisso: false, ascolta: true, intervallo,
      posizione() { return app.fix ? [app.fix.lat, app.fix.lon] : null; },
      genera(t) { app._inviaPosizione(t); },
      ricevuto(pkt, t) { app._ricevuto(pkt, t); },
      ack(pkt, t) { app.rete.ultimaConferma = t; app.rete.confermati++; } });
    this.energia.ariaPrima = 0;
  }
  _inviaPosizione(t) {
    if (!this.fix || !this.rete.rete) return;
    this.rete.inviati++;
    const st = this.motore.stato();
    this.rete.rete.invia(this.rete.nodo, 'pos', { b: this.pettorale, km: st.km != null ? +st.km.toFixed(2) : null, stato: st.fuori ? 'fuori' : 'ok' }, { hop: this.hop });
  }
  _ricevuto(pkt, t) {
    if (pkt.tipo === 'ack' && pkt.dati.a === 'io' && this.sos.stato === 'inviato') {
      this.sos.stato = 'confermato'; this.sos.tConferma = t;
      this._evento({ tipo: 'sos-ok', testo: 'Soccorso avvisato. Resta dove sei.', vibra: 'sos', sveglia: true, pagina: 'sos' });
    }
  }

  // ---------- SOS ----------
  // pulsante tenuto 3 s → conto alla rovescia di 5 s (si annulla premendo) → invio ripetuto ogni 10 s finché la base conferma
  avviaConto(oraReale) { if (this.sos.stato === 'pronto') { this.sos.stato = 'conto'; this.sos.fineConto = oraReale + 5000; this.pagina = 'sos'; this._sveglia(30000); this._vibra('errore'); } }
  annullaSos() { if (this.sos.stato === 'conto') { this.sos.stato = 'pronto'; this._log('SOS annullato.'); } }
  _sosOgniSecondo(oraReale) {
    const s = this.sos;
    if (s.stato === 'conto' && oraReale >= s.fineConto) {
      s.stato = 'inviato'; s.rif = Date.now() % 100000; s.prossimo = this.ora; s.tInvio = this.ora;
      this._evento({ tipo: 'sos', testo: 'Richiesta di soccorso inviata.', vibra: 'sos', sveglia: true, pagina: 'sos' });
    }
    if (s.stato === 'inviato' && this.ora >= s.prossimo && this.rete.rete) {
      s.tentativi++; s.prossimo = this.ora + 10000;
      const st = this.motore.stato();
      this.rete.rete.invia(this.rete.nodo, 'sos', { b: this.pettorale, rif: s.rif, km: st.km != null ? +st.km.toFixed(2) : null, lat: this.fix?.lat, lon: this.fix?.lon }, { hop: 3 });
    }
  }

  // ---------- interazione ----------
  tocca() {
    if (!this.acceso) return this._sveglia(6000);
    if (this.visuale) { this.zoom = (this.zoom + 1) % ZOOM.length; return; }   // in modalità mappa il tocco cambia la scala
    this.scorri(1);
  }
  // pulsante laterale, pressione breve: accende o spegne la modalità visuale (mappa sempre accesa)
  pulsante() {
    if (this.sos.stato === 'conto') return this.annullaSos();
    this.visuale = !this.visuale || !this.acceso;
    if (this.visuale) { this.acceso = true; this.zoom = 0; this._log('Modalità mappa accesa.'); }
    else { this.spegniA = this.ora + 4000; this._log('Modalità mappa spenta: lo schermo torna a spegnersi da solo.'); }
  }
  scorri(d) { if (this.visuale) { this.visuale = false; } const i = this.pagine.indexOf(this.pagina); this.pagina = this.pagine[(i + d + this.pagine.length) % this.pagine.length]; this._sveglia(8000); }
  alzaPolso() { this._sveglia(6000); }
  _sveglia(ms) { this.acceso = true; this.spegniA = Math.max(this.spegniA, this.ora + ms); }
  _vibra(nome) { if (!VIBRAZIONI[nome]?.length) return; this.vibra = { nome, da: this.ora, testo: NOMI_VIBRA[nome] }; this.energia.tVibra += VIBRAZIONI[nome].filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0); this.onVibra?.(nome, VIBRAZIONI[nome]); }
  _log(testo) { this.diario.unshift({ t: this.ora, testo }); this.diario.length = Math.min(this.diario.length, 40); this.onDiario?.(); }

  _evento(e) {
    if (e.vibra) this._vibra(e.vibra);
    if (e.sveglia) this._sveglia(e.tipo === 'fuori' ? 20000 : e.tipo === 'sos-ok' ? 60000 : 9000);
    if (e.pagina) this.pagina = e.pagina;
    if (e.testo) { this.sottotitolo = { testo: e.testo, fino: this.ora + 7000 }; this.energia.tVoce += e.testo.length / 13 * 1000; this.onVoce?.(e.testo, e); this._log(e.testo); }
    this.ultimoEvento = { ...e, t: this.ora };
  }

  // eventi del motore → vibrazione, schermo, voce
  _daMotore(ev) {
    for (const e of ev) {
      const errore = ['fuori', 'sbagliato', 'indietro'].includes(e.tipo);
      const vibra = errore ? 'errore' : e.tipo === 'preavviso' ? 'preavviso' : e.tipo === 'indicazione' ? 'indicazione' : e.tipo === 'ora' ? 'ora'
        : e.tipo === 'giusto' ? 'giusto' : e.tipo === 'conferma' ? 'conferma' : null;
      const sveglia = errore || ['preavviso', 'indicazione', 'ora', 'gps', 'arrivo'].includes(e.tipo);
      this._evento({ ...e, vibra, sveglia, pagina: sveglia ? 'guida' : null });
    }
  }

  // un secondo di simulazione: fix GPS (può mancare), ora di gara in ms, ora reale per i conti alla rovescia
  secondo(fix, ora, oraReale = performance.now()) {
    this.ora = ora;
    if (fix) {
      this.fix = fix; this._daMotore(this.motore.posizione(fix));
      // media degli ultimi 5 secondi: serve al pallino quando si è fuori dal percorso
      (this.bufFix ||= []).push(fix); if (this.bufFix.length > 5) this.bufFix.shift();
      const n = this.bufFix.length;
      this.fixMedio = [this.bufFix.reduce((a, q) => a + q.lat, 0) / n, this.bufFix.reduce((a, q) => a + q.lon, 0) / n];
    }
    this._daMotore(this.motore.tick(ora));
    const st = this.motore.stato(); this.km = st.km;
    // fuori percorso: avviso anche alla base, una volta per episodio
    if (st.fuori && !this.rete.statoInviato && this.rete.rete) {
      this.rete.statoInviato = true;
      this.rete.rete.invia(this.rete.nodo, 'stato', { b: this.pettorale, stato: st.sbagliato ? 'sentiero sbagliato' : 'fuori percorso', km: st.km != null ? +st.km.toFixed(2) : null }, { hop: 3 });
    } else if (!st.fuori && this.rete.statoInviato) {
      this.rete.statoInviato = false;
      this.rete.rete?.invia(this.rete.nodo, 'stato', { b: this.pettorale, stato: 'rientrato', km: st.km != null ? +st.km.toFixed(2) : null }, { hop: 3 });
    }
    this._sosOgniSecondo(oraReale);
    if (st.fuori || this.sos.stato === 'inviato') this._sveglia(2000);
    if (!this.sempreAcceso && !this.visuale && this.ora > this.spegniA) this.acceso = false;
    if (this.sempreAcceso || this.visuale) this.acceso = true;
    // energia: un secondo di consumi
    const c = this.energia.consumi;
    let mA = c.fisso + c.mcu + c.gps + c.rx + (this.acceso ? (this.visuale ? c.mappa : c.schermo) : 0);
    if (this.acceso) this.energia.tSchermo += 1000;
    if (this.visuale) this.energia.tMappa = (this.energia.tMappa || 0) + 1000;
    const aria = this.rete.nodo ? this.rete.nodo.ariaTot : 0;
    const daria = aria - this.energia.ariaPrima; this.energia.ariaPrima = aria;
    this.energia.mAs += mA + c.tx * daria / 1000;
    // voce e vibrazione: si consumano man mano
    const v = Math.min(1000, this.energia.tVoce); this.energia.tVoce -= v; this.energia.mAs += c.voce * v / 1000;
    const vb = Math.min(1000, this.energia.tVibra); this.energia.tVibra -= vb; this.energia.mAs += c.vibra * vb / 1000;
  }
  batteria() { return Math.max(0, 100 - this.energia.mAs / 3600 / BATTERIA_MAH * 100); }
  // proiezione: percentuale alla fine di 8 ore al consumo medio finora
  batteriaA8ore() { const dt = this.ora - (this.t0 || 0); if (dt < 60000) return null; const medio = this.energia.mAs / (dt / 1000); return Math.max(0, 100 - medio * 8 * 3600 / 3600 / BATTERIA_MAH * 100); }

  // ================= DISEGNO =================
  disegna(c, oraReale = performance.now()) {
    c.save();
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    if (!this.acceso) { c.restore(); return; }
    const st = this.motore.stato();
    const errore = st.fuori || (this.ultimoEvento?.tipo === 'indietro' && this.ora - this.ultimoEvento.t < 15000);
    const sos = this.pagina === 'sos' || this.sos.stato === 'conto';
    if (this.visuale && !errore && !sos) { this._paginaVisuale(c, st, oraReale); c.restore(); return; }
    this._barra(c);
    if (sos) this._paginaSos(c, oraReale);
    else if (errore) this._paginaErrore(c, st);
    else if (this.pagina === 'guida') this._paginaGuida(c, st);
    else if (this.pagina === 'mappa') this._paginaMappa(c, st, oraReale);
    else if (this.pagina === 'gara') this._paginaGara(c, st);
    // puntini delle pagine
    this.pagine.forEach((p, i) => { c.beginPath(); c.arc(W / 2 + (i - 1.5) * 18, H - 12, p === this.pagina ? 5 : 3.5, 0, 7); c.fillStyle = p === this.pagina ? BIANCO : '#4a4f4c'; c.fill(); });
    c.restore();
  }

  // modalità visuale: carta con il percorso e la posizione, come la mappa della pagina; le indicazioni restano sopra
  // Posizione da disegnare, senza tremolio:
  //  - sul percorso il pallino scorre sulla traccia al chilometro del motore (niente rumore del GPS laterale),
  //    e il chilometro è ammorbidito nel tempo reale, così si muove fluido a qualsiasi velocità;
  //  - fuori dal percorso si usa la media degli ultimi 5 secondi, ammorbidita;
  //  - la direzione è quella della traccia (o di marcia se fuori), ruotata piano.
  _vistaLiscia(st, oraReale) {
    const v = this.vista || (this.vista = {});
    const dt = v.tr == null ? 1 : Math.min(0.5, Math.max(0, (oraReale - v.tr) / 1000)); v.tr = oraReale; v.dt = dt;
    const f = tau => 1 - Math.exp(-dt / tau);
    let pt, dir, tau;
    if (st.km != null && !st.fuori) {
      if (v.km == null || v.modo !== 'traccia' || Math.abs(st.km - v.km) > 0.3) v.km = st.km;
      else v.km += (st.km - v.km) * f(0.45);
      const p = this.t.at(v.km); pt = [p[0], p[1]]; dir = this.t.direzioneDopo(v.km, 0.04); tau = 0.12; v.modo = 'traccia';
    } else if (this.fixMedio) {
      pt = this.fixMedio; dir = this.motore.direzione; tau = 0.6; v.modo = 'libero'; v.km = null;
    } else return null;
    const salto = v.pt && Math.abs(pt[0] - v.pt[0]) + Math.abs(pt[1] - v.pt[1]) > 0.003;   // ~300 m: si riparte
    v.pt = !v.pt || salto ? pt : [v.pt[0] + (pt[0] - v.pt[0]) * f(tau), v.pt[1] + (pt[1] - v.pt[1]) * f(tau)];
    if (dir != null) v.dir = v.dir == null || salto ? dir : (v.dir + norm(dir - v.dir) * f(0.9) + 360) % 360;
    return v;
  }

  _paginaVisuale(c, st, oraReale = performance.now()) {
    const z = ZOOM[this.zoom];
    const v = this._vistaLiscia(st, oraReale);
    // la carta segue il pallino con calma, guardando un po' avanti nel senso di marcia
    let centro;
    if (z.mpp > 10) centro = this.cartografia?.centroTraccia;
    else if (v) {
      const avanti = 0.16 * H * z.mpp, d = rad(v.dir ?? 0), k = Math.cos(rad(v.pt[0]));
      const meta = [v.pt[0] + Math.cos(d) * avanti / 110540, v.pt[1] + Math.sin(d) * avanti / (111320 * k)];
      const ff = 1 - Math.exp(-v.dt / 0.9);
      if (!v.cam || v.camZoom !== this.zoom || Math.abs(meta[0] - v.cam[0]) + Math.abs(meta[1] - v.cam[1]) > 0.004) v.cam = meta;
      else v.cam = [v.cam[0] + (meta[0] - v.cam[0]) * ff, v.cam[1] + (meta[1] - v.cam[1]) * ff];
      v.camZoom = this.zoom; centro = v.cam;
    } else centro = st.km != null ? this.t.at(st.km) : this.t.at(0);
    const kmDisegno = v?.modo === 'traccia' ? v.km : st.km;
    if (this.cartografia && centro) this.cartografia.disegna(c, { x: 0, y: 0, w: W, h: H },
      { centro, mpp: z.mpp, km: kmDisegno, bivi: this.motore.bivi, pallino: v?.pt, direzione: v?.dir }, this.ridisegna);
    // barra in alto su fondo scuro
    c.fillStyle = 'rgba(0,0,0,.72)'; c.fillRect(0, 0, W, 58);
    this._barra(c);
    // in basso: il prossimo bivio, o chilometro e sentiero
    const p = st.prossimo;
    const vicino = p && p.d <= 300 && !st.arrivato;
    const hB = vicino ? 118 : 74;
    c.fillStyle = 'rgba(0,0,0,.78)'; c.fillRect(0, H - hB, W, hB);
    if (vicino) {
      c.save(); this._bivio(c, p.b, 60, H - 62, 0.36); c.restore();
      c.textAlign = 'left'; c.fillStyle = AMBRA; c.font = F(700, 44); c.fillText(p.d < 30 ? 'ORA' : `${metriParlati(p.d)} m`, 112, H - 72);
      c.font = F(600, 27); c.fillStyle = BIANCO;
      let t = p.b.titolo; while (c.measureText(t).width > W - 124 && t.length > 4) t = t.slice(0, -2) + '…';
      c.fillText(t, 112, H - 32);
    } else if (st.km != null) {
      c.textAlign = 'left'; c.fillStyle = BIANCO; c.font = F(700, 30); c.fillText(`km ${kmParlati(st.km)}`, 20, H - 40);
      c.textAlign = 'right'; c.font = T(700, 19); c.fillStyle = VERDE; c.fillText(st.sentiero ? `Sentiero ${st.sentiero}` : '', W - 20, H - 48);
      c.fillStyle = TENUE; c.font = T(400, 17); c.fillText(p ? `bivio fra ${p.d >= 1000 ? kmParlati(p.d / 1000) + ' km' : metriParlati(p.d) + ' m'}` : 'verso l\'arrivo', W - 20, H - 24);
    }
    // scala
    const et = `MAPPA · ${z.nome}`; c.font = T(700, 14); c.textAlign = 'left';
    c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(12, 66, c.measureText(et).width + 14, 26);
    c.fillStyle = BIANCO; c.fillText(et, 19, 80);
    c.textAlign = 'left';
  }

  _barra(c) {
    const ora = 9 * 3600 + Math.floor(this.ora / 1000);
    const hh = Math.floor(ora / 3600) % 24, mm = Math.floor(ora / 60) % 60;
    c.fillStyle = BIANCO; c.font = F(600, 30); c.textBaseline = 'middle'; c.textAlign = 'left';
    c.fillText(`${hh}:${String(mm).padStart(2, '0')}`, 22, 30);
    // GPS
    const gpsOk = this.fix && this.ora - this.fix.t < 5000;
    c.font = T(700, 15); c.fillStyle = gpsOk ? VERDE : ROSSO; c.fillText('GPS', 118, 31);
    // rete: tre tacche, piene se l'ultima posizione è stata ripetuta da un ripetitore (conferma implicita)
    const eta = this.rete.ultimaConferma == null ? Infinity : this.ora - this.rete.ultimaConferma;
    const livello = eta < 200000 ? 3 : eta < 420000 ? 2 : eta < 900000 ? 1 : 0;
    for (let i = 0; i < 3; i++) { c.fillStyle = i < livello ? (livello === 3 ? VERDE : AMBRA) : '#3a3f3c'; c.fillRect(170 + i * 9, 38 - (i + 1) * 7, 6, (i + 1) * 7); }
    c.fillStyle = livello ? TENUE : ROSSO; c.font = T(700, 13); c.fillText(livello ? 'mesh' : 'no mesh', 200, 31);
    // batteria
    const b = this.batteria();
    c.strokeStyle = TENUE; c.lineWidth = 2; c.strokeRect(330, 20, 50, 22); c.fillStyle = TENUE; c.fillRect(381, 26, 4, 10);
    c.fillStyle = b > 30 ? VERDE : b > 15 ? AMBRA : ROSSO; c.fillRect(333, 23, 44 * b / 100, 16);
    c.fillStyle = BIANCO; c.font = T(700, 14); c.textAlign = 'right'; c.fillText(Math.round(b) + '%', 324, 31);
    c.textAlign = 'left';
  }

  _testoCentrato(c, testo, y, font, colore = BIANCO, maxW = W - 40) {
    c.font = font; c.fillStyle = colore; c.textAlign = 'center';
    const parole = testo.split(' '); let riga = ''; const righe = [];
    for (const p of parole) { const prova = riga ? riga + ' ' + p : p; if (c.measureText(prova).width > maxW && riga) { righe.push(riga); riga = p; } else riga = prova; }
    if (riga) righe.push(riga);
    const h = parseInt(font.match(/(\d+)px/)[1]) * 1.12;
    righe.forEach((r, i) => c.fillText(r, W / 2, y + i * h));
    c.textAlign = 'left';
    return righe.length * h;
  }

  _titolo(c, testo, y, colore, px = 44) {
    c.font = F(700, px); while (c.measureText(testo).width > W - 30 && px > 22) c.font = F(700, --px);
    c.textAlign = 'center'; c.fillStyle = colore; c.fillText(testo, W / 2, y);
  }

  _sottotitolo(c, y = 418) {
    if (!this.sottotitolo || this.ora > this.sottotitolo.fino) return;
    c.fillStyle = '#121614'; c.fillRect(14, y - 6, W - 28, 64);
    this._testoCentrato(c, this.sottotitolo.testo, y + 16, T(400, 18), '#cfd6d0', W - 50);
  }

  // freccia del bivio: tronco grigio, sentiero giusto verde con la punta, gli altri grigi
  _bivio(c, b, cx, cy, s = 1) {
    const linea = (ang, L, col, w, punta) => {
      const x = cx + Math.sin(rad(ang)) * L * s, y = cy - Math.cos(rad(ang)) * L * s;
      c.strokeStyle = col; c.lineWidth = w * s; c.lineCap = 'round'; c.beginPath(); c.moveTo(cx, cy); c.lineTo(x, y); c.stroke();
      if (punta) this._punta(c, x, y, ang, col, s);
    };
    c.strokeStyle = GRIGIO; c.lineWidth = 20 * s; c.lineCap = 'round'; c.beginPath(); c.moveTo(cx, cy + 110 * s); c.lineTo(cx, cy); c.stroke();
    if (b.tipo === 'tornanti') { this._zigzag(c, cx, cy, s); return; }
    if (b.tipo === 'sentiero') { linea(0, 120, VERDE, 22, true); c.fillStyle = '#1d2a22'; c.fillRect(cx + 26 * s, cy - 92 * s, 92 * s, 50 * s); c.fillStyle = VERDE; c.font = F(700, 34 * s); c.fillText(b.sentiero || '', cx + 38 * s, cy - 56 * s); return; }
    const scelta = b.icona ?? 0;
    let altri = [];
    if (b.rami >= 3) { const n = b.rami; for (let i = 0; i < n; i++) altri.push(-75 + 150 * i / (n - 1)); }
    else if (b.altri) altri = b.altri.map(a => a === 'dx' ? 72 : a === 'sx' ? -72 : 0);
    else if (b.tipo === 'bivio' && Math.abs(scelta) < 20) altri = [];
    else if (b.tipo === 'bivio') altri = [0];
    for (const a of altri) if (Math.abs(norm(a - scelta)) > 25) linea(a, 100, '#5d635f', 13, false);
    if (b.giri?.length === 2) {   // doppia svolta: «a destra, poi subito a sinistra»
      const a1 = b.giri[0].delta, a2 = a1 + b.giri[1].delta;
      const x1 = cx + Math.sin(rad(a1)) * 60 * s, y1 = cy - Math.cos(rad(a1)) * 60 * s;
      const x2 = x1 + Math.sin(rad(a2)) * 80 * s, y2 = y1 - Math.cos(rad(a2)) * 80 * s;
      c.strokeStyle = VERDE; c.lineWidth = 22 * s; c.lineJoin = 'round'; c.beginPath(); c.moveTo(cx, cy); c.lineTo(x1, y1); c.lineTo(x2, y2); c.stroke();
      this._punta(c, x2, y2, a2, VERDE, s); return;
    }
    linea(scelta, 125, VERDE, 22, true);
  }
  _punta(c, x, y, ang, col, s = 1) {
    c.save(); c.translate(x, y); c.rotate(rad(ang)); c.fillStyle = col; c.beginPath();
    c.moveTo(0, -30 * s); c.lineTo(24 * s, 6 * s); c.lineTo(-24 * s, 6 * s); c.closePath(); c.fill(); c.restore();
  }
  _zigzag(c, cx, cy, s) {
    c.strokeStyle = VERDE; c.lineWidth = 16 * s; c.lineJoin = 'round'; c.beginPath(); c.moveTo(cx, cy);
    const p = [[40, -25], [-40, -50], [40, -75], [-10, -110]]; for (const [x, y] of p) c.lineTo(cx + x * s, cy + y * s); c.stroke();
    this._punta(c, cx - 10 * s, cy - 110 * s, -20, VERDE, s * 0.8);
  }

  _paginaGuida(c, st) {
    if (st.km == null) {
      this._testoCentrato(c, 'Cerco il percorso…', 220, F(600, 40), TENUE);
      this._sottotitolo(c); return;
    }
    if (st.arrivato) { this._testoCentrato(c, 'Arrivo!', 200, F(700, 80), VERDE); this._testoCentrato(c, 'Forgia la tua medaglia', 290, T(700, 24)); return; }
    const p = st.prossimo;
    if (p && p.d <= 1000) {
      const vicino = p.d <= 220;
      this._bivio(c, p.b, W / 2, 222, 0.95);
      c.textAlign = 'center'; c.fillStyle = vicino ? AMBRA : BIANCO; c.font = F(700, p.d < 100 ? 78 : 66);
      c.fillText(p.d < 30 ? 'ORA' : `${metriParlati(p.d)} m`, W / 2, 312);
      this._testoCentrato(c, p.b.titolo, 366, F(600, 32), BIANCO, W - 30);
    } else {
      this._bivio(c, { tipo: 'bivio', icona: 0 }, W / 2, 210, 0.75);
      c.textAlign = 'center'; c.fillStyle = BIANCO; c.font = F(700, 46); c.fillText('Dritto', W / 2, 290);
      c.font = T(400, 21); c.fillStyle = TENUE;
      c.fillText(p ? `prossimo bivio fra ${kmParlati(p.d / 1000)} km` : `arrivo fra ${kmParlati(this.t.kmTot - st.km)} km`, W / 2, 330);
      c.font = F(600, 30); c.fillStyle = VERDE; c.fillText(st.sentiero ? `Sentiero ${st.sentiero}` : '', W / 2, 372);
    }
    // piede: chilometro e quota
    c.textAlign = 'left'; c.font = T(700, 18); c.fillStyle = TENUE;
    const q = Math.round(this.t.at(st.km)[2]);
    c.fillText(`km ${kmParlati(st.km)} / ${kmParlati(this.t.kmTot)}`, 22, 482); c.textAlign = 'right'; c.fillText(`${q} m`, W - 22, 482); c.textAlign = 'left';
    c.fillStyle = '#26302a'; c.fillRect(22, 458, W - 44, 6); c.fillStyle = VERDE; c.fillRect(22, 458, (W - 44) * st.km / this.t.kmTot, 6);
    this._sottotitolo(c, 396);
  }

  _paginaErrore(c, st) {
    c.fillStyle = '#3a0707'; c.fillRect(0, 60, W, 300);
    const e = this.ultimoEvento;
    const indietro = !st.fuori;
    const sbagliato = st.sbagliato;
    const titolo = indietro ? 'SENSO SBAGLIATO' : sbagliato ? 'SENTIERO SBAGLIATO' : 'FUORI PERCORSO';
    let px = 42; c.font = F(700, px); while (c.measureText(titolo).width > W - 30 && px > 24) c.font = F(700, --px);
    c.textAlign = 'center'; c.fillStyle = ROSSO; c.fillText(titolo, W / 2, 98);
    // freccia verso il percorso, rispetto al senso di marcia
    let ang = 180, d = st.dist;
    if (!indietro && this.fix && st.km != null) {
      const v = this.t.proietta(this.fix.lat, this.fix.lon, Math.max(0, st.km - 0.3), st.km + 1.5);
      const q = this.t.at(v.km); d = v.d;
      const b = bearing([this.fix.lat, this.fix.lon], q);
      ang = this.motore.direzione == null ? 0 : norm(b - this.motore.direzione);
      if (sbagliato) ang = 180;
    }
    c.save(); c.translate(W / 2, 222); c.rotate(rad(ang));
    c.fillStyle = BIANCO; c.beginPath(); c.moveTo(0, -95); c.lineTo(62, -20); c.lineTo(22, -20); c.lineTo(22, 80); c.lineTo(-22, 80); c.lineTo(-22, -20); c.lineTo(-62, -20); c.closePath(); c.fill();
    c.restore();
    c.textAlign = 'center'; c.fillStyle = BIANCO; c.font = F(700, 52);
    c.fillText(indietro ? 'Girati' : `${metriParlati(d || 0)} m`, W / 2, 340);
    this._sottotitolo(c, 380);
  }

  _paginaMappa(c, st, oraReale = performance.now()) {
    if (st.km == null) { this._testoCentrato(c, 'Cerco il percorso…', 220, F(600, 40), TENUE); return; }
    // mappa «in avanti»: il percorso davanti va verso l'alto (dalla traccia, senza bussola)
    const v = this._vistaLiscia(st, oraReale);
    if (!v) return;
    const km = v?.modo === 'traccia' ? v.km : st.km;
    // rotazione ammorbidita: il percorso davanti verso l'alto, senza scatti
    const dirT = this.t.direzioneDopo(km, 0.15);
    v.rot = v.rot == null ? dirT : (v.rot + norm(dirT - v.rot) * (1 - Math.exp(-v.dt / 0.8)) + 360) % 360;
    const dir = v.rot;
    const o = v.pt ? [v.pt[0], v.pt[1]] : this.t.at(km), k = Math.cos(rad(o[0]));
    const sc = 0.30;             // px per metro (1 km ≈ 300 px)
    const cx = W / 2, cy = 330;
    const xy = (p) => {
      const x = (p[1] - o[1]) * k * 111320, y = (p[0] - o[0]) * 110540;
      const r = rad(dir), xr = x * Math.cos(r) - y * Math.sin(r), yr = x * Math.sin(r) + y * Math.cos(r);
      return [cx + xr * sc, cy - yr * sc];
    };
    c.save(); c.beginPath(); c.rect(0, 56, W, 400); c.clip();
    const tratto = (a, b, col, w) => { c.strokeStyle = col; c.lineWidth = w; c.lineJoin = 'round'; c.lineCap = 'round'; c.beginPath();
      for (let x = a; x <= b; x += 0.01) { const [px, py] = xy(this.t.at(x)); x === a ? c.moveTo(px, py) : c.lineTo(px, py); } c.stroke(); };
    tratto(Math.max(0, km - 0.4), km, '#4c5550', 9);
    tratto(km, Math.min(this.t.kmTot, km + 1.3), VERDE, 11);
    for (const b of this.motore.bivi) {
      if (b.silenzioso || b.km < km || b.km > km + 1.3) continue;
      const [x, y] = xy(this.t.at(b.km)); c.fillStyle = AMBRA; c.beginPath(); c.arc(x, y, 9, 0, 7); c.fill();
    }
    if (v?.pt) { const [x, y] = xy(v.pt); c.fillStyle = '#4da3ff'; c.beginPath(); c.arc(x, y, 13, 0, 7); c.fill(); c.strokeStyle = BIANCO; c.lineWidth = 3; c.stroke(); }
    c.restore();
    c.font = T(700, 18); c.fillStyle = TENUE; c.textAlign = 'left'; c.fillText('100 m', 22, 446); c.fillStyle = TENUE; c.fillRect(22, 454, 30, 4);
    c.textAlign = 'right'; c.fillText(st.sentiero ? `Sentiero ${st.sentiero}` : '', W - 22, 446); c.textAlign = 'left';
  }

  _paginaGara(c, st) {
    const t = Math.max(0, Math.floor(this.ora / 1000));
    const hms = s => `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    c.textAlign = 'center'; c.fillStyle = BIANCO; c.font = F(700, 64); c.fillText(hms(t), W / 2, 112);
    c.font = T(400, 19); c.fillStyle = TENUE; c.fillText('tempo di gara', W / 2, 150);
    if (st.km != null) {
      c.font = F(700, 40); c.fillStyle = BIANCO; c.fillText(`km ${kmParlati(st.km)}`, W / 2, 205);
      // profilo altimetrico con la posizione
      const x0 = 22, x1 = W - 22, y0 = 300, y1 = 238; let qmin = 700, qmax = 2400;
      c.strokeStyle = '#4c5550'; c.lineWidth = 2; c.beginPath();
      for (let k = 0; k <= this.t.kmTot; k += 0.2) { const q = this.t.at(k)[2]; const x = x0 + (x1 - x0) * k / this.t.kmTot, y = y0 + (y1 - y0) * (q - qmin) / (qmax - qmin); k ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke();
      const q = this.t.at(st.km)[2]; c.fillStyle = '#4da3ff'; c.beginPath(); c.arc(x0 + (x1 - x0) * st.km / this.t.kmTot, y0 + (y1 - y0) * (q - qmin) / (qmax - qmin), 8, 0, 7); c.fill();
      const prossimo = CANCELLI.find(g => g.km > st.km + 0.05);
      if (prossimo && t > 0) {
        const vel = st.km / (t / 3600);            // km/h medi
        const stima = vel > 0.5 ? t + (prossimo.km - st.km) / vel * 3600 : null;
        const margine = stima != null ? Math.round((prossimo.ora - stima) / 60) : null;
        c.font = T(700, 20); c.fillStyle = BIANCO; c.fillText(prossimo.nome, W / 2, 346);
        const oraC = 9 * 3600 + prossimo.ora; c.font = T(400, 18); c.fillStyle = TENUE;
        c.fillText(`${prossimo.km === 29.706 ? 'tempo massimo' : 'cancello'} ore ${Math.floor(oraC / 3600)}:${String(Math.floor(oraC / 60) % 60).padStart(2, '0')}`, W / 2, 374);
        if (margine != null) { c.font = F(700, 30); c.fillStyle = margine >= 20 ? VERDE : margine >= 0 ? AMBRA : ROSSO; c.fillText(margine >= 0 ? `margine ${margine} min` : `in ritardo di ${-margine} min`, W / 2, 414); }
      }
    }
    c.textAlign = 'left';
  }

  _paginaSos(c, oraReale) {
    const s = this.sos;
    c.textAlign = 'center';
    if (s.stato === 'pronto') {
      c.fillStyle = '#5a0d0d'; c.beginPath(); c.arc(W / 2, 230, 120, 0, 7); c.fill();
      c.fillStyle = BIANCO; c.font = F(700, 72); c.fillText('SOS', W / 2, 252);
      this._testoCentrato(c, 'Tieni premuto il pulsante per 3 secondi', 392, T(700, 22), TENUE, W - 60);
    } else if (s.stato === 'conto') {
      const r = Math.max(0, Math.ceil((s.fineConto - oraReale) / 1000));
      c.fillStyle = ROSSO; c.beginPath(); c.arc(W / 2, 230, 120, 0, 7); c.fill();
      c.fillStyle = BIANCO; c.font = F(700, 110); c.fillText(String(r), W / 2, 268);
      this._testoCentrato(c, 'Invio fra poco. Premi il pulsante per annullare.', 392, T(700, 22), BIANCO, W - 60);
    } else if (s.stato === 'inviato') {
      this._titolo(c, 'SOS INVIATO', 150, ROSSO, 46);
      this._testoCentrato(c, `Sto avvisando la base… (invio ${s.tentativi})`, 220, T(700, 24), BIANCO, W - 60);
      this._testoCentrato(c, 'Resta dove sei. Copriti.', 330, F(600, 34), AMBRA);
    } else {
      this._titolo(c, 'SOCCORSO AVVISATO', 150, VERDE, 44);
      const dt = Math.round((s.tConferma - s.tInvio) / 1000);
      this._testoCentrato(c, `La base ha ricevuto la tua posizione (in ${dt} s).`, 220, T(700, 24), BIANCO, W - 60);
      this._testoCentrato(c, 'Resta dove sei. Copriti.', 330, F(600, 34), AMBRA);
    }
    c.textAlign = 'left';
  }
}
