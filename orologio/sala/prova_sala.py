#!/usr/bin/env python3
"""Prove della sala controllo senza radio: python3 prova_sala.py"""
import sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import protocollo as P
import sala as S

S.DATI = Path(tempfile.mkdtemp())

def test_protocollo():
    t = P.scrivi('SOS', 57, 4821, 12.43, 42.151234, 13.382111)
    assert t == 'SRM SOS P057 R4821 km12.4 42.15123,13.38211', t
    m = P.leggi(t)
    assert m == {'tipo': 'SOS', 'pettorale': 57, 'rif': 4821, 'km': 12.4, 'lat': 42.15123, 'lon': 13.38211}, m
    assert P.leggi('SRM RIENTRATO P057 km1.2')['km'] == 1.2
    assert P.leggi('SRM OK P057 R4821') == {'tipo': 'OK', 'pettorale': 57, 'rif': 4821, 'km': None, 'lat': None, 'lon': None}
    assert P.leggi('ciao a tutti') is None
    assert P.leggi('SRM SOS P057 R4821 km12.4 42.15123,13.38211 extra') is None

def test_sala():
    inviati = []; ora = [1000.0]
    s = S.Sala(S.Percorso(), invia=inviati.append, orologio=lambda: ora[0])
    nome = 'SRM pettorale 057'
    s.ricevi({'from': 7, 'decoded': {'portnum': 'POSITION_APP', 'position': {'latitude': 42.150075, 'longitude': 13.339187}}}, nome)
    n = s.nodi[7]
    assert n['tipo'] == 'atleta' and n['pettorale'] == 57 and abs(n['km'] - 10.0) < 0.1, n
    sos = {'from': 7, 'decoded': {'portnum': 'TEXT_MESSAGE_APP', 'text': P.scrivi('SOS', 57, 4821, 10.0, 42.150075, 13.339187)}}
    s.ricevi(sos, nome); s.ricevi(sos, nome)                 # lo stesso SOS ripetuto da due ripetitori
    assert inviati == ['SRM OK P057 R4821'], inviati            # una sola conferma entro 5 s
    ora[0] += 11; s.ricevi(sos, nome)                           # l'orologio non ha sentito: ripete, si riconferma
    assert len(inviati) == 2
    st = s.stato(); a = st['allarmi'][0]
    assert a['tipo'] == 'SOS' and a['invii'] == 3 and a['stato'] == 'aperto'
    assert s.chiudi(a['id'], 'squadra Le Forche') and s.allarmi[0]['stato'] == 'preso in carico'
    s.ricevi({'from': 7, 'decoded': {'portnum': 'TEXT_MESSAGE_APP', 'text': 'SRM FUORI P057 km12.0 42.15,13.34'}}, nome)
    assert s.nodi[7]['stato'] == 'fuori percorso'
    s.ricevi({'from': 7, 'decoded': {'portnum': 'TEXT_MESSAGE_APP', 'text': 'SRM RIENTRATO P057 km12.1'}}, nome)
    assert s.nodi[7]['stato'] == 'ok' and s.allarmi[-1]['stato'] == 'rientrato'
    s.ricevi({'from': 9, 'decoded': {'portnum': 'TELEMETRY_APP', 'telemetry': {'deviceMetrics': {'batteryLevel': 77}}}}, 'SRM rip. Passo Le Forche')
    assert s.nodi[9]['tipo'] == 'ripetitore' and s.nodi[9]['batteria'] == 77
    s.ricevi({'from': 9, 'decoded': {'portnum': 'TEXT_MESSAGE_APP', 'text': 'SRM OK P057 R4821'}}, 'SRM rip. Passo Le Forche')
    assert len(inviati) == 2                                    # le conferme ripetute non generano nulla

if __name__ == '__main__':
    test_protocollo(); test_sala(); print('prove superate')
