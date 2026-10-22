# Genera guida/bivi-srm2026.json (versione 2) unendo:
#  1. bivi del piano segnaletica (staff/data/segnali.json), km spostati sulla svolta reale
#  2. punti dove un sentiero CAI si stacca dalla traccia (diramazioni.json, da diramazioni.py)
#  3. svolte nette (svolte.json, da svolte.py): destra-sinistra ravvicinate, svolte su carrareccia, svolte strette;
#     i tornanti in serie diventano un solo avviso
#  4. inizio dei sentieri secondo la sequenza verificata da Ale (E1 · 3 · 3B · 3 · 1 · 7 · E1)
# Uso: python3 diramazioni.py && python3 svolte.py 60 && python3 genera_bivi.py
import json, re, os
D = os.path.dirname(os.path.abspath(__file__)); R = os.path.abspath(D + '/../..') + '/'
seg = json.load(open(R + 'staff/data/segnali.json'))['segnali']
rt = json.load(open(R + 'assets/explorer/assets/route.json'))
dir_ = json.load(open(D + '/diramazioni.json'))
svo = json.load(open(D + '/svolte.json'))
K = rt['total_km']
sentieri = rt['trails']; strade = rt['roads']
vicino = lambda a, b, m: abs(a - b) <= m

bivi = []
# 1. segnaletica
for s in seg:
    for f in s['frecce']:
        km = f['km']; an = f.get('analisi') or {}
        if an.get('esito') == 'spostare':
            m = re.search(r'al km (\d+),(\d+)', an['testo'])
            if m: km = float(m.group(1) + '.' + m.group(2))
        az = 'tieni-' + f['dir'] if an.get('esito') == 'dritto' else 'auto'
        bivi.append(dict(id=f['codice'], tipo='bivio', km=round(km, 3), azione=az, fonte='segnaletica', nota=an.get('testo', '')))
# 2. diramazioni CAI
n = 0
for g in dir_:
    lati = sorted({('dx' if r['lato'] > 20 else 'sx' if r['lato'] < -20 else None) for r in g['rami'] if abs(r['lato']) <= 150} - {None})
    esistente = next((b for b in bivi if vicino(b['km'], g['km'], 0.07)), None)
    if esistente:
        esistente['altri'] = sorted(set(esistente.get('altri', [])) | set(lati)); continue
    n += 1
    bivi.append(dict(id=f'O{n:02d}', tipo='bivio', km=g['km'], azione='auto', fonte='cai', altri=lati,
                     nota='Qui si stacca un sentiero segnato (OpenStreetMap, rete CAI).'))
# 3. svolte e tornanti
serie = []   # tornanti: svolte ampie (>=90) consecutive entro 250 m, almeno 3
giri_ampi = sorted([gg for o in svo for gg in o['giri'] if abs(gg['delta']) >= 90], key=lambda x: x['km'])
cur = []
for gg in giri_ampi:
    if cur and gg['km'] - cur[-1]['km'] > 0.25:
        if len(cur) >= 3: serie.append(cur)
        cur = []
    cur.append(gg)
if len(cur) >= 3: serie.append(cur)
in_serie = lambda km: any(s[0]['km'] - 0.02 <= km <= s[-1]['km'] + 0.02 for s in serie)
su_strada = lambda km: any(r['a'] - 0.03 <= km <= r['b'] + 0.03 for r in strade)
n = 0
for o in svo:
    km = o['km']; giri = [dict(km=g['km'], delta=g['delta']) for g in o['giri']]
    if in_serie(km): continue
    doppia = len(giri) == 2
    ampia = max(abs(g['delta']) for g in giri)
    if not (doppia or su_strada(km) or ampia >= 100): continue
    b = next((b for b in bivi if vicino(b['km'], km, 0.06)), None)
    if b:   # la svolta è sul bivio: la frase del bivio la descrive
        if doppia: b['giri'] = giri
        continue
    n += 1
    bivi.append(dict(id=f'V{n:02d}', tipo='svolta', km=round(km, 3), giri=giri, fonte='svolta',
                     nota='Svolta netta della traccia' + (' su carrareccia o strada.' if su_strada(km) else '.')))
for i, s in enumerate(serie, 1):
    bivi.append(dict(id=f'T{i:02d}', tipo='tornanti', km=round(s[0]['km'] - 0.03, 3), fino=round(s[-1]['km'], 3), fonte='tornanti',
                     nota=f"{len(s)} tornanti fino al km {s[-1]['km']:.2f}."))
# 4. inizio dei sentieri
for da, a, nome in sentieri[1:]:
    b = min((b for b in bivi if b['tipo'] == 'bivio'), key=lambda b: abs(b['km'] - da))
    if abs(b['km'] - da) <= 0.08: b['sentiero'] = nome
    else: bivi.append(dict(id=f'N-{nome}-{da:g}', tipo='sentiero', km=da, sentiero=nome, fonte='sentiero',
                           nota=f'Inizio del sentiero {nome} (sequenza verificata).'))
bivi.sort(key=lambda b: b['km'])
json.dump(dict(traccia='srm2026', versione=2,
               origine='Piano segnaletica SRM 2026 + diramazioni CAI (OpenStreetMap) + svolte nette della traccia + inizio sentieri',
               bivi=bivi), open(R + 'guida/bivi-srm2026.json', 'w'), ensure_ascii=False, indent=1)
from collections import Counter
print(Counter(b['tipo'] for b in bivi), len(bivi))
for b in bivi: print(f"{b['km']:6.2f} {b['id']:9} {b['tipo']:9} {b.get('azione','')} {b.get('sentiero','')} altri={b.get('altri','')} giri={[('dx' if g['delta']>0 else 'sx', abs(g['delta'])) for g in b.get('giri',[])]} {b.get('fino','')}")
