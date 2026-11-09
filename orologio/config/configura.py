"""Configura un orologio SRM collegato via USB e verifica che la configurazione sia rimasta.

Uso: python configura.py privato/orologio-001.yaml

Differenza da «meshtastic --configure»: tiene aperta la porta finché l'orologio ha salvato e si è riavviato
(su Windows, chiudere subito la porta può far perdere le modifiche), poi si ricollega e controlla.
Se la verifica fallisce riprova scrivendo una sezione alla volta. Non stampa mai la chiave del canale.
"""
import logging, sys, time
from pathlib import Path

import yaml
import meshtastic.serial_interface
from meshtastic.__main__ import _profile_from_yaml
from meshtastic.protobuf import config_pb2

logging.basicConfig(filename=str(Path(__file__).with_name('registro-dettagli.txt')), level=logging.DEBUG,
                    format='%(asctime)s %(levelname)s %(name)s %(message)s')


def connetti(tentativi=20):
    for t in range(tentativi):
        try:
            i = meshtastic.serial_interface.SerialInterface(timeout=60)
            if i.localNode is not None and i.localNode.localConfig is not None:
                return i
            i.close()
        except SystemExit as e:
            print('  (porta:', e, ')')
        except Exception as e:
            print('  attendo l\'orologio...', type(e).__name__, e)
        time.sleep(3)
    sys.exit('ERRORE: non riesco a collegarmi all\'orologio')


def chiudi(i):
    try:
        i.close()
    except Exception:
        pass


def stato(i):
    n = i.localNode
    lc = n.localConfig
    u = i.getMyUser() or {}
    ch0 = n.channels[0].settings if n.channels else None
    return {
        'nome': u.get('longName'),
        'regione': config_pb2.Config.LoRaConfig.RegionCode.Name(lc.lora.region),
        'preset': config_pb2.Config.LoRaConfig.ModemPreset.Name(lc.lora.modem_preset),
        'ruolo': config_pb2.Config.DeviceConfig.Role.Name(lc.device.role),
        'canale': ch0.name if ch0 else None,
        'gps_ogni': lc.position.position_broadcast_secs,
    }


def atteso(p):
    c = p.config
    return {
        'nome': p.long_name,
        'regione': config_pb2.Config.LoRaConfig.RegionCode.Name(c.lora.region),
        'preset': config_pb2.Config.LoRaConfig.ModemPreset.Name(c.lora.modem_preset),
        'ruolo': config_pb2.Config.DeviceConfig.Role.Name(c.device.role),
        'canale': 'SRM',
        'gps_ogni': c.position.position_broadcast_secs,
    }


def stampa(titolo, s):
    print(f'  {titolo}: ' + ', '.join(f'{k}={v}' for k, v in s.items()))


def sezioni(p):
    out = []
    for f in p.config.DESCRIPTOR.fields:
        if f.message_type is not None and p.config.HasField(f.name):
            out.append(('config', f.name))
    for f in p.module_config.DESCRIPTOR.fields:
        if f.message_type is not None and p.module_config.HasField(f.name):
            out.append(('module', f.name))
    return out


def copia(n, p, tipo, nome):
    dst = n.localConfig if tipo == 'config' else n.moduleConfig
    src = p.config if tipo == 'config' else p.module_config
    getattr(dst, nome).CopyFrom(getattr(src, nome))
    n.writeConfig(nome)


def tutto_insieme(p):
    i = connetti(); n = i.localNode
    n.beginSettingsTransaction(); time.sleep(1)
    n.setOwner(long_name=p.long_name, short_name=p.short_name); time.sleep(1)
    n.setURL(p.channel_url); time.sleep(1)
    for tipo, nome in sezioni(p):
        copia(n, p, tipo, nome); time.sleep(1)
    n.commitSettingsTransaction()
    print('  inviato; attendo che l\'orologio salvi e si riavvii (30 s)...')
    time.sleep(30)
    chiudi(i)


def una_alla_volta(p):
    passi = [('owner', None), ('url', None)] + sezioni(p)
    for tipo, nome in passi:
        i = connetti(); n = i.localNode
        if tipo == 'owner':
            n.setOwner(long_name=p.long_name, short_name=p.short_name); etichetta = 'nome'
        elif tipo == 'url':
            n.setURL(p.channel_url); etichetta = 'canale'
        else:
            copia(n, p, tipo, nome); etichetta = nome
        print(f'  scritto {etichetta}; attendo 15 s')
        time.sleep(15)
        chiudi(i)
        time.sleep(5)


def main():
    f = Path(sys.argv[1] if len(sys.argv) > 1 else 'privato/orologio-001.yaml')
    p = _profile_from_yaml(yaml.safe_load(f.read_text(encoding='utf-8')))
    voluto = atteso(p)
    print('Profilo:', f.name)
    i = connetti()
    stampa('prima', stato(i))
    chiudi(i)
    time.sleep(3)

    for nome, metodo in (('tutto insieme', tutto_insieme), ('una sezione alla volta', una_alla_volta)):
        print(f'\nScrivo la configurazione ({nome})...')
        metodo(p)
        time.sleep(5)
        i = connetti()
        ora = stato(i)
        chiudi(i)
        stampa('dopo', ora)
        diversi = [k for k in voluto if ora.get(k) != voluto[k]]
        if not diversi:
            print('\nVERIFICA OK: la configurazione e\' sull\'orologio.')
            return 0
        print('  non ancora uguale:', ', '.join(f'{k} ({ora.get(k)} invece di {voluto[k]})' for k in diversi))
    print('\nVERIFICA FALLITA')
    return 2


if __name__ == '__main__':
    sys.exit(main())
