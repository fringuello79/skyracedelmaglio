// Cartografia dell'orologio per la modalità visuale (pulsante laterale).
// Sull'orologio vero: tessere della carta salvate prima sulla microSD (zona di gara, livelli 12-16),
// più il rilievo calcolato dalle quote quando una tessera manca. Qui: tessere OpenTopoMap dal web,
// e sotto il rilievo dal modello delle quote dell'Explorer (lo stesso del calcolo radio).
const R = 6378137, rad = d => d * Math.PI / 180;

export const ZOOM = [
  { mpp: 2, nome: '800 m' },
  { mpp: 5, nome: '2 km' },
  { mpp: 24, nome: 'tutto il percorso' },
];

const mondo = (lat, lon, z) => {
  const n = 256 * 2 ** z, s = Math.sin(rad(lat));
  return [(lon + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
};

export class MappaOrologio {
  constructor(traccia, terreno, { tessere = true } = {}) {
    this.t = traccia; this.T = terreno; this.tessere = tessere;
    this.cache = new Map(); this.inCarico = 0;
    this.rilievo = this._rilievo();
    const ll = traccia.pts; let a = 90, b = -90, c = 180, d = -180;
    for (const p of ll) { a = Math.min(a, p[0]); b = Math.max(b, p[0]); c = Math.min(c, p[1]); d = Math.max(d, p[1]); }
    this.centroTraccia = [(a + b) / 2, (c + d) / 2];
  }

  // rilievo ombreggiato dalle quote (luce da nord-ovest), colori da carta escursionistica
  _rilievo() {
    if (typeof document === 'undefined' || !this.T) return null;
    const { nx, ny, h } = this.T;
    const cv = document.createElement('canvas'); cv.width = nx; cv.height = ny;
    const x = cv.getContext('2d'), img = x.createImageData(nx, ny);
    const cell = 50;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const q = k => h[Math.min(ny - 1, Math.max(0, k[1])) * nx + Math.min(nx - 1, Math.max(0, k[0]))];
      const dzdx = (q([i + 1, j]) - q([i - 1, j])) / (2 * cell), dzdy = (q([i, j + 1]) - q([i, j - 1])) / (2 * cell);
      const luce = Math.max(0, Math.min(1, 0.55 + 0.9 * (dzdx * 0.7 - dzdy * 0.7) / Math.hypot(1, dzdx, dzdy)));
      const z = q([i, j]);
      const base = z > 2000 ? [214, 206, 190] : z > 1700 ? [190, 196, 160] : z > 1100 ? [150, 178, 128] : [176, 196, 140];
      const o = ((ny - 1 - j) * nx + i) * 4;      // riga 0 della griglia = sud
      img.data[o] = base[0] * luce; img.data[o + 1] = base[1] * luce; img.data[o + 2] = base[2] * luce; img.data[o + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return cv;
  }

  _tessera(z, x, y, ridisegna) {
    const k = `${z}/${x}/${y}`;
    let t = this.cache.get(k);
    if (!t && this.tessere && this.inCarico < 8) {
      const img = new Image(); t = { img, ok: false };
      this.cache.set(k, t); this.inCarico++;
      img.onload = () => { t.ok = true; this.inCarico--; ridisegna?.(); };
      img.onerror = () => { t.errore = true; this.inCarico--; };
      img.src = `https://${'abc'[(x + y) % 3]}.tile.opentopomap.org/${k}.png`;
      if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value);
    }
    return t?.ok ? t.img : null;
  }

  // c: contesto 2D; area: {x, y, w, h}; v: {centro:[lat,lon], mpp, km, bivi, fix, direzione}
  disegna(c, area, v, ridisegna) {
    const { x: ax, y: ay, w, h } = area;
    const lat = v.centro[0];
    const z = Math.max(11, Math.min(16, Math.round(Math.log2(156543.03 * Math.cos(rad(lat)) / v.mpp))));
    const s = 156543.03 * Math.cos(rad(lat)) / 2 ** z / v.mpp;       // px schermo per px del mondo
    const [cx, cy] = mondo(v.centro[0], v.centro[1], z);
    const sx = ax + w / 2, sy = ay + h / 2;
    const P = (la, lo) => { const [px, py] = mondo(la, lo, z); return [sx + (px - cx) * s, sy + (py - cy) * s]; };
    c.save(); c.beginPath(); c.rect(ax, ay, w, h); c.clip();
    c.fillStyle = '#1b1f1c'; c.fillRect(ax, ay, w, h);
    // rilievo
    if (this.rilievo) {
      const T = this.T, la1 = T.lat0 + (T.ny - 1) * T.dlat, lo1 = T.lon0 + (T.nx - 1) * T.dlon;
      const [x0, y0] = P(la1, T.lon0), [x1, y1] = P(T.lat0, lo1);
      c.imageSmoothingEnabled = true; c.drawImage(this.rilievo, x0, y0, x1 - x0, y1 - y0);
    }
    // tessere della carta
    const t0x = Math.floor((cx - w / 2 / s) / 256), t1x = Math.floor((cx + w / 2 / s) / 256);
    const t0y = Math.floor((cy - h / 2 / s) / 256), t1y = Math.floor((cy + h / 2 / s) / 256);
    c.globalAlpha = 0.92;
    for (let tx = t0x; tx <= t1x; tx++) for (let ty = t0y; ty <= t1y; ty++) {
      const img = this._tessera(z, tx, ty, ridisegna);
      if (img) c.drawImage(img, sx + (tx * 256 - cx) * s, sy + (ty * 256 - cy) * s, 256 * s + 0.5, 256 * s + 0.5);
    }
    c.globalAlpha = 1;
    // percorso: fatto in grigio, da fare in arancio SRM con il bordo scuro
    const passo = Math.max(0.005, v.mpp * 3 / 1000);
    const linea = (a, b, col, lw) => {
      if (b <= a) return;
      c.strokeStyle = col; c.lineWidth = lw; c.lineJoin = 'round'; c.lineCap = 'round'; c.beginPath();
      for (let k = a; k <= b + 1e-9; k += passo) { const p = this.t.at(Math.min(k, b)); const [x, y] = P(p[0], p[1]); k === a ? c.moveTo(x, y) : c.lineTo(x, y); }
      c.stroke();
    };
    const km = v.km ?? 0, K = this.t.kmTot;
    linea(0, km, 'rgba(20,20,20,.55)', 7); linea(0, km, '#8a8f8b', 4);
    linea(km, K, '#1a1200', 9); linea(km, K, '#FF8102', 5.5);
    // frecce sul percorso ogni tanto, per il senso di marcia
    for (let k = Math.ceil(km * 2) / 2 + 0.25; k < K; k += v.mpp > 10 ? 2 : 0.5) {
      const a = this.t.at(k), b = this.t.at(k + 0.03); const [x1, y1] = P(a[0], a[1]), [x2, y2] = P(b[0], b[1]);
      if (x1 < ax - 20 || x1 > ax + w + 20 || y1 < ay - 20 || y1 > ay + h + 20) continue;
      const ang = Math.atan2(y2 - y1, x2 - x1);
      c.save(); c.translate(x1, y1); c.rotate(ang); c.fillStyle = '#fff'; c.beginPath(); c.moveTo(6, 0); c.lineTo(-4, -4.5); c.lineTo(-4, 4.5); c.closePath(); c.fill(); c.restore();
    }
    // bivi davanti
    for (const b of v.bivi || []) {
      if (b.silenzioso || b.km < km || b.km > km + (v.mpp > 10 ? 30 : 3)) continue;
      const p = this.t.at(b.km); const [x, y] = P(p[0], p[1]);
      c.fillStyle = '#ffb020'; c.strokeStyle = '#000'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, v.mpp > 10 ? 4 : 7, 0, 7); c.fill(); c.stroke();
    }
    // posizione e direzione di marcia
    if (v.fix) {
      const [x, y] = P(v.fix.lat, v.fix.lon);
      if (v.direzione != null) {
        c.save(); c.translate(x, y); c.rotate(rad(v.direzione)); c.fillStyle = 'rgba(77,163,255,.35)';
        c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 42, rad(-90 - 28), rad(-90 + 28)); c.closePath(); c.fill(); c.restore();
      }
      c.fillStyle = '#2f7de1'; c.strokeStyle = '#fff'; c.lineWidth = 3.5; c.beginPath(); c.arc(x, y, 11, 0, 7); c.fill(); c.stroke();
    }
    c.restore();
    return { z, P };
  }
}
