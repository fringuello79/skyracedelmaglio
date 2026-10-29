// Radio LoRa a 868 MHz sul terreno vero: tempo in aria, potenza ricevuta, ostacoli.
// Modello semplice e dichiarato: spazio libero + diffrazione sulle creste (Deygout, 2 spigoli)
// + perdite fisse (polso, bosco) + una variazione casuale per pacchetto.
// Non dipende dal browser: si usa anche con Node.

export const PRESET = {
  // nome Meshtastic: spreading factor, banda kHz, coding rate 4/x
  ShortFast:    { sf: 7,  bw: 250, cr: 5 },
  ShortSlow:    { sf: 8,  bw: 250, cr: 5 },
  MediumFast:   { sf: 9,  bw: 250, cr: 5 },
  MediumSlow:   { sf: 10, bw: 250, cr: 5 },
  LongFast:     { sf: 11, bw: 250, cr: 5 },
  LongModerate: { sf: 11, bw: 125, cr: 8 },
};
const SNR_MIN = { 7: -7.5, 8: -10, 9: -12.5, 10: -15, 11: -17.5, 12: -20 };   // demodulazione SX1262
export const NF = 6;                     // cifra di rumore del ricevitore, dB
export const PREAMBOLO = 16;             // simboli (Meshtastic)

export const simbolo = p => (2 ** p.sf) / (p.bw * 1000);                       // s
export const rumore = p => -174 + 10 * Math.log10(p.bw * 1000) + NF;          // dBm
export const sensibilita = p => rumore(p) + SNR_MIN[p.sf];                     // dBm

// Tempo in aria (formula Semtech AN1200.13), in ms
export function tempoInAria(p, byte) {
  const ts = simbolo(p);
  const de = ts > 0.016 ? 1 : 0;
  const n = Math.ceil((8 * byte - 4 * p.sf + 28 + 16) / (4 * (p.sf - 2 * de)));
  const simb = PREAMBOLO + 4.25 + 8 + Math.max(n * p.cr, 0);
  return simb * ts * 1000;
}

// slot per il CAD e finestra di contesa (come nel firmware: CWmin 3, CWmax 8, SNR da -20 a +10)
export const slotMs = p => 2.5 * simbolo(p) * 1000 + 0.2;
export const CW_MIN = 3, CW_MAX = 8;
export function finestraDaSnr(snr) {
  const f = Math.max(0, Math.min(1, (snr + 20) / 30));
  return Math.round(CW_MIN + f * (CW_MAX - CW_MIN));
}

// ---------- terreno ----------
export class Terreno {
  constructor(meta, dati) { Object.assign(this, meta); this.h = dati; }
  quota(lat, lon) {
    const u = (lon - this.lon0) / this.dlon, v = (lat - this.lat0) / this.dlat;
    if (u < 0 || v < 0 || u > this.nx - 1.001 || v > this.ny - 1.001) return 0;
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, n = this.nx, h = this.h;
    return h[j * n + i] * (1 - fu) * (1 - fv) + h[j * n + i + 1] * fu * (1 - fv) +
           h[(j + 1) * n + i] * (1 - fu) * fv + h[(j + 1) * n + i + 1] * fu * fv;
  }
}

const LAMBDA = 299792458 / 868e6;        // 0,345 m
const KR = 4 / 3 * 6371000;              // raggio terrestre equivalente
const rad = d => d * Math.PI / 180;
export function distanza(a, b) {
  const k = Math.cos(rad((a[0] + b[0]) / 2));
  return Math.hypot((b[1] - a[1]) * k * 111320, (b[0] - a[0]) * 110540);
}

// perdita per spigolo (ITU-R P.526)
const J = v => v <= -0.78 ? 0 : 6.9 + 20 * Math.log10(Math.sqrt((v - 0.1) ** 2 + 1) + v - 0.1);

// Profilo fra due punti: quote del terreno ogni ~passo metri. a, b = [lat, lon, quotaAntenna]
export function profilo(terreno, a, b, passo = 50) {
  const D = distanza(a, b);
  const n = Math.max(2, Math.ceil(D / passo));
  const z = new Float32Array(n + 1), x = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    x[i] = f * D;
    z[i] = terreno.quota(a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])) - x[i] * (D - x[i]) / (2 * KR);
  }
  return { D, x, z, n };
}

// spigolo principale fra gli indici i0 e i1 (quote antenne h0, h1)
function spigolo(P, i0, i1, h0, h1) {
  let best = { v: -Infinity, i: -1 };
  const x0 = P.x[i0], x1 = P.x[i1], L = x1 - x0;
  for (let i = i0 + 1; i < i1; i++) {
    const d1 = P.x[i] - x0, d2 = x1 - P.x[i];
    if (d1 < 1 || d2 < 1) continue;
    const linea = h0 + (h1 - h0) * d1 / L;
    const v = (P.z[i] - linea) * Math.sqrt(2 * L / (LAMBDA * d1 * d2));
    if (v > best.v) best = { v, i };
  }
  return best;
}

// Diffrazione con il metodo di Deygout (spigolo principale + uno per lato)
export function diffrazione(P, hA, hB) {
  const n = P.n, zA = P.z[0] + hA, zB = P.z[n] + hB;
  const m = spigolo(P, 0, n, zA, zB);
  if (m.i < 0 || m.v <= -0.78) return 0;
  let L = J(m.v);
  const zm = P.z[m.i];
  const s1 = spigolo(P, 0, m.i, zA, zm), s2 = spigolo(P, m.i, n, zm, zB);
  if (s1.i >= 0) L += J(s1.v);
  if (s2.i >= 0) L += J(s2.v);
  return Math.min(L, 80);
}

export const spazioLibero = d => 20 * Math.log10(Math.max(d, 1) / 1000) + 20 * Math.log10(868) + 32.44;

// Potenza ricevuta media (senza la variazione casuale). tx/rx: { pos:[lat,lon], h, ptx, g }
export function collegamento(terreno, tx, rx) {
  const P = profilo(terreno, tx.pos, rx.pos);
  const pl = spazioLibero(P.D) + diffrazione(P, tx.h, rx.h);
  return { d: P.D, perdita: pl, prx: tx.ptx + tx.g + rx.g - pl - (tx.extra || 0) - (rx.extra || 0) };
}

// Parametri delle radio (ipotesi dichiarate nella pagina)
export const APPARATI = {
  orologio: { ptx: 22, g: -4, extra: 6, h: 1.3, nota: 'antenna interna −4 dBi, polso e corpo 6 dB' },
  ripetitore: { ptx: 27, g: 2, extra: 0, h: 2, nota: 'Heltec V4 27 dBm (massimo in Europa), stilo 2 dBi' },
  base: { ptx: 27, g: 5, extra: 0, h: 8, nota: 'antenna collineare 5 dBi sul tetto' },
};
export const BOSCO = { sotto: 1750, perdita: 5 };   // sotto il limite del faggeto il corridore perde altri 5 dB
export const FADING = 4;                             // dB, deviazione della variazione casuale per pacchetto
