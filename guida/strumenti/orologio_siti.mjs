// Ricerca dei posti migliori per i ripetitori (da guida/strumenti): node orologio_siti.mjs ShortFast 8 5 "Passo Le Forche,Controllo"
import fs from 'fs';
import * as R from '../orologio/radio.js';
import { Traccia } from '../../posizione/geo.js';
const D='../orologio/';
const meta=JSON.parse(fs.readFileSync(D+'dem.json'));const buf=fs.readFileSync(D+'dem.bin');
const T=new R.Terreno(meta,new Int16Array(buf.buffer,buf.byteOffset,buf.length/2));
const tr=new Traccia(JSON.parse(fs.readFileSync('../../posizione/traccia.json')));
const dati=JSON.parse(fs.readFileSync(D+'rete.json'));
const preset=process.argv[2]||'ShortFast', SOGLIA=+(process.argv[3]||8), K=+(process.argv[4]||6);
const sens=R.sensibilita(R.PRESET[preset]);
const base={...R.APPARATI.base,...dati.nodi[0]};
const pts=[];for(let km=0;km<=tr.kmTot;km+=0.1){const p=tr.at(km);pts.push({km,w:{pos:[p[0],p[1]],...R.APPARATI.orologio,extra:R.APPARATI.orologio.extra+(p[2]<1750?5:0)}});}
// candidati: nodi nominati + griglia ogni ~400 m vicino alla traccia (entro 2,5 km)
const cand=dati.nodi.filter(n=>n.ruolo!=='BASE').map(n=>({nome:n.nome,pos:n.pos}));
const vette=JSON.parse(fs.readFileSync(D+'vette.json'));
for(const v of vette) cand.push({nome:v.n+' '+v.e, pos:v.pos});
for(let km=0.25;km<tr.kmTot;km+=0.25){const p=tr.at(km);cand.push({nome:'percorso km '+km.toFixed(2),pos:[p[0],p[1]]});}
console.error('candidati',cand.length);
for(const c of cand){const n={...R.APPARATI.ripetitore,pos:c.pos,h:3};c.q=Math.round(T.quota(...c.pos));
  c.cop=pts.map(p=>R.collegamento(T,p.w,n).prx-sens); c.base=R.collegamento(T,n,base).prx-sens; c.n=n;}
const baseCop=pts.map(p=>R.collegamento(T,p.w,base).prx-sens);
let best=baseCop.slice(); const scelti=[];
const FORZA=(process.argv[5]||'').split(',').filter(Boolean);
const hopDi=c=> c.base>=6?1: (scelti.some(s=>s.h===1&&R.collegamento(T,c.n,s.n).prx-sens>=6)?2:0);
for(const f of FORZA){const c=cand.find(c=>c.nome&&c.nome.startsWith(f)); c.h=hopDi(c); scelti.push(c); if(c.h) c.cop.forEach((m,i)=>best[i]=Math.max(best[i],m)); console.log('fisso',c.nome,'salti verso base',c.h);}
const coperti=()=>best.filter(m=>m>=SOGLIA).length;
console.log('solo base:',coperti(),'/',pts.length);
for(let k=0;k<K;k++){
  let mig=null;
  for(const c of cand){ if(scelti.includes(c))continue;
    const h=hopDi(c); if(!h)continue; c.hTmp=h;
    let g=0; for(let i=0;i<pts.length;i++) if(best[i]<SOGLIA && c.cop[i]>=SOGLIA) g++;
    if(!mig||g>mig.g) mig={c,g};}
  if(!mig||mig.g===0)break;
  mig.c.h=mig.c.hTmp; scelti.push(mig.c); mig.c.cop.forEach((m,i)=>best[i]=Math.max(best[i],m));
  console.log(k+1, mig.c.nome||'punto', mig.c.pos.map(x=>x.toFixed(4)).join(','), 'quota',mig.c.q,'+',mig.g,'tot',coperti(),'/',pts.length, 'versoBase',Math.round(mig.c.base),'salti',mig.c.h);
}
const buchi=[];let ini=null;best.forEach((m,i)=>{if(m<SOGLIA&&ini==null)ini=pts[i].km;if(m>=SOGLIA&&ini!=null){buchi.push(ini.toFixed(1)+'-'+pts[i].km.toFixed(1));ini=null;}});if(ini!=null)buchi.push(ini.toFixed(1)+'-fine');
console.log('buchi',buchi.join(' '));
