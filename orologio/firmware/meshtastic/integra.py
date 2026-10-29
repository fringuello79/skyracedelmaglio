#!/usr/bin/env python3
"""Inserisce la Guida SRM nel firmware Meshtastic e prepara l'ambiente di compilazione «t-watch-ultra-srm».

    python3 integra.py /percorso/firmware-meshtastic        (cartella già clonata con i sottomoduli)
    python3 integra.py --clona fw                            (clona Meshtastic alla versione provata, poi integra)

Poi:  cd fw && pio run -e t-watch-ultra-srm               (compila)
      cd fw && pio run -e t-watch-ultra-srm -t upload      (carica sull'orologio collegato via USB)
"""
import argparse, re, shutil, subprocess, sys
from pathlib import Path

QUI = Path(__file__).resolve().parent
SRM = QUI.parent / 'srm'
VERSIONE = '332b5b0a2c4fec2896de3c5fa63f46d5cd05ea98'   # commit di meshtastic/firmware su cui è stato scritto e provato il modulo (28/10/2026)


def sostituisci(file, ancora, nuovo, una_volta_segno):
    t = file.read_text()
    if una_volta_segno in t:
        return False
    if ancora not in t:
        sys.exit(f'Ancora non trovata in {file}: {ancora[:60]!r} (Meshtastic è cambiato: aggiornare integra.py)')
    file.write_text(t.replace(ancora, nuovo, 1))
    return True


def integra(fw):
    fw = Path(fw)
    dest = fw / 'srm_guida'
    dest.mkdir(exist_ok=True)
    for f in ['srm_guida.h', 'srm_guida.cpp', 'srm_app.h', 'srm_app.cpp', 'srm_tela.h', 'srm_dati.h', 'srm_dati.cpp']:
        shutil.copy(SRM / f, dest / f)
    for f in (QUI / 'srm_guida').iterdir():
        shutil.copy(f, dest / f.name)
    # registrazione del modulo: prima di TextMessageModule, così i messaggi «SRM …» non diventano notifiche
    m = fw / 'src/modules/Modules.cpp'
    sostituisci(m, '#include "modules/TextMessageModule.h"',
                '#include "modules/TextMessageModule.h"\n#ifdef SRM_GUIDA\n#include "SrmGuidaModule.h"\n#endif', 'SrmGuidaModule.h')
    sostituisci(m, '    textMessageModule = new TextMessageModule();',
                '#ifdef SRM_GUIDA\n    srmGuidaModule = new SrmGuidaModule();\n#endif\n    textMessageModule = new TextMessageModule();',
                'new SrmGuidaModule()')
    # corona tenuta premuta (PMU AXP2101): SOS anche a schermo spento; spegnimento solo dopo 10 s
    p = fw / 'src/Power.cpp'
    sostituisci(p, 'XPowersLibInterface *PMU = NULL;',
                'XPowersLibInterface *PMU = NULL;\n#ifdef SRM_GUIDA\nvoid srmCoronaLunga();\n#endif', 'void srmCoronaLunga();')
    sostituisci(p, '        pmuIrqMask = XPOWERS_AXP2101_VBUS_INSERT_IRQ | XPOWERS_AXP2101_VBUS_REMOVE_IRQ | XPOWERS_AXP2101_PKEY_SHORT_IRQ;',
                '        pmuIrqMask = XPOWERS_AXP2101_VBUS_INSERT_IRQ | XPOWERS_AXP2101_VBUS_REMOVE_IRQ | XPOWERS_AXP2101_PKEY_SHORT_IRQ;\n'
                '#ifdef SRM_GUIDA\n        pmuIrqMask |= XPOWERS_AXP2101_PKEY_LONG_IRQ;\n'
                '        static_cast<XPowersAXP2101 *>(PMU)->setIrqLevelTime(XPOWERS_AXP2101_IRQ_TIME_2S);\n'
                '        PMU->setPowerKeyPressOffTime(XPOWERS_POWEROFF_10S);\n#endif', 'XPOWERS_AXP2101_PKEY_LONG_IRQ;')
    sostituisci(p, '#ifdef PMU_POWER_BUTTON_IS_CANCEL\n        // cancel action also turns the screen on and off.',
                '#ifdef SRM_GUIDA\n        if (PMU->isPekeyLongPressIrq())\n            srmCoronaLunga();\n#endif\n'
                '#ifdef PMU_POWER_BUTTON_IS_CANCEL\n        // cancel action also turns the screen on and off.', 'srmCoronaLunga();\n#endif\n#ifdef PMU_POWER_BUTTON_IS_CANCEL')
    # ambiente di compilazione
    v = fw / 'variants/esp32s3/t-watch-ultra/platformio.ini'
    if '[env:t-watch-ultra-srm]' not in v.read_text():
        v.write_text(v.read_text() + '''
; Skyrace del Maglio: guida sul percorso, SOS e avvisi alla base (orologio/firmware nel sito SRM)
[env:t-watch-ultra-srm]
board_level = extra
extends = env:t-watch-ultra
build_flags = ${env:t-watch-ultra.build_flags} -D SRM_GUIDA -Isrm_guida
build_src_filter = ${env:t-watch-ultra.build_src_filter} +<../srm_guida/>
''')
    print('Guida SRM integrata in', fw)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('cartella', nargs='?', default='fw')
    ap.add_argument('--clona', action='store_true', help='clona meshtastic/firmware alla versione provata')
    a = ap.parse_args()
    if a.clona and not Path(a.cartella).exists():
        subprocess.run(['git', 'clone', '--recurse-submodules', 'https://github.com/meshtastic/firmware.git', a.cartella], check=True)
        subprocess.run(['git', '-C', a.cartella, 'checkout', VERSIONE], check=True)
        subprocess.run(['git', '-C', a.cartella, 'submodule', 'update', '--init', '--recursive'], check=True)
    integra(a.cartella)


if __name__ == '__main__':
    main()
