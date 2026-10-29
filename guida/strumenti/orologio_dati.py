# Dati per il simulatore dell'orologio (guida/orologio):
#  - dem.bin/json: quote del terreno su griglia lat/lon (da dem_ext dell'Explorer, georeferenziato con comune.py)
#  - rete.json: nodi fissi proposti (base e ripetitori) e tempi reali degli atleti 2026
import json, math
import numpy as np
exec(open('/home/claude/skyracedelmaglio/guida/strumenti/comune.py').read())

OUT = R + 'guida/orologio/'
A = R + 'assets/explorer/assets/'
j = json.load(open(A + 'dem_ext.json'))
g = np.fromfile(A + 'dem_ext.bin', dtype=np.uint16).reshape(j['ny'], j['nx']).astype(float) * j['scala'] + j['off']
# quota vera = quota scena * 0,8925 + 727,8 (regressione sulla quota della traccia, scarto max 21 m)
QA, QB = 0.8925385538571367, 727.8104284605599

# inversa dell'affine scena -> lat/lon
M = np.array(cl)            # 3x2: [x,y,1] @ M = [lat,lon]
L = M[:2, :]; c0 = M[2, :]
Linv = np.linalg.inv(L)
def ll2scena(lat, lon):
    v = (np.stack([lat, lon], -1) - c0) @ Linv
    return v[..., 0], v[..., 1]

def campiona(x, y):
    u = (x - j['x0']) / (j['x1'] - j['x0']) * (j['nx'] - 1)
    v = (y - j['y0']) / (j['y1'] - j['y0']) * (j['ny'] - 1)
    u = np.clip(u, 0, j['nx'] - 1.001); v = np.clip(v, 0, j['ny'] - 1.001)
    i = np.floor(u).astype(int); k = np.floor(v).astype(int); fu = u - i; fv = v - k
    return (g[k, i] * (1 - fu) * (1 - fv) + g[k, i + 1] * fu * (1 - fv) + g[k + 1, i] * (1 - fu) * fv + g[k + 1, i + 1] * fu * fv)

lats = np.array([p[0] for p in P]); lons = np.array([p[1] for p in P])
la0, la1 = lats.min() - 0.045, lats.max() + 0.045
lo0, lo1 = lons.min() - 0.06, lons.max() + 0.06
dla, dlo = 0.00045, 0.0006          # ~50 m
ny = int(round((la1 - la0) / dla)) + 1; nx = int(round((lo1 - lo0) / dlo)) + 1
LA, LO = np.meshgrid(la0 + np.arange(ny) * dla, lo0 + np.arange(nx) * dlo, indexing='ij')
X, Y = ll2scena(LA, LO)
H = campiona(X, Y) * QA + QB
H = np.clip(np.round(H), 0, 3000).astype(np.int16)   # riga 0 = sud
H.tofile(OUT + 'dem.bin')
json.dump({'lat0': la0, 'lon0': lo0, 'dlat': dla, 'dlon': dlo, 'ny': ny, 'nx': nx, 'file': 'dem.bin',
           'fonte': 'AWS Terrain Tiles (SRTM/Copernicus) z12 via Explorer, ricampionato ~50 m'}, open(OUT + 'dem.json', 'w'))
print('dem', ny, nx, H.min(), H.max(), round(ny * nx * 2 / 1024), 'KB')

def quota(lat, lon):
    x, y = ll2scena(np.array(lat), np.array(lon)); return float(campiona(x, y) * QA + QB)

rt = json.load(open(A + 'route.json'))
pk = {p['n']: scena2ll(p['x'], p['y']) for p in rt['peaks']}
def vetta(nome):
    la, lo = pk[nome]
    # la cima vera: massimo del DEM entro ~150 m
    best = (quota(la, lo), la, lo)
    for a in np.linspace(-0.0015, 0.0015, 13):
        for b in np.linspace(-0.002, 0.002, 13):
            q = quota(la + a, lo + b)
            if q > best[0]: best = (q, la + a, lo + b)
    return best[1], best[2]

def sulPercorso(km):
    la, lo, _ = at(km); return la, lo

# gruppi: 'proposta' = 5 punti scelti dalla ricerca automatica (copertura buona su tutto il percorso, al massimo 2 salti),
#         'cime' = l'idea iniziale (Sevice, Velino, Cafornia, Le Forche)
nodi = [
    {'id': 'base', 'nome': "Base gara · Magliano", 'ruolo': 'BASE', 'pos': sulPercorso(0.0), 'h': 8, 'gruppi': ['proposta', 'cime'],
     'nota': 'antenna sul tetto della segreteria, collegata al PC della sala controllo'},
    {'id': 'sevice', 'nome': 'Capanna di Sevice · km 14,7', 'ruolo': 'ROUTER', 'pos': sulPercorso(14.71), 'h': 4, 'gruppi': ['cime'],
     'nota': 'rifugio, ristoro e cancello orario'},
    {'id': 'forche', 'nome': 'Passo Le Forche · km 10', 'ruolo': 'ROUTER', 'pos': sulPercorso(10.0), 'h': 3, 'gruppi': ['proposta', 'cime'],
     'nota': 'cancello orario e squadra di primo soccorso'},
    {'id': 'controllo', 'nome': 'Controllo passaggi · km 27', 'ruolo': 'ROUTER', 'pos': sulPercorso(27.0), 'h': 3, 'gruppi': ['proposta'],
     'nota': "postazione dell'organizzazione"},
    {'id': 'fossa', 'nome': 'Cimata Fossa dei Cavalli · km 19', 'ruolo': 'ROUTER', 'pos': sulPercorso(19.0), 'h': 2, 'gruppi': ['proposta'],
     'nota': 'sul percorso, cresta verso il Cafornia'},
    {'id': 'rosciolo', 'nome': 'Sopra Rosciolo · km 5,3', 'ruolo': 'ROUTER', 'pos': sulPercorso(5.25), 'h': 3, 'gruppi': ['proposta'],
     'nota': 'sul percorso, prima della discesa del brecciato'},
    {'id': 'velino', 'nome': 'Monte Velino (vetta)', 'ruolo': 'ROUTER', 'pos': vetta('Monte Velino'), 'h': 2, 'gruppi': ['cime']},
    {'id': 'cafornia', 'nome': 'Monte Cafornia (vetta)', 'ruolo': 'ROUTER', 'pos': vetta('Monte Cafornia'), 'h': 2, 'gruppi': ['cime']},
    {'id': 'iaccio', 'nome': 'Iaccio dei Montoni (vetta)', 'ruolo': 'ROUTER', 'pos': vetta('Iaccio dei Montoni'), 'h': 2, 'gruppi': ['proposta'],
     'nota': 'fuori percorso: vede la base e copre dal km 10,5 al 16; ponte per la Fossa dei Cavalli'},
    {'id': 'porclaneta', 'nome': 'S. Maria in Valle Porclaneta · km 8,2', 'ruolo': 'ROUTER', 'pos': sulPercorso(8.2), 'h': 3, 'gruppi': []},
]
for n in nodi: n['attivo'] = 'proposta' in n['gruppi']
for n in nodi:
    n['pos'] = [round(n['pos'][0], 6), round(n['pos'][1], 6)]
    n['quota'] = round(quota(*n['pos']))
    print(n['id'], n['pos'], n['quota'])

c = json.load(open(R + 'classifica/classifica-2026.json'))
atleti = [{'b': a['b'], 't': a['t']} for a in c['atleti'] if not a.get('scopa')]
json.dump({'nodi': nodi, 'atleti': atleti, 'partenza': c['partenza'], 'iscritti': c['iscritti']},
          open(OUT + 'rete.json', 'w'), ensure_ascii=False, indent=1)
print('atleti', len(atleti), 'senza tempo', sum(1 for a in atleti if not a['t']))
