// Mappa ingrandita della guida: la propria posizione sul tratto di percorso, i bivi con la direzione giusta.
// Stile e sentieri come nella pagina «Dove sono» (posizione/). Senza campo le tessere mancano,
// ma percorso, bivi e posizione restano disegnati.

const leggiLS = k => { try { return localStorage.getItem(k); } catch { return null; } };
const scriviLS = (k, v) => { try { localStorage.setItem(k, v); } catch { /* memoria non disponibile */ } };

/* ------------------------------------------------ sentieri segnati (Waymarked Trails ricolorati) */
const ROSSO_SENTIERI = [128, 14, 20];
function ricoloraSentieri(d, W, H) {
  const n = W * H, seme = new Uint8Array(n), vuoto = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (d[i + 3] < 128) { vuoto[p] = 1; continue; }
    const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if ((mn > 185 && mx - mn < 45) || mx < 90) seme[p] = 1;
  }
  const dilata = (src, R) => {
    const t = new Uint8Array(n), o = new Uint8Array(n);
    for (let y = 0; y < H; y++) {
      let c = 0; const q = y * W;
      for (let x = -R; x < W; x++) { const a = x + R; if (a < W) c += src[q + a]; const s = x - R - 1; if (s >= 0) c -= src[q + s]; if (x >= 0) t[q + x] = c > 0; }
    }
    for (let x = 0; x < W; x++) {
      let c = 0;
      for (let y = -R; y < H; y++) { const a = y + R; if (a < H) c += t[a * W + x]; const s = y - R - 1; if (s >= 0) c -= t[s * W + x]; if (y >= 0) o[y * W + x] = c > 0; }
    }
    return o;
  };
  const vicino = dilata(seme, 7);
  const eroso = dilata(vuoto, 2); for (let p = 0; p < n; p++) eroso[p] = eroso[p] ? 0 : 1;
  const pieno = dilata(eroso, 2);
  const [R0, G0, B0] = ROSSO_SENTIERI;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (!d[i + 3] || (pieno[p] && vicino[p])) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) > 50) { d[i] = R0; d[i + 1] = G0; d[i + 2] = B0; }
  }
}
const SentieriSegnati = L.GridLayer.extend({
  createTile(coords, done) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const url = `https://tile.waymarkedtrails.org/hiking/${coords.z}/${coords.x}/${coords.y}.png`;
    const disegna = (img, leggibile) => {
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, 256, 256);
      if (leggibile) {
        try { const id = g.getImageData(0, 0, 256, 256); ricoloraSentieri(id.data, 256, 256); g.putImageData(id, 0, 0); }
        catch { /* immagine non leggibile: resta con i colori originali */ }
      }
      done(null, c);
    };
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => disegna(img, true);
    img.onerror = () => {
      const im2 = new Image();
      im2.onload = () => disegna(im2, false);
      im2.onerror = e => done(e, c);
      im2.src = url;
    };
    img.src = url;
    return c;
  },
});

/* ------------------------------------------------ icone */
const iconaMe = dir => L.divIcon({
  className: 'mk-me', iconSize: [44, 44], iconAnchor: [22, 22],
  html: `<svg viewBox="-22 -22 44 44" width="44" height="44">${dir == null ? '' :
    `<path transform="rotate(${dir.toFixed(0)})" d="M0 -21 L9 -6 L-9 -6 Z" fill="#1a73e8" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>`}
    <circle r="9" fill="#1a73e8" stroke="#fff" stroke-width="3"/></svg>`,
});

const iconaBivio = (b, tipo) => {
  const r = tipo === 'prossimo' ? 17 : 13;
  return L.divIcon({
    className: 'mk-bivio ' + tipo, iconSize: [2 * r + 4, 2 * r + 4], iconAnchor: [r + 2, r + 2],
    html: `<svg viewBox="${-r - 2} ${-r - 2} ${2 * r + 4} ${2 * r + 4}" width="${2 * r + 4}" height="${2 * r + 4}">
      <circle r="${r}" stroke-width="2.5"/>
      <path transform="rotate(${b.uscita.toFixed(0)})" d="M0 ${r * .55} L0 ${-r * .5} M${-r * .38} ${-r * .12} L0 ${-r * .58} L${r * .38} ${-r * .12}"
        fill="none" stroke-width="${tipo === 'prossimo' ? 3.4 : 2.6}" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  });
};

/* ------------------------------------------------ mappa */
export class MappaGuida {
  constructor(el, traccia, { onSegui } = {}) {
    this.t = traccia; this.segui = true; this.zoomUtente = false; this.prog = false; this.onSegui = onSegui;
    const map = this.map = L.map(el, { zoomControl: false, maxZoom: 20, attributionControl: false, tap: true, fadeAnimation: false });
    L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map);
    L.control.scale({ imperial: false, position: 'topleft' }).addTo(map);
    this.basi = {
      satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, maxNativeZoom: 19, attribution: 'Immagini © Esri, Maxar, Earthstar Geographics' }),
      topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 17, subdomains: 'abc', attribution: '© OpenTopoMap (CC-BY-SA), dati © OpenStreetMap' }),
    };
    this.base = leggiLS('srm-guida-base') === 'topo' ? 'topo' : 'satellite';
    this.basi[this.base].addTo(map);
    new SentieriSegnati({ maxZoom: 20, maxNativeZoom: 18, opacity: .9, attribution: 'Sentieri © waymarkedtrails.org' }).addTo(map);

    ['traccia', 'chevron', 'bivi', 'me'].forEach((p, i) => { map.createPane(p); map.getPane(p).style.zIndex = 405 + i * 5; });

    const ll = traccia.latlngs();
    L.polyline(ll, { pane: 'traccia', color: '#153821', weight: 10, opacity: .85, interactive: false }).addTo(map);
    L.polyline(ll, { pane: 'traccia', color: '#FF8102', weight: 6, opacity: 1, interactive: false }).addTo(map);
    traccia.comune.slice(0, 1).forEach(([a, b]) => {
      const seg = traccia.pts.filter(p => p[3] >= a && p[3] <= b).map(p => [p[0], p[1]]);
      L.polyline(seg, { pane: 'traccia', color: '#fff', weight: 2, dashArray: '2 9', opacity: .95, interactive: false }).addTo(map);
    });

    // frecce del senso di marcia, fitte perché la mappa è ingrandita: solo nel tratto vicino (da −1 a +3 km)
    const chev = this.chev = L.layerGroup();
    this.kmChev = null;
    const mostraChev = () => { if (map.getZoom() >= 15) chev.addTo(map); else chev.remove(); };
    map.on('zoomend', mostraChev);
    this._frecce(0);

    this.gBivi = L.layerGroup().addTo(map);
    this.mkBivi = new Map();
    this.cerchio = null; this.mkMe = null; this.linea = null;

    const p0 = traccia.at(0);
    this._vista([p0[0], p0[1]], 16);
    mostraChev();
    map.on('dragstart', () => { if (this.segui) { this.segui = false; this.onSegui?.(false); } });
    map.on('zoomstart', () => { if (!this.prog) this.zoomUtente = true; });
  }

  _frecce(km) {
    if (this.kmChev != null && Math.abs(km - this.kmChev) < 1) return;
    this.kmChev = km;
    const t = this.t, chev = this.chev;
    chev.clearLayers();
    const da = Math.max(0.05, km - 1), a = Math.min(t.kmTot - 0.03, km + 3);
    for (let k = Math.ceil(da / 0.08) * 0.08 + 0.05; k < a; k += 0.08) {
      const p = t.at(k), b = t.direzioneDopo(k, 0.03);
      L.marker([p[0], p[1]], { pane: 'chevron', interactive: false, keyboard: false, icon: L.divIcon({ className: 'mk-chevron', iconSize: [14, 14], iconAnchor: [7, 7],
        html: `<svg viewBox="-7 -7 14 14" width="14" height="14"><path transform="rotate(${b.toFixed(0)})" d="M-4 2.5 L0 -2.5 L4 2.5" fill="none" stroke="#153821" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>` }) }).addTo(chev);
    }
    for (let k = Math.max(1, Math.ceil(da)); k < a; k++) {
      const p = t.at(k);
      L.marker([p[0], p[1]], { pane: 'chevron', interactive: false, keyboard: false, icon: L.divIcon({ className: 'mk-km', iconSize: [24, 24], iconAnchor: [12, 12], html: `<span>${k}</span>` }) }).addTo(chev);
    }
  }

  // Sposta la vista senza animazione: meno ridisegni, meno batteria.
  _vista(ll, z) {
    this.prog = true;
    this.map.setView(ll, z, { animate: false });
    clearTimeout(this.tProg); this.tProg = setTimeout(() => { this.prog = false; }, 100);
  }

  // true se il punto è nella parte centrale della mappa (margine del 22% per lato)
  _alCentro(ll) {
    const sz = this.map.getSize(), p = this.map.latLngToContainerPoint(ll);
    const mx = sz.x * 0.22, my = sz.y * 0.22;
    return p.x >= mx && p.x <= sz.x - mx && p.y >= my && p.y <= sz.y - my;
  }

  // In pausa (schermo nero, mappa fuori dallo schermo): nessun lavoro.
  sospendi(si) { this.sospesa = si; }

  impostaBivi(bivi) {
    this.gBivi.clearLayers(); this.mkBivi.clear();
    for (const b of bivi) {
      const mk = L.marker([b.lat, b.lon], { pane: 'bivi', keyboard: false, icon: iconaBivio(b, 'normale') })
        .bindTooltip(`${b.id} · ${b.titolo}`, { className: 'tip', direction: 'top', offset: [0, -14] });
      mk.addTo(this.gBivi);
      this.mkBivi.set(b.id, { mk, b, tipo: 'normale' });
    }
  }

  // Aggiorna posizione, bivi e inquadratura dallo stato del motore.
  aggiorna(motore, precisione) {
    if (this.sospesa) return;
    const st = motore.stato();
    if (st.km != null) this._frecce(st.km);
    for (const v of this.mkBivi.values()) {
      const fatto = motore.flag.get(v.b.id)?.ver;
      // solo i bivi del tratto in cui si è: nel tratto fatto due volte non compare quello dell'altro passaggio
      const km = st.km ?? (motore.pos ? null : 0);
      const vicino = km == null || (v.b.km >= km - 0.6 && v.b.km <= km + 3);
      const tipo = !vicino ? 'nascosto' : st.prossimo?.b.id === v.b.id ? 'prossimo' : fatto ? 'fatto' : 'normale';
      if (tipo !== v.tipo) {
        v.tipo = tipo;
        if (tipo === 'nascosto') { v.mk.remove(); continue; }
        if (!this.gBivi.hasLayer(v.mk)) v.mk.addTo(this.gBivi);
        v.mk.setIcon(iconaBivio(v.b, tipo)); v.mk.setZIndexOffset(tipo === 'prossimo' ? 1000 : 0);
      }
    }
    const pos = motore.pos;
    if (!pos) return;
    const ll = [pos.lat, pos.lon];
    if (!this.mkMe) {
      this.cerchio = L.circle(ll, { pane: 'me', radius: precisione || 10, color: '#1a73e8', weight: 1, fillOpacity: .12, interactive: false }).addTo(this.map);
      this.linea = L.polyline([ll, ll], { pane: 'me', color: '#1a73e8', weight: 3, dashArray: '6 6', opacity: .95, interactive: false });
      this.mkMe = L.marker(ll, { pane: 'me', keyboard: false, interactive: false, icon: iconaMe(st.direzione) }).addTo(this.map);
      this.dirMe = st.direzione;
    }
    this.mkMe.setLatLng(ll);
    if (st.direzione == null ? this.dirMe != null : this.dirMe == null || Math.abs(st.direzione - this.dirMe) > 4) {
      this.dirMe = st.direzione; this.mkMe.setIcon(iconaMe(st.direzione));
    }
    this.cerchio.setLatLng(ll);
    const r = Math.max(3, precisione || 10);
    if (Math.abs(r - this.cerchio.getRadius()) > 2) this.cerchio.setRadius(r);

    // lontano dalla traccia: linea tratteggiata verso il punto più vicino
    let verso = null;
    if (st.km == null || st.fuori || (st.dist ?? 0) > 20) {
      const p = st.km == null ? this.t.proietta(pos.lat, pos.lon) : this.t.proietta(pos.lat, pos.lon, st.km - 0.3, st.km + 1.5);
      const q = this.t.at(p.km); verso = [q[0], q[1]];
    }
    if (verso) this.linea.setLatLngs([ll, verso]).addTo(this.map); else this.linea.remove();

    // la mappa si sposta solo quando il punto esce dalla zona centrale o serve un altro ingrandimento
    if (this.segui) {
      const vicinoBivio = st.prossimo && st.prossimo.d <= 120;
      const z = this.zoomUtente ? this.map.getZoom() : (vicinoBivio || st.fuori ? 18 : 17);
      if (verso && !this.zoomUtente) {
        if (!this._alCentro(ll) || !this.map.getBounds().contains(verso)) {
          this.prog = true;
          this.map.fitBounds(L.latLngBounds([ll, verso]).pad(0.35), { maxZoom: 18, animate: false });
          clearTimeout(this.tProg); this.tProg = setTimeout(() => { this.prog = false; }, 100);
        }
      } else if (z !== this.map.getZoom() || !this._alCentro(ll)) {
        // centra un po' avanti nella direzione di marcia, così si vede cosa arriva
        let c = ll;
        if (st.direzione != null && z === this.map.getZoom()) {
          const sz = this.map.getSize(), p = this.map.latLngToContainerPoint(ll), r = st.direzione * Math.PI / 180;
          c = this.map.containerPointToLatLng([p.x + Math.sin(r) * sz.x * 0.2, p.y - Math.cos(r) * sz.y * 0.2]);
        }
        this._vista(c, z);
      }
    }
  }

  centra(motore, precisione) {
    this.segui = true; this.zoomUtente = false; this.onSegui?.(true);
    if (motore.pos) this._vista([motore.pos.lat, motore.pos.lon], this.map.getZoom());
    this.aggiorna(motore, precisione);
  }
  zoom(d) { this.zoomUtente = true; this.onSegui?.(false); d > 0 ? this.map.zoomIn() : this.map.zoomOut(); }
  cambiaBase() {
    this.basi[this.base].remove();
    this.base = this.base === 'satellite' ? 'topo' : 'satellite';
    this.basi[this.base].addTo(this.map).bringToBack();
    scriviLS('srm-guida-base', this.base);
    return this.base;
  }
  ridimensiona() { this.map.invalidateSize(); }
  rimuovi() { clearTimeout(this.tProg); this.map.remove(); }
}
