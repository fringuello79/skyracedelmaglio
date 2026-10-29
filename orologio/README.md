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

## Quando arriva l'orologio

### 1. Firmware
Il firmware si compila da solo su GitHub, a ogni modifica di `orologio/firmware`. Si trova nella scheda *Actions* del
repository, esecuzione «Firmware orologio SRM», sezione *Artifacts* → `firmware-orologio-srm`.

Per caricarlo:
1. collegare l'orologio al PC con il cavo USB-C;
2. aprire https://flasher.meshtastic.org con Chrome o Edge;
3. scegliere «T-Watch Ultra», poi «Custom firmware» o il trascinamento del file;
4. caricare `firmware-t-watch-ultra-srm-….factory.bin` (installazione completa, la prima volta).

Da riga di comando, se preferisci: `esptool.py write_flash 0x0 firmware-t-watch-ultra-srm-….factory.bin`.

### 2. Configurazione
```
cd orologio/config
pip install meshtastic
python3 prepara.py --orologi 1-5                         # una volta: canale e profili in privato/
meshtastic --configure privato/orologio-001.yaml          # orologio collegato via USB
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
- **Schermo:** resta spento e si accende da solo ai bivi e negli errori. Il tocco lo accende o passa alla pagina
  dopo (Guida, Mappa, Gara, SOS). Si può anche scorrere a destra o a sinistra.
- **Corona, pressione breve:** modalità mappa (percorso e posizione, sempre accesa). Un tocco cambia la scala:
  800 m, 2 km, tutto il percorso. Una nuova pressione la chiude.
- **Corona tenuta 2-3 secondi: SOS.**
  - Prima dell'invio ci sono 5 secondi per annullare con un tocco o con la corona.
  - Poi l'orologio ripete l'invio ogni 10 secondi finché la base risponde «ricevuto».
  - Tenendo di nuovo la corona, l'SOS viene ritirato e la base è avvisata.
  - L'orologio si spegne solo tenendo la corona 10 secondi.
- **Vibrazioni:**
  - una lunga: bivio fra 200 m;
  - due: al bivio;
  - tre brevi: «ora gira»;
  - tre lunghe: errore;
  - un tocco: bivio superato.
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
python3 orologio/sala/prova_sala.py          # messaggi e sala controllo
```

## Cosa manca
- **Voce registrata:** per ora l'orologio fa suoni brevi e diversi per tipo di avviso. Le frasi parlate andranno
  registrate e messe sulla memoria dell'orologio.
- **Carta topografica nella modalità mappa:** per ora si vedono solo il percorso e i bivi. Le tessere della carta si
  possono mettere sulla microSD in un secondo momento.
- **Prove sull'orologio vero:** il firmware è compilato ma non ancora provato sull'orologio, che non è ancora arrivato.
