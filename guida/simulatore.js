// Simulatore: fa "correre" un atleta lungo la traccia, con rumore GPS,
// e se richiesto sbaglia sentiero al prossimo bivio e poi torna indietro.
import { bearing } from '../posizione/geo.js';

const norm = a => ((a % 360) + 540) % 360 - 180;
const rad = d => d * Math.PI / 180;

function sposta([lat, lon], gradi, metri) {
  const dLat = metri * Math.cos(rad(gradi)) / 110540;
  const dLon = metri * Math.sin(rad(gradi)) / (111320 * Math.cos(rad(lat)));
  return [lat + dLat, lon + dLon];
}

function gauss(rnd) {
  let u = 0, v = 0;
  while (!u) u = rnd();
  while (!v) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class Simulatore {
  constructor(traccia, { km = 0, velocita = 2.8, rumore = 4, precisione = 6, seme = 1 } = {}) {
    this.t = traccia; this.km = km; this.vel = velocita; this.rumore = rumore; this.acc = precisione;
    this.ora = 0; this.modo = 'traccia'; this.dev = null; this.sbaglia = null;
    let s = seme >>> 0 || 1;
    this.rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }

  // Sbaglia al primo bivio (km) più avanti della posizione attuale.
  sbagliaAl(bivio) { this.sbaglia = bivio; }

  _deviazione(b) {
    const km = b.km;
    const entrata = bearing(this.t.at(km - 0.03), this.t.at(km));
    const uscita = bearing(this.t.at(km), this.t.at(km + 0.04));
    const delta = norm(uscita - entrata);
    const verso = Math.abs(delta) >= 30 ? entrata : uscita + (delta >= 0 ? -55 : 55);
    return { origine: this.t.at(km).slice(0, 2), verso, fatto: 0, lungo: 130, km };
  }

  passo(dt = 1) {
    this.ora += dt * 1000;
    const m = this.vel * dt;
    let vero;
    if (this.modo === 'traccia') {
      const prima = this.km;
      this.km = Math.min(this.t.kmTot, this.km + m / 1000);
      if (this.sbaglia && prima < this.sbaglia.km && this.km >= this.sbaglia.km) {
        this.dev = this._deviazione(this.sbaglia); this.sbaglia = null;
        this.km = this.dev.km; this.modo = 'andata';
      }
    }
    if (this.modo === 'andata') {
      this.dev.fatto += m;
      if (this.dev.fatto >= this.dev.lungo) this.modo = 'ritorno';
      vero = sposta(this.dev.origine, this.dev.verso, Math.min(this.dev.fatto, this.dev.lungo));
    } else if (this.modo === 'ritorno') {
      this.dev.fatto -= m;
      if (this.dev.fatto <= 0) { this.modo = 'traccia'; this.km = this.dev.km + 0.005; this.dev = null; }
      else vero = sposta(this.dev.origine, this.dev.verso, this.dev.fatto);
    }
    if (!vero) vero = this.t.at(this.km).slice(0, 2);
    const n = this.rumore;
    const [lat, lon] = sposta(sposta(vero, 0, gauss(this.rnd) * n), 90, gauss(this.rnd) * n);
    return { lat, lon, acc: this.acc, t: this.ora, simulata: true, modo: this.modo };
  }

  finito() { return this.modo === 'traccia' && this.km >= this.t.kmTot; }
}
