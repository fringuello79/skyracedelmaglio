// Rete mesh Meshtastic simulata a eventi: chi trasmette, chi riceve, chi ripete.
// Riproduce le regole che contano per la gara:
//  - ascolto prima di trasmettere (CAD) e niente trasmissione mentre si sta ricevendo;
//  - collisioni al ricevitore (si salva solo il pacchetto più forte di almeno 6 dB già agganciato);
//  - un solo canale, half duplex: chi trasmette non sente;
//  - flooding gestito: i ripetitori (ROUTER) ripetono sempre, gli altri rinunciano se sentono già la ripetizione;
//    i corridori sono CLIENT_MUTE (non ripetono);
//  - limite di legge in Europa: 10% del tempo per ogni apparato, su un'ora;
//  - chi ha trasmesso capisce di essere stato ripetuto se sente la ripetizione (conferma implicita).
import { PRESET, tempoInAria, sensibilita, rumore, slotMs, finestraDaSnr, CW_MAX, collegamento, BOSCO, FADING } from './radio.js';

class Coda {          // heap binario sul tempo
  constructor() { this.a = []; this.n = 0; }
  get size() { return this.a.length; }
  push(e) { e.s = this.n++; const a = this.a; a.push(e); let i = a.length - 1;
    while (i) { const p = (i - 1) >> 1; if (this._m(a[p], a[i])) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  _m(x, y) { return x.t < y.t || (x.t === y.t && x.s < y.s); }
  peek() { return this.a[0]; }
  pop() { const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
      if (l < a.length && this._m(a[l], a[m])) m = l; if (r < a.length && this._m(a[r], a[m])) m = r;
      if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top; }
}

export const BYTE = { pos: 50, stato: 52, sos: 60, ack: 28 };

export class Rete {
  constructor(terreno, { preset = 'MediumFast', seme = 7, dutyCycle = 0.10 } = {}) {
    this.T = terreno; this.p = PRESET[preset]; this.presetNome = preset;
    this.sens = sensibilita(this.p); this.noise = rumore(this.p); this.slot = slotMs(this.p);
    this.duty = dutyCycle;
    this.nodi = []; this.perId = new Map();
    this.q = new Coda(); this.t = 0; this.attive = new Map(); this.prossimoTx = 1; this.prossimoPkt = 1;
    let s = seme >>> 0 || 1; this.rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    this.cache = new Map();
    this.stat = { tx: 0, collisioni: 0, rinunce: 0, dutyScartati: 0, occupato: 0 };
    this.osservatori = [];        // funzioni chiamate a ogni ricezione riuscita (per disegnare)
  }

  gauss() { let u = 0, v = 0; while (!u) u = this.rnd(); while (!v) v = this.rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  // nodo: { id, ruolo: 'BASE'|'ROUTER'|'CLIENT'|'CLIENT_MUTE', fisso, pos | posizione(t), h, ptx, g, extra,
  //         ascolta (riceve anche se mobile), intervallo (ms, posizione periodica), genera(t), ricevuto(pkt,t,snr), ack(pkt,t) }
  aggiungi(n) {
    Object.assign(n, { stato: 'libero', coda: [], ricezioni: [], visti: new Set(), inviati: new Map(), aria: [], ariaOra: 0, ariaTot: 0, sentito: 0, attivo: n.attivo !== false });
    this.nodi.push(n); this.perId.set(n.id, n);
    if (n.intervallo) this.q.push({ t: this.t + this.rnd() * n.intervallo, k: 'gen', n });
    return n;
  }

  pos(n, t) { return n.fisso ? n.pos : n.posizione(t); }

  // potenza ricevuta in dBm (con variazione casuale) da a verso b al tempo t
  prx(a, b, t) {
    const pa = this.pos(a, t), pb = this.pos(b, t);
    if (!pa || !pb) return -999;
    const fissi = a.fisso && b.fisso;
    const chiave = fissi ? (a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id) : null;
    let c = chiave && this.cache.get(chiave);
    if (!c) {
      const extraBosco = n => (!n.fisso && this.T.quota(...this.pos(n, t)) < BOSCO.sotto) ? BOSCO.perdita : 0;
      c = collegamento(this.T, { pos: pa, h: a.h, ptx: a.ptx, g: a.g, extra: (a.extra || 0) + extraBosco(a) },
                               { pos: pb, h: b.h, ptx: 0, g: b.g, extra: (b.extra || 0) + extraBosco(b) });
      if (chiave) this.cache.set(chiave, c);
    }
    return c.prx + FADING * this.gauss();
  }

  // ----- applicazione: mettere in coda un pacchetto nuovo -----
  invia(n, tipo, dati = {}, { hop = 3 } = {}) {
    const pkt = { id: this.prossimoPkt++, da: n.id, tipo, dati, hop, hopStart: hop, byte: BYTE[tipo] || 50, tGen: this.t };
    n.visti.add(pkt.id);
    n.inviati.set(pkt.id, { pkt, ack: false });
    this._accoda(n, pkt, this.t + this.rnd() * 2 ** 5 * this.slot);
    return pkt;
  }

  _accoda(n, pkt, quando) {
    n.coda.push({ pkt, quando });
    if (n.stato === 'libero') { n.stato = 'attesa'; this.q.push({ t: Math.max(quando, this.t), k: 'prova', n }); }
  }

  _occupato(n) {
    // sta ricevendo qualcosa, oppure il CAD sente una trasmissione in corso
    if (n.ricezioni.length) return this.t + 1;
    let fine = 0;
    for (const tx of this.attive.values()) {
      if (tx.n === n) continue;
      let p = tx.rx.get(n.id);
      if (p === undefined) { p = this.prx(tx.n, n, this.t); tx.rx.set(n.id, p); }
      if (p >= this.sens - 2) fine = Math.max(fine, tx.t1);
    }
    return fine;
  }

  _dutyOk(n, dur) {
    while (n.aria.length && this.t - n.aria[0][0] > 3600000) n.ariaOra -= n.aria.shift()[1];
    return n.ariaOra + dur <= this.duty * 3600000;
  }

  _prova(n) {
    if (!n.attivo) { n.coda = []; n.stato = 'libero'; return; }
    const prossimo = n.coda[0];
    if (!prossimo) { n.stato = 'libero'; return; }
    if (prossimo.annullato) { n.coda.shift(); this.stat.rinunce++; return this._prova(n); }
    const occ = this._occupato(n);
    if (occ > this.t) {
      const cw = 2 ** finestraDaSnr(0);
      this.q.push({ t: occ + Math.floor(this.rnd() * cw) * this.slot, k: 'prova', n });
      return;
    }
    n.coda.shift();
    const pkt = prossimo.pkt;
    const dur = tempoInAria(this.p, pkt.byte);
    if (!this._dutyOk(n, dur)) { this.stat.dutyScartati++; return this._prova(n); }
    n.aria.push([this.t, dur]); n.ariaOra += dur; n.ariaTot += dur;
    n.stato = 'tx';
    // chi trasmette perde quello che stava ricevendo
    for (const r of n.ricezioni) r.ok = false;
    const tx = { id: this.prossimoTx++, n, pkt: { ...pkt }, t0: this.t, t1: this.t + dur, rx: new Map(), ric: [] };
    this.attive.set(tx.id, tx); this.stat.tx++;
    for (const r of this.nodi) {
      if (r === n || !r.attivo || (!r.fisso && !r.ascolta)) continue;
      const p = this.prx(n, r, this.t);
      tx.rx.set(r.id, p);
      if (p < this.sens) continue;
      r.sentito += dur;
      if (r.stato === 'tx') continue;
      const ric = { tx, p, ok: true };
      for (const o of r.ricezioni) {
        if (o.p >= p + 6) ric.ok = false;          // il vecchio regge, il nuovo si perde
        else { o.ok = false; ric.ok = false; this.stat.collisioni++; }
      }
      r.ricezioni.push(ric); tx.ric.push([r, ric]);
    }
    this.q.push({ t: tx.t1, k: 'fine', tx });
  }

  _fine(tx) {
    this.attive.delete(tx.id);
    const n = tx.n; n.stato = 'libero';
    for (const [r, ric] of tx.ric) {
      r.ricezioni = r.ricezioni.filter(x => x !== ric);
      if (ric.ok) this._consegna(r, tx.pkt, ric.p - this.noise, n);
    }
    if (n.coda.length) { n.stato = 'attesa'; this.q.push({ t: Math.max(this.t, n.coda[0].quando), k: 'prova', n }); }
  }

  _consegna(r, pkt, snr, da) {
    for (const f of this.osservatori) f(da, r, pkt, this.t);
    if (r.visti.has(pkt.id)) {
      // già visto: se è mio e qualcuno lo ripete, è la conferma implicita
      const mio = r.inviati.get(pkt.id);
      if (mio && !mio.ack) { mio.ack = true; r.ack?.(pkt, this.t, da); }
      // chi non è ROUTER rinuncia a ripetere se l'ha già ripetuto qualcun altro
      if (r.ruolo === 'CLIENT') for (const c of r.coda) if (c.pkt.id === pkt.id) c.annullato = true;
      return;
    }
    r.visti.add(pkt.id);
    r.ricevuto?.(pkt, this.t, snr, da);
    if (pkt.hop > 0 && (r.ruolo === 'ROUTER' || r.ruolo === 'CLIENT')) {
      const cw = finestraDaSnr(snr);
      const ritardo = r.ruolo === 'ROUTER' ? Math.floor(this.rnd() * 2 * cw) * this.slot
                                           : (2 * CW_MAX + Math.floor(this.rnd() * 2 ** cw)) * this.slot;
      this._accoda(r, { ...pkt, hop: pkt.hop - 1 }, this.t + ritardo);
    }
  }

  // fa avanzare la simulazione fino al tempo t (ms)
  avanza(t) {
    while (this.q.size && this.q.peek().t <= t) {
      const e = this.q.pop(); this.t = e.t;
      if (e.k === 'prova') this._prova(e.n);
      else if (e.k === 'fine') this._fine(e.tx);
      else if (e.k === 'gen') {
        if (e.n.attivo) e.n.genera?.(this.t);
        if (e.n.intervallo) this.q.push({ t: this.t + e.n.intervallo * (0.95 + 0.1 * this.rnd()), k: 'gen', n: e.n });
      }
    }
    this.t = t;
  }

  // copertura media di un punto verso i nodi fissi attivi (per colorare il percorso)
  margine(punto, quando = 0) {
    let best = { m: -999, id: null };
    for (const r of this.nodi) {
      if (!r.fisso || !r.attivo) continue;
      const fittizio = { fisso: true, id: '_p', pos: punto.pos, h: punto.h, ptx: punto.ptx, g: punto.g, extra: punto.extra };
      const c = collegamento(this.T, fittizio, r);
      const m = c.prx - this.sens;
      if (m > best.m) best = { m, id: r.id };
    }
    return best;
  }
}
