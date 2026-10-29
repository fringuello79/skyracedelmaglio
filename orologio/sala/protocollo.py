"""Messaggi di testo SRM sul canale Meshtastic (gli stessi che scrive e legge il firmware dell'orologio).

Sono messaggi di testo normali: si leggono anche con l'app Meshtastic, senza programmi nostri.

    dall'orologio:   SRM SOS P057 R4821 km12.4 42.15123,13.38211
                     SRM FUORI P057 km12.4 42.15123,13.38211
                     SRM SBAGLIATO P057 km1.1 42.10123,13.36211
                     SRM RIENTRATO P057 km1.2
                     SRM ANNULLA P057 R4821          (l'atleta ha annullato l'SOS dopo l'invio)
    dalla base:      SRM OK P057 R4821                (SOS ricevuto: l'orologio smette di ripetere)

P = pettorale (3 cifre o più), R = codice della richiesta (lo sceglie l'orologio), km con il punto.
"""
import re

TIPI = ('SOS', 'FUORI', 'SBAGLIATO', 'RIENTRATO', 'ANNULLA', 'OK')
_RE = re.compile(r'^SRM (SOS|FUORI|SBAGLIATO|RIENTRATO|ANNULLA|OK) P(\d{1,5})'
                 r'(?: R(\d{1,6}))?(?: km(\d{1,2}(?:\.\d{1,2})?))?(?: (-?\d{1,2}\.\d{1,7}),(-?\d{1,3}\.\d{1,7}))?\s*$')


def leggi(testo):
    """Restituisce un dizionario {tipo, pettorale, rif, km, lat, lon} oppure None se non è un messaggio SRM."""
    m = _RE.match((testo or '').strip())
    if not m:
        return None
    tipo, p, r, km, la, lo = m.groups()
    return {'tipo': tipo, 'pettorale': int(p), 'rif': int(r) if r else None, 'km': float(km) if km else None,
            'lat': float(la) if la else None, 'lon': float(lo) if lo else None}


def scrivi(tipo, pettorale, rif=None, km=None, lat=None, lon=None):
    assert tipo in TIPI
    s = f'SRM {tipo} P{pettorale:03d}'
    if rif is not None:
        s += f' R{rif}'
    if km is not None:
        s += f' km{km:.1f}'
    if lat is not None and lon is not None:
        s += f' {lat:.5f},{lon:.5f}'
    return s


def conferma(pettorale, rif):
    return scrivi('OK', pettorale, rif)
