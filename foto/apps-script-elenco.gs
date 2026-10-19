/**
 * Skyrace del Maglio – elenco automatico delle foto per www.skyracedelmaglio.it/foto/
 *
 * Va pubblicato come "App web" da script.google.com con l'account usasportingclub@gmail.com:
 *   Esegui come: Io  ·  Chi ha accesso: Chiunque
 * L'indirizzo che termina con /exec va messo in FONTE_LIVE dentro foto/index.html.
 * Legge la cartella Drive "Foto Skyrace del Maglio 2026" e restituisce l'elenco delle immagini
 * in ordine di scatto; le foto caricate due volte, es. "srm__E3A0071 (1).jpg", compaiono una volta sola.
 * Il risultato resta in memoria 5 minuti: una foto aggiunta in Drive compare sul sito entro 5 minuti.
 */
const CARTELLA = '15sBXYdjHx9cdD2rDZEUbTbIL-svRGFe9';

function doGet() {
  const cache = CacheService.getScriptCache();
  let json = cache.get('elenco');
  if (!json) {
    const visti = {}, foto = [];
    const it = DriveApp.getFolderById(CARTELLA).getFiles();
    while (it.hasNext()) {
      const f = it.next();
      if (f.isTrashed() || f.getMimeType().indexOf('image/') !== 0) continue;
      const n = f.getName().replace(/\.[^.]+$/, '').replace(/\s*\(\d+\)$/, '').replace(/^srm__/, '');
      if (visti[n]) continue;
      visti[n] = true;
      foto.push({ n: n, id: f.getId() });
    }
    foto.sort(function (a, b) { return a.n.localeCompare(b.n, 'it', { numeric: true }); });
    json = JSON.stringify({ fotografo: 'Michele Stoduto', aggiornato: new Date().toISOString(), foto: foto });
    if (json.length < 90000) cache.put('elenco', json, 300);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
