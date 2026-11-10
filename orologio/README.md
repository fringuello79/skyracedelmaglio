# Orologio SRM: guida sul percorso, posizione e SOS sulla rete mesh

Questa cartella contiene il necessario per far funzionare la rete della Skyrace del Maglio:
- l'orologio LilyGO T-Watch Ultra 868 MHz, con la guida sul percorso, l'SOS e la posizione inviata alla base;
- i ripetitori Heltec V4 sui punti scelti;
- il nodo della base, collegato al PC della sala controllo.

La simulazione da cui vengono le scelte (modulazione, ripetitori, intervalli) è in [guida/orologio](../guida/orologio/).

| Cartella | Cosa c'è |
|---|---|
| `config/` | `prepara.py`: crea il canale SRM (chiave segreta) e i profili Meshtastic di orologi, ripetitori e base |
| `sala/` | `sala.py`: programma della sala controllo (mappa, allarmi, conferma automatica degli SOS, registro) |
| `firmware/srm/` | guida in C++ (stessa logica di `guida/motore.js`), app dell'orologio, dati di traccia e bivi |
| `firmware/meshtastic/` | modulo per il firmware Meshtastic e `integra.py`, che lo inserisce e prepara la compilazione |
| `firmware/prove/` | prove sul PC: confronto con la guida del telefono e schermate dell'orologio (`schermi/tutte.png`) |
| `firmware/voce/` | `frasi.tsv`: le 133 frasi che l'orologio può dire (registrazioni in `wav/`, se ci sono) |
| `installa/` | pagina per caricare il firmware dal browser e firmware compilato |
| `voce/` | pagina per ascoltare la voce sintetica e registrare le frasi con la propria voce |

## Quando arriva l'orologio

### 1. Firmware
Il firmware si compila da solo su GitHub a ogni modifica di `orologio/firmware`, e viene pubblicato sul sito.
Per caricarlo sull'orologio:
1. aprire **https://www.skyracedelmaglio.it/orologio/installa/** sul PC, con Chrome o Edge;
2. collegare l'orologio con il cavo USB-C;
3. premere «Installa sull'orologio».

Se compare «Failed to initialize»: cavo collegato, tenere premuto BOOT (lato sinistro, accanto a PWR), premere e
rilasciare RST (lato destro, sotto il gommino della USB), rilasciare BOOT, poi ripetere. Lo schermo resta nero finché
non si preme RST a caricamento finito.

Il file è anche in `orologio/installa/firmware.factory.bin`. Da riga di comando:
`esptool.py write_flash 0x0 firmware.factory.bin`.

### 2. Configurazione
```
cd orologio/config
pip install meshtastic
python3 prepara.py --orologi 1-5                         # una volta: canale e profili in privato/
python3 configura.py privato/orologio-001.yaml          # orologio collegato via USB (su Windows: doppio clic su configura.bat)
```
La cartella `privato/` contiene la chiave del canale: si conserva e non si pubblica.
Tutti gli apparecchi della gara devono avere lo stesso canale, quindi `prepara.py` si lancia una volta sola.
Le volte dopo riusa la chiave già creata.

### 3. Prove da fare subito
1. **Batteria:** orologio al polso, GPS acceso, schermo spento, 2 ore. Annotare la percentuale ogni 30 minuti.
   Poi 30 minuti in modalità mappa.
2. **Guida:** un giro sul percorso o su un tratto. Controllare tre cose:
   - le vibrazioni ai bivi;
   - la freccia sullo schermo;
   - l'avviso se si sbaglia sentiero.
3. **Radio:** un Heltec configurato come base (`base.yaml`) collegato al PC con `sala.py`.
   Si guarda fino a dove arrivano posizione e SOS.

### 4. Ripetitori e base
```
meshtastic --configure privato/ripetitore-forche.yaml      # uno per ogni punto
meshtastic --configure privato/base.yaml
python3 ../sala/sala.py --porta COM5                        # Windows (su Mac/Linux: /dev/ttyUSB0)
```
Poi aprire http://localhost:8080/orologio/sala/. Senza radio, `python3 sala.py --prova` mostra una gara finta.

## Come si usa l'orologio
- **Pagine:** in basso ci sono sempre le quattro voci GUIDA · MAPPA · GARA · SOS, da toccare direttamente.
  All'accensione compare per 25 secondi la pagina «Come si usa».
- **Tasti laterali:** i due tasti fanno la stessa cosa. Pressione breve: pagina dopo. Tenuto 2 secondi: SOS.
  A ogni comando accettato l'orologio vibra.
- **Guida:** freccia, distanza e nome del bivio. Se la guida non parte dice perché: «Aspetto il GPS» oppure
  «Non sei sul percorso», con la distanza dal sentiero di gara.
- **Mappa:** nord in alto, con rilievo ombreggiato, curve di livello, cime, percorso, bivi e la propria posizione.
  Si vede anche senza GPS (percorso intero). Un tocco sulla mappa cambia la scala: 800 m, 2 km, tutto.
  Resta accesa 2 minuti dopo l'ultimo tocco. Vicino a un bivio, sotto la mappa compaiono freccia e distanza.
- **SOS:**
  - si chiede tenendo premuto il cerchio rosso della pagina SOS, oppure un tasto laterale per 2 secondi;
  - prima dell'invio ci sono 5 secondi per annullare con un tocco o con un tasto;
  - poi l'orologio ripete l'invio ogni 10 secondi finché la base risponde «ricevuto»;
  - per ritirarlo si tiene di nuovo un tasto laterale 2 secondi (non basta toccare lo schermo), e la base è avvisata;
  - l'orologio si spegne solo tenendo il tasto di accensione 10 secondi.
- **Schermo:** resta spento e si accende da solo ai bivi e negli errori.
- **Vibrazioni:**
  - una lunga: bivio fra 200 m;
  - due: al bivio;
  - tre brevi: «ora gira»;
  - tre lunghe: errore;
  - un tocco: comando accettato, bivio superato.
- **Scorrere verso l'alto:** per un minuto si torna alle pagine normali di Meshtastic.

## Messaggi sulla rete
Sono messaggi di testo sul canale SRM, leggibili anche con l'app Meshtastic:

| Messaggio | Chi lo manda | Significato |
|---|---|---|
| `SRM SOS P057 R4821 km12.4 42.15123,13.38211` | orologio | richiesta di soccorso, con posizione |
| `SRM FUORI P057 km12.4 42.15123,13.38211` | orologio | atleta fuori percorso |
| `SRM SBAGLIATO P057 km1.7 42.10515,13.37455` | orologio | sentiero sbagliato dopo un bivio |
| `SRM RIENTRATO P057 km1.7` | orologio | di nuovo sul percorso |
| `SRM ANNULLA P057 R4821` | orologio | l'atleta ha ritirato l'SOS |
| `SRM OK P057 R4821` | base (in automatico) | SOS ricevuto: l'orologio smette di ripetere |

La posizione normale (ogni 2 minuti) è quella standard di Meshtastic.

## Prove sul PC
```
sh orologio/firmware/prove/esegui.sh         # 15 percorsi: avvisi identici fra C++ e guida del telefono
sh orologio/firmware/prove/schermi.sh        # schermate dell'orologio in firmware/prove/schermi/ (tutte.png)
python3 orologio/sala/prova_sala.py          # messaggi e sala controllo
```

## Cosa manca
- **Voce:** l'orologio dice frasi registrate e messe nel firmware.
  - Finché non ci sono registrazioni vere usa una voce sintetica italiana (Piper, «Paola»).
  - La pagina `orologio/voce/` permette di ascoltarla e di registrare le frasi con una voce vera.
  - Le registrazioni vanno in `firmware/voce/wav/` (un file per frase, con il nome indicato nella pagina).
- **Sentieri e strade nella mappa:** lo sfondo è il rilievo calcolato dalle quote (una ogni 50 m), con curve di
  livello e cime. Non ci sono sentieri, strade e toponimi di una carta vera: servirebbero le tessere sulla microSD.
- **Prove sul percorso:** sull'orologio vero sono provati caricamento, configurazione, GPS, posizione alla sala e SOS
  con conferma (10/11/2026, in casa). Mancano le prove di guida sul sentiero, di batteria e di portata radio.
