// Report stampabile della segnaletica SRM 2026
import { Traccia, fmtKm, fmtCoord } from './geo.js';
import { STATI, DIR_LABEL, frecciaCartello, frecciaMappa } from './frecce.js';
import { creaStore } from './store.js';
import { firebaseConfig } from '../firebase-config.js';
const N = s => s?.num || s?.id || '';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
let T, piano, poi, mappe = [], presidi = [], livelloPresidi = null;

async function avvia() {
  const [tr, p, po] = await Promise.all(['data/traccia.json', 'data/segnali.json', 'data/poi.json'].map(u => fetch(u).then(r => r.json())));
  T = new Traccia(tr); piano = p; poi = po;
  const app = new URL('./', location.href).href;
  $('#linkApp').innerHTML = `<a href="${app}">${esc(app.replace(/^https?:\/\//, ''))}</a>`;
  $('#btnStampa').addEventListener('click', () => window.print());

  let reso = false;
  const disegna = (lista, fonte) => { render(lista.length ? lista : piano.segnali, fonte); reso = true; };
  let nome = ''; let squadra = '';
  try { nome = localStorage.getItem('srmseg:nome') || ''; squadra = (localStorage.getItem('srmseg:squadra') || '').trim().toUpperCase().replace(/\s+/g, ''); } catch {}
  const usaFirebase = !!(firebaseConfig?.apiKey && squadra);
  const temaLocale = (() => { try { return !!localStorage.getItem('srmseg:dati:segnali'); } catch { return false; } })();
  if (usaFirebase || temaLocale) {
    const st = creaStore({ config: firebaseConfig, squadra, nome: nome || 'report' });
    let primo = true;
    st.on('segnali', (lista, meta) => {
      if (!primo && !meta.daServer) return;
      if (meta.daServer || !usaFirebase) { primo = false; disegna([...lista].sort((a, b) => a.km - b.km), usaFirebase ? 'squadra' : 'dispositivo'); }
    });
    st.on('presidi', lista => { presidi = [...lista].sort((a, b) => (a.km ?? 0) - (b.km ?? 0)); disegnaPresidi(); });
    st.avvia().catch(() => disegna([], 'piano'));
    setTimeout(() => { if (!reso) disegna([], 'piano'); }, 6000);
  } else disegna([], 'piano');
}

function render(segnali, fonte) {
  mappe.forEach(m => m.remove()); mappe = [];
  const oggi = new Date().toLocaleString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const conf = segnali.filter(s => s.stato !== 'da_verificare').length;
  $('#dataReport').textContent = `Aggiornato al ${oggi}. ${segnali.length} paletti, ${segnali.reduce((n, s) => n + s.frecce.length, 0)} frecce, ${conf} con posizione già confermata. Fonte: ${{ squadra: 'dati condivisi della squadra', dispositivo: 'dati salvati su questo dispositivo', piano: 'piano iniziale' }[fonte]}.`;

  // panoramica
  const mp = L.map('mappaPanoramica', { zoomControl: false, attributionControl: true, zoomSnap: 0.25, fadeAnimation: false, zoomAnimation: false, scrollWheelZoom: false, dragging: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false });
  L.tileLayer(ESRI, { attribution: 'Immagini © Esri', maxNativeZoom: 19 }).addTo(mp);
  aggiungiTraccia(mp, 4);
  segnali.forEach(s => L.marker([s.lat, s.lon], { icon: L.divIcon({ className: 'num-pan', iconSize: [30, 20], iconAnchor: [15, 10], html: `<span style="--c:${(STATI[s.stato] || STATI.da_verificare).colore}">${esc(N(s).replace('S', ''))}</span>` }) }).addTo(mp));
  poi.forEach(p => L.circleMarker([p.lat, p.lon], { radius: 4, color: '#fff', weight: 2, fillColor: '#1f5fad', fillOpacity: 1 }).addTo(mp));
  mp.fitBounds(L.latLngBounds(T.latlngs()), { padding: [14, 14] });
  mappe.push(mp);
  livelloPresidi = L.layerGroup().addTo(mp);
  disegnaPresidi();

  // tabella
  $('#tabella tbody').innerHTML = segnali.map(s => `<tr>
    <td><b>${esc(N(s))}</b></td><td>${s.frecce.map(f => fmtKm(f.km)).join('<br>')}</td>
    <td>${s.frecce.map(f => `${esc(f.codice)} ${DIR_LABEL[f.dir]}${f.origine === 'proposta' ? ' <em>(proposta)</em>' : ''}`).join('<br>')}</td>
    <td>${esc(T.sentiero(s.km))}</td><td>${Math.round(T.at(s.km)[2])} m</td>
    <td>${(STATI[s.stato] || STATI.da_verificare).breve}</td>
    <td>${s.frecce.map(f => f.ex ? esc(f.ex) : '—').join('<br>')}</td></tr>`).join('');

  // schede
  $('#schede').innerHTML = segnali.map(scheda).join('');
  segnali.forEach(s => {
    const el = document.getElementById('m-' + s.id); if (!el) return;
    const m = L.map(el, { zoomControl: false, attributionControl: false, fadeAnimation: false, zoomAnimation: false, scrollWheelZoom: false, dragging: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false });
    L.tileLayer(ESRI, { maxNativeZoom: 19, maxZoom: 19 }).addTo(m);
    aggiungiTraccia(m, 4);
    if (s.suggerimento && s.stato === 'da_verificare') L.circleMarker([s.suggerimento.lat, s.suggerimento.lon], { radius: 9, color: '#FF8102', weight: 3, dashArray: '4 4', fillOpacity: 0 }).addTo(m);
    L.marker([s.lat, s.lon], { icon: L.divIcon({ className: 'mk-rep', iconSize: [48, 48], iconAnchor: [24, 24], html: s.frecce.map((f, i) => `<span class="fr ${s.frecce.length > 1 ? (i ? 'r' : 'a') : ''}">${frecciaMappa(T.direzioneDopo(f.km), { size: s.frecce.length > 1 ? 32 : 40 })}</span>`).join('') + '<span class="punto"></span>' }) }).addTo(m);
    m.setView([s.lat, s.lon], 17);
    mappe.push(m);
    const qr = qrcode(0, 'M');
    qr.addData(`https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lon}`); qr.make();
    document.getElementById('qr-' + s.id).innerHTML = qr.createSvgTag({ cellSize: 3, margin: 0, scalable: true });
  });
}

// presidi: tabella con persone e telefoni, cerchi verdi sulla mappa d'insieme
function disegnaPresidi() {
  const sez = $('#presidiRep');
  sez.hidden = !presidi.length;
  $('#tabellaPresidi tbody').innerHTML = presidi.map(p => `<tr>
    <td>${fmtKm(p.km ?? 0)}</td>
    <td><b>${esc(p.nome)}</b>${p.funzione ? `<br>${esc(p.funzione)}` : ''}<br><small>${fmtCoord(p.lat)}, ${fmtCoord(p.lon)}</small></td>
    <td>${(p.persone || []).map(x => `${esc(x.nome || '')}${x.ruolo ? ` <em>(${esc(x.ruolo)})</em>` : ''}${x.tel ? ` <b>${esc(x.tel)}</b>` : ''}`).join('<br>') || '—'}</td>
    <td>${esc(p.note || '')}</td></tr>`).join('');
  if (!livelloPresidi) return;
  livelloPresidi.clearLayers();
  presidi.forEach(p => L.circleMarker([p.lat, p.lon], { radius: 7, color: '#fff', weight: 2.5, fillColor: '#18853b', fillOpacity: 1 })
    .bindTooltip(esc(p.nome), { permanent: false }).addTo(livelloPresidi));
}

function aggiungiTraccia(m, w) {
  const ll = T.latlngs();
  L.polyline(ll, { color: '#153821', weight: w + 3, opacity: .85, interactive: false }).addTo(m);
  L.polyline(ll, { color: '#FF8102', weight: w, interactive: false }).addTo(m);
}

function scheda(s) {
  const st = STATI[s.stato] || STATI.da_verificare;
  const ele = Math.round(T.at(s.km)[2]);
  const verificato = s.stato !== 'da_verificare';
  return `<article class="scheda">
    <header class="sc-testa">
      <span class="sc-num">${esc(N(s))}</span>
      <div><b>km ${s.frecce.map(f => fmtKm(f.km)).join(' e ')}</b><span>Sentiero ${esc(T.sentiero(s.km))}, quota ${ele} m</span></div>
      <span class="stato" style="--c:${st.colore}">${st.label}</span>
    </header>
    <div class="sc-corpo">
      <div class="sc-mappa" id="m-${esc(s.id)}" aria-label="Mappa satellitare del punto ${esc(N(s))}"></div>
      <div class="sc-info">
        ${s.frecce.map(f => `<div class="fr-riga">${frecciaCartello(f.dir, { h: 34 })}<div><b>${esc(f.codice)}: ${DIR_LABEL[f.dir]}</b><span>${f.verso === 'andata' ? 'Andata, ' : f.verso === 'ritorno' ? 'Ritorno, ' : ''}km ${fmtKm(f.km)}${f.ex ? `. Dal piano: ${esc(f.ex)}` : ''}${f.origine === 'proposta' ? '. Freccia proposta: verificare il senso' : ''}</span></div></div>`).join('')}
        <div class="coord"><div id="qr-${esc(s.id)}" class="qr"></div><div><span class="et">Coordinate</span><b>${fmtCoord(s.lat)}, ${fmtCoord(s.lon)}</b><a href="https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lon}">Apri in Google Maps</a></div></div>
        ${verificato ? `<p class="ok">Posizione confermata${s.verificatoDa ? ' da ' + esc(s.verificatoDa) : ''}.</p>` : `<p class="attenzione">Posizione da verificare sul posto: controlla che qui ci sia davvero il bivio prima di piantare il paletto.</p>`}
        ${s.frecce.map(f => f.analisi && !verificato ? `<p class="analisi"><b>${esc(f.codice)}</b>: ${esc(f.analisi.testo)}</p>` : '').join('')}
        ${s.nota ? `<p class="nota"><b>Nota:</b> ${esc(s.nota)}</p>` : ''}
      </div>
    </div>
    <footer class="sc-firme">
      <span>☐ Verificato da ________ il ____</span><span>☐ Posato da ________ il ____</span><span>☐ Rimosso da ________ il ____</span>
    </footer>
  </article>`;
}

avvia().catch(e => { console.error(e); document.body.insertAdjacentHTML('afterbegin', `<p class="errore">Errore nel caricamento del report: ${esc(e.message)}</p>`); });
