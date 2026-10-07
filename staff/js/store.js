// Archivio dati: Firebase (condiviso, offline-first) oppure modalità prova (solo questo dispositivo)
const FB = 'https://www.gstatic.com/firebasejs/10.14.1/';

class Emitter {
  constructor() { this.l = {}; }
  on(ev, fn) { (this.l[ev] ||= new Set()).add(fn); return () => this.l[ev].delete(fn); }
  emit(ev, ...a) { this.l[ev]?.forEach(fn => { try { fn(...a); } catch (e) { console.error(e); } }); }
}

/* ---------------- Modalità prova: localStorage ---------------- */
class StoreLocale extends Emitter {
  constructor(nome) {
    super();
    this.modo = 'prova';
    this.nome = nome;
    this.uid = localStorage.getItem('srmseg:uid') || ('loc-' + Math.random().toString(36).slice(2, 10));
    localStorage.setItem('srmseg:uid', this.uid);
    window.addEventListener('storage', e => { if (e.key?.startsWith('srmseg:dati')) this._notifica(); });
  }
  _leggi(k, d) { try { return JSON.parse(localStorage.getItem('srmseg:dati:' + k)) ?? d; } catch { return d; } }
  _scrivi(k, v) {
    try { localStorage.setItem('srmseg:dati:' + k, JSON.stringify(v)); }
    catch (e) { this.emit('errore', 'Memoria del telefono piena: foto troppo grandi per la modalità prova.'); throw e; }
  }
  _notifica() {
    const segs = Object.values(this._leggi('segnali', {}));
    this.emit('segnali', segs, { daServer: true, inAttesa: false });
    this.emit('presidi', Object.values(this._leggi('presidi', {})));
    this.emit('eventi', this._leggi('eventi', []));
  }
  async scriviPresidio(id, dati, ev) {
    const m = this._leggi('presidi', {});
    m[id] = { ...dati, id, aggiornato: Date.now(), da: this.nome };
    this._scrivi('presidi', m); if (ev) this._evento('presidio:' + id, ev); this._notifica();
  }
  async eliminaPresidio(id, ev) {
    const m = this._leggi('presidi', {}); delete m[id];
    this._scrivi('presidi', m); if (ev) this._evento('presidio:' + id, ev); this._notifica();
  }
  async avvia() {
    this.emit('stato', { online: true, inAttesa: false, modo: 'prova' });
    setTimeout(() => this._notifica(), 0);
    return this;
  }
  _evento(id, ev) {
    const lista = this._leggi('eventi', []);
    lista.unshift({ ...ev, segnale: id, chi: this.nome, uid: this.uid, t: Date.now() });
    this._scrivi('eventi', lista.slice(0, 400));
  }
  async inizializza(lista) {
    const m = {}; lista.forEach(s => m[s.id] = { ...s, aggiornato: Date.now(), da: this.nome });
    this._scrivi('segnali', m); this._evento('*', { azione: 'piano_caricato', note: `${lista.length} paletti` });
    this._notifica();
  }
  async salva(id, patch, ev) {
    const m = this._leggi('segnali', {});
    if (!m[id]) return;
    m[id] = { ...m[id], ...patch, aggiornato: Date.now(), da: this.nome };
    this._scrivi('segnali', m); if (ev) this._evento(id, ev); this._notifica();
  }
  async salvaMolti(lista, ev) {
    const m = this._leggi('segnali', {});
    lista.forEach(({ id, patch }) => { if (m[id]) m[id] = { ...m[id], ...patch, aggiornato: Date.now(), da: this.nome }; });
    this._scrivi('segnali', m); if (ev) this._evento('*', ev); this._notifica();
  }
  async crea(seg, ev) {
    const m = this._leggi('segnali', {});
    m[seg.id] = { ...seg, aggiornato: Date.now(), da: this.nome };
    this._scrivi('segnali', m); this._evento(seg.id, ev); this._notifica();
  }
  async elimina(id, ev) {
    const m = this._leggi('segnali', {}); delete m[id];
    this._scrivi('segnali', m); this._evento(id, ev); this._notifica();
  }
  async posizione() { /* in prova la posizione resta solo su questo telefono */ }
  async azzera() { localStorage.removeItem('srmseg:dati:segnali'); localStorage.removeItem('srmseg:dati:eventi'); this._notifica(); }
}

/* ---------------- Firebase / Firestore ---------------- */
class StoreFirebase extends Emitter {
  constructor(config, squadra, nome) {
    super();
    this.modo = 'firebase';
    this.config = config; this.squadra = squadra; this.nome = nome;
  }
  async avvia() {
    const [{ initializeApp }, auth, fs] = await Promise.all([
      import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')]);
    this.fs = fs;
    const app = initializeApp(this.config);
    let db;
    try {
      db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
    } catch { db = fs.getFirestore(app); }
    this.db = db;
    const a = auth.getAuth(app);
    await new Promise((ok, ko) => {
      const stop = auth.onAuthStateChanged(a, u => { if (u) { this.uid = u.uid; stop(); ok(); } });
      auth.signInAnonymously(a).catch(e => { stop(); ko(e); });
    });
    const base = ['squadre', this.squadra];
    this.col = n => fs.collection(db, ...base, n);
    this.ref = (n, id) => fs.doc(db, ...base, n, id);

    fs.onSnapshot(this.col('segnali'), { includeMetadataChanges: true }, snap => {
      const segs = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      const meta = { daServer: !snap.metadata.fromCache, inAttesa: snap.metadata.hasPendingWrites };
      this.emit('segnali', segs, meta);
      this.emit('stato', { online: !snap.metadata.fromCache, inAttesa: snap.metadata.hasPendingWrites, modo: 'firebase' });
    }, err => this.emit('errore', messaggioErrore(err)));

    fs.onSnapshot(fs.query(this.col('eventi'), fs.orderBy('tl', 'desc'), fs.limit(300)), snap => {
      this.emit('eventi', snap.docs.map(d => ({ ...d.data(), id: d.id })));
    }, err => this.emit('errore', messaggioErrore(err)));

    fs.onSnapshot(this.col('presidi'), snap => {
      this.emit('presidi', snap.docs.map(d => ({ ...d.data(), id: d.id })));
    }, err => { console.warn('Presidi non leggibili', err); this.emit('presidi', [], { errore: err?.code || true }); });

    fs.onSnapshot(this.col('volontari'), snap => {
      this.emit('volontari', snap.docs.map(d => ({ ...d.data(), uid: d.id })));
    }, () => {});

    window.addEventListener('online', () => this.emit('stato', { online: true, inAttesa: false, modo: 'firebase' }));
    window.addEventListener('offline', () => this.emit('stato', { online: false, inAttesa: true, modo: 'firebase' }));
    return this;
  }
  _ev(id, ev) {
    const { fs } = this;
    return fs.addDoc(this.col('eventi'), { ...pulisci(ev), segnale: id, chi: this.nome, uid: this.uid, t: fs.serverTimestamp(), tl: Date.now() });
  }
  async inizializza(lista) {
    const { fs } = this; const b = fs.writeBatch(this.db);
    lista.forEach(s => b.set(this.ref('segnali', s.id), { ...pulisci(s), aggiornato: fs.serverTimestamp(), da: this.nome }));
    await b.commit(); await this._ev('*', { azione: 'piano_caricato', note: `${lista.length} paletti` });
  }
  async salva(id, patch, ev) {
    const { fs } = this;
    const p = fs.updateDoc(this.ref('segnali', id), { ...pulisci(patch), aggiornato: fs.serverTimestamp(), da: this.nome });
    const e = ev ? this._ev(id, ev) : null;
    // con la rete assente le promesse restano in attesa: non blocchiamo l'interfaccia
    attendiBreve(p); if (e) attendiBreve(e);
  }
  async salvaMolti(lista, ev) {
    const { fs } = this; const b = fs.writeBatch(this.db);
    lista.forEach(({ id, patch }) => b.update(this.ref('segnali', id), { ...pulisci(patch), aggiornato: fs.serverTimestamp(), da: this.nome }));
    attendiBreve(b.commit()); if (ev) attendiBreve(this._ev('*', ev));
  }
  async crea(seg, ev) {
    const { fs } = this;
    attendiBreve(fs.setDoc(this.ref('segnali', seg.id), { ...pulisci(seg), aggiornato: fs.serverTimestamp(), da: this.nome }));
    attendiBreve(this._ev(seg.id, ev));
  }
  async elimina(id, ev) {
    const { fs } = this;
    attendiBreve(fs.deleteDoc(this.ref('segnali', id))); attendiBreve(this._ev(id, ev));
  }
  async scriviPresidio(id, dati, ev) {
    const { fs } = this;
    attendiBreve(fs.setDoc(this.ref('presidi', id), { ...pulisci(dati), aggiornato: fs.serverTimestamp(), da: this.nome }));
    if (ev) attendiBreve(this._ev('presidio:' + id, ev));
  }
  async eliminaPresidio(id, ev) {
    const { fs } = this;
    attendiBreve(fs.deleteDoc(this.ref('presidi', id)));
    if (ev) attendiBreve(this._ev('presidio:' + id, ev));
  }
  async posizione(pos) {
    const { fs } = this; const r = this.ref('volontari', this.uid);
    if (!pos) { attendiBreve(fs.deleteDoc(r)); return; }
    attendiBreve(fs.setDoc(r, { nome: this.nome, lat: pos.lat, lon: pos.lon, acc: Math.round(pos.acc || 0), t: fs.serverTimestamp(), tl: Date.now() }));
  }
}

function pulisci(o) {
  const r = {};
  for (const [k, v] of Object.entries(o || {})) if (v !== undefined) r[k] = v;
  return r;
}
function attendiBreve(p) { p?.catch?.(e => console.warn('Scrittura non riuscita', e)); }
function messaggioErrore(err) {
  if (err?.code === 'permission-denied') return 'Accesso negato: controlla il codice squadra e le regole di Firestore.';
  return 'Errore di sincronizzazione: ' + (err?.message || err);
}

// Restituisce l'archivio non ancora avviato: registrare i listener, poi chiamare avvia()
export function creaStore({ config, squadra, nome }) {
  if (config && config.apiKey && squadra) return new StoreFirebase(config, squadra, nome);
  return new StoreLocale(nome);
}
