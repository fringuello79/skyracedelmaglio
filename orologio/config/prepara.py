#!/usr/bin/env python3
"""Prepara i profili Meshtastic della rete SRM: orologi, ripetitori, base.

Uso (dalla cartella orologio/config):
    pip install meshtastic
    python3 prepara.py                 # crea il canale (solo la prima volta) e scrive i profili in privato/
    python3 prepara.py --orologi 1-5   # anche i profili degli orologi con pettorale 1..5

Poi, con l'apparecchio collegato via USB:
    meshtastic --configure privato/ripetitore-forche.yaml

La cartella privato/ contiene la chiave del canale: NON va pubblicata (è esclusa da git).
"""
import argparse, base64, json, os, secrets, sys
from pathlib import Path

QUI = Path(__file__).resolve().parent
PRIVATO = QUI / 'privato'
RETE = QUI.parent.parent / 'guida' / 'orologio' / 'rete.json'

# --- scelte della rete (dalla simulazione: guida/orologio) ---
REGIONE = 'EU_868'           # 869,4-869,65 MHz, 10% di tempo di trasmissione, max 27 dBm
PRESET = 'SHORT_FAST'        # con 146 atleti LongFast e MediumFast saturano il canale
NOME_CANALE = 'SRM'
TZ = 'CET-1CEST,M3.5.0,M10.5.0/3'


def canale():
    """Chiave e PIN generati una volta sola e tenuti in privato/canale.json."""
    PRIVATO.mkdir(exist_ok=True)
    f = PRIVATO / 'canale.json'
    if f.exists():
        return json.loads(f.read_text())
    c = {'nome': NOME_CANALE, 'psk': base64.b64encode(secrets.token_bytes(32)).decode(),
         'pin_ripetitori': 100000 + secrets.randbelow(900000)}
    f.write_text(json.dumps(c, indent=1))
    (PRIVATO / 'LEGGIMI.txt').write_text('Chiave del canale SRM e PIN Bluetooth dei ripetitori. Non pubblicare, non mettere su git.\n')
    print('Creato un canale nuovo:', f)
    return c


def link_canale(c, hop=2):
    """Link Meshtastic del canale (come quello del QR nell'app): canale + impostazioni radio."""
    from meshtastic.protobuf import apponly_pb2, config_pb2
    cs = apponly_pb2.ChannelSet()
    s = cs.settings.add()
    s.name = c['nome']
    s.psk = base64.b64decode(c['psk'])
    s.module_settings.position_precision = 32          # posizione piena: serve alla sala controllo
    L = cs.lora_config
    L.use_preset = True
    L.modem_preset = config_pb2.Config.LoRaConfig.ModemPreset.Value(PRESET)
    L.region = config_pb2.Config.LoRaConfig.RegionCode.Value(REGIONE)
    L.hop_limit = hop
    L.tx_enabled = True
    b = base64.urlsafe_b64encode(cs.SerializeToString()).decode().replace('=', '')
    return f'https://meshtastic.org/e/#{b}'


def lora(hop, potenza):
    return {'region': REGIONE, 'use_preset': True, 'modem_preset': PRESET, 'hop_limit': hop, 'tx_enabled': True,
            'tx_power': potenza, 'sx126x_rx_boosted_gain': True, 'config_ok_to_mqtt': False, 'ignore_mqtt': True}


def yaml_testo(intestazione, d):
    import yaml
    return '# ' + '\n# '.join(intestazione) + '\n# start of Meshtastic configure yaml\n' + yaml.safe_dump(d, sort_keys=False, allow_unicode=True)


def orologio(c, pettorale):
    """Orologio dell'atleta (T-Watch Ultra): trasmette, non ripete."""
    return yaml_testo([f'Orologio SRM, pettorale {pettorale}'], {
        'owner': f'SRM pettorale {pettorale:03d}', 'owner_short': f'{pettorale:03d}'[-4:] if pettorale < 1000 else str(pettorale)[-4:],
        'channel_url': link_canale(c, 2),
        'config': {
            'device': {'role': 'CLIENT_MUTE', 'node_info_broadcast_secs': 10800, 'tzdef': TZ},
            'lora': lora(2, 22),
            # GPS sempre acceso (aggiornamento <= 10 s): la guida sul percorso ne ha bisogno ogni secondo
            'position': {'gps_mode': 'ENABLED', 'gps_update_interval': 1, 'position_broadcast_secs': 120,
                         'position_broadcast_smart_enabled': False, 'fixed_position': False},
            'bluetooth': {'enabled': False},
            'display': {'screen_on_secs': 10, 'wake_on_tap_or_motion': False},
            'power': {'is_power_saving': False},
        },
        'module_config': {
            'telemetry': {'device_telemetry_enabled': False, 'device_update_interval': 0},
            'neighbor_info': {'enabled': False},
        },
    })


def ripetitore(c, n):
    """Ripetitore fisso (Heltec V4): ripete sempre, solo i pacchetti del canale SRM; manda la batteria alla base."""
    corto = {'forche': 'RFOR', 'controllo': 'RK27', 'fossa': 'RFOS', 'rosciolo': 'RROS', 'iaccio': 'RIAC',
             'sevice': 'RSEV', 'velino': 'RVEL', 'cafornia': 'RCAF', 'porclaneta': 'RPOR'}.get(n['id'], 'R' + n['id'][:3].upper())
    return yaml_testo([f"Ripetitore SRM: {n['nome']} ({n['quota']} m)", n.get('nota', '')], {
        'owner': f"SRM rip. {n['nome'].split(' · ')[0]}"[:39], 'owner_short': corto,
        'channel_url': link_canale(c, 3),
        'location': {'lat': n['pos'][0], 'lon': n['pos'][1], 'alt': n['quota']},
        'config': {
            'device': {'role': 'ROUTER', 'rebroadcast_mode': 'LOCAL_ONLY', 'node_info_broadcast_secs': 10800, 'tzdef': TZ},
            'lora': lora(3, 27),
            'position': {'gps_mode': 'DISABLED', 'fixed_position': True, 'position_broadcast_secs': 3600,
                         'position_broadcast_smart_enabled': False},
            'bluetooth': {'enabled': True, 'mode': 'FIXED_PIN', 'fixed_pin': c['pin_ripetitori']},
            'display': {'screen_on_secs': 30},
            'power': {'is_power_saving': False, 'on_battery_shutdown_after_secs': 0},
        },
        'module_config': {
            'telemetry': {'device_telemetry_enabled': True, 'device_update_interval': 900},
        },
    })


def base(c, n):
    """Nodo della base: collegato via USB al PC della sala controllo; non ripete, conferma gli SOS."""
    return yaml_testo([f"Base SRM: {n['nome']}", 'Collegare via USB al PC e avviare orologio/sala/sala.py'], {
        'owner': 'SRM base gara', 'owner_short': 'BASE',
        'channel_url': link_canale(c, 3),
        'location': {'lat': n['pos'][0], 'lon': n['pos'][1], 'alt': n['quota']},
        'config': {
            'device': {'role': 'CLIENT_MUTE', 'serial_enabled': True, 'node_info_broadcast_secs': 10800, 'tzdef': TZ},
            'lora': lora(3, 27),
            'position': {'gps_mode': 'DISABLED', 'fixed_position': True, 'position_broadcast_secs': 3600,
                         'position_broadcast_smart_enabled': False},
            'bluetooth': {'enabled': False},
        },
        'module_config': {
            'telemetry': {'device_telemetry_enabled': False, 'device_update_interval': 0},
        },
    })


def intervallo(s):
    if '-' in s:
        a, b = s.split('-'); return list(range(int(a), int(b) + 1))
    return [int(x) for x in s.split(',') if x]


def verifica(percorso):
    """Rilegge il file con la stessa funzione che usa «meshtastic --configure»."""
    import yaml
    from meshtastic.__main__ import _profile_from_yaml
    p = _profile_from_yaml(yaml.safe_load(Path(percorso).read_text()))
    assert p.channel_url.startswith('https://meshtastic.org/e/#')
    return p


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--orologi', default='', help='pettorali, es. 1-5 oppure 7,12,57')
    a = ap.parse_args()
    c = canale()
    rete = json.loads(RETE.read_text())
    scritti = []
    for n in rete['nodi']:
        nome = 'base.yaml' if n['ruolo'] == 'BASE' else f"ripetitore-{n['id']}.yaml"
        testo = base(c, n) if n['ruolo'] == 'BASE' else ripetitore(c, n)
        (PRIVATO / nome).write_text(testo); scritti.append(nome)
    for b in intervallo(a.orologi):
        nome = f'orologio-{b:03d}.yaml'; (PRIVATO / nome).write_text(orologio(c, b)); scritti.append(nome)
    (PRIVATO / 'link-canale.txt').write_text(link_canale(c, 3) + '\n')
    for s in scritti:
        p = verifica(PRIVATO / s)
        print(f'ok  {s:32s} {p.long_name} [{p.short_name}] ruolo {p.config.device.role}')
    print('\nLink del canale (per l\'app Meshtastic):', PRIVATO / 'link-canale.txt')


if __name__ == '__main__':
    main()
