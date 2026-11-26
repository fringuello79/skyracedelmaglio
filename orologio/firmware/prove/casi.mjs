// Banco di prova: genera percorsi simulati (posizioni GPS con rumore) e gli avvisi attesi da guida/motore.js.
// Il programma C++ (banco.cpp) legge le stesse posizioni e deve dare gli stessi avvisi, parola per parola.
// Uso (dalla radice del sito): node orologio/firmware/prove/casi.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Traccia, bearing } from '../../../posizione/geo.js';
import { Motore } from '../../../guida/motore.js';
import { Simulatore } from '../../../guida/simulatore.js';

const QUI = path.dirname(fileURLToPath(import.meta.url));
const R = path.join(QUI, '../../..');
const DIR = path.join(QUI, 'casi');
fs.mkdirSync(DIR, { recursive: true });
const t = new Traccia(JSON.parse(fs.readFileSync(path.join(R, 'posizione/traccia.json'))));
const bivi = JSON.parse(fs.readFileSync(path.join(R, 'guida/bivi-srm2026.json'))).bivi;
const OPZ = { rassicura: 600000 };     // come sull'orologio: «Sei sul percorso» dopo 10 minuti di silenzio

// passi: funzione(sec, sim) -> 'salta' per togliere la posizione (GPS assente) o una posizione {lat,lon} da usare al posto del simulatore
function caso(nome, { km = 0, vel = 2.8, seme = 1, durata = null, rumore = 4, acc = 6, passo = null, prepara = null }) {
  const sim = new Simulatore(t, { km, velocita: vel, rumore, precisione: acc, seme });
  prepara?.(sim);
  const m = new Motore(t, bivi, OPZ);
  const fix = [], ev = [];
  const fine = durata ?? Math.ceil(((t.kmTot - km) * 1000) / vel + 600);
  for (let s = 1; s <= fine; s++) {
    const tms = s * 1000;
    let f = passo?.(s, sim);
    if (f === 'salta') { sim.passo(1); f = null; }
    else if (!f) { if (sim.finito()) f = null; else { const q = sim.passo(1); f = { lat: q.lat, lon: q.lon }; } }
    if (f) {
      fix.push(`${tms} ${f.lat.toPrecision(17)} ${f.lon.toPrecision(17)} ${acc}`);
      for (const e of m.posizione({ lat: f.lat, lon: f.lon, acc, t: tms })) ev.push(`${tms}\t${e.tipo}\t${e.testo ?? ''}`);
    } else fix.push(`${tms} -`);
    for (const e of m.tick(tms)) ev.push(`${tms}\t${e.tipo}\t${e.testo ?? ''}`);
  }
  fs.writeFileSync(path.join(DIR, nome + '.fix'), fix.join('\n') + '\n');
  fs.writeFileSync(path.join(DIR, nome + '.attesi'), ev.join('\n') + '\n');
  return ev.length;
}

const sposta = ([la, lo], gradi, metri) => [la + metri * Math.cos(gradi * Math.PI / 180) / 110540, lo + metri * Math.sin(gradi * Math.PI / 180) / (111320 * Math.cos(la * Math.PI / 180))];
const preparaBivi = JSON.parse(fs.readFileSync(path.join(R, 'guida/bivi-srm2026.json'))).bivi;

const n = {};
n.gara_intera = caso('gara_intera', { km: 0, vel: 2.8, seme: 11 });
n.gara_veloce = caso('gara_veloce', { km: 0, vel: 3.8, seme: 5, rumore: 6, acc: 8 });
// sentiero sbagliato a quattro bivi diversi
for (const id of ['S02-A', 'O05', 'S10', 'S13']) {
  const b = preparaBivi.find(x => x.id === id);
  if (!b) continue;
  n['sbaglia_' + id] = caso('sbaglia_' + id, { km: Math.max(0, b.km - 0.6), vel: 2.6, seme: 3, durata: 900,
    prepara: sim => sim.sbagliaAl({ km: b.km, id }) });
}
// fuori percorso di lato, lontano dai bivi
for (const kmF of [5.4, 15.8, 23.2]) {
  n['fuori_' + kmF] = caso('fuori_' + kmF, { km: kmF - 0.3, vel: 2.5, seme: 7, durata: 700, passo: (s, sim) => {
    if (s === 100 && sim.modo === 'traccia') { const dir = t.direzioneDopo(sim.km, 0.05); sim.dev = { origine: t.at(sim.km).slice(0, 2), verso: dir + 85, fatto: 0, lungo: 130, km: sim.km }; sim.modo = 'andata'; }
    return null;
  } });
}
// partenze a gara in corso, anche nel tratto fatto due volte (attende il senso di marcia)
n.parti_km12 = caso('parti_km12', { km: 12, vel: 2.2, seme: 9, durata: 1500 });
n.parti_comune = caso('parti_comune', { km: 1.2, vel: 2.4, seme: 4, durata: 1200 });
n.parti_comune_fine = caso('parti_comune_fine', { km: 27.6, vel: 2.4, seme: 8, durata: 1100 });
// GPS che manca per 100 s in movimento
n.gps_buco = caso('gps_buco', { km: 7.5, vel: 2.5, seme: 2, durata: 600, passo: (s) => (s > 200 && s <= 300 ? 'salta' : null) });
// corre al contrario per un tratto
{
  let km0 = 12.3;
  n.contrario = caso('contrario', { km: km0, vel: 2.6, seme: 6, durata: 500, passo: (s, sim) => {
    if (s > 120 && s <= 300) { const k = km0 + (120 * 2.6) / 1000 - ((s - 120) * 2.4) / 1000; const p = t.at(k); return { lat: p[0] + (sim.rnd() - 0.5) * 6e-5, lon: p[1] + (sim.rnd() - 0.5) * 8e-5 }; }
    return null;
  } });
}
// lontano dal percorso, poi lo raggiunge
n.lontano = caso('lontano', { km: 3.0, vel: 2.5, seme: 12, durata: 500, passo: (s) => {
  if (s <= 150) { const p = t.at(3.0); const q = sposta([p[0], p[1]], 60, 700 - s * 4.5); return { lat: q[0], lon: q[1] }; }
  return null;
} });
console.log('casi scritti in', DIR); console.log(n);
