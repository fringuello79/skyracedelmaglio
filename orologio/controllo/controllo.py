#!/usr/bin/env python3
"""SRM Controllo: un solo programma per gli apparecchi della gara e per la sala.

    python controllo.py            (su Windows: doppio clic su «SRM Controllo.bat»)

Apre nel browser http://localhost:8080/ con:
- gli apparecchi collegati via USB (orologi, base, ripetitori) e cosa sono;
- caricare sull'orologio il firmware più recente pubblicato sul sito;
- configurare un orologio (pettorale), la base o un ripetitore, con verifica; prima salva la configurazione di prima;
- la sala controllo: si collega da sola alla base, mostra mappa, atleti e allarmi.

La chiave del canale resta in orologio/config/privato/ su questo PC.
"""
import json, os, subprocess, sys, threading, time, urllib.request, webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

QUI = Path(__file__).resolve().parent
RADICE = QUI.parent.parent                   # la cartella del sito (o la sua copia): /orologio/..., /posizione/...
CONFIG = QUI.parent / 'config'
PRIVATO = CONFIG / 'privato'
FIRMWARE = QUI / 'firmware'
SITO = 'https://www.skyracedelmaglio.it/orologio/installa/'
PORTA_WEB = 8080
sys.path.insert(0, str(QUI.parent / 'sala'))

SEGRETO = ('meshtastic.org/e/', 'psk', 'fixed_pin', 'fixedPin', 'privateKey', 'private_key', 'adminKey')


def python_exe():
    """python.exe anche quando il programma gira con pythonw.exe (senza finestra)."""
    p = Path(sys.executable)
    q = p.with_name(p.name.lower().replace('pythonw', 'python'))
    return str(q if q.exists() else p)


def senza_finestra():
    return {'creationflags': 0x08000000} if os.name == 'nt' else {}        # CREATE_NO_WINDOW


# ---------- un apparecchio collegato: chi è ----------
def identifica(porta):
    """Eseguito in un processo a parte (python controllo.py --identifica COMx): stampa una riga JSON."""
    import meshtastic.serial_interface
    out = {'porta': porta, 'risponde': False}
    try:
        i = meshtastic.serial_interface.SerialInterface(porta, timeout=20)
        u = i.getMyUser() or {}
        md = getattr(i, 'metadata', None)
        out.update(risponde=bool(u), nome=u.get('longName'), sigla=u.get('shortName'), modello=u.get('hwModel'),
                   firmware=getattr(md, 'firmware_version', None) or None, num=getattr(getattr(i, 'myInfo', None), 'my_node_num', None))
        try:
            ch = i.localNode.channels[0].settings
            out['canale'] = ch.name or '(predefinito)'
        except Exception:
            pass
        i.close()
    except SystemExit as e:
        out['errore'] = str(e)
    except Exception as e:
        out['errore'] = f'{type(e).__name__}: {e}'
    print('IDENT ' + json.dumps(out), flush=True)


def tipo_di(a):
    nome = a.get('nome') or ''
    if nome.startswith('SRM base'): return 'base'
    if nome.startswith('SRM rip.'): return 'ripetitore'
    if a.get('modello') == 'T_WATCH_ULTRA': return 'orologio'
    if a.get('risponde'): return 'altro'
    return 'muto'


class Controllo:
    def __init__(self):
        import sala as S
        self.S = S
        self.sala = S.Sala(S.Percorso())
        self.radio = S.Radio(self.sala)
        self.lock = threading.Lock()
        self.apparecchi = []
        self.cercando = False
        self.lavoro = {'nome': '', 'attivo': False, 'righe': [], 'esito': None}
        self.fw = {'locale': None, 'sito': None, 'errore': None}
        self.porteViste = set()
        threading.Thread(target=self._guardia, daemon=True).start()
        self._leggi_fw_locale()
        threading.Thread(target=self._fw_sito, daemon=True).start()
        self.cerca()

    # --- firmware ---
    def _leggi_fw_locale(self):
        try:
            self.fw['locale'] = json.loads((FIRMWARE / 'versione.json').read_text())
        except Exception:
            self.fw['locale'] = None

    def _fw_sito(self):
        try:
            with urllib.request.urlopen(SITO + 'versione.json?' + str(int(time.time())), timeout=15) as r:
                self.fw['sito'] = json.loads(r.read().decode())
            self.fw['errore'] = None
        except Exception as e:
            self.fw['errore'] = f'sito non raggiungibile ({type(e).__name__})'

    def _scarica_fw(self, scrivi):
        self._fw_sito()
        sito, loc = self.fw['sito'], self.fw['locale']
        f = FIRMWARE / 'firmware.factory.bin'
        if sito and (not loc or loc.get('commit') != sito.get('commit') or not f.exists()):
            scrivi(f"Scarico il firmware {sito.get('versione')} dal sito…")
            FIRMWARE.mkdir(exist_ok=True)
            with urllib.request.urlopen(SITO + 'firmware.factory.bin?' + sito.get('commit', ''), timeout=120) as r:
                dati = r.read()
            if len(dati) < 1000000 or dati[0] != 0xE9:
                raise RuntimeError('il file scaricato non è un firmware')
            f.write_bytes(dati)
            (FIRMWARE / 'versione.json').write_text(json.dumps(sito))
            self._leggi_fw_locale()
            scrivi(f'Scaricato ({len(dati) // 1024} kB).')
        elif not f.exists():
            raise RuntimeError('firmware non disponibile: il sito non è raggiungibile e non ce n\'è una copia qui')
        else:
            scrivi(f"Uso il firmware già scaricato: {(loc or {}).get('versione', '?')}" + ('' if sito else ' (sito non raggiungibile)'))
        return f

    def _caricati(self):
        try:
            return json.loads((FIRMWARE / 'caricati.json').read_text())
        except Exception:
            return {}

    # --- apparecchi ---
    def cerca(self, dopo=None):
        with self.lock:
            if self.cercando: return
            self.cercando = True
        threading.Thread(target=self._cerca, args=(dopo,), daemon=True).start()

    def _cerca(self, dopo):
        try:
            from serial.tools import list_ports
            trovati = []
            for p in sorted(list_ports.comports(), key=lambda p: p.device):
                if p.vid is None:
                    continue            # porte interne del PC (modem, Bluetooth)
                a = {'porta': p.device, 'usb': f'{p.vid:04X}:{p.pid:04X}', 'descrizione': p.description or '', 'risponde': False}
                if self.radio.portaInUso == p.device and self.sala.radio.get('collegata'):
                    a.update(risponde=True, nome=self.sala.radio.get('nome'), in_sala=True)
                    vecchio = next((x for x in self.apparecchi if x['porta'] == p.device), None)
                    if vecchio: a.update({k: vecchio.get(k) for k in ('modello', 'firmware', 'canale', 'sigla', 'num')})
                else:
                    try:
                        r = subprocess.run([python_exe(), '-u', str(Path(__file__).resolve()), '--identifica', p.device],
                                           capture_output=True, text=True, timeout=45, encoding='utf-8', errors='replace', **senza_finestra())
                        riga = next((x for x in r.stdout.splitlines() if x.startswith('IDENT ')), None)
                        if riga: a.update(json.loads(riga[6:]))
                    except subprocess.TimeoutExpired:
                        a['errore'] = 'non risponde'
                a['tipo'] = tipo_di(a)
                # quale compilazione del firmware SRM c'è sopra: lo sappiamo solo se l'abbiamo caricata da qui
                # (il numero di versione di Meshtastic è lo stesso per tutte le nostre compilazioni)
                a['srm'] = self._caricati().get(str(a.get('num'))) if a.get('num') else None
                if a['tipo'] == 'muto' and a['usb'].startswith('303A'):
                    a['nota'] = 'ESP32-S3 che non risponde: forse è un orologio in modalità di caricamento, o senza Meshtastic'
                trovati.append(a)
            self.apparecchi = trovati
            self.porteViste = {a['porta'] for a in trovati}
            if not self.lavoro['attivo']:
                self._sala_da_sola()
        except Exception as e:
            print('ricerca apparecchi:', type(e).__name__, e, flush=True)
        finally:
            self.cercando = False
            if dopo: dopo()

    def _sala_da_sola(self):
        """La sala si collega da sola alla base quando c'è, e lascia la porta quando la base viene staccata."""
        base = next((a for a in self.apparecchi if a['tipo'] == 'base'), None)
        if base and not self.radio.voluta.is_set():
            self.radio.avvia(base['porta'])
        elif not base and self.radio.voluta.is_set() and not self.sala.radio.get('collegata'):
            self.radio.ferma(1)

    def _guardia(self):
        """Se si collega o si stacca un apparecchio, la ricerca riparte da sola."""
        from serial.tools import list_ports
        while True:
            time.sleep(3)
            try:
                ora = {p.device for p in list_ports.comports() if p.vid is not None}
                if ora != self.porteViste and not self.cercando and not self.lavoro['attivo']:
                    time.sleep(2)       # l'apparecchio appena collegato ci mette un attimo
                    self.cerca()
            except Exception:
                pass

    def trova(self, porta=None, tipo=None):
        for a in self.apparecchi:
            if (porta and a['porta'] == porta) or (tipo and a['tipo'] == tipo):
                return a
        return None

    # --- lavori (uno alla volta) ---
    def avvia_lavoro(self, nome, passi, porta=None):
        """passi: lista di comandi (liste di argomenti) o funzioni f(scrivi)."""
        with self.lock:
            if self.lavoro['attivo']:
                return False, 'C\'è già un lavoro in corso: aspetta che finisca.'
            self.lavoro = {'nome': nome, 'attivo': True, 'righe': [], 'esito': None, 'inizio': time.time()}
        threading.Thread(target=self._lavora, args=(passi, porta), daemon=True).start()
        return True, ''

    def _scrivi(self, riga):
        riga = riga.rstrip()
        if not riga or any(s in riga for s in SEGRETO) or riga.startswith(('Requirement already', 'Set ')):
            return
        with self.lock:
            self.lavoro['righe'].append(time.strftime('%H:%M:%S ') + riga)
            del self.lavoro['righe'][:-400]
        print('  |', riga, flush=True)

    def _lavora(self, passi, porta):
        esito = 'ok'
        try:
            if porta and self.radio.portaInUso == porta:
                self._scrivi('Stacco la sala dalla base per il tempo necessario…')
                self.radio.ferma()
            env = dict(os.environ, PYTHONUTF8='1', PYTHONIOENCODING='utf-8')
            for passo in passi:
                if callable(passo):
                    passo(self._scrivi); continue
                p = subprocess.Popen(passo, cwd=str(CONFIG), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                     encoding='utf-8', errors='replace', env=env, **senza_finestra())
                for riga in p.stdout:
                    self._scrivi(riga)
                if p.wait() != 0:
                    raise RuntimeError(f'il passo «{Path(passo[2]).name if len(passo) > 2 else passo[0]}» è finito con un errore')
        except Exception as e:
            esito = 'errore'; self._scrivi(f'ERRORE: {e}')
        self._scrivi('Fatto.' if esito == 'ok' else 'Non riuscito: vedi le righe sopra.')
        with self.lock:
            self.lavoro['esito'] = esito
        time.sleep(4)                    # l'apparecchio si riavvia

        def fine():
            with self.lock:
                self.lavoro['attivo'] = False
            self._sala_da_sola()
        self.cerca(dopo=fine) if not self.cercando else fine()

    def _salva_prima(self, porta, nome):
        """Passo: copia della configurazione attuale dell'apparecchio, prima di cambiarla."""
        def passo(scrivi):
            PRIVATO.mkdir(exist_ok=True)
            pulito = ''.join(c if c.isalnum() else '-' for c in (nome or 'apparecchio'))[:30]
            f = PRIVATO / f"prima-{pulito}-{time.strftime('%Y%m%d-%H%M%S')}.yaml"
            try:
                r = subprocess.run([python_exe(), '-m', 'meshtastic', '--port', porta, '--export-config'], capture_output=True, text=True,
                                   timeout=90, encoding='utf-8', errors='replace', **senza_finestra())
                testo = r.stdout[r.stdout.find('# start of Meshtastic'):] if '# start of Meshtastic' in r.stdout else ''
                if testo.strip():
                    f.write_text(testo, encoding='utf-8')
                    scrivi(f'Configurazione di prima salvata in privato/{f.name}')
                else:
                    scrivi('Non sono riuscito a salvare la configurazione di prima (proseguo).')
            except Exception as e:
                scrivi(f'Non sono riuscito a salvare la configurazione di prima ({type(e).__name__}); proseguo.')
            time.sleep(3)
        return passo

    def configura(self, tipo, porta, pettorale=None, ripetitore=None):
        a = self.trova(porta=porta)
        if not a or not a.get('risponde'):
            return False, 'Apparecchio non trovato o che non risponde: premi «Cerca di nuovo».'
        py = python_exe()
        if tipo == 'orologio':
            n = int(pettorale)
            if not 1 <= n <= 999: return False, 'Il pettorale va da 1 a 999.'
            profilo = f'privato/orologio-{n:03d}.yaml'; nome = f'Configuro l\'orologio come pettorale {n:03d}'
            prepara = [py, '-u', 'prepara.py', '--orologi', str(n)]
        elif tipo == 'base':
            profilo = 'privato/base.yaml'; nome = 'Configuro la base della sala'; prepara = [py, '-u', 'prepara.py']
        elif tipo == 'ripetitore':
            if ripetitore not in [r['id'] for r in self.stato()['ripetitori']]:
                return False, 'Ripetitore sconosciuto.'
            profilo = f'privato/ripetitore-{ripetitore}.yaml'; nome = f'Configuro il ripetitore «{ripetitore}»'; prepara = [py, '-u', 'prepara.py']
        else:
            return False, 'Tipo sconosciuto.'
        return self.avvia_lavoro(nome, [prepara, self._salva_prima(porta, a.get('nome')), [py, '-u', 'configura.py', profilo, porta]], porta)

    def carica_firmware(self, porta):
        a = self.trova(porta=porta)
        if not a: return False, 'Apparecchio non trovato: premi «Cerca di nuovo».'
        if a.get('risponde') and a.get('modello') != 'T_WATCH_ULTRA':
            return False, f"Questo apparecchio è un {a.get('modello')}, non un orologio T-Watch Ultra: il firmware SRM non va caricato qui."
        file = {}

        def scarica(scrivi):
            file['f'] = self._scarica_fw(scrivi)
            scrivi('Scrivo il firmware sull\'orologio: un paio di minuti, non staccare il cavo.')

        def scrivi_fw(scrivi):
            p = subprocess.Popen([python_exe(), '-m', 'esptool', '--chip', 'esp32s3', '--port', porta, '--baud', '921600',
                                  'write_flash', '0x0', str(file['f'])], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                 encoding='utf-8', errors='replace', **senza_finestra())
            ultimo = 0
            for riga in p.stdout:
                riga = riga.replace('\r', '\n').strip().splitlines()[-1] if riga.strip() else ''
                if 'Writing at' in riga and time.time() - ultimo < 3: continue
                ultimo = time.time(); scrivi(riga)
            if p.wait() != 0:
                raise RuntimeError('caricamento non riuscito. Se dice che non riesce a collegarsi: tieni premuto BOOT, premi e rilascia '
                                   'RST, rilascia BOOT (schermo nero), poi «Cerca di nuovo» e riprova')
            scrivi('Firmware caricato. Se lo schermo resta nero premi RST. La configurazione (canale, pettorale) resta quella di prima.')
            if a.get('num') and self.fw['locale']:
                d = self._caricati(); d[str(a['num'])] = self.fw['locale'].get('commit')
                (FIRMWARE / 'caricati.json').write_text(json.dumps(d))
            time.sleep(12)
        return self.avvia_lavoro('Carico il firmware sull\'orologio', [scarica, scrivi_fw], porta)

    def stato(self):
        with self.lock:
            lav = dict(self.lavoro, righe=self.lavoro['righe'][-60:])
        s = self.sala.stato()
        rip = []
        try:
            rete = json.loads((CONFIG / 'rete.json').read_text()) if (CONFIG / 'rete.json').exists() else \
                json.loads((RADICE / 'guida/orologio/rete.json').read_text())
            rip = [{'id': n['id'], 'nome': n['nome']} for n in rete['nodi'] if n['ruolo'] != 'BASE']
        except Exception:
            pass
        return {'ora': time.time(), 'apparecchi': self.apparecchi, 'cercando': self.cercando, 'lavoro': lav, 'firmware': self.fw,
                'radio': s['radio'], 'ripetitori': rip, 'canale_pronto': (PRIVATO / 'canale.json').exists(),
                'sala': {'orologi': sum(1 for n in s['nodi'] if n.get('tipo') == 'atleta'),
                         'con_posizione': sum(1 for n in s['nodi'] if n.get('tipo') == 'atleta' and n.get('eta') is not None and n['eta'] < 300),
                         'allarmi_aperti': [a for a in s['allarmi'] if a['stato'] == 'aperto']}}


class Gestore(SimpleHTTPRequestHandler):
    c = None

    def log_message(self, *a): pass

    def _json(self, dati, codice=200):
        b = json.dumps(dati, ensure_ascii=False).encode()
        self.send_response(codice); self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        p = self.path.split('?')[0]
        if p == '/':
            self.send_response(302); self.send_header('Location', '/orologio/controllo/'); self.end_headers()
        elif p == '/stato.json':
            self._json(self.c.sala.stato())
        elif p == '/api/stato':
            self._json(self.c.stato())
        elif '/privato' in p or p.endswith(('.py', '.yaml', '.csv')):
            self.send_error(404)        # la chiave del canale e i registri non si servono
        else:
            super().do_GET()

    def do_POST(self):
        origine = self.headers.get('Origin') or ''
        if (origine and 'localhost' not in origine and '127.0.0.1' not in origine) or \
                (self.path.startswith('/api/') and self.client_address[0] not in ('127.0.0.1', '::1')):
            return self.send_error(403)  # i comandi solo da questo PC, dalla pagina di questo programma
        n = int(self.headers.get('Content-Length') or 0)
        try:
            d = json.loads(self.rfile.read(n) or b'{}')
        except ValueError:
            d = {}
        p = self.path.split('?')[0]; c = self.c
        if p == '/chiudi':
            return self._json({'ok': c.sala.chiudi(int(d.get('id', 0)), str(d.get('nota', ''))[:200])})
        if p == '/api/cerca':
            c.cerca(); return self._json({'ok': True})
        if p == '/api/configura':
            ok, msg = c.configura(d.get('tipo'), d.get('porta'), d.get('pettorale'), d.get('ripetitore'))
            return self._json({'ok': ok, 'messaggio': msg})
        if p == '/api/firmware':
            ok, msg = c.carica_firmware(d.get('porta'))
            return self._json({'ok': ok, 'messaggio': msg})
        if p == '/api/esci':
            self._json({'ok': True})
            threading.Timer(0.5, lambda: os._exit(0)).start(); return
        self.send_error(404)


def main():
    if len(sys.argv) > 2 and sys.argv[1] == '--identifica':
        return identifica(sys.argv[2])
    senza_browser = '--senza-browser' in sys.argv
    url = f'http://localhost:{PORTA_WEB}/'
    # un registro leggibile anche quando il programma gira senza finestra
    registro = open(QUI / 'registro-programma.txt', 'a', encoding='utf-8', buffering=1)
    sys.stdout = sys.stderr = registro
    print('\n=====', time.strftime('%Y-%m-%d %H:%M:%S'), 'SRM Controllo', flush=True)
    try:                                 # già in funzione? allora basta aprire la pagina
        with urllib.request.urlopen(url + 'api/stato', timeout=2) as r:
            if r.status == 200:
                print('già in funzione: apro solo la pagina', flush=True)
                if not senza_browser: webbrowser.open(url)
                return
    except Exception:
        pass

    class Server(ThreadingHTTPServer):
        allow_reuse_address = os.name != 'nt'   # su Windows «riusare» vorrebbe dire due programmi sulla stessa porta
        daemon_threads = True
    try:
        # --rete: la mappa della sala si può guardare anche da altri apparecchi della rete locale (i comandi restano solo qui)
        srv = Server(('0.0.0.0' if '--rete' in sys.argv else '127.0.0.1', PORTA_WEB), partial(Gestore, directory=str(RADICE)))
    except OSError as e:
        print('la porta', PORTA_WEB, 'è occupata da un altro programma (una vecchia finestra della sala?):', e, flush=True)
        (QUI / 'errore.html').write_text('<meta charset="utf-8"><body style="font:18px system-ui;padding:40px"><h1>SRM Controllo non parte</h1>'
                                         '<p>La porta 8080 è occupata da un altro programma, probabilmente una vecchia finestra nera della sala.'
                                         '<br>Chiudila e riavvia «SRM Controllo».</p>', encoding='utf-8')
        if not senza_browser: webbrowser.open((QUI / 'errore.html').as_uri())
        return
    Gestore.c = Controllo()
    if not senza_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
