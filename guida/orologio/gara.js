// Scenario di gara per la rete: base, ripetitori sulle cime, 146 atleti con i tempi veri del 2026.
// Gli atleti vanno più piano in salita e nelle discese ripide; il tempo totale è quello della classifica.
import { Rete } from './rete.js';
import { APPARATI } from './radio.js';

// costo di un metro rispetto al piano, in funzione della pendenza (salita come Naismith, discesa tecnica)
function costo(g) {
  if (g >= 0) return 1 + 8 * g;
  const a = -g;
  return a < 0.1 ? 1 - 1.5 * a : 0.85 + 3 * (a - 0.1);
}

export class Andature {
  constructor(traccia, passo = 0.1) {
    this.t = traccia; this.passo = passo;
    const n = Math.ceil(traccia.kmTot / passo);
    this.F = new Float64Array(n + 1);          // frazione del tempo totale all'inizio di ogni passo
    let tot = 0; const c = [];
    for (let i = 0; i < n; i++) {
      const a = traccia.at(i * passo), b = traccia.at(Math.min(traccia.kmTot, (i + 1) * passo));
      const L = (Math.min(traccia.kmTot, (i + 1) * passo) - i * passo) * 1000;
      const k = L * costo((b[2] - a[2]) / Math.max(L, 1)); c.push(k); tot += k;
    }
    let s = 0; for (let i = 0; i < n; i++) { this.F[i] = s / tot; s += c[i]; } this.F[n] = 1;
  }
  // chilometro raggiunto dopo la frazione f del proprio tempo totale
  km(f) {
    if (f <= 0) return 0; if (f >= 1) return this.t.kmTot;
    const F = this.F; let lo = 0, hi = F.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (F[m] <= f) lo = m; else hi = m; }
    return Math.min(this.t.kmTot, (lo + (f - F[lo]) / (F[hi] - F[lo])) * this.passo);
  }
}

export function creaGara(terreno, traccia, dati, opz = {}) {
  const o = { preset: 'MediumFast', intervallo: 120000, hop: 3, ruoloAtleti: 'CLIENT_MUTE', attivi: null, seme: 7, atleti: true, ...opz };
  const rete = new Rete(terreno, { preset: o.preset, seme: o.seme });
  rete.t = o.t0 || 0; rete.t0 = rete.t;      // si può partire a gara in corso
  const and = new Andature(traccia);
  const base = { arrivi: new Map(), generati: 0, ricevuti: 0, latenze: [], allarmi: [], perAtleta: new Map() };

  for (const nd of dati.nodi) {
    const ap = nd.ruolo === 'BASE' ? APPARATI.base : APPARATI.ripetitore;
    if (o.attivi && !o.attivi.includes(nd.id) && nd.ruolo !== 'BASE') continue;
    if (!o.attivi && !nd.attivo && nd.ruolo !== 'BASE') continue;
    const n = rete.aggiungi({ ...ap, ...nd, h: nd.h, fisso: true, attivo: true });
    if (nd.ruolo === 'BASE') {
      n.ricevuto = (pkt, t) => {
        if (pkt.tipo === 'pos' || pkt.tipo === 'stato') {
          const x = base.perAtleta.get(pkt.da) || { ric: 0 };
          x.ric++; x.t = t; x.tGen = pkt.tGen; x.dati = pkt.dati; base.perAtleta.set(pkt.da, x);
          base.ricevuti++; base.latenze.push(t - pkt.tGen);
          if (pkt.tipo === 'stato') base.allarmi.push({ t, da: pkt.da, tipo: pkt.dati.stato, dati: pkt.dati });
        }
        if (pkt.tipo === 'sos') {
          if (!base.allarmi.some(a => a.tipo === 'sos' && a.rif === pkt.dati.rif))
            base.allarmi.push({ t, da: pkt.da, tipo: 'sos', rif: pkt.dati.rif, dati: pkt.dati });
          // risposta: la base conferma alla persona che ha chiesto aiuto
          rete.invia(n, 'ack', { a: pkt.da, rif: pkt.dati.rif }, { hop: 3 });
        }
      };
      rete.base = n;
    }
  }

  const atleti = [];
  if (o.atleti) for (const a of dati.atleti) {
    const T = a.t * 1000;
    const n = rete.aggiungi({ ...APPARATI.orologio, id: 'b' + a.b, bib: a.b, ruolo: o.ruoloAtleti, fisso: false, ascolta: o.ruoloAtleti === 'CLIENT',
      intervallo: o.intervallo, T,
      posizione(t) { const km = and.km(t / T); this.km = km; return traccia.at(km).slice(0, 2); },
      genera(t) {
        if (t > T + 120000) { this.attivo = false; return; }      // dopo l'arrivo l'orologio si riconsegna
        base.generati++; const x = base.perAtleta.get(this.id) || { ric: 0 }; x.gen = (x.gen || 0) + 1; base.perAtleta.set(this.id, x);
        rete.invia(this, 'pos', { b: a.b, km: Math.round(and.km(t / T) * 100) / 100 }, { hop: o.hop });
      } });
    atleti.push(n);
  }
  return { rete, base, atleti, andature: and, opz: o };
}

export function riassunto(g, durata) {
  const { rete, base } = g;
  const L = base.latenze.slice().sort((a, b) => a - b);
  const q = f => L.length ? L[Math.min(L.length - 1, Math.floor(f * L.length))] / 1000 : null;
  let buchi = 0;       // atleti rimasti più di 10 minuti senza posizione alla base (in gara)
  const occ = {};
  for (const n of rete.nodi) if (n.fisso && n.attivo) occ[n.id] = { canale: +(100 * n.sentito / durata).toFixed(1), aria: +(100 * n.ariaTot / durata).toFixed(2) };
  return {
    preset: rete.presetNome, intervallo: g.opz.intervallo / 1000, hop: g.opz.hop,
    generati: base.generati, ricevuti: base.ricevuti, consegna: +(100 * base.ricevuti / Math.max(1, base.generati)).toFixed(1),
    latenzaMediana: q(0.5), latenza95: q(0.95), tx: rete.stat.tx, collisioni: rete.stat.collisioni, scartatiDuty: rete.stat.dutyScartati, occ,
  };
}
