// SRM 3D — sfondo vivo del massiccio del Velino per skyracedelmaglio.it
// Terreno reale (SRM Explorer) + nuvole basse, foschia, sole/luna nella posizione vera del momento
// e meteo dal vivo da Open-Meteo (nessuna chiave). Uso:
//   import { avviaSRM3D } from './assets/3d/srm3d.js';
//   avviaSRM3D({ canvas, labels, ancore: [['.hero','hero'], ['#gara','paese'], ...], widget });
import * as THREE from 'three';

const LAT = 42.12, LON = 13.38;                       // centro del massiccio
const BASE = new URL('./', import.meta.url).href;     // cartella di questo file
const RAD = Math.PI / 180;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, f) => a + (b - a) * f;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- astronomia
function equToHor(RA, dec, d, lat, lon) {
  const H = ((280.46061837 + 360.98564736629 * d) + lon) * RAD - RA, f = lat * RAD;
  const alt = Math.asin(Math.sin(f) * Math.sin(dec) + Math.cos(f) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(f) - Math.sin(f) * Math.cos(H));
  return { alt, az: (az + 2 * Math.PI) % (2 * Math.PI) };   // az da nord, in senso orario
}
function sunPos(date) {
  const d = date.getTime() / 864e5 - 10957.5;
  const g = (357.529 + 0.98560028 * d) * RAD, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD, e = (23.439 - 3.6e-7 * d) * RAD;
  const RA = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  return { ...equToHor(RA, dec, d, LAT, LON), lon: L };
}
function moonPos(date, sunLon) {
  const d = date.getTime() / 864e5 - 10957.5;
  const L = (218.316 + 13.176396 * d) * RAD, M = (134.963 + 13.064993 * d) * RAD, F = (93.272 + 13.22935 * d) * RAD;
  const l = L + 6.289 * RAD * Math.sin(M), b = 5.128 * RAD * Math.sin(F), e = 23.4397 * RAD;
  const RA = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  const el = l - sunLon;                                 // elongazione
  return { ...equToHor(RA, dec, d, LAT, LON), illum: (1 - Math.cos(el)) / 2, waxing: Math.sin(el) > 0 };
}
// direzione (scena: x est, y su, z sud)
const dirOf = (az, alt) => new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));

// ---------------------------------------------------------------- meteo
const WMO = { 0: 'sereno', 1: 'quasi sereno', 2: 'poco nuvoloso', 3: 'coperto', 45: 'nebbia', 48: 'nebbia con brina',
  51: 'pioviggine', 53: 'pioviggine', 55: 'pioviggine fitta', 56: 'pioviggine gelata', 57: 'pioviggine gelata',
  61: 'pioggia debole', 63: 'pioggia', 65: 'pioggia forte', 66: 'pioggia gelata', 67: 'pioggia gelata',
  71: 'neve debole', 73: 'neve', 75: 'neve forte', 77: 'nevischio', 80: 'rovesci', 81: 'rovesci', 82: 'rovesci forti',
  85: 'rovesci di neve', 86: 'rovesci di neve', 95: 'temporale', 96: 'temporale con grandine', 99: 'temporale con grandine' };
const VARS = 'temperature_2m,relative_humidity_2m,dew_point_2m,weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,wind_speed_10m,wind_direction_10m,precipitation,snowfall,snow_depth';
async function meteoPunto(lat, lon, ele) {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&elevation=${ele}&current=${VARS}&timezone=Europe%2FRome`;
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 8000);
  try { const r = await fetch(u, { signal: ctl.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return (await r.json()).current; }
  finally { clearTimeout(to); }
}
async function meteoDalVivo() {
  const [valle, vetta] = await Promise.all([meteoPunto(42.0925, 13.3647, 729), meteoPunto(42.1525, 13.3860, 2450)]);
  return { fonte: 'live', valle, vetta, t: Date.now() };
}
// scenari per la simulazione (stessi campi di Open-Meteo)
const P = (o) => ({ temperature_2m: 8, relative_humidity_2m: 70, dew_point_2m: 3, weather_code: 0, cloud_cover: 0, cloud_cover_low: 0,
  cloud_cover_mid: 0, cloud_cover_high: 0, visibility: 30000, wind_speed_10m: 8, wind_direction_10m: 240, precipitation: 0, snowfall: 0, snow_depth: 0, ...o });
export const SCENARI = {
  sereno: { nome: 'Sereno', valle: P({}), vetta: P({ temperature_2m: -2, relative_humidity_2m: 55 }) },
  nuvole: { nome: 'Nuvole basse', valle: P({ weather_code: 2, cloud_cover_low: 70, relative_humidity_2m: 88, temperature_2m: 7, dew_point_2m: 4.2, visibility: 18000 }), vetta: P({ temperature_2m: 0, relative_humidity_2m: 70 }) },
  coperto: { nome: 'Coperto', valle: P({ weather_code: 3, cloud_cover: 100, cloud_cover_low: 60, cloud_cover_mid: 90, cloud_cover_high: 60, dew_point_2m: 1, temperature_2m: 6, visibility: 14000 }), vetta: P({ temperature_2m: -3, relative_humidity_2m: 92 }) },
  nebbia: { nome: 'Nebbia', valle: P({ weather_code: 45, cloud_cover_low: 100, relative_humidity_2m: 99, temperature_2m: 3, dew_point_2m: 2.8, visibility: 600 }), vetta: P({ temperature_2m: 4, relative_humidity_2m: 40 }) },
  pioggia: { nome: 'Pioggia', valle: P({ weather_code: 63, cloud_cover: 100, cloud_cover_low: 95, cloud_cover_mid: 100, precipitation: 3, relative_humidity_2m: 96, temperature_2m: 9, dew_point_2m: 8.4, visibility: 6000, wind_speed_10m: 20 }), vetta: P({ temperature_2m: 1, relative_humidity_2m: 100 }) },
  neve: { nome: 'Neve', valle: P({ weather_code: 73, cloud_cover: 100, cloud_cover_low: 90, cloud_cover_mid: 100, snowfall: 1.4, relative_humidity_2m: 95, temperature_2m: 0, dew_point_2m: -0.6, visibility: 2500, snow_depth: .08, wind_speed_10m: 14 }), vetta: P({ temperature_2m: -8, snow_depth: .6, relative_humidity_2m: 100 }) },
};

// da meteo a parametri di scena
function interpreta(m) {
  const v = m.valle, s = m.vetta, code = v.weather_code ?? 0;
  const low = (v.cloud_cover_low ?? 0) / 100, mid = (v.cloud_cover_mid ?? 0) / 100, high = (v.cloud_cover_high ?? 0) / 100;
  const spread = Math.max(0, (v.temperature_2m ?? 8) - (v.dew_point_2m ?? 0));
  const nebbia = code === 45 || code === 48 || (v.visibility ?? 3e4) < 1000;
  let base = nebbia ? 600 : clamp(729 + 125 * spread, 760, 3000);          // base delle nubi (m s.l.m.)
  const spess = nebbia ? 380 : lerp(220, 600, Math.max(low, mid * .6));
  const pioggia = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code);
  const neveCade = [71, 73, 75, 77, 85, 86].includes(code);
  const prec = v.precipitation ?? 0;
  // limite della neve al suolo: dalla neve misurata in valle e in vetta
  let snow = 9999;
  if ((v.snow_depth ?? 0) > .01) snow = 600;
  else if ((s.snow_depth ?? 0) > .02) snow = clamp(2450 - (s.snow_depth ?? 0) * 900 - 250, 1250, 2250);
  return {
    code, testo: WMO[code] ?? 'n.d.', low, mid, high,
    deck0: base, deck1: base + spess,
    cop: clamp(low * 1.05, 0, 1),
    overcast: clamp(Math.max(mid, high * .55, low > .85 ? low * .7 : 0), 0, 1),
    haze: nebbia ? 7e-5 : clamp(1.6 / Math.max(300, v.visibility ?? 3e4), 2.2e-5, 4e-4),   // la nebbia vera la fa lo strato basso
    wisp: sstep(60, 96, s.relative_humidity_2m ?? 60),
    rain: pioggia ? clamp(.35 + prec / 5, .3, 1) : 0,
    snowFall: neveCade ? clamp(.4 + (v.snowfall ?? 0) / 2, .35, 1) : 0,
    snowLine: snow,
    wet: pioggia ? .6 : 0,
    windDir: v.wind_direction_10m ?? 240, windKmh: v.wind_speed_10m ?? 8,
    tValle: v.temperature_2m, tVetta: s.temperature_2m
  };
}

// ---------------------------------------------------------------- utilità caricamento
async function pixels(url) {
  const r = await fetch(url); if (!r.ok) throw new Error('asset ' + url);
  const bm = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bm, 0, 0);
  return x.getImageData(0, 0, c.width, c.height);
}
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function noise3D(N) {
  const f = new Float32Array(N * N * N), R = rng(42), sm = t => t * t * (3 - 2 * t);
  for (const [P, a] of [[4, 1], [8, .5], [16, .25], [32, .125]]) {
    const g = new Float32Array(P * P * P); for (let i = 0; i < g.length; i++) g[i] = R();
    const s = N / P, G = (z, y, x) => g[(z * P + y) * P + x];
    for (let z = 0; z < N; z++) { const fz = z / s, iz = Math.floor(fz), tz = sm(fz - iz), z0 = iz % P, z1 = (iz + 1) % P;
      for (let y = 0; y < N; y++) { const fy = y / s, iy = Math.floor(fy), ty = sm(fy - iy), y0 = iy % P, y1 = (iy + 1) % P;
        for (let x = 0; x < N; x++) { const fx = x / s, ix = Math.floor(fx), tx = sm(fx - ix), x0 = ix % P, x1 = (ix + 1) % P;
          const c00 = G(z0, y0, x0) + (G(z0, y0, x1) - G(z0, y0, x0)) * tx, c01 = G(z0, y1, x0) + (G(z0, y1, x1) - G(z0, y1, x0)) * tx;
          const c10 = G(z1, y0, x0) + (G(z1, y0, x1) - G(z1, y0, x0)) * tx, c11 = G(z1, y1, x0) + (G(z1, y1, x1) - G(z1, y1, x0)) * tx;
          const c0 = c00 + (c01 - c00) * ty, c1 = c10 + (c11 - c10) * ty;
          f[(z * N + y) * N + x] += a * (c0 + (c1 - c0) * tz); } } }
  }
  const out = new Uint8Array(N * N * N);
  for (let i = 0; i < f.length; i++) out[i] = clamp(((f[i] / 1.875) - .5) * 1.9 * 255 + 128, 0, 255);
  const t = new THREE.Data3DTexture(out, N, N, N);
  t.format = THREE.RedFormat; t.type = THREE.UnsignedByteType; t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping; t.unpackAlignment = 1; t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- geografia
const R_T = 6371000, E0 = 600, VEX = 1.2;                    // quota di riferimento, esagerazione verticale
const lon2tx = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2ty = (lat, z) => { const r = lat * RAD; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };
const tx2lon = (x, z) => x / 2 ** z * 360 - 180;
const ty2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return Math.atan(Math.sinh(n)) / RAD; };
// ---------------------------------------------------------------- motore
export async function avviaSRM3D(opt) {
  const { canvas, ancore, onProgress = () => {}, onMeteo = () => {}, onHud = () => {}, onDati = () => {} } = opt;
  const isMobile = matchMedia('(pointer:coarse)').matches || innerWidth < 700;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 assente');
  canvas.addEventListener('webglcontextlost', e => e.preventDefault());
  canvas.addEventListener('webglcontextrestored', () => location.reload());
  const maxTex = renderer.capabilities.maxTextureSize;

  onProgress(.05);
  const [geo, route] = await Promise.all([fetch(BASE + 'geo.json').then(r => r.json()), fetch(BASE + 'route2.json').then(r => r.json())]);
  const big = renderer.capabilities.maxTextureSize >= 4096 && !isMobile;
  const bitmap = async f => { const r = await fetch(BASE + f); if (!r.ok) throw new Error('asset ' + f);
    return createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); };
  const [cImg, oImg, bAlbC, bAlbO] = await Promise.all([pixels(BASE + 'core_h.png'), pixels(BASE + 'outer_h.png'), bitmap(big ? geo.albC : geo.albC2), bitmap(geo.albO)]);
  onProgress(.5);
  const cosL = Math.cos(geo.lat0 * RAD);
  const ll2en = (lat, lon) => [R_T * cosL * (lon - geo.lon0) * RAD, R_T * (lat - geo.lat0) * RAD];
  const en2ll = (E, N) => [geo.lat0 + N / R_T / RAD, geo.lon0 + E / (R_T * cosL) / RAD];

  // ---- griglie di quota (metri s.l.m.), riga 0 = sud
  const NCg = geo.nc || 1024, NOg = geo.no || 1024;
  const CORE = geo.core, OUT = geo.outer;                     // [E0, N0, lato]
  const decodeH = img => { const a = new Float32Array(img.width * img.height);
    for (let i = 0; i < a.length; i++) a[i] = ((img.data[i * 4] << 8) | img.data[i * 4 + 1]) / geo.k - geo.off; return a; };
  let HC = decodeH(cImg), HO = decodeH(oImg);
  const samp = (H, box, E, N) => { const NG = H === HC ? NCg : NOg;
    let u = (E - box[0]) / box[2] * NG - .5, v = (N - box[1]) / box[2] * NG - .5;
    u = clamp(u, 0, NG - 1.001); v = clamp(v, 0, NG - 1.001);
    const i = u | 0, j = v | 0, fu = u - i, fv = v - j, k = j * NG + i;
    return H[k] * (1 - fu) * (1 - fv) + H[k + 1] * fu * (1 - fv) + H[k + NG] * (1 - fu) * fv + H[k + NG + 1] * fu * fv;
  };
  const coreW = (E, N) => { const u = (E - CORE[0]) / CORE[2], v = (N - CORE[1]) / CORE[2];
    return sstep(0, .035, Math.min(u, 1 - u, v, 1 - v)); };
  const elevAt = (E, N) => { const w = coreW(E, N); return w <= 0 ? samp(HO, OUT, E, N) : w >= 1 ? samp(HC, CORE, E, N) : lerp(samp(HO, OUT, E, N), samp(HC, CORE, E, N), w); };
  const yOf = e => (e - E0) * VEX;
  const heightAt = (x, z) => yOf(elevAt(x, -z));

  // ---- texture di quota (per le ombre) e normali (calcolate qui)
  const mkHTex = H => { const NG = Math.round(Math.sqrt(H.length)), a = new Float32Array(H.length); for (let i = 0; i < H.length; i++) a[i] = yOf(H[i]);
    const t = new THREE.DataTexture(a, NG, NG, THREE.RedFormat, THREE.FloatType); t.needsUpdate = true; return t; };
  const mkNTex = (H, box) => { const NG = Math.round(Math.sqrt(H.length)), d = new Uint8Array(NG * NG * 4), cell = box[2] / NG;
    for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) {
      const k = j * NG + i, l = H[j * NG + Math.max(i - 1, 0)], r = H[j * NG + Math.min(i + 1, NG - 1)];
      const s = H[Math.max(j - 1, 0) * NG + i], n = H[Math.min(j + 1, NG - 1) * NG + i];
      const dx = (r - l) * VEX / (2 * cell), dn = (n - s) * VEX / (2 * cell);
      let nx = -dx, ny = 1, nz = dn; const L = Math.hypot(nx, ny, nz); nx /= L; ny /= L; nz /= L;
      d[k * 4] = (nx * .5 + .5) * 255; d[k * 4 + 1] = (ny * .5 + .5) * 255; d[k * 4 + 2] = (nz * .5 + .5) * 255; d[k * 4 + 3] = 255; }
    const t = new THREE.DataTexture(d, NG, NG, THREE.RGBAFormat); t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 4; t.needsUpdate = true; return t; };
  let tHC = mkHTex(HC), tHO = mkHTex(HO), tNC = mkNTex(HC, CORE), tNO = mkNTex(HO, OUT);
  const bmTex = bm => { const t = new THREE.Texture(bm); t.colorSpace = THREE.NoColorSpace; t.flipY = false; t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8; t.needsUpdate = true; return t; };
  const tAlbC = bmTex(bAlbC), tAlbO = bmTex(bAlbO);
  const tNoise = noise3D(64);
  onProgress(.7);

  // ---- uniform condivisi
  const G = {
    uSun: { value: new THREE.Vector3(.5, .3, .2).normalize() }, uSunC: { value: new THREE.Vector3(5, 3.5, 2) },
    uSunDir: { value: new THREE.Vector3(.5, .3, .2).normalize() }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) }, uMoonIll: { value: 0 },
    uZen: { value: new THREE.Vector3() }, uHor: { value: new THREE.Vector3() }, uGlow: { value: new THREE.Vector3() },
    uAmb: { value: new THREE.Vector3() }, uNight: { value: 0 }, uOver: { value: 0 }, uHaze: { value: 4.5e-5 },
    uSnow: { value: 9999 }, uWet: { value: 0 }, uHigh: { value: 0 }, uExpo: { value: .66 }, uTime: { value: 0 }
  };

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 8, 120000);

  // ---- maglia: più fitta nel riquadro del percorso
  const M = isMobile ? 420 : 640, FR = .62, ce = CORE[0] + CORE[2] / 2, cn = CORE[1] + CORE[2] / 2;
  const hC = CORE[2] / 2, hO = OUT[2] / 2;
  const wp = s => { const a = Math.abs(s), g = Math.sign(s); return g * (a < FR ? a / FR * hC : hC + (a - FR) / (1 - FR) * (hO - hC)); };
  const pos = new Float32Array((M + 1) * (M + 1) * 3);
  const rebuildGeo = () => { for (let j = 0, p = 0; j <= M; j++) for (let i = 0; i <= M; i++, p += 3) {
    const E = ce + wp(i / M * 2 - 1) * .999, N = cn + wp(j / M * 2 - 1) * .999; pos[p] = E; pos[p + 1] = yOf(elevAt(E, N)); pos[p + 2] = -N; } };
  rebuildGeo();
  const idx = new Uint32Array(M * M * 6);
  for (let j = 0, q = 0; j < M; j++) for (let i = 0; i < M; i++) { const a = j * (M + 1) + i, b = a + 1, c = a + M + 1, d = c + 1; idx.set([a, b, c, b, d, c], q); q += 6; }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); tg.setIndex(new THREE.BufferAttribute(idx, 1)); tg.computeBoundingSphere();

  // ---- ombre in GPU (core e contorno)
  const quadGeo = new THREE.PlaneGeometry(2, 2), ocam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const vsQuad = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
  const mkSh = n => { const r = new THREE.WebGLRenderTarget(n, n, { depthBuffer: false }); r.texture.minFilter = r.texture.magFilter = THREE.LinearFilter; return r; };
  const rtShC = mkSh(isMobile ? 1024 : 2048), rtShO = mkSh(1024);
  const shU = { tHC: { value: tHC }, tHO: { value: tHO }, uL: G.uSun, uCore: { value: new THREE.Vector3(...CORE) }, uOut: { value: new THREE.Vector3(...OUT) }, uBox: { value: new THREE.Vector3(...CORE) } };
  const shMat = new THREE.ShaderMaterial({ uniforms: shU, vertexShader: vsQuad, depthTest: false, depthWrite: false,
    fragmentShader: `uniform sampler2D tHC, tHO; uniform vec3 uL, uCore, uOut, uBox; varying vec2 vUv;
      float H(vec2 en){ vec2 c = (en - uCore.xy)/uCore.z;
        if (c.x > .002 && c.y > .002 && c.x < .998 && c.y < .998) return texture2D(tHC, c).r;
        return texture2D(tHO, (en - uOut.xy)/uOut.z).r; }
      void main(){
        float lh = length(uL.xz); if (uL.y <= 0.) { gl_FragColor = vec4(0.); return; }
        vec2 d = vec2(uL.x, -uL.z)/max(lh, 1e-4); float tn = uL.y/max(lh, 1e-4);
        vec2 en = uBox.xy + vUv*uBox.z; float h0 = H(en), oc = -1.;
        for (int i=0;i<120;i++){ float t = 12.*pow(1600., float(i)/119.); oc = max(oc, (H(en + d*t) - h0)/t - tn); }
        gl_FragColor = vec4(vec3(1. - smoothstep(-.012, .04, oc)), 1.);
      }` });
  const shScene = new THREE.Scene(); shScene.add(new THREE.Mesh(quadGeo, shMat));
  const lastL = new THREE.Vector3(0, -1, 0);
  function updateShadows(force) {
    if (!force && lastL.angleTo(G.uSun.value) < .004) return; lastL.copy(G.uSun.value);
    shU.tHC.value = tHC; shU.tHO.value = tHO;
    shU.uBox.value.set(...CORE); renderer.setRenderTarget(rtShC); renderer.render(shScene, ocam);
    shU.uBox.value.set(...OUT); renderer.setRenderTarget(rtShO); renderer.render(shScene, ocam);
    renderer.setRenderTarget(null);
  }

  // ---- materiale del terreno
  const TU = { ...G, tNC: { value: tNC }, tNO: { value: tNO }, tShC: { value: rtShC.texture }, tShO: { value: rtShO.texture },
    tAlbC: { value: tAlbC }, tAlbO: { value: tAlbO }, uHasO: { value: 1 }, uImg: { value: 1 },
    uCore: { value: new THREE.Vector3(...CORE) }, uOut: { value: new THREE.Vector3(...OUT) },
    uAlbC: { value: new THREE.Vector4(CORE[0], CORE[0] + CORE[2], CORE[1], CORE[1] + CORE[2]) }, uAlbO: { value: new THREE.Vector4(OUT[0], OUT[0] + OUT[2], OUT[1], OUT[1] + OUT[2]) } };
  const terrainMat = new THREE.ShaderMaterial({ uniforms: TU,
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `
      uniform sampler2D tNC, tNO, tShC, tShO, tAlbC, tAlbO; uniform vec3 uCore, uOut, uSun, uSunC, uAmb; uniform vec4 uAlbC, uAlbO;
      uniform float uHasO, uImg, uSnow, uWet, uNight; varying vec3 vW;
      float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(h2(i),h2(i+vec2(1,0)),f.x), mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x), f.y); }
      float edge(vec2 u, float b){ return smoothstep(0., b, min(min(u.x, 1.-u.x), min(u.y, 1.-u.y))); }
      vec3 nrm(sampler2D t, vec2 u){ return normalize(texture2D(t, u).xyz*2.-1.); }
      void main(){
        vec2 en = vec2(vW.x, -vW.z);
        vec2 uc = (en - uCore.xy)/uCore.z, uo = (en - uOut.xy)/uOut.z;
        float wc = edge(uc, .035);
        vec3 n = normalize(mix(nrm(tNO, uo), nrm(tNC, uc), wc));
        float sh = mix(texture2D(tShO, uo).r, texture2D(tShC, uc).r, wc);
        float dc = length(vW - cameraPosition);
        float e = vW.y/${VEX.toFixed(2)} + ${E0}.;
        float slope = 1. - n.y;
        float d1 = vn(en*.004), d2 = vn(en*.03)*(1.-smoothstep(1500., 7000., dc)) + .5*smoothstep(1500., 7000., dc);
        // colori di riserva (fuori dalle immagini)
        vec3 plain = vec3(.17,.15,.08), grass = mix(vec3(.15,.14,.07), vec3(.22,.18,.09), d1);
        vec3 high = mix(vec3(.22,.19,.12), vec3(.29,.26,.2), d2), rock = mix(vec3(.38,.37,.34), vec3(.52,.5,.46), d2);
        vec3 c = mix(plain, grass, smoothstep(760., 900., e));
        c = mix(c, mix(vec3(.05,.065,.03), vec3(.14,.07,.03), vn(en*.0015)), smoothstep(950., 1050., e)*(1.-smoothstep(1650., 1800., e))*smoothstep(.3, .6, vn(en*.0009+3.)));
        c = mix(c, high, smoothstep(1700., 1950., e + d1*150.));
        c = mix(c, rock, clamp(smoothstep(.36, .6, slope + d2*.12) + smoothstep(2100., 2350., e)*.5, 0., 1.));
        if (uHasO > .5){
          vec2 ua = vec2((en.x-uAlbO.x)/(uAlbO.y-uAlbO.x), (uAlbO.w-en.y)/(uAlbO.w-uAlbO.z));
          c = mix(c, pow(texture2D(tAlbO, ua).rgb, vec3(2.2))*.58, edge(ua, .01));
        }
        vec2 ub = vec2((en.x-uAlbC.x)/(uAlbC.y-uAlbC.x), (uAlbC.w-en.y)/(uAlbC.w-uAlbC.z));
        float wb = edge(ub, .03);
        vec3 a = pow(texture2D(tAlbC, ub).rgb, vec3(2.2));
        if (uImg < .5){ float l = dot(a, vec3(.3,.59,.11)); a = mix(vec3(l), a, .7)*(.62/(1.+l*1.6)); }
        else { a *= .58; float l = dot(a, vec3(.3,.59,.11)); a = mix(vec3(l), a, 1.12); }
        c = mix(c, a, wb);
        float sn = smoothstep(uSnow-70., uSnow+140., e + (d1-.5)*260. + (d2-.5)*80.) * (1.-smoothstep(.45,.75,slope));
        c = mix(c, vec3(.80,.82,.86), sn);
        c *= mix(1., .65, uWet*(1.-sn));
        float ndl = max(dot(n, uSun), 0.);
        vec3 Lc = uSunC*ndl*sh + uAmb*(.6+.4*n.y)*1.8 + uSunC*.04*(1.-n.y);
        gl_FragColor = vec4(c*Lc, 1.);
      }` });
  scene.add(new THREE.Mesh(tg, terrainMat));

  // ---- percorso: punti ogni 10 m sul terreno
  const TOT = route.km[route.km.length - 1];
  const RS = 10, NR = Math.floor(TOT * 1000 / RS) + 1;
  const RE = new Float32Array(NR), RN = new Float32Array(NR), RL = new Float32Array(NR);
  for (let i = 0, j = 0; i < NR; i++) { const k = i * RS / 1000;
    while (j < route.km.length - 2 && route.km[j + 1] < k) j++;
    const f = clamp((k - route.km[j]) / (route.km[j + 1] - route.km[j] || 1), 0, 1);
    RE[i] = lerp(route.E[j], route.E[j + 1], f); RN[i] = lerp(route.N[j], route.N[j + 1], f); RL[i] = lerp(route.ele[j], route.ele[j + 1], f); }
  const routeMat = new THREE.ShaderMaterial({
    uniforms: { uProg: { value: 0 }, uTime: G.uTime, uNight: G.uNight, uAll: { value: 0 } },
    vertexShader: `varying float vU; void main(){ vU = uv.x; vec3 c = position - normal*7.;
      float d = length((modelMatrix*vec4(c,1.)).xyz - cameraPosition); vec3 p = c + normal*max(1.1, d*.0013) + vec3(0.,1.5,0.);
      gl_Position = projectionMatrix*modelViewMatrix*vec4(p,1.); }`,
    fragmentShader: `uniform float uProg, uTime, uNight, uAll; varying float vU;
      void main(){ float ahead = step(uProg, vU);
        if (ahead > .5 && uAll < .01) discard;
        float pulse = smoothstep(.02, 0., abs(fract(vU*8. - uTime*.06) - .5) - .47);
        vec3 c = vec3(1.9, .5, .04)*(1. + pulse*.6)*mix(1., .6, uNight);
        if (ahead > .5) c = vec3(.9,.85,.75)*.35*uAll;
        gl_FragColor = vec4(c, 1.); }` });
  let routeMesh = null;
  const buildRoute = () => {
    const pts = []; for (let i = 0; i < NR; i += 2) pts.push(new THREE.Vector3(RE[i], heightAt(RE[i], -RN[i]) + 4, -RN[i]));
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), isMobile ? 1600 : 3000, 7, 5, false);
    if (routeMesh) { routeMesh.geometry.dispose(); routeMesh.geometry = g; }
    else { routeMesh = new THREE.Mesh(g, routeMat); routeMesh.frustumCulled = false; scene.add(routeMesh); }
  };
  buildRoute();
  // segnaposto del corridore
  const runner = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)),
    new THREE.ShaderMaterial({ uniforms: { uPR: { value: 1 }, uTime: G.uTime, uOn: { value: 0 } }, transparent: true, depthTest: false, depthWrite: false,
      vertexShader: `uniform float uPR, uTime; void main(){ gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_PointSize = (26. + 6.*sin(uTime*3.))*uPR; }`,
      fragmentShader: `uniform float uOn; void main(){ float d = length(gl_PointCoord-.5)*2.;
        float core = smoothstep(.32, .22, d), ring = smoothstep(.06, 0., abs(d-.62))*.8, glow = exp(-d*d*4.)*.6;
        gl_FragColor = vec4(vec3(2.4,1.,.18)*(core*2.+glow) + vec3(1.6,1.2,.9)*ring, 1.)*uOn; }`,
      blending: THREE.AdditiveBlending }));
  runner.frustumCulled = false; runner.renderOrder = 10; scene.add(runner);

  // ---- luci dei paesi
  const PAESI = [[42.0925, 13.3647, 300, 380], [42.1050, 13.3330, 90, 220], [42.1080, 13.3940, 110, 240], [42.0950, 13.4100, 60, 180],
    [42.0630, 13.3380, 140, 330], [42.0680, 13.3780, 70, 200], [42.0310, 13.4260, 520, 1300], [42.1110, 13.4140, 40, 150]];
  const R2 = rng(7), lp = [], ls = [];
  for (const [la, lo, n, r] of PAESI) { const [x0, n0] = ll2en(la, lo);
    for (let i = 0; i < n; i++) { const a = R2() * 6.283, rr = Math.sqrt(R2()) * r; lp.push(x0 + Math.cos(a) * rr, 0, -(n0 + Math.sin(a) * rr)); ls.push(.6 + R2() * 1.4); } }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); lg.setAttribute('aS', new THREE.Float32BufferAttribute(ls, 1));
  const placeLights = () => { const a = lg.attributes.position.array; for (let i = 0; i < a.length; i += 3) a[i + 1] = heightAt(a[i], a[i + 2]) + 6; lg.attributes.position.needsUpdate = true; };
  placeLights();
  const lights = new THREE.Points(lg, new THREE.ShaderMaterial({
    uniforms: { uNight: G.uNight, uPR: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aS; uniform float uPR; varying float vA;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv;
        float s = aS*9000./-mv.z; vA = clamp(s/2.2, .25, 1.); gl_PointSize = clamp(s, 1.6, 7.)*uPR; }`,
    fragmentShader: `uniform float uNight; varying float vA;
      void main(){ vec2 q = gl_PointCoord-.5; float a = exp(-dot(q,q)*12.)*vA*uNight; gl_FragColor = vec4(vec3(1.6,1.05,.55)*a*2.2, 1.); }` }));
  lights.frustumCulled = false; scene.add(lights);

  // ---------------------------------------------------------------- nebbia, cielo, composizione
  let pr = Math.min(devicePixelRatio || 1, isMobile ? 1.5 : 1.75);
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: true, samples: 4 });
  rt.depthTexture = new THREE.DepthTexture(4, 4, THREE.FloatType);
  const rtW = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false }), rtB = rtW.clone();
  const HOLES = Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 1, 0));
  const U = { ...G,
    tCol: { value: rt.texture }, tDep: { value: rt.depthTexture }, tNoise: { value: tNoise }, tFog: { value: null }, tSrc: { value: null },
    uInvVP: { value: new THREE.Matrix4() }, uCam: { value: new THREE.Vector3() }, uHoles: { value: HOLES },
    uDeck: { value: 1 }, uOpen: { value: 0 }, uWisp: { value: 1 }, uD0: { value: 470 }, uD1: { value: 800 }, uCov: { value: .5 },
    uWind: { value: new THREE.Vector2() }, uRain: { value: 0 }, uSnowF: { value: 0 }, uHoleC: { value: new THREE.Vector2() },
    uNF: { value: new THREE.Vector2(8, 120000) }, uLow: { value: new THREE.Vector2(1, 1) }, uDir: { value: new THREE.Vector2() }, uRes: { value: new THREE.Vector2(1, 1) } };
  const COMMON = `
      precision highp sampler3D;
      uniform sampler2D tCol, tDep, tFog, tSrc; uniform sampler3D tNoise;
      uniform mat4 uInvVP; uniform vec3 uCam, uSun, uSunC, uSunDir, uMoonDir, uZen, uHor, uGlow, uAmb;
      uniform float uTime, uDeck, uOpen, uWisp, uD0, uD1, uCov, uNight, uOver, uHaze, uHigh, uMoonIll, uExpo, uRain, uSnowF;
      uniform vec4 uHoles[8]; uniform vec2 uHoleC, uNF, uLow, uDir, uWind, uRes; varying vec2 vUv;
      float h1(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
      float lz(float d){ return uNF.x*uNF.y/(uNF.y - d*(uNF.y-uNF.x)); }
      float N3(vec3 p, vec3 s){ return texture(tNoise, p*s).r; }
      vec3 sky(vec3 d){
        float h = max(d.y, 0.), sd = max(dot(d, uSunDir), 0.);
        vec3 c = mix(uHor, uZen, pow(h, .42));
        c += uGlow*pow(sd, 4.)*(1.-smoothstep(0.,.35,h));
        c += uSunC*step(0., uSunDir.y)*(pow(sd, 1400.)*30. + pow(sd, 60.)*.22 + pow(sd,8.)*.05)*(1.-uOver*.9);
        // stelle
        if (uNight > .01 && d.y > 0.){
          vec3 q = d*230.; vec3 i = floor(q); float r = h1(i.xy + i.z*7.1);
          float st = step(.985, r)*smoothstep(.35, 0., length(fract(q)-.5))*(.4+.6*h1(i.yz));
          c += vec3(.75,.8,1.)*st*uNight*(1.-uOver)*1.6*smoothstep(0.,.08,d.y);
        }
        // luna
        float md = dot(d, uMoonDir);
        if (uMoonDir.y > -.02){
          float disk = smoothstep(.99985, .99993, md);
          c += vec3(.9,.92,1.)*disk*(.25+uMoonIll*1.6)*(1.-uOver*.85)*mix(.4, 1., uNight)*4.;
          c += vec3(.25,.3,.4)*pow(max(md,0.), 300.)*uMoonIll*uNight*(1.-uOver*.6)*.6;
        }
        // nubi alte (velature)
        if (uHigh > .01 && d.y > .01){
          vec2 p = d.xz/d.y*900. + uWind*.3;
          float n = N3(vec3(p, uTime*4.), vec3(1./5200., 1./5200., 1./900.))*.7 + N3(vec3(p*2.3, uTime*6.), vec3(1./5200., 1./5200., 1./900.))*.3;
          float cv = smoothstep(1.-uHigh*.9, 1.15-uHigh*.75, n)*smoothstep(.01,.15,d.y);
          vec3 cl = uAmb*1.4 + uSunC*.18*(.4+.6*pow(sd,3.)) + uGlow*.5*pow(sd,2.);
          c = mix(c, cl, cv*.85);
        }
        return c;
      }
      float holes(vec3 p){ float k = 1.;
        for (int i=0;i<8;i++){ vec4 H = uHoles[i]; vec2 q = p.xz-H.xy; k *= 1. - H.w*exp(-dot(q,q)/(H.z*H.z)); }
        return k; }
      vec3 Wo(){ return vec3(uWind.x, 0., uWind.y); }
      float deckD(vec3 p){
        vec3 w = Wo();
        float big = N3(p+w, vec3(1./6800., 1./3000., 1./6800.));
        float mid = N3(p+w*1.4, vec3(1./2100., 1./900., 1./2100.));
        float h = (p.y - uD0)/(uD1 - uD0);
        float prof = smoothstep(0., .35 + (mid-.5)*.4, h) * (1. - smoothstep(.45 + (big-.5)*.5, 1., h));
        float t0 = mix(.78, .12, uCov);
        float cov = smoothstep(t0, t0 + .26, big*.75 + mid*.35);
        float R = uOpen*3000.;
        float r = length(p.xz - uHoleC) + (mid-.5)*1400.;
        float hole = uOpen > .001 ? smoothstep(R*.55, R*1.05, r) : 1.;
        return prof * cov * hole * .0042 * uDeck * holes(p);
      }
      const float W0 = 900., W1 = 2250.;
      float wispD(vec3 p){
        vec3 w = Wo()*1.3;
        float wn = N3(p+w, vec3(1./3000., 1./1200., 1./3000.));
        float m2 = N3(p+w*1.6, vec3(1./1100., 1./500., 1./1100.));
        float band = smoothstep(W0, W0+300., p.y) * (1.-smoothstep(W1-500., W1, p.y));
        return smoothstep(.6, .84, wn*.8 + m2*.25) * band * .0012 * uWisp * holes(p);
      }
      vec2 slab(float a, float b, float tMax, vec3 rd){
        float t0 = 0., t1 = tMax;
        if (abs(rd.y) > 1e-4){ float ta = (a-uCam.y)/rd.y, tb = (b-uCam.y)/rd.y; t0 = max(t0, min(ta,tb)); t1 = min(t1, max(ta,tb)); }
        else if (uCam.y < a || uCam.y > b) t1 = -1.;
        return vec2(t0, t1);
      }`;
  const fogMat = new THREE.ShaderMaterial({
    uniforms: U, defines: { DS: isMobile ? 14 : 22, WS: isMobile ? 10 : 14 }, depthTest: false, depthWrite: false, vertexShader: vsQuad,
    fragmentShader: COMMON + `
      float ign(vec2 p){ return fract(52.9829189*fract(dot(p, vec2(.06711056,.00583715)))); }
      void seg(vec2 r, int n, bool deck, vec3 rd, float jit, vec3 Ld, vec3 Lw, inout float T, inout vec3 S){
        if (r.y <= r.x || T < .02) return;
        float prev = r.x;
        for (int i=1; i<=32; i++){
          if (i > n) break;
          float f = (float(i) - jit)/float(n); float t = r.x + (r.y-r.x)*f*f; float dt = t-prev; prev = t;
          vec3 p = uCam + rd*t;
          float d = (deck ? deckD(p) : wispD(p)) * smoothstep(40., 320., t);
          if (d > 1e-7){
            vec3 L = deck ? Ld*mix(.55, 1., smoothstep(uD0, uD1, p.y)) : Lw;
            L = mix(L, sky(normalize(vec3(rd.x, max(rd.y,.02), rd.z)))*.9, 1.-exp(-t/26000.));
            float tr = exp(-d*dt); S += T*(1.-tr)*L; T *= tr; if (T < .02) break;
          }
        }
      }
      void main(){
        float dz = texture2D(tDep, vUv).r;
        vec4 wp = uInvVP * vec4(vUv*2.-1., dz*2.-1., 1.); wp /= wp.w;
        vec3 rd = normalize(wp.xyz - uCam);
        float dist = dz >= .99999 ? 60000. : length(wp.xyz - uCam);
        float tMax = min(dist, 26000.);
        float jit = ign(gl_FragCoord.xy);
        float ph = .5 + 1.9*pow(max(dot(rd, uSun), 0.), 6.);
        vec3 Ld = uSunC*ph*.40 + uAmb*2.1, Lw = uSunC*ph*.42 + uAmb*2.;
        vec2 rD = slab(uD0, uD1, tMax, rd), rW = slab(W0, W1, tMax, rd);
        float T = 1.; vec3 S = vec3(0.);
        if (rD.x < rW.x){ seg(rD, DS, true, rd, jit, Ld, Lw, T, S); seg(rW, WS, false, rd, jit, Ld, Lw, T, S); }
        else { seg(rW, WS, false, rd, jit, Ld, Lw, T, S); seg(rD, DS, true, rd, jit, Ld, Lw, T, S); }
        gl_FragColor = vec4(S, T);
      }`
  });
  const blurMat = new THREE.ShaderMaterial({
    uniforms: U, depthTest: false, depthWrite: false, vertexShader: vsQuad,
    fragmentShader: COMMON + `
      void main(){
        float z0 = lz(texture2D(tDep, vUv).r);
        vec4 acc = vec4(0.); float ws = 0.;
        for (int i=-4;i<=4;i++){
          vec2 u = vUv + uDir*float(i);
          float z = lz(texture2D(tDep, u).r);
          float w = exp(-float(i*i)/9.) * exp(-abs(z - z0)/(z0*.06 + 40.));
          acc += texture2D(tSrc, u)*w; ws += w;
        }
        gl_FragColor = acc/ws; }`
  });
  const post = new THREE.ShaderMaterial({
    uniforms: U, depthTest: false, depthWrite: false, vertexShader: vsQuad,
    fragmentShader: COMMON + `
      vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14), 0., 1.); }
      vec4 fogUp(float z0){
        vec2 p = vUv*uLow - .5, i = floor(p), f = p - i;
        vec4 acc = vec4(0.); float ws = 0.;
        for (int k=0;k<4;k++){
          vec2 o = vec2(float(k-(k/2)*2), float(k/2));
          vec2 u = (i + o + .5)/uLow;
          float z = lz(texture2D(tDep, u).r);
          float wb = (o.x > .5 ? f.x : 1.-f.x)*(o.y > .5 ? f.y : 1.-f.y);
          float w = wb*exp(-abs(z - z0)/(z0*.05 + 30.)) + 1e-4*wb;
          acc += texture2D(tFog, u)*w; ws += w;
        }
        return acc/ws;
      }
      float rainL(vec2 p, float t){ float a = 0.;
        for (int i=0;i<3;i++){ float s = 1. + float(i)*.7;
          vec2 q = p*vec2(70.*s, 2.2*s) + vec2(0., t*(7. + 3.*float(i))); q.x += q.y*.06;
          vec2 id = floor(q), f = fract(q); float r = h1(id + float(i)*17.);
          a += step(.9, r)*smoothstep(0., .35, f.y)*smoothstep(1., .55, f.y)*smoothstep(.5, 0., abs(f.x-.5)*5.)*(.55/s); }
        return a; }
      float snowL(vec2 p, float t){ float a = 0.;
        for (int i=0;i<3;i++){ float s = 7. + float(i)*6.;
          vec2 q = p*s + vec2(sin(t*.35 + float(i)*2.)*.6, t*(.55 + .25*float(i)));
          vec2 id = floor(q), f = fract(q) - .5; vec2 o = vec2(h1(id) - .5, h1(id + 3.1) - .5)*.6;
          a += step(.5, h1(id + 7.7))*smoothstep(.07/(1. + float(i)*.5), 0., length(f - o))*(1. - float(i)*.25); }
        return a; }
      void main(){
        float dz = texture2D(tDep, vUv).r;
        vec4 wp = uInvVP * vec4(vUv*2.-1., dz*2.-1., 1.); wp /= wp.w;
        vec3 rd = normalize(wp.xyz - uCam);
        bool isSky = dz >= .99999;
        float dist = isSky ? 60000. : length(wp.xyz - uCam);
        vec3 col = isSky ? sky(rd) : texture2D(tCol, vUv).rgb;
        if (!isSky){
          float b = 1./1700., a = uHaze;
          float ry = abs(rd.y) < 1e-4 ? 1e-4 : rd.y;
          float fi = a*exp(-b*(uCam.y+150.)) * (1.-exp(-b*ry*dist)) / (b*ry);
          col = mix(col, sky(normalize(vec3(rd.x, max(rd.y, .015), rd.z)))*.92, 1.-exp(-fi));
        } else {
          col += texture2D(tCol, vUv).rgb;   // luci additive non scrivono profondità
        }
        vec4 fg = fogUp(lz(dz));
        col = col*fg.a + fg.rgb;
        vec2 sp = gl_FragCoord.xy/uRes.y;
        col += (uAmb*6. + vec3(.08))*rainL(sp, uTime)*uRain*.5;
        col += (uAmb*8. + uSunC*.08 + vec3(.12))*snowL(sp, uTime)*uSnowF*.8;
        col *= uExpo;
        col = aces(col);
        col = pow(col, vec3(1./2.2));
        col = mix(col, col*col*(3.-2.*col), .22);
        float lum = dot(col, vec3(.299,.587,.114));
        col = mix(col, col*vec3(.92,1.02,1.0), (1.-lum)*.35);
        vec2 q = vUv - .5; col *= 1. - dot(q,q)*.55;
        gl_FragColor = vec4(col, 1.);
      }`
  });

  const fsScene = new THREE.Scene();
  const fsQuad = new THREE.Mesh(quadGeo, fogMat); fsQuad.frustumCulled = false; fsScene.add(fsQuad);

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
    const W = Math.floor(w * pr), H = Math.floor(h * pr);
    rt.setSize(W, H);
    const hw = Math.max(2, Math.ceil(W / 2)), hh = Math.max(2, Math.ceil(H / 2));
    rtW.setSize(hw, hh); rtB.setSize(hw, hh);
    U.uLow.value.set(hw, hh); U.uRes.value.set(W, H);
    lights.material.uniforms.uPR.value = pr; runner.material.uniforms.uPR.value = pr;
    cam.aspect = w / h; cam.updateProjectionMatrix();
  }
  resize(); addEventListener('resize', resize);

  // ---------------------------------------------------------------- luce e meteo
  let meteo = null, scen = null, simKey = null, simMin = null;
  const stato = {};
  async function caricaMeteo() {
    if (simKey) return;
    try { meteo = await meteoDalVivo(); } catch (e) { meteo = { fonte: 'nd', ...SCENARI.sereno, errore: e.message }; }
    scen = interpreta(meteo); applicaMeteo(); notifica();
  }
  function applicaMeteo() {
    if (!scen) return;
    U.uD0.value = yOf(scen.deck0); U.uD1.value = yOf(scen.deck1); U.uCov.value = scen.cop;
    G.uHaze.value = scen.haze; G.uSnow.value = scen.snowLine; G.uWet.value = scen.wet; G.uHigh.value = clamp(Math.max(scen.high, scen.mid * .8), 0, 1);
    U.uRain.value = reduce ? 0 : scen.rain; U.uSnowF.value = reduce ? 0 : scen.snowFall;
  }
  function dataOra() {
    if (simMin == null) return new Date();
    const d = new Date(), rome = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Rome' })), off = d.getTime() - rome.getTime();
    rome.setHours(0, 0, 0, 0); return new Date(rome.getTime() + simMin * 60000 + off);
  }
  const C = (r, g, b) => new THREE.Vector3(r, g, b);
  const SKY = [[-18, C(.0012, .0025, .007), C(.004, .007, .016), C(0, 0, 0)], [-9, C(.003, .007, .02), C(.02, .025, .05), C(.03, .015, .02)],
    [-3, C(.012, .025, .07), C(.30, .20, .22), C(.6, .25, .12)], [2, C(.025, .06, .17), C(.62, .50, .42), C(1.6, .7, .3)],
    [10, C(.03, .08, .24), C(.58, .62, .66), C(1.2, .72, .4)], [30, C(.04, .12, .36), C(.50, .61, .76), C(.4, .3, .2)]];
  function skyAt(alt) { let i = 0; while (i < SKY.length - 2 && alt > SKY[i + 1][0]) i++;
    const a = SKY[i], b = SKY[i + 1], f = sstep(a[0], b[0], alt); return [a[1].clone().lerp(b[1], f), a[2].clone().lerp(b[2], f), a[3].clone().lerp(b[3], f)]; }
  function aggiornaCielo() {
    const now = dataOra(), s = sunPos(now), m = moonPos(now, s.lon), sa = s.alt / RAD, ov = scen ? scen.overcast : 0;
    G.uSunDir.value.copy(dirOf(s.az, s.alt)); G.uMoonDir.value.copy(dirOf(m.az, m.alt)); G.uMoonIll.value = m.illum;
    const [zen, hor, glow] = skyAt(sa);
    const gl = (zen.x + zen.y + zen.z + hor.x + hor.y + hor.z) / 6;
    zen.lerp(C(gl, gl, gl * 1.05).multiplyScalar(.9), ov * .85); hor.lerp(C(gl, gl, gl * 1.04).multiplyScalar(1.05), ov * .85); glow.multiplyScalar(1 - ov * .8);
    G.uZen.value.copy(zen); G.uHor.value.copy(hor); G.uGlow.value.copy(glow);
    const night = 1 - sstep(-10, -2, sa); G.uNight.value = night; G.uOver.value = ov;
    if (sa > -3) { const t = sstep(0, 28, sa), k = sstep(-3, 3, sa) * (1 - ov * .82);
      G.uSun.value.copy(dirOf(s.az, Math.max(s.alt, 1.2 * RAD))); G.uSunC.value.copy(C(5.6, 2.3, .8).lerp(C(5.4, 4.6, 3.8), Math.pow(t, .6)).multiplyScalar(k)); }
    else { const k = sstep(-1, 12, m.alt / RAD) * (.25 + m.illum) * (1 - ov * .9) * night;
      G.uSun.value.copy(dirOf(m.az, Math.max(m.alt, 1.5 * RAD))); G.uSunC.value.copy(C(.16, .2, .28).multiplyScalar(k)); }
    G.uAmb.value.copy(hor.clone().multiplyScalar(.3).add(zen.clone().multiplyScalar(.7)).multiplyScalar(.75 + ov * .5));
    G.uExpo.value = lerp(.66, 2.6, night) * (1 + ov * .15);
    stato.sole = s; stato.luna = m; stato.ora = now;
    updateShadows(false);
  }
  const notifica = () => onMeteo({ scen, meteo, simKey, simMin, ora: stato.ora, sole: stato.sole, luna: stato.luna, dati: datiStato });
  caricaMeteo(); setInterval(caricaMeteo, 15 * 60000);
  aggiornaCielo(); updateShadows(true);
  setInterval(() => { aggiornaCielo(); notifica(); }, 30000);

  // ---------------------------------------------------------------- binario della camera lungo il percorso
  const RAIL = 0.02, NRL = Math.floor(TOT / RAIL) + 1;
  let railC = null, railT = null, railF = null;
  const gauss1 = (a, sig, comp = 1) => { const n = a.length / comp, out = new Float32Array(a.length), r = Math.ceil(sig * 2.5), w = [];
    for (let k = -r; k <= r; k++) w.push(Math.exp(-k * k / (2 * sig * sig)));
    for (let i = 0; i < n; i++) for (let c = 0; c < comp; c++) { let s = 0, ws = 0;
      for (let k = -r; k <= r; k++) { const j = clamp(i + k, 0, n - 1); s += a[j * comp + c] * w[k + r]; ws += w[k + r]; } out[i * comp + c] = s / ws; }
    return out; };
  function buildRail() {
    const P = new Float32Array(NR * 3); for (let i = 0; i < NR; i++) { P[i * 3] = RE[i]; P[i * 3 + 1] = heightAt(RE[i], -RN[i]) + 4; P[i * 3 + 2] = -RN[i]; }
    const S = gauss1(P, 25, 3), Lsm = gauss1(RL, 40);
    const C = new Float32Array(NRL * 3), T = new Float32Array(NRL * 3), F = new Float32Array(NRL), SIDE = new Float32Array(NRL), FW = new Float32Array(NRL * 2);
    for (let j = 0; j < NRL; j++) { const i = Math.min(NR - 1, Math.round(j * RAIL * 1000 / RS));
      const a = Math.max(0, i - 40), b = Math.min(NR - 1, i + 40);
      FW[j * 2] = S[b * 3] - S[a * 3]; FW[j * 2 + 1] = S[b * 3 + 2] - S[a * 3 + 2]; }
    const FWs = gauss1(FW, 30, 2);
    for (let j = 0; j < NRL; j++) { const i = Math.min(NR - 1, Math.round(j * RAIL * 1000 / RS));
      let fx = FWs[j * 2], fz = FWs[j * 2 + 1]; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
      const rx = -fz, rz = fx, sx = S[i * 3], sz = S[i * 3 + 2];
      const hl = heightAt(sx - rx * 600, sz - rz * 600), hr = heightAt(sx + rx * 600, sz + rz * 600);
      SIDE[j] = clamp((hl - hr) / 250, -1, 1); FW[j * 2] = fx; FW[j * 2 + 1] = fz; }
    const SIDEs = gauss1(SIDE, 50);
    for (let j = 0; j < NRL; j++) { const i = Math.min(NR - 1, Math.round(j * RAIL * 1000 / RS));
      const ele = Lsm[i], k = j * RAIL;
      let o = sstep(800, 2000, ele); o = Math.max(o, sstep(0, 3, k) * .12, sstep(TOT, TOT - 3, k) * .12);
      F[j] = o;
      const back = lerp(320, 1900, o), up = lerp(140, 820, o), side = lerp(90, 700, o) * (Math.abs(SIDEs[j]) < .25 ? Math.sign(SIDEs[j] || 1) * .25 : SIDEs[j]);
      const fx = FW[j * 2], fz = FW[j * 2 + 1], rx = -fz, rz = fx;
      let cx = S[i * 3] - fx * back + rx * side, cz = S[i * 3 + 2] - fz * back + rz * side, cy = S[i * 3 + 1] + up;
      C[j * 3] = cx; C[j * 3 + 1] = cy; C[j * 3 + 2] = cz;
      const la = Math.min(NR - 1, i + Math.round(lerp(30, 130, o)));
      T[j * 3] = lerp(P[i * 3], S[la * 3], .55); T[j * 3 + 1] = lerp(P[i * 3 + 1], S[la * 3 + 1], .55) + lerp(5, 90, o); T[j * 3 + 2] = lerp(P[i * 3 + 2], S[la * 3 + 2], .55);
    }
    const clear = (Cc) => { for (let j = 0; j < NRL; j++) { const i = Math.min(NR - 1, Math.round(j * RAIL * 1000 / RS));
      let cx = Cc[j * 3], cy = Cc[j * 3 + 1], cz = Cc[j * 3 + 2]; const px = P[i * 3], py = P[i * 3 + 1] + 6, pz = P[i * 3 + 2];
      cy = Math.max(cy, heightAt(cx, cz) + 55);
      for (let it = 0; it < 3; it++) for (let s = 1; s < 10; s++) { const t = s / 10, x = lerp(cx, px, t), z = lerp(cz, pz, t), y = lerp(cy, py, t), req = heightAt(x, z) + 18;
        if (y < req) cy += (req - y) / (1 - t); }
      Cc[j * 3 + 1] = cy; } return Cc; };
    railC = clear(gauss1(clear(C), 9, 3)); railT = gauss1(T, 9, 3); railF = F;
  }
  buildRail();
  const railAt = (k, out) => { const f = clamp(k / RAIL, 0, NRL - 1.001), i = f | 0, t = f - i;
    out.c.set(lerp(railC[i * 3], railC[i * 3 + 3], t), lerp(railC[i * 3 + 1], railC[i * 3 + 4], t), lerp(railC[i * 3 + 2], railC[i * 3 + 5], t));
    out.t.set(lerp(railT[i * 3], railT[i * 3 + 3], t), lerp(railT[i * 3 + 1], railT[i * 3 + 4], t), lerp(railT[i * 3 + 2], railT[i * 3 + 5], t));
    out.fov = lerp(50, 40, railF[i]); return out; };
  const pointAtKm = k => { const i = clamp(Math.round(k * 1000 / RS), 0, NR - 1); return [RE[i], RN[i], RL[i]]; };

  // pose fisse: apertura (le tre vette sopra le nuvole) e finale (tutto l'anello)
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const pk = n => { const q = route.peaks.find(r => r[0] === n); return q ? V(q[2], heightAt(q[2], -q[3]), -q[3]) : V(0, 1800, 0); };
  const sph = (t, az, el, d) => V(t.x + Math.sin(az) * Math.cos(el) * d, t.y + Math.sin(el) * d, t.z + Math.cos(az) * Math.cos(el) * d);
  let INTRO, FINAL;
  const buildPoses = () => {
    const vel = pk('Monte Velino'), tI = vel.clone().add(V(250, -420, 0));
    INTRO = { c: sph(tI, -.62, .0, 11500), t: tI, fov: 27 };
    let mx = 0, mz = 0; for (let i = 0; i < NR; i++) { mx += RE[i]; mz -= RN[i]; } mx /= NR; mz /= NR;
    const tF = V(mx, heightAt(mx, mz) + 200, mz); FINAL = { c: sph(tF, .35, .85, 17000), t: tF, fov: 36 };
  };
  buildPoses();

  // ---- scroll: apertura → percorso km per km → finale
  const [selIntro, selStart, selEnd] = ancore;
  const elI = document.querySelector(selIntro), elS = document.querySelector(selStart), elE = document.querySelector(selEnd);
  let A0 = 0, A1 = 1, A2 = 2, A3 = 3;
  const top = el => el ? el.getBoundingClientRect().top + scrollY : 0;
  const measure = () => { const vh = innerHeight; A0 = top(elI) + (elI ? elI.offsetHeight * .5 : vh * .5);
    A1 = Math.max(A0 + vh * .6, top(elS) + vh * .15); A2 = Math.max(A1 + vh, top(elE));
    A3 = Math.max(A2 + vh * .6, document.documentElement.scrollHeight - vh * .5); };
  measure(); addEventListener('resize', measure); addEventListener('load', measure); setInterval(measure, 2000);
  // u: 0 apertura, 1 km 0, 1+TOT/… : uso una scala unica in "unità di percorso"
  const uTarget = () => { const y = scrollY + innerHeight / 2;
    if (y <= A0) return 0; if (y < A1) return (y - A0) / (A1 - A0);
    if (y < A2) return 1 + (y - A1) / (A2 - A1); return 2 + clamp((y - A2) / (A3 - A2), 0, 1); };
  const ease = t => t * t * (3 - 2 * t);
  const tmpA = { c: V(0, 0, 0), t: V(0, 0, 0), fov: 40 }, tmpB = { c: V(0, 0, 0), t: V(0, 0, 0), fov: 40 };
  function pose(u, out) {
    if (u <= 1) { railAt(0, tmpB); const f = ease(u);
      out.c.copy(INTRO.c).lerp(tmpB.c, f); out.t.copy(INTRO.t).lerp(tmpB.t, f); out.fov = lerp(INTRO.fov, tmpB.fov, f);
      // tuffo: la camera resta alta finché non è sopra il paese
      out.c.y = lerp(out.c.y, Math.max(out.c.y, tmpB.c.y + 1600 * (1 - f)), 1 - f);
      return { km: 0, prog: 0, all: 0, run: sstep(.75, 1, u) }; }
    if (u <= 2) { const k = (u - 1) * TOT; railAt(k, out); return { km: k, prog: k / TOT, all: 0, run: 1 }; }
    railAt(TOT, tmpA); const f = ease(u - 2);
    out.c.copy(tmpA.c).lerp(FINAL.c, f); out.t.copy(tmpA.t).lerp(FINAL.t, f); out.fov = lerp(tmpA.fov, FINAL.fov, f);
    return { km: TOT, prog: 1, all: f, run: 1 - sstep(0, .3, f) };
  }

  // ---------------------------------------------------------------- interazione
  let mx = 0, my = 0, tmx = 0, tmy = 0, hi = 0, lastHole = 0, lastInput = performance.now();
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  addEventListener('pointermove', e => { lastInput = performance.now(); tmx = e.clientX / innerWidth * 2 - 1; tmy = e.clientY / innerHeight * 2 - 1;
    const now = performance.now(); if (now - lastHole < 70) return; lastHole = now;
    ndc.set(tmx, -tmy); ray.setFromCamera(ndc, cam); const o = ray.ray.origin, d = ray.ray.direction;
    for (const yy of [(U.uD0.value + U.uD1.value) / 2, 1500]) { if (Math.abs(d.y) < 1e-4) continue; const t = (yy - o.y) / d.y;
      if (t > 0 && t < 40000) { const p = o.clone().addScaledVector(d, t), H = HOLES[hi++ % HOLES.length];
        H.set(p.x, p.z, Math.max(200, cam.position.distanceTo(p) * .07), 1); H.born = now; break; } } }, { passive: true });
  addEventListener('scroll', () => { lastInput = performance.now(); }, { passive: true });

  const datiStato = { quote: 'Tinitaly 10 m', foto: 'PCN' };

  // ---------------------------------------------------------------- ciclo
  let uCur = uTarget(), last = performance.now(), acc = 0, nAcc = 0, frame = 0, windX = 0, windZ = 0, hudKm = -1;
  const P0 = { c: V(0, 0, 0), t: V(0, 0, 0), fov: 40 }, ivp = new THREE.Matrix4(), up = V(0, 1, 0), tmpV = V(0, 0, 0);
  function tick(now) {
    requestAnimationFrame(tick);
    const idle = now - lastInput > 2500; if (idle && (frame++ & 1)) return;
    const dt = Math.min(.1, (now - last) / 1000); last = now;
    uCur += (uTarget() - uCur) * (1 - Math.exp(-dt * (reduce ? 20 : 2.6)));
    const info = pose(uCur, P0);
    mx += (tmx - mx) * (1 - Math.exp(-dt * 2)); my += (tmy - my) * (1 - Math.exp(-dt * 2));
    // parallasse leggera attorno al punto guardato
    tmpV.copy(P0.c).sub(P0.t); const dist = tmpV.length(); const side = V(-tmpV.z, 0, tmpV.x).normalize();
    cam.position.copy(P0.c).addScaledVector(side, mx * dist * .035).addScaledVector(up, -my * dist * .02);
    const g = heightAt(cam.position.x, cam.position.z) + 40; if (cam.position.y < g) cam.position.y = g;
    cam.fov = P0.fov;
    const vw = innerWidth, vh = innerHeight;
    if (vw > 700) cam.setViewOffset(vw, vh, -.06 * vw * (1 - clamp(uCur, 0, 1)), 0, vw, vh); else cam.setViewOffset(vw, vh, 0, vh * .1, vw, vh);
    cam.lookAt(P0.t); cam.updateMatrixWorld();
    const time = reduce ? 0 : now / 1000;
    routeMat.uniforms.uProg.value = info.prog; routeMat.uniforms.uAll.value = info.all;
    const [rx, rn] = pointAtKm(info.km); runner.geometry.attributes.position.setXYZ(0, rx, heightAt(rx, -rn) + 14, -rn); runner.geometry.attributes.position.needsUpdate = true;
    runner.material.uniforms.uOn.value = info.run;
    if (scen && !reduce) { const wd = (scen.windDir + 180) * RAD, ws = clamp(scen.windKmh, 2, 60) / 3.6 * 6;
      windX -= Math.sin(wd) * ws * dt; windZ += Math.cos(wd) * ws * dt; U.uWind.value.set(windX, windZ); }
    G.uTime.value = time; U.uDeck.value = scen ? clamp(scen.cop * 1.4, 0, 1) : 1; U.uWisp.value = scen ? lerp(.15, 1.2, scen.wisp) : 1;
    U.uCam.value.copy(cam.position); ivp.multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse); U.uInvVP.value.copy(ivp);
    for (const H of HOLES) if (H.w > 0) H.w = Math.max(0, Math.exp(-(now - H.born) / 2600) - .02);
    renderer.setRenderTarget(rt); renderer.render(scene, cam);
    fsQuad.material = fogMat; renderer.setRenderTarget(rtW); renderer.render(fsScene, ocam);
    fsQuad.material = blurMat; const lw = U.uLow.value;
    for (const [src, dst, dx, dy] of [[rtW, rtB, 1 / lw.x, 0], [rtB, rtW, 0, 1 / lw.y]]) { U.tSrc.value = src.texture; U.uDir.value.set(dx, dy); renderer.setRenderTarget(dst); renderer.render(fsScene, ocam); }
    U.tFog.value = rtW.texture; fsQuad.material = post; renderer.setRenderTarget(null); renderer.render(fsScene, ocam);
    // indicatore km / quota / zona
    const kmR = Math.round(info.km * 10) / 10, phase = uCur < .85 ? 'intro' : uCur > 2.15 ? 'fine' : 'via';
    if (kmR !== hudKm || phase !== onHud._p) { hudKm = kmR; onHud._p = phase;
      const z = route.zones.find(z => info.km >= z[0] && info.km < z[1]) || route.zones[route.zones.length - 1];
      const tr = route.trails.find(t => info.km >= t[0] && info.km < t[1]) || route.trails[route.trails.length - 1];
      onHud({ phase, km: info.km, tot: TOT, ele: pointAtKm(info.km)[2], zona: z && z[2], descr: z && z[3], sentiero: tr && tr[2] }); }
    acc += dt; nAcc++;
    if (nAcc === 50) { const avg = acc / nAcc; acc = 0; nAcc = 0; if (!idle && avg > .03 && pr > .75) { pr = Math.max(.75, pr * .82); resize(); } }
  }
  onProgress(1);
  requestAnimationFrame(tick);

  return {
    simula(key) { simKey = key || null; if (simKey) { meteo = { fonte: 'sim', ...SCENARI[simKey] }; scen = interpreta(meteo); applicaMeteo(); aggiornaCielo(); notifica(); } else caricaMeteo().then(() => { aggiornaCielo(); notifica(); }); },
    ora(min) { simMin = (min == null) ? null : min; aggiornaCielo(); notifica(); },
    stato: () => ({ scen, meteo, simKey, simMin, ora: stato.ora, sole: stato.sole, luna: stato.luna, dati: datiStato })
  };
}
