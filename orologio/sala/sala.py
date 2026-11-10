#!/usr/bin/env python3
"""Sala controllo SRM: legge la rete mesh dal nodo della base e mostra atleti, ripetitori e allarmi.

    pip install meshtastic
    python3 sala.py --porta COM5            (Windows; su Linux/Mac: /dev/ttyUSB0 o /dev/cu.usbmodem…)
    python3 sala.py --prova                 (senza radio: una gara finta, per provare la pagina)

Poi aprire nel browser:  http://localhost:8080/orologio/sala/

Cosa fa:
- tiene l'ultima posizione di ogni orologio (pettorale, km sul percorso, da quanto non si sente);
- riceve SOS, FUORI, SBAGLIATO, RIENTRATO; agli SOS risponde da solo «SRM OK» così l'orologio smette di ripetere;
- tiene la batteria dei ripetitori;
- scrive tutto in orologio/sala/dati/ (eventi.csv, posizioni.csv, stato.json): a fine gara c'è la traccia di ognuno.
"""
import argparse, csv, json, math, os, random, sys, threading, time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import protocollo as P

QUI = Path(__file__).resolve().parent
RADICE = QUI.parent.parent
DATI = QUI / 'dati'


# ---------- percorso: chilometro dalla posizione ----------
class Percorso:
    def __init__(self, file=RADICE / 'posizione' / 'traccia.json'):
        d = json.loads(Path(file).read_text())
        self.pts = d['pts']; self.km_tot = d['km_tot']

    def proietta(self, lat, lon):
        k = math.cos(math.radians(lat)); best = (1e18, 0.0)
        xy = lambda q: ((q[1] - lon) * k * 111320, (q[0] - lat) * 110540)
        for i in range(1, len(self.pts)):
            ax, ay = xy(self.pts[i - 1]); bx, by = xy(self.pts[i])
            vx, vy = bx - ax, by - ay; L2 = vx * vx + vy * vy
            t = max(0, min(1, -(ax * vx + ay * vy) / L2)) if L2 else 0
            d = math.hypot(ax + t * vx, ay + t * vy)
            if d < best[0]:
                best = (d, self.pts[i - 1][3] + t * (self.pts[i][3] - self.pts[i - 1][3]))
        return best[1], best[0]          # km, distanza dal percorso in metri


# ---------- stato della sala ----------
class Sala:
    def __init__(self, percorso, invia=None, orologio=time.time):
        self.percorso = percorso; self.invia = invia; self.ora = orologio
        self.nodi = {}          # num -> dati
        self.allarmi = []       # dizionari
        self.conferme = {}      # (pettorale, rif) -> ultimo invio
        self.lock = threading.Lock()
        self.radio = {'collegata': False, 'pacchetti': 0, 'ultimo': None, 'nota': 'in attesa del nodo base'}
        DATI.mkdir(exist_ok=True)
        self.f_pkt = open(DATI / 'pacchetti.csv', 'a', newline='', encoding='utf-8'); self.w_pkt = csv.writer(self.f_pkt)
        self.f_eventi = open(DATI / 'eventi.csv', 'a', newline='', encoding='utf-8')
        self.f_pos = open(DATI / 'posizioni.csv', 'a', newline='', encoding='utf-8')
        self.w_eventi = csv.writer(self.f_eventi); self.w_pos = csv.writer(self.f_pos)

    def _nodo(self, num, nome=None):
        n = self.nodi.setdefault(num, {'num': num, 'nome': None, 'tipo': 'altro', 'pettorale': None})
        if nome:
            n['nome'] = nome
            if nome.startswith('SRM pettorale'):
                n['tipo'] = 'atleta'
                try: n['pettorale'] = int(nome.split()[-1])
                except ValueError: pass
            elif nome.startswith('SRM rip.'):
                n['tipo'] = 'ripetitore'
            elif nome.startswith('SRM base'):
                n['tipo'] = 'base'
        return n

    def evento(self, tipo, testo, **extra):
        t = self.ora()
        self.w_eventi.writerow([time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(t)), tipo, testo, json.dumps(extra, ensure_ascii=False)])
        self.f_eventi.flush()
        print(time.strftime('%H:%M:%S'), tipo, testo, flush=True)

    # pacchetto come lo consegna la libreria meshtastic (dizionario)
    def ricevi(self, pkt, nome=None):
        with self.lock:
            num = pkt.get('from'); dec = pkt.get('decoded', {}); porta = dec.get('portnum')
            n = self._nodo(num, nome)
            n['ultimoSentito'] = self.ora()
            # registro di tutto quello che la base sente (anche i pacchetti che non sa decifrare: chiave diversa)
            self.radio['pacchetti'] += 1; self.radio['ultimo'] = self.ora()
            self.w_pkt.writerow([time.strftime('%Y-%m-%d %H:%M:%S'), f'!{num:08x}' if isinstance(num, int) else num, n.get('nome') or '',
                                 porta or ('CIFRATO' if 'encrypted' in pkt else '?'), pkt.get('rxSnr', ''), pkt.get('rxRssi', ''),
                                 n.get('salti', '') if 'hopStart' not in pkt else pkt['hopStart'] - pkt.get('hopLimit', 0)])
            self.f_pkt.flush()
            if 'rxSnr' in pkt: n['snr'] = pkt['rxSnr']
            if 'hopStart' in pkt and 'hopLimit' in pkt: n['salti'] = pkt['hopStart'] - pkt['hopLimit']
            if porta == 'POSITION_APP':
                p = dec.get('position', {})
                lat = p.get('latitude', (p.get('latitudeI') or 0) / 1e7); lon = p.get('longitude', (p.get('longitudeI') or 0) / 1e7)
                if lat and lon:
                    km, dist = self.percorso.proietta(lat, lon)
                    n.update(lat=lat, lon=lon, alt=p.get('altitude'), tPos=self.ora(), km=round(km, 2), distPercorso=round(dist))
                    self.w_pos.writerow([time.strftime('%Y-%m-%d %H:%M:%S'), num, n.get('pettorale') or '', n.get('nome') or '', f'{lat:.6f}', f'{lon:.6f}', p.get('altitude') or '', f'{km:.2f}'])
                    self.f_pos.flush()
            elif porta == 'TELEMETRY_APP':
                m = dec.get('telemetry', {}).get('deviceMetrics')
                if m: n.update(batteria=m.get('batteryLevel'), tensione=m.get('voltage'))
            elif porta == 'TEXT_MESSAGE_APP':
                self._testo(n, dec.get('text', ''))

    def _testo(self, n, testo):
        m = P.leggi(testo)
        if not m:
            self.evento('testo', f"{n.get('nome') or n['num']}: {testo}"); return
        if m['tipo'] == 'OK':
            return            # le nostre conferme ripetute dai ripetitori
        n['pettorale'] = n.get('pettorale') or m['pettorale']; n['tipo'] = 'atleta'
        if m['lat']: n.update(lat=m['lat'], lon=m['lon'], tPos=self.ora())
        if m['km'] is not None: n['km'] = m['km']
        chi = f"pettorale {m['pettorale']:03d}"
        if m['tipo'] == 'SOS':
            a = next((x for x in self.allarmi if x['tipo'] == 'SOS' and x['pettorale'] == m['pettorale'] and x['rif'] == m['rif']), None)
            if not a:
                a = {'id': len(self.allarmi) + 1, 'tipo': 'SOS', 'pettorale': m['pettorale'], 'rif': m['rif'], 'km': m['km'],
                     'lat': m['lat'], 'lon': m['lon'], 't': self.ora(), 'stato': 'aperto', 'invii': 0}
                self.allarmi.append(a); n['stato'] = 'SOS'
                self.evento('SOS', f"{chi} km {m['km']} {m['lat']},{m['lon']}", rif=m['rif'])
            a['invii'] += 1
            self._conferma(m['pettorale'], m['rif'])
        elif m['tipo'] == 'ANNULLA':
            for a in self.allarmi:
                if a['tipo'] == 'SOS' and a['pettorale'] == m['pettorale'] and a['rif'] == m['rif'] and a['stato'] != 'chiuso':
                    a['stato'] = 'annullato dall\'atleta'
            n['stato'] = 'ok'; self.evento('ANNULLA', f'{chi} ha annullato l\'SOS', rif=m['rif'])
        elif m['tipo'] in ('FUORI', 'SBAGLIATO'):
            n['stato'] = 'fuori percorso' if m['tipo'] == 'FUORI' else 'sentiero sbagliato'
            self.allarmi.append({'id': len(self.allarmi) + 1, 'tipo': m['tipo'], 'pettorale': m['pettorale'], 'km': m['km'],
                                 'lat': m['lat'], 'lon': m['lon'], 't': self.ora(), 'stato': 'aperto'})
            self.evento(m['tipo'], f"{chi} km {m['km']}")
        elif m['tipo'] == 'RIENTRATO':
            n['stato'] = 'ok'
            for a in self.allarmi:
                if a['pettorale'] == m['pettorale'] and a['tipo'] in ('FUORI', 'SBAGLIATO') and a['stato'] == 'aperto':
                    a['stato'] = 'rientrato'
            self.evento('RIENTRATO', f"{chi} km {m['km']}")

    def _conferma(self, pettorale, rif):
        k = (pettorale, rif); t = self.ora()
        if t - self.conferme.get(k, -1e9) < 5:
            return                      # già confermato da poco (arriva lo stesso SOS da più ripetitori)
        self.conferme[k] = t
        testo = P.conferma(pettorale, rif)
        if self.invia:
            self.invia(testo)
        self.evento('conferma', testo)

    def chiudi(self, id_allarme, nota=''):
        with self.lock:
            for a in self.allarmi:
                if a['id'] == id_allarme:
                    a['stato'] = 'preso in carico'; a['nota'] = nota
                    self.evento('preso in carico', f"allarme {id_allarme} {a['tipo']} pettorale {a['pettorale']:03d}", nota=nota)
                    return True
        return False

    def stato(self):
        with self.lock:
            t = self.ora()
            return {'ora': t, 'nodi': [dict(v, eta=round(t - v['tPos']) if v.get('tPos') else None) for v in self.nodi.values()],
                    'allarmi': self.allarmi, 'radio': dict(self.radio)}


# ---------- pagina web locale ----------
class Gestore(SimpleHTTPRequestHandler):
    sala = None
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path.startswith('/stato.json'):
            b = json.dumps(self.sala.stato(), ensure_ascii=False).encode()
            self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Cache-Control', 'no-store')
            self.end_headers(); self.wfile.write(b); return
        return super().do_GET()
    def do_POST(self):
        if self.path.startswith('/chiudi'):
            n = int(self.headers.get('Content-Length') or 0); d = json.loads(self.rfile.read(n) or b'{}')
            ok = self.sala.chiudi(int(d.get('id', 0)), d.get('nota', ''))
            self.send_response(200 if ok else 404); self.end_headers(); return
        self.send_response(404); self.end_headers()


def avvia_web(sala, porta):
    Gestore.sala = sala
    srv = ThreadingHTTPServer(('0.0.0.0', porta), partial(Gestore, directory=str(RADICE)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    print(f'Pagina della sala controllo: http://localhost:{porta}/orologio/sala/')
    return srv


# ---------- radio vera ----------
def collega(args, sala):
    """Tiene il collegamento con il nodo base: se cade (cavo, PC in sospensione) riprova da sola."""
    from pubsub import pub
    import meshtastic.serial_interface, meshtastic.tcp_interface, meshtastic.util
    attuale = {'iface': None}
    caduto = threading.Event()

    def nome_di(num):
        i = attuale['iface']
        u = ((i.nodesByNum if i else None) or {}).get(num, {}).get('user', {})
        return u.get('longName')

    def ricevuto(packet, interface):
        try:
            sala.ricevi(packet, nome_di(packet.get('from')))
        except Exception as e:          # un pacchetto strano non deve fermare la sala
            print('pacchetto non letto:', e, flush=True)

    def perso(interface=None, **altro):
        caduto.set()

    def invia(testo):
        i = attuale['iface']
        if i is None:
            print('  (non inviato, base scollegata):', testo, flush=True); return
        i.sendText(testo, hopLimit=3)

    def apri():
        if args.host:
            return meshtastic.tcp_interface.TCPInterface(args.host)
        if not args.porta:
            porte = meshtastic.util.findPorts(True)
            if not porte:
                raise RuntimeError('nessun nodo collegato via USB')
            if len(porte) > 1:
                raise RuntimeError(f'più apparecchi collegati ({", ".join(porte)}): lasciare solo la base')
        return meshtastic.serial_interface.SerialInterface(args.porta)

    def ciclo():
        ultima_nota = None
        while True:
            try:
                caduto.clear()
                i = apri()
                if getattr(i, 'nodesByNum', None) is None:
                    raise RuntimeError('il nodo non risponde')
                attuale['iface'] = i
                mio = (i.getMyUser() or {}).get('longName')
                ora = time.time(); visti = []
                for num, d in (i.nodesByNum or {}).items():
                    nome = d.get('user', {}).get('longName')
                    sala._nodo(num, nome)
                    if nome != mio:
                        lh = d.get('lastHeard')
                        visti.append(f"{nome or num} ({'mai' if not lh else str(round((ora - lh) / 60)) + ' min fa'}{', snr ' + str(d['snr']) if 'snr' in d else ''})")
                sala.radio.update(collegata=True, nota=f'base: {mio}')
                print(time.strftime('%H:%M:%S'), f'Collegato al nodo base «{mio}». In ascolto…', flush=True)
                print('  nodi già noti alla base:', '; '.join(visti) if visti else 'nessuno', flush=True)
                ultima_nota = None
                caduto.wait()
                print(time.strftime('%H:%M:%S'), 'Collegamento con la base caduto: riprovo.', flush=True)
            except (Exception, SystemExit) as e:
                nota = str(e) or type(e).__name__
                if nota != ultima_nota:
                    print(time.strftime('%H:%M:%S'), 'Base non collegata:', nota, flush=True); ultima_nota = nota
                sala.radio.update(nota=nota)
            sala.radio['collegata'] = False
            i = attuale['iface']; attuale['iface'] = None
            try:
                if i: i.close()
            except Exception:
                pass
            time.sleep(5)

    pub.subscribe(ricevuto, 'meshtastic.receive')
    pub.subscribe(perso, 'meshtastic.connection.lost')
    sala.invia = invia
    threading.Thread(target=ciclo, daemon=True).start()


# ---------- gara finta per provare la pagina ----------
def prova(sala, percorso, n=25, velocita=60):
    """Atleti finti che corrono a velocità diverse; uno esce dal percorso, uno chiede aiuto."""
    t0 = time.time(); rnd = random.Random(3)
    atleti = [{'num': 1000 + i, 'pett': i + 1, 'v': rnd.uniform(1.6, 3.4), 'prossima': rnd.uniform(0, 120)} for i in range(n)]
    sala.invia = lambda testo: print('  (radio) →', testo)
    for i, (nome, la, lo) in enumerate([('SRM rip. Passo Le Forche', 42.150075, 13.339187), ('SRM rip. Iaccio dei Montoni', 42.174, 13.341233),
                                        ('SRM rip. Cimata Fossa dei Cavalli', 42.148322, 13.401394), ('SRM rip. Sopra Rosciolo', 42.126061, 13.363953),
                                        ('SRM rip. Controllo passaggi', 42.110507, 13.381529)]):
        sala.ricevi({'from': 500 + i, 'decoded': {'portnum': 'POSITION_APP', 'position': {'latitude': la, 'longitude': lo}}}, nome)
        sala.ricevi({'from': 500 + i, 'decoded': {'portnum': 'TELEMETRY_APP', 'telemetry': {'deviceMetrics': {'batteryLevel': 100 - 7 * i}}}}, nome)
    def at(km):
        p = percorso.pts; km = max(0, min(percorso.km_tot, km))
        lo_, hi = 0, len(p) - 1
        while hi - lo_ > 1:
            m = (lo_ + hi) // 2
            if p[m][3] < km: lo_ = m
            else: hi = m
        a, b = p[lo_], p[hi]; f = (km - a[3]) / (b[3] - a[3]) if b[3] > a[3] else 0
        return a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])
    eventi = {7: 'FUORI', 12: 'SOS'}
    while True:
        ts = (time.time() - t0) * velocita
        for a in atleti:
            if ts < a['prossima']: continue
            a['prossima'] += 120 * rnd.uniform(0.95, 1.05)
            if rnd.random() < 0.12: continue          # pacchetto perso
            km = min(percorso.km_tot, ts * a['v'] / 1000)
            la, lo = at(km)
            sala.ricevi({'from': a['num'], 'decoded': {'portnum': 'POSITION_APP', 'position': {'latitude': la, 'longitude': lo}}}, f"SRM pettorale {a['pett']:03d}")
            ev = eventi.get(a['pett'])
            if ev and km > 3 and not a.get('fatto'):
                a['fatto'] = True
                if ev == 'SOS':
                    for _ in range(2):
                        sala.ricevi({'from': a['num'], 'decoded': {'portnum': 'TEXT_MESSAGE_APP', 'text': P.scrivi('SOS', a['pett'], 4821, km, la, lo)}}, f"SRM pettorale {a['pett']:03d}")
                else:
                    sala.ricevi({'from': a['num'], 'decoded': {'portnum': 'TEXT_MESSAGE_APP', 'text': P.scrivi('FUORI', a['pett'], None, km, la, lo)}}, f"SRM pettorale {a['pett']:03d}")
        time.sleep(0.5)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--porta', help='porta seriale del nodo base (es. COM5, /dev/ttyUSB0); se manca la cerca da sola')
    ap.add_argument('--host', help='indirizzo IP del nodo base, se collegato in WiFi')
    ap.add_argument('--web', type=int, default=8080, help='porta della pagina web (8080)')
    ap.add_argument('--prova', action='store_true', help='gara finta, senza radio')
    a = ap.parse_args()
    percorso = Percorso(); sala = Sala(percorso)
    avvia_web(sala, a.web)
    if a.prova:
        print('Modalità prova: atleti finti, il tempo scorre 60 volte più veloce.')
        prova(sala, percorso)
    else:
        collega(a, sala)
        try:
            while True: time.sleep(1)
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
