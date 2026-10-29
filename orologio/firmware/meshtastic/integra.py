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
    # dentro src/, così PlatformIO trova le librerie; i .cpp compilano solo con SRM_GUIDA (gli altri apparecchi non cambiano)
    dest = fw / 'src/modules/srm'
    dest.mkdir(parents=True, exist_ok=True)
    sorgenti = [SRM / f for f in ['srm_guida.h', 'srm_guida.cpp', 'srm_app.h', 'srm_app.cpp', 'srm_tela.h', 'srm_dati.h', 'srm_dati.cpp',
                                'srm_voce.h', 'srm_voce.cpp']]
    sorgenti += sorted((QUI / 'srm_guida').iterdir())
    for f in sorgenti:
        testo = f.read_text()
        if f.suffix == '.cpp' and not testo.lstrip().startswith('#include "SrmGuidaModule.h"'):
            testo = '#ifdef SRM_GUIDA\n' + testo + '\n#endif // SRM_GUIDA\n'
        (dest / f.name).write_text(testo)
    # registrazione del modulo: prima di TextMessageModule, così i messaggi «SRM …» non diventano notifiche
    m = fw / 'src/modules/Modules.cpp'
    sostituisci(m, '#include "modules/TextMessageModule.h"',
                '#include "modules/TextMessageModule.h"\n#ifdef SRM_GUIDA\n#include "modules/srm/SrmGuidaModule.h"\n#endif', 'SrmGuidaModule.h')
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
    # voce registrata: AudioThread impara a suonare un WAV in memoria (stesso amplificatore dei suoni RTTTL)
    au = fw / 'src/AudioThread.h'
    sostituisci(au, '#include <AudioGeneratorRTTTL.h>',
                '#include <AudioGeneratorRTTTL.h>\n#ifdef SRM_GUIDA\n#include <AudioGeneratorWAV.h>\n#endif', 'AudioGeneratorWAV.h')
    sostituisci(au, '    void readAloud(const char *text)',
                '#ifdef SRM_GUIDA\n    void beginWav(const uint8_t *data, uint32_t len)\n    {\n        stop();\n        ampEnable(true);\n'
                '        setCPUFast(true);\n        wavFile = std::unique_ptr<AudioFileSourcePROGMEM>(new AudioFileSourcePROGMEM(data, len));\n'
                '        i2sWav = std::unique_ptr<AudioGeneratorWAV>(new AudioGeneratorWAV());\n        i2sWav->begin(wavFile.get(), audioOut.get());\n    }\n#endif\n\n'
                '    void readAloud(const char *text)', 'void beginWav(')
    sostituisci(au, '            return i2sRtttl->isRunning() && i2sRtttl->loop();\n        }\n        return false;',
                '            return i2sRtttl->isRunning() && i2sRtttl->loop();\n        }\n#ifdef SRM_GUIDA\n'
                '        if (i2sWav != nullptr) {\n            return i2sWav->isRunning() && i2sWav->loop();\n        }\n#endif\n        return false;',
                'i2sWav->isRunning()')
    sostituisci(au, '        rtttlFile = nullptr;\n',
                '        rtttlFile = nullptr;\n#ifdef SRM_GUIDA\n        if (i2sWav != nullptr) {\n            i2sWav->stop();\n            i2sWav = nullptr;\n'
                '        }\n        wavFile = nullptr;\n#endif\n', 'wavFile = nullptr;')
    sostituisci(au, '    std::unique_ptr<AudioFileSourcePROGMEM> rtttlFile = nullptr;',
                '    std::unique_ptr<AudioFileSourcePROGMEM> rtttlFile = nullptr;\n#ifdef SRM_GUIDA\n'
                '    std::unique_ptr<AudioGeneratorWAV> i2sWav = nullptr;\n    std::unique_ptr<AudioFileSourcePROGMEM> wavFile = nullptr;\n#endif',
                'AudioGeneratorWAV> i2sWav')
    # ambiente di compilazione
    v = fw / 'variants/esp32s3/t-watch-ultra/platformio.ini'
    if '[env:t-watch-ultra-srm]' not in v.read_text():
        v.write_text(v.read_text() + '''
; Skyrace del Maglio: guida sul percorso, SOS e avvisi alla base (orologio/firmware nel sito SRM)
[env:t-watch-ultra-srm]
board_level = extra
extends = env:t-watch-ultra
build_flags = ${env:t-watch-ultra.build_flags} -D SRM_GUIDA -Isrc/modules/srm
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
