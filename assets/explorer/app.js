// SRM Explorer — Skyrace del Maglio 2026
// Percorso 3D navigabile. Dati: export Blender del progetto reel (route.json, scene.glb, lino.glb)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const VER = 'v59';
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
  await Promise.all([loadOrtho(), loadHeights()]);
  prog(0.12);
  buildStage();
  const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  $('load-step').textContent = 'montagne, sentiero, paesi…';
  const world = await loadGLB(loader, 'assets/scene.glb?' + VER, p => prog(0.06 + 0.58 * p));
  prepWorld(world.scene);
  scene.add(world.scene);
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
      // suolo VERO campionato lungo tutto il tratto estrapolato (arco -> km 0)
      try {
        const bers = [];
        scene.traverse(o => { if (o.isMesh && (o.name === 'Terrain' || /^Piazza/.test(o.name || ''))) bers.push(o); });
        const ye = [];
        for (let k = 0; k <= 15; k++) {
          posAt(S0_ARCO + k, tmpA);
          const rc0 = new THREE.Raycaster(new THREE.Vector3(tmpA.x, 400, tmpA.z),
                                          new THREE.Vector3(0, -1, 0), 0, 900);
          const h0 = rc0.intersectObjects(bers, false)[0];
          ye.push(h0 ? h0.point.y + 0.05 : null);
        }
        for (let k = 0; k <= 15; k++) if (ye[k] === null) ye[k] = k > 0 ? ye[k - 1] : route.z[0];
        YEXT = ye;
        Y0_ARCO = ye[0];
      } catch (e) { console.warn('quota arco:', e); }
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
  }, undefined, () => console.warn('extras assente'));
  loader.load('assets/borghi.glb?' + VER, g => {
    g.scene.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        if (o.material && o.material.isMeshStandardMaterial) { o.material.metalness = 0; o.material.roughness = 0.95; }
      }
    });
    scene.add(g.scene);
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
  }, undefined, () => console.warn('maglianoC assente'));
  $('load-step').textContent = 'Lino…';
  const lg = await loadGLB(loader, 'assets/lino.glb?' + VER, p => prog(0.66 + 0.28 * p));
  prepLino(lg);
  buildPins();
  try { buildDataSassi(); } catch (e) { console.warn('sassi:', e); }
  try { buildNubiBasse(); } catch (e) { console.warn('nubi:', e); }
  try { await document.fonts.load('400 72px Anton'); } catch (e) {}
  buildPeaks();
  buildProfile(); buildMinimap(); bindUI();
  const h = location.hash.match(/km=([\d.]+)/);
  if (h) st.s = clamp(parseFloat(h[1]) * 1000, 0, TOT);
  else st.s = S0_ARCO;
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
  window.SRMX = { st, scene: () => scene, route: () => route, vista: setView, terra: groundAt,
                  y0arco: () => Y0_ARCO, pos: s => { posAt(s, tmpC); return [tmpC.x, tmpC.y, tmpC.z]; }, goto: km => { st.sTarget = clamp(km, 0, route.total_km) * 1000; },
                  poi: i => openPoi(route.pois[i]), gara: showGara, segui: v => setFollow(v, false),
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
  sunLight = new THREE.DirectionalLight(0xfff3e0, 2.4);
  sunLight.position.set(-1200, 1450, -1350);
  const fill = new THREE.DirectionalLight(0xffe7c8, 0.32);
  fill.position.set(5600, 4000, 4800);
  scene.add(hemi, sunLight, sunLight.target, fill);
  SHADOWS = !/Android|iPhone|iPad|Mobi/i.test(navigator.userAgent);
  if (SHADOWS) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    const sk = sunLight.shadow.camera;
    sk.left = -430; sk.right = 430; sk.top = 430; sk.bottom = -430;
    sk.near = 150; sk.far = 4500;
    sunLight.shadow.bias = -0.00055;
  }
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
      o.material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 });
    } else if (o.material && o.material.isMeshStandardMaterial) {
      o.material.metalness = 0; o.material.roughness = 0.9;
    }
    if (nm.startsWith('Grif_Meshy')) grifTpl = o;
    if (nm === 'Sevice_Meshy') window._hutS = o;
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

function prepLino(lg){
  lino = new THREE.Group();
  lg.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  lino.add(lg.scene);
  scene.add(lino);
  if (lg.animations && lg.animations.length) {
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
const S0_ARCO = -15.0;   // partenza sotto l'arco: 15 m prima del km 0 lungo la tangente iniziale
let Y0_ARCO = null;      // quota del suolo vero sotto l'arco (raycast al caricamento)
let YEXT = null;         // suolo campionato ogni metro da s=-15 a s=0
function posAt(s, out){
  if (s < 0) {
    const dx = route.x[2] - route.x[0], dy = route.y[2] - route.y[0];
    const L = Math.hypot(dx, dy) || 1;
    let y;
    if (YEXT) {
      const f0 = clamp(s + 15, 0, 15);
      const k0 = Math.min(14, Math.floor(f0));
      const yg = YEXT[k0] + (YEXT[k0 + 1] - YEXT[k0]) * (f0 - k0);
      const t0 = clamp(1 + s / 3.0, 0, 1);      // raccordo al nastro solo negli ultimi 3 m
      y = yg * (1 - t0) + route.z[0] * t0;
    } else {
      const t0 = clamp(1 + s / 15.0, 0, 1);
      const yA = (typeof Y0_ARCO === 'number') ? Y0_ARCO : route.z[0];
      y = yA * (1 - t0) + route.z[0] * t0;
    }
    return out.set(route.x[0] + dx / L * s, y, -(route.y[0] + dy / L * s));
  }
  const f = clamp(s, 0, TOT) / TOT * (N - 1);
  const i = Math.min(Math.floor(f), N - 2), t = f - i;
  return out.set(lerp(route.x[i], route.x[i + 1], t),
                 lerp(route.z[i], route.z[i + 1], t),
                -lerp(route.y[i], route.y[i + 1], t));
}
function quotaAt(s){
  const f = clamp(s, 0, TOT) / TOT * (N - 1);
  const i = Math.min(Math.floor(f), N - 2), t = f - i;
  if (route.elev) return lerp(route.elev[i], route.elev[i + 1], t);   // profilo GPX reale
  return route.elev_a * lerp(route.z[i], route.z[i + 1], t) + route.elev_b;
}
function tanAt(s, out){
  posAt(Math.min(s + 22, TOT), out); posAt(Math.max(s - 22, 0), tmpD);
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
    if (p.tipo === 'start') continue;
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
    const hit = ray.intersectObjects(pinGroup.children, false)[0];
    if (hit) openPoi(hit.object.userData.poi);
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
  $('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  const key = (e, down) => {
    const k = e.key;
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
function openPoi(p){
  openCard('<h2>' + p.nome + '</h2><h3>km ' + p.km.toFixed(1).replace('.', ',') + ' · ' + p.sub + '</h3><p>' + p.card + '</p>');
}
function showHelp(){
  openCard('<h2>Come si esplora</h2><h3>SRM Explorer</h3><ul>' +
    '<li><b>▶ / ◀</b> (o frecce della tastiera): Lino avanza e torna indietro lungo il percorso; tieni premuto per correre.</li>' +
    '<li><b>Trascina</b> con un dito o col mouse per girare intorno a Lino; <b>pizzica</b> o rotella per lo zoom.</li>' +
    '<li><b>SEGUI LINO</b> riaggancia la telecamera dietro di lui.</li>' +
    '<li>Il <b>profilo altimetrico</b> in basso è cliccabile: tocca un punto e Lino si posizioner\u00e0 su di esso.</li>' +
    '<li>Tocca i <b>segnaposto</b> lungo il percorso per le schede dei punti di interesse.</li>' +
    '<li>La barra in alto dice sempre <b>dove sei</b>: zona, km, quota e numero del sentiero.</li></ul>');
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
    matT.onBeforeCompile = sh => {
      sh.uniforms.uDet = { value: detailTex() };
      sh.uniforms.uTinta = { value: tintaTex() };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vDetXZ;\nvarying vec2 vUvO;\nvarying float vNy;\nvarying float vWy;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDetXZ = (modelMatrix * vec4(position, 1.0)).xz;\nvUvO = uv;\nvNy = normalize(mat3(modelMatrix) * normal).y;\nvWy = (modelMatrix * vec4(position, 1.0)).y;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uDet;\nuniform sampler2D uTinta;\nvarying vec2 vDetXZ;\nvarying vec2 vUvO;\nvarying float vNy;\nvarying float vWy;')
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  // C: roccia procedurale sulle pareti ripide (la foto stirata sparisce)
  float ripida = smoothstep(0.86, 0.62, abs(vNy));
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
  vec3 gGr = vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)));
  diffuseColor.rgb = clamp((mix(gGr, diffuseColor.rgb, 1.30) - 0.5) * 1.07 + 0.5, 0.0, 1.0);
}`);
    };
    mesh.material = matT;
  } else {
    mesh.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  }
}


// ---------- ortofoto, griglia altezze, brecciato ----------
let ORTHO = null, HG = null, sunLight = null, SHADOWS = false;
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
function groundAt(x, z){
  if (!HG) return -1e4;
  const xb = x, yb = -z;
  const u = (xb - HG.x0) / (HG.x1 - HG.x0) * (HG.nx - 1);
  const v = (yb - HG.y0) / (HG.y1 - HG.y0) * (HG.ny - 1);
  if (u < 0 || v < 0 || u > HG.nx - 1.001 || v > HG.ny - 1.001) return -1e4;
  const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
  const gg = (jj, ii) => HG.data[Math.min(jj, HG.ny - 1) * HG.nx + Math.min(ii, HG.nx - 1)] * HG.scala;
  return gg(j, i) * (1 - fu) * (1 - fv) + gg(j, i + 1) * fu * (1 - fv) +
         gg(j + 1, i) * (1 - fu) * fv + gg(j + 1, i + 1) * fu * fv;
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
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
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
  const astaGeo = new THREE.CylinderGeometry(0.45, 0.75, 54, 6);
  const astaMat = new THREE.MeshBasicMaterial({ color: 0xf3efe2, transparent: true, opacity: 0.5 });
  const sh = new THREE.Shape();
  sh.moveTo(0, 0); sh.lineTo(17, -4.5); sh.lineTo(0, -9); sh.lineTo(0, 0);
  const flagGeo = new THREE.ShapeGeometry(sh);
  for (const p of route.peaks) {
    const g = new THREE.Group();
    g.position.set(p.x, p.z, -p.y);
    const asta = new THREE.Mesh(astaGeo, astaMat);
    asta.position.y = 27;
    const flag = new THREE.Mesh(flagGeo,
      new THREE.MeshBasicMaterial({ color: 0xf4951f, transparent: true, opacity: 0.62, side: THREE.DoubleSide }));
    flag.position.y = 52.5;
    const pl = peakLabel(p.n, p.e);
    const lbl = new THREE.Sprite(new THREE.SpriteMaterial({
      map: pl.tex, transparent: true, depthTest: false }));
    lbl.position.y = 70;
    lbl.userData.aspect = pl.aspect;
    lbl.scale.set(20.6 * pl.aspect, 20.6, 1);
    g.add(asta, flag, lbl);
    g.userData = { lbl, flag };
    grp.add(g); peakItems.push(g);
  }
  scene.add(grp);
  console.log('vette:', route.peaks.map(p => p.n).join(' | '));
}

// ---------- vegetazione e sassi istanziati ----------
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
    const im = new THREE.InstancedMesh(proto.geometry, proto.material, arr.length);
    for (let i = 0; i < arr.length; i++) {
      const t = arr[i];
      P.set(t[0], t[2], -t[1]);
      Q.setFromEuler(E.set(0, t[3], 0));
      S.setScalar(t[4] || 1);
      M.compose(P, Q, S);
      im.setMatrixAt(i, M);
    }
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    im.castShadow = true;
    scene.add(im);
  }
  console.log('vegetazione:', Object.keys(veg.inst).map(k => k + ':' + veg.inst[k].length).join(', '));
}

// ---------- ciclo ----------
let fpsAcc = 0, fpsN = 0, fpsT = 0, degraded = false;
function tick(){
  const dt = Math.min(clock.getDelta(), 0.05);
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
  if (mixer) { mixer.timeScale = clamp(0.25 + st.speed / 42, 0, 2.6) * (st.speed < 1 ? 0 : 1); mixer.update(dt); }
  // camera
  tanAt(st.s + 8, tmpC);
  if (st.view === 'fpv') {
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
  if (st.view !== 'fpv') {
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
  peakT += dt;
  if (peakItems.length && peakT > 0.15) {
    peakT = 0;
    for (const g of peakItems) {
      const d = camera.position.distanceTo(g.position);
      g.visible = d < 7500;
      if (!g.visible) continue;
      const o = d < 1400 ? 1 : Math.max(0, 1 - (d - 1400) / 3000);
      g.userData.lbl.material.opacity = o;
      const s2 = clamp(d * 0.11, 44, 190);
      const hh = s2 * 0.1875;
      g.userData.lbl.scale.set(hh * (g.userData.lbl.userData.aspect || 5.33), hh, 1);
      g.userData.flag.rotation.y = Math.sin(performance.now() / 1400 + g.position.x) * 0.7;
    }
  }
  updateHUD();
  renderer.render(scene, camera);
  // guardia prestazioni
  fpsAcc += dt; fpsN++; fpsT += dt;
  if (fpsT > 4 && !degraded) {
    if (fpsN / fpsT < 26) { degraded = true; renderer.setPixelRatio(1); scene.fog.far = 12000; }
    fpsN = 0; fpsT = 0;
  }
}
