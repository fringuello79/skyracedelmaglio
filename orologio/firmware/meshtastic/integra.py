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
                                'srm_voce.h', 'srm_voce.cpp', 'srm_rilievo.h', 'srm_rilievo.cpp', 'srm_terreno.cpp']]
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
    # secondo tasto laterale (GPIO0): tenuto 2 secondi = SOS, come il tasto di accensione; non spegne più l'orologio
    ib = fw / 'src/input/InputBroker.cpp'
    sostituisci(ib, '        userConfig.longPressTime = 500;\n        userConfig.longLongPress = INPUT_BROKER_SHUTDOWN;\n',
                '        userConfig.longPressTime = 500;\n        userConfig.longLongPress = INPUT_BROKER_SHUTDOWN;\n'
                '#ifdef SRM_GUIDA\n        userConfig.longPressTime = 2000;\n        userConfig.longLongPress = INPUT_BROKER_NONE;\n#endif\n',
                'userConfig.longPressTime = 2000;')
    # sfondo a colori della mappa (rilievo): un'immagine a tavolozza sotto i pixel spenti, accanto alle zone colore
    ch = fw / 'src/graphics/TFTColorRegions.h'
    sostituisci(ch, 'void registerTFTColorRegionDirect(int16_t x, int16_t y, int16_t width, int16_t height, uint16_t onColor, uint16_t offColor);\n',
                'void registerTFTColorRegionDirect(int16_t x, int16_t y, int16_t width, int16_t height, uint16_t onColor, uint16_t offColor);\n'
                '#ifdef SRM_GUIDA\n'
                '// Guida SRM: immagine di sfondo (indici in una tavolozza RGB565 gia\' nell\'ordine di byte del pannello)\n'
                'struct SrmSfondo {\n    const uint8_t *indici;\n    const uint16_t *tavolozza;\n    int16_t w, h, x0, y0;\n    uint8_t scala;\n'
                '    uint32_t impronta;\n    bool attivo;\n};\nextern SrmSfondo srmSfondo;\n'
                'inline bool srmSfondoPixel(int16_t x, int16_t y, uint16_t &colore)\n{\n    if (!srmSfondo.attivo || y < srmSfondo.y0 || x < srmSfondo.x0)\n        return false;\n'
                '    int r = (y - srmSfondo.y0) / srmSfondo.scala, c = (x - srmSfondo.x0) / srmSfondo.scala;\n'
                '    if (r >= srmSfondo.h || c >= srmSfondo.w)\n        return false;\n'
                '    colore = srmSfondo.tavolozza[srmSfondo.indici[r * srmSfondo.w + c]];\n    return true;\n}\n#endif\n', 'struct SrmSfondo')
    cc = fw / 'src/graphics/TFTColorRegions.cpp'
    sostituisci(cc, 'static uint8_t colorRegionCount = 0;\n',
                'static uint8_t colorRegionCount = 0;\n#ifdef SRM_GUIDA\nSrmSfondo srmSfondo = {nullptr, nullptr, 0, 0, 0, 0, 1, 0, false};\n#endif\n', 'SrmSfondo srmSfondo =')
    sostituisci(cc, 'uint16_t resolveTFTColorPixel(int16_t x, int16_t y, bool isset, uint16_t defaultOnColor, uint16_t defaultOffColor)\n{\n',
                'uint16_t resolveTFTColorPixel(int16_t x, int16_t y, bool isset, uint16_t defaultOnColor, uint16_t defaultOffColor)\n{\n'
                '#ifdef SRM_GUIDA\n    uint16_t srmColore;\n    if (!isset && srmSfondoPixel(x, y, srmColore))\n        return srmColore;\n#endif\n', 'srmSfondoPixel(x, y, srmColore)')
    sostituisci(cc, '        hash = fnv1aAppendU16(hash, r.offColorBe);\n    }\n',
                '        hash = fnv1aAppendU16(hash, r.offColorBe);\n    }\n#ifdef SRM_GUIDA\n    if (srmSfondo.attivo) {\n'
                '        hash = fnv1aAppendU16(hash, static_cast<uint16_t>(srmSfondo.impronta));\n'
                '        hash = fnv1aAppendU16(hash, static_cast<uint16_t>(srmSfondo.impronta >> 16));\n    }\n#endif\n', 'srmSfondo.impronta >> 16')
    sostituisci(cc, '    colorRegionCount = 0;\n}\n\n// Per-row culling fast path',
                '    colorRegionCount = 0;\n#ifdef SRM_GUIDA\n    srmSfondo.attivo = false;\n#endif\n}\n\n// Per-row culling fast path', 'srmSfondo.attivo = false;')
    td = fw / 'src/graphics/TFTDisplay.cpp'
    sostituisci(td, '                            chunkRow[xx] = isset ? r.onColorBe : r.offColorBe;\n                        }\n                    }\n                }\n',
                '                            chunkRow[xx] = isset ? r.onColorBe : r.offColorBe;\n                        }\n                    }\n                }\n'
                '#ifdef SRM_GUIDA\n                // Guida SRM: lo sfondo della mappa sotto i pixel spenti\n                if (graphics::srmSfondo.attivo) {\n'
                '                    for (x = 0; x < displayWidth; x++) {\n                        uint16_t srmColore;\n'
                '                        if ((buffer[x + y_byteIndex] & y_byteMask) == 0 &&\n'
                '                            graphics::srmSfondoPixel(static_cast<int16_t>(x), static_cast<int16_t>(y), srmColore))\n'
                '                            chunkRow[x] = srmColore;\n                    }\n                }\n#endif\n', 'Guida SRM: lo sfondo della mappa')
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
