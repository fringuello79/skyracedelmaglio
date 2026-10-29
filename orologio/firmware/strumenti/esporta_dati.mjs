// Esporta traccia e bivi SRM per il firmware: orologio/firmware/srm/srm_dati.{h,cpp}
// I bivi passano da preparaBivio() di guida/motore.js: le frasi sono esattamente quelle della guida sul telefono.
// Uso (dalla radice del sito): node orologio/firmware/strumenti/esporta_dati.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Traccia } from '../../../posizione/geo.js';
import { preparaBivio } from '../../../guida/motore.js';

const QUI = path.dirname(fileURLToPath(import.meta.url));
const R = path.join(QUI, '../../..');
const OUT = path.join(QUI, '../srm');
const tj = JSON.parse(fs.readFileSync(path.join(R, 'posizione/traccia.json')));
const bj = JSON.parse(fs.readFileSync(path.join(R, 'guida/bivi-srm2026.json')));
const t = new Traccia(tj);

const C = s => s == null ? 'nullptr' : JSON.stringify(String(s));
const num = x => Number.isFinite(x) ? String(x) : '0';   // String(): il double esatto, come in JS

const bivi = bj.bivi.map(b => preparaBivio(t, b)).sort((a, b) => a.km - b.km);
const righeB = bivi.map(b => {
  const pre = b.frasi.pre ? b.frasi.pre(123).replace(/^Fra \d+ metri, /, '') : null;
  const altri = (b.altri || []).reduce((m, a) => m | (a === 'sx' ? 1 : a === 'dx' ? 2 : 0), 0);
  const g = b.giri?.length === 2 && !b.posizione ? b.giri : null;
  return `    {${C(b.id)}, ${C(b.tipo)}, ${num(b.km)}, ${num(b.lat)}, ${num(b.lon)}, ${b.silenzioso ? 'true' : 'false'}, ${num(b.verificaM)}, ` +
    `${C(b.titolo)}, ${C(pre)}, ${C(b.frasi.ind)}, ${C(b.frasi.ora)}, ${C(b.frasi.giusto ?? '')}, ${Math.round(b.icona || 0)}, ${altri}, ${b.rami || 0}, ` +
    `${g ? Math.round(g[0].delta) : 0}, ${g ? Math.round(g[1].delta) : 0}, ${C(b.sentiero || '')}},`;
});
const righeP = t.pts.map(p => `    {${num(p[0])}, ${num(p[1])}, ${num(p[2])}, ${num(p[3])}},`);
const righeS = t.sentieri.map(s => `    {${num(s.da)}, ${num(s.a)}, ${C(s.nome)}},`);
const righeC = t.comune.map(c => `    {${num(c[0])}, ${num(c[1])}},`);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'srm_dati.h'), `// Generato da orologio/firmware/strumenti/esporta_dati.mjs: non modificare a mano.
#pragma once
#include "srm_guida.h"
namespace srm
{
extern const Punto TRACCIA[];
extern const int N_TRACCIA;
extern const Sentiero SENTIERI[];
extern const int N_SENTIERI;
extern const double COMUNE[][2];
extern const int N_COMUNE;
extern const Bivio BIVI[];
extern const int N_BIVI;
} // namespace srm
`);
fs.writeFileSync(path.join(OUT, 'srm_dati.cpp'), `// Generato da orologio/firmware/strumenti/esporta_dati.mjs: non modificare a mano.
// Traccia ufficiale SRM 2026 (${t.pts.length} punti, ${t.kmTot} km) e ${bivi.length} bivi della guida.
#include "srm_dati.h"
namespace srm
{
const Punto TRACCIA[] = {
${righeP.join('\n')}
};
const int N_TRACCIA = ${t.pts.length};
const Sentiero SENTIERI[] = {
${righeS.join('\n')}
};
const int N_SENTIERI = ${t.sentieri.length};
const double COMUNE[][2] = {
${righeC.join('\n')}
};
const int N_COMUNE = ${t.comune.length};
const Bivio BIVI[] = {
${righeB.join('\n')}
};
const int N_BIVI = ${bivi.length};
} // namespace srm
`);
console.log(`srm_dati.cpp: ${t.pts.length} punti, ${bivi.length} bivi, ${t.sentieri.length} sentieri`);
