/**
 * Skyrace del Maglio – foto del sito www.skyracedelmaglio.it/foto/  (versione 2: album + ricerca pettorali)
 *
 * Gira sull'account usasportingclub@gmail.com, progetto "SRM elenco foto" su script.google.com,
 * pubblicato come App web (Esegui come: Io · Chi ha accesso: Chiunque).
 *
 * COSA FA
 *  - doGet(): restituisce al sito l'elenco degli album e delle foto, con i pettorali riconosciuti.
 *      Album = sottocartelle della cartella principale (il nome della sottocartella è il titolo, es. "Mario Rossi – Villaggio gara").
 *      Le foto messe direttamente nella cartella principale formano l'album ALBUM_RADICE.
 *  - indicizza(): ogni 10 minuti analizza le foto nuove e scrive pettorali e parole chiave nel foglio
 *      "SRM 2026 – Indice foto" (nel Drive del club, NON nella cartella pubblica). Tutto gratuito:
 *        • MOTORE 'gemini': Gemini con chiave gratuita di Google AI Studio (legge i pettorali e descrive la scena).
 *        • MOTORE 'drive' : riconoscimento del testo di Google Drive (nessuna chiave, solo numeri, meno preciso).
 *      Se manca la chiave Gemini si usa automaticamente 'drive'.
 *  - Correzioni a mano: nel foglio, colonna "Pettorali (correzione)": scrivi i numeri giusti separati da spazio,
 *      oppure "-" per dire "nessun pettorale". Ha sempre la precedenza su quanto letto in automatico.
 *      Per far rianalizzare una foto basta cancellarne la riga.
 *
 * PRIMA INSTALLAZIONE (una volta sola)
 *  1. (facoltativo ma consigliato) chiave gratuita: aistudio.google.com → Get API key → Create API key,
 *     senza attivare la fatturazione. Poi qui: Impostazioni progetto (ingranaggio) → Proprietà script →
 *     Aggiungi proprietà: GEMINI_API_KEY = la chiave.
 *  2. Servizi (+) → aggiungi "Drive API" (serve al motore 'drive').
 *  3. Scegli la funzione "installa" in alto e premi Esegui, poi autorizza.
 *  4. Esegui il deployment → Gestisci deployment → matita → Versione: Nuova versione → Esegui il deployment
 *     (l'indirizzo /exec resta lo stesso).
 */
const CARTELLA = '15sBXYdjHx9cdD2rDZEUbTbIL-svRGFe9';
const ALBUM_RADICE = 'Michele Stoduto – Gara';
const MOTORE = 'gemini';                    // 'gemini' oppure 'drive'
const MODELLO = 'gemini-3.5-flash-lite';    // modello gratuito con limiti giornalieri più ampi; si può cambiare
const PAUSA_MS = 6500;                      // pausa tra due foto per restare nei limiti gratuiti al minuto
const PETTORALE_MAX = 200;
const NOME_FOGLIO = 'SRM 2026 – Indice foto';
const MINUTI_CACHE = 5;

const PROMPT = [
  'Sei l\'archivista delle foto della Skyrace del Maglio, gara di corsa in montagna. Rispondi solo in JSON.',
  'pettorali: i numeri di gara stampati sui pettorali degli atleti che si leggono con certezza (numeri da 1 a ' + PETTORALE_MAX + ').',
  'Non indovinare: se un numero è coperto, tagliato o incerto non inserirlo. Non inserire altri numeri (orari, cartelli, scritte su magliette o marchi).',
  'parole: da 3 a 10 parole chiave in italiano, minuscole, su ciò che si vede (es. partenza, arrivo, salita, discesa, cresta, bosco, roccia, prato, nebbia, sole, bandiera, cane, bambino, abbraccio, ristoro, bastoncini, gruppo, donna, uomo, medaglia, premiazione, panorama, volontari, colori delle maglie).',
  'descrizione: una frase breve in italiano sulla scena, senza nomi di persone.'
].join('\n');

/* ---------------- elenco per il sito ---------------- */
function doGet() {
  const json = leggiCache_() || costruisciElenco_();
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function costruisciElenco_() {
  const indice = leggiIndice_();
  const album = [], foto = [];
  cartelle_().forEach(function (c) {
    const lista = immagini_(c.cartella);
    if (!lista.length) return;
    const ai = album.length;
    album.push({ nome: c.nome, n: lista.length, cover: lista[0].id });
    lista.forEach(function (x) {
      const o = { n: x.n, id: x.id, a: ai }, ix = indice[x.id];
      if (ix) { o.i = 1; if (ix.p.length) o.p = ix.p; if (ix.t) o.t = ix.t; }
      foto.push(o);
    });
  });
  const json = JSON.stringify({ aggiornato: new Date().toISOString(), album: album, foto: foto });
  scriviCache_(json);
  return json;
}

function cartelle_() {
  const radice = DriveApp.getFolderById(CARTELLA);
  const out = [{ nome: ALBUM_RADICE, cartella: radice }], sub = [];
  const it = radice.getFolders();
  while (it.hasNext()) sub.push(it.next());
  sub.sort(function (a, b) { return a.getName().localeCompare(b.getName(), 'it', { numeric: true }); });
  sub.forEach(function (c) { out.push({ nome: c.getName(), cartella: c }); });
  return out;
}

function immagini_(cartella) {
  const visti = {}, lista = [];
  const it = cartella.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed() || f.getMimeType().indexOf('image/') !== 0) continue;
    const n = f.getName().replace(/\.[^.]+$/, '').replace(/\s*\(\d+\)$/, '').replace(/^srm__/, '');
    if (visti[n]) continue;              // stessa foto caricata due volte
    visti[n] = true;
    lista.push({ n: n, id: f.getId(), file: f });
  }
  lista.sort(function (a, b) { return a.n.localeCompare(b.n, 'it', { numeric: true }); });
  return lista;
}

/* ---------------- cache (a pezzi: max 100 KB per voce) ---------------- */
function scriviCache_(json) {
  const c = CacheService.getScriptCache(), o = {}, passo = 45000;
  let k = 0;
  for (let i = 0; i < json.length; i += passo) o['elenco_' + (k++)] = json.slice(i, i + passo);
  o.elenco_n = String(k);
  c.putAll(o, MINUTI_CACHE * 60);
}
function leggiCache_() {
  const c = CacheService.getScriptCache(), n = +c.get('elenco_n');
  if (!n) return null;
  const chiavi = [];
  for (let i = 0; i < n; i++) chiavi.push('elenco_' + i);
  const v = c.getAll(chiavi);
  let s = '';
  for (let i = 0; i < n; i++) { if (v[chiavi[i]] == null) return null; s += v[chiavi[i]]; }
  return s;
}
function svuotaCache_() { CacheService.getScriptCache().remove('elenco_n'); }

/* ---------------- indice nel foglio ---------------- */
function foglio_() {
  const props = PropertiesService.getScriptProperties();
  let ss = null;
  const id = props.getProperty('FOGLIO_ID');
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create(NOME_FOGLIO);           // resta nel "Il mio Drive", non nella cartella pubblica
    props.setProperty('FOGLIO_ID', ss.getId());
    const sh = ss.getSheets()[0];
    sh.setName('Indice');
    sh.appendRow(['ID file', 'Album', 'Foto', 'Pettorali letti', 'Pettorali (correzione)', 'Parole chiave', 'Descrizione', 'Analizzata il', 'Motore / esito']);
    sh.setFrozenRows(1);
    sh.getRange('E:E').setBackground('#fff6e5');
  }
  return ss.getSheetByName('Indice');
}
function numeri_(s) {
  return String(s).split(/[^0-9]+/).filter(Boolean).map(Number)
    .filter(function (x, i, a) { return x >= 1 && x <= PETTORALE_MAX && a.indexOf(x) === i; });
}
function leggiIndice_() {
  const v = foglio_().getDataRange().getValues(), r = {};
  for (let i = 1; i < v.length; i++) {
    const id = String(v[i][0]).trim();
    if (!id) continue;
    const man = String(v[i][4]).trim();
    const p = man === '-' ? [] : numeri_(man !== '' ? man : v[i][3]);
    r[id] = { p: p, t: String(v[i][5] || '').trim() };
  }
  return r;
}

/* ---------------- riconoscimento automatico ---------------- */
function indicizza() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const inizio = Date.now(), sh = foglio_(), fatti = leggiIndice_();
    const chiave = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    const motore = (MOTORE === 'gemini' && chiave) ? 'gemini' : 'drive';
    let nuove = 0;
    for (const c of cartelle_()) {
      for (const x of immagini_(c.cartella)) {
        if (fatti[x.id]) continue;
        if (Date.now() - inizio > 4.5 * 60 * 1000) { if (nuove) svuotaCache_(); return; }
        let r;
        try { r = motore === 'gemini' ? conGemini_(x, chiave) : conDrive_(x); }
        catch (err) { r = { pettorali: [], parole: [], descrizione: '', esito: 'errore: ' + String(err).slice(0, 150) }; }
        if (r.riprova) { if (nuove) svuotaCache_(); return; }   // limite gratuito raggiunto: si riprende al prossimo giro
        sh.appendRow([x.id, c.nome, x.file.getName(), r.pettorali.join(' '), '', r.parole.join(', '), r.descrizione, new Date(), r.esito || motore]);
        fatti[x.id] = true; nuove++;
        if (motore === 'gemini') Utilities.sleep(PAUSA_MS);
      }
    }
    if (nuove) svuotaCache_();
  } finally {
    lock.releaseLock();
  }
}

function immagine_(x) {
  // versione ridotta (2000 px) servita da Google: leggera e sufficiente per leggere i pettorali
  try {
    const r = UrlFetchApp.fetch('https://lh3.googleusercontent.com/d/' + x.id + '=w2000', { muteHttpExceptions: true });
    const h = r.getHeaders(), tipo = h['Content-Type'] || h['content-type'] || '';
    if (r.getResponseCode() === 200 && /^image\//.test(tipo)) return r.getBlob();
  } catch (e) {}
  return x.file.getBlob();
}

function conGemini_(x, chiave) {
  const blob = immagine_(x);
  const corpo = {
    contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: blob.getContentType() || 'image/jpeg', data: Utilities.base64Encode(blob.getBytes()) } }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: {
        pettorali: { type: 'ARRAY', items: { type: 'INTEGER' } },
        parole: { type: 'ARRAY', items: { type: 'STRING' } },
        descrizione: { type: 'STRING' } }, required: ['pettorali', 'parole', 'descrizione'] }
    }
  };
  const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + MODELLO + ':generateContent', {
    method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': chiave },
    payload: JSON.stringify(corpo), muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code === 429 || code === 503) return { riprova: true };
  if (code !== 200) throw new Error('Gemini HTTP ' + code + ' ' + res.getContentText().slice(0, 120));
  const j = JSON.parse(res.getContentText());
  const testo = (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.map(function (p) { return p.text || ''; }).join('');
  const o = JSON.parse(testo || '{}');
  return {
    pettorali: numeri_((o.pettorali || []).join(' ')),
    parole: (o.parole || []).map(function (s) { return String(s).toLowerCase().trim(); }).filter(Boolean).slice(0, 12),
    descrizione: String(o.descrizione || '').slice(0, 300),
    esito: 'gemini'
  };
}

function conDrive_(x) {
  // OCR gratuito di Google Drive: converte una copia in Documento Google, ne legge il testo e la cestina
  const copia = Drive.Files.create({ name: 'tmp-ocr-' + x.id, mimeType: 'application/vnd.google-apps.document' },
                                   immagine_(x), { ocrLanguage: 'it' });
  try {
    const testo = DocumentApp.openById(copia.id).getBody().getText();
    const p = (testo.match(/\b\d{1,3}\b/g) || []).join(' ');
    return { pettorali: numeri_(p), parole: [], descrizione: '', esito: 'drive' };
  } finally {
    try { DriveApp.getFileById(copia.id).setTrashed(true); } catch (e) {}
  }
}

/* ---------------- installazione e prove ---------------- */
function installa() {
  foglio_();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'indicizza') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('indicizza').timeBased().everyMinutes(10).create();
  Logger.log('Foglio indice: ' + SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('FOGLIO_ID')).getUrl());
  provaUnaFoto();
}

/** Analizza la prima foto senza scrivere nulla e mostra il risultato nel registro: utile per controllare la chiave. */
function provaUnaFoto() {
  const c = cartelle_().filter(function (c) { return immagini_(c.cartella).length; })[0];
  const x = immagini_(c.cartella)[0];
  const chiave = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  const r = (MOTORE === 'gemini' && chiave) ? conGemini_(x, chiave) : conDrive_(x);
  Logger.log(x.file.getName() + ' → ' + JSON.stringify(r));
}
