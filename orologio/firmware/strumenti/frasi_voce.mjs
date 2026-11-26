// Elenco delle frasi da registrare per la voce dell'orologio (orologio/firmware/voce/frasi.tsv).
// Le frasi dei bivi sono intere (una per bivio); quelle con numeri si compongono da pezzi (es. «fra» + «200 metri»).
// Uso (dalla radice del sito): node orologio/firmware/strumenti/frasi_voce.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Traccia } from '../../../posizione/geo.js';
import { preparaBivio } from '../../../guida/motore.js';

const QUI = path.dirname(fileURLToPath(import.meta.url));
const R = path.join(QUI, '../../..');
const t = new Traccia(JSON.parse(fs.readFileSync(path.join(R, 'posizione/traccia.json'))));
const bivi = JSON.parse(fs.readFileSync(path.join(R, 'guida/bivi-srm2026.json'))).bivi.map(b => preparaBivio(t, b)).sort((a, b) => a.km - b.km);

const righe = [['file', 'testo', 'quando']];
const vista = new Map();
const add = (file, testo, quando) => { if (!testo || vista.has(file)) return; vista.set(file, testo); righe.push([file, testo, quando]); };

// pezzi generici
add('fra', 'Fra', 'inizio del preavviso: «Fra» + metri + resto della frase del bivio');
for (const m of [100, 150, 200, 250, 300, 350, 400, 450, 500]) add(`m${m}`, `${m} metri,`, 'distanza nel preavviso');
add('fuori', 'Fuori percorso!', 'uscita dal percorso');
add('ancora_fuori', 'Ancora fuori.', 'ripetuto ogni 30 secondi');
add('percorso_a', 'Percorso a', 'seguito da metri e lato');
for (const m of [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 150, 200, 250, 300, 400, 500]) add(`d${m}`, `${m} metri`, 'distanza dal percorso');
for (const [f, s] of [['destra', 'alla tua destra.'], ['sinistra', 'alla tua sinistra.'], ['davanti', 'davanti a te.'], ['spalle', 'alle tue spalle.']]) add('lato_' + f, s, 'dove si trova il percorso');
add('torna_passi', 'Torna sui tuoi passi.', 'percorso lontano più di 300 m');
add('sbagliato', 'Sentiero sbagliato! Torna indietro.', 'dopo un bivio preso male');
add('torna_indietro', 'Torna indietro.', 'ripetuto');
add('rientro', 'Di nuovo sul percorso.', 'rientro');
add('bene', 'Bene, ora sei sul percorso.', 'bivio ripreso dopo l\'errore');
add('contrario', 'Stai andando al contrario. Girati.', 'senso di marcia sbagliato');
add('gps_debole', 'Segnale GPS debole. Avviso di fuori percorso sospeso.', 'GPS assente per 1 minuto');
add('gps_ok', 'Segnale GPS tornato.', '');
add('sul_percorso', 'Sei sul percorso.', 'aggancio e conferma ogni 10 minuti');
add('arrivo', 'Arrivo. Complimenti, gara finita!', '');
add('sos_inviato', 'Richiesta di soccorso inviata.', '');
add('sos_ok', 'Soccorso avvisato. Resta dove sei.', '');
add('sos_annullato', 'SOS annullato.', '');
// frasi dei bivi
for (const b of bivi) {
  if (b.frasi.pre) add(`pre_${b.id}`, b.frasi.pre(200).replace(/^Fra \d+ metri, /, ''), `km ${b.km.toFixed(2)}: dopo «Fra N metri,»`);
  add(`ind_${b.id}`, b.frasi.ind, `km ${b.km.toFixed(2)}: al bivio`);
  if (b.frasi.ora) add(`ora_${b.id}`, b.frasi.ora, `km ${b.km.toFixed(2)}: subito prima della svolta`);
  if (b.frasi.giusto) add(`ok_${b.id}`, b.frasi.giusto, `km ${b.km.toFixed(2)}: bivio superato`);
}
const OUT = path.join(QUI, '../voce');
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'frasi.tsv'), righe.map(r => r.join('\t')).join('\n') + '\n');
console.log(`${righe.length - 1} frasi in orologio/firmware/voce/frasi.tsv`);
