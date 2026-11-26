// Prova di una gara intera in Node (da guida/strumenti): node orologio_gara.mjs '[{"preset":"ShortFast","intervallo":120000,"hop":2}]'
import fs from 'fs';
import { Terreno } from '../orologio/radio.js';
import { creaGara, riassunto } from '../orologio/gara.js';
import { Traccia } from '../../posizione/geo.js';
const D='../orologio/';
const meta=JSON.parse(fs.readFileSync(D+'dem.json'));const buf=fs.readFileSync(D+'dem.bin');
const T=new Terreno(meta,new Int16Array(buf.buffer,buf.byteOffset,buf.length/2));
const tr=new Traccia(JSON.parse(fs.readFileSync('../../posizione/traccia.json')));
const dati=JSON.parse(fs.readFileSync(D+'rete.json'));
const configs = JSON.parse(process.argv[2]||'[{}]');
for (const c of configs) {
  const t0=Date.now();
  const g=creaGara(T,tr,dati,c);
  const durata = 7*3600e3; let campioni=0, vecchi2=0, vecchi10=0, maxBuco=0;
  for (let t=0;t<=durata;t+=30000){
    g.rete.avanza(t);
    if (t<300000) continue;
    for (const a of g.atleti){ if(!a.attivo || t> a.T) continue; const x=g.base.perAtleta.get(a.id); const age = x&&x.t!=null? t-x.t : t; campioni++; if(age>2.5*g.opz.intervallo)vecchi2++; if(age>600000)vecchi10++; maxBuco=Math.max(maxBuco,age);}
  }
  const r=riassunto(g,durata);
  console.log(JSON.stringify({...c, consegna:r.consegna, latMed:r.latenzaMediana, lat95:r.latenza95, tx:r.tx, coll:r.collisioni, duty:r.scartatiDuty, 'eta>2.5int%':+(100*vecchi2/campioni).toFixed(1), 'eta>10min%':+(100*vecchi10/campioni).toFixed(2), maxBucoMin:+(maxBuco/60000).toFixed(1), occ:r.occ, sec:(Date.now()-t0)/1000}));
}
