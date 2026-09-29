# SRM Explorer

Esplorazione 3D interattiva del percorso della **Skyrace del Maglio 2026** (Magliano de' Marsi, AQ) —
29,7 km sulla rete sentieristica del Parco Naturale Regionale Sirente Velino, nella Riserva Naturale
Orientata Monte Velino.

**Prova dal vivo:** apri `index.html` da un server (GitHub Pages, o in locale `python -m http.server`).

## Comandi

| Azione | Come |
|---|---|
| Avanti / indietro | freccia destra / sinistra, oppure pulsanti ▶ ◀ (funzionano da telefono, tieni premuto) |
| Ruotare la camera | trascina con mouse o dito |
| Zoom | rotella o pizzico |
| Riagganciare la camera | pulsante **SEGUI LINO** |
| Saltare a un punto | tocca il profilo altimetrico in basso |
| Schede dei punti | tocca i segnaposto 3D o il banner arancione |

## Struttura

```
index.html      pagina e interfaccia (barra info, profilo, minimappa, modali)
app.js          motore Three.js (caricamento, movimento, camera, HUD, POI)
assets/
  scene.glb     terreno conformato + sentiero + edifici + lupi + grifone (Draco)
  lino.glb      Lino con ciclo di corsa campionato dall'armatura
  route.json    traccia (2.972 punti), zone, sentieri, POI, cancelli, orbite grifoni
```

## Da dove vengono i dati

- Traccia e quote: rilievo GPX ufficiale SRM 2026 → scena Blender del reel promozionale
  (terreno Copernicus conformato al percorso). Quota visualizzata = taratura lineare
  sulla scena, residui ≤ 4 m sulle quote ufficiali (729/1.249/2.115/2.385/897 m).
- Sequenza sentieri E1 · 3 · 3B · 3 · 1 · 7 · E1 e cancelli orari: carta escursionistica
  SRM 2026 e Regolamento Rev. 6.
- Toponimi: vedi `TOPONIMI.md` (con note su cosa resta da validare).

## Pipeline di rigenerazione asset

Nel progetto Blender (`Skyrace_Lino_Blender_Project`, PC di Ale):
`tools/export_srmexplorer.py` eseguito headless rigenera `assets/` da
`build/skyrace_lino_pc.blend` (decimazione Meshy, vertex color del terreno,
texture 1024, ciclo di corsa 2 s campionato, Draco livello 6).
