// Utilità geografiche sulla traccia ufficiale SRM 2026
const R = 6371000;
const rad = d => d * Math.PI / 180;

export function dist(a, b) {
  const la1 = rad(a[0]), la2 = rad(b[0]);
  const dla = la2 - la1, dlo = rad(b[1] - a[1]);
  const h = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearing(a, b) {
  const la1 = rad(a[0]), la2 = rad(b[0]), dlo = rad(b[1] - a[1]);
  const y = Math.sin(dlo) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dlo);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

const PUNTI = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ovest', 'ovest', 'nord-ovest'];
export const cardinale = b => PUNTI[Math.round(b / 45) % 8];

export class Traccia {
  constructor(data) {
    this.pts = data.pts;            // [lat, lon, ele, km]
    this.kmTot = data.km_tot;
    this.comune = data.comune || []; // tratti percorsi due volte [[a,b],[c,d]]
    this.sentieri = data.sentieri || [];
  }
  latlngs() { return this.pts.map(p => [p[0], p[1]]); }

  at(km) {
    const p = this.pts;
    km = Math.max(0, Math.min(this.kmTot, km));
    let lo = 0, hi = p.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m][3] < km) lo = m; else hi = m; }
    const a = p[lo], b = p[hi];
    const f = b[3] > a[3] ? (km - a[3]) / (b[3] - a[3]) : 0;
    return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])];
  }

  // direzione in cui va il corridore dopo il punto (gradi da nord)
  direzioneDopo(km, avanti = 0.06) { return bearing(this.at(km - 0.015), this.at(km + avanti)); }

  sentiero(km) {
    const s = this.sentieri.find(x => km >= x.da && km < x.a);
    return s ? s.nome : (this.sentieri.at(-1)?.nome || '');
  }

  // proiezione di un punto sulla traccia, cercando solo tra kmMin e kmMax
  proietta(lat, lon, kmMin = 0, kmMax = this.kmTot) {
    const p = this.pts, k = Math.cos(rad(lat)) ;
    const toXY = q => [(q[1] - lon) * k * 111320, (q[0] - lat) * 110540];
    let best = { d: Infinity, km: 0 };
    for (let i = 1; i < p.length; i++) {
      if (p[i][3] < kmMin || p[i - 1][3] > kmMax) continue;
      const A = toXY(p[i - 1]), B = toXY(p[i]);
      const vx = B[0] - A[0], vy = B[1] - A[1];
      const L2 = vx * vx + vy * vy;
      let t = L2 ? -(A[0] * vx + A[1] * vy) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      const x = A[0] + t * vx, y = A[1] + t * vy;
      const d = Math.hypot(x, y);
      if (d < best.d) best = { d, km: p[i - 1][3] + t * (p[i][3] - p[i - 1][3]) };
    }
    return best;
  }

  nelTrattoComune(km) { return this.comune.some(([a, b]) => km >= a - 0.02 && km <= b + 0.02); }
}

export const fmtKm = km => (Math.round(km * 100) / 100).toLocaleString('it-IT', { minimumFractionDigits: km % 1 ? 1 : 0, maximumFractionDigits: 2 });
export const fmtCoord = v => v.toFixed(6);

// Riconosce coordinate scritte o incollate: restituisce { lat, lon } oppure null.
// Formati: 42.139664, 13.412430 · 42,139664 13,412430 · 42°08'22.8"N 13°24'44.7"E · 42°08.380'N 13°24.745'E ·
// N 42° 08' 22.8" E 13° 24' 44.7" · link di Google Maps / Apple Maps / OpenStreetMap con le coordinate dentro.
export function leggiCoordinate(testo) {
  let t = String(testo ?? '').trim();
  if (!t) return null;
  try { t = decodeURIComponent(t.replace(/\+/g, ' ')); } catch { /* testo non codificato */ }
  const ok = (lat, lon) => (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) ? { lat, lon } : null;
  const num = x => x ? parseFloat(String(x).replace(',', '.')) : 0;
  // link: segnaposto esatto di Google (!3d…!4d…), poi i parametri con il punto cercato
  let m = t.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (m) return ok(+m[1], +m[2]);
  m = t.match(/[?&#](?:q|query|destination|daddr|ll|sll|mlat)=(-?\d+(?:\.\d+)?)(?:\s*,\s*|&mlon=)(-?\d+(?:\.\d+)?)/);
  if (m) return ok(+m[1], +m[2]);
  m = t.match(/#map=\d+(?:\.\d+)?\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/);   // openstreetmap.org/#map=17/42.13/13.41
  if (m) return ok(+m[1], +m[2]);
  // gradi, primi, secondi (anche solo gradi o gradi e primi decimali)
  const parti = [...t.matchAll(/([NSEWO])?\s*(\d{1,3}(?:[.,]\d+)?)\s*°\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*['′’]\s*)?(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:["″”]|'')\s*)?([NSEWO])?/gi)];
  if (parti.length >= 2) {
    const val = p => {
      let v = num(p[2]) + num(p[3]) / 60 + num(p[4]) / 3600;
      const h = (p[1] || p[5] || '').toUpperCase();
      if (h === 'S' || h === 'W' || h === 'O') v = -v;
      return { v, h };
    };
    let [a, b] = parti.slice(0, 2).map(val);
    if (/[EWO]/.test(a.h) && /[NS]/.test(b.h)) [a, b] = [b, a];
    return ok(a.v, b.v);
  }
  // decimali con il punto: 42.139664, 13.412430 · 42.139664 13.412430 · 42.139664;13.412430 (anche dentro un link con @)
  m = t.match(/(-?\d{1,3}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)/);
  if (m) return ok(+m[1], +m[2]);
  // decimali con la virgola: 42,139664 13,412430 · 42,139664; 13,412430
  m = t.match(/(-?\d{1,3},\d+)\s*[;\s]\s*(-?\d{1,3},\d+)/);
  if (m) return ok(num(m[1]), num(m[2]));
  return null;
}
export function fmtDist(m) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 })} km`;
}
