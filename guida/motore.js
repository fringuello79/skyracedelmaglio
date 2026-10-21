// Motore della guida vocale SRM (prototipo).
// Riceve le posizioni GPS e restituisce gli avvisi da dire all'atleta.
// Non dipende dal browser: si prova anche al banco con Node.
import { dist, bearing, cardinale, Traccia } from '../posizione/geo.js';

const norm = a => ((a % 360) + 540) % 360 - 180;            // angolo tra -180 e 180
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const PRIORITA = { sos: 0, errore: 1, bivio: 2, info: 3 };

export const OPZIONI = {
  precisioneMax: 50,     // m: posizioni meno precise non decidono nulla
  corridoioMin: 25,      // m
  corridoioMax: 60,      // m
  corridoioBivio: [20, 40],
  preavviso: 200,        // m, oppure 60 s all'andatura del momento
  indicazione: 40,       // m
  adesso: 15,            // m
  verifica: 60,          // m dopo il bivio, salvo diverso per bivio
  fuoriFix: 3, fuoriMetri: 20,
  sbagliatoFix: 2, sbagliatoMetri: 10,
  ripetiFuori: 30000,    // ms
  velMax: 30 / 3.6,      // m/s
  gpsDebole: 60000,      // ms senza posizioni valide in movimento
  indietroFix: 3, indietroMetri: 25,
  kmGara: k => k,          // chilometro come lo conta la gara (serve quando si va al contrario)
  meta: 'arrivo',          // 'arrivo' oppure 'partenza' (guida al contrario)
  attesaDirezione: 45000,  // ms: nel tratto fatto due volte si aspetta di capire il senso di marcia
};

// ---------- frasi ----------
const AZ = {
  'dritto':     { lungo: 'prosegui dritto',          breve: 'dritto',             icona: 0 },
  'tieni-dx':   { lungo: 'tieni la destra',          breve: 'tieni la destra',    icona: 30 },
  'tieni-sx':   { lungo: 'tieni la sinistra',        breve: 'tieni la sinistra',  icona: -30 },
  'gira-dx':    { lungo: 'gira a destra',            breve: 'a destra',           icona: 90 },
  'gira-sx':    { lungo: 'gira a sinistra',          breve: 'a sinistra',         icona: -90 },
  'stretta-dx': { lungo: 'svolta stretta a destra',  breve: 'stretta a destra',   icona: 140 },
  'stretta-sx': { lungo: 'svolta stretta a sinistra', breve: 'stretta a sinistra', icona: -140 },
};
export const AZIONI = Object.keys(AZ);

const POS = {
  'sx':  { lungo: 'prendi il sentiero più a sinistra', breve: 'il sentiero più a sinistra', icona: -60 },
  'dx':  { lungo: 'prendi il sentiero più a destra',   breve: 'il sentiero più a destra',   icona: 60 },
  'centro': { lungo: 'prendi il sentiero centrale',    breve: 'il sentiero centrale',       icona: 0 },
  '2sx': { lungo: 'prendi il secondo sentiero da sinistra', breve: 'il secondo da sinistra', icona: -25 },
  '2dx': { lungo: 'prendi il secondo sentiero da destra',   breve: 'il secondo da destra',   icona: 25 },
};
export const POSIZIONI = Object.keys(POS);
const NUMERI = ['', '', 'due', 'tre', 'quattro', 'cinque'];

const maiuscola = s => s.charAt(0).toUpperCase() + s.slice(1);
export function metriParlati(m) {
  m = Math.max(10, m);
  return m >= 100 ? Math.round(m / 50) * 50 : Math.round(m / 10) * 10;
}
export const kmParlati = km => (Math.round(km * 10) / 10).toLocaleString('it-IT', { maximumFractionDigits: 1 });

export function azioneAutomatica(delta) {
  const a = Math.abs(delta), lato = delta >= 0 ? 'dx' : 'sx';
  if (a < 20) return 'dritto';
  if (a < 45) return 'tieni-' + lato;
  if (a < 135) return 'gira-' + lato;
  return 'stretta-' + lato;
}

// Calcola geometria e frasi di un bivio sulla traccia.
export function preparaBivio(traccia, b) {
  const km = clamp(b.km, 0.03, traccia.kmTot - 0.03);
  const [lat, lon, ele] = traccia.at(km);
  const entrata = bearing(traccia.at(km - 0.03), traccia.at(km));
  const uscita = bearing(traccia.at(km), traccia.at(km + 0.04));
  const delta = norm(uscita - entrata);
  const quotaDopo = traccia.at(km + 0.1)[2];
  const salita = quotaDopo - ele;
  const azione = (b.azione && b.azione !== 'auto') ? b.azione : azioneAutomatica(delta);
  const pend = b.pendenza === 'no' ? '' : salita > 8 ? 'in salita' : salita < -8 ? 'in discesa' : '';
  const pos = POS[b.posizione];
  const az = AZ[azione];
  const rami = b.rami >= 3 ? b.rami : 0;
  const tipo = rami ? `incrocio a ${NUMERI[rami]} sentieri` : 'bivio';
  const cosa = pos ? pos.lungo : az.lungo;
  const breve = pos ? pos.breve : az.breve;
  const coda = pend ? `, ${pend}` : '';
  const segno = (b.segno || '').trim().replace(/\.$/, '');
  const sentDopo = traccia.sentiero(km + 0.05), sentPrima = traccia.sentiero(km - 0.05);
  return {
    ...b, km, lat, lon, entrata, uscita, delta, salita, azioneEff: azione,
    verificaM: b.verifica || OPZIONI.verifica,
    icona: pos ? pos.icona : az.icona,
    titolo: maiuscola(cosa) + coda,
    segnoTesto: segno,
    frasi: {
      pre: d => `Tra ${metriParlati(d)} metri, ${tipo}. ${maiuscola(cosa)}${coda}.`,
      ind: `${rami ? "All'incrocio" : 'Al bivio'}, ${cosa}${coda}.${segno ? ' ' + maiuscola(segno) + '.' : ''}`,
      ora: azione === 'dritto' && !pos ? null : `Ora ${breve}.`,
      giusto: sentDopo && sentDopo !== sentPrima ? `Giusto. Sei sul sentiero ${sentDopo}.` : 'Giusto.',
    },
  };
}

// ---------- motore ----------
export class Motore {
  constructor(traccia, bivi = [], opzioni = {}) {
    this.t = traccia;
    this.o = { ...OPZIONI, ...opzioni };
    this.impostaBivi(bivi);
    this.reset();
  }

  impostaBivi(bivi) {
    this.bivi = bivi.map(b => preparaBivio(this.t, b)).sort((a, b) => a.km - b.km);
  }

  reset(km = null) {
    this.km = km; this.tKm = null; this.kmMax = km ?? 0;
    this.fuori = null;
    this.storia = []; this.buf = [];
    this.flag = new Map();
    this.ultimaValida = null; this.ultimoMovimento = 0;
    this.velocita = 0; this.direzione = null;
    this.gpsAvvisato = false;
    this.indietro = { n: 0, da: null, avvisato: false };
    this.silenzioIndietroFino = 0;
    this.arrivato = false;
    this.lontanoUltimo = 0;
    this.pos = null; this.dist = null;
    this.attesa = null; this.attesaDetta = false;
  }

  _flag(b) {
    if (!this.flag.has(b.id)) this.flag.set(b.id, { pre: false, ind: false, ora: false, ver: false, sbagliato: false });
    return this.flag.get(b.id);
  }

  _corridoio(acc) {
    const o = this.o;
    let c = clamp(Math.max(o.corridoioMin, 2 * acc), o.corridoioMin, o.corridoioMax);
    if (this.km != null && this.bivi.some(b => this.km >= b.km - 0.05 && this.km <= b.km + b.verificaM / 1000 + 0.05)) {
      c = clamp(1.5 * acc, ...o.corridoioBivio);
    }
    return c;
  }

  // direzione di marcia e velocità dagli ultimi spostamenti
  _movimento(fix) {
    this.storia.push(fix);
    while (this.storia.length && fix.t - this.storia[0].t > 40000) this.storia.shift();
    let ref = null;
    for (let i = this.storia.length - 2; i >= 0; i--) {
      if (dist([this.storia[i].lat, this.storia[i].lon], [fix.lat, fix.lon]) >= 20) { ref = this.storia[i]; break; }
    }
    const old = this.storia[0];
    const dt = (fix.t - old.t) / 1000;
    this.velocita = dt >= 5 ? dist([old.lat, old.lon], [fix.lat, fix.lon]) / dt : this.velocita;
    this.direzione = ref ? bearing([ref.lat, ref.lon], [fix.lat, fix.lon]) : (this.velocita < 0.3 ? null : this.direzione);
    if (this.velocita > 0.6) this.ultimoMovimento = fix.t;
  }

  _lato(fix, puntoTraccia) {
    const b = bearing([fix.lat, fix.lon], puntoTraccia);
    if (this.direzione == null) return `verso ${cardinale(b)}`;
    const r = norm(b - this.direzione);
    if (Math.abs(r) <= 25) return 'davanti a te';
    if (Math.abs(r) >= 155) return 'alle tue spalle';
    return r > 0 ? 'alla tua destra' : 'alla tua sinistra';
  }

  // Da chiamare ogni secondo circa, anche senza posizioni nuove.
  tick(t) {
    const ev = [];
    if (this.km != null && !this.arrivato && this.ultimaValida && !this.gpsAvvisato &&
        t - this.ultimaValida > this.o.gpsDebole && this.ultimoMovimento > this.ultimaValida - 30000) {
      this.gpsAvvisato = true;
      ev.push({ tipo: 'gps', priorita: PRIORITA.info, suono: 'attenzione', testo: 'Segnale GPS debole. Avviso di fuori percorso sospeso.' });
    }
    return ev;
  }

  posizione(fix) {
    const ev = [];
    const o = this.o, T = this.t;
    if (this.arrivato) return ev;
    if (!(fix.acc <= o.precisioneMax)) return ev;
    if (this.gpsAvvisato) { this.gpsAvvisato = false; ev.push({ tipo: 'gps-ok', priorita: PRIORITA.info, testo: 'Segnale GPS tornato.' }); }
    this.ultimaValida = fix.t;
    // posizione mediata sugli ultimi 3-4 secondi: smorza i salti del GPS
    this.buf.push(fix);
    while (this.buf.length && (fix.t - this.buf[0].t > 3500 || this.buf.length > 4)) this.buf.shift();
    const grezza = fix;
    fix = { ...fix, lat: this.buf.reduce((a, q) => a + q.lat, 0) / this.buf.length, lon: this.buf.reduce((a, q) => a + q.lon, 0) / this.buf.length };
    this._movimento(fix);
    const corr = this._corridoio(grezza.acc);

    // primo aggancio alla traccia
    if (this.km == null) {
      const a = T.proietta(fix.lat, fix.lon, 0, T.kmTot / 2), b = T.proietta(fix.lat, fix.lon, T.kmTot / 2, T.kmTot);
      let p = a.d <= b.d + 30 ? a : b;
      // tratto percorso due volte: si sceglie il passaggio che va nel senso in cui ci si muove
      if (a.d <= corr && b.d <= corr && Math.abs(a.km - b.km) > 1) {
        const concorde = q => this.direzione != null && Math.abs(norm(this.direzione - T.direzioneDopo(q.km, 0.03))) < 90;
        if (this.direzione == null) {
          this.attesa ??= fix.t;
          if (fix.t - this.attesa < o.attesaDirezione) {
            this.pos = fix; this.dist = Math.min(a.d, b.d);
            if (!this.attesaDetta) { this.attesaDetta = true; ev.push({ tipo: 'attesa', priorita: PRIORITA.info, testo: 'Sei sul percorso. Inizia a muoverti e capisco in che senso vai.' }); }
            return ev;
          }
        } else p = concorde(b) && !concorde(a) ? b : a;
      }
      this.pos = fix; this.dist = p.d;
      if (p.d > corr) {
        if (fix.t - this.lontanoUltimo > 60000) {
          this.lontanoUltimo = fix.t;
          const q = T.at(p.km);
          const d = p.d >= 1000 ? `${kmParlati(p.d / 1000)} chilometri` : `${metriParlati(p.d)} metri`;
          ev.push({ tipo: 'lontano', priorita: PRIORITA.info, testo: `Raggiungi il percorso: è a ${d}, ${this._lato(fix, q)}. Segui sentieri e strade.` });
        }
        return ev;
      }
      this.km = p.km; this.tKm = fix.t; this.kmMax = p.km;
      ev.push({ tipo: 'aggancio', priorita: PRIORITA.info, suono: 'positivo', testo: `Sei sul percorso, al chilometro ${kmParlati(o.kmGara(p.km))}.` });
      this._bivi(ev, fix, true);
      return ev;
    }

    let p = T.proietta(fix.lat, fix.lon, this.km - 0.2, this.km + 1.5);
    // avanzamento impossibile per un essere umano: errore del GPS
    const dt = (fix.t - this.tKm) / 1000;
    if (p.km - this.km > (dt * o.velMax + 40) / 1000) return ev;   // salto impossibile: errore del GPS, si ignora
    this.pos = fix; this.dist = p.d;

    const dentro = this.fuori?.annunciato ? p.d <= corr * 0.75 : p.d <= corr;
    if (dentro) {
      if (this.fuori) {
        if (this.fuori.annunciato) ev.push({ tipo: 'rientro', priorita: PRIORITA.errore, suono: 'positivo', testo: 'Sei di nuovo sul percorso.' });
        this.fuori = null;
      }
      this._controllaVerso(ev, fix, p);
      if (p.km >= this.km - 0.2) { this.km = p.km; this.tKm = fix.t; this.kmMax = Math.max(this.kmMax, p.km); }
      this._bivi(ev, fix, false, p.d <= Math.max(12, 0.6 * corr));
      if (this.km >= T.kmTot - 0.03 && this.kmMax >= T.kmTot - 0.03) {
        this.arrivato = true;
        ev.push({ tipo: 'arrivo', priorita: PRIORITA.bivio, suono: 'positivo',
          testo: o.meta === 'partenza' ? 'Sei tornato alla partenza. Fine della guida.' : 'Arrivo. Complimenti, gara finita!' });
      }
      return ev;
    }

    // fuori dal corridoio
    if (!this.fuori) this.fuori = { n: 0, primo: [fix.lat, fix.lon], annunciato: false, ultimo: 0, bivio: this._bivioRecente() };
    const f = this.fuori;
    f.n++;
    const fatti = dist(f.primo, [fix.lat, fix.lon]);
    const soglia = f.bivio ? [o.sbagliatoFix, o.sbagliatoMetri] : [o.fuoriFix, o.fuoriMetri];
    const confermato = f.n >= soglia[0] && (fatti >= soglia[1] || p.d > corr * 1.5);
    if (!confermato) return ev;
    if (f.annunciato && fix.t - f.ultimo < o.ripetiFuori) return ev;

    const ancora = f.annunciato ? 'Ancora fuori. ' : '';
    if (f.bivio) {
      const n = metriParlati(dist([fix.lat, fix.lon], [f.bivio.lat, f.bivio.lon]));
      this._flag(f.bivio).sbagliato = true;
      ev.push({ tipo: 'sbagliato', priorita: PRIORITA.errore, suono: 'allarme', bivio: f.bivio.id,
        testo: f.annunciato ? `${ancora}Torna al bivio, ${n} metri indietro.` : `Sentiero sbagliato. Torna al bivio, ${n} metri indietro.` });
    } else {
      const vicino = T.proietta(fix.lat, fix.lon, this.km - 0.3, this.km + 1.5);
      const q = T.at(vicino.km);
      const lato = this._lato(fix, q);
      const quanto = vicino.d >= 1000 ? `${kmParlati(vicino.d / 1000)} chilometri` : `${metriParlati(vicino.d)} metri`;
      let testo = `${f.annunciato ? ancora : 'Fuori percorso. '}Il percorso è a ${quanto}, ${lato}.`;
      if (vicino.d > 300) testo += ' Torna indietro sulla strada che hai fatto.';
      ev.push({ tipo: 'fuori', priorita: PRIORITA.errore, suono: 'allarme', testo });
    }
    f.annunciato = true; f.ultimo = fix.t;
    return ev;
  }

  _bivioRecente() {
    return this.bivi.find(b => {
      const f = this._flag(b);
      return (f.ind || f.pre) && !f.ver && b.km >= this.km - 0.25 && b.km <= this.km + 0.05;
    }) || null;
  }

  _controllaVerso(ev, fix, p) {
    const s = this.indietro;
    if (this.direzione == null || this.velocita < 0.6) return;
    const dirTraccia = this.t.direzioneDopo(p.km, 0.03);
    if (Math.abs(norm(this.direzione - dirTraccia)) > 135) {
      if (!s.da) s.da = [fix.lat, fix.lon];
      s.n++;
      if (!s.avvisato && s.n >= this.o.indietroFix && dist(s.da, [fix.lat, fix.lon]) >= this.o.indietroMetri && fix.t > this.silenzioIndietroFino) {
        s.avvisato = true;
        ev.push({ tipo: 'indietro', priorita: PRIORITA.errore, suono: 'allarme', testo: this.o.meta === 'partenza'
          ? 'Stai andando nel senso della gara. Se è voluto, tocca «Riprendi il senso della gara».'
          : 'Stai andando al contrario. Se vuoi tornare indietro, tocca «Torna indietro». Altrimenti girati.' });
      }
    } else if (s.n) {
      this.indietro = { n: 0, da: null, avvisato: false };
    }
  }

  _bivi(ev, fix, primoAggancio, benCentrato = true) {
    const o = this.o;
    const v = Math.max(this.velocita, 1.5);
    for (const b of this.bivi) {
      if (b.km < this.km - 0.4 || b.km > this.km + 1) continue;
      const f = this._flag(b);
      const D = (b.km - this.km) * 1000;
      if (primoAggancio && D < 0) { f.pre = f.ind = f.ora = f.ver = true; continue; }
      const dInd = Math.max(o.indicazione, v * 12);
      if (!f.pre && D <= Math.max(o.preavviso, v * 60) && D > dInd + 30) {
        f.pre = true;
        ev.push({ tipo: 'preavviso', priorita: PRIORITA.bivio, suono: 'attenzione', bivio: b.id, testo: b.frasi.pre(D) });
      }
      if (!f.ind && D <= dInd && D > -15) {
        f.ind = f.pre = true;
        ev.push({ tipo: 'indicazione', priorita: PRIORITA.bivio, suono: 'attenzione', bivio: b.id, testo: b.frasi.ind });
      }
      if (!f.ora && b.frasi.ora && f.ind && D <= o.adesso && D > -10) {
        f.ora = true;
        ev.push({ tipo: 'ora', priorita: PRIORITA.bivio, bivio: b.id, testo: b.frasi.ora });
      }
      if (!f.ver && D <= -b.verificaM && benCentrato) {
        f.ver = f.pre = f.ind = f.ora = true;
        ev.push({ tipo: 'giusto', priorita: PRIORITA.info, suono: 'positivo', bivio: b.id,
          testo: f.sbagliato ? 'Bene, ora sei sul sentiero giusto.' : b.frasi.giusto });
      }
    }
  }

  silenziaIndietro(t, ms = 300000) { this.silenzioIndietroFino = t + ms; }

  // Riparte dal chilometro indicato (dopo «Torna indietro»): i bivi già alle spalle non vengono annunciati.
  aggancia(km, t) {
    this.km = km; this.tKm = t; this.kmMax = km;
    for (const b of this.bivi) if (b.km < km - 0.02) Object.assign(this._flag(b), { pre: true, ind: true, ora: true, ver: true });
  }

  prossimoBivio() {
    if (this.km == null) return null;
    const b = this.bivi.find(x => !this._flag(x).ver && x.km >= this.km - 0.02);
    return b ? { b, d: Math.max(0, (b.km - this.km) * 1000) } : null;
  }

  stato() {
    return {
      km: this.km, dist: this.dist, fuori: !!this.fuori?.annunciato, sbagliato: !!(this.fuori?.annunciato && this.fuori.bivio),
      velocita: this.velocita, direzione: this.direzione, prossimo: this.prossimoBivio(), arrivato: this.arrivato,
      sentiero: this.km != null ? this.t.sentiero(this.km) : '',
    };
  }

  doveSono() {
    if (this.km == null) return 'Non sei ancora sul percorso.';
    let s = `Sei al chilometro ${kmParlati(this.o.kmGara(this.km))}`;
    const sent = this.t.sentiero(this.km);
    if (sent) s += `, sul sentiero ${sent}`;
    s += `. Mancano ${kmParlati(Math.max(0, this.t.kmTot - this.km))} chilometri ${this.o.meta === 'partenza' ? 'alla partenza' : "all'arrivo"}.`;
    const p = this.prossimoBivio();
    if (p) s += ` Prossimo bivio tra ${p.d >= 1000 ? kmParlati(p.d / 1000) + ' chilometri' : metriParlati(p.d) + ' metri'}: ${p.b.titolo.toLowerCase()}.`;
    return s;
  }
}

// ---------- guida al contrario ----------
// Lo stesso percorso percorso all'inverso: i chilometri ripartono da zero dal punto finale.
export function invertiTraccia(t) {
  const K = t.kmTot;
  const pts = t.pts.slice().reverse().map(p => [p[0], p[1], p[2], Math.round((K - p[3]) * 1000) / 1000]);
  const comune = t.comune.map(([a, b]) => [K - b, K - a]).sort((x, y) => x[0] - y[0]);
  const sentieri = t.sentieri.map(s => ({ da: Math.max(0, K - s.a), a: K - s.da, nome: s.nome })).reverse();
  return new Traccia({ pts, km_tot: K, comune, sentieri });
}

// Bivi al contrario: stessi incroci, direzione ricalcolata dalla traccia invertita.
// Quale sentiero prendere e il segno da cercare valgono per il senso di gara, quindi non si riportano.
export function invertiBivi(bivi, tInv) {
  const K = tInv.kmTot;
  return bivi.map(b => {
    const km = Math.round((K - b.km) * 1000) / 1000;
    const prima = tInv.sentiero(km - 0.05), dopo = tInv.sentiero(km + 0.05);
    return { id: b.id, km, azione: 'auto', rami: b.rami || 0, verifica: b.verifica, fonte: b.fonte,
      segno: dopo && prima !== dopo ? 'sentiero ' + dopo : undefined };
  });
}

// ---------- bivi automatici ----------
// Svolte nette della traccia: utili per una traccia di prova in città, non per i sentieri di montagna
// (dove i tornanti non sono bivi).
export function svolteAutomatiche(traccia, sogliaGradi = 35) {
  const cand = [];
  for (let km = 0.05; km <= traccia.kmTot - 0.05; km += 0.005) {
    const d = norm(bearing(traccia.at(km), traccia.at(km + 0.03)) - bearing(traccia.at(km - 0.03), traccia.at(km)));
    if (Math.abs(d) >= sogliaGradi) cand.push({ km, d });
  }
  const out = [];
  for (const c of cand) {
    const u = out.at(-1);
    if (u && c.km - u.km < 0.06) { if (Math.abs(c.d) > Math.abs(u.d)) Object.assign(u, c); }
    else out.push({ ...c });
  }
  return out.map((c, i) => ({ id: 'A' + String(i + 1).padStart(2, '0'), km: Math.round(c.km * 1000) / 1000, azione: 'auto', fonte: 'svolta' }));
}

// Traccia da un file GPX (per le prove fuori dal percorso di gara).
export function tracciaDaGpx(testo, Traccia) {
  const pts = [...testo.matchAll(/<(?:trkpt|rtept)\b([^>]*)>([\s\S]*?)<\/(?:trkpt|rtept)>|<(?:trkpt|rtept)\b([^>]*)\/>/g)].map(m => {
    const attr = m[1] || m[3] || '';
    const lat = +(/lat="([^"]+)"/.exec(attr) || [])[1], lon = +(/lon="([^"]+)"/.exec(attr) || [])[1];
    const ele = +((/<ele>([^<]+)<\/ele>/.exec(m[2] || '') || [])[1] || 0);
    return [lat, lon, ele];
  }).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (pts.length < 2) throw new Error('Il file non contiene una traccia GPX leggibile.');
  let km = 0;
  const out = pts.map((p, i) => { if (i) km += dist(pts[i - 1], p) / 1000; return [p[0], p[1], p[2], Math.round(km * 1000) / 1000]; })
    .filter((p, i, a) => i === 0 || p[3] > a[i - 1][3]);
  return new Traccia({ pts: out, km_tot: out.at(-1)[3], comune: [], sentieri: [] });
}
