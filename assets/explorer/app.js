// SRM Explorer — Skyrace del Maglio 2026
// Percorso 3D navigabile. Dati: export Blender del progetto reel (route.json, scene.glb, lino.glb)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const VER = 'v71';

// ---------- nebbia "d'altura": densa nelle valli, aria pulita in cresta ----------
// Si sostituiscono i chunk della nebbia di three prima che qualunque materiale compili:
// la distanza efficace si allunga con la quota media fra camera e punto (fino a x1,8),
// ma oltre fogFar la nebbia e' comunque piena (serve a nascondere i confini del mondo).
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n varying float vFogDepth;\n varying float vFogY;\n#endif';
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n vFogDepth = - mvPosition.z;\n' +
  ' #ifdef USE_INSTANCING\n  vFogY = ( modelMatrix * instanceMatrix * vec4( position, 1.0 ) ).y;\n' +
  ' #else\n  vFogY = ( modelMatrix * vec4( position, 1.0 ) ).y;\n #endif\n#endif';
THREE.ShaderChunk.fog_pars_fragment = '#ifdef USE_FOG\n uniform vec3 fogColor;\n varying float vFogDepth;\n varying float vFogY;\n' +
  ' #ifdef FOG_EXP2\n  uniform float fogDensity;\n #else\n  uniform float fogNear;\n  uniform float fogFar;\n #endif\n#endif';
THREE.ShaderChunk.fog_fragment = '#ifdef USE_FOG\n' +
  ' float yAvg = 0.5 * ( cameraPosition.y + vFogY );\n' +
  ' float hA = clamp( ( yAvg - 500.0 ) / 1400.0, 0.0, 1.0 );\n' +
  ' float dEff = vFogDepth * mix( 1.0, 0.55, hA );\n' +
  ' #ifdef FOG_EXP2\n  float fogFactor = 1.0 - exp( - fogDensity * fogDensity * dEff * dEff );\n' +
  ' #else\n  float fogFactor = max( smoothstep( fogNear, fogFar, dEff ), smoothstep( fogFar * 0.85, fogFar * 1.1, vFogDepth ) );\n #endif\n' +
  ' gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );\n#endif';
let LOADT0 = 0;
let cumDP = null;
const $ = id => document.getElementById(id);
const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;

// ---------- stato ----------
const st = {
  s: 60,            // ascissa curvilinea in metri
  sTarget: null,    // teletrasporto dolce (click sul profilo)
  dir: 0, speed: 0, lastDir: 1, hold: 0, view: 'follow', follow: true, ready: false,
  keys: new Set(), lastHudS: -1, curZone: -1, curPoi: -1
};
const VMAX = 175, ACC = 240, VTELE = 3600;
let route, N, TOT, renderer, scene, camera, controls, clock;
let lino, mixer, action, grifTpl, grifs = [], pinGroup;
let elevSamp = [], profCv, profCtx, miniCv, miniCtx, miniPath;
const camTgt = new THREE.Vector3(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(),
      tmpC = new THREE.Vector3(), tmpD = new THREE.Vector3();

// ---------- avvio ----------
function fail(msg){ $('loader').style.display = 'none'; $('err').style.display = 'flex';
  $('errmsg').textContent = msg; }
window.addEventListener('error', e => { if (!st.ready) fail('Errore: ' + (e.message || e.type)); });
const prog = f => { $('load-bar').style.width = Math.round(f * 100) + '%'; };

window._loaderShow = loaderShow;
function loaderShow(){
  LOADT0 = performance.now();
  const box = $('spinbox'); if (!box) return;
  const img = new Image();
  let timer = null, chipT = null;
  fetch('assets/lino_giro.json?' + VER).then(r => r.ok ? r.json() : null).then(m => {
    if (!m) return;
    img.onload = () => {
      const el = $('spin-img'), W = 240, H = 320;
      el.style.display = 'block';
      el.style.backgroundImage = 'url(' + img.src + ')';
      el.style.backgroundSize = (m.cols * W) + 'px ' + (Math.ceil(m.n / m.cols) * H) + 'px';
      let frame = 0;
      timer = setInterval(() => {
        frame = (frame + 1) % m.n;
        el.style.backgroundPosition = (-(frame % m.cols) * W) + 'px ' + (-Math.floor(frame / m.cols) * H) + 'px';
      }, 80);
      const tags = [
        ['FACCIA DA SINDACO', 'ricorda qualcuno', 0.50, 0.13, 1],
        ['FISICO ATLETICO', 'o quasi', 0.44, 0.40, -1],
        ['SCARPE TECNICHE', 'collaudate sul brecciato', 0.52, 0.90, 1],
        ['MATERIALE OBBLIGATORIO', 'occhio che lo controlliamo', 0.64, 0.56, 1],
        ['GAMBE DA 2.109 M D+', 'garanzia 29,7 km', 0.44, 0.73, -1],
        ['SGUARDO FISSO SUL VELINO', 'o sul primo ristoro?', 0.54, 0.16, -1],
        ['ZAINO LEGGERO', 'con tanta acqua e sali', 0.40, 0.35, 1],
      ];
      let ti = Math.floor(Math.random() * tags.length);
      const chip = $('spin-chip'), svg = $('spin-svg');
      const show = () => {
        const t = tags[ti]; ti = (ti + 1) % tags.length;
        const bw = box.clientWidth, bh = box.clientHeight;
        const ix = bw / 2 - W / 2;
        const ax = ix + t[2] * W, ay = t[3] * H;
        chip.innerHTML = '<b>' + t[0] + '</b><br>' + t[1];
        chip.style.opacity = 0;
        chip.style.left = ''; chip.style.right = '';
        if (t[4] > 0) chip.style.right = '0px'; else chip.style.left = '0px';
        chip.style.top = Math.max(0, Math.min(bh - 64, ay - 26)) + 'px';
        requestAnimationFrame(() => {
          chip.style.opacity = 1;
          const cr = chip.getBoundingClientRect(), br = box.getBoundingClientRect();
          if (br.width < 4) return;
          const cx2 = t[4] > 0 ? (cr.left - br.left - 3) : (cr.right - br.left + 3);
          const cy2 = cr.top - br.top + cr.height / 2;
          svg.setAttribute('viewBox', '0 0 ' + bw + ' ' + bh);
          // la linea si ferma PRIMA di Lino e finisce con una punta di
          // freccia (un po' irregolare) che indica il punto senza coprirlo
          const dx = ax - cx2, dy = ay - cy2, dl = Math.hypot(dx, dy) || 1;
          const G = Math.min(30, dl * 0.4);
          const ux = dx / dl, uy = dy / dl, px = -uy, py = ux;
          const tx = ax - ux * G, ty = ay - uy * G;          // punta
          const ex = tx - ux * 9, ey = ty - uy * 9;          // fine linea
          const p1x = tx - ux * 11.5 + px * 5.2, p1y = ty - uy * 11.5 + py * 5.2;
          const p2x = tx - ux * 8.5 - px * 4.0, p2y = ty - uy * 8.5 - py * 4.0;
          svg.innerHTML = '<line x1="' + cx2 + '" y1="' + cy2 + '" x2="' + ex.toFixed(1) + '" y2="' + ey.toFixed(1) +
            '" stroke="#f4951f" stroke-width="2.2" opacity="0.92"/>' +
            '<polygon points="' + tx.toFixed(1) + ',' + ty.toFixed(1) + ' ' + p1x.toFixed(1) + ',' + p1y.toFixed(1) +
            ' ' + p2x.toFixed(1) + ',' + p2y.toFixed(1) + '" fill="#f4951f" opacity="0.95"/>';
        });
      };
      show();
      chipT = setInterval(show, 2600);
    };
    img.src = 'assets/lino_giro.webp?' + VER;
  }).catch(() => {});
  window._loaderStop = () => {
    if (timer) clearInterval(timer);
    if (chipT) clearInterval(chipT);
  };
}

boot().catch(e => { console.error(e); fail(e.message || String(e)); });

async function boot(){
  if (!window.WebGLRenderingContext) { fail('WebGL non disponibile su questo dispositivo.'); return; }
  $('load-step').textContent = 'dati del percorso…';
  loaderShow();
  const rr = await fetch('assets/route.json?' + VER);
  if (!rr.ok) throw new Error('route.json non trovato (' + rr.status + ')');
  route = await rr.json();
  N = route.n; TOT = route.total_km * 1000;
  cumDP = new Float32Array(N);
  { let acc = 0;
    for (let i = 1; i < N; i++) {
      const dz = route.elev ? (route.elev[i] - route.elev[i - 1]) : (route.z[i] - route.z[i - 1]) * route.elev_a;
      if (dz > 0) acc += dz; cumDP[i] = acc; } }
  prog(0.06);
  $('load-step').textContent = 'ortofoto e altimetria\u2026';
  await Promise.all([loadOrtho(), loadHeights(), loadExt()]);
  prog(0.12);
  buildStage();
  buildSky();
  const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  $('load-step').textContent = 'montagne, sentiero, paesi…';
  const world = await loadGLB(loader, 'assets/scene.glb?' + VER, p => prog(0.06 + 0.58 * p));
  prepWorld(world.scene);
  scene.add(world.scene);
  try { buildTrailHeights(); } catch (e) { console.warn('quote nastro:', e); }
  loadVeg(loader).catch(e => console.warn('vegetazione:', e));
  try {
    const lupoSrc = world.scene.getObjectByName('Lupo_Pratoni');
    if (lupoSrc) {
      const l2 = lupoSrc.clone();
      posAt(21650, tmpA); tanAt(21650, tmpB);
      const distNastro = (x, z) => {
        let dm = 1e9;
        for (let i = 0; i < N; i += 2) {
          const d = Math.hypot(route.x[i] - x, -route.y[i] - z);
          if (d < dm) dm = d;
        }
        return dm;
      };
      let lx = 0, lz = 0, scelto = 0;
      for (const off of [22, -22, 34, -34]) {
        const cx = tmpA.x + tmpB.z * off, cz = tmpA.z - tmpB.x * off;
        if (distNastro(cx, cz) > 13) { lx = cx; lz = cz; scelto = off; break; }
      }
      if (!scelto) { lx = tmpA.x + tmpB.z * 40; lz = tmpA.z - tmpB.x * 40; }
      let ly = groundAt(lx, lz);
      try {
        let terr = null;
        scene.traverse(o => { if (!terr && o.isMesh && (o.name || '').startsWith('Terrain')) terr = o; });
        if (terr) {
          const rc = new THREE.Raycaster(new THREE.Vector3(lx, (ly > -1e3 ? ly : tmpA.y) + 80, lz),
                                         new THREE.Vector3(0, -1, 0), 0, 300);
          const hit = rc.intersectObject(terr, false)[0];
          if (hit) ly = hit.point.y;
        }
      } catch (e) {}
      l2.position.set(lx, ly > -1e3 ? ly + 0.05 : tmpA.y, lz);
      posAt(26300, tmpC);
      const hOld = Math.atan2(-(tmpC.z - lupoSrc.position.z), tmpC.x - lupoSrc.position.x);
      posAt(21650, tmpA);
      const hNew = Math.atan2(-(tmpA.z - lz), tmpA.x - lx);
      l2.rotation.y += (hNew - hOld);
      scene.add(l2);
      poggia(l2);
      // secondo lupo: km 11,8, lato sinistro, poco prima della scarpata
      const l3w = lupoSrc.clone();
      posAt(11800, tmpA); tanAt(11800, tmpB);
      let mx = 0, mz = 0, sc2 = 0;
      for (const off of [18, 26, 34, -18]) {
        const cx = tmpA.x + tmpB.z * off, cz = tmpA.z - tmpB.x * off;
        if (distNastro(cx, cz) > 11) { mx = cx; mz = cz; sc2 = off; break; }
      }
      if (!sc2) { mx = tmpA.x + tmpB.z * 26; mz = tmpA.z - tmpB.x * 26; }
      let ly2 = groundAt(mx, mz);
      try {
        let terr2 = null;
        scene.traverse(o => { if (!terr2 && o.isMesh && (o.name || '').startsWith('Terrain')) terr2 = o; });
        if (terr2) {
          const rc2 = new THREE.Raycaster(new THREE.Vector3(mx, (ly2 > -1e3 ? ly2 : tmpA.y) + 80, mz),
                                          new THREE.Vector3(0, -1, 0), 0, 300);
          const h2 = rc2.intersectObject(terr2, false)[0];
          if (h2) ly2 = h2.point.y;
        }
      } catch (e) {}
      l3w.position.set(mx, ly2 > -1e3 ? ly2 + 0.05 : tmpA.y, mz);
      const hNew2 = Math.atan2(-(tmpA.z - mz), tmpA.x - mx);
      l3w.rotation.y += (hNew2 - hOld);
      scene.add(l3w);
      poggia(l3w);
      // regola poggia: vale anche per i lupi nativi di scene.glb
      ['Lupo_Rozza', 'Lupo_Bosco'].forEach(nm2 => {
        const wn = world.scene.getObjectByName(nm2);
        if (wn) poggia(wn);
      });
      poggia(lupoSrc);
      // il rifugio di Sevice era sospeso di quasi 3 m: si posa (regola poggia)
      if (SEVICE) poggia(SEVICE, -0.25);
      // suolo VERO campionato lungo tutto il tratto arco -> km 0, poi il tappeto verde
      try { setArco(ARCO.x, ARCO.z); campionaTrattoArco(); buildTappeto(); } catch (e) { console.warn('quota arco:', e); }
    }
  } catch (e) { console.warn('lupo discesa:', e); }
  loader.load('assets/extras.glb?' + VER, g => {
    // ceppo e incudine ora vivono in maglianoC.glb (magliano_centro.blend):
    // le vecchie copie in extras.glb restano nascoste finche' non lo si rigenera
    const nomiC = ['Ristoro_ceppo', 'Ristoro_incudine_base', 'Ristoro_incudine_vita',
                   'Ristoro_incudine_corpo', 'Ristoro_incudine_corno'];
    g.scene.traverse(o => {
      if (o.isMesh && o.material && o.material.isMeshStandardMaterial) o.material.metalness = 0;
      if (nomiC.includes(o.name)) o.visible = false;
    });
    scene.add(g.scene);
    // la rastrelliera dei bastoncini (montanti, traversa, bastoncini) era sospesa di 1,1 m: si posa tutta insieme
    try {
      const rast = new THREE.Group(); rast.name = 'Rastrelliera';
      const pezzi = []; g.scene.traverse(o => { if (o.isMesh && /^Ristoro_(mont|bast|traversa)/.test(o.name)) pezzi.push(o); });
      for (const p of pezzi) rast.attach(p);
      g.scene.add(rast);
      // sta su un pendio: si abbassa fino a che il montante piu' a valle tocca (gli altri affondano un po')
      rast.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(rast);
      let gmin = 1e9;
      for (const [x, z] of [[bb.min.x, bb.min.z], [bb.max.x, bb.min.z], [bb.min.x, bb.max.z], [bb.max.x, bb.max.z]]) {
        const gy = terraVera(x, z, bb.max.y); if (gy > -1e3 && gy < gmin) gmin = gy;
      }
      if (gmin < 1e8) rast.position.y += gmin - bb.min.y + 0.03;
    } catch (e) { console.warn('rastrelliera:', e); }
  }, undefined, () => console.warn('extras assente'));
  loader.load('assets/borghi.glb?' + VER, g => {
    g.scene.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        if (o.material && o.material.isMeshStandardMaterial) { o.material.metalness = 0; o.material.roughness = 0.95; }
      }
    });
    scene.add(g.scene);
    // sette case "fantasma" dell'export a quota 1400 (2000 m reali) sopra Magliano: ogni vertice che
    // sta piu' di 150 m sopra il suolo viene spinto sottoterra (le mesh dei borghi sono fuse, non si
    // possono togliere singole case)
    try {
      const v = new THREE.Vector3(); let tolti = 0;
      g.scene.traverse(o => {
        if (!o.isMesh) return;
        const p = o.geometry.attributes.position; if (!p) return;
        o.updateMatrixWorld(true);
        const inv = o.matrixWorld.clone().invert(); let n = 0;
        for (let i = 0; i < p.count; i++) {
          v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
          const gy = terraVera(v.x, v.z, v.y);
          if (gy > -1e3 && v.y > gy + 150) { v.y = gy - 400; v.applyMatrix4(inv); p.setXYZ(i, v.x, v.y, v.z); n++; }
        }
        if (n) { p.needsUpdate = true; o.geometry.computeBoundingSphere(); o.geometry.computeBoundingBox(); tolti += n; }
      });
      if (tolti) console.log('borghi: case sospese rimosse (vertici):', tolti);
    } catch (e) { console.warn('case sospese:', e); }
    try { arredaCase(g.scene); } catch (e) { console.warn('facciate borghi:', e); }
  }, undefined, () => console.warn('borghi assente'));
  // centro di Magliano curato a mano (magliano_centro.blend -> export_magliano.py)
  loader.load('assets/maglianoC.glb?' + VER, g => {
    g.scene.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        if (o.material && o.material.isMeshStandardMaterial) { o.material.metalness = 0; o.material.roughness = 0.95; }
      }
    });
    scene.add(g.scene);
    try { arredaCase(g.scene); } catch (e) { console.warn('facciate maglianoC:', e); }
    // arco di partenza: i piloni erano 0,3-0,9 m sopra l'asfalto; si annega di 1 m
    { const arco = g.scene.getObjectByName('ArcoSRM'); if (arco) arco.position.y -= 1.0; }
    try { arredaPartenza(g.scene); } catch (e) { console.warn('partenza:', e); }
    try { aggiornaArco(g.scene); } catch (e) { console.warn('arco:', e); }
    // tigli davanti al Comune (oggetti Tiglio* del blend di Ale): chioma con vento e tinta d'autunno
    g.scene.traverse(o => { if (o.isMesh && /^Tiglio/.test(o.name || '')) vestiTiglio(o); });
    try { buildTigli(); } catch (e) { console.warn('tigli:', e); }
  }, undefined, () => console.warn('maglianoC assente'));
  $('load-step').textContent = 'Lino…';
  let lg;
  try { lg = await loadGLB(loader, 'assets/lino2.glb?' + VER, p => prog(0.66 + 0.28 * p)); LINO2 = true; }
  catch (e) { console.warn('lino2.glb assente, uso lino.glb:', e); lg = await loadGLB(loader, 'assets/lino.glb?' + VER, p => prog(0.66 + 0.28 * p)); }
  prepLino(lg);
  LOADER = loader;
  try {
    const gr = await loadGLB(loader, 'assets/grifone.glb?' + VER, () => {});
    RIGS.grifone = prepRig(gr, 'grifone'); RIG = RIGS.grifone;
  } catch (e) { console.warn('grifone riggato assente, uso il Meshy statico:', e); }
  buildPins();
  buildAnimali(loader).catch(e => console.warn('animali:', e));
  buildGEV(loader).catch(e => console.warn('GEV:', e));
  buildChiesaNives(loader).catch(e => console.warn('chiesa Nives:', e));
  try { buildDataSassi(); } catch (e) { console.warn('sassi:', e); }
  try { buildNubiBasse(); } catch (e) { console.warn('nubi:', e); }
  try { buildNuvole(); } catch (e) { console.warn('nuvole:', e); }
  try { buildTerrenoEsterno(); } catch (e) { console.warn('anello esterno:', e); }
  try { aggiungiVetteEsterne(); } catch (e) { console.warn('vette esterne:', e); }
  try { await document.fonts.load('400 72px Anton'); } catch (e) {}
  buildPeaks();
  buildProfile(); buildMinimap(); bindUI();
  const h = location.hash.match(/km=([\d.]+)/);
  if (h) st.s = clamp(parseFloat(h[1]) * 1000, 0, TOT);
  else st.s = S0_ARCO;
  applicaQualita(QUAL.liv); QUAL.avvio = performance.now();   // ora che alberi e nuvole esistono
  try { if (!TIDX) TIDX = buildTerrIndex(); correggiGriglia(); } catch (e) { console.warn('griglia:', e); }
  st.ready = true; prog(1);
  {
    // Lino continua a girare con le targhette finche' non si preme il pulsante
    const chiudi = () => {
      $('loader').style.display = 'none';
      if (window._loaderStop) window._loaderStop();
      try { if (!localStorage.getItem('srmx_help')) { showHelp(); localStorage.setItem('srmx_help', '1'); } }
      catch (e) { /* storage bloccato: pazienza */ }
    };
    $('load-barw').style.display = 'none';
    $('load-step').style.display = 'none';
    const go = $('go-btn');
    go.style.display = 'inline-block';
    go.onclick = chiudi;
  }
  window.SRMX = { st, scene: () => scene, route: () => route, vista: setView, terra: groundAt, cam: () => camera, ctrl: () => controls, lino: () => lino, terraV: (x, z, y) => terraVera(x, z, y),
                  look: (p, t) => { camera.position.set(p[0], p[1], p[2]); camTgt.set(t[0], t[1], t[2]); controls.target.copy(camTgt); controls.update(); },
                  y0arco: () => Y0_ARCO, pos: s => { posAt(s, tmpC); return [tmpC.x, tmpC.y, tmpC.z]; }, goto: km => { st.sTarget = clamp(km, 0, route.total_km) * 1000; },
                  poi: i => openPoi(route.pois[i]), qual: l => applicaQualita(l), Q: QUAL, specie: n => cambiaSpecie(n), rigNow: () => RIG, cer: () => CER, ext: () => EXT_TILES, tickE: dt => tickExtTiles(dt), sent: () => ({ SENT, SENT_ON, sentT }), tickS: dt => tickSentieri(dt), rb: (n, ax, a) => rotBone(n, AX[ax], a), vetta: n => openPeak(route.peaks.find(p => new RegExp(n, 'i').test(p.n))), gara: showGara, segui: v => setFollow(v, false),
                  anim: () => action ? { t: +action.time.toFixed(3), ts: +mixer.timeScale.toFixed(2),
                                         dur: +action.getClip().duration.toFixed(2) } : null,
                  tracks: () => action ? action.getClip().tracks.map(t => t.name) : [],
                  poseT: tt => {
                    if (!action) return null;
                    action.time = tt; mixer.timeScale = 1; mixer.update(0);
                    scene.updateMatrixWorld(true);
                    const b = scene.getObjectByName('B_an_L');
                    return b ? b.matrixWorld.elements.slice(12, 15).map(v => +v.toFixed(2)) : null;
                  } };
  setView('follow');
  clock = new THREE.Clock();
  renderer.setAnimationLoop(tick);
}

function loadGLB(loader, url, onp){
  return new Promise((res, rej) => loader.load(url, res,
    ev => { if (ev.total) onp(ev.loaded / ev.total); },
    () => rej(new Error('Impossibile caricare ' + url))));
}

// ---------- scena ----------
function buildStage(){
  renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(Math.max(320, innerWidth || 1280), Math.max(240, innerHeight || 720));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  scene = new THREE.Scene();
  const cielo = new THREE.Color(0xcfe2f4);
  scene.background = cielo;
  scene.fog = new THREE.Fog(cielo, 2800, 18000);
  camera = new THREE.PerspectiveCamera(55, Math.max(320, innerWidth || 1280) / Math.max(240, innerHeight || 720), 1, 30000);
  camera.position.set(route.x[6], route.z[6] + 60, -route.y[6] + 120);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 14; controls.maxDistance = 4200;
  controls.addEventListener('start', () => setFollow(false, true));
  // luce d'alba, come nel film
  const hemi = new THREE.HemisphereLight(0xf2f7ff, 0x6d755b, 1.05);
  HEMI = hemi;
  sunLight = new THREE.DirectionalLight(0xfff3e0, 2.4);
  sunLight.position.set(-1200, 1450, -1350);
  const fill = new THREE.DirectionalLight(0xffe7c8, 0.32);
  fill.position.set(5600, 4000, 4800);
  scene.add(hemi, sunLight, sunLight.target, fill);
  const liv0 = qualIniziale();
  QUAL.tetto = Math.max(liv0, QUAL.mob ? 2 : 3);
  SHADOWS = liv0 >= 2;        // ombre vere solo dal livello alto (PC e telefoni forti); sotto, restano quelle delle nuvole
  if (SHADOWS) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(QUAL.mob ? 1024 : 2048, QUAL.mob ? 1024 : 2048);
    const sk = sunLight.shadow.camera;
    sk.left = -430; sk.right = 430; sk.top = 430; sk.bottom = -430;
    sk.near = 150; sk.far = 4500;
    sk.updateProjectionMatrix();   // senza questo la camera delle ombre resta a +-5 m / far 500: nessuna ombra in scena
    sunLight.shadow.bias = -0.00055;
    sunLight.shadow.normalBias = 0.6;
  }
  applicaQualita(liv0);
  addEventListener('resize', () => {
    const W = Math.max(320, innerWidth || 1280), H = Math.max(240, innerHeight || 720);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    renderer.setSize(W, H);
    if (typeof profCv !== 'undefined' && profCv) { sizeProfile(); drawProfilePos(); }
  });
}

function prepWorld(g){
  g.traverse(o => {
    if (!o.isMesh) return;
    o.frustumCulled = true;
    const nm = o.name || '';
    // arco, scritta e municipio ora arrivano da maglianoC.glb (magliano_centro.blend):
    // le copie ancora dentro scene.glb restano nascoste finche' non si rigenera la scena
    if (nm.startsWith('Arch_') || nm === 'ArchTxt' || nm === 'Comune_Meshy') { o.visible = false; return; }
    o.receiveShadow = true;
    if (!nm.startsWith('Terrain') && !nm.startsWith('SRM_Trail')) o.castShadow = true;
    if (nm.startsWith('Terrain')) {
      colorizeTerrain(o);
    } else if (nm.startsWith('SRM_Trail')) {
      colorizeTrail(o);
      o.renderOrder = 1;
    } else if (nm === 'Forest' || nm.startsWith('Forest')) {
      o.visible = false;
    } else if (nm.startsWith('Clouds')) {
      o.visible = false;   // le nuvole piatte dell'export sono sostituite dai cumuli a billboard (buildNuvole)
    } else if (o.material && o.material.isMeshStandardMaterial) {
      o.material.metalness = 0; o.material.roughness = 0.9;
    }
    if (nm.startsWith('Grif_Meshy')) grifTpl = o;
    if (nm === 'Sevice_Meshy') { window._hutS = o; SEVICE = o; }
    if (nm === 'Chiesa_Porclaneta' && o.material) {
      // la texture Meshy e' scura: si schiarisce verso il tono delle case, con una leggera
      // patina calda da pietra antica (curva gamma + tinta, niente triangoli in piu')
      const m = o.material = o.material.clone();
      m.color.setRGB(1, 1, 1);
      m.customProgramCacheKey = () => 'porclaneta';
      m.onBeforeCompile = sh => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 c = diffuseColor.rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = pow(c, vec3(0.55)) * 1.25;                       // schiarisce come l'intonaco delle case
  vec3 antica = vec3(0.86, 0.80, 0.68);                 // pietra/calce anticata
  c = mix(c, antica * (0.75 + 0.5 * pow(l, 0.5)), 0.45);
  diffuseColor.rgb = clamp(c, 0.0, 1.0);
}`);
      };
    }
  });
  // copia-ombra del nastro: il nastro e' MeshBasicMaterial (non illuminato,
  // per avere grigio/arancio costanti) e NON puo' ricevere ombre; una copia
  // della stessa geometria con ShadowMaterial mostra SOLO le ombre sopra.
  // Aggiunta DOPO il traverse per non farla riprocessare dal loop.
  if (SHADOWS) {
    const trails = [];
    g.traverse(o => { if (o.isMesh && (o.name || '').startsWith('SRM_Trail')) trails.push(o); });
    for (const t of trails) {
      const smat = new THREE.ShadowMaterial({ opacity: 0.34 });
      // il nastro ha le facce rivolte in giu' (il suo materiale e' DoubleSide):
      // senza DoubleSide il catcher veniva scartato per intero (backface cull)
      smat.side = THREE.DoubleSide;
      smat.depthWrite = false;
      smat.polygonOffset = true; smat.polygonOffsetFactor = -2; smat.polygonOffsetUnits = -2;
      const catcher = new THREE.Mesh(t.geometry, smat);
      catcher.name = 'TrailShadowCatcher';
      catcher.receiveShadow = true; catcher.castShadow = false;
      catcher.renderOrder = 2;
      t.add(catcher);
    }
  }
  // grifoni in orbita: cloni del modello, parametri dall'export
  if (grifTpl && route.grif) {
    grifTpl.removeFromParent();
    for (const gdef of route.grif) {
      const m = grifTpl.clone();
      m.userData.g = gdef;
      scene.add(m); grifs.push(m);
    }
  }
  // Capanna di Sevice: posizionata da Ale direttamente nel master
}

let LINO2 = false, LINOACT = null, LINOPOLI = [];
function prepLino(lg){
  lino = new THREE.Group();
  lg.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; }
    if (/^L3_Pole/.test(o.name || '')) LINOPOLI.push(o); });
  lino.add(lg.scene);
  scene.add(lino);
  if (LINO2 && lg.animations && lg.animations.length) {
    // Lino Meshy riggato: camminata, corsa e "carica" (sprint) miscelate con la velocita'
    mixer = new THREE.AnimationMixer(lg.scene);
    LINOACT = {};
    for (const c of lg.animations) {
      const a = mixer.clipAction(c); a.setLoop(THREE.LoopRepeat, Infinity); a.play(); a.setEffectiveWeight(0);
      if (/walk/i.test(c.name)) LINOACT.walk = a; else if (/charge/i.test(c.name)) LINOACT.charge = a; else LINOACT.run = a;
    }
    action = LINOACT.run || Object.values(LINOACT)[0];
    lg.scene.traverse(o => { if (o.isSkinnedMesh && o.material) { o.material.metalness = 0; o.material.roughness = 0.85; } });
    // il modello e' alto 1,7 unita': si porta all'altezza di Lino nella scena
    lg.scene.scale.setScalar((route.lino_h || 7.8) / 1.7);
    console.log('Lino 2: clip', Object.keys(LINOACT).join(','));
  } else if (lg.animations && lg.animations.length) {
    mixer = new THREE.AnimationMixer(lg.scene);
    window._linoclips = lg.animations.map(c => [c.name, +c.duration.toFixed(2), c.tracks.length]);
    let best = null;
    for (const c of lg.animations) {
      const a = mixer.clipAction(c);
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.play();
      if (!best || c.tracks.length > best.getClip().tracks.length) best = a;
    }
    action = best;
    console.log('clip Lino:', JSON.stringify(window._linoclips));
  } else {
    console.warn('lino.glb senza animazioni: resta statico');
  }
}

// ---------- percorso ----------
// Quota dei PIEDI di Lino lungo il tracciato: la linea GPX (route.z) sta 0,4-3 m sopra il nastro
// disegnato, e Lino sembrava sospeso. YT[i] = quota del nastro SRM_Trail (indice spaziale della
// mesh) o del terreno vero, campionata a ogni punto del percorso e ammorbidita su +-40 m per
// togliere gli scalini di pendenza; mai piu' di 3 cm sotto il nastro (i piedi non affondano).
let YT = null;
// il nastro esportato da Blender in certi tratti galleggia anche 4-5 m sopra la mesh del terreno
// (pendii ripidi): si drappeggia vertice per vertice sulla mesh vera, fuori dal paese
function drappeggiaNastro(trail){
  const g = trail.geometry, pos = g.getAttribute('position'), side = g.getAttribute('aSide');
  trail.updateMatrixWorld(true);
  const M = trail.matrixWorld, Mi = M.clone().invert(), v = new THREE.Vector3(), w = new THREE.Vector3(), o = new THREE.Vector3();
  const cx = route.x[0], cz = -route.y[0];
  const ALLARGA = 0.55, SOPRA = 0.6;      // nastro piu' largo di 55 cm per lato e 60 cm sopra la terra vera
  let n = 0, dmax = 0;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(M);
    if (Math.hypot(v.x - cx, v.z - cz) < 700) continue;          // in paese il suolo e' la piazza/asfalto
    // allargamento: spinge il vertice verso l'esterno, lontano dal vertice del lato opposto piu' vicino
    if (side) {
      const sd = side.getX(i);
      let tx = 0, tz = 0, ox = NaN, oz = NaN;
      for (let j = i + 1; j <= Math.min(pos.count - 1, i + 6); j++) if (side.getX(j) === sd) { w.fromBufferAttribute(pos, j).applyMatrix4(M); tx = w.x - v.x; tz = w.z - v.z; break; }
      if (tx === 0 && tz === 0) for (let j = i - 1; j >= Math.max(0, i - 6); j--) if (side.getX(j) === sd) { w.fromBufferAttribute(pos, j).applyMatrix4(M); tx = v.x - w.x; tz = v.z - w.z; break; }
      for (let j = Math.max(0, i - 3); j <= Math.min(pos.count - 1, i + 3); j++) if (side.getX(j) !== sd) { o.fromBufferAttribute(pos, j).applyMatrix4(M); ox = o.x; oz = o.z; break; }
      const L = Math.hypot(tx, tz);
      if (L > 1e-3 && !isNaN(ox)) {
        let nx = tz / L, nz = -tx / L;
        if (nx * (v.x - ox) + nz * (v.z - oz) < 0) { nx = -nx; nz = -nz; }
        v.x += nx * ALLARGA; v.z += nz * ALLARGA;
      }
    }
    const gt = terraVera(v.x, v.z, v.y);
    if (gt > -1e3) {
      const d = v.y - gt;
      dmax = Math.max(dmax, Math.abs(d));
      v.y = gt + SOPRA;                 // sempre un po' sopra la terra vera: niente tratti annegati
    }
    v.applyMatrix4(Mi); pos.setXYZ(i, v.x, v.y, v.z); n++;
  }
  if (n) { pos.needsUpdate = true; g.computeBoundingSphere(); g.computeBoundingBox(); console.log('nastro drappeggiato:', n, 'vertici, scarto max', dmax.toFixed(1)); }
  // la copia-ombra condivide la geometria: nulla da fare
}
function buildTrailHeights(){
  let trail = null;
  scene.traverse(o => { if (!trail && o.isMesh && (o.name || '') === 'SRM_Trail') trail = o; });
  if (trail) { try { drappeggiaNastro(trail); } catch (e) { console.warn('drappeggio nastro:', e); } }
  const TI = trail ? buildTerrIndex(trail, 30) : null;
  const raw = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = route.x[i], z = -route.y[i];
    let y = TI ? altezzaIdx(TI, x, z) : -1e4;
    const gt = terraVera(x, z, route.z[i] + 20);
    if (y < -1e3 || (gt > -1e3 && y < gt - 2)) y = gt;
    if (y < -1e3) y = route.z[i];
    // i piedi non stanno mai piu' di 30 cm sopra la terra vera (ne' sotto)
    if (gt > -1e3) y = Math.min(Math.max(y, gt - 0.05), gt + 0.66);   // sul nastro (terra + 0,6), mai dentro
    raw[i] = y + 0.04;
  }
  const out = new Float32Array(N);
  const W = 2;                                   // +-2 campioni = +-20 m: liscia i gradini senza sollevare dai dossi
  for (let i = 0; i < N; i++) {
    let acc = 0, wsum = 0;
    for (let k = -W; k <= W; k++) {
      const j = Math.min(N - 1, Math.max(0, i + k)), w = 1 - Math.abs(k) / (W + 1);
      acc += raw[j] * w; wsum += w;
    }
    out[i] = Math.min(Math.max(acc / wsum, raw[i] - 0.03), raw[i] + 0.45);
  }
  YT = out;
}
// Partenza sotto l'arco: il tratto da s = S0_ARCO (centro dell'arco) a s = 0 (inizio del tracciato)
// e' una RETTA dal centro dell'arco al primo punto del percorso, coperta dal tappeto verde.
// Il centro dell'arco viene dai piloni di ArcoSRM (magliano_centro.blend): valori iniziali dal blend
// del 02/10, ricalcolati appena maglianoC.glb e' caricato (cosi' Ale puo' spostare l'arco a piacere).
const ARCO = { x: -1555.6, z: 4890.4, L: 15, dx: 0, dz: -1 };   // centro (three), lunghezza del tratto, direzione arco -> km 0
let S0_ARCO = -15.0;
let Y0_ARCO = null;      // quota del suolo vero sotto l'arco (raycast al caricamento)
let YEXT = null;         // suolo campionato ogni metro da s=S0_ARCO a s=0
let TAPPETO = null;
const TAPPETO_SP = 0.45;   // spessore della pedana verde: Lino ci cammina sopra (YEXT alzato di altrettanto)
function setArco(cx, cz){
  ARCO.x = cx; ARCO.z = cz;
  const dx = route.x[0] - cx, dz = -route.y[0] - cz;
  ARCO.L = Math.max(4, Math.hypot(dx, dz)); ARCO.dx = dx / ARCO.L; ARCO.dz = dz / ARCO.L;
  S0_ARCO = -ARCO.L;
  if (st.s < S0_ARCO) st.s = S0_ARCO;
}
// suolo vero campionato ogni metro lungo il tratto arco -> km 0 (terreno o piazza)
function campionaTrattoArco(){
  const bers = [];
  scene.traverse(o => { if (o.isMesh && (o.name === 'Terrain' || /^Piazza/.test(o.name || ''))) bers.push(o); });
  if (!bers.length) return;
  const n = Math.ceil(ARCO.L), ye = [];
  const prev = YEXT; YEXT = null;      // posAt(s<0) senza tabella: solo la retta
  for (let k = 0; k <= n; k++) {
    posAt(Math.min(S0_ARCO + k, 0), tmpA);
    const rc0 = new THREE.Raycaster(new THREE.Vector3(tmpA.x, 400, tmpA.z), new THREE.Vector3(0, -1, 0), 0, 900);
    const h0 = rc0.intersectObjects(bers, false)[0];
    ye.push(h0 ? h0.point.y + 0.05 : null);
  }
  for (let k = 0; k <= n; k++) if (ye[k] === null) ye[k] = k > 0 ? ye[k - 1] : (prev ? prev[0] : route.z[0]);
  for (let k = 0; k <= n; k++) ye[k] += TAPPETO_SP;      // si cammina sulla pedana
  YEXT = ye; Y0_ARCO = ye[0];
}
// tappeto verde dall'arco all'inizio del tracciato: nastro di 5 m che segue il suolo campionato,
// centrato sulla retta dell'arco, con due righe bianche ai bordi
function buildTappeto(){
  if (TAPPETO) { TAPPETO.removeFromParent(); TAPPETO.geometry.dispose(); TAPPETO = null; }
  if (!YEXT) return;
  // Pedana verde spessa (SP) larga quanto la luce fra i piloni, da 3 m dietro l'arco a 10 m oltre
  // l'inizio del tracciato (dove copre il nastro di gara), poi si stringe in 6 m. Il piano di calpestio
  // sta a SP sopra il suolo o 6 cm sopra il nastro, lisciato lungo la lunghezza: niente gradini.
  const W = ARCO.W || 12, SOPRA = 10, CODA = 6, SP = TAPPETO_SP;
  let trailM = null; scene.traverse(o => { if (!trailM && o.isMesh && (o.name || '') === 'SRM_Trail') trailM = o; });
  const rcT = new THREE.Raycaster(), rcO = new THREE.Vector3(), rcD = new THREE.Vector3(0, -1, 0);
  const rows = [];
  for (let s = S0_ARCO - 3; s <= SOPRA + CODA + 0.01; s += 1) {
    posAt(s, tmpA);
    if (s > 0 && s < 8) {   // il centro raccorda la retta dell'arco al tracciato
      const t0 = s / 8, t1 = t0 * t0 * (3 - 2 * t0);
      const lx = ARCO.x + ARCO.dx * (ARCO.L + s), lz = ARCO.z + ARCO.dz * (ARCO.L + s);
      tmpA.x = lx * (1 - t1) + tmpA.x * t1; tmpA.z = lz * (1 - t1) + tmpA.z * t1;
    } tanAt(Math.max(s, S0_ARCO), tmpB);
    // lato: quello dell'arco sul tratto rettilineo, quello del tracciato oltre il km 0, fusi con una
    // transizione morbida fra -10 e +6 m (niente piega ne' gradino alla giuntura)
    let rx = -tmpB.z, rz = tmpB.x; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
    const ax = -ARCO.dz, az = ARCO.dx;
    if (rx * ax + rz * az < 0) { rx = -rx; rz = -rz; }           // stesso verso
    let tt = clamp((s + 10) / 16, 0, 1); tt = tt * tt * (3 - 2 * tt);
    let sx = ax * (1 - tt) + rx * tt, sz = az * (1 - tt) + rz * tt; const sl = Math.hypot(sx, sz) || 1; sx /= sl; sz /= sl;
    const w = s <= SOPRA ? W : W * Math.max(0.15, 1 - (s - SOPRA) / CODA);
    let y = -1e9;
    for (let q = -0.5; q <= 0.5; q += 0.25) {
      const px = tmpA.x + sx * w * q, pz = tmpA.z + sz * w * q;
      const g = terraVera(px, pz, tmpA.y + 5); if (g > -1e3) y = Math.max(y, g + SP);
      if (trailM) { rcT.set(rcO.set(px, tmpA.y + 25, pz), rcD); const h = rcT.intersectObject(trailM, false)[0]; if (h) y = Math.max(y, h.point.y + 0.06); }
    }
    if (y < -1e8) y = tmpA.y + SP;
    rows.push({ x: tmpA.x, z: tmpA.z, sx, sz, w, y, s });
  }
  // lisciatura del piano (media mobile a 5), poi di nuovo mai sotto il nastro
  const ys = rows.map(r => r.y);
  for (let k = 0; k < rows.length; k++) { let a = 0, n = 0; for (let d = -2; d <= 2; d++) { const j = k + d; if (j >= 0 && j < rows.length) { a += ys[j]; n++; } } rows[k].y = Math.max(a / n, ys[k] - 0.04); }
  const pos = [], uv = [], idx = [];
  const H = SP + 0.3;   // fianchi che scendono fin dentro il suolo
  rows.forEach((r, k) => {
    const lx = r.x - r.sx * r.w / 2, lz = r.z - r.sz * r.w / 2, rx = r.x + r.sx * r.w / 2, rz = r.z + r.sz * r.w / 2;
    // 4 vertici per riga: sinistra alto, destra alto, sinistra basso, destra basso
    pos.push(lx, r.y, lz, rx, r.y, rz, lx, r.y - H, lz, rx, r.y - H, rz);
    uv.push(0, k, 1, k, -1, k, 2, k);          // i fianchi hanno u fuori [0,1]: niente riga bianca
    if (k < rows.length - 1) {
      const a = k * 4;
      idx.push(a, a + 1, a + 4, a + 1, a + 5, a + 4);               // piano
      idx.push(a + 2, a, a + 6, a, a + 4, a + 6);                   // fianco sinistro
      idx.push(a + 1, a + 3, a + 5, a + 3, a + 7, a + 5);           // fianco destro
    }
  });
  // testata dietro l'arco
  idx.push(2, 3, 0, 3, 1, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ color: 0x2f7a43, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  m.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
{ float b = min(vUv.x, 1.0 - vUv.x);                               // bordo bianco di 18 cm sul piano
  float riga = (vUv.x >= 0.0 && vUv.x <= 1.0) ? 1.0 - smoothstep(0.03, 0.045, b) : 0.0;
  float fianco = (vUv.x < 0.0 || vUv.x > 1.0) ? 1.0 : 0.0;
  float grana = 0.94 + 0.12 * fract(sin(dot(floor(vUv * vec2(40.0, 2.0)), vec2(12.9898, 78.233))) * 43758.5453);
  diffuseColor.rgb = mix(diffuseColor.rgb * grana * (1.0 - 0.25 * fianco), vec3(0.93, 0.92, 0.88), riga); }`);
  };
  m.defines = { USE_UV: '' };
  TAPPETO = new THREE.Mesh(g, m); TAPPETO.name = 'Tappeto'; TAPPETO.receiveShadow = true; TAPPETO.castShadow = true; TAPPETO.renderOrder = 2;
  scene.add(TAPPETO);
}
// legge il centro dell'arco dai piloni del glb e rifa' tratto, suolo e tappeto
function aggiornaArco(root){
  const p = [];
  root.traverse(o => { if (o.isMesh && /^Arch_Pillar/.test(o.name || '')) { const b = new THREE.Box3().setFromObject(o); p.push(b.getCenter(new THREE.Vector3())); } });
  if (p.length < 2) return;
  const cx = (p[0].x + p[1].x) / 2, cz = (p[0].z + p[1].z) / 2;
  ARCO.W = Math.max(6, p[0].distanceTo(p[1]) - 2.2);     // luce fra i piloni (centro a centro meno lo spessore)
  const era = st.s <= S0_ARCO + 0.01;
  setArco(cx, cz);
  campionaTrattoArco();
  buildTappeto();
  if (era) st.s = S0_ARCO;
  console.log('arco: centro', cx.toFixed(1), cz.toFixed(1), 'tratto', ARCO.L.toFixed(1), 'm');
}
function posAt(s, out){
  if (s < 0) {
    // retta dal centro dell'arco (s = S0_ARCO) all'inizio del tracciato (s = 0)
    const L = ARCO.L;
    const d = clamp(s - S0_ARCO, 0, L);                 // distanza dall'arco
    let y;
    if (YEXT) {
      const n = YEXT.length - 1;
      const k0 = Math.min(n - 1, Math.floor(d));
      const yg = YEXT[k0] + (YEXT[k0 + 1] - YEXT[k0]) * (d - k0);
      const t0 = clamp(1 + s / 3.0, 0, 1);      // raccordo al nastro solo negli ultimi 3 m
      y = yg * (1 - t0) + (YT ? YT[0] : route.z[0]) * t0;
    } else {
      const t0 = d / L;
      const yA = (typeof Y0_ARCO === 'number') ? Y0_ARCO : route.z[0];
      y = yA * (1 - t0) + route.z[0] * t0;
    }
    return out.set(ARCO.x + ARCO.dx * d, y, ARCO.z + ARCO.dz * d);
  }
  const f = clamp(s, 0, TOT) / TOT * (N - 1);
  const i = Math.min(Math.floor(f), N - 2), t = f - i;
  const Z = YT || route.z;
  return out.set(lerp(route.x[i], route.x[i + 1], t),
                 lerp(Z[i], Z[i + 1], t),
                -lerp(route.y[i], route.y[i + 1], t));
}
function quotaAt(s){
  const f = clamp(s, 0, TOT) / TOT * (N - 1);
  const i = Math.min(Math.floor(f), N - 2), t = f - i;
  if (route.elev) return lerp(route.elev[i], route.elev[i + 1], t);   // profilo GPX reale
  return route.elev_a * lerp(route.z[i], route.z[i + 1], t) + route.elev_b;
}
function tanAt(s, out){
  posAt(Math.min(s + 22, TOT), out); posAt(Math.max(s - 22, S0_ARCO), tmpD);   // anche sul tratto dell'arco la tangente guarda avanti
  out.sub(tmpD);
  return out.lengthSq() > 1e-6 ? out.normalize() : out.set(1, 0, 0);
}
const zoneAt = km => route.zones.find(z => km >= z[0] && km < z[1]) || route.zones[route.zones.length - 1];
const trailAt = km => (route.trails.find(t => km >= t[0] && km < t[1]) || route.trails[route.trails.length - 1])[2];

// ---------- segnaposto POI ----------
const PIN_COLORS = { start:'#e8e2d0', water:'#58a6d8', gate:'#d84b3f', ristoro:'#9a6bd0',
                     vetta:'#f4951f', vista:'#f4951f', info:'#8d99a6', finish:'#e8e2d0' };
function pinSprite(color){
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.beginPath(); x.arc(128, 104, 64, 0, 7); x.fillStyle = color; x.fill();
  x.lineWidth = 14; x.strokeStyle = '#ffffff'; x.stroke();
  x.beginPath(); x.moveTo(128, 244); x.lineTo(86, 148); x.lineTo(170, 148); x.closePath();
  x.fillStyle = '#ffffff'; x.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return new THREE.SpriteMaterial({ map: tex, depthTest: true, sizeAttenuation: true });
}
// data di gara coi sassi: tratti continui dentro il rettangolo segnato da Ale
function buildDataSassi(){
  // box guida (dal master): centro scena (-1166, 2683.4), rotz 30 gradi, 34.5 x 9.3 m
  const CX = -1166, CZ = 2683.4 * -1;
  const advX = 0.5, advZ = 0.866;      // senso di lettura (scena (0.5,-0.866) -> three)
  const upX = 0.866, upZ = -0.5;       // "alto" dei glifi, lato opposto al nastro
  const U = 0.7;
  const SEG = {
    '0': [[0,0,2,0],[2,0,2,4],[2,4,0,4],[0,4,0,0]],
    '1': [[1,0,1,4],[0.2,3.1,1,4],[0.3,0,1.7,0]],
    '2': [[0,4,2,4],[2,4,2,2],[2,2,0,2],[0,2,0,0],[0,0,2,0]],
    '6': [[2,4,0,4],[0,4,0,0],[0,0,2,0],[2,0,2,2],[2,2,0,2]],
    '8': [[0,0,2,0],[2,0,2,4],[2,4,0,4],[0,4,0,0],[0,2,2,2]],
    '9': [[2,0,2,4],[2,4,0,4],[0,4,0,2],[0,2,2,2]],
    '-': [[0.2,2,1.8,2]]
  };
  const testo = '18-10-2026';
  const punti = [];   // [a, b] nel piano del box
  const passo = 0.44;
  const tratto = (x1, y1, x2, y2, a0) => {
    const L = Math.hypot(x2 - x1, y2 - y1) * U;
    const n = Math.max(2, Math.round(L / passo) + 1);
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      punti.push([a0 + (x1 + (x2 - x1) * t) * U + (Math.random() - 0.5) * 0.16,
                  (y1 + (y2 - y1) * t) * U - 2 * U + (Math.random() - 0.5) * 0.16]);
    }
  };
  const totU = testo.length * 3 + (testo.length - 1) * 1.2 + 1.2 + 4;
  let a0 = -totU * U / 2;
  for (const ch of testo) {
    for (const s2 of (SEG[ch] || [])) tratto(s2[0], s2[1], s2[2], s2[3], a0);
    a0 += 4.2 * U;
  }
  a0 += 1.2 * U;
  let prev = null;
  for (let t = 0; t <= 1.001; t += 0.055) {
    const ang = t * Math.PI * 2;
    const hx = 16 * Math.pow(Math.sin(ang), 3);
    const hy = 13 * Math.cos(ang) - 5 * Math.cos(2 * ang) - 2 * Math.cos(3 * ang) - Math.cos(4 * ang);
    const px2 = a0 + 2 * U + hx * U / 8.5, py2 = hy * U / 8.5;
    if (prev) {
      const L = Math.hypot(px2 - prev[0], py2 - prev[1]);
      const n = Math.max(1, Math.round(L / passo));
      for (let k = 1; k <= n; k++) {
        const tt = k / n;
        punti.push([prev[0] + (px2 - prev[0]) * tt + (Math.random() - 0.5) * 0.14,
                    prev[1] + (py2 - prev[1]) * tt + (Math.random() - 0.5) * 0.14]);
      }
    }
    prev = [px2, py2];
  }
  const geo = new THREE.DodecahedronGeometry(0.31, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xdbd8cf, roughness: 1, metalness: 0 });
  const im = new THREE.InstancedMesh(geo, mat, punti.length);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3();
  let k2 = 0;
  for (const [a, b] of punti) {
    const wx = CX + advX * a + upX * b;
    const wz = CZ + advZ * a + upZ * b;
    const wy = groundAt(wx, wz);
    Q.setFromEuler(E.set(Math.random() * 0.7, Math.random() * 3.14, Math.random() * 0.7));
    S.setScalar(0.82 + Math.random() * 0.36);
    M.compose(new THREE.Vector3(wx, (wy > -1e3 ? wy : 1548) + 0.16, wz), Q, S);
    im.setMatrixAt(k2++, M);
  }
  im.instanceMatrix.needsUpdate = true;
  im.frustumCulled = false;
  im.castShadow = true;
  im.name = 'DataSassi';
  scene.add(im);
}

// ---------- comignoli: una o due canne fumarie per tetto, tutte in una InstancedMesh ----------
function buildComignoli(tetti, nome){
  if (!tetti.length) return;
  const geo = new THREE.BoxGeometry(0.55, 1.6, 0.55); geo.translate(0, 0.8, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xb3a08a, roughness: 1, metalness: 0 });
  const slots = [];
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), org = new THREE.Vector3();
  const bb = new THREE.Box3();
  let sd = 11;
  const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  for (const t of tetti) {
    bb.setFromObject(t);
    const w = bb.max.x - bb.min.x, d = bb.max.z - bb.min.z;
    if (w < 4 || d < 4) continue;
    const n = w * d > 90 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      // vicino al colmo (centro della pianta), spostato lungo il lato lungo
      const u = 0.5 + (rnd() - 0.5) * 0.5, v = 0.5 + (rnd() - 0.5) * 0.25;
      const x = w >= d ? bb.min.x + w * u : bb.min.x + w * v;
      const z = w >= d ? bb.min.z + d * v : bb.min.z + d * u;
      org.set(x, bb.max.y + 5, z); ray.set(org, down); ray.far = 40;
      const h = ray.intersectObject(t, false)[0];
      if (!h) continue;
      slots.push([x, h.point.y - 0.45, z, 0.8 + rnd() * 0.5, rnd() * Math.PI]);
    }
  }
  if (!slots.length) return;
  const im = new THREE.InstancedMesh(geo, mat, slots.length);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3(), P = new THREE.Vector3();
  const col = new THREE.Color();
  slots.forEach((c, i) => {
    P.set(c[0], c[1], c[2]); Q.setFromEuler(E.set(0, c[4], 0)); S.set(c[3], c[3], c[3]);
    M.compose(P, Q, S); im.setMatrixAt(i, M);
    col.setHSL(0.07, 0.18 + 0.15 * (i % 3) / 2, 0.52 + 0.14 * ((i * 7) % 5) / 4); im.setColorAt(i, col);
  });
  im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; im.name = 'Comignoli_' + nome;
  scene.add(im);
}
// ---------- partenza e piazza: transenne e festoni arrivano da maglianoC.glb (posizionati da Ale in
// magliano_centro.blend: oggetti Transenna_* e Festone_*); qui solo materiali e vento ----------
function vestiFestone(o){
  // bandierine: la punta (z locale negativo rispetto al filo) sventola, il filo resta fermo
  const m = o.material = o.material.clone();
  m.side = THREE.DoubleSide; m.metalness = 0; m.roughness = 0.9;
  m.customProgramCacheKey = () => 'festone';
  m.onBeforeCompile = sh => {
    sh.uniforms.uT = { value: 0 }; VENTO_SH.push(sh);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uT;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{ vec4 wp = modelMatrix * vec4(position, 1.0);
  float w = clamp(-position.z / 0.42, 0.0, 1.0);          // 0 sul filo, 1 sulla punta
  transformed.y += sin(uT * 4.0 + wp.x * 0.7 + wp.z * 0.5 + position.x * 2.0) * 0.09 * w;
  transformed.x += sin(uT * 2.6 + wp.z * 0.9 + position.x) * 0.03 * w; }`);
  };
  o.castShadow = false;
}
function arredaPartenza(root){
  let nt = 0, nf = 0;
  root.traverse(o => {
    if (!o.isMesh) return;
    const nm = o.name || '';
    if (/^Transenna/.test(nm)) { o.castShadow = true; o.receiveShadow = true; if (o.material) { o.material.metalness = 0.6; o.material.roughness = 0.45; } nt++; }
    else if (/^Festone/.test(nm)) { vestiFestone(o); nf++; }
  });
  if (nt || nf) console.log('partenza: transenne', nt, 'festoni', nf);
}

// ---------- cumuli a billboard, con deriva lenta e ombra sul terreno ----------
const NNUBI = 14;
const NUBI_U = [];
for (let i = 0; i < NNUBI; i++) NUBI_U.push(new THREE.Vector3(1e6, 1e6, 1));
let TERR_SH = null, NUVOLE = [];
function nuvolaTex(seed){
  const c = document.createElement('canvas'); c.width = 256; c.height = 160;
  const x = c.getContext('2d');
  let sd = seed;
  const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  x.clearRect(0, 0, 256, 160);
  // base piatta e grigia sotto, batuffoli bianchi sopra
  const blobs = 9 + Math.floor(rnd() * 5);
  for (let i = 0; i < blobs; i++) {
    const bx = 40 + rnd() * 176, by = 70 + rnd() * 50, r = 26 + rnd() * 34;
    const g = x.createRadialGradient(bx, by - r * 0.25, r * 0.1, bx, by, r);
    const lum = 0.86 + 0.14 * (1 - (by - 60) / 70);
    g.addColorStop(0, 'rgba(255,255,255,' + (0.95 * lum).toFixed(2) + ')');
    g.addColorStop(0.55, 'rgba(' + [245, 247, 250].map(v => Math.round(v * lum)).join(',') + ',0.72)');
    g.addColorStop(1, 'rgba(225,230,238,0)');
    x.fillStyle = g; x.beginPath(); x.arc(bx, by, r, 0, 7); x.fill();
  }
  // base leggermente ombreggiata
  const gb = x.createLinearGradient(0, 95, 0, 150);
  gb.addColorStop(0, 'rgba(190,200,215,0)'); gb.addColorStop(1, 'rgba(170,180,200,0.35)');
  x.globalCompositeOperation = 'source-atop'; x.fillStyle = gb; x.fillRect(0, 90, 256, 70);
  x.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function buildNuvole(){
  const grp = new THREE.Group(); grp.name = 'Nuvole';
  const texs = [nuvolaTex(11), nuvolaTex(29), nuvolaTex(47)];
  let sd = 20261018;
  const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < NNUBI; i++) {
    // sparse sull'ellisse del mondo, sopra le vette (y scena 2300-2900 = 2780-3320 m reali)
    const ang = rnd() * Math.PI * 2, rr = 0.25 + 0.7 * Math.sqrt(rnd());
    const cx = FC.BC[0] + Math.cos(ang) * FC.BR[0] * rr, cz = FC.BC[1] + Math.sin(ang) * FC.BR[1] * rr;
    const cy = 2650 + rnd() * 550;
    const W = 360 + rnd() * 420;
    const nube = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const m = new THREE.SpriteMaterial({ map: texs[(i + k) % 3], transparent: true, depthWrite: false, fog: true, opacity: 0.92 });
      const sp = new THREE.Sprite(m);
      const w = W * (0.55 + rnd() * 0.5);
      sp.scale.set(w, w * 0.62, 1);
      sp.position.set((rnd() - 0.5) * W * 0.7, (rnd() - 0.5) * 40 + k * 18, (rnd() - 0.5) * W * 0.5);
      nube.add(sp);
    }
    nube.position.set(cx, cy, cz);
    nube.userData = { w: W, v: 1.6 + rnd() * 1.4 };
    grp.add(nube); NUVOLE.push(nube);
    NUBI_U[i].set(cx, cz, W * 0.55);
  }
  scene.add(grp);
}
function tickNuvole(dt){
  // deriva da NO verso SE (vento dominante), rientro dall'altro lato dell'ellisse
  for (let i = 0; i < NUVOLE.length; i++) {
    const n = NUVOLE[i];
    n.position.x += n.userData.v * 0.62 * dt; n.position.z += n.userData.v * 0.78 * dt;
    const ex = (n.position.x - FC.BC[0]) / FC.BR[0], ez = (n.position.z - FC.BC[1]) / FC.BR[1];
    if (ex * ex + ez * ez > 0.95) { n.position.x -= ex * FC.BR[0] * 1.9; n.position.z -= ez * FC.BR[1] * 1.9; }
    NUBI_U[i].set(n.position.x, n.position.z, n.userData.w * 0.55);
    // dentro o troppo vicino a una nuvola: si dissolve (niente lastre tagliate dal piano vicino)
    const dc = n.position.distanceTo(camera.position);
    const op = 0.92 * clamp((dc - n.userData.w * 0.7) / (n.userData.w * 0.8), 0, 1);
    for (const sp of n.children) sp.material.opacity = op;
  }
}
function buildNubiBasse(){
  const g = new THREE.Group(); g.name = 'NubiBasse';
  const geo = new THREE.SphereGeometry(1, 10, 8);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
  let lato = 1;
  for (const km of [16.15, 16.5, 16.85, 17.15, 17.5, 17.8, 18.1]) {
    posAt(km * 1000, tmpA); tanAt(km * 1000, tmpB);
    lato = -lato;
    const off = (36 + Math.random() * 48) * lato;
    const px2 = tmpA.x + tmpB.z * off, pz2 = tmpA.z - tmpB.x * off;
    const gy = groundAt(px2, pz2);
    const nucleo = new THREE.Group();
    for (let p2 = 0; p2 < 4; p2++) {
      const s = new THREE.Mesh(geo, mat);
      s.position.set((Math.random() - 0.5) * 24, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 15);
      s.scale.set(9 + Math.random() * 8, 3.2 + Math.random() * 2.4, 7 + Math.random() * 6);
      nucleo.add(s);
    }
    nucleo.position.set(px2, (gy > -1e3 ? gy : tmpA.y) + 26 + Math.random() * 18, pz2);
    g.add(nucleo);
  }
  scene.add(g);
}

function buildPins(){
  pinGroup = new THREE.Group();
  for (const p of route.pois) {
    if (p.tipo === 'start' || p.tipo === 'finish') continue;   // niente spillo sull'arco (partenza = arrivo): fa solo confusione
    const sp = new THREE.Sprite(pinSprite(PIN_COLORS[p.tipo] || '#ffffff'));
    posAt(p.km * 1000, tmpA);
    sp.position.copy(tmpA); sp.position.y += 16;
    sp.scale.setScalar(17);
    sp.userData.poi = p;
    pinGroup.add(sp);
  }
  scene.add(pinGroup);
  const ray = new THREE.Raycaster(), pt = new THREE.Vector2();
  let downXY = null;
  renderer.domElement.addEventListener('pointerdown', e => { downXY = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!downXY) return;
    const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]); downXY = null;
    if (moved > 7) return;
    pt.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(pt, camera);
    if ($('modal').classList.contains('on')) { closeModal(); return; }
    const hit = ray.intersectObjects(pinGroup.children, false)[0];
    if (hit) { openPoi(hit.object.userData.poi); return; }
    // targhette dei sentieri
    if (SENT && SENT_ON) {
      const hs = ray.intersectObjects(SENT.sprites.filter(sp => sp.visible && sp.material.opacity > 0.1), false)[0];
      if (hs) { openSentiero(hs.object.userData.sent); return; }
    }
    // vette: si tocca l'etichetta o la bandierina...
    const cand = [];
    for (const g of peakItems) if (g.visible && g.userData.lbl.material.opacity > 0.05) cand.push(g.userData.lbl, g.userData.flag, g.userData.asta);
    const hp = ray.intersectObjects(cand, false)[0];
    if (hp) { let g = hp.object; while (g && !g.userData.peak) g = g.parent; if (g) openPeak(g.userData.peak); return; }
    // ...oppure, anche da lontano e in volo col grifone, il punto piu' vicino al dito sullo schermo
    // (raggio 36 px, 48 col tocco): confronto in pixel, niente raycast sul terreno
    const R = e.pointerType === 'touch' ? 48 : 36;
    let best = null, bd = R;
    const sx = (innerWidth || 1280) * 0.5, sy = (innerHeight || 720) * 0.5;
    for (const g of peakItems) {
      if (!g.visible) continue;
      g.userData.lbl.getWorldPosition(tmpC);
      if (tmpC.distanceTo(camera.position) > 9000) continue;
      tmpC.project(camera);
      if (tmpC.z > 1) continue;                            // dietro la camera
      const d = Math.hypot((tmpC.x + 1) * sx - e.clientX, (1 - tmpC.y) * sy - e.clientY);
      if (d < bd) { bd = d; best = g.userData.peak; }
    }
    if (best) openPeak(best);
  });
}

// ---------- HUD ----------
// La barra superiore non deve MAI crescere: se il nome della via eccede,
// si riduce il carattere finche' entra nel tetto di #sent-lab (min 6.5px).
function fitVia() {
  const el = $('sent-lab'), vn = $('via-n');
  if (!vn) return;
  let fs = window.matchMedia('(max-width:700px)').matches ? 10 : 12;
  vn.style.fontSize = fs + 'px';
  while (el.scrollHeight > el.clientHeight + 1 && fs > 6.5) {
    fs -= 0.5;
    vn.style.fontSize = fs + 'px';
  }
}
window.addEventListener('resize', fitVia);

function updateHUD(){
  if (Math.abs(st.s - st.lastHudS) < 4 && st.sTarget === null) return;
  st.lastHudS = st.s;
  const km = Math.max(0, st.s) / 1000;
  $('v-km').textContent = km.toFixed(1).replace('.', ',');
  $('v-q').innerHTML = Math.round(quotaAt(st.s)) + '<span class="unit"> m</span>';
  const sA = Math.max(st.s - 80, 0), sB = Math.min(st.s + 80, TOT);
  const pRaw = (quotaAt(sB) - quotaAt(sA)) / Math.max(sB - sA, 1) * 100;
  st.pend = (st.pend === undefined) ? pRaw : st.pend + (pRaw - st.pend) * 0.35;
  const pShow = Math.round(st.pend);
  $('v-p').innerHTML = (pShow > 0 ? '+' : '') + pShow + '<span class="unit"> %</span>';
  if (cumDP) {
    const gi = Math.min(N - 1, Math.max(0, Math.round(st.s / TOT * (N - 1))));
    $('v-dp').innerHTML = Math.round(cumDP[gi]).toLocaleString('it-IT') + '<span class="unit"> m</span>';
  }
  const gts = route.gates || [];
  const g = gts.find(gg => gg[0] * 1000 > st.s + 2) || gts[gts.length - 1];
  if (g) {
    const ultimo = g === gts[gts.length - 1];
    const rem = Math.max(0, g[0] * 1000 - st.s) / 1000;
    $('g-lab').textContent = ultimo ? 'Tempo max \u00b7 arrivo' : 'Cancello \u00b7 km ' + g[0];
    $('v-g').innerHTML = g[2] + '<span class="unit"> fra ' + rem.toFixed(1).replace('.', ',') + ' km</span>';
  }
  const z = zoneAt(km), zi = route.zones.indexOf(z);
  if (zi !== st.curZone) { st.curZone = zi; $('zona-n').textContent = z[2]; $('zona-s').textContent = z[3]; }
  const rd = (route.roads || []).find(r => r.n && km >= r.a && km < r.b);
  const key = rd ? 'via:' + rd.n : 'tr:' + trailAt(km);
  if (st.curKey !== key) {
    st.curKey = key;
    if (rd) {
      $('chip').style.display = 'none';
      $('sent-lab').style.display = 'block';
      $('sent-lab').innerHTML = '<span id="via-lab">SU STRADA</span>' +
        '<span id="via-n">' + rd.n + '</span>';
      fitVia();
    } else {
      $('chip').style.display = 'flex';
      $('sent-lab').innerHTML = 'SENTIERO';
      $('chip').textContent = trailAt(km);
    }
  }
  let near = -1, best = 200;
  route.pois.forEach((p, i) => {
    const d = Math.abs(p.km * 1000 - st.s);
    if (d < best) { best = d; near = i; }
  });
  if (near !== st.curPoi) {
    st.curPoi = near;
    const b = $('poi-banner');
    if (near >= 0) { $('poi-n').textContent = route.pois[near].nome;
      $('poi-s').textContent = route.pois[near].sub; b.classList.add('on');
      b.onclick = () => openPoi(route.pois[near]);
    } else b.classList.remove('on');
  }
  drawProfilePos(); drawMiniPos();
  if (pinGroup) for (const sp of pinGroup.children) {
    const d = Math.abs(sp.userData.poi.km * 1000 - st.s);
    const o = clamp((d - 40) / 60, 0, 1);
    sp.material.opacity = 0.15 + 0.85 * o;
    sp.material.transparent = true;
  }
}

// ---------- profilo altimetrico ----------
function buildProfile(){
  profCv = $('prof-cv'); profCtx = profCv.getContext('2d');
  elevSamp = [];
  for (let i = 0; i <= 600; i++) elevSamp.push(quotaAt(i / 600 * TOT));
  sizeProfile();
  const go = e => {
    const r = profCv.getBoundingClientRect();
    const km = clamp((e.clientX - r.left - 34) / (r.width - 48), 0, 1) * TOT;
    st.sTarget = km; if (st.view === 'free') setView('follow');
  };
  let drag = false;
  profCv.addEventListener('pointerdown', e => { drag = true; go(e); });
  addEventListener('pointermove', e => { if (drag) go(e); });
  addEventListener('pointerup', () => { drag = false; });
}
let profBase = null;
function sizeProfile(){
  const w = Math.max(360, profCv.clientWidth || innerWidth || 1280);
  profCv.width = w * 2; profCv.height = 192;
  const x = profCtx, W = profCv.width, H = profCv.height, L = 68, R = 28, T = 22, B = 30;
  x.clearRect(0, 0, W, H);
  const emin = 650, emax = 2500;
  const X = i => L + (W - L - R) * i / 600;
  const Y = e => T + (H - T - B) * (1 - (e - emin) / (emax - emin));
  x.beginPath(); x.moveTo(X(0), H - B);
  for (let i = 0; i <= 600; i++) x.lineTo(X(i), Y(elevSamp[i]));
  x.lineTo(X(600), H - B); x.closePath();
  const gr = x.createLinearGradient(0, T, 0, H);
  gr.addColorStop(0, 'rgba(244,149,31,.45)'); gr.addColorStop(1, 'rgba(244,149,31,.06)');
  x.fillStyle = gr; x.fill();
  x.beginPath();
  for (let i = 0; i <= 600; i++) i ? x.lineTo(X(i), Y(elevSamp[i])) : x.moveTo(X(0), Y(elevSamp[0]));
  x.strokeStyle = '#f3efe2'; x.lineWidth = 3; x.stroke();
  x.font = '600 20px Oswald'; x.fillStyle = '#8d99a6'; x.textAlign = 'center';
  for (let k = 0; k <= 25; k += 5) x.fillText(k, X(k / route.total_km * 600), H - 8);
  x.fillText('km', X(290 / 600 * 600) + (W - L - R) * 0.485, H - 8);
  for (const g of route.gates) {
    const gx = X(g[0] / route.total_km * 600);
    x.strokeStyle = 'rgba(216,75,63,.9)'; x.setLineDash([6, 5]); x.lineWidth = 2;
    x.beginPath(); x.moveTo(gx, T); x.lineTo(gx, H - B); x.stroke(); x.setLineDash([]);
    x.fillStyle = '#d84b3f'; x.textAlign = 'center'; x.font = '600 17px Oswald';
    x.fillText(g[2], gx, T - 6);
  }
  for (const p of route.pois) {
    const px = X(p.km / route.total_km * 600), py = Y(quotaAt(p.km * 1000));
    x.beginPath(); x.arc(px, py, 5.5, 0, 7);
    x.fillStyle = PIN_COLORS[p.tipo] || '#fff'; x.fill();
    x.lineWidth = 2; x.strokeStyle = '#0c1f14'; x.stroke();
  }
  x.textAlign = 'left'; x.fillStyle = '#8d99a6'; x.font = '600 18px Oswald';
  x.fillText('2500', 6, Y(2500) + 6); x.fillText('700', 6, Y(700) + 6);
  profBase = x.getImageData(0, 0, W, H);
}
function drawProfilePos(){
  if (!profBase) return;
  const x = profCtx, W = profCv.width, H = profCv.height, L = 68, R = 28, T = 22, B = 30;
  x.putImageData(profBase, 0, 0);
  const i = Math.max(0, st.s) / TOT * 600;
  const px = L + (W - L - R) * i / 600;
  const py = T + (H - T - B) * (1 - (quotaAt(Math.max(0, st.s)) - 650) / (2500 - 650));
  x.beginPath(); x.moveTo(px, T); x.lineTo(px, H - B);
  x.strokeStyle = 'rgba(243,239,226,.5)'; x.lineWidth = 2; x.stroke();
  x.beginPath(); x.arc(px, py, 9, 0, 7); x.fillStyle = '#f4951f'; x.fill();
  x.lineWidth = 3; x.strokeStyle = '#fff'; x.stroke();
}

// ---------- minimappa ----------
function buildMinimap(){
  miniCv = $('minimap'); miniCtx = miniCv.getContext('2d');
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let i = 0; i < N; i += 4) {
    x0 = Math.min(x0, route.x[i]); x1 = Math.max(x1, route.x[i]);
    y0 = Math.min(y0, route.y[i]); y1 = Math.max(y1, route.y[i]);
  }
  const span = Math.max(x1 - x0, y1 - y0), pad = 22;
  miniPath = { x0: (x0 + x1) / 2 - span / 2, y0: (y0 + y1) / 2 - span / 2, span, pad };
  drawMiniPos();
}
function miniXY(i){
  const m = miniPath, S = miniCv.width - m.pad * 2;
  return [m.pad + (route.x[i] - m.x0) / m.span * S,
          miniCv.height - m.pad - (route.y[i] - m.y0) / m.span * S];
}
function drawMiniPos(){
  if (!miniCtx) return;
  const x = miniCtx;
  x.clearRect(0, 0, miniCv.width, miniCv.height);
  x.beginPath();
  for (let i = 0; i < N; i += 6) { const p = miniXY(i); i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]); }
  x.strokeStyle = 'rgba(243,239,226,.9)'; x.lineWidth = 4; x.lineJoin = 'round'; x.stroke();
  const pi = Math.round(st.s / TOT * (N - 1)), p = miniXY(Math.min(pi, N - 1));
  x.beginPath(); x.arc(p[0], p[1], 9, 0, 7); x.fillStyle = '#f4951f'; x.fill();
  x.lineWidth = 3; x.strokeStyle = '#fff'; x.stroke();
  if (FLY.on) {
    // il grifone: freccia orientata come la prua
    const m = miniPath, S = miniCv.width - m.pad * 2;
    const gx = m.pad + (FLY.pos.x - m.x0) / m.span * S;
    const gz = miniCv.height - m.pad - (-FLY.pos.z - m.y0) / m.span * S;
    x.save(); x.translate(gx, gz); x.rotate(Math.atan2(Math.sin(FLY.yaw), -Math.cos(FLY.yaw)) + Math.PI / 2);
    x.beginPath(); x.moveTo(0, -13); x.lineTo(9, 10); x.lineTo(0, 5); x.lineTo(-9, 10); x.closePath();
    x.fillStyle = '#f3efe2'; x.fill(); x.lineWidth = 2; x.strokeStyle = '#0c1f14'; x.stroke();
    x.restore();
  }
}

// ---------- UI ----------
function setView(v){
  st.view = v; st.follow = (v === 'follow');
  $('b-seg').classList.toggle('on', v === 'follow');
  const bp = $('b-pov'); if (bp) bp.classList.toggle('on', v === 'fpv');
  if (controls) controls.enabled = (v !== 'fpv');
  if (lino) lino.visible = (v !== 'fpv');
}
function setFollow(v, fromUser){ setView(v ? 'follow' : 'free'); }
function hold(btn, dir){
  const on = e => { e.preventDefault(); st.dir = dir; };
  const off = () => { if (st.dir === dir) st.dir = 0; };
  btn.addEventListener('pointerdown', on);
  addEventListener('pointerup', off);
  btn.addEventListener('pointerleave', off);
  btn.addEventListener('pointercancel', off);
}
function bindUI(){
  hold($('b-avt'), 1); hold($('b-ind'), -1);
  $('b-seg').onclick = () => setView('follow');
  const bp = $('b-pov'); if (bp) bp.onclick = () => setView(st.view === 'fpv' ? 'follow' : 'fpv');
  $('b-help').onclick = showHelp;
  $('b-gara').onclick = showGara;
  { const bs = $('b-sent'); if (bs) bs.onclick = () => toggleSentieri(); let pref = null; try { pref = localStorage.getItem('srm-sentieri'); } catch (e) {} if (pref === '1') setTimeout(() => toggleSentieri(true), 1500); }
  $('b-grif').onclick = () => { if (FLY.on) flyStop(); else flyStart(); };
  $('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  const key = (e, down) => {
    const k = e.key;
    if (FLY.on) {
      if (k === 'Escape' && down) { closeModal(); if (FLY.mode === 'tour') tourStop(); else flyStop(); return; }
      if ((k === 't' || k === 'T') && down) { if (FLY.mode === 'tour') tourStop(); else tourStart(); return; }
      if ((k === 'c' || k === 'C') && down) { cambiaSpecie(); return; }
      const K = st.keys;
      const map = { ArrowLeft: 'L', a: 'L', A: 'L', ArrowRight: 'R', d: 'R', D: 'R',
                    ArrowUp: 'U', w: 'U', W: 'U', ArrowDown: 'D', s: 'D', S: 'D', ' ': 'F' };
      const c = map[k];
      if (c) { down ? K.add(c) : K.delete(c); e.preventDefault(); }
      FLY.keyIn = [(K.has('R') ? 1 : 0) - (K.has('L') ? 1 : 0), (K.has('U') ? 1 : 0) - (K.has('D') ? 1 : 0)];
      FLY.flap = K.has('F');
      $('b-flap').classList.toggle('on', FLY.flap);
      return;
    }
    if (k === 'ArrowRight' || k === 'd' || k === 'D') { down ? st.keys.add('R') : st.keys.delete('R'); e.preventDefault(); }
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') { down ? st.keys.add('L') : st.keys.delete('L'); e.preventDefault(); }
    else if (k === 'Escape' && down) closeModal();
    st.dir = st.keys.has('R') ? 1 : (st.keys.has('L') ? -1 : 0);
  };
  addEventListener('keydown', e => key(e, true));
  addEventListener('keyup', e => key(e, false));
}
function openCard(html){
  try {
    $('card').innerHTML = html + '<button class="close" id="card-close">CHIUDI</button>';
    $('card-close').onclick = closeModal;
    $('modal').classList.add('on');
  } catch (e) { console.error('openCard:', e); }
}
function closeModal(){ $('modal').classList.remove('on'); }
// ---- natura lungo il percorso: dalla Guida naturalistica SRM 2026 (Studio di Incidenza
// Ambientale, Dr. B. Petriccione). Testi per chi corre o cammina, senza gergo.
// (Niente riferimenti al Piano di gestione ne' codici habitat: richiesta di Ale, 02/10.)
const NATURA = [
  { a: 0, b: 10, hab: 'Praterie secche e colline coltivate',
    txt: 'Prati magri su calcare, fra i più ricchi di orchidee spontanee dell\'Appennino: in maggio-giugno fioriscono, in ottobre sono bruni e silenziosi. Verso Passo Le Forche il sentiero sfiora un bosco di roverella, la quercia dei versanti caldi, senza mai attraversarlo. Nelle conche fresche il pioppo tremulo in autunno vira al giallo acceso: se lo vedi, lì sotto c\'è acqua.',
    fauna: 'Coturnice e lupo appenninico frequentano i valloni laterali e ti eviteranno molto prima che tu li veda. Alza lo sguardo: i grifoni passano anche qui.' },
  { a: 10, b: 15, hab: 'Praterie di cresta e, alla Capanna, i nardeti',
    txt: 'Sulle creste del Rozza l\'erba è fatta di piante durissime, abituate a vento, gelo e siccità: resistono a tutto tranne che al calpestio fuori sentiero. Cento metri intorno al rifugio ospitano un nardeto, un pascolo d\'altura che l\'Europa considera a rischio: il ristoro sta apposta sull\'area già nuda davanti alla capanna. Poco prima del rifugio, a bordo sentiero, cinquanta piante di adonide ricurva: fiorisce a inizio estate e non esiste in nessun altro luogo al mondo se non su queste montagne.',
    fauna: 'Il grifone (reintrodotto nel 1994, oggi circa 250 individui) sfrutta le correnti delle creste: da qui in su è l\'incontro più probabile della giornata. Una coppia di aquile reali nidifica in Valle Majelama e caccia su queste creste.' },
  { a: 15, b: 18.6, hab: 'Pavimenti calcarei e rupi',
    txt: 'Sopra i 2.200 m il suolo quasi scompare. La roccia incisa dall\'acqua ospita cuscinetti compatti di silene e sassifraga, larghi una mano ma vecchi di decenni: basta un piede fuori sentiero per cancellare mezzo secolo di crescita. Corri sulla roccia, non sui cuscinetti. Sulla cresta fra Velino e Cafornia duecento piante di adonide ricurva, endemismo dell\'Appennino centrale.',
    fauna: 'Le pareti della Val di Teve sono i nidi dei grifoni e del falco pellegrino. Con il sole d\'ottobre volano tutto il giorno.' },
  { a: 18.6, b: 22, hab: 'Praterie di cresta sui versanti del Cafornia',
    txt: 'Creste erbose e ghiaioni: nella breccia in movimento vivono piante che "nuotano" fra i sassi riemergendo ogni volta che vengono sepolte.',
    fauna: 'Sulle pendici sud del Cafornia vive la vipera dell\'Orsini, la più piccola e mite d\'Europa: mangia cavallette, è schivissima e a metà ottobre è già in letargo. Non la incontrerai.' },
  { a: 22, b: 30, hab: 'Praterie secche e campagna di Massa d\'Albe',
    txt: 'La grande discesa scende dalle praterie di cresta ai prati magri di fondovalle, poi a campi e querceti. Fonte Canale è una sorgente naturale ai piedi del massiccio. Nel territorio di Massa d\'Albe, ai piedi del Velino, ci sono i resti della città romana di Alba Fucens.',
    fauna: 'Il branco di lupi del Velino si muove fra Colle Cerretino, Piè di Cafornia e Valle Majelama: sono di casa, ma tu non li vedrai.' }
];
const naturaAt = km => NATURA.find(n => km >= n.a && km < n.b) || NATURA[NATURA.length - 1];
function schedaNatura(km){
  const n = naturaAt(km);
  return '<h3 style="margin-top:14px">Natura qui intorno</h3>' +
    '<p style="font-size:13px;color:var(--ambra);margin-bottom:4px">' + n.hab + '</p>' +
    '<p>' + n.txt + '</p><p style="margin-top:8px"><b>Chi vive qui.</b> ' + n.fauna + '</p>' +
    '<p style="margin-top:8px;color:var(--grigio);font-size:12px">Fonte: Guida naturalistica SRM 2026.</p>';
}
function openPoi(p){
  const km = p.km;
  // dove sei rispetto alla gara: cancello e ristoro successivi
  const gts = route.gates || [];
  const g = gts.find(gg => gg[0] > km + 0.05);
  let gara = '';
  if (g) gara += 'Prossimo cancello: km ' + g[0] + ' (' + g[2] + '). ';
  const rist = route.pois.filter(q => (q.tipo === 'water' || q.tipo === 'ristoro') && q.km > km + 0.05)[0];
  if (rist) gara += 'Prossimo punto acqua/ristoro: ' + rist.nome + ' al km ' + rist.km.toFixed(1).replace('.', ',') + ' (' + (rist.km - km).toFixed(1).replace('.', ',') + ' km).';
  const q = Math.round(quotaAt(km * 1000));
  openCard('<h2>' + p.nome + '</h2><h3>km ' + km.toFixed(1).replace('.', ',') + ' · ' + q + ' m · ' + p.sub + '</h3><p>' + p.card + '</p>' +
    (gara ? '<p style="margin-top:8px;font-size:13px">' + gara + '</p>' : '') + schedaNatura(km));
}
// scheda di una vetta vista dal sentiero (o dal grifone in volo): la stessa dell'atterraggio
function openPeak(p){ openCard(schedaVetta(p, true)); }
function showHelp(){
  openCard('<h2>Come si esplora</h2><h3>SRM Explorer</h3><ul>' +
    '<li><b>▶ / ◀</b> (o frecce della tastiera): Lino avanza e torna indietro lungo il percorso; tieni premuto per correre.</li>' +
    '<li><b>Trascina</b> con un dito o col mouse per girare intorno a Lino; <b>pizzica</b> o rotella per lo zoom.</li>' +
    '<li><b>SEGUI LINO</b> riaggancia la telecamera dietro di lui.</li>' +
    '<li>Il <b>profilo altimetrico</b> in basso è cliccabile: tocca un punto e Lino si posizioner\u00e0 su di esso.</li>' +
    '<li>Tocca i <b>segnaposto</b> lungo il percorso per le schede dei punti di interesse.</li>' +
    '<li>La barra in alto dice sempre <b>dove sei</b>: zona, km, quota e numero del sentiero.</li>' +
    '<li><b>GRIFONE</b>: voli libero sopra il Velino. Il grifone plana e perde quota da solo; ' +
    '<b>▲</b> picchia, <b>▼</b> cabra, <b>◀ ▶</b> vira, <b>SPAZIO</b> (o il pulsante) batte le ali per salire. ' +
    'Sul telefono usi il joystick e puoi scegliere di guidarlo <b>inclinando il telefono</b>. ' +
    'Se cabri troppo senza battere le ali va in <b>stallo</b>: picchia per riprendere velocità. ' +
    'Arriva lento e in assetto e <b>atterri</b> con le ali chiuse (tieni premuto BATTI per ripartire); troppo veloce contro il suolo e si riparte dal Cafornia. ' +
    'Cerca i versanti al sole e i grifoni che girano in tondo: le <b>ascendenze</b> ti portano su senza fatica, come fanno i grifoni veri. ' +
    '<b>SORVOLO</b> (tasto T): il grifone segue il percorso da solo, a 100 m sopra il sentiero, con la barra della gara; muovi un comando per riprenderlo.</li></ul>');
}
function showGara(){
  let g = '<h2>Skyrace del Maglio 2026</h2><h3>' + route.race_date + ' · start ore ' + route.start_time + ' · Magliano de\u2019 Marsi</h3>' +
    '<p>29,7 km e oltre 1.900 m di salita sulla rete sentieristica del Parco Naturale Regionale Sirente Velino, fino a quota 2.385 m alle spalle del Monte Velino.</p>' +
    '<table><tr><th>Cancello</th><th>Tempo</th><th>Orario</th></tr>';
  const nomi = ['Passo Le Forche · km 10', 'Capanna di Sevice · km 15', 'Traguardo · km 29,7'];
  route.gates.forEach((x, i) => { g += '<tr><td>' + nomi[i] + '</td><td>' + x[1] + '</td><td>' + x[2] + '</td></tr>'; });
  g += '</table><p style="margin-top:12px">Sentieri percorsi, nell\u2019ordine: ';
  route.trails.forEach(t => { g += '<span class="kchip">' + t[2] + '</span>'; });
  g += '</p><p style="margin-top:10px"><a href="https://www.skyracedelmaglio.it" target="_blank" rel="noopener" style="color:var(--ambra)">www.skyracedelmaglio.it</a></p>';
  openCard(g);
}



// ---------- colori del terreno: quota reale + pendenza ----------
let DETTEX = null;
function detailTex(){
  if (DETTEX) return DETTEX;
  const S = 256, n2 = S * S;
  let seed = 20260607;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const mk = passes => {
    let cur = new Float32Array(n2);
    for (let i = 0; i < n2; i++) cur[i] = rnd();
    for (let k = 0; k < passes; k++) {
      const nx = new Float32Array(n2);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        nx[y * S + x] = (cur[y * S + x] + cur[y * S + (x + 1) % S] + cur[y * S + (x + S - 1) % S] +
                         cur[((y + 1) % S) * S + x] + cur[((y + S - 1) % S) * S + x]) / 5;
      }
      cur = nx;
    }
    let mn = 1, mx = 0;
    for (let i = 0; i < n2; i++) { if (cur[i] < mn) mn = cur[i]; if (cur[i] > mx) mx = cur[i]; }
    const sc = mx > mn ? 1 / (mx - mn) : 1;
    for (let i = 0; i < n2; i++) cur[i] = (cur[i] - mn) * sc;
    return cur;
  };
  const A = mk(2), B = mk(5);
  const data = new Uint8Array(n2 * 4);
  for (let i = 0; i < n2; i++) {
    data[i * 4] = A[i] * 255; data[i * 4 + 1] = B[i] * 255; data[i * 4 + 2] = 128; data[i * 4 + 3] = 255;
  }
  DETTEX = new THREE.DataTexture(data, S, S);
  DETTEX.wrapS = DETTEX.wrapT = THREE.RepeatWrapping;
  DETTEX.magFilter = THREE.LinearFilter;
  DETTEX.minFilter = THREE.LinearMipmapLinearFilter;
  DETTEX.generateMipmaps = true;
  DETTEX.anisotropy = 4;
  DETTEX.needsUpdate = true;
  return DETTEX;
}
let _tintaTex = null;
function tintaTex(){
  if (_tintaTex || !ORTHO || !ORTHO.img) return _tintaTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.drawImage(ORTHO.img, 0, 0, 128, 128);
  _tintaTex = new THREE.CanvasTexture(c);
  _tintaTex.colorSpace = THREE.SRGBColorSpace;
  _tintaTex.wrapS = _tintaTex.wrapT = THREE.ClampToEdgeWrapping;
  return _tintaTex;
}
function colorizeTerrain(mesh){
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const A = route.elev_a, B = route.elev_b;
  const cGrass = [0.235, 0.36, 0.16], cMead = [0.42, 0.45, 0.235],
        cRock = [0.56, 0.52, 0.42], cTop = [0.70, 0.68, 0.62];
  for (let i = 0; i < n; i++) {
    const e = A * pos.getY(i) + B;
    let t1 = clamp((e - 950) / 520, 0, 1), t2 = clamp((e - 1680) / 430, 0, 1),
        t3 = clamp((e - 2150) / 300, 0, 1);
    let r = cGrass[0] * (1 - t1) + cMead[0] * t1,
        g2 = cGrass[1] * (1 - t1) + cMead[1] * t1,
        b = cGrass[2] * (1 - t1) + cMead[2] * t1;
    r = r * (1 - t2) + cRock[0] * t2; g2 = g2 * (1 - t2) + cRock[1] * t2; b = b * (1 - t2) + cRock[2] * t2;
    r = r * (1 - t3) + cTop[0] * t3; g2 = g2 * (1 - t3) + cTop[1] * t3; b = b * (1 - t3) + cTop[2] * t3;
    const up = nrm ? Math.abs(nrm.getY(i)) : 1;
    const st2 = clamp((0.86 - up) / 0.55, 0, 1) * 0.45;
    r = r * (1 - st2) + 0.52 * st2; g2 = g2 * (1 - st2) + 0.49 * st2; b = b * (1 - st2) + 0.44 * st2;
    if (ORTHO) { const wl = 0.75; r = r * (1 - wl) + wl; g2 = g2 * (1 - wl) + wl; b = b * (1 - wl) + wl; }
    col[i * 3] = r; col[i * 3 + 1] = g2; col[i * 3 + 2] = b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (ORTHO && ORTHO.img) {
    const uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      uv[i * 2] = (pos.getX(i) - ORTHO.x0) / (ORTHO.x1 - ORTHO.x0);
      uv[i * 2 + 1] = (-pos.getZ(i) - ORTHO.y0) / (ORTHO.y1 - ORTHO.y0);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const tex = new THREE.Texture(ORTHO.img);
    tex.needsUpdate = true;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const matT = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 1, metalness: 0 });
    matT.onBeforeCompile = sh => { TERR_SH = sh; compilaTerreno(sh, tintaTex()); };
    mesh.material = matT;
  } else {
    mesh.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  }
}
// lo shader del terreno (roccia procedurale, affioramenti, macchie, grana vicina, ombre dei cumuli):
// condiviso dal terreno interno e dall'anello esterno
function compilaTerreno(sh, tinta){
  {
      sh.uniforms.uDet = { value: detailTex() };
      sh.uniforms.uTinta = { value: tinta };
      sh.uniforms.uNubi = { value: NUBI_U };
      sh.uniforms.uQual = QUAL_U;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vDetXZ;\nvarying vec2 vUvO;\nvarying float vNy;\nvarying float vWy;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDetXZ = (modelMatrix * vec4(position, 1.0)).xz;\nvUvO = uv;\nvNy = normalize(mat3(modelMatrix) * normal).y;\nvWy = (modelMatrix * vec4(position, 1.0)).y;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uDet;\nuniform sampler2D uTinta;\nuniform vec3 uNubi[' + NNUBI + '];\nuniform float uQual;\nvarying vec2 vDetXZ;\nvarying vec2 vUvO;\nvarying float vNy;\nvarying float vWy;')
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  // C: roccia procedurale sulle pareti ripide (la foto stirata sparisce)
  float ripida = smoothstep(0.86, 0.62, abs(vNy));
  // affioramenti e pietraie sopra i ~2000 m reali (y scena > 1420): chiazze di roccia
  // guidate dal rumore a grande scala, piu' estese dove il pendio e' comunque ripido
  {
    float alto = smoothstep(1380.0, 1620.0, vWy);
    float a1 = texture2D(uDet, vDetXZ / 210.0).r;
    float a2 = texture2D(uDet, vDetXZ / 55.0).g;
    float soglia = 0.62 - 0.18 * smoothstep(0.98, 0.80, abs(vNy));
    float aff = smoothstep(soglia, soglia + 0.12, a1 * 0.7 + a2 * 0.3) * alto;
    ripida = max(ripida, aff * 0.85);
  }
  if (ripida > 0.003) {
    vec3 tinta = texture2D(uTinta, vUvO).rgb;
    float s1 = texture2D(uDet, vDetXZ / 23.0).r;
    float s2 = texture2D(uDet, vDetXZ / 91.0).g;
    float s3 = texture2D(uDet, vDetXZ / 7.0).g;
    float s4 = texture2D(uDet, vDetXZ / 263.0).r;
    float s5 = texture2D(uDet, vDetXZ / 47.0).g;
    // strati appena accennati, frequenza e fase variabili, dominano le chiazze irregolari
    float distors = (s2 - 0.5) * 90.0 + (s1 - 0.5) * 18.0;
    float freq = 0.42 * (0.7 + 0.6 * s4);
    float banda = 0.5 + 0.5 * sin((vWy + distors) * freq);
    banda = mix(banda, s5, 0.5);
    float lum = 0.58 + 0.62 * (0.20 * banda + 0.30 * s1 + 0.16 * s3 + 0.34 * s4);
    diffuseColor.rgb = mix(diffuseColor.rgb, tinta * lum, ripida);
  }
  float d1 = texture2D(uDet, vDetXZ / 19.0).r;
  float d2 = texture2D(uDet, vDetXZ / 141.0).g;
  diffuseColor.rgb *= mix(0.84, 1.16, d1) * mix(0.92, 1.08, d2);
  // macchie di media e bassa quota (sotto i ~2000 m), sorelle degli affioramenti di cresta:
  // chiazze di arbusti e boscaglia scura nei pascoli e nei coltivi, radure chiare di terra e calcare
  // sui pendii, e una lenta variazione di tinta che fonde i colori delle zone dell'ortofoto
  {
    float basso = 1.0 - smoothstep(1380.0, 1620.0, vWy);
    float m1 = texture2D(uDet, vDetXZ / 160.0).g;
    float m2 = texture2D(uDet, vDetXZ / 38.0).r;
    float m3 = texture2D(uDet, vDetXZ / 12.0).g;
    float verde = smoothstep(0.0, 0.10, diffuseColor.g - max(diffuseColor.r, diffuseColor.b));
    float arb = smoothstep(0.58, 0.70, m1 * 0.55 + m2 * 0.30 + m3 * 0.15) * basso * (0.45 + 0.55 * verde);
    vec3 cArb = diffuseColor.rgb * vec3(0.60, 0.70, 0.52) * (0.85 + 0.3 * m3);
    float pend = smoothstep(0.97, 0.88, abs(vNy));
    float rad = smoothstep(0.71, 0.80, m2 * 0.6 + m3 * 0.4) * (1.0 - arb) * basso * (0.35 + 0.65 * pend);
    vec3 cRad = mix(diffuseColor.rgb, vec3(0.76, 0.71, 0.60) * (0.8 + 0.4 * m3), 0.6);
    diffuseColor.rgb = mix(diffuseColor.rgb, cArb, arb * 0.85);
    diffuseColor.rgb = mix(diffuseColor.rgb, cRad, rad * 0.7);
    // tinta lenta: scalda o raffredda a chiazze larghe (fonde i confini fra prato, bosco e coltivo)
    float t1 = texture2D(uDet, vDetXZ / 420.0).r;
    diffuseColor.rgb *= mix(vec3(0.95, 0.97, 1.04), vec3(1.05, 1.02, 0.94), t1) * basso + vec3(1.0 - basso);
  }
  // dettaglio ravvicinato (sotto i ~350 m dalla camera): grana fine dell'erba e ciuffi,
  // sfuma con la distanza cosi' da lontano la texture resta quella di prima
  {
    float dist = distance(cameraPosition, vec3(vDetXZ.x, vWy, vDetXZ.y));
    float vicino = (1.0 - smoothstep(120.0, 380.0, dist)) * step(0.5, uQual);   // livello essenziale: niente grana
    if (vicino > 0.002) {
      float g1 = texture2D(uDet, vDetXZ / 2.6).g;
      float g2 = texture2D(uDet, vDetXZ / 0.9).r;
      float g3 = texture2D(uDet, vDetXZ / 6.5).r;
      float erba = 1.0 - ripida;
      // ciuffi: macchie piu' chiare/gialle e solchi scuri, solo sull'erba
      float ciuffo = smoothstep(0.55, 0.75, g3) * erba;
      vec3 tintaCiuffo = vec3(1.04, 1.02, 0.90);
      float grana = mix(0.90, 1.10, g1) * mix(0.95, 1.05, g2);
      vec3 det = diffuseColor.rgb * grana * mix(vec3(1.0), tintaCiuffo, ciuffo * 0.45);
      // sulla roccia: grana piu' dura e contrastata
      det = mix(det, diffuseColor.rgb * mix(0.80, 1.22, g1) * mix(0.9, 1.1, g2), ripida);
      diffuseColor.rgb = mix(diffuseColor.rgb, det, vicino);
    }
  }
  // ombre morbide dei cumuli che scorrono sul terreno
  float ombra = 1.0;
  for (int i = 0; i < ${NNUBI}; i++) {
    vec3 nb = uNubi[i];
    float dn = distance(vDetXZ, nb.xy) / max(nb.z, 1.0);
    ombra *= 1.0 - 0.30 * (1.0 - smoothstep(0.55, 1.0, dn));
  }
  diffuseColor.rgb *= ombra;
  vec3 gGr = vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)));
  diffuseColor.rgb = clamp((mix(gGr, diffuseColor.rgb, 1.30) - 0.5) * 1.07 + 0.5, 0.0, 1.0);
}`);
  }
}


// ---------- cielo: cupola con gradiente, sole e foschia all'orizzonte ----------
// Una sfera che segue la camera; il colore all'orizzonte e' anche il colore della nebbia,
// cosi' terreno lontano e cielo si fondono senza stacco. Due tavolozze: alba (Lino) e
// mezzogiorno d'estate (grifone).
let SKY = null;
const SKYPAL = {
  alba:  { zen: 0x5f8ecc, hor: 0xe4e2da, sunC: 0xfff0d2, haze: 0.50 },
  giorno:{ zen: 0x2d6cc6, hor: 0xc6dcef, sunC: 0xfff8ec, haze: 0.35 }
};
function buildSky(){
  const geo = new THREE.SphereGeometry(24000, 40, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uZen: { value: new THREE.Color(SKYPAL.alba.zen) },
      uHor: { value: new THREE.Color(SKYPAL.alba.hor) },
      uSunC: { value: new THREE.Color(SKYPAL.alba.sunC) },
      uSun: { value: new THREE.Vector3(SUNDIR.x, SUNDIR.y, SUNDIR.z).normalize() },
      uHaze: { value: SKYPAL.alba.haze }
    },
    vertexShader: 'varying vec3 vDir;\nvoid main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w * 0.99999; }',
    fragmentShader: `uniform vec3 uZen, uHor, uSunC, uSun; uniform float uHaze; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float t = clamp(d.y, -0.2, 1.0);
        // gradiente: zenit -> orizzonte, con una fascia di foschia bassa
        float k = pow(max(t, 0.0), 0.55);
        vec3 c = mix(uHor, uZen, k);
        float bassa = 1.0 - smoothstep(0.0, 0.05 + 0.08 * uHaze, max(t, 0.0));
        c = mix(c, uHor, bassa * uHaze);
        // sotto l'orizzonte: foschia uniforme (la gonna del mondo e' dello stesso colore)
        c = mix(c, uHor, smoothstep(-0.02, -0.45, d.y));
        // sole: disco + alone largo
        float s = max(dot(d, uSun), 0.0);
        float disco = smoothstep(0.9993, 0.9998, s);
        float alone = pow(s, 90.0) * 0.55 + pow(s, 9.0) * 0.16;
        c += uSunC * (disco * 1.6 + alone);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        // all'orizzonte il cielo deve essere IDENTICO alla nebbia di three (che scrive il
        // colore grezzo dopo il tone mapping): stessa miscela grezza, niente riga di stacco
        float hb = 1.0 - smoothstep(0.0, 0.05, d.y);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, linearToOutputTexel(vec4(uHor, 1.0)).rgb, hb);
      }`
  });
  SKY = new THREE.Mesh(geo, mat);
  SKY.name = 'Sky'; SKY.frustumCulled = false; SKY.renderOrder = -10;
  scene.add(SKY);
  skyPalette('alba');
}
function skyPalette(nome){
  const p = SKYPAL[nome]; if (!SKY || !p) return;
  SKY.material.uniforms.uZen.value.set(p.zen);
  SKY.material.uniforms.uHor.value.set(p.hor);
  SKY.material.uniforms.uSunC.value.set(p.sunC);
  SKY.material.uniforms.uHaze.value = p.haze;
  scene.background.set(p.hor); scene.fog.color.set(p.hor);
  if (skirt) skirt.material.color.set(p.hor);
}

// ---------- ortofoto, griglia altezze, brecciato ----------
let ORTHO = null, HG = null, sunLight = null, SHADOWS = false, HEMI = null, SEVICE = null;

// ---------- qualita' adattiva: livello scelto dal dispositivo, poi regolato sugli FPS misurati ----------
// 0 essenziale (telefoni deboli)  1 medio  2 alto  3 massimo (PC). Ogni livello dosa risoluzione,
// ombre, dettaglio ravvicinato del terreno, facciate, numero di alberi e nuvole, distanza della nebbia.
const QUAL_U = { value: 2 };            // uniform condiviso dagli shader (terreno, case)
const FOG_VOLO = [3800, 6500, 9500, 11500];   // nebbia in volo per livello: con l'anello esterno si vede lontano
const QUAL = { liv: 2, tetto: 3, mob: false, t: 0, n: 0, ok: 0, avvio: 0 };
const VEG_IM = [];                      // { im, n }: mesh istanziate della vegetazione
function qualIniziale(){
  const mob = /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent);
  QUAL.mob = mob;
  const q = new URLSearchParams(location.search).get('q');
  if (q !== null && /^[0-3]$/.test(q)) { QUAL.lock = true; return +q; }      // ?q=0..3 per le prove (livello bloccato)
  if (!mob) return 3;
  const mem = navigator.deviceMemory || 4, cpu = navigator.hardwareConcurrency || 4;
  if (mem <= 3 || cpu <= 4) return 0;
  if (mem <= 4 || cpu <= 6) return 1;
  return 2;
}
function applicaQualita(l){
  l = clamp(l, 0, QUAL.tetto);
  QUAL.liv = l; QUAL_U.value = l;
  if (renderer) {
    const dpr = devicePixelRatio || 1;
    renderer.setPixelRatio([1, Math.min(dpr, 1.5), Math.min(dpr, 2), Math.min(dpr, 2)][l]);
  }
  if (SHADOWS && sunLight) sunLight.castShadow = l >= 2;     // spegnere la luce-ombra ricompila da solo i programmi
  const fr = [0.55, 0.8, 1, 1][l];
  for (const v of VEG_IM) v.im.count = Math.max(1, Math.round(v.n * fr));
  for (let i = 0; i < NUVOLE.length; i++) NUVOLE[i].visible = l > 0 || i % 2 === 0;
  if (scene && scene.fog) scene.fog.far = FLY.on ? FOG_VOLO[l] : (l === 0 ? 11000 : 18000);
  console.log('qualita\':', ['essenziale', 'media', 'alta', 'massima'][l]);
}
// guardia prestazioni: finestre di 3 s sul dt reale (non su quello limitato del gioco); sotto i 27 fps
// si scende di un livello e quel livello diventa il tetto; sopra i 50 fps per tre finestre si risale
function guardiaFps(dtReale){
  QUAL.t += dtReale; QUAL.n++;
  if (QUAL.t < 3) return;
  const fps = QUAL.n / QUAL.t; QUAL.t = 0; QUAL.n = 0;
  if (QUAL.lock || performance.now() < QUAL.avvio + 8000) return;        // i primi secondi: compilazione shader, caricamenti
  if (fps < 27 && QUAL.liv > 0) { QUAL.tetto = QUAL.liv - 1; applicaQualita(QUAL.liv - 1); QUAL.ok = 0; }
  else if (fps > 50 && QUAL.liv < QUAL.tetto) { if (++QUAL.ok >= 3) { applicaQualita(QUAL.liv + 1); QUAL.ok = 0; } }
  else QUAL.ok = 0;
}
const SUNDIR = { x: -0.52, y: 0.62, z: -0.58 };
const OC = [0, 0, 0];
async function loadOrtho(){
  try {
    const j = await (await fetch('assets/ortho.json?' + VER)).json();
    const img = new Image();
    img.src = 'assets/ortho.jpg?' + VER;
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('timeout ortho.jpg')), 9000);
      const ok = () => { clearTimeout(t); res(); };
      if (img.complete && img.naturalWidth) return ok();
      img.onload = ok;
      img.onerror = () => { clearTimeout(t); rej(new Error('ortho.jpg illeggibile')); };
    });
    const c = document.createElement('canvas'); c.width = c.height = j.n;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, j.n, j.n);
    ORTHO = Object.assign({}, j, { px: x.getImageData(0, 0, j.n, j.n).data, img: img });
    console.log('ortofoto pronta');
  } catch (e) { console.warn('ortho assente:', e.message); }
}
function orthoColor(xb, yb, out){
  const u = (xb - ORTHO.x0) / (ORTHO.x1 - ORTHO.x0);
  const v = (ORTHO.y1 - yb) / (ORTHO.y1 - ORTHO.y0);
  if (u < 0 || v < 0 || u >= 1 || v >= 1) return false;
  const i = (Math.floor(v * (ORTHO.n - 1)) * ORTHO.n + Math.floor(u * (ORTHO.n - 1))) * 4;
  out[0] = Math.pow(ORTHO.px[i] / 255, 2.2);
  out[1] = Math.pow(ORTHO.px[i + 1] / 255, 2.2);
  out[2] = Math.pow(ORTHO.px[i + 2] / 255, 2.2);
  return true;
}
async function loadHeights(){
  try {
    const j = await (await fetch('assets/height.json?' + VER)).json();
    const b = await (await fetch('assets/height.bin?' + VER)).arrayBuffer();
    HG = Object.assign({}, j, { data: new Uint16Array(b) });
  } catch (e) { console.warn('height assente:', e.message); }
}
// La griglia height.bin ha zone sbagliate (una fascia a sud di Magliano segna 1400 dove la mesh sta a
// -35: da li' le case "sospese"). Dopo l'avvio si confronta ogni cella con la mesh vera, a fette,
// e si corregge dove lo scarto supera i 40 m.
function correggiGriglia(){
  if (!HG || !TIDX) return;
  let j = 0, n = 0;
  const passo = () => {
    const t0 = performance.now();
    for (; j < HG.ny && performance.now() - t0 < 6; j++) {
      const yb = HG.y0 + (HG.y1 - HG.y0) * j / (HG.ny - 1);
      for (let i = 0; i < HG.nx; i++) {
        const xb = HG.x0 + (HG.x1 - HG.x0) * i / (HG.nx - 1);
        const g = HG.data[j * HG.nx + i] * HG.scala;
        const t = terraVera(xb, -yb, g);
        if (t > -1e3 && t !== g && Math.abs(t - g) > 40) { HG.data[j * HG.nx + i] = Math.max(0, Math.round(t / HG.scala)); n++; }
      }
    }
    if (j < HG.ny) setTimeout(passo, 30); else if (n) console.log('griglia quote corretta:', n, 'celle');
  };
  setTimeout(passo, 1500);
}
function groundAt(x, z){
  if (!HG) return -1e4;
  const xb = x, yb = -z;
  const u = (xb - HG.x0) / (HG.x1 - HG.x0) * (HG.nx - 1);
  const v = (yb - HG.y0) / (HG.y1 - HG.y0) * (HG.ny - 1);
  if (u < 0 || v < 0 || u > HG.nx - 1.001 || v > HG.ny - 1.001) return groundExt(x, z);
  const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
  const gg = (jj, ii) => HG.data[Math.min(jj, HG.ny - 1) * HG.nx + Math.min(ii, HG.nx - 1)] * HG.scala;
  return gg(j, i) * (1 - fu) * (1 - fv) + gg(j, i + 1) * fu * (1 - fv) +
         gg(j + 1, i) * (1 - fu) * fv + gg(j + 1, i + 1) * fu * fv;
}
// ---------- anello esterno: i monti intorno (Sirente, Magnola, Duchessa, Ocre, Carseolani...) ----------
// Quote da AWS Terrain Tiles (z12, ~28 m) e Sentinel-2 cloudless (EOX), georeferenziati sulla scena
// correlando il DEM con height.bin (rotazione 1,14 gradi = convergenza UTM). File: dem_ext.bin/json
// (griglia 640x640, riga 0 = sud, come height.bin) e ortho_ext.jpg (2048, nord in alto).
let HG2 = null, EXT = null;
const VETTE_EXT = [
  // n, quota, x scena, y scena (blender, nord +), scheda
  ['Monte Sirente', 2348, 18935, 554, 'Il gigante gemello del Velino, dall’altra parte dell’Altopiano delle Rocche: insieme danno il nome al Parco regionale Sirente-Velino. Una lunga dorsale calcarea con la parete nord che precipita sulla Valle Subequana; ai suoi piedi, sui Prati del Sirente, c’è una piccola conca con un laghetto a lungo studiata come possibile cratere meteoritico.'],
  ['Monte Magnola', 2220, 6358, 436, 'La montagna di Ovindoli: sul suo versante corrono le piste della stazione sciistica Ovindoli-Monte Magnola, la più grande della Marsica. Dalla cima si abbraccia tutto l’Altopiano delle Rocche e, a ovest, la cresta del Velino.'],
  ['Monte Ocre', 2208, 5486, 13138, 'La vetta delle Montagne di Bagno, che chiudono a sud la conca dell’Aquila: dalla cima la vista si apre sulla città e sul Gran Sasso. È dentro il Parco Sirente-Velino.'],
  ['Monte Cagno', 2153, 7037, 11955, 'La cima gemella dell’Ocre, sopra Rocca di Cambio, il comune più alto dell’Appennino (1.434 m). Prati di cresta e boschi di faggio sul versante aquilano.'],
  ['Murolungo', 2184, -3218, 4498, 'La cima più alta delle Montagne della Duchessa, già in Lazio: sotto le sue pareti c’è il Lago della Duchessa, a 1.788 m, uno dei laghi più alti dell’Appennino. Riserva naturale regionale.'],
  ['Monte Puzzillo', 2174, 1103, 7373, 'Fra il Velino e la piana di Campo Felice: d’inverno è la cima più frequentata con le ciaspole, perché si sale dalla stazione sciistica. Dalla vetta la cresta del Velino è tutta davanti.'],
  ['Monte Morrone', 2141, -4441, 6429, 'Il Morrone della Duchessa, spalla del Murolungo sul versante laziale del gruppo: pascoli d’altura e grandi valloni che scendono verso Cartore, il borgo abbandonato da cui parte il sentiero per il lago.'],
  ['Monte Cava', 2000, -7226, 10741, 'Nel Cicolano, al confine fra Lazio e Abruzzo: la dorsale che guarda la Valle del Salto e il suo lago artificiale.'],
  ['Monte Orsello', 2043, -1278, 12297, 'Sopra Tornimparte e Campo Felice, sul lato aquilano del gruppo del Velino: prati di cresta e faggete.'],
  ['Serra di Celano', 1921, 14067, -4084, 'La lunga cresta rocciosa sopra Celano (la cima si chiama Monte Tino): alle sue pendici si aprono le Gole di Celano, un canyon stretto e profondo che si percorre a piedi, uno dei luoghi più spettacolari della Marsica.'],
  ['Monte Midia', 1737, -16365, -9098, 'La cima più alta dei Monti Carseolani, al confine con il Lazio: sul suo versante ci sono le piste di Marsia, la piccola stazione sciistica di Tagliacozzo.'],
  ['Monte Padiglione', 1627, -11424, -12678, 'Montagna boscosa sopra Tagliacozzo, fra la Marsica e la valle del Turano.'],
  ['Monte Salviano', 1026, 1522, -12998, 'La collina di Avezzano: riserva naturale con la Via Crucis e il santuario della Madonna di Pietraquaria. È il balcone sul Fucino, la piana che fino al 1875 era il terzo lago d’Italia.'],
  ['Monte Arunzo', 1455, -6750, -13283, 'Fra Capistrello e Castellafiume, dove la Marsica scende nella Valle Roveto.'],
  ['Cima di Vallevona', 1818, -17472, -13439, 'Sui Monti Simbruini, al confine con il Lazio, sopra l’altopiano di Camporotondo (Cappadocia).']
];
async function loadExt(){
  try {
    const j = await (await fetch('assets/dem_ext.json?' + VER)).json();
    const b = await (await fetch('assets/dem_ext.bin?' + VER)).arrayBuffer();
    HG2 = Object.assign({}, j, { data: new Uint16Array(b) });
  } catch (e) { console.warn('dem_ext assente:', e.message); }
}
function groundExt(x, z){
  if (!HG2) return -1e4;
  const xb = x, yb = -z, G = HG2;
  const u = (xb - G.x0) / (G.x1 - G.x0) * (G.nx - 1);
  const v = (yb - G.y0) / (G.y1 - G.y0) * (G.ny - 1);
  if (u < 0 || v < 0 || u > G.nx - 1.001 || v > G.ny - 1.001) return -1e4;
  const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
  const gg = (jj, ii) => G.data[Math.min(jj, G.ny - 1) * G.nx + Math.min(ii, G.nx - 1)] * G.scala + G.off;
  return gg(j, i) * (1 - fu) * (1 - fv) + gg(j, i + 1) * fu * (1 - fv) +
         gg(j + 1, i) * (1 - fu) * fv + gg(j + 1, i + 1) * fu * fv;
}
function buildTerrenoEsterno(){
  if (!HG2 || !HG) return;
  const G = HG2;
  // griglia piu' fitta vicino al terreno interno, piu' rada ai bordi; densita' dal livello di qualita'
  const N = QUAL.liv >= 3 ? 224 : QUAL.liv === 2 ? 176 : QUAL.liv === 1 ? 128 : 96;
  const asse = (a0, a1, c0, c1) => {
    // c0..c1 = intervallo interno (celle piu' fitte ~ 1/3 della spaziatura esterna)
    const out = [];
    const L = a1 - a0, Li = c1 - c0, Lo = L - Li;
    const wi = Li * 3 / (Li * 3 + Lo);          // frazione di nodi dedicata all'interno
    const ni = Math.max(8, Math.round(N * wi)), no = N - ni;
    const nl = Math.round(no * (c0 - a0) / Lo), nr = no - nl;
    for (let k = 0; k < nl; k++) { const t = k / nl; out.push(a0 + (c0 - a0) * (1 - Math.pow(1 - t, 1.6))); }
    for (let k = 0; k <= ni; k++) out.push(c0 + Li * k / ni);
    for (let k = 1; k <= nr; k++) { const t = k / nr; out.push(c1 + (a1 - c1) * Math.pow(t, 1.6)); }
    return out;
  };
  const xs = asse(G.x0, G.x1, HG.x0 - 1500, HG.x1 + 1500);
  const ys = asse(G.y0, G.y1, HG.y0 - 1500, HG.y1 + 1500);
  const nx = xs.length, ny = ys.length;
  const pos = new Float32Array(nx * ny * 3), uv = new Float32Array(nx * ny * 2);
  const OV = 220;      // sovrapposizione col terreno interno (m): dentro il bordo l'anello scende sotto
  const dentro = (x, y) => x > HG.x0 + OV && x < HG.x1 - OV && y > HG.y0 + OV && y < HG.y1 - OV;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = xs[i], y = ys[j];
    let h = groundExt(x, -y);
    // nella fascia di sovrapposizione si abbassa gradualmente, cosi' il terreno interno resta sopra
    const dIn = Math.min(x - HG.x0, HG.x1 - x, y - HG.y0, HG.y1 - y);
    if (dIn > -300) h -= 2 + 14 * clamp((dIn + 300) / 500, 0, 1);
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = -y;
    uv[k * 2] = (x - G.x0) / (G.x1 - G.x0); uv[k * 2 + 1] = (y - G.y0) / (G.y1 - G.y0);
  }
  // un sotto-mesh per ogni tassello 4x4 della texture ad alta risoluzione (caricata quando ci si avvicina)
  const NT = 4, idxT = []; for (let k = 0; k < NT * NT; k++) idxT.push([]);
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    if (dentro(xs[i], ys[j]) && dentro(xs[i + 1], ys[j + 1])) continue;   // buco sotto il terreno interno
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
    const ti = clamp(Math.floor((cx - G.x0) / (G.x1 - G.x0) * NT), 0, NT - 1), tj = clamp(Math.floor((cy - G.y0) / (G.y1 - G.y0) * NT), 0, NT - 1);
    idxT[tj * NT + ti].push(a, b, c, b, d, c);
  }
  const posA = new THREE.BufferAttribute(pos, 3), uvA = new THREE.BufferAttribute(uv, 2);
  const tex = new THREE.TextureLoader().load('assets/ortho_ext.jpg?' + VER);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  // tinta per la roccia procedurale: una miniatura della texture (canvas 128)
  const tinta = new THREE.CanvasTexture(document.createElement('canvas'));
  tinta.image.width = 128; tinta.image.height = 128;
  const ctx = tinta.image.getContext('2d'); ctx.fillStyle = '#8c8878'; ctx.fillRect(0, 0, 128, 128);
  const img = new Image(); img.onload = () => { ctx.drawImage(img, 0, 0, 128, 128); tinta.needsUpdate = true; }; img.src = 'assets/ortho_ext.jpg?' + VER;
  tinta.colorSpace = THREE.SRGBColorSpace;
  const grp = new THREE.Group(); grp.name = 'TerrenoEsterno';
  EXT_TILES = [];
  let ntri = 0;
  for (let k = 0; k < NT * NT; k++) {
    if (!idxT[k].length) continue;
    const ti = k % NT, tj = Math.floor(k / NT);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', posA); geo.setAttribute('uv', uvA);
    geo.setIndex(idxT[k]); geo.computeVertexNormals(); geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 });
    const uUvA = { value: new THREE.Vector4(1, 1, 0, 0) };     // (scala, offset) sulle uv della mappa
    mat.onBeforeCompile = sh => {
      compilaTerreno(sh, tinta);
      sh.uniforms.uUvA = uUvA;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec4 uUvA;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = (vMapUv - uUvA.zw) * uUvA.xy;\n#endif');
    };
    mat.customProgramCacheKey = () => 'terreno-ext';
    const m = new THREE.Mesh(geo, mat);
    m.name = 'TerrenoEsterno_' + ti + '_' + tj; m.receiveShadow = false; m.castShadow = false; m.frustumCulled = true;
    m.renderOrder = -1;
    grp.add(m);
    const cx = G.x0 + (G.x1 - G.x0) * (ti + 0.5) / NT, cz = -(G.y0 + (G.y1 - G.y0) * (tj + 0.5) / NT);
    EXT_TILES.push({ m, mat, uUvA, ti, tj, cx, cz, raggio: Math.hypot((G.x1 - G.x0) / NT, (G.y1 - G.y0) / NT) / 2, stato: 0 });
    ntri += idxT[k].length / 3;
  }
  scene.add(grp);
  EXT = grp;
  console.log('anello esterno:', nx + 'x' + ny, 'vertici', nx * ny, 'triangoli', ntri, 'tasselli', EXT_TILES.length);
}
// texture ad alta risoluzione dell'anello (assets/ext/t_i_j.jpg, 1536 px, ~7 m/px come l'ortho interna):
// si carica il tassello quando la camera e' entro ~7 km dal suo bordo, uno alla volta; sui livelli bassi
// di qualita' resta la texture di base. Niente scaricamento: una volta caricato resta.
let EXT_TILES = [], extT = 0, extLoading = false;
const EXT_TEX_LOADER = new THREE.TextureLoader();
function tickExtTiles(dt){
  if (!EXT_TILES.length || QUAL.liv === 0) return;
  extT += dt; if (extT < 0.5) return; extT = 0;
  if (extLoading) return;
  let best = null, bd = 1e12;
  for (const t of EXT_TILES) {
    if (t.stato) continue;
    const d = Math.max(0, Math.hypot(camera.position.x - t.cx, camera.position.z - t.cz) - t.raggio);
    if (d < 7000 && d < bd) { bd = d; best = t; }
  }
  if (!best) return;
  best.stato = 1; extLoading = true;
  EXT_TEX_LOADER.load('assets/ext/t_' + best.ti + '_' + best.tj + '.jpg?' + VER, tx => {
    tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8; tx.wrapS = tx.wrapT = THREE.ClampToEdgeWrapping;
    best.mat.map = tx; best.mat.needsUpdate = false;
    best.uUvA.value.set(4, 4, best.ti / 4, best.tj / 4);
    best.stato = 2; extLoading = false;
  }, undefined, () => { best.stato = 3; extLoading = false; });
}
// vette dei monti intorno: come quelle del Velino, con quota dal DEM esterno
function aggiungiVetteEsterne(){
  if (!HG2 || !route.peaks) return;
  for (const v of VETTE_EXT) {
    const h = groundExt(v[2], -v[3]);
    if (h < -1e3) continue;
    const quota = (v[1] - route.elev_b) / route.elev_a;    // la vetta vera sta un po' sopra il DEM lisciato
    route.peaks.push({ n: v[0], e: v[1], x: v[2], y: v[3], z: Math.max(h, quota - 3), ext: true });
    PEAK_INFO[v[0]] = [v[4], ''];
  }
}

// REGOLA FISSA: ogni oggetto appoggiato al suolo passa da poggia() —
// il punto piu' basso del bounding box tocca terra (+3 cm), mai annegato ne' volante.
function poggia(obj, margine = 0.03){
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return;
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  let gy = groundAt(cx, cz);
  try {
    let terr = null;
    scene.traverse(o => { if (!terr && o.isMesh && (o.name || '').startsWith('Terrain')) terr = o; });
    if (terr) {
      const rc = new THREE.Raycaster(new THREE.Vector3(cx, box.max.y + 120, cz),
                                     new THREE.Vector3(0, -1, 0), 0, 600);
      const hit = rc.intersectObject(terr, false)[0];
      if (hit) gy = hit.point.y;
    }
  } catch (e) {}
  if (gy < -1e3) return;
  obj.position.y += gy - box.min.y + margine;
}
function colorizeTrail(mesh){
  // nastro a 2 colonne di vertici: il bordo arancione sull'asfalto vive nel fragment shader
  const g = mesh.geometry, p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  const aSide = new Float32Array(p.count);
  const aAsf = new Float32Array(p.count);
  const orange = [0.907, 0.31, 0.012], brec = [0.44, 0.415, 0.365];
  const ASF = (route.roads || []).filter(r => r.asf).map(r => [r.a, r.b])
    .concat([[0, 0.50], [29.25, route.total_km]]);
  // linea centrale del NASTRO dai suoi stessi vertici (le due rotaie si alternano
  // in modo bilanciato: una media mobile di indici e' il centro locale del nastro)
  const cxA = new Float64Array(p.count + 1), czA = new Float64Array(p.count + 1);
  for (let i = 0; i < p.count; i++) {
    cxA[i + 1] = cxA[i] + p.getX(i);
    czA[i + 1] = czA[i] + p.getZ(i);
  }
  const cw = (a, b) => [(cxA[b + 1] - cxA[a]) / (b - a + 1), (czA[b + 1] - czA[a]) / (b - a + 1)];
  // aggancio INSEGUITO: il nastro e' costruito in ordine lungo il percorso, quindi ogni
  // vertice cerca solo vicino all'aggancio del precedente - un vertice dell'andata non
  // puo' agganciare il ritorno dove le due gambe corrono sulla stessa strada.
  let bjPrev = 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    let best = 1e12, bj = bjPrev;
    for (let j = Math.max(0, bjPrev - 40); j <= Math.min(N - 1, bjPrev + 40); j++) {
      const dx = route.x[j] - x, dz = -route.y[j] - z;
      const d = dx * dx + dz * dz;
      if (d < best) { best = d; bj = j; }
    }
    if (best > 900) {   // aggancio perso: ricerca globale di sicurezza
      for (let j = 0; j < N; j += 3) {
        const dx = route.x[j] - x, dz = -route.y[j] - z;
        const d = dx * dx + dz * dz;
        if (d < best) { best = d; bj = j; }
      }
      for (let j = Math.max(0, bj - 3); j <= Math.min(N - 1, bj + 3); j++) {
        const dx = route.x[j] - x, dz = -route.y[j] - z;
        const d = dx * dx + dz * dz;
        if (d < best) { best = d; bj = j; }
      }
    }
    bjPrev = bj;
    const km = bj / (N - 1) * route.total_km;
    // lato del nastro (0/1): segno rispetto alla linea centrale del NASTRO stesso
    // (robusto anche ai tappi d'estremita' e agli spigoli, dove la polilinea GPX diverge)
    const W8 = 8;
    const c0 = cw(Math.max(0, i - W8), Math.min(p.count - 1, i + W8));
    const cb = cw(Math.max(0, i - 2 * W8), i);
    const cf = cw(i, Math.min(p.count - 1, i + 2 * W8));
    const sd = (cf[0] - cb[0]) * (z - c0[1]) - (cf[1] - cb[1]) * (x - c0[0]);
    aSide[i] = sd > 0 ? 1 : 0;
    let ta = 0;
    for (const r of ASF) {
      ta = Math.max(ta, clamp((km - r[0] + 0.06) / 0.1, 0, 1) * clamp((r[1] - km + 0.06) / 0.1, 0, 1));
    }
    aAsf[i] = ta;
    const t = clamp((km - 5.72) / 0.16, 0, 1) * clamp((6.68 - km) / 0.16, 0, 1);
    let nz = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    nz = nz - Math.floor(nz);
    const nn = t > 0 ? 0.82 + 0.36 * nz : 1;
    for (let c = 0; c < 3; c++) {
      col[i * 3 + c] = (orange[c] * (1 - t) + brec[c] * t) * nn;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
  g.setAttribute('aAsf', new THREE.BufferAttribute(aAsf, 1));
  // collaudo: nessun triangolo deve avere i 3 vertici sullo stesso lato
  if (g.index) {
    let uni = 0;
    const ix = g.index.array;
    for (let k = 0; k < ix.length; k += 3) {
      if (aSide[ix[k]] === aSide[ix[k + 1]] && aSide[ix[k + 1]] === aSide[ix[k + 2]]) uni++;
    }
    window._trailUni = uni;
    if (uni > 0) console.warn('nastro: ' + uni + ' triangoli con lato uniforme');
  }
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSide; attribute float aAsf; varying float vSide; varying float vAsf;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSide = aSide; vAsf = aAsf;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vSide; varying float vAsf;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n{\n  float bordo = smoothstep(0.68, 0.86, abs(vSide * 2.0 - 1.0));\n  vec3 grigioAsf = vec3(0.30, 0.305, 0.32);\n  vec3 aranc = vec3(0.907, 0.31, 0.012);\n  diffuseColor.rgb = mix(diffuseColor.rgb, mix(grigioAsf, aranc, bordo), vAsf);\n}');
  };
  mesh.material = m;
}


// ---------- facciate e tetti delle case: finestre, porte, zoccolo, tegole — tutto nel shader ----------
// Le case sono scatole (muri) + falde (tetti). Per ogni parete verticale si calcola una volta, in JS,
// un sistema di coordinate locale (u lungo la parete, v in altezza) e le dimensioni della parete;
// il fragment shader dispone finestre e porte per piano e per campata, senza tagli agli spigoli,
// e aggiunge zoccolo, intonaco variato per parete e tegole sulle falde. Zero triangoli in piu'.
const CASE_SH = [];
function arredaCase(root){
  const isMuro = m => /^muro|^TB_int|intonaco/i.test(m.name || '');
  const isTetto = m => /^tetto|^TB_roof|roof/i.test(m.name || '');
  const tetti = [];
  const N = new THREE.Vector3(), P = new THREE.Vector3(), Q = new THREE.Vector3(), R = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const muro = isMuro(o.material), tetto = isTetto(o.material);
    if (!muro && !tetto) return;
    if (tetto) tetti.push(o);
    let g = o.geometry;
    if (g.index) { g = g.toNonIndexed(); o.geometry = g; }
    const pos = g.getAttribute('position'), nv = pos.count;
    const aUV = new Float32Array(nv * 2), aWall = new Float32Array(nv * 3);
    if (muro) {
      // raggruppa i triangoli per piano (normale + offset) = una parete
      const groups = new Map(), tri = [];
      const m = o.matrixWorld;
      for (let i = 0; i < nv; i += 3) {
        P.fromBufferAttribute(pos, i).applyMatrix4(m); Q.fromBufferAttribute(pos, i + 1).applyMatrix4(m); R.fromBufferAttribute(pos, i + 2).applyMatrix4(m);
        N.copy(Q).sub(P).cross(R.clone().sub(P));
        if (N.lengthSq() < 1e-9) { tri.push(null); continue; }
        N.normalize();
        if (Math.abs(N.y) > 0.35) { tri.push(null); continue; }      // non e' una parete verticale
        const d = N.dot(P);
        const key = Math.round(N.x * 20) + '_' + Math.round(N.z * 20) + '_' + Math.round(d / 0.25);
        let gr = groups.get(key);
        if (!gr) { gr = { n: N.clone(), t: new THREE.Vector3(N.z, 0, -N.x).normalize(), umin: 1e9, umax: -1e9, vmin: 1e9, vmax: -1e9, tris: [] }; groups.set(key, gr); }
        for (const W of [P, Q, R]) { const u = W.dot(gr.t), v = W.y; if (u < gr.umin) gr.umin = u; if (u > gr.umax) gr.umax = u; if (v < gr.vmin) gr.vmin = v; if (v > gr.vmax) gr.vmax = v; }
        gr.tris.push(i); tri.push(gr);
      }
      let gid = 0;
      for (const gr of groups.values()) {
        gr.id = (gid++ * 0.618 + o.position.x * 0.013 + o.position.z * 0.017) % 1;
      }
      for (let i = 0; i < nv; i += 3) {
        const gr = tri[i / 3];
        for (let k = 0; k < 3; k++) {
          const j = i + k;
          if (!gr) { aWall[j * 3] = 0; aWall[j * 3 + 1] = 0; aWall[j * 3 + 2] = 0; continue; }
          P.fromBufferAttribute(pos, j).applyMatrix4(o.matrixWorld);
          aUV[j * 2] = P.dot(gr.t) - gr.umin; aUV[j * 2 + 1] = P.y - gr.vmin;
          aWall[j * 3] = gr.umax - gr.umin; aWall[j * 3 + 1] = gr.vmax - gr.vmin; aWall[j * 3 + 2] = gr.id;
        }
      }
    }
    g.setAttribute('aUV', new THREE.BufferAttribute(aUV, 2));
    g.setAttribute('aWall', new THREE.BufferAttribute(aWall, 3));
    const mat = o.material = o.material.clone();
    // three mette in cache i programmi per testo di onBeforeCompile: muro e tetto hanno lo stesso
    // testo sorgente, quindi serve una chiave esplicita o il tetto riusa il programma del muro
    mat.customProgramCacheKey = () => muro ? 'casa-muro' : 'casa-tetto';
    mat.onBeforeCompile = sh => {
      CASE_SH.push(sh);
      sh.uniforms.uQual = QUAL_U;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aUV; attribute vec3 aWall; varying vec2 vUVc; varying vec3 vWall; varying vec3 vWp; varying float vNyc;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUVc = aUV; vWall = aWall; vWp = (modelMatrix * vec4(position, 1.0)).xyz; vNyc = normalize(mat3(modelMatrix) * normal).y;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec2 vUVc; varying vec3 vWall; varying vec3 vWp; varying float vNyc;
uniform float uQual;
float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float nz2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hsh(i), hsh(i + vec2(1, 0)), f.x), mix(hsh(i + vec2(0, 1)), hsh(i + vec2(1, 1)), f.x), f.y); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  ${muro ? `
  float W = vWall.x, H = vWall.y, id = vWall.z;
  if (W > 1.5 && H > 2.0) {
    vec3 col = diffuseColor.rgb;
    // intonaco: tinta leggermente diversa per parete, grana e macchie di umido in basso
    col *= 0.94 + 0.12 * hsh(vec2(id, 0.3));
    col *= 0.96 + 0.08 * nz2(vUVc * 2.3 + id * 10.0);
    // zoccolo di pietra/cemento sotto i 0,9 m
    float zoc = 1.0 - smoothstep(0.85, 0.95, vUVc.y);
    col = mix(col, vec3(0.62, 0.60, 0.56) * (0.9 + 0.2 * nz2(vUVc * 6.0)), zoc * 0.9);
    // piani e campate
    float piano = 3.0;
    float nP = max(1.0, floor((H - 0.4) / piano));
    float nW = max(1.0, floor(W / 3.4));
    float cellW = W / nW;
    float cx = floor(vUVc.x / cellW), fx = vUVc.x - cx * cellW;      // campata e posizione nella campata
    float py = floor(vUVc.y / piano), fy = vUVc.y - py * piano;        // piano e altezza nel piano
    float hw = hsh(vec2(id * 37.0 + cx, py));                         // caso per finestra
    if (py < nP && uQual > 0.5) {
      float ww = 1.15, wh = 1.45, wb = 0.95;                             // finestra: larghezza, altezza, davanzale
      bool porta = (py == 0.0) && (cx == floor(hsh(vec2(id, 7.0)) * nW));
      if (porta) { ww = 1.15; wh = 2.25; wb = 0.0; }
      float dx = abs(fx - cellW * 0.5), dyc = fy - wb;
      bool dentro = dx < ww * 0.5 && dyc > 0.0 && dyc < wh;
      bool cornice = dx < ww * 0.5 + 0.13 && dyc > -0.13 && dyc < wh + 0.13;
      if (hw > 0.12 || porta) {
        if (dentro) {
          if (porta) col = vec3(0.30, 0.20, 0.12) * (0.85 + 0.3 * nz2(vec2(fx * 8.0, fy * 2.0)));   // legno
          else {
            // vetro scuro con riflesso del cielo e traversa
            vec3 vetro = mix(vec3(0.10, 0.13, 0.18), vec3(0.45, 0.55, 0.68), smoothstep(0.2, 1.4, dyc) * 0.6);
            float trav = step(abs(dx - 0.0), 0.04) + step(abs(dyc - wh * 0.5), 0.04);
            col = mix(vetro, vec3(0.85, 0.83, 0.78), clamp(trav, 0.0, 1.0));
            // persiane socchiuse su alcune finestre
            if (hsh(vec2(cx + 3.0, py + id * 5.0)) > 0.62) col = vec3(0.30, 0.42, 0.32) * (0.78 + 0.35 * step(0.55, fract(dyc * 4.5)));
          }
        } else if (cornice) {
          col = porta ? vec3(0.55, 0.52, 0.48) : vec3(0.90, 0.88, 0.84);
        }
        // ombra del davanzale
        if (!porta && dx < ww * 0.5 + 0.13 && dyc < -0.13 && dyc > -0.30) col *= 0.75;
      }
    }
    // cornicione: banda chiara sotto il tetto
    if (H - vUVc.y < 0.35) col = mix(col, vec3(0.92, 0.90, 0.86), 0.7);
    diffuseColor.rgb = col;
  }` : `
  // tetto: tegole (file lungo la pendenza) su falde inclinate, grana sui tetti piani
  vec3 col = diffuseColor.rgb;
  float pend = 1.0 - smoothstep(0.97, 0.995, abs(vNyc));
  // tinta coccio piu' decisa, file di tegole (ogni ~38 cm di quota lungo la falda) con l'ombra di ciascuna
  col = mix(col, col * vec3(1.0, 0.72, 0.56), 0.6);
  float filo = fract(vWp.y * 2.6 + nz2(vWp.xz * 1.3) * 0.06);
  float tegola = smoothstep(0.0, 0.18, filo) * (1.0 - smoothstep(0.62, 1.0, filo));
  float colonne = 0.9 + 0.1 * step(0.5, fract((vWp.x + vWp.z) * 3.0));
  col *= mix(1.0, (0.58 + 0.5 * tegola) * colonne, pend) * (0.90 + 0.18 * nz2(vWp.xz * 3.1));
  col *= 0.90 + 0.2 * hsh(floor(vWp.xz / 6.0));
  // colmo chiaro
  col = mix(col, col * 1.15, pend * smoothstep(0.985, 1.0, abs(vNyc)));
  diffuseColor.rgb = col;`}
}`);
    };
  });
  try { buildComignoli(tetti, root.name || ('r' + tetti.length)); } catch (e) { console.warn('comignoli:', e); }
}

// ---------- sentieri CAI della zona (OSM, relazioni route=hiking) ----------
// Pulsante SENTIERI: nastri bianco/rosso a tratti sul terreno (1,3 m, leggermente trasparenti) e
// targhette rosso-bianco-rosso con il numero. Dove il sentiero coincide col percorso di gara non si
// disegna (resta il nastro arancione e l'indicazione in alto a destra). Costruiti alla prima accensione.
let SENT = null, SENT_ON = false, sentT = 0;
const SENT_TEX = {};
function targhettaSentiero(txt){
  if (SENT_TEX[txt]) return SENT_TEX[txt];
  // segnavia CAI: tre bande verticali rosso-bianco-rosso, numero nero nella banda bianca
  const c = document.createElement('canvas'); c.width = 192; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#d7212b'; x.fillRect(0, 0, 192, 128);
  const bw = txt.length > 3 ? 112 : 80;
  x.fillStyle = '#f6f3ea'; x.fillRect(96 - bw / 2, 0, bw, 128);
  x.fillStyle = '#111'; x.textAlign = 'center'; x.textBaseline = 'middle';
  let fs = txt.length > 6 ? 30 : txt.length > 4 ? 40 : txt.length > 2 ? 52 : 68;
  x.font = '700 ' + fs + 'px Oswald, Arial';
  while (x.measureText(txt).width > bw - 10 && fs > 18) { fs -= 2; x.font = '700 ' + fs + 'px Oswald, Arial'; }
  x.fillText(txt, 96, 66);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  SENT_TEX[txt] = t; return t;
}
function buildSentieri(data){
  const grp = new THREE.Group(); grp.name = 'Sentieri';
  const W = 1.8, PASSO = 6, TRATTO = 3.5;
  const pos = [], col = [], idx = [];
  const targhette = [];
  const rosso = [0.84, 0.13, 0.15], bianco = [0.96, 0.95, 0.90];
  const quota = (x, z) => { let g = terraVera(x, z, groundAt(x, z) + 30); if (g < -1e3) g = groundAt(x, z); return g; };
  for (const L of data.linee) {
    const P = L.p;
    // ricampiona la polilinea ogni PASSO metri (segue il terreno), con lunghezza cumulata
    const pts = []; let acc = 0;
    const seg = (ax, az, bx, bz, snap) => {
      const d = Math.hypot(bx - ax, bz - az); if (d < 0.01) return;
      const n = Math.max(1, Math.ceil(d / PASSO));
      for (let k = 0; k < n; k++) { const t = k / n; pts.push([ax + (bx - ax) * t, az + (bz - az) * t, acc + d * t, snap]); }
      acc += d;
    };
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      if (a[2] && b[2] && a[3] !== undefined && b[3] !== undefined && Math.abs(a[3] - b[3]) < 400) {
        // entrambi agganciati al percorso di gara: si segue il percorso punto per punto
        const st0 = a[3] < b[3] ? 1 : -1;
        let px = route.x[a[3]], pz = -route.y[a[3]];
        for (let j = a[3] + st0; st0 > 0 ? j <= b[3] : j >= b[3]; j += st0) { seg(px, pz, route.x[j], -route.y[j], 1); px = route.x[j]; pz = -route.y[j]; }
      } else seg(a[0], -a[1], b[0], -b[1], a[2] && b[2] ? 1 : 0);
      if (i === P.length - 2) pts.push([b[0], -b[1], acc, b[2] ? 1 : 0]);
    }
    if (pts.length < 2) continue;
    const base = pos.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const [x, z, s] = pts[i];
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(pts.length - 1, i + 1)];
      let tx = p1[0] - p0[0], tz = p1[1] - p0[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const nx = tz, nz = -tx;
      const y = quota(x, z) + (pts[i][3] ? 0.45 : 0.5);   // sul percorso di gara resta sotto il nastro arancione
      pos.push(x - nx * W / 2, y, z - nz * W / 2, x + nx * W / 2, y, z + nz * W / 2);
      const cc = Math.floor(s / TRATTO) % 2 ? bianco : rosso;
      col.push(cc[0], cc[1], cc[2], cc[0], cc[1], cc[2]);
      if (i < pts.length - 1) { const a = base + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    // targhette: a meta' delle linee lunghe e poi ogni 700 m
    const refTxt = L.r[0];   // sulla targhetta una sigla sola (le altre nella scheda)
    if (acc > 120) {
      const passi = [acc / 2]; for (let s = 700; s < acc - 300; s += 700) passi.push(s);
      for (const sS of passi) {
        const k = pts.findIndex(q => q[2] >= sS); if (k < 0) continue;
        const [x, z] = pts[k];
        targhette.push({ x, y: quota(x, z) + 4.2, z, txt: refTxt, refs: L.r });
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.78, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const nastro = new THREE.Mesh(g, m); nastro.name = 'SentieriNastro'; nastro.renderOrder = 0; nastro.frustumCulled = false;
  grp.add(nastro);
  const sprites = [];
  for (const t of targhette) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: targhettaSentiero(t.txt), transparent: true, depthTest: false, opacity: 0 }));
    sp.position.set(t.x, t.y, t.z); sp.scale.set(7.5, 5, 1); sp.userData = { sent: t, vis: 0 };
    sp.renderOrder = 3; grp.add(sp); sprites.push(sp);
  }
  scene.add(grp);
  SENT = { grp, sprites, info: data.info };
  console.log('sentieri:', data.linee.length, 'linee,', idx.length / 3, 'triangoli,', sprites.length, 'targhette');
}
async function toggleSentieri(forza){
  const on = forza === undefined ? !SENT_ON : !!forza;
  if (on && !SENT) {
    try {
      const data = await (await fetch('assets/sentieri.json?' + VER)).json();
      if (!TIDX) { try { TIDX = buildTerrIndex(); } catch (e) {} }
      buildSentieri(data);
    } catch (e) { console.warn('sentieri:', e); openCard('<h2>Sentieri</h2><p>Dati dei sentieri non disponibili.</p>'); return; }
  }
  SENT_ON = on;
  if (SENT) SENT.grp.visible = on;
  const b = $('b-sent'); if (b) b.classList.toggle('on', on);
  try { localStorage.setItem('srm-sentieri', on ? '1' : '0'); } catch (e) {}
}
// targhette dei sentieri: come quelle delle vette, solo a campo aperto e vicine (entro 2,5 km)
function tickSentieri(dt){
  if (!SENT || !SENT_ON) return;
  sentT += dt; if (sentT < 0.2) return; sentT = 0;
  for (const sp of SENT.sprites) {
    const d = camera.position.distanceTo(sp.position);
    let oT = 0;
    if (d < 2600) {
      const o = d < 500 ? 1 : Math.max(0.35, 1 - (d - 500) / 2400);
      oT = lineaLibera(camera.position, sp.position) ? o : 0;
    }
    sp.userData.vis += (oT - sp.userData.vis) * 0.45;
    sp.material.opacity = sp.userData.vis;
    sp.visible = sp.userData.vis > 0.02;
    if (sp.visible) { const k = clamp(d * 0.014, 7, 26); sp.scale.set(k, k * 0.667, 1); }
  }
}
// scheda di un sentiero (tocco sulla targhetta)
function openSentiero(t){
  const righe = t.refs.map(r => {
    const i = (SENT && SENT.info[r]) || {};
    const rete = i.rete === 'iwn' ? 'sentiero europeo' : i.rete === 'rwn' ? 'rete regionale' : 'rete CAI locale';
    return '<tr><th>' + r + '</th><td>' + (i.nome ? '<b>' + i.nome + '</b><br>' : '') + (i.da || i.a ? (i.da || '?') + ' → ' + (i.a || '?') + '<br>' : '') + '<span style="color:var(--grigio)">' + rete + '</span></td></tr>';
  }).join('');
  openCard('<h2>Sentiero ' + t.refs.join(' · ') + '</h2><h3>segnavia bianco-rosso</h3><table>' + righe + '</table>' +
    '<p style="margin-top:10px;font-size:13px;color:var(--grigio)">Tracciati della rete escursionistica da OpenStreetMap (rete CAI). Dove un sentiero coincide con il percorso di gara è disegnato solo il nastro arancione.</p>');
}

// ---------- bandierine fantasma delle vette ----------
let peakItems = [], peakT = 0;
function peakLabel(nome, quota){
  const mis = document.createElement('canvas').getContext('2d');
  mis.font = '400 86px Anton, Oswald, sans-serif';
  const testo = nome.toUpperCase() + (quota ? '  \u00b7  ' + quota + ' m' : '');
  const cw = Math.min(1900, Math.max(420, Math.ceil(mis.measureText(testo).width) + 120));
  const c = document.createElement('canvas'); c.width = cw; c.height = 192;
  const x = c.getContext('2d');
  x.font = '400 86px Anton, Oswald, sans-serif';
  const w = cw - 24;
  const x0 = 12;
  x.fillStyle = 'rgba(12,31,20,0.84)';
  x.beginPath();
  if (x.roundRect) x.roundRect(x0, 32, w, 128, 48); else x.rect(x0, 32, w, 128);
  x.fill();
  x.strokeStyle = 'rgba(243,239,226,0.9)'; x.lineWidth = 5; x.stroke();
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = '#f3efe2';
  x.fillText(testo, cw / 2, 100);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return { tex, aspect: cw / 192 };
}
function buildPeaks(){
  if (!route.peaks || !route.peaks.length) return;
  const grp = new THREE.Group();
  // asta sottile con puntale, bandiera di stoffa che sventola (onda nel vertex shader):
  // arancio SRM con banda avorio e bordo verde scuro (texture canvas), un anello alla base
  const astaGeo = new THREE.CylinderGeometry(0.22, 0.34, 34, 8);
  const astaMat = new THREE.MeshStandardMaterial({ color: 0xe9e4d6, metalness: 0.4, roughness: 0.5, transparent: true, opacity: 0.85 });
  const puntaGeo = new THREE.SphereGeometry(0.75, 10, 8);
  const flagGeo = new THREE.PlaneGeometry(13, 7.5, 16, 6);
  flagGeo.translate(6.5, -3.75, 0);
  const flagTex = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 148;
    const x = c.getContext('2d');
    x.fillStyle = '#f4951f'; x.fillRect(0, 0, 256, 148);
    x.fillStyle = '#f3efe2'; x.fillRect(0, 56, 256, 36);
    x.fillStyle = '#0c1f14'; x.fillRect(0, 0, 256, 7); x.fillRect(0, 141, 256, 7); x.fillRect(0, 0, 8, 148);
    // grafica: profilo di montagna stilizzato sulla banda
    x.fillStyle = '#0c1f14'; x.beginPath(); x.moveTo(96, 88); x.lineTo(118, 62); x.lineTo(130, 74); x.lineTo(146, 58); x.lineTo(168, 88); x.closePath(); x.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  })();
  for (const p of route.peaks) {
    const g = new THREE.Group();
    g.position.set(p.x, p.z, -p.y);
    const asta = new THREE.Mesh(astaGeo, astaMat.clone());
    asta.position.y = 17;
    const punta = new THREE.Mesh(puntaGeo, new THREE.MeshStandardMaterial({ color: 0xf4951f, metalness: 0.3, roughness: 0.5, transparent: true, opacity: 0.95 }));
    punta.position.y = 34.6;
    const fm = new THREE.MeshBasicMaterial({ map: flagTex, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
    fm.onBeforeCompile = shd => {
      shd.uniforms.uT = { value: 0 }; VENTO_SH.push(shd);
      shd.vertexShader = shd.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uT;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  // stoffa: onda che cresce verso il bordo libero (x da 0 a 13), fase dalla posizione nel mondo
  float w = position.x / 13.0;
  float fase = uT * 3.2 + modelMatrix[3].x * 0.01 + modelMatrix[3].z * 0.013;
  transformed.z += sin(w * 5.0 - fase) * 1.1 * w * w + sin(w * 9.0 - fase * 1.7) * 0.35 * w;
  transformed.y += sin(w * 3.0 - fase * 0.8) * 0.25 * w;
}`);
    };
    const flag = new THREE.Mesh(flagGeo, fm);
    flag.position.y = 33.6;
    // la bandiera sventola sottovento (vento da NO -> verso SE)
    flag.rotation.y = -Math.atan2(VENTO.z, VENTO.x);
    const pl = peakLabel(p.n, p.e);
    const lbl = new THREE.Sprite(new THREE.SpriteMaterial({ map: pl.tex, transparent: true, depthTest: false }));
    lbl.position.y = 46;
    lbl.userData.aspect = pl.aspect;
    lbl.scale.set(20.6 * pl.aspect, 20.6, 1);
    g.add(asta, punta, flag, lbl);
    g.userData = { lbl, flag, asta, punta, peak: p };
    // sul Velino c'e' la croce di vetta (modello GEV): niente asta ne' bandiera, solo l'etichetta
    if (/velino|cafornia/i.test(p.n)) { asta.visible = punta.visible = flag.visible = false; lbl.position.y = 62; }
    grp.add(g); peakItems.push(g);
  }
  scene.add(grp);
  console.log('vette:', route.peaks.map(p => p.n).join(' | '));
}

// ---------- vegetazione e sassi istanziati ----------
const VENTO_SH = [];
async function loadVeg(loader){
  const r = await fetch('assets/veg.json?' + VER);
  if (!r.ok) return;
  const veg = await r.json();
  const pg = await loadGLB(loader, 'assets/protos.glb?' + VER, () => {});
  const lib = {};
  pg.scene.traverse(o => { if (o.isMesh) lib[o.name] = o; });
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(),
        S = new THREE.Vector3(), E = new THREE.Euler();
  // spettatori: mai sopra ~1700 m reali (y scena 1088), mai a meno di 6 m dal nastro
  const rxs = [], rys = [];
  for (let i = 0; i < N; i += 4) { rxs.push(route.x[i]); rys.push(route.y[i]); }
  const dNastro = (x, y) => {
    let dm = 1e9;
    for (let i = 0; i < rxs.length; i++) {
      const d = (rxs[i] - x) * (rxs[i] - x) + (rys[i] - y) * (rys[i] - y);
      if (d < dm) dm = d;
    }
    return Math.sqrt(dm);
  };
  for (const key of Object.keys(veg.inst)) {
    let arr = veg.inst[key];
    const proto = lib[veg.protos[key]];
    if (!proto || !arr.length) continue;
    const isGent = key === 'Sphere_155' || key.startsWith('Cone_03') ||
                   /^M_EX_gen/.test((proto.material && proto.material.name) || '');
    if (isGent) {
      const pre = arr.length;
      arr = arr.filter(t => t[2] < 1088 && dNastro(t[0], t[1]) > 6);
      if (pre !== arr.length) console.log('spettatori rimossi (' + key + '):', pre - arr.length);
      if (!arr.length) continue;
    }
    if (proto.material && proto.material.isMeshStandardMaterial) {
      proto.material = proto.material.clone();
      proto.material.metalness = 0; proto.material.roughness = 0.95;
      if (key === 'Sphere_155') proto.material.color.setHex(0xdfa075);
      else if (key.startsWith('Cone_03')) proto.material.color.setHex(0x2d55b8);
    }
    // alberi (chiome a cono + tronchi): chioma irregolare, colore variato per pianta, vento
    const isChioma = /^Cone(_00\d)?$/.test(key);
    const isTronco = /^Cylinder_02\d$/.test(key);
    let geo = proto.geometry;
    if (isChioma) {
      geo = proto.geometry.clone();
      const pa = geo.getAttribute('position');
      let sd = 7 + key.length;
      const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
      // bordo della chioma frastagliato: i vertici del cerchio di base rientrano a caso
      let ymin = 1e9, ymax = -1e9;
      for (let i = 0; i < pa.count; i++) { const y = pa.getY(i); if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
      for (let i = 0; i < pa.count; i++) {
        const x = pa.getX(i), z = pa.getZ(i), r = Math.hypot(x, z);
        if (r < 1e-4) continue;
        const k = 0.72 + 0.4 * rnd();
        pa.setXYZ(i, x * k, pa.getY(i) + (rnd() - 0.5) * (ymax - ymin) * 0.10, z * k);
      }
      pa.needsUpdate = true; geo.computeVertexNormals();
    }
    if ((isChioma || isTronco) && proto.material.isMeshStandardMaterial) {
      proto.material.color.set(0xffffff);   // il colore lo da' la tinta per pianta
      proto.material.onBeforeCompile = sh => {
        sh.uniforms.uT = { value: 0 };
        VENTO_SH.push(sh);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uT;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  // oscillazione al vento: cresce con l'altezza del vertice, fase diversa per pianta
  vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float fase = wp.x * 0.05 + wp.z * 0.037;
  float h = clamp(position.y / 6.0, 0.0, 1.0);
  float sw = sin(uT * 1.7 + fase) * 0.12 + sin(uT * 3.1 + fase * 1.7) * 0.05;
  transformed.x += sw * h * h * 1.6;
  transformed.z += sw * h * h * 0.9;
}`);
      };
    }
    const im = new THREE.InstancedMesh(geo, proto.material, arr.length);
    const col = new THREE.Color();
    for (let i = 0; i < arr.length; i++) {
      const t = arr[i];
      P.set(t[0], t[2], -t[1]);
      Q.setFromEuler(E.set(0, t[3], 0));
      S.setScalar(t[4] || 1);
      M.compose(P, Q, S);
      im.setMatrixAt(i, M);
      if (isChioma || isTronco) {
        // tinta per pianta: verdi dal cupo al giallastro (le chiome), corteccia variabile (i tronchi)
        const h1 = Math.sin(t[0] * 12.9898 + t[1] * 78.233) * 43758.5453, r1 = h1 - Math.floor(h1);
        if (isChioma) col.setHSL(0.27 + (r1 - 0.5) * 0.06, 0.48 + r1 * 0.2, 0.12 + r1 * 0.10);
        else col.setHSL(0.07, 0.40, 0.11 + r1 * 0.08);
        im.setColorAt(i, col);
      }
    }
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    im.castShadow = true;
    scene.add(im);
    VEG_IM.push({ im, n: arr.length });
  }
  console.log('vegetazione:', Object.keys(veg.inst).map(k => k + ':' + veg.inst[k].length).join(', '));
}

// ---------- animali riggati (Meshy, animati per ossa): lupo ai pratoni e cervo in Valle Porclaneta ----------
// Idle procedurale: respiro, testa che si guarda intorno, coda, orecchie. I modelli guardano -x.
const ANIMALI = [];
function facciaVerso(model, x, z, tx, tz){ return Math.atan2(tz - z, -(tx - x)); }
async function buildAnimali(loader){
  const defs = [
    { file: 'lupo.glb', nome: 'Lupo_Rig', scale: 2.7, at: 'lupo',
      ossa: { spine: 'Bone_030', neck: 'Bone_040', neck2: 'Bone_037', head: 'Bone_034', tail: 'Bone_009', tail2: 'Bone_006', earL: 'Bone_066', earR: 'Bone_063' },
      amp: { headYaw: 0.35, tailYaw: 0.22, tailPitch: 0.1, breathe: 0.025, ear: 0.15 } },
    { file: 'cervo.glb', nome: 'Cervo_Rig', scale: 4.4, at: 'cervo',
      ossa: { spine: 'Bone_003', neck: 'Bone_010', neck2: 'Bone_009', head: 'Bone_007', tail: 'Bone_024', tail2: 'Bone_023', earL: 'Bone_038', earR: 'Bone_036' },
      amp: { headYaw: 0.3, tailYaw: 0.05, tailPitch: 0.4, breathe: 0.02, ear: 0.3 } }
  ];
  for (const d of defs) {
    let g;
    try { g = await loadGLB(loader, 'assets/' + d.file + '?' + VER, () => {}); } catch (e) { console.warn(d.file, 'assente'); continue; }
    const bones = {}; g.scene.traverse(o => { if (o.isBone) bones[o.name] = o; if (o.isSkinnedMesh) { o.frustumCulled = false; o.castShadow = true; if (o.material) { o.material.metalness = 0; o.material.roughness = 0.9; } } });
    const rest = new Map(); for (const b of Object.values(bones)) rest.set(b, b.quaternion.clone());
    const grp = new THREE.Group(); grp.name = d.nome; grp.add(g.scene); g.scene.scale.setScalar(d.scale);
    let px, pz, tx, tz;
    if (d.at === 'lupo') {
      // ai pratoni (km 26,3), 36 m a destra del sentiero, rivolto verso chi arriva
      posAt(25600, tmpA); tanAt(25600, tmpB);
      px = tmpA.x - tmpB.z * 40; pz = tmpA.z + tmpB.x * 40;
      posAt(25500, tmpA); tx = tmpA.x; tz = tmpA.z;
    } else {
      // cervo al margine del bosco di Valle Porclaneta, 28 m a sinistra del sentiero
      posAt(7800, tmpA); tanAt(7800, tmpB);
      px = tmpA.x - tmpB.z * 28; pz = tmpA.z + tmpB.x * 28;
      posAt(7900, tmpA); tx = tmpA.x; tz = tmpA.z;
    }
    const gy = terraVera(px, pz, 0);
    grp.position.set(px, gy > -1e3 ? gy : groundAt(px, pz), pz);
    grp.rotation.y = facciaVerso(null, px, pz, tx, tz);
    scene.add(grp);
    grp.updateMatrixWorld(true);
    ANIMALI.push({ def: d, grp, bones, rest, root: g.scene, ph: Math.random() * 100 });
  }
}
// rotazione di un osso attorno a un asse del modello (stessa formula di rotBone, ma per un rig qualsiasi)
function rotBoneA(an, name, axis, ang, extraAxis, extraAng){
  const b = an.bones[name]; if (!b) return;
  qP.identity(); const chain = [];
  for (let p = b.parent; p && p !== an.root; p = p.parent) chain.push(p);
  for (let i = chain.length - 1; i >= 0; i--) qP.multiply(chain[i].quaternion);
  qA.setFromAxisAngle(axis, ang);
  if (extraAxis) { qI.setFromAxisAngle(extraAxis, extraAng); qA.multiply(qI); }
  qI.copy(qP).invert();
  b.quaternion.copy(qI).multiply(qA).multiply(qP).multiply(an.rest.get(b));
}
let animT = 0;
function tickAnimali(dt){
  if (!ANIMALI.length) return;
  animT += dt;
  for (const an of ANIMALI) {
    // solo se abbastanza vicino alla camera (fluidita'): oltre 600 m resta fermo
    if (camera.position.distanceTo(an.grp.position) > 600) continue;
    const o = an.def.ossa, A = an.def.amp, t = animT + an.ph;
    // testa: lenta rotazione con pause (rumore a bassa frequenza), + guarda in giu' ogni tanto (brucare)
    const look = Math.sin(t * 0.35) * 0.6 + Math.sin(t * 0.13 + 1) * 0.4;
    const graze = an.def.at === 'cervo' ? clamp(Math.sin(t * 0.09) * 3 - 1.5, 0, 1) : 0;
    rotBoneA(an, o.neck, AX.y, look * A.headYaw * 0.5, AX.z, graze * 0.45);
    rotBoneA(an, o.neck2, AX.y, look * A.headYaw * 0.3, AX.z, graze * 0.35);
    rotBoneA(an, o.head, AX.y, look * A.headYaw * 0.4, AX.z, graze * 0.3 + Math.sin(t * 0.7) * 0.03);
    // respiro
    rotBoneA(an, o.spine, AX.z, Math.sin(t * 2.2) * A.breathe);
    // coda
    rotBoneA(an, o.tail, AX.y, Math.sin(t * 1.6) * A.tailYaw, AX.x, (Math.sin(t * 5.0) > 0.92 ? 1 : 0) * A.tailPitch);
    rotBoneA(an, o.tail2, AX.y, Math.sin(t * 1.6 + 0.8) * A.tailYaw * 0.8);
    // orecchie: scatti
    const e1 = Math.sin(t * 3.3) > 0.9 ? 1 : 0, e2 = Math.sin(t * 2.7 + 2) > 0.9 ? 1 : 0;
    rotBoneA(an, o.earL, AX.z, e1 * A.ear); rotBoneA(an, o.earR, AX.z, -e2 * A.ear);
  }
}

// ---------- i volontari del GEV sulla vetta del Velino, con la croce di vetta ----------
// Modello Meshy (foto dei volontari sulla cima + roccia sommitale + croce), decimato a 152k tri.
// Unita' del modello: le persone sono alte ~0,45 -> scala 17,3 perche' siano alte come Lino.
// Il piano dei piedi (z ~ -0,20 del modello) viene messo alla quota della vetta: il cumulo di
// rocce sotto (fino a -0,95) resta parzialmente annegato nel terreno, la croce e' verticale,
// i volti guardano a nord (il modello guarda +Z in glTF: rotazione di 180 gradi su Y).
let GEV = null;
async function buildGEV(loader){
  const pk = (route.peaks || []).find(p => /velino/i.test(p.n));
  if (!pk) return;
  const g = await loadGLB(loader, 'assets/gev.glb?' + VER, () => {});
  g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material) { o.material.metalness = 0; o.material.roughness = 0.95; } } });
  const S = 17.3, PIEDI = -0.20;
  // vetta vera della mesh: si cerca il massimo in un intorno di 30 m del picco
  let top = -1e9, tx = pk.x, tz = -pk.y;
  for (let dx = -30; dx <= 30; dx += 6) for (let dz = -30; dz <= 30; dz += 6) {
    const y = terraVera(pk.x + dx, -pk.y + dz, pk.z + 50);
    if (y > top) { top = y; tx = pk.x + dx; tz = -pk.y + dz; }
  }
  const grp = new THREE.Group(); grp.name = 'GEV_Velino';
  g.scene.scale.setScalar(S);
  g.scene.rotation.y = Math.PI;             // volti a nord
  // base della croce (x 0,20, z -0,30 nel modello glTF -> dopo la rotazione di 180: x -0,20, z +0,30):
  // e' il perno attorno a cui il gruppo e' girato di 10 gradi in senso orario (visto dall'alto),
  // con la croce che resta perfettamente verticale
  const perno = new THREE.Group();
  const bx = -0.20 * S, bz = 0.30 * S;
  g.scene.position.set(-bx, -PIEDI * S, -bz);   // il piano dei piedi va all'origine, la croce sul perno
  perno.position.set(bx, 0, bz);
  perno.rotation.y = -THREE.MathUtils.degToRad(10);
  perno.add(g.scene);
  grp.add(perno);
  grp.position.set(tx, top + 2.0, tz);      // +40 cm alla scala delle persone: la roccia emerge un po' di piu'
  scene.add(grp);
  GEV = grp;
  console.log('GEV sul Velino a', tx.toFixed(0), top.toFixed(1), tz.toFixed(0));
  // Pietro Mattei sul Cafornia, accanto alla croce del Cafornia: base di roccia ritagliata in Blender
  // (raggio 0,6), persona alta 0,66 unita' -> scala 11,8; piedi a z -0,36 del modello; sguardo a NE
  try {
    const caf = (route.peaks || []).find(p => /cafornia/i.test(p.n));
    if (caf) {
      const g2 = await loadGLB(loader, 'assets/mattei.glb?' + VER, () => {});
      g2.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material) { o.material.metalness = 0; o.material.roughness = 0.95; } } });
      let top2 = -1e9, x2 = caf.x, z2 = -caf.y;
      for (let dx = -30; dx <= 30; dx += 6) for (let dz = -30; dz <= 30; dz += 6) {
        const y = terraVera(caf.x + dx, -caf.y + dz, caf.z + 50);
        if (y > top2) { top2 = y; x2 = caf.x + dx; z2 = -caf.y + dz; }
      }
      const S2 = 11.8, PIEDI2 = -0.36;
      const grp2 = new THREE.Group(); grp2.name = 'Mattei_Cafornia';
      g2.scene.scale.setScalar(S2); g2.scene.position.y = -PIEDI2 * S2;
      // il modello guarda +Z (glTF); nord-est = (+x, -z) in three -> rotazione di 135 gradi su Y
      g2.scene.rotation.y = Math.PI * 0.75;
      grp2.add(g2.scene); grp2.position.set(x2, top2 - 0.6, z2);   // i sassi affondano per meta' nella vetta
      scene.add(grp2);
    }
  } catch (e) { console.warn('Mattei:', e); }
  // Giuseppe Idrofano alla Capanna di Sevice (km 14,7), 22 m a destra del sentiero, volto al percorso;
  // il piede destro (alzato) poggia su una roccia messa qui sotto; alto 1,9 unita' -> scala 4,1
  try {
    const g3 = await loadGLB(loader, 'assets/idrofano.glb?' + VER, () => {});
    g3.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material) { o.material.metalness = 0; o.material.roughness = 0.95; } } });
    const S3 = 4.1;
    // quasi attaccato al rifugio, dal lato delle panche (ovest, verso il sentiero)
    let px, pz;
    if (SEVICE) { const bb = new THREE.Box3().setFromObject(SEVICE); px = bb.min.x - 2.5; pz = bb.max.z - 3; }
    else { posAt(14650, tmpA); tanAt(14650, tmpB); px = tmpA.x + tmpB.z * 22; pz = tmpA.z - tmpB.x * 22; }
    posAt(14650, tmpA); posAt(14650, tmpC);
    const gy = terraVera(px, pz, tmpA.y);
    const grp3 = new THREE.Group(); grp3.name = 'Idrofano_Sevice';
    g3.scene.scale.setScalar(S3); g3.scene.position.y = 0.952 * S3;    // piede in appoggio a terra
    // roccia sotto il piede destro alzato (suola a z -0,534 del modello, x -0,33, y_blender +0,05)
    // masso calcareo: dodecaedro suddiviso e sformato con rumore, spigoli vivi, faccia superiore piatta
    const rg = new THREE.DodecahedronGeometry(0.26, 2);
    { const pa = rg.getAttribute('position'); let sd = 7;
      const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < pa.count; i++) {
        const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
        const k = 0.86 + 0.28 * Math.abs(Math.sin(x * 9.1 + z * 7.3) * Math.cos(y * 11.7)) + (rnd() - 0.5) * 0.16;
        pa.setXYZ(i, x * k * 1.35, Math.min(y * k, 0.20), z * k * 1.05);
      }
      pa.needsUpdate = true; rg.computeVertexNormals(); }
    const roccia = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color: 0x8e8a82, roughness: 1, metalness: 0, flatShading: true }));
    roccia.position.set(-0.33, -0.952 + 0.22, -0.05);
    roccia.castShadow = true; roccia.receiveShadow = true;
    g3.scene.add(roccia);
    // guarda il sentiero: il modello guarda +Z (glTF)
    g3.scene.rotation.y = Math.atan2(tmpC.x - px, tmpC.z - pz);
    grp3.add(g3.scene); grp3.position.set(px, gy > -1e3 ? gy : tmpA.y, pz);
    scene.add(grp3);
    // il piede in appoggio (x 0,154, z -0,233 nel modello) deve toccare il suolo vero in quel punto esatto
    grp3.updateMatrixWorld(true);
    tmpD.set(0.154, -0.952, -0.233).applyMatrix4(g3.scene.matrixWorld);
    const gf = terraVera(tmpD.x, tmpD.z, tmpD.y + 5);
    if (gf > -1e3) grp3.position.y += gf - tmpD.y;
  } catch (e) { console.warn('Idrofano:', e); }
}

// ---------- tigli: chioma verde/gialla di inizio autunno che ondeggia (per i Tiglio* di Ale e per quelli procedurali) ----------
function vestiTiglio(o){
  const chioma = /chioma|foglie|leaf|crown/i.test((o.material && o.material.name) || '') || !/tronco|trunk/i.test(o.name);
  if (!chioma) return;
  const m = o.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, vertexColors: false });
  m.customProgramCacheKey = () => 'tiglio';
  m.onBeforeCompile = sh => {
    sh.uniforms.uT = { value: 0 }; VENTO_SH.push(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uT; varying vec3 vLoc; varying float vHn;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vLoc = (modelMatrix * vec4(position, 1.0)).xyz;
vHn = position.y;
{ float fase = modelMatrix[3].x * 0.05 + modelMatrix[3].z * 0.037;
  float sw = sin(uT * 1.5 + fase + position.y * 0.4) * 0.10 + sin(uT * 2.9 + fase * 1.7 + position.x) * 0.04;
  transformed.x += sw * 0.6; transformed.z += sw * 0.35; }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vLoc; varying float vHn;
float hh(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float vn3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hh(i), hh(i + vec3(1, 0, 0)), f.x), mix(hh(i + vec3(0, 1, 0)), hh(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hh(i + vec3(0, 0, 1)), hh(i + vec3(1, 0, 1)), f.x), mix(hh(i + vec3(0, 1, 1)), hh(i + vec3(1, 1, 1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  // verde con ciuffi gialli morbidi, piu' fitti in alto (inizio autunno): rumore continuo, niente quadretti
  float n1 = vn3(vLoc * 1.3) * 0.6 + vn3(vLoc * 3.1) * 0.4;
  float n2 = vn3(vLoc * 9.0);
  vec3 verde = vec3(0.30, 0.45, 0.16) * (0.85 + 0.3 * n2);
  vec3 giallo = vec3(0.84, 0.70, 0.20) * (0.9 + 0.2 * n2);
  float aut = smoothstep(0.50, 0.72, n1 * 0.75 + 0.25 * clamp(vHn * 0.35, 0.0, 1.0));
  diffuseColor.rgb = mix(verde, giallo, aut);
}`);
  };
  o.castShadow = true;
}
// tigli procedurali davanti al Comune (finche' Ale non li posiziona nel blend): tronco + 3 chiome
function tiglioProcedurale(x, z, h){
  const g = new THREE.Group(); g.name = 'Tiglio_proc';
  const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, h * 0.45, 7), new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 1 }));
  tr.position.y = h * 0.225; tr.castShadow = true; g.add(tr);
  const geo = new THREE.IcosahedronGeometry(1, 2);
  { const pa = geo.getAttribute('position'); for (let i = 0; i < pa.count; i++) { const k = 0.85 + 0.3 * Math.abs(Math.sin(pa.getX(i) * 5.0 + pa.getZ(i) * 3.0) * Math.cos(pa.getY(i) * 4.0)); pa.setXYZ(i, pa.getX(i) * k, pa.getY(i) * k, pa.getZ(i) * k); } pa.needsUpdate = true; geo.computeVertexNormals(); }
  for (const [dx, dy, dz, r] of [[0, 0.62, 0, 0.36], [0.22, 0.48, 0.12, 0.28], [-0.2, 0.5, -0.14, 0.26], [0.02, 0.8, 0.05, 0.24]]) {
    const c = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: 'chioma' }));
    c.name = 'Tiglio_chioma'; c.position.set(dx * h, dy * h, dz * h); c.scale.setScalar(r * h);
    vestiTiglio(c); g.add(c);
  }
  const gy = terraVera(x, z, 40);
  g.position.set(x, gy > -1e3 ? gy : 0, z);
  return g;
}
function buildTigli(){
  // se il blend di Ale ha gia' dei Tiglio*, niente procedurali
  let ci = 0; scene.traverse(o => { if (/^Tiglio/.test(o.name || '') && o.name !== 'Tiglio_proc') ci++; });
  if (ci) return;
  const com = scene.getObjectByName('Comune_Meshy');
  if (!com) return;
  const bb = new THREE.Box3().setFromObject(com);
  const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
  // quattro tigli in fila sul lato della piazza, a 9 m dal fronte del Comune
  posAt(60, tmpA);
  const dx = tmpA.x - cx, dz = tmpA.z - cz, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
  for (let i = -1.5; i <= 1.5; i += 1) {
    const px = cx + ux * ((bb.max.x - bb.min.x) / 2 + 9) - uz * i * 7, pz = cz + uz * ((bb.max.z - bb.min.z) / 2 + 9) + ux * i * 7;
    scene.add(tiglioProcedurale(px, pz, 9 + (i + 1.5) * 0.4));
  }
}

// ---------- chiesa di Santa Maria ad Nives (Meshy decimato, 80k tri) al posto della torre stilizzata ----------
async function buildChiesaNives(loader){
  const g = await loadGLB(loader, 'assets/chiesa_nives.glb?' + VER, () => {});
  g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material) { o.material.metalness = 0; o.material.roughness = 0.95; } } });
  // via la torre + croce stilizzate di borghi.glb
  let px = -1375, pz = 4611;
  scene.traverse(o => { if (o.isMesh && (o.name === 'Borghi_8' || o.name === 'Borghi_9')) { o.visible = false; if (o.name === 'Borghi_8') { o.geometry.computeBoundingBox(); const c = o.geometry.boundingBox.getCenter(tmpC); o.localToWorld(c); px = c.x; pz = c.z; } } });
  // torre alta ~22 m: il modello e' alto 1,9 unita'; fronte del modello = +z
  const S = 22 / 1.9;
  const gy = terraVera(px, pz, 30);
  const grp = new THREE.Group(); grp.name = 'Chiesa_Nives';
  g.scene.scale.setScalar(S); g.scene.position.y = 0.953 * S;
  posAt(350, tmpA);
  g.scene.rotation.y = Math.atan2(tmpA.x - px, tmpA.z - pz);     // facciata verso la strada
  grp.add(g.scene); grp.position.set(px, (gy > -1e3 ? gy : 10) - 0.3, pz);
  scene.add(grp);
}

// ---------- suono sintetizzato (Web Audio, nessun file): vento, battito, tocco, botta ----------
const SND = { ctx: null, on: true, wind: null, windG: null, windF: null, rumb: null, rumbG: null, noise: null, ready: false };
function sndInit(){
  if (SND.ready) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    SND.ctx = new AC();
    try { SND.on = localStorage.getItem('srmx_snd') !== '0'; } catch (e) {}
    const c = SND.ctx;
    // rumore bianco in loop (2 s)
    const n = c.sampleRate * 2, buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    SND.noise = buf;
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 0.7;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(c.destination); src.start();
    SND.wind = src; SND.windF = f; SND.windG = g;
    // rombo basso per l'alta velocita'
    const src2 = c.createBufferSource(); src2.buffer = buf; src2.loop = true;
    const f2 = c.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 140;
    const g2 = c.createGain(); g2.gain.value = 0;
    src2.connect(f2); f2.connect(g2); g2.connect(c.destination); src2.start();
    SND.rumb = src2; SND.rumbG = g2;
    SND.ready = true;
    const b = $('b-snd'); if (b) b.textContent = SND.on ? '\ud83d\udd0a' : '\ud83d\udd07';
  } catch (e) { console.warn('audio:', e); }
}
function sndToggle(){
  SND.on = !SND.on;
  try { localStorage.setItem('srmx_snd', SND.on ? '1' : '0'); } catch (e) {}
  const b = $('b-snd'); if (b) b.textContent = SND.on ? '\ud83d\udd0a' : '\ud83d\udd07';
  if (!SND.on) sndWind(0, 0);
}
function sndWind(v, fold){
  if (!SND.ready) return;
  const c = SND.ctx, t = c.currentTime;
  // discreto fino a ~130 km/h (36 m/s), poi sale in modo deciso
  const attivo = SND.on && FLY.on && FLY.mode === 'volo';
  const k1 = attivo ? clamp((v - 8) / 28, 0, 1) : 0;          // fino a 130 km/h: sussurro
  const k2 = attivo ? clamp((v - 36) / 34, 0, 1) : 0;         // da 130 a 250 km/h: vento vero
  const k = Math.max(k1 * 0.3, k2);
  SND.windG.gain.setTargetAtTime(attivo ? 0.03 + 0.10 * k1 + 0.42 * k2 : 0, t, attivo ? 0.12 : 0.3);
  SND.windF.frequency.setTargetAtTime(300 + 500 * k1 + 1300 * k2 * k2 + 300 * fold, t, 0.15);
  SND.rumbG.gain.setTargetAtTime(0.55 * k2 * k2, t, 0.15);
}
function sndBurst(freq, q, gain, dur, type){
  if (!SND.ready || !SND.on) return;
  const c = SND.ctx, t = c.currentTime;
  const src = c.createBufferSource(); src.buffer = SND.noise;
  const f = c.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.45), t + dur);
  const g = c.createGain(); g.gain.setValueAtTime(0.001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.25); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(c.destination); src.start(t); src.stop(t + dur + 0.05);
}
function sndFlap(){ sndBurst(900, 1.2, 0.35, 0.28, 'bandpass'); }
function sndTocco(){ sndBurst(400, 0.8, 0.3, 0.35, 'lowpass'); }
function sndBotta(){
  sndBurst(180, 0.6, 0.8, 0.5, 'lowpass');
  if (!SND.ready || !SND.on) return;
  const c = SND.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.5);
  g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
  o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.6);
}
const vibra = ms => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} };

// ---------- modalità GRIFONE: volo libero sopra il Velino ----------
// Modello di volo arcade in unità di scena (~metri): planata con perdita di quota
// costante, picchiata/cabrata scambiano quota e velocità, virata coordinata dal
// rollio, battito d'ali come riserva di spinta, stallo sotto VSTALL.
const FLY = {
  on: false, pos: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, v: 18,
  inX: 0, inY: 0, flap: false, flapPh: 0, flapPow: 0, stall: false, stallT: 0,
  vario: 0, lift: 0, agl: 0, pitchV: 0, rollV: 0, tilt: false, tiltBase: null, tiltIn: [0, 0], joyIn: [0, 0], keyIn: [0, 0],
  fogSaved: null, camRoll: 0, ready: false,
  mode: 'volo', tT: 0, fold: 0, flapHold: 0, tumble: null, orbit: 0, legs: 0, flapCyc: 0, shake: 0, specie: 'grifone'
};
const FC = {
  G: 9.81, VSTALL: 9.5, VMAX: 84, CD: 0.0027,   // VMAX 84 m/s ≈ 300 km/h a proiettile (ali chiuse)
  PITCH_GLIDE: -0.105,   // -6°: pendenza di planata naturale
  PITCH_UP: 0.50, PITCH_DN: 0.88, ROLL_MAX: 1.05, FLAP_HZ: 2.1, FLAP_ACC: 16, FLAP_LIFT: 6,
  AGIL: 1.0, MORDE_V0: 30, FOLD_V: 42,   // maneggevolezza, velocita' oltre cui il battito non morde, soglia ali chiuse (per specie)
  CEIL: 2950, AGL_MIN: 2.3, V_ATT: 17, V_IMP: 26, PITCH_IMP: -0.5, H_TERRA: 2.75,
  // confine morbido: ellisse centrata sul terreno (coordinate three: x, z)
  BC: [-636, 970], BR: [4250, 5050]    // allargato all'anello esterno in flyStart se dem_ext c'e'
};
let grifP = null, grifMat = null;
const fwdV = new THREE.Vector3(), upV = new THREE.Vector3(0, 1, 0), rightV = new THREE.Vector3();
const gEul = new THREE.Euler(0, 0, 0, 'YXZ');
let skirt = null;
const isTouch = () => matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;

// ---------- uccelli riggati (Meshy), animati per ossa in three.js ----------
// Tre specie con lo stesso schema: una mappa di ossa (spalle, gomiti, polsi, punte, collo, testa,
// coda, zampe se ci sono) e il "frame" del modello: prua, dorso e asse delle ali letti dalle
// posizioni delle ossa a riposo, cosi' il modello puo' essere orientato in qualunque modo nel glb.
const SPECIE = {
  grifone: {
    titolo: 'Grifone del Velino', breve: 'GRIFONE', file: 'assets/grifone.glb', aperturaScena: 13,
    hintUp: [0, 1, 0], asym: 0.10, agl: 1.1, hTerra: 1.72, cam: 1.0,
    map: { wings: [['Bone_019', 'Bone_018', 'Bone_017', ['Bone_032', 'Bone_034', 'Bone_036']],
                   ['Bone_022', 'Bone_021', 'Bone_020', ['Bone_038', 'Bone_040', 'Bone_042']]],
           hips: ['Bone_010', 'Bone_007'], knees: ['Bone_009', 'Bone_006'],
           neck: 'Bone_016', head: 'Bone_015', tail: ['Bone_004'], tail2: ['Bone_003'], root: 'Bone_000', spine: 'Bone_014' },
    // grande veleggiatore: plana bene, batte poco, lento nelle manovre
    fc: { VMAX: 84, CD: 0.0027, FLAP_HZ: 2.1, FLAP_ACC: 16, FLAP_LIFT: 6, VSTALL: 9.5, PITCH_UP: 0.50, PITCH_DN: 0.88,
          ROLL_MAX: 1.05, AGIL: 1.0, MORDE_V0: 30, FOLD_V: 42, V_ATT: 17, V_IMP: 26 }
  },
  aquila: {
    titolo: 'Aquila reale', breve: 'AQUILA', file: 'assets/aquila.glb', aperturaScena: 10.6,
    hintUp: [0, 1, 0], asym: 0, agl: 1.0, hTerra: 1.5, cam: 0.95,
    map: { wings: [['Bone_018', 'Bone_017', 'Bone_016', ['Bone_015', 'Bone_014']],
                   ['Bone_013', 'Bone_012', 'Bone_011', ['Bone_010', 'Bone_009']]],
           hips: [], knees: [], neck: 'Bone_008', head: 'Bone_006', tail: ['Bone_002'], tail2: ['Bone_001'], root: 'Bone_000', spine: 'Bone_003' },
    // piu' potente e maneggevole del grifone, picchia fino a ~320 km/h
    fc: { VMAX: 89, CD: 0.0025, FLAP_HZ: 1.7, FLAP_ACC: 19, FLAP_LIFT: 7, VSTALL: 10, PITCH_UP: 0.56, PITCH_DN: 0.95,
          ROLL_MAX: 1.2, AGIL: 1.3, MORDE_V0: 34, FOLD_V: 44, V_ATT: 17, V_IMP: 27 }
  },
  falco: {
    titolo: 'Falco pellegrino', breve: 'FALCO', file: 'assets/falco.glb', aperturaScena: 6.2,
    hintUp: [0, 0, -1], asym: 0, agl: 0.8, hTerra: 1.1, cam: 0.72,
    map: { wings: [['Bone_014', 'Bone_013', 'Bone_012', ['Bone_018', 'Bone_019', 'Bone_021']],
                   ['Bone_017', 'Bone_016', 'Bone_015', ['Bone_022', 'Bone_023', 'Bone_025']]],
           hips: ['Bone_004', 'Bone_006'], knees: ['Bone_003', 'Bone_005'], neck: 'Bone_011', head: 'Bone_010', tail: ['Bone_002'], tail2: ['Bone_001'], root: 'Bone_000', spine: 'Bone_007' },
    legAmp: [0.0, 0.7],   // zampe gia' raccolte nel modello: in volo restano cosi', scendono solo per posarsi
    // l'animale piu' veloce del mondo: battito rapido, virate secche, picchiata a ~390 km/h,
    // ma plana peggio e stalla prima (ali strette)
    fc: { VMAX: 108, CD: 0.0022, FLAP_HZ: 4.2, FLAP_ACC: 24, FLAP_LIFT: 5, VSTALL: 12, PITCH_UP: 0.62, PITCH_DN: 1.0,
          ROLL_MAX: 1.35, AGIL: 1.75, MORDE_V0: 42, FOLD_V: 50, V_ATT: 19, V_IMP: 30 }
  }
};
const ORDINE_SPECIE = ['grifone', 'aquila', 'falco', 'cervo'];
// il cervo: stessa modalita' e stessi comandi, ma a terra (Meshy "Cervo animato": riggato, 49 ossa,
// senza clip -> andature procedurali per ossa). Prua +z come gli uccelli, origine agli zoccoli.
SPECIE.cervo = {
  titolo: 'Cervo', breve: 'CERVO', file: 'assets/cervo2.glb', terra: true, scala: 4.4, cam: 1.0,
  map: { spine: ['Bone_001', 'Bone_003', 'Bone_002'], neck: ['Bone_010', 'Bone_009', 'Bone_008'], head: 'Bone_007',
         tail: ['Bone_026', 'Bone_025', 'Bone_024'], earL: 'Bone_044', earR: 'Bone_046', pelvis: 'Bone_004',
         // zampe: spalla/anca, gomito/ginocchio, carpo/garretto, nodello
         FL: ['Bone_016', 'Bone_015', 'Bone_014', 'Bone_013'], FR: ['Bone_022', 'Bone_021', 'Bone_020', 'Bone_019'],
         RL: ['Bone_032', 'Bone_031', 'Bone_030', 'Bone_029'], RR: ['Bone_038', 'Bone_037', 'Bone_036', 'Bone_035'] },
  // velocita' di scena (il modello e' 4,4 volte un cervo vero, come Lino): passo, trotto, galoppo
  cc: { V_PASSO: 4, V_TROTTO: 10, V_GALOPPO: 19, ACC: 7, FRENO: 14, GIRO: 1.5, PEND_MAX: 0.95 }   // 14, 36, 68 km/h: come un cervo vero
};
const CER = { v: 0, ph: 0, gait: 0, bob: 0, pitch: 0, roll: 0, idleT: 0, pronto: false };
const RIGS = {};          // rig pronti, per specie
let RIG = null;           // rig della specie in volo
let LOADER = null;
const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const qA = new THREE.Quaternion(), qP = new THREE.Quaternion(), qI = new THREE.Quaternion();
const bpA = new THREE.Vector3(), bpB = new THREE.Vector3();
function prepRig(g, nome){
  const sp = SPECIE[nome], map = sp.map;
  const bones = {}; let skin = null;
  g.scene.traverse(o => { if (o.isBone) bones[o.name] = o; if (o.isSkinnedMesh) skin = o; });
  if (sp.terra) {
    if (!skin || !bones[map.FL[0]]) throw new Error('rig non riconosciuto: ' + nome);
    skin.frustumCulled = false; skin.castShadow = true;
    if (skin.material && skin.material.isMeshStandardMaterial) {
      const mm = skin.material; mm.metalness = 0; mm.roughness = 0.85;
      // la texture Meshy e' scura e grigiastra: si schiarisce e si scalda verso il bruno-rossiccio del
      // manto autunnale, tenendo chiari ventre e specchio anale
      mm.customProgramCacheKey = () => 'cervo-manto';
      mm.onBeforeCompile = sh => {
        // posizione nella posa di legatura (prima dello skinning): per riconoscere corna e muso
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
          .replace('#include <color_fragment>', `#include <color_fragment>
{ vec3 c = diffuseColor.rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = pow(c, vec3(0.88)) * 1.10;                                   // un po' piu' chiaro
  vec3 caldo = vec3(0.50, 0.33, 0.19) * (0.5 + 0.9 * pow(l, 0.6));   // bruno-rossiccio
  c = mix(c, caldo, 0.40);
  c *= vec3(1.05, 1.0, 0.93);
  // corna: sopra la testa (y > 1,08, davanti): piu' chiare e meno rosse, punte quasi avorio
  float corna = smoothstep(1.06, 1.14, vBind.y) * smoothstep(0.28, 0.36, vBind.z);
  vec3 cCorna = mix(vec3(0.62, 0.52, 0.40), vec3(0.80, 0.74, 0.62), smoothstep(1.2, 1.6, vBind.y)) * (0.75 + 0.5 * l);
  c = mix(c, cCorna, corna * 0.85);
  // muso: la punta (z oltre 0,42, all'altezza della testa) schiarisce con sfumatura
  float muso = smoothstep(0.40, 0.54, vBind.z) * smoothstep(0.78, 0.86, vBind.y) * (1.0 - smoothstep(1.04, 1.10, vBind.y));
  c = mix(c, vec3(0.74, 0.62, 0.50) * (0.7 + 0.6 * l), muso * 0.55);
  diffuseColor.rgb = clamp(c, 0.0, 1.0); }`);
      };
    }
    const rest = new Map(); for (const b of Object.values(bones)) rest.set(b, b.quaternion.clone());
    return { nome, sp, root: g.scene, bones, rest, skin, map, ax: AX, qFix: new THREE.Quaternion(), sc: sp.scala, centro: new THREE.Vector3(0, 0, 0) };
  }
  if (!skin || !bones[map.wings[0][0]] || !bones[map.wings[1][0]]) throw new Error('rig non riconosciuto: ' + nome);
  skin.frustumCulled = false; skin.castShadow = true;
  if (skin.material && skin.material.isMeshStandardMaterial) { skin.material.metalness = 0; skin.material.roughness = 0.9; }
  const rest = new Map();
  for (const b of Object.values(bones)) rest.set(b, b.quaternion.clone());
  g.scene.updateMatrixWorld(true);
  // frame del modello dalle ossa a riposo: prua = radice -> spalle, ali = punta -> punta, dorso = prua x ali
  const wp = n => bones[n].getWorldPosition(new THREE.Vector3());
  const radice = wp(map.root), spalle = wp(map.spine);
  const tipA = wp(map.wings[0][3][map.wings[0][3].length - 1]), tipB = wp(map.wings[1][3][map.wings[1][3].length - 1]);
  const ali = tipA.clone().sub(tipB).normalize();
  let prua = spalle.clone().sub(radice); prua.addScaledVector(ali, -prua.dot(ali)).normalize();
  let dorso = new THREE.Vector3().crossVectors(prua, ali).normalize();
  if (dorso.dot(new THREE.Vector3(...sp.hintUp)) < 0) dorso.negate();
  const destra = new THREE.Vector3().crossVectors(dorso, prua).normalize();   // +x dell'uccello
  // ala "R" = quella sul lato +x del frame
  const wings = tipA.clone().sub(radice).dot(destra) > 0 ? map.wings : [map.wings[1], map.wings[0]];
  // rotazione che porta il frame del modello sugli assi standard (prua +z, dorso +y, destra +x)
  const M = new THREE.Matrix4().makeBasis(destra, dorso, prua);
  const qFix = new THREE.Quaternion().setFromRotationMatrix(M).invert();
  // apertura alare del modello (punta a punta) e centro del corpo nel frame standard
  const apertura = tipA.distanceTo(tipB);
  const centro = spalle.clone().lerp(radice, 0.35).applyQuaternion(qFix);
  // gli assi di rotBone sono quelli del MODELLO: gli assi standard riportati nel frame del glb
  const qInv = qFix.clone().invert();
  const ax = { x: AX.x.clone().applyQuaternion(qInv), y: AX.y.clone().applyQuaternion(qInv), z: AX.z.clone().applyQuaternion(qInv) };
  const sc = sp.aperturaScena / apertura;
  const sz = new THREE.Box3().setFromObject(g.scene).getSize(new THREE.Vector3());
  console.log('rig', nome, 'prua', prua.toArray().map(v => v.toFixed(2)).join(','), 'dorso', dorso.toArray().map(v => v.toFixed(2)).join(','), 'ossa', Object.keys(bones).length, 'apertura', apertura.toFixed(2), 'scala', sc.toFixed(2), 'box', sz.toArray().map(v => v.toFixed(2)).join('x'));
  return { nome, sp, root: g.scene, bones, rest, skin, map: Object.assign({}, map, { wings }), ax, qFix, sc, centro };
}
// ruota un osso attorno a un asse dello SPAZIO DEL MODELLO (non a quello locale dell'osso):
// locale' = P^-1 * Q * P * riposo, con P = rotazione accumulata dei genitori (fino alla radice del rig)
function rotBone(name, axis, ang, extraAxis, extraAng){
  const b = RIG.bones[name]; if (!b) return;
  qP.identity();
  const chain = [];
  for (let p = b.parent; p && p !== RIG.root; p = p.parent) chain.push(p);
  for (let i = chain.length - 1; i >= 0; i--) qP.multiply(chain[i].quaternion);
  qA.setFromAxisAngle(axis, ang);
  if (extraAxis) { qI.setFromAxisAngle(extraAxis, extraAng); qA.multiply(qI); }
  qI.copy(qP).invert();
  b.quaternion.copy(qI).multiply(qA).multiply(qP).multiply(RIG.rest.get(b));
}
// posa completa: flap (angolo, + = ali su), sweep 0..1 (chiuse all'indietro), legs 0..1 (giu'),
// roll e pitchIn per testa/coda, tremolio delle punte. Vale per tutte le specie.
function posaGrifone(flap, sweep, legs, roll, pitchIn, flutter){
  if (!RIG) {
    if (grifMat && grifMat.userData.sh) {
      const u = grifMat.userData.sh.uniforms;
      u.uFlap.value = flap; u.uSweep.value = sweep; u.uLegs.value = legs;
    }
    return;
  }
  if (RIG.sp.terra) return;
  const m = RIG.map, A = RIG.ax, sw = sweep, asym = RIG.sp.asym || 0;
  const [R, L] = m.wings;
  // il rig del grifone a riposo ha l'ala destra piu' alta della sinistra (~14 gradi): si compensa alle spalle
  rotBone(R[0], A.z, (flap - asym) * 0.75, A.y, sw * 0.55);
  rotBone(L[0], A.z, -(flap + asym) * 0.75, A.y, -sw * 0.55);
  rotBone(R[1], A.z, flap * 0.35 - sw * 0.25, A.y, sw * 0.95);
  rotBone(L[1], A.z, -flap * 0.35 + sw * 0.25, A.y, -sw * 0.95);
  rotBone(R[2], A.z, flap * 0.25, A.y, sw * 0.8);
  rotBone(L[2], A.z, -flap * 0.25, A.y, -sw * 0.8);
  const fl = flutter || 0;
  R[3].forEach((n, i) => rotBone(n, A.z, -flap * 0.3 + Math.sin(performance.now() / 90 + i) * fl));
  L[3].forEach((n, i) => rotBone(n, A.z, flap * 0.3 - Math.sin(performance.now() / 90 + i + 1) * fl));
  // zampe (solo il grifone le ha nel rig): in volo raccolte indietro sotto la coda; in atterraggio
  // portate avanti e giu', sotto il corpo, con le dita aperte (ginocchio che si distende)
  const la = RIG.sp.legAmp || [1.15, 0.9];
  const lg = (1 - legs) * la[0] - legs * la[1];
  for (const h of m.hips) rotBone(h, A.x, lg);
  for (const k of m.knees) rotBone(k, A.x, (1 - legs) * 0.6 * (la[0] / 1.15) - legs * 0.25);
  const r = roll || 0, pi = pitchIn || 0;
  rotBone(m.neck, A.y, -r * 0.35, A.x, -pi * 0.25);
  rotBone(m.head, A.y, -r * 0.25, A.z, r * 0.2);
  for (const t of m.tail) rotBone(t, A.y, r * 0.45, A.x, pi * 0.35);
  for (const t of m.tail2) rotBone(t, A.x, pi * 0.2);
}
// mette nel gruppo-pilota il modello della specie: scala, orientamento e origine al corpo
function montaSpecie(rig){
  const sp = rig.sp, m = rig.root;
  m.scale.setScalar(rig.sc);
  m.quaternion.copy(rig.qFix);
  m.position.copy(rig.centro).multiplyScalar(-rig.sc);
  grifP.add(m);
  if (!sp.terra) { FC.AGL_MIN = sp.agl; FC.H_TERRA = sp.hTerra; Object.assign(FC, sp.fc); }
  RIG = rig;
  grifP.updateMatrixWorld(true);
}
async function caricaSpecie(nome){
  if (RIGS[nome]) return RIGS[nome];
  if (!LOADER) throw new Error('loader assente');
  const g = await loadGLB(LOADER, SPECIE[nome].file + '?' + VER, () => {});
  RIGS[nome] = prepRig(g, nome);
  return RIGS[nome];
}
// cambio di specie in volo (tasto C o il pulsante in alto): stesso punto, stessa velocita'
let cambioInCorso = false;
async function cambiaSpecie(nome){
  if (cambioInCorso || !grifP) return;
  if (!nome) nome = ORDINE_SPECIE[(ORDINE_SPECIE.indexOf(FLY.specie) + 1) % ORDINE_SPECIE.length];
  if (nome === FLY.specie) return;
  cambioInCorso = true;
  try {
    const rig = await caricaSpecie(nome);
    const eraTerra = RIG && RIG.sp.terra;
    if (RIG) grifP.remove(RIG.root);
    montaSpecie(rig);
    FLY.specie = nome;
    if (rig.sp.terra) cervoInizio(eraTerra);
    else if (eraTerra) {
      // dal cervo a un uccello: si decolla dal punto in cui si era, 25 m piu' in alto
      FLY.pos.y += 25; FLY.v = 22; FLY.pitch = FC.PITCH_GLIDE; FLY.roll = 0; FLY.mode = 'volo'; FLY.fold = 0; FLY.flapPow = 0.5;
      document.body.classList.remove('cervo');
    }
    FLY.v = Math.min(FLY.v, FC.VMAX);
    if (FLY.on) { $('zona-n').textContent = nomeVolo(); }
    { const lab = document.querySelectorAll('#bar .slot .lab'); if (lab[0]) { lab[0].textContent = rig.sp.terra ? 'A terra' : 'In volo'; lab[3].textContent = rig.sp.terra ? 'Pendenza' : 'Vario'; } }
    const bf = $('b-flap'); if (bf) bf.innerHTML = rig.sp.terra ? 'CORRI<small>GALOPPO</small>' : 'BATTI<small>LE ALI</small>';
    const fh = $('fly-hint'); if (fh) fh.textContent = rig.sp.terra ? '▲ avanti · ▼ fermo · ◀ ▶ gira · SPAZIO galoppo · C cambia animale · ESC torna a Lino' : '▲ picchiata · ▼ cabrata · ◀ ▶ virata · SPAZIO batti le ali · C cambia uccello · ESC torna a Lino';
    const bs = $('b-specie'); if (bs) bs.textContent = SPECIE[nome].breve + ' ▸';
    try { localStorage.setItem('srm-specie', nome); } catch (e) {}
  } catch (e) {
    console.warn('specie', nome, e);
    openCard('<h2>' + SPECIE[nome].titolo + '</h2><p>Il modello non è disponibile (' + (e.message || e) + ').</p>');
  }
  cambioInCorso = false;
}
function nomeVolo(){ return SPECIE[FLY.specie] ? SPECIE[FLY.specie].titolo : 'Grifone del Velino'; }
function buildGrifone(){
  if (grifP || (!grifTpl && !RIG)) return;
  if (RIG) {
    grifP = new THREE.Group(); grifP.name = 'GrifonePilota';
    grifP.visible = false;
    scene.add(grifP);
    montaSpecie(RIG);
    FLY.specie = RIG.nome;
    buildSkirt();
    // specie scelta l'ultima volta
    let pref = null; try { pref = localStorage.getItem('srm-specie'); } catch (e) {}
    if (pref && SPECIE[pref] && pref !== RIG.nome) cambiaSpecie(pref);
    return;
  }
  grifP = new THREE.Group(); grifP.name = 'GrifonePilota';
  const m = grifTpl.clone();
  m.geometry = grifTpl.geometry;
  grifMat = grifTpl.material.clone();
  grifMat.metalness = 0; grifMat.roughness = 0.9;
  // battito d'ali procedurale: le ali (|x| oltre la radice) ruotano attorno all'asse
  // longitudinale del corpo, con le punte che flettono di più della radice
  grifMat.onBeforeCompile = sh => {
    sh.uniforms.uFlap = { value: 0 };
    sh.uniforms.uSweep = { value: 0 };
    sh.uniforms.uLegs = { value: 0 };
    grifMat.userData.sh = sh;
    // uFlap: rotazione dell'ala attorno all'asse del corpo (battito, diedro, ali giù a terra)
    // uSweep: ali che si chiudono all'indietro lungo il corpo (assetto a proiettile)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uFlap;\nuniform float uSweep;\nuniform float uLegs;\nvec3 alaPos(vec3 p, float a, float sw){\n  float ax = abs(p.x); float rad = 0.12;\n  if (ax <= rad) {\n    // zampe: la parte bassa del corpo dietro il petto ruota in giu\' attorno all\'anca\n    float wz = smoothstep(-0.08, -0.16, p.z) * smoothstep(-0.42, -0.34, p.z);\n    float wy = smoothstep(-0.16, -0.24, p.y);\n    float w = wz * wy * uLegs;\n    if (w > 0.001) {\n      float ang = -1.25 * w;\n      float st = 1.0 + 0.9 * w;\n      float dy = (p.y + 0.17) * st, dz = (p.z + 0.24) * st;\n      float c = cos(ang), sn = sin(ang);\n      return vec3(p.x, -0.17 + dy * c - dz * sn * 0.6, -0.24 + dz * c + dy * sn * 0.6);\n    }\n    return p;\n  }\n  float w = clamp((ax - rad) / 0.83, 0.0, 1.0);\n  float ang = a * (0.55 + 0.45 * w);\n  float dx = ax - rad;\n  float x2 = dx * cos(ang); float y2 = p.y + dx * sin(ang);\n  float sa = sw * (0.7 + 0.3 * w);\n  return vec3(sign(p.x) * (rad + x2 * cos(sa)), y2, p.z - x2 * sin(sa) - 0.15 * sw * w);\n}')
      .replace('#include <begin_vertex>', 'vec3 transformed = alaPos(vec3(position), uFlap, uSweep);')
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(normal);\n{ float ax = abs(position.x); if (ax > 0.12) { float w = clamp((ax - 0.12) / 0.83, 0.0, 1.0); float ang = uFlap * (0.55 + 0.45 * w) * sign(position.x);\n  float c = cos(ang), s = sin(ang); objectNormal = vec3(objectNormal.x * c - objectNormal.y * s, objectNormal.x * s + objectNormal.y * c, objectNormal.z); } }');
  };
  m.material = grifMat;
  m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); m.scale.setScalar(grifTpl.scale.x || 6.84);
  m.rotation.y = GRIF_MESH_YAW;
  m.castShadow = true; m.frustumCulled = false;
  grifP.add(m);
  grifP.visible = false;
  scene.add(grifP);
  buildSkirt();
}
function buildSkirt(){
  if (skirt) return;
  // "gonna" del mondo: disco color foschia sotto e oltre il bordo del terreno,
  // così il limite della mappa sfuma nella nebbia invece di mostrare un orlo
  const sk = new THREE.Mesh(new THREE.CircleGeometry(60000, 48),
    new THREE.MeshBasicMaterial({ color: scene.fog.color.clone(), fog: true }));
  sk.rotation.x = -Math.PI / 2; sk.position.set(FC.BC[0], HG2 ? -320 : -46, FC.BC[1]);   // sotto la Valle Roveto (y -265) se c'e' l'anello
  sk.name = 'Skirt'; sk.visible = false; skirt = sk;
  scene.add(sk);
}
const GRIF_MESH_YAW = 0;   // orientamento del modello Meshy rispetto alla prua (+z del gruppo)

function flyStart(){
  if (HG2) { FC.BC = [(HG2.x0 + HG2.x1) / 2, -(HG2.y0 + HG2.y1) / 2]; FC.BR = [(HG2.x1 - HG2.x0) / 2 - 1500, (HG2.y1 - HG2.y0) / 2 - 1500]; }
  if (!grifTpl) { openCard('<h2>Grifone assente</h2><p>Il modello del grifone non è nella scena.</p>'); return; }
  buildGrifone();
  if (!TIDX) { try { TIDX = buildTerrIndex(); } catch (e) { console.warn('indice terreno:', e); } }
  // si parte dalla vetta del Cafornia, prua verso Magliano: chi vuole picchiare
  // ha subito tutta la valle davanti
  const caf = (route.peaks || []).find(p => /cafornia/i.test(p.n));
  if (st.s > 500 || !caf) {
    // Lino e' gia' in cammino: il grifone parte da dove sta lui, 60 m sopra il suolo, lungo il sentiero
    posAt(st.s, tmpA); tanAt(st.s, tmpB);
    const gt = terraVera(tmpA.x, tmpA.z, tmpA.y);
    FLY.pos.set(tmpA.x, Math.max(tmpA.y, gt > -1e3 ? gt : tmpA.y) + 60, tmpA.z);
    FLY.yaw = Math.atan2(tmpB.x, tmpB.z);
  } else {
    // appena partiti: dalla vetta del Cafornia, prua su Magliano (tutta la valle davanti)
    FLY.pos.set(caf.x, caf.z + 45, -caf.y);
    posAt(0, tmpA);
    FLY.yaw = Math.atan2(tmpA.x - FLY.pos.x, tmpA.z - FLY.pos.z);
  }
  FLY.pitch = FC.PITCH_GLIDE; FLY.roll = 0; FLY.v = 22; FLY.pitchV = 0; FLY.rollV = 0;
  FLY.stall = false; FLY.flap = false; FLY.flapPow = 0; FLY.vario = 0;
  FLY.mode = 'volo'; FLY.tT = 0; FLY.fold = 0; FLY.flapHold = 0; FLY.tumble = null; FLY.volato = false; FLY.tVolo = 0;
  $('fade').style.opacity = 0; $('impatto').classList.remove('on');
  FLY.on = true; grifP.visible = true; skirt.visible = true;
  if (RIG && RIG.sp.terra) cervoInizio(false);
  if (!FLY.fogSaved) FLY.fogSaved = [scene.fog.near, scene.fog.far];
  scene.fog.near = 700; scene.fog.far = FOG_VOLO[QUAL.liv];
  luceGrifone(true);
  document.body.classList.add('grif');
  document.body.classList.toggle('touch', isTouch());
  controls.enabled = false;
  $('b-grif').classList.add('on'); $('b-grif').textContent = 'TORNA A LINO';
  const lab = document.querySelectorAll('#bar .slot .lab');
  lab[0].textContent = (RIG && RIG.sp.terra) ? 'A terra' : 'In volo'; lab[1].textContent = 'Velocità'; lab[3].textContent = (RIG && RIG.sp.terra) ? 'Pendenza' : 'Vario';
  $('zona-n').textContent = nomeVolo(); $('zona-s').textContent = '';
  st.curZone = -1; st.curKey = null; st.lastHudS = -1e9;
  $('poi-banner').classList.remove('on'); st.curPoi = -1;
  // la camera parte dietro al grifone
  fwdOf(FLY, fwdV);
  camera.position.copy(FLY.pos).addScaledVector(fwdV, -40); camera.position.y += 14;
  camTgt.copy(FLY.pos);
  if (!FLY.ready) { FLY.ready = true; bindFlyUI(); }
  sndInit();
  if (window.SRMX) { window.SRMX.fly = FLY; window.SRMX.flyStop = flyStop; window.SRMX.grifP = grifP; window.SRMX.stepFly = dt => tickFly(dt); window.SRMX.rig = RIG; }
  try { location.hash = 'grifone'; } catch (e) {}
}
function flyStop(){
  if (!FLY.on) return;
  FLY.on = false;
  sndWind(0, 0);
  if (FLY.mode === 'tour') { $('b-tour').classList.remove('on'); document.body.classList.remove('tour'); }
  FLY.mode = 'volo'; grifP.visible = false; skirt.visible = false;
  if (FLY.fogSaved) { scene.fog.near = FLY.fogSaved[0]; scene.fog.far = QUAL.liv === 0 ? 11000 : FLY.fogSaved[1]; FLY.fogSaved = null; }
  $('fade').style.opacity = 0; $('impatto').classList.remove('on');
  camera.fov = 55; camera.updateProjectionMatrix();
  luceGrifone(false);
  document.body.classList.remove('grif'); document.body.classList.remove('cervo');
  $('b-grif').classList.remove('on'); $('b-grif').textContent = 'GRIFONE';
  $('stallo').classList.remove('on');
  const lab = document.querySelectorAll('#bar .slot .lab');
  lab[0].textContent = 'Zona'; lab[1].textContent = 'Km'; lab[3].textContent = 'Pendenza';
  st.curZone = -1; st.curKey = null; st.lastHudS = -1e9; st.curPoi = -1;
  tiltOff();
  setView('follow');
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
}
// luce da mezzogiorno d'estate in volo: cielo più blu, sole più alto e caldo, esposizione su.
// La nebbia resta (serve a nascondere i confini): cambia solo il suo colore, che segue il cielo.
let LUCE0 = null;
function luceGrifone(on){
  if (!LUCE0) LUCE0 = { exp: renderer.toneMappingExposure, bg: scene.background.clone(),
                        sun: sunLight.intensity, sunC: sunLight.color.clone(), hemi: HEMI ? HEMI.intensity : 1 };
  if (on) {
    renderer.toneMappingExposure = 1.34;
    skyPalette('giorno');
    sunLight.intensity = 3.1; sunLight.color.set(0xfff6e4);
    if (HEMI) HEMI.intensity = 1.25;
  } else {
    renderer.toneMappingExposure = LUCE0.exp;
    skyPalette('alba');
    sunLight.intensity = LUCE0.sun; sunLight.color.copy(LUCE0.sunC);
    if (HEMI) HEMI.intensity = LUCE0.hemi;
  }
}
function fwdOf(f, out){
  const cp = Math.cos(f.pitch);
  return out.set(cp * Math.sin(f.yaw), Math.sin(f.pitch), cp * Math.cos(f.yaw));
}
// ascendenze: termiche sui versanti al sole (esposti a sud-ovest, dove sta il sole della
// scena) e sopra le creste; svaniscono lontano dal suolo. In m/s verso l'alto.
// vento dominante da NO (verso SE in coordinate three), piu' forte lontano dal suolo
const VENTO = { x: 0.62, z: 0.78, v: 6.5 };
function ventoAt(agl){
  const k = clamp(0.35 + agl / 320, 0.35, 1);
  return [VENTO.x * VENTO.v * k, VENTO.z * VENTO.v * k];
}
// Ascendenze (m/s verso l'alto) e turbolenza in un punto:
//  - di pendio: il vento che sale lungo il versante sopravvento (svanisce oltre 260 m dal suolo)
//  - termiche: colonne dove girano i grifoni in orbita (route.grif) e sui versanti al sole
//  - sottovento alle creste: aria discendente e turbolenta
let ASC = { pendio: 0, termica: 0, sole: 0, turb: 0 };
function ascendenzaAt(x, z, agl){
  const h = 60;
  const g0 = groundAt(x, z);
  if (g0 < -1e3) { ASC.pendio = ASC.termica = ASC.sole = ASC.turb = 0; return 0; }
  const gx = (groundAt(x + h, z) - groundAt(x - h, z)) / (2 * h);
  const gz = (groundAt(x, z + h) - groundAt(x, z - h)) / (2 * h);
  const slope = Math.hypot(gx, gz);
  // pendio: componente del vento che sale lungo il versante
  const w = ventoAt(agl);
  const up = -(gx * w[0] + gz * w[1]);          // >0 sopravvento (l'aria e' spinta in su)
  const fadeP = clamp(1 - agl / 260, 0, 1);
  ASC.pendio = clamp(up * 1.3, -2.5, 4.5) * fadeP;
  ASC.turb = (up < -0.6 ? clamp(-up * 0.5, 0, 1) : 0) * fadeP;
  // termiche marcate dai grifoni in orbita
  let term = 0;
  if (route.grif) for (const g of route.grif) {
    const d = Math.hypot(g.c[0] - x, -g.c[1] - z);
    const core = Math.exp(-(d * d) / (190 * 190));
    const band = clamp(agl / 60, 0, 1) * clamp((1000 - agl) / 400, 0, 1);
    term = Math.max(term, 3.8 * core * band);
  }
  ASC.termica = term;
  // versanti al sole
  const sunX = SUNDIR.x, sunZ = SUNDIR.z;
  const L = Math.hypot(sunX, sunZ) || 1;
  const facing = -(gx * sunX + gz * sunZ) / L;
  const quota = route.elev_a * g0 + route.elev_b;
  const sole = clamp(facing * 4.0, 0, 1) * clamp(slope * 3.5, 0, 1) * clamp((quota - 1000) / 700, 0.25, 1);
  ASC.sole = 2.0 * sole * clamp(1 - agl / 380, 0, 1);
  return ASC.pendio + Math.max(ASC.termica, ASC.sole);
}
// ---- sorvolo guidato: il grifone segue il tracciato da solo, a 100 m sopra il sentiero ----
function tourStart(){
  if (FLY.mode === 'cervo') return;   // il sorvolo e' per gli uccelli
  const f = FLY;
  if (!f.on) flyStart();
  f.mode = 'tour'; f.tourS = f.tourS || 0; f.fold = 0; f.flap = false; f.flapPow = 0; f.legs = 0;
  // parte dal punto del tracciato piu' vicino al grifone
  let bd = 1e9, bi = 0;
  for (let i = 0; i < N; i += 3) { const d = Math.hypot(route.x[i] - f.pos.x, -route.y[i] - f.pos.z); if (d < bd) { bd = d; bi = i; } }
  f.tourS = bi / (N - 1) * TOT;
  $('b-tour').classList.add('on');
  document.body.classList.add('tour');
  const lab = document.querySelectorAll('#bar .slot .lab');
  lab[0].textContent = 'Sorvolo'; lab[1].textContent = 'Km'; lab[3].textContent = 'Pendenza';
  st.curZone = -1; st.curKey = null; st.lastHudS = -1e9; st.curPoi = -1;
}
function tourStop(){
  const f = FLY;
  if (f.mode !== 'tour') return;
  f.mode = 'volo'; f.pitchV = 0; f.rollV = 0;
  $('b-tour').classList.remove('on');
  document.body.classList.remove('tour');
  const lab = document.querySelectorAll('#bar .slot .lab');
  lab[0].textContent = (RIG && RIG.sp.terra) ? 'A terra' : 'In volo'; lab[1].textContent = 'Velocità'; lab[3].textContent = (RIG && RIG.sp.terra) ? 'Pendenza' : 'Vario';
  st.lastHudS = -1e9; st.curPoi = -1;
}
function tickTour(dt){
  const f = FLY;
  // qualunque comando riprende il controllo
  if (f.flap || Math.abs(f.keyIn[0]) + Math.abs(f.keyIn[1]) + Math.abs(f.joyIn[0]) + Math.abs(f.joyIn[1]) > 0.3) { tourStop(); return; }
  const VT = 26;
  f.tourS += VT * dt;
  if (f.tourS > TOT) f.tourS = 0;
  st.s = f.tourS;                      // la barra, il profilo e la minimappa seguono il sorvolo
  // bersaglio: 100 m sopra il sentiero, un po' avanti; quota sopra il suolo vero
  posAt(f.tourS + 60, tmpA);
  const gy = suoloVolo(tmpA.x, tmpA.z, tmpA.y + 100);
  tmpA.y = Math.max(tmpA.y, gy > -1e3 ? gy : tmpA.y) + 95;
  tmpB.copy(tmpA).sub(f.pos);
  const dist = tmpB.length();
  const yawT = Math.atan2(tmpB.x, tmpB.z);
  let dy = yawT - f.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  f.yaw += clamp(dy, -1.2 * dt, 1.2 * dt);
  const pT = clamp(Math.atan2(tmpB.y, Math.hypot(tmpB.x, tmpB.z)), -0.5, 0.5);
  f.pitch += (pT - f.pitch) * (1 - Math.exp(-2.5 * dt));
  f.roll += (clamp(dy * 1.5, -0.7, 0.7) - f.roll) * (1 - Math.exp(-2.5 * dt));
  f.v += ((VT + clamp((dist - 80) * 0.15, -8, 14)) - f.v) * (1 - Math.exp(-1.5 * dt));
  fwdOf(f, fwdV);
  const yPrev = f.pos.y;
  f.pos.addScaledVector(fwdV, f.v * dt);
  // correzione dolce verso la quota bersaglio
  f.pos.y += (tmpA.y - f.pos.y) * (1 - Math.exp(-0.8 * dt));
  const g2 = suoloVolo(f.pos.x, f.pos.z, f.pos.y);
  f.agl = g2 > -1e3 ? f.pos.y - g2 : 500;
  if (g2 > -1e3 && f.pos.y < g2 + 25) f.pos.y = g2 + 25;
  f.vario += ((f.pos.y - yPrev) / Math.max(dt, 1e-3) - f.vario) * (1 - Math.exp(-3 * dt));
  // qualche battuta ogni tanto per tenersi su, poi planata
  f.flapPow += (((Math.sin(performance.now() / 4200) > 0.55) ? 1 : 0) - f.flapPow) * (1 - Math.exp(-3 * dt));
  if (f.flapPow > 0.1) f.flapPh += dt * FC.FLAP_HZ * Math.PI * 2;
  gEul.set(-f.pitch, f.yaw, f.roll, 'YXZ');
  grifP.quaternion.setFromEuler(gEul); grifP.position.copy(f.pos);
  {
    const idle = Math.sin(performance.now() / 900) * 0.06 + 0.10;
    posaGrifone(idle * (1 - f.flapPow) + Math.sin(f.flapPh) * 0.85 * f.flapPow, 0, 0, f.roll, 0, 0.02);
  }
  // camera: piu' arretrata e alta, si vede il percorso
  tmpD.set(Math.sin(f.yaw), 0, Math.cos(f.yaw));
  tmpB.copy(f.pos).addScaledVector(tmpD, -48); tmpB.y += 22;
  const cg = suoloVolo(tmpB.x, tmpB.z, tmpB.y);
  if (cg > -1e3 && tmpB.y < cg + 6) tmpB.y = cg + 6;
  camera.position.lerp(tmpB, 1 - Math.exp(-2.5 * dt));
  camTgt.lerp(tmpC.copy(f.pos).addScaledVector(fwdV, 40), 1 - Math.exp(-4 * dt));
  camera.up.set(0, 1, 0); camera.lookAt(camTgt);
  if (Math.abs(camera.fov - 58) > 0.05) { camera.fov += (58 - camera.fov) * (1 - Math.exp(-2 * dt)); camera.updateProjectionMatrix(); }
  if (SHADOWS && sunLight) {
    sunLight.position.set(f.pos.x + SUNDIR.x * 2300, f.pos.y + SUNDIR.y * 2300, f.pos.z + SUNDIR.z * 2300);
    sunLight.target.position.copy(f.pos); sunLight.target.updateMatrixWorld();
  }
  sndWind(f.v * 0.6, 0);
  updateHUD();                         // zona, km, quota, pendenza, cancelli, POI: come con Lino
  $('v-p').innerHTML = $('v-p').innerHTML;    // (la pendenza del sentiero sotto)
}
function tickFly(dt){
  const f = FLY;
  if (window.SRMX && window.SRMX.pausa) return;   // collaudi: uccello fermo a mezz'aria
  if (f.mode === 'cervo') { tickCervo(dt); return; }
  if (f.mode === 'terra') { tickTerra(dt); return; }
  if (f.mode === 'impatto') { tickImpatto(dt); return; }
  if (f.mode === 'tour') { tickTour(dt); return; }
  f.tVolo = (f.tVolo || 0) + dt; if (f.tVolo > 3) f.volato = true;
  // assetto a proiettile: oltre ~150 km/h in picchiata le ali si chiudono sul corpo;
  // rallentando (o alzando il muso) si riaprono da sole
  const foldT = clamp((f.v - FC.FOLD_V) / 16, 0, 1) * clamp((-f.pitch - 0.12) / 0.2, 0, 1);
  f.fold += (foldT - f.fold) * (1 - Math.exp(-(foldT > f.fold ? 3.5 : 2.5) * dt));
  // zampe: scendono gradualmente quando si rallenta vicino al suolo (preparazione al tocco)
  const legsT = clamp((22 - f.v) / 8, 0, 1) * clamp((45 - f.agl) / 30, 0, 1);
  f.legs += (legsT - f.legs) * (1 - Math.exp(-2.5 * dt));
  // ingressi: tastiera + joystick + inclinazione (il più forte vince)
  const pick = (a, b, c) => Math.abs(a) >= Math.abs(b) ? (Math.abs(a) >= Math.abs(c) ? a : c) : (Math.abs(b) >= Math.abs(c) ? b : c);
  f.inX = clamp(pick(f.keyIn[0], f.joyIn[0], f.tiltIn[0]), -1, 1);
  f.inY = clamp(pick(f.keyIn[1], f.joyIn[1], f.tiltIn[1]), -1, 1);   // +1 = picchiata
  const ctl = (f.stall ? 0.25 : 1) * (1 - 0.55 * f.fold);   // ali chiuse: comandi più duri
  // beccheggio: la planata naturale è leggermente a scendere; in stallo il muso cade
  // la picchiata resta piena anche ad ali chiuse; la cabrata e il rollio si induriscono
  let pT = FC.PITCH_GLIDE + (f.inY > 0 ? -f.inY * FC.PITCH_DN * (f.stall ? 0.25 : 1) : -f.inY * FC.PITCH_UP * ctl);
  if (f.stall) pT = Math.min(pT, -0.55);
  if (f.pos.y > FC.CEIL) pT = Math.min(pT, -0.15 - (f.pos.y - FC.CEIL) / 200);
  // beccheggio con inerzia (molla smorzata): risponde, non scatta
  f.pitchV += ((pT - f.pitch) * (f.stall ? 10 : 8.5) * FC.AGIL - f.pitchV * 5.2 * Math.sqrt(FC.AGIL)) * dt;
  f.pitch += f.pitchV * dt;
  // rollio → virata coordinata
  const rT = f.inX * FC.ROLL_MAX * ctl;
  f.rollV += ((rT - f.roll) * 13 * FC.AGIL - f.rollV * 6.2 * Math.sqrt(FC.AGIL)) * dt;
  // turbolenza sottovento alle creste: scossoni sul rollio
  if (ASC.turb > 0) f.rollV += (Math.sin(performance.now() / 173) + Math.sin(performance.now() / 61) * 0.5) * ASC.turb * 1.4 * dt;
  f.roll += f.rollV * dt;
  const yawRate = clamp(FC.G * Math.tan(f.roll) / Math.max(f.v, 10), -1.1 * FC.AGIL, 1.1 * FC.AGIL);
  f.yaw -= yawRate * dt;
  // battito d'ali: ciclo a FLAP_HZ, spinta in avanti + un po' di portanza
  if (f.flap && f.pos.y < FC.CEIL) {
    f.flapPh += dt * FC.FLAP_HZ * Math.PI * 2;
    f.flapPow += (1 - f.flapPow) * (1 - Math.exp(-6 * dt));
  } else {
    // completa il ciclo e torna in planata, senza scatti
    if (f.flapPh % (Math.PI * 2) > 0.05) f.flapPh += dt * FC.FLAP_HZ * Math.PI * 2 * 0.8;
    f.flapPow += (0 - f.flapPow) * (1 - Math.exp(-4 * dt));
  }
  const beat = Math.max(0, Math.sin(f.flapPh));
  // un "whoosh" a ogni battuta (passaggio per l'inizio del ciclo)
  const cyc = Math.floor(f.flapPh / (Math.PI * 2));
  if (cyc !== f.flapCyc) { f.flapCyc = cyc; if (f.flapPow > 0.2) sndFlap(); }
  sndWind(f.v, f.fold);
  // in cabrata il battito rende di più (ali che 'remano'): salita decisa
  const cabra = clamp(f.pitch / 0.35, 0, 1);
  // oltre i ~110 km/h il battito non morde più: in cabrata veloce si scambia velocità con quota
  const morde = clamp(1 - (f.v - FC.MORDE_V0) / 25, 0, 1);
  const thrust = FC.FLAP_ACC * beat * f.flapPow * (1 + 0.9 * cabra) * morde;
  // bilancio di velocità lungo la prua
  // ad alta velocità il grifone si 'chiude' e la resistenza cala: la picchiata ripida arriva a VMAX
  const chiuso = 1 - 0.46 * clamp((f.v - 25) / 25, 0, 1) - 0.33 * f.fold;
  const drag = FC.CD * f.v * f.v * chiuso * (1 + 1.4 * (1 - Math.cos(f.roll)));
  let dv = -FC.G * Math.sin(f.pitch) - drag + thrust;
  if (f.v < FC.VSTALL + 1 && f.pitch > 0) dv -= 1.5;     // cabrata lenta: il muso perde ancora
  // richiamare costa energia: piu' e' brusca la cabrata (fattore di carico), piu' si frena
  if (f.pitchV > 0) dv -= 0.22 * f.pitchV * f.v;
  // effetto suolo: negli ultimi metri l'aria "porta" un po' di piu'
  if (f.agl < 12) dv += 0.4 * (1 - f.agl / 12);
  f.v = clamp(f.v + dv * dt, 3, FC.VMAX);
  // stallo
  if (!f.stall && f.v < FC.VSTALL && f.pitch > -0.25) { f.stall = true; f.stallT = 0; }
  if (f.stall) { f.stallT += dt; if (f.v > FC.VSTALL + 3 && f.stallT > 0.8) f.stall = false; }
  // moto
  fwdOf(f, fwdV);
  const yPrev = f.pos.y;
  f.pos.addScaledVector(fwdV, f.v * dt);
  if (f.stall) f.pos.y -= (FC.VSTALL + 2 - f.v) * 2.2 * dt;
  f.pos.y += FC.FLAP_LIFT * beat * f.flapPow * (1 + 1.2 * cabra) * morde * dt;
  const gy = suoloVolo(f.pos.x, f.pos.z, f.pos.y);
  f.agl = gy > -1e3 ? f.pos.y - gy : 500;
  f.lift = ascendenzaAt(f.pos.x, f.pos.z, f.agl);
  f.pos.y += f.lift * dt;
  if (f.agl < 12) f.pos.y += 0.9 * (1 - f.agl / 12) * dt;      // effetto suolo
  // deriva col vento (la velocita' e' quella rispetto all'aria)
  const wv = ventoAt(f.agl);
  f.pos.x += wv[0] * dt; f.pos.z += wv[1] * dt;
  // suolo: si rimbalza sopra con perdita di velocità
  if (gy > -1e3 && f.pos.y < gy + FC.AGL_MIN) {
    if (f.v > FC.V_IMP || f.pitch < FC.PITCH_IMP) {
      // troppo veloce o troppo a muso in giù: impatto
      impatto();
      return;
    } else if (f.v < FC.V_ATT && f.pitch > -0.22) {
      // lento e in assetto: si posa
      atterra(gy);
      return;
    }
    // sfioramento: il muso viene tirato su, si perde un po' di velocità ma non ci si pianta
    f.pos.y = gy + FC.AGL_MIN;
    f.v = Math.max(f.v * 0.992, 13);
    if (f.pitch < 0.12) f.pitch = 0.12;
    f.agl = FC.AGL_MIN;
  }
  // confine morbido: oltre l'ellisse la prua viene riportata dolcemente al centro
  const ex = (f.pos.x - FC.BC[0]) / FC.BR[0], ez = (f.pos.z - FC.BC[1]) / FC.BR[1];
  const er = Math.hypot(ex, ez);
  if (er > 0.82) {
    const k = clamp((er - 0.82) / 0.18, 0, 1);
    const yawHome = Math.atan2(FC.BC[0] - f.pos.x, FC.BC[1] - f.pos.z);
    let d = yawHome - f.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    f.yaw += d * k * 1.6 * dt;
    if (er > 1.0) { f.pos.x = FC.BC[0] + ex / er * FC.BR[0]; f.pos.z = FC.BC[1] + ez / er * FC.BR[1]; }
  }
  f.vario += ((f.pos.y - yPrev) / Math.max(dt, 1e-3) - f.vario) * (1 - Math.exp(-3 * dt));
  // posa del grifone: leggera oscillazione in planata, ali che seguono il battito
  gEul.set(-f.pitch, f.yaw, f.roll, 'YXZ');
  grifP.quaternion.setFromEuler(gEul);
  grifP.position.copy(f.pos);
  {
    const idle = Math.sin(performance.now() / 900) * 0.06 + 0.10;    // ali leggermente a diedro
    const fl = Math.sin(f.flapPh) * 0.85 * f.flapPow;
    posaGrifone((idle * (1 - f.flapPow) + fl) * (1 - f.fold) - 0.30 * f.fold, 1.15 * f.fold, f.legs,
                f.roll, -f.inY, 0.02 + 0.06 * clamp((f.v - 40) / 40, 0, 1));
  }
  // camera d'inseguimento
  const back = (26 + f.v * 0.07) * (RIG ? RIG.sp.cam : 1);
  tmpD.set(Math.sin(f.yaw), 0, Math.cos(f.yaw));
  tmpB.copy(f.pos).addScaledVector(tmpD, -back);
  tmpB.y += 12 - f.pitch * 10 - 4 * f.fold;
  // micro-tremolio oltre i ~200 km/h
  f.shake = clamp((f.v - 56) / 28, 0, 1);
  if (f.shake > 0) {
    const tn = performance.now();
    tmpB.x += Math.sin(tn / 23) * 0.35 * f.shake; tmpB.y += Math.sin(tn / 17) * 0.3 * f.shake; tmpB.z += Math.cos(tn / 29) * 0.35 * f.shake;
  }
  const cg = suoloVolo(tmpB.x, tmpB.z, tmpB.y);
  if (cg > -1e3 && tmpB.y < cg + 4) tmpB.y = cg + 4;
  camera.position.lerp(tmpB, 1 - Math.exp(-5 * dt));
  tmpC.copy(f.pos).addScaledVector(fwdV, 30);
  camTgt.lerp(tmpC, 1 - Math.exp(-7 * dt));
  f.camRoll += (f.roll * 0.28 - f.camRoll) * (1 - Math.exp(-3 * dt));
  upV.set(Math.sin(f.camRoll), Math.cos(f.camRoll), 0);
  camera.up.copy(upV);
  camera.lookAt(camTgt);
  camera.up.set(0, 1, 0);
  // campo visivo che si allarga con la velocità: la picchiata si sente
  const fovT = 55 + 13 * clamp((f.v - 22) / 55, 0, 1);
  if (Math.abs(camera.fov - fovT) > 0.05) { camera.fov += (fovT - camera.fov) * (1 - Math.exp(-3 * dt)); camera.updateProjectionMatrix(); }
  if (SHADOWS && sunLight) {
    sunLight.position.set(f.pos.x + SUNDIR.x * 2300, f.pos.y + SUNDIR.y * 2300, f.pos.z + SUNDIR.z * 2300);
    sunLight.target.position.copy(f.pos);
    sunLight.target.updateMatrixWorld();
  }
  $('stallo').classList.toggle('on', f.stall);
  updateHUDFly();
}
// ---- a terra: ali chiuse, si riparte battendo le ali (o buttandosi da un pendio) ----
function atterra(gy){
  const f = FLY;
  f.mode = 'terra'; f.tT = 0; f.flapHold = 0; f.roll = 0; f.fold = 0; f.pitchV = 0; f.rollV = 0;
  sndTocco(); vibra(40); sndWind(0, 0);
  f.pos.y = gy + FC.H_TERRA;
  f.stall = false; $('stallo').classList.remove('on');
  // vetta vicina: scheda della cima
  let best = 1e9, bp = null;
  for (const p of route.peaks) {
    const d = Math.hypot(p.x - f.pos.x, -p.y - f.pos.z);
    if (d < best) { best = d; bp = p; }
  }
  if (bp && best < 90) openCard(schedaVetta(bp));
}
// ---- schede delle vette: testo curato + dati calcolati dalla scena ----
const PEAK_INFO = {
  'Monte Velino': ['Il tetto del massiccio e la terza vetta dell\u2019Appennino dopo il Corno Grande e il Monte Amaro. Un cono di calcare che domina la Marsica e il Fucino: la Riserva Naturale Orientata che porta il suo nome (1987) è il cuore del Parco Sirente Velino, e qui, sulle sue pareti, sono tornati a nidificare i grifoni reintrodotti negli anni Novanta.',
    'La gara non tocca la cima: la sfiora sulla spalla, a 2.385 m, il punto più alto del tracciato. Dalla croce, nelle giornate limpide, lo sguardo corre dal Gran Sasso alla Maiella, dal Sirente al Terminillo e giù fino alla piana del Fucino.'],
  'Monte Cafornia': ['La seconda cima del massiccio, gemella orientale del Velino, a cui è legata da una lunga cresta d\u2019alta quota. Dalla sua cima la valle di Magliano è tutta davanti, fino al Fucino.',
    'La Skyrace la costeggia lungo il crinale che dal Velino porta alla Selletta, dove comincia la grande discesa verso Fonte Canale: oltre 1.100 m di dislivello in tre chilometri.'],
  'Monte di Sevice': ['La montagna della Capanna di Sevice: il rifugio ai suoi piedi, a 2.115 m, è l\u2019unico ristoro completo della gara e il secondo cancello orario (ore 12:45).',
    'Dalla sua groppa si domina la conca della capanna e la lunga dorsale del Rozza da cui arrivano gli atleti.'],
  'Monte Costognillo': ['Un\u2019anticima fra il Sevice e il Velino, sul bordo dell\u2019altopiano sommitale.',
    'Sotto di lei passano le Tre Sorelle, il tratto più aereo della gara, prima dell\u2019attacco al cono del Velino.'],
  'Cima Avezzano': ['Una delle cime che chiudono a nord-est il gruppo del Velino, affacciata sui valloni che scendono verso i Piani di Pezza.',
    'Fuori dal tracciato ma a un tiro d\u2019ala dalla spalla del Velino: da qui si vede tutta la cresta percorsa dalla gara.'],
  'Le Tre Sorelle': ['Tre groppe erbose in fila, a 2.200 m, sul filo fra la Val di Teve e i pascoli di Sevice. Il nome viene dalla loro forma: tre gobbe gemelle una dietro l\u2019altra.',
    'La gara le percorre tutte, dal km 15 al km 16,7, prima di rasentare le pareti della Val di Teve: è il balcone più bello del giro.'],
  'Monte Rozza': ['La lunga dorsale che sale da Passo Le Forche verso la Capanna di Sevice: il \u201c3B\u201d, la salita più lunga della gara.',
    'Dal suo crinale, al km 12,6, si apre il balcone sulla Val di Teve, la valle selvaggia nel cuore della Riserva.'],
  'Cimata Fossa dei Cavalli': ['Una cimata erbosa a est del Velino, sopra la Fossa dei Cavalli: un tempo i pascoli estivi delle mandrie in monticazione.',
    'Fuori dal percorso, ma sorvegliata da vicino dai grifoni che sfruttano le ascendenze di questi versanti.'],
  'Punta Trento': ['Con la vicina Punta Trieste forma una coppia di cime sul lato orientale del massiccio, battezzate con i nomi delle città redente dopo la Grande Guerra.', ''],
  'Punta Trieste': ['La gemella di Punta Trento, poco più a est: due punte sulla stessa cresta, sopra i valloni che scendono verso i Piani di Pezza.', ''],
  'Murolungo': ['Il \u201cmuro lungo\u201d che chiude a ovest la Val di Teve: una bastionata di pareti calcaree fra le più selvagge del Parco, regno di grifoni e di silenzio.',
    'Sta di fronte al crinale del Rozza: è la montagna che gli atleti hanno davanti quando si affacciano sulla Val di Teve.'],
  'Iaccio dei Montoni': ['Uno \u201ciaccio\u201d è, nel dialetto dei pastori, il recinto dove si chiudevano le greggi la notte: il nome racconta secoli di monticazione su queste montagne.', ''],
  'Capo di Pezza': ['La cima che sovrasta i Piani di Pezza, il grande altopiano carsico sul versante di Rocca di Mezzo.', ''],
  'Cimata della Selva del Coco': ['Una cimata boscosa sul versante nord-orientale del massiccio, dove la faggeta sale fin quasi in cresta.', ''],
  'Monte il Bicchero': ['Una cima secondaria sul lato nord del gruppo, fra il Velino e i Piani di Pezza.', ''],
  'Costone': ['Il nome dice tutto: un lungo costone erboso sulle propaggini settentrionali del massiccio.', ''],
  'Colle delle Trincere': ['Un colle sul versante nord-orientale; il nome ricorda vecchie linee di trincea, forse legate alle esercitazioni militari del secolo scorso.', ''],
  'Cima della Sentina': ['Una cima delle propaggini sud-orientali del Velino, sopra i paesi della piana.',
    'Da qui si dominano Massa d\u2019Albe e i resti di Alba Fucens, la città romana ai piedi del monte.'],
  'La Difensola': ['Un colle boscoso sopra Massa d\u2019Albe: la \u201cdifesa\u201d era il bosco protetto dalla comunità, dove il taglio era regolato.',
    'Sotto di lei la gara torna verso Magliano lungo il sentiero E1, dopo Fonte Canale.'],
  'Punta Canale': ['Il rilievo che dà il nome a Fonte Canale, il fontanile di sorgente dove gli atleti trovano l\u2019ultimo punto acqua (km 24,3).', ''],
  'Monte Rastegliu': ['Una collina boscosa sopra Massa d\u2019Albe, sul lato della piana del Fucino.', ''],
  'Monte della Maddalena': ['La collina che chiude a ovest la conca di Magliano de\u2019 Marsi, dalla parte opposta al Velino.',
    'Dalla sua cima si vede tutto il giro: il paese, le colline di Rosciolo e, dietro, l\u2019intero massiccio.']
};
function schedaVetta(p, daSentiero){
  const info = PEAK_INFO[p.n] || ['Una delle cime del gruppo del Velino.', ''];
  const px = p.x, pz = -p.y;
  // quanto si domina Magliano e quanto è lontana in linea d'aria
  posAt(0, tmpA);
  const dMag = Math.hypot(tmpA.x - px, tmpA.z - pz) / 1000;
  const disl = p.e - 729;
  // punto della gara più vicino
  let bd = 1e9, bi = 0;
  for (let i = 0; i < N; i += 2) {
    const d = Math.hypot(route.x[i] - px, -route.y[i] - pz);
    if (d < bd) { bd = d; bi = i; }
  }
  const km = bi / (N - 1) * route.total_km;
  const z = zoneAt(km);
  let gara;
  if (bd < 250) gara = 'La gara passa proprio qui: km ' + km.toFixed(1).replace('.', ',') + ', zona \u201c' + z[2] + '\u201d.';
  else if (bd < 1500) gara = 'Il tracciato passa a ' + Math.round(bd / 50) * 50 + ' m in linea d\u2019aria: km ' + km.toFixed(1).replace('.', ',') + ', zona \u201c' + z[2] + '\u201d.';
  else gara = 'La gara resta lontana: il punto più vicino del tracciato è a ' + (bd / 1000).toFixed(1).replace('.', ',') + ' km (km ' + km.toFixed(1).replace('.', ',') + ', \u201c' + z[2] + '\u201d).';
  // vette vicine, con direzione
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const vicine = route.peaks.filter(q => q !== p).map(q => {
    const dx = q.x - px, dz = -q.y - pz, d = Math.hypot(dx, dz);
    // angolo dal nord (blender +y = nord = -z three), in senso orario
    const ang = Math.atan2(dx, -dz);
    return { q, d, dir: dirs[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8] };
  }).sort((a, b) => a.d - b.d).slice(0, 3);
  const vic = vicine.map(v => v.q.n + ' (' + v.q.e + ' m, ' + (v.d / 1000).toFixed(1).replace('.', ',') + ' km a ' + v.dir + ')').join(' · ');
  // fascia altitudinale
  let fascia;
  if (p.e >= 2000) fascia = 'Sopra i 2.000 m: praterie d\u2019altitudine e pietraie, il terreno di caccia dei grifoni, che qui planano sfruttando le ascendenze dei versanti al sole.';
  else if (p.e >= 1400) fascia = 'Siamo nella fascia della faggeta, che sul Velino sale fin verso i 1.800 m prima di lasciare il posto ai pascoli.';
  else fascia = 'Colline di querceti, coltivi e pascoli: la campagna che circonda Magliano e i borghi ai piedi del massiccio.';
  const nat = naturaAt(km);
  return '<h2>' + p.n + '</h2><h3>' + p.e.toLocaleString('it-IT') + ' m' + (daSentiero ? ' · vetta' : ' · sei atterrato in vetta') + '</h3>' +
    '<p>' + info[0] + '</p>' + (info[1] ? '<p style="margin-top:8px">' + info[1] + '</p>' : '') +
    '<table><tr><th>Sopra Magliano</th><td>' + disl.toLocaleString('it-IT') + ' m di dislivello, ' + dMag.toFixed(1).replace('.', ',') + ' km in linea d\u2019aria</td></tr>' +
    '<tr><th>La gara</th><td>' + gara + '</td></tr>' +
    '<tr><th>Vette vicine</th><td>' + vic + '</td></tr>' +
    '<tr><th>Ambiente</th><td>' + fascia + '</td></tr></table>' +
    '<p style="margin-top:10px;font-size:13px"><b>Natura.</b> ' + nat.txt.split('. ').slice(0, 2).join('. ') + '.</p>' +
    '<p style="margin-top:6px;font-size:13px"><b>Chi vive qui.</b> ' + nat.fauna + '</p>' +
    (daSentiero ? '' : '<p style="margin-top:12px;color:var(--grigio);font-size:13px">Tieni premuto <b>BATTI</b> (o SPAZIO) per decollare; da un pendio ripido basta la picchiata.</p>');
}
// ---------- modalita' CERVO: esplorazione a terra con gli stessi comandi del volo ----------
// Avanti = passo/trotto, CORRI (SPAZIO) = galoppo, sinistra/destra = gira. Zoccoli sempre sulla mesh
// vera, corpo inclinato con il pendio, andature procedurali per ossa (passo a 4 tempi, trotto e
// galoppo), fermo: respiro, testa che guarda, orecchie. Pendii oltre ~43 gradi: non si sale.
function cervoInizio(eraTerra){
  const f = FLY;
  f.mode = 'cervo'; f.fold = 0; f.flapPow = 0; f.stall = false; f.roll = 0; f.pitch = 0;
  CER.v = 0; CER.ph = 0; CER.gait = 0; CER.pronto = false;
  if (!eraTerra && !(f.volato)) {
    // partenza da Lino: se e' gia' sul percorso, 7 m a lato del sentiero; se e' ancora in paese,
    // poco prima del Monte Rozza (km 11,8), dove il sentiero sale sulle creste
    const sRef = st.s > 500 ? st.s : 11800;
    posAt(sRef, tmpA); tanAt(sRef, tmpB);
    f.pos.set(tmpA.x - tmpB.z * 7, tmpA.y, tmpA.z + tmpB.x * 7);
    f.yaw = Math.atan2(tmpB.x, tmpB.z);
  }
  // a terra, sulla mesh vera, sotto il punto attuale
  let gy = terraVera(f.pos.x, f.pos.z, f.pos.y);
  if (gy < -1e3) gy = groundAt(f.pos.x, f.pos.z);
  if (gy > -1e3) f.pos.y = gy;
  f.agl = 0; f.vario = 0; f.v = 0;
  document.body.classList.add('cervo');
  if (f.mode === 'tour') tourStop();
  // camera dietro e un po' alta
  fwdV.set(Math.sin(f.yaw), 0, Math.cos(f.yaw));
  camera.position.copy(f.pos).addScaledVector(fwdV, -26); camera.position.y += 11;
  camTgt.copy(f.pos); camTgt.y += 4;
  if (!TIDX) { try { TIDX = buildTerrIndex(); } catch (e) {} }
}
const cTmp = new THREE.Vector3(), cTmp2 = new THREE.Vector3();
function tickCervo(dt){
  const f = FLY, C = CER, cc = RIG && RIG.sp.cc; if (!cc) return;
  // ingressi (tastiera, joystick, inclinazione): su = avanti, giu' = frena, lati = gira
  const pick = (a, b, c) => Math.abs(a) >= Math.abs(b) ? (Math.abs(a) >= Math.abs(c) ? a : c) : (Math.abs(b) >= Math.abs(c) ? b : c);
  f.inX = clamp(pick(f.keyIn[0], f.joyIn[0], f.tiltIn[0]), -1, 1);
  f.inY = clamp(pick(f.keyIn[1], f.joyIn[1], f.tiltIn[1]), -1, 1);
  const avanti = Math.max(0, f.inY), indietro = Math.max(0, -f.inY);
  // velocita' obiettivo: trotto proporzionale alla spinta, galoppo con CORRI tenuto
  let vT = avanti * (f.flap ? cc.V_GALOPPO : cc.V_TROTTO);
  if (avanti > 0.05 && avanti < 0.45 && !f.flap) vT = cc.V_PASSO * (avanti / 0.45);
  if (indietro > 0.3) vT = 0;
  // pendenza davanti: in salita si rallenta, oltre la pendenza massima ci si ferma
  fwdV.set(Math.sin(f.yaw), 0, Math.cos(f.yaw));
  const gHere = suoloVolo(f.pos.x, f.pos.z, f.pos.y + 2);
  const gAhead = suoloVolo(f.pos.x + fwdV.x * 6, f.pos.z + fwdV.z * 6, f.pos.y + 6);
  const pend = (gHere > -1e3 && gAhead > -1e3) ? (gAhead - gHere) / 6 : 0;    // tan della pendenza lungo la prua
  if (pend > cc.PEND_MAX) vT = Math.min(vT, 1.5);
  else if (pend > 0) vT *= 1 - 0.55 * clamp(pend / cc.PEND_MAX, 0, 1);
  const k = vT > C.v ? cc.ACC : cc.FRENO;
  C.v += clamp(vT - C.v, -k * dt, k * dt);
  if (C.v < 0.05) C.v = 0;
  f.v = C.v;
  // sterzata: piu' stretta da fermo e al passo, piu' larga al galoppo
  const giro = cc.GIRO * (1 - 0.55 * clamp(C.v / cc.V_GALOPPO, 0, 1));
  f.yaw -= f.inX * giro * dt;
  // moto sul terreno
  f.pos.addScaledVector(fwdV, C.v * dt);
  let gy = suoloVolo(f.pos.x, f.pos.z, f.pos.y + 2);
  if (gy < -1e3) gy = groundAt(f.pos.x, f.pos.z);
  if (gy > -1e3) f.pos.y += (gy - f.pos.y) * (1 - Math.exp(-14 * dt));
  f.agl = 0; f.lift = 0;
  f.vario += ((C.v * pend) - f.vario) * (1 - Math.exp(-3 * dt));
  // confine morbido come in volo
  const ex = (f.pos.x - FC.BC[0]) / FC.BR[0], ez = (f.pos.z - FC.BC[1]) / FC.BR[1];
  const er = Math.hypot(ex, ez);
  if (er > 1.0) { f.pos.x = FC.BC[0] + ex / er * FC.BR[0]; f.pos.z = FC.BC[1] + ez / er * FC.BR[1]; }
  // assetto: beccheggio lungo il pendio, rollio col pendio trasversale (molle lente)
  const gL = suoloVolo(f.pos.x + fwdV.z * 2.5, f.pos.z - fwdV.x * 2.5, f.pos.y + 3), gR = suoloVolo(f.pos.x - fwdV.z * 2.5, f.pos.z + fwdV.x * 2.5, f.pos.y + 3);
  // il corpo resta verticale: al pendio trasversale si adattano le zampe (C.lat), in curva veloce
  // c'e' solo una leggera piega verso l'interno
  const pT = clamp(Math.atan(pend) * 0.6, -0.5, 0.5);
  const latT = (gL > -1e3 && gR > -1e3) ? clamp(Math.atan((gL - gR) / 5), -0.45, 0.45) : 0;
  const rT = -f.inX * 0.10 * clamp(C.v / cc.V_GALOPPO, 0, 1);
  C.pitch += (pT - C.pitch) * (1 - Math.exp(-4 * dt));
  C.roll += (rT - C.roll) * (1 - Math.exp(-4 * dt));
  C.lat = (C.lat || 0) + (latT - (C.lat || 0)) * (1 - Math.exp(-4 * dt));
  // andatura: 0 fermo, 1 passo, 2 trotto, 3 galoppo; fase dalla distanza percorsa
  const gaitT = C.v < 0.2 ? 0 : C.v < cc.V_PASSO + 1.5 ? 1 : C.v < cc.V_TROTTO + 4 ? 2 : 3;
  C.gait += (gaitT - C.gait) * (1 - Math.exp(-5 * dt));
  const passo = [1, 4.6, 8.0, 14.5][gaitT] || 4.6;    // lunghezza della falcata in unita' di scena
  if (C.v > 0.2) C.ph += dt * Math.PI * 2 * C.v / passo; else C.idleT += dt;
  posaCervo(dt);
  // posa del gruppo: inclinato come il suolo, con il "bob" della corsa
  gEul.set(-C.pitch, f.yaw, -C.roll, 'YXZ');   // muso in giu' in discesa
  grifP.quaternion.setFromEuler(gEul);
  grifP.position.copy(f.pos); grifP.position.y += C.bob;
  // camera d'inseguimento
  const back = 22 + C.v * 0.25, alto = 9 + C.v * 0.08;
  cTmp.copy(f.pos).addScaledVector(fwdV, -back); cTmp.y += alto;
  const gc = groundAt(cTmp.x, cTmp.z); if (gc > -1e3 && cTmp.y < gc + 4) cTmp.y = gc + 4;
  if (!(window.SRMX && window.SRMX.freeze)) {
    camera.position.lerp(cTmp, 1 - Math.exp(-3.2 * dt));
    cTmp2.copy(f.pos); cTmp2.y += 4.5;
    camTgt.lerp(cTmp2, 1 - Math.exp(-6 * dt));
    camera.lookAt(camTgt);
  }
  if (SHADOWS && sunLight) {
    sunLight.position.set(f.pos.x + SUNDIR.x * 2300, f.pos.y + SUNDIR.y * 2300, f.pos.z + SUNDIR.z * 2300);
    sunLight.target.position.copy(f.pos); sunLight.target.updateMatrixWorld();
  }
  sndWind(0, 0);
  updateHUDFly();
  $('v-p').innerHTML = (pend * 100 > 0 ? '+' : '') + Math.round(pend * 100) + '<span class="unit"> %</span>';
  $('stallo').classList.remove('on');
}
// andature per ossa: passo (4 tempi, coppie diagonali sfalsate), trotto (diagonali insieme),
// galoppo (anteriori quasi insieme, posteriori quasi insieme, schiena che si flette)
function posaCervo(dt){
  const C = CER, m = RIG.map, t = performance.now() / 1000;
  const g = C.gait, ph = C.ph;
  const wIdle = clamp(1 - g, 0, 1), wWalk = clamp(1 - Math.abs(g - 1), 0, 1), wTrot = clamp(1 - Math.abs(g - 2), 0, 1), wGal = clamp(g - 2, 0, 1);
  // ampiezza dell'oscillazione dell'arto e flessione in volo per andatura
  const A = 0.22 * wWalk + 0.32 * wTrot + 0.46 * wGal, B = 0.45 * wWalk + 0.60 * wTrot + 0.85 * wGal;
  // sfasamenti: passo/trotto diagonali (FL+RR, FR+RL); galoppo per coppie trasversali
  const offWalk = { FL: 0, RR: 0.35, FR: Math.PI, RL: Math.PI + 0.35 };
  const offGal = { FL: 0, FR: 0.5, RL: Math.PI + 0.1, RR: Math.PI + 0.6 };
  const zampa = (k, post) => {
    const off = offWalk[k] * (1 - wGal) + offGal[k] * wGal;
    const p = ph + off;
    const sw = Math.sin(p);                                   // rotazione x positiva = arto indietro
    const vol = Math.max(0, -Math.cos(p));                   // l'arto avanza (sospeso): si flette
    const ch = m[k];
    // spalla/anca: oscillazione. Anteriore: gomito e carpo si piegano all'indietro.
    // Posteriore: grassella indietro, garretto in avanti, nodello indietro (zampa che si raccoglie)
    rotBone(ch[0], AX.x, sw * A * (post ? 1.0 : 0.9) + C.pitch * 0.85, AX.z, -(C.lat || 0));   // compensi: zampe verticali col corpo inclinato in avanti, e piegate col pendio laterale
    if (!post) {
      rotBone(ch[1], AX.x, vol * B * 0.55);
      rotBone(ch[2], AX.x, vol * B * 0.65);
      rotBone(ch[3], AX.x, vol * B * 0.3);
    } else {
      rotBone(ch[1], AX.x, vol * B * 0.5);
      rotBone(ch[2], AX.x, -vol * B * 0.7);
      rotBone(ch[3], AX.x, vol * B * 0.35);
    }
  };
  zampa('FL', false); zampa('FR', false); zampa('RL', true); zampa('RR', true);
  // schiena e bob: al galoppo il dorso si flette e si distende con la falcata
  const flex = Math.sin(ph + 0.4) * (0.06 * wTrot + 0.16 * wGal);
  m.spine.forEach((n, i) => rotBone(n, AX.x, flex * (0.6 + 0.4 * i)));
  rotBone(m.pelvis, AX.x, -flex * 0.8);
  C.bob = (Math.sin(ph * 2) * (0.05 * wWalk + 0.08 * wTrot) + Math.sin(ph) * 0.22 * wGal) * (RIG.sc / 4.4);
  // collo e testa: fermo guarda in giro e bruca ogni tanto; in corsa il collo si allunga avanti
  const look = Math.sin(t * 0.35) * 0.6 + Math.sin(t * 0.13 + 1) * 0.4;
  const graze = wIdle * clamp(Math.sin(t * 0.09 + C.idleT * 0.01) * 3 - 1.5, 0, 1);
  const stretch = 0.12 * wTrot + 0.30 * wGal;
  const turnLook = -FLY.inX * 0.35;
  m.neck.forEach((n, i) => rotBone(n, AX.y, (look * 0.25 * wIdle + turnLook * 0.4) * (i === 0 ? 1 : 0.6), AX.x, graze * 0.35 + stretch * 0.4 - Math.sin(ph) * 0.03 * wGal));
  rotBone(m.head, AX.y, look * 0.3 * wIdle + turnLook * 0.3, AX.x, graze * 0.3 - stretch * 0.5 + Math.sin(t * 0.7) * 0.03);
  // coda: su quando corre (allarme), ferma e penzolante da fermo; orecchie a scatti
  m.tail.forEach((n, i) => rotBone(n, AX.x, -(0.25 * wTrot + 0.55 * wGal) * (i === 0 ? 1 : 0.5) + Math.sin(t * 1.6 + i) * 0.04 * wIdle, AX.y, Math.sin(t * 1.3) * 0.08 * wIdle));
  const e1 = Math.sin(t * 3.3) > 0.9 ? 1 : 0, e2 = Math.sin(t * 2.7 + 2) > 0.9 ? 1 : 0;
  rotBone(m.earL, AX.z, e1 * 0.3 * wIdle); rotBone(m.earR, AX.z, -e2 * 0.3 * wIdle);
}
function tickTerra(dt){
  const f = FLY;
  f.tT += dt;
  // frenata sul suolo lungo la prua
  f.v = Math.max(0, f.v - 14 * dt);
  fwdV.set(Math.sin(f.yaw), 0, Math.cos(f.yaw));
  f.pos.addScaledVector(fwdV, f.v * dt);
  const gy = suoloVolo(f.pos.x, f.pos.z, f.pos.y);
  if (gy > -1e3) f.pos.y = gy + FC.H_TERRA;
  f.agl = 0; f.lift = 0; f.vario = 0;
  f.pitch += (0.18 - f.pitch) * (1 - Math.exp(-3 * dt));
  f.roll += (0 - f.roll) * (1 - Math.exp(-3 * dt));
  // ali che si chiudono appena fermo
  const foldT = f.v < 2 ? 1 : 0;
  f.fold += (foldT - f.fold) * (1 - Math.exp(-3.5 * dt));
  f.legs += (1 - f.legs) * (1 - Math.exp(-4 * dt));
  // decollo: BATTI tenuto premuto, oppure ci si butta da un pendio ripido con la picchiata
  const inY = clamp(Math.max(f.keyIn[1], f.joyIn[1], f.tiltIn[1]), -1, 1);
  if (f.flap && f.v < 2) f.flapHold += dt; else f.flapHold = 0;
  let via = false;
  if (f.flapHold > 0.35) { via = true; f.v = 12; f.pitch = 0.25; }
  else if (inY > 0.5 && f.v < 2) {
    const gAhead = groundAt(f.pos.x + fwdV.x * 40, f.pos.z + fwdV.z * 40);
    if (gAhead > -1e3 && gAhead < gy - 18) { via = true; f.v = 14; f.pitch = -0.35; }
  }
  if (via) { f.mode = 'volo'; f.fold = 0; f.flapPow = 0.6; f.pos.y = gy + FC.H_TERRA + 0.3; closeModal(); }
  // posa e camera che gira piano intorno
  gEul.set(-f.pitch, f.yaw, f.roll, 'YXZ');
  grifP.quaternion.setFromEuler(gEul);
  grifP.position.copy(f.pos);
  {
    const idle = Math.sin(performance.now() / 900) * 0.05 + 0.08;
    // ali chiuse a terra: raccolte all'indietro lungo il corpo e appena abbassate (le punte non devono bucare il suolo)
    posaGrifone(idle * (1 - f.fold) - 0.42 * f.fold + (f.flap ? Math.sin(performance.now() / 80) * 0.5 * (1 - f.fold) : 0),
                1.05 * f.fold, f.legs, 0, 0, 0);
  }
  f.orbit += dt * 0.18;
  const ang = f.yaw + Math.PI + f.orbit;
  tmpB.set(f.pos.x + Math.sin(ang) * 20, f.pos.y + 7, f.pos.z + Math.cos(ang) * 20);
  const cg = terraVera(tmpB.x, tmpB.z, tmpB.y);
  if (cg > -1e3 && tmpB.y < cg + 2.5) tmpB.y = cg + 2.5;
  camera.position.lerp(tmpB, 1 - Math.exp(-2.5 * dt));
  camTgt.lerp(tmpC.copy(f.pos).setY(f.pos.y - 1), 1 - Math.exp(-4 * dt));
  camera.up.set(0, 1, 0); camera.lookAt(camTgt);
  if (Math.abs(camera.fov - 55) > 0.05) { camera.fov += (55 - camera.fov) * (1 - Math.exp(-3 * dt)); camera.updateProjectionMatrix(); }
  if (SHADOWS && sunLight) {
    sunLight.position.set(f.pos.x + SUNDIR.x * 2300, f.pos.y + SUNDIR.y * 2300, f.pos.z + SUNDIR.z * 2300);
    sunLight.target.position.copy(f.pos); sunLight.target.updateMatrixWorld();
  }
  hudFlyT++;
  if (hudFlyT % 6 === 0) {
    $('v-km').textContent = Math.round(f.v * 3.6);
    $('v-q').innerHTML = Math.round(route.elev_a * f.pos.y + route.elev_b) + '<span class="unit"> m</span>';
    $('v-p').innerHTML = '0,0<span class="unit"> m/s</span>';
    $('zona-n').textContent = f.v < 2 ? 'A terra · ali chiuse' : 'Atterraggio';
    $('zona-s').textContent = f.v < 2 ? 'tieni premuto BATTI per decollare' : '';
    drawMiniPos();
  }
}
// ---- impatto: capriola, schermo che sfuma, si riparte dal Cafornia ----
// suolo VERO (mesh del terreno) in un punto: la griglia di groundAt e' grossolana e in
// certi punti sta sotto la mesh, e il grifone finiva "sotto terra"
// Indice spaziale dei triangoli della mesh del terreno (celle di 60 m in pianta):
// il raycast di three su 360k triangoli costa ~100 ms, questo ~0,02 ms.
let TERR = null, TIDX = null;
function buildTerrIndex(mesh, cell){
  if (!mesh) scene.traverse(o => { if (!TERR && o.isMesh && (o.name || '').startsWith('Terrain')) TERR = o; });
  const M = mesh || TERR;
  if (!M) return null;
  const g = M.geometry, pos = g.getAttribute('position');
  M.updateMatrixWorld(true);
  const n = pos.count, P = new Float32Array(n * 3), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(M.matrixWorld); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z; }
  const idx = g.index ? g.index.array : null;
  const nt = idx ? idx.length / 3 : n / 3;
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (let i = 0; i < n; i++) { const x = P[i * 3], z = P[i * 3 + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  const C = cell || 60, nx = Math.ceil((x1 - x0) / C) + 1, nz = Math.ceil((z1 - z0) / C) + 1;
  const cells = new Array(nx * nz);
  const tri = (t, k) => idx ? idx[t * 3 + k] : t * 3 + k;
  for (let t = 0; t < nt; t++) {
    const a = tri(t, 0), b = tri(t, 1), c = tri(t, 2);
    const xa = P[a * 3], xb = P[b * 3], xc = P[c * 3], za = P[a * 3 + 2], zb = P[b * 3 + 2], zc = P[c * 3 + 2];
    const cx0 = Math.floor((Math.min(xa, xb, xc) - x0) / C), cx1 = Math.floor((Math.max(xa, xb, xc) - x0) / C);
    const cz0 = Math.floor((Math.min(za, zb, zc) - z0) / C), cz1 = Math.floor((Math.max(za, zb, zc) - z0) / C);
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      const k = cz * nx + cx;
      (cells[k] || (cells[k] = [])).push(t);
    }
  }
  return { P, tri, x0, z0, C, nx, nz, cells };
}
// quota di una mesh indicizzata in (x, z): il triangolo piu' alto che contiene il punto, o -1e4
function altezzaIdx(T, x, z){
  const cx = Math.floor((x - T.x0) / T.C), cz = Math.floor((z - T.z0) / T.C);
  if (cx < 0 || cz < 0 || cx >= T.nx || cz >= T.nz) return -1e4;
  const list = T.cells[cz * T.nx + cx];
  if (!list) return -1e4;
  const P = T.P;
  let best = -1e4;
  for (const t of list) {
    const a = T.tri(t, 0), b = T.tri(t, 1), c = T.tri(t, 2);
    const xa = P[a * 3], za = P[a * 3 + 2], xb = P[b * 3], zb = P[b * 3 + 2], xc = P[c * 3], zc = P[c * 3 + 2];
    const d = (zb - zc) * (xa - xc) + (xc - xb) * (za - zc);
    if (Math.abs(d) < 1e-9) continue;
    const l1 = ((zb - zc) * (x - xc) + (xc - xb) * (z - zc)) / d;
    const l2 = ((zc - za) * (x - xc) + (xa - xc) * (z - zc)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
    const y = l1 * P[a * 3 + 1] + l2 * P[b * 3 + 1] + l3 * P[c * 3 + 1];
    if (y > best) best = y;
  }
  return best;
}
function terraVera(x, z, yHint){
  const gg = groundAt(x, z);
  if (!TIDX) { try { TIDX = buildTerrIndex(); } catch (e) { console.warn('indice terreno:', e); } if (!TIDX) return gg; }
  const T = TIDX;
  const cx = Math.floor((x - T.x0) / T.C), cz = Math.floor((z - T.z0) / T.C);
  if (cx < 0 || cz < 0 || cx >= T.nx || cz >= T.nz) return gg;
  const list = T.cells[cz * T.nx + cx];
  if (!list) return gg;
  const P = T.P;
  let best = -1e4;
  for (const t of list) {
    const a = T.tri(t, 0), b = T.tri(t, 1), c = T.tri(t, 2);
    const xa = P[a * 3], za = P[a * 3 + 2], xb = P[b * 3], zb = P[b * 3 + 2], xc = P[c * 3], zc = P[c * 3 + 2];
    const d = (zb - zc) * (xa - xc) + (xc - xb) * (za - zc);
    if (Math.abs(d) < 1e-9) continue;
    const l1 = ((zb - zc) * (x - xc) + (xc - xb) * (z - zc)) / d;
    const l2 = ((zc - za) * (x - xc) + (xa - xc) * (z - zc)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
    const y = l1 * P[a * 3 + 1] + l2 * P[b * 3 + 1] + l3 * P[c * 3 + 1];
    if (y > best) best = y;
  }
  return best > -1e3 ? best : gg;
}
// quota del suolo per il volo: griglia lontano dal suolo, mesh vera (raycast, ogni 4 frame)
// quando si e' sotto i 120 m — la griglia sbaglia anche di 20 m e il grifone finiva sotto terra
let gyCache = { x: 0, z: 0, y: -1e4, n: 0 };
function suoloVolo(x, z, y){
  const gg = groundAt(x, z);
  if (gg < -1e3 || y - gg > 120) return gg;
  const t = terraVera(x, z, y);
  return t > -1e3 ? t : gg;
}
function impatto(){
  const f = FLY;
  f.mode = 'impatto'; f.tT = 0;
  sndBotta(); vibra([120, 60, 80]); sndWind(0, 0);
  f.tumble = [Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 8 - 4];
  f.impPos = f.pos.clone(); f.impYaw = f.yaw;
  f.v = Math.min(f.v, 9);
  const gt = terraVera(f.pos.x, f.pos.z, f.pos.y);
  if (gt > -1e3) f.pos.y = gt + 2.1;
  $('impatto').classList.add('on');
  $('stallo').classList.remove('on');
}
// si riparte dallo stesso punto, ma in alto e in planata
function ripartiDaImpatto(){
  const f = FLY;
  const gt = terraVera(f.impPos.x, f.impPos.z, f.impPos.y);
  f.pos.set(f.impPos.x, (gt > -1e3 ? gt : f.impPos.y) + 230, f.impPos.z);
  f.yaw = f.impYaw; f.pitch = FC.PITCH_GLIDE; f.roll = 0; f.v = 20; f.pitchV = 0; f.rollV = 0;
  f.stall = false; f.flap = false; f.flapPow = 0; f.vario = 0; f.fold = 0; f.tumble = null;
  f.mode = 'volo'; f.tT = 0;
  grifP.rotation.set(0, 0, 0);
  $('fade').style.opacity = 0; $('impatto').classList.remove('on');
  fwdOf(f, fwdV);
  camera.position.copy(f.pos).addScaledVector(fwdV, -34); camera.position.y += 12;
  camTgt.copy(f.pos);
}
function tickImpatto(dt){
  const f = FLY;
  f.tT += dt;
  const T = 1.7;
  // il grifone rotola sul posto e rimbalza, sempre SOPRA la mesh del terreno
  f.v = Math.max(0, f.v - 20 * dt);
  fwdV.set(Math.sin(f.yaw), 0, Math.cos(f.yaw));
  f.pos.addScaledVector(fwdV, f.v * dt);
  const gt = terraVera(f.pos.x, f.pos.z, f.pos.y);
  const hop = 5 * Math.abs(Math.sin(f.tT * 7)) * Math.exp(-2.2 * f.tT);
  if (gt > -1e3) f.pos.y = gt + 2.1 + hop;
  grifP.rotation.x += f.tumble[0] * dt; grifP.rotation.y += f.tumble[1] * dt; grifP.rotation.z += f.tumble[2] * dt;
  grifP.position.copy(f.pos);
  posaGrifone(Math.sin(performance.now() / 60) * 0.9, 0, 0.5, 0, 0, 0.3);
  // camera alta e arretrata, cosi' il grifone resta in vista anche su un pendio
  tmpB.set(f.pos.x - fwdV.x * 22, f.pos.y + 14, f.pos.z - fwdV.z * 22);
  const cg = terraVera(tmpB.x, tmpB.z, tmpB.y);
  if (cg > -1e3 && tmpB.y < cg + 8) tmpB.y = cg + 8;
  camera.position.lerp(tmpB, 1 - Math.exp(-5 * dt));
  camTgt.lerp(f.pos, 1 - Math.exp(-6 * dt)); camera.up.set(0, 1, 0); camera.lookAt(camTgt);
  $('fade').style.opacity = clamp((f.tT - 0.6) / 0.8, 0, 1);
  if (f.tT > T) ripartiDaImpatto();
}
let hudFlyT = 0;
function updateHUDFly(){
  const f = FLY;
  hudFlyT += 1;
  if (hudFlyT % 6) { drawMiniPos(); return; }
  const kmh = Math.round(f.v * 3.6);
  $('v-km').textContent = kmh;
  $('v-q').innerHTML = Math.round(route.elev_a * f.pos.y + route.elev_b) + '<span class="unit"> m</span>';
  const vr = (route.elev_a * f.vario);
  $('v-p').innerHTML = (vr > 0 ? '+' : '') + vr.toFixed(1).replace('.', ',') + '<span class="unit"> m/s</span>';
  // vetta più vicina (in pianta) entro 1,5 km, altrimenti quota del suolo
  let best = 1e9, bp = null;
  for (const p of route.peaks) {
    const d = Math.hypot(p.x - f.pos.x, -p.y - f.pos.z);
    if (d < best) { best = d; bp = p; }
  }
  if (bp && best < 1500) {
    $('zona-n').textContent = bp.n;
    $('zona-s').textContent = Math.round(best) + ' m in pianta · vetta ' + bp.e + ' m';
  } else {
    $('zona-n').textContent = f.fold > 0.6 ? 'A proiettile · ali chiuse' : nomeVolo();
    let asc = '';
    if (ASC.termica > 0.8 && ASC.termica >= ASC.sole) asc = ' · termica';
    else if (ASC.pendio > 0.8) asc = ' · ascendenza di pendio';
    else if (ASC.sole > 0.8) asc = ' · versante al sole';
    else if (ASC.turb > 0.3) asc = ' · turbolenza sottovento';
    $('zona-s').textContent = 'suolo a ' + Math.round(route.elev_a * f.agl) + ' m sotto di te' + asc;
  }
  // punti di interesse: planandoci sopra compare il banner (tocco = scheda); i segnaposto
  // si vedono pieni da lontano e si attenuano quando ci si e' sopra
  let np = -1, nd = 150;
  route.pois.forEach((p, i) => {
    if (p.tipo === 'start') return;
    posAt(p.km * 1000, tmpA);
    const d = Math.hypot(tmpA.x - f.pos.x, tmpA.z - f.pos.z);
    if (d < nd && f.agl < 260) { nd = d; np = i; }
  });
  if (np !== st.curPoi) {
    st.curPoi = np;
    const b = $('poi-banner');
    if (np >= 0) { $('poi-n').textContent = route.pois[np].nome; $('poi-s').textContent = route.pois[np].sub;
      b.classList.add('on'); b.onclick = () => openPoi(route.pois[np]); }
    else b.classList.remove('on');
  }
  if (pinGroup) for (const sp of pinGroup.children) {
    const d = sp.position.distanceTo(f.pos);
    sp.material.opacity = 0.25 + 0.75 * clamp((d - 30) / 60, 0, 1);
    sp.material.transparent = true;
  }
  const vb = $('vario');
  if (vb) {
    const i = vb.firstElementChild, h = clamp(vr / 6, -1, 1) * 50;
    i.style.top = (h > 0 ? 50 - h : 50) + '%'; i.style.height = Math.abs(h) + '%';
    i.style.background = vr > 0.3 ? '#f4951f' : (vr < -3 ? '#c8102e' : '#8d99a6');
  }
  drawMiniPos();
}
function bindFlyUI(){
  const bsp = $('b-specie'); if (bsp) { bsp.onclick = () => cambiaSpecie(); bsp.textContent = (SPECIE[FLY.specie] || SPECIE.grifone).breve + ' ▸'; }
  // joystick virtuale
  const joy = $('joy'), knob = $('joy-k');
  let jid = null;
  const R = () => joy.clientWidth / 2;
  const set = e => {
    const r = joy.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const m = Math.hypot(dx, dy), rm = R() - 24;
    if (m > rm) { dx *= rm / m; dy *= rm / m; }
    knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    // zona morta al centro, curva morbida
    const cv = v => { const a = Math.abs(v); return a < 0.1 ? 0 : Math.sign(v) * Math.pow((a - 0.1) / 0.9, 1.4); };
    FLY.joyIn = [cv(dx / rm), cv(-dy / rm)];
  };
  joy.addEventListener('pointerdown', e => { jid = e.pointerId; joy.setPointerCapture(jid); set(e); e.preventDefault(); });
  joy.addEventListener('pointermove', e => { if (e.pointerId === jid) set(e); });
  const rel = e => { if (e.pointerId !== jid) return; jid = null; FLY.joyIn = [0, 0]; knob.style.transform = ''; };
  joy.addEventListener('pointerup', rel); joy.addEventListener('pointercancel', rel);
  // pulsante battito
  const bf = $('b-flap');
  const on = e => { e.preventDefault(); FLY.flap = true; bf.classList.add('on'); };
  const off = () => { FLY.flap = false; bf.classList.remove('on'); };
  bf.addEventListener('pointerdown', on);
  bf.addEventListener('pointerup', off); bf.addEventListener('pointercancel', off); bf.addEventListener('pointerleave', off);
  // inclinazione del telefono
  $('b-tilt').onclick = () => { if (FLY.tilt) tiltOff(); else tiltOn(); };
  const bs = $('b-snd'); if (bs) bs.onclick = sndToggle;
  $('b-tour').onclick = () => { if (FLY.mode === 'tour') tourStop(); else tourStart(); };
}
function onTilt(e){
  if (!FLY.on || !FLY.tilt) return;
  let b = e.beta, g = e.gamma;
  if (b === null || g === null) return;
  // in orizzontale (telefono girato) gli assi si scambiano
  const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  let fb, lr;
  if (ang === 90) { fb = -g; lr = b; } else if (ang === -90 || ang === 270) { fb = g; lr = -b; } else { fb = b; lr = g; }
  if (!FLY.tiltBase) { FLY.tiltBase = [fb, lr]; return; }
  const dy = FLY.tiltBase[0] - fb, dx = lr - FLY.tiltBase[1];   // in avanti = picchiata
  const cv = v => { const a = Math.abs(v); return a < 3 ? 0 : Math.sign(v) * Math.min(1, (a - 3) / 22); };
  FLY.tiltIn = [cv(dx), cv(dy)];
}
async function tiltOn(){
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') return;
    }
  } catch (e) { return; }
  FLY.tilt = true; FLY.tiltBase = null; FLY.tiltIn = [0, 0];
  $('b-tilt').classList.add('on'); $('b-tilt').textContent = 'TIENI IL TELEFONO COSÌ';
  $('joy').style.opacity = '0.35';
  addEventListener('deviceorientation', onTilt);
  setTimeout(() => { if (FLY.tilt) $('b-tilt').textContent = 'INCLINAZIONE ATTIVA'; }, 1800);
}
function tiltOff(){
  if (!FLY.tilt) return;
  FLY.tilt = false; FLY.tiltIn = [0, 0]; FLY.tiltBase = null;
  removeEventListener('deviceorientation', onTilt);
  $('b-tilt').classList.remove('on'); $('b-tilt').textContent = 'INCLINA IL TELEFONO';
  $('joy').style.opacity = '';
}

// ---------- ciclo ----------
function tick(){
  const dtReale = clock.getDelta();
  const dt = Math.min(dtReale, 0.05);
  if (SKY) SKY.position.copy(camera.position);
  if (NUVOLE.length) tickNuvole(dt);
  if (VENTO_SH.length) { const tt = performance.now() / 1000; for (const sh of VENTO_SH) sh.uniforms.uT.value = tt; }
  tickAnimali(dt);
  if (FLY.on) {
    tickFly(dt);
    if (mixer) mixer.update(0);
    const tNow0 = performance.now() / 1000;
    for (const m of grifs) {
      const g = m.userData.g;
      const ph = g.ph0 + g.rate * tNow0;
      m.position.set(g.c[0] + g.r * Math.cos(ph), g.c[2] + Math.sin(tNow0 * 0.6 + g.ph0) * 4, -(g.c[1] + g.r * Math.sin(ph)));
      m.rotation.y = ph + Math.PI / 2 + Math.PI;
    }
    tickPeaks(dt); tickSentieri(dt); tickExtTiles(dt);
    renderer.render(scene, camera);
    guardiaFps(dtReale);
    return;
  }
  // movimento
  if (st.sTarget !== null) {
    const d = st.sTarget - st.s;
    const step = clamp(d, -VTELE * dt, VTELE * dt);
    st.s += step;
    st.speed = Math.abs(step / dt);
    if (Math.abs(d) < 2) { st.sTarget = null; st.speed = 0; }
  } else {
    if (st.dir !== 0) {
      st.hold += dt; st.lastDir = st.dir;
      const vmax = VMAX * (st.hold > 2.2 ? 1.9 : 1);
      st.speed = Math.min(vmax, st.speed + ACC * dt);
    } else { st.hold = 0; st.speed = Math.max(0, st.speed - ACC * 2.4 * dt); }
    st.s = clamp(st.s + (st.dir || st.lastDir || 1) * st.speed * dt, S0_ARCO, TOT);
  }
  // Lino
  posAt(st.s, tmpA); tanAt(st.s, tmpB);
  lino.position.copy(tmpA);
  const rotY = Math.atan2(-tmpB.z, tmpB.x);
  const pitch = Math.asin(clamp(tmpB.y, -0.75, 0.75));
  lino.quaternion.setFromEuler(new THREE.Euler(0, rotY, 0));
  lino.rotateZ(-0.10 - pitch * 0.18);
  if (mixer && LINOACT) {
    // pesi: fermo -> cammina (fino a ~30 km/h di scena) -> corre -> carica quando tiene premuto a lungo
    const v = st.speed, sprint = st.hold > 2.2 ? 1 : 0;
    const wWalk = clamp(1 - (v - 40) / 40, 0, 1), wRun = clamp((v - 40) / 40, 0, 1) * (1 - sprint), wCh = clamp((v - 40) / 40, 0, 1) * sprint;
    const k = 1 - Math.exp(-6 * dt);
    if (LINOACT.walk) LINOACT.walk.setEffectiveWeight(lerp(LINOACT.walk.getEffectiveWeight(), wWalk, k));
    if (LINOACT.run) LINOACT.run.setEffectiveWeight(lerp(LINOACT.run.getEffectiveWeight(), wRun, k));
    if (LINOACT.charge) LINOACT.charge.setEffectiveWeight(lerp(LINOACT.charge.getEffectiveWeight(), wCh, k));
    mixer.timeScale = v < 1 ? 0 : clamp(0.35 + v / 90, 0.35, 2.2);
    mixer.update(dt);
    // i bastoncini si prendono a S. Maria in Valle Porclaneta (km 8,2)
    const conPoli = st.s >= 8200;
    for (const p of LINOPOLI) if (p.visible !== conPoli) p.visible = conPoli;
  } else if (mixer) { mixer.timeScale = clamp(0.25 + st.speed / 42, 0, 2.6) * (st.speed < 1 ? 0 : 1); mixer.update(dt); }
  // camera
  tanAt(st.s + 8, tmpC);
  if (window.SRMX && window.SRMX.freeze) { /* camera bloccata per i collaudi */ }
  else if (st.view === 'fpv') {
    tmpD.copy(tmpA).addScaledVector(tmpC, 2.5); tmpD.y += 8.8;
    // NIENTE clamp suolo in prima persona: groundAt (griglia coarse) sta
    // sopra la linea del percorso fino a +22 e il vecchio clamp post-lerp
    // (suolo+13 > occhio+8.8 sul 98% del tracciato) faceva tremare la vista.
    // Raycast sulla mesh vera: 0/75 campioni sopra l'occhio -> sicuro.
    camera.position.lerp(tmpD, 1 - Math.exp(-14 * dt));
    tmpB.copy(tmpA).addScaledVector(tmpC, 90); tmpB.y += 14;
    camTgt.lerp(tmpB, 1 - Math.exp(-10 * dt));
    camera.lookAt(camTgt);
  } else {
    const qv = quotaAt(st.s);
    const kv = clamp((qv - 1500) / 750, 0, 1);
    camTgt.lerp(tmpB.copy(tmpA).add(tmpD.set(0, 10 + 22 * kv, 0)), 1 - Math.exp(-5 * dt));
    controls.target.copy(camTgt);
    if (st.view === 'follow') {
      const bnd = clamp((st.s - 15700) / 600, 0, 1) * clamp((18400 - st.s) / 600, 0, 1);
      tmpD.copy(tmpA).addScaledVector(tmpC, -(80 + 78 * kv) * (1 - 0.18 * bnd));
      tmpD.y = tmpA.y + (42 + 88 * kv) * (1 - 0.42 * bnd);
      camera.position.lerp(tmpD, 1 - Math.exp(-2.6 * dt));
    }
    controls.update();
  }
  if (st.view !== 'fpv' && !(window.SRMX && window.SRMX.freeze)) {
    const gmin = groundAt(camera.position.x, camera.position.z) + 13;
    if (camera.position.y < gmin) camera.position.y = gmin;
  }
  if (SHADOWS && sunLight) {
    sunLight.position.set(tmpA.x + SUNDIR.x * 2300, tmpA.y + SUNDIR.y * 2300, tmpA.z + SUNDIR.z * 2300);
    sunLight.target.position.copy(tmpA);
    sunLight.target.updateMatrixWorld();
  }
  // grifoni
  const tNow = performance.now() / 1000;
  for (const m of grifs) {
    const g = m.userData.g;
    const ph = g.ph0 + g.rate * tNow;
    m.position.set(g.c[0] + g.r * Math.cos(ph), g.c[2] + Math.sin(tNow * 0.6 + g.ph0) * 4, -(g.c[1] + g.r * Math.sin(ph)));
    m.rotation.y = ph + Math.PI / 2 + Math.PI;
  }
  tickPeaks(dt); tickSentieri(dt); tickExtTiles(dt);
  updateHUD();
  renderer.render(scene, camera);
  guardiaFps(dtReale);
}
// linea di vista fra due punti sopra il terreno: campiona la quota del suolo lungo il segmento
// (griglia interna + anello esterno); basta che un campione stia sopra la linea e la vista e' chiusa.
// Passo ~45 m, i primi 25 m vicino alla camera e gli ultimi 20 m vicino al bersaglio non contano
const lvA = new THREE.Vector3();
function lineaLibera(a, b){
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const L = Math.hypot(dx, dz);
  if (L < 60) return true;
  const n = Math.min(400, Math.ceil(L / 45));
  for (let i = 1; i < n; i++) {
    const t = i / n, dist = t * L;
    if (dist < 25 || L - dist < 20) continue;
    const x = a.x + dx * t, y = a.y + dy * t, z = a.z + dz * t;
    // mesh vera entro 1,5 km (la griglia sbaglia anche di 20 m e chiudeva viste aperte), griglia oltre
    const g = dist < 1500 ? terraVera(x, z, y) : groundAt(x, z);
    if (g > -1e3 && g > y + 1.5) return false;
  }
  return true;
}
function tickPeaks(dt){
  peakT += dt;
  if (peakItems.length && peakT > 0.15) {
    peakT = 0;
    for (const g of peakItems) {
      const d = camera.position.distanceTo(g.position);
      const ext = !!g.userData.peak.ext;
      g.visible = d < (ext ? 26000 : 9000);
      if (!g.visible) continue;
      // targhetta: visibile solo a campo aperto (linea di vista sul terreno libera), piena da vicino,
      // tenue da lontano; si accende/spegne con una dissolvenza per non sfarfallare
      let o = ext ? (d < 6000 ? 1 : Math.max(0.3, 1 - (d - 6000) / 22000)) : (d < 1500 ? 1 : Math.max(0.25, 1 - (d - 1500) / 7000));
      g.userData.lbl.getWorldPosition(tmpC);
      const libero = lineaLibera(camera.position, tmpC);
      const oT = libero ? o : 0;
      g.userData.vis = (g.userData.vis === undefined ? oT : g.userData.vis) + (oT - (g.userData.vis === undefined ? oT : g.userData.vis)) * 0.45;
      o = g.userData.vis;
      if (o < 0.02) { g.userData.lbl.material.opacity = 0; g.userData.asta.material.opacity = 0; g.userData.flag.material.opacity = 0; if (g.userData.punta) g.userData.punta.material.opacity = 0; continue; }
      // in volo l'asta e la bandierina sfumano quando il grifone ci arriva addosso
      let vic = 1;
      if (FLY.on) { const dg = FLY.pos.distanceTo(g.position); vic = clamp((dg - 50) / 110, 0, 1); }
      const kv = Math.min(1, o * 1.6);          // asta e bandiera seguono la visibilita' della targhetta
      g.userData.lbl.material.opacity = o * vic;
      g.userData.asta.material.opacity = 0.85 * vic * kv;
      g.userData.flag.material.opacity = 0.95 * vic * kv;
      if (g.userData.punta) g.userData.punta.material.opacity = 0.95 * vic * kv;
      const s2 = clamp(d * 0.11, 44, ext ? 520 : 190);
      const hh = s2 * 0.1875;
      g.userData.lbl.scale.set(hh * (g.userData.lbl.userData.aspect || 5.33), hh, 1);
      // (la bandiera sventola nel vertex shader)
    }
  }
}
