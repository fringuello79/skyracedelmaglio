#!/usr/bin/env python3
"""Mette le frasi registrate dentro il firmware: orologio/firmware/voce/wav/*.wav → srm/srm_voce.cpp

Le registrazioni (una per riga di voce/frasi.tsv, stesso nome) si fanno con la pagina orologio/voce/ del sito.
Qui si convertono in WAV 11025 Hz, 8 bit, mono (circa 11 kB al secondo) e si scrivono come dati costanti
nella memoria del programma. Senza registrazioni la tabella è vuota e l'orologio usa i suoni brevi.

    python3 orologio/firmware/strumenti/voce_firmware.py
"""
import io, struct, sys, wave
from pathlib import Path

import numpy as np

QUI = Path(__file__).resolve().parent
WAV = QUI.parent / 'voce' / 'wav'
OUT = QUI.parent / 'srm' / 'srm_voce.cpp'
FREQ = 11025


def leggi(p):
    with wave.open(str(p)) as w:
        n, ch, sw, fr = w.getnframes(), w.getnchannels(), w.getsampwidth(), w.getframerate()
        raw = w.readframes(n)
    if sw == 1:
        x = (np.frombuffer(raw, np.uint8).astype(np.float32) - 128) / 128
    elif sw == 2:
        x = np.frombuffer(raw, '<i2').astype(np.float32) / 32768
    else:
        x = np.frombuffer(raw, '<i4').astype(np.float32) / 2147483648
    x = x.reshape(-1, ch).mean(axis=1)
    if fr != FREQ:   # ricampionamento lineare (la voce a 11 kHz non ne soffre)
        t = np.arange(0, len(x) / fr, 1 / FREQ)
        x = np.interp(t, np.arange(len(x)) / fr, x)
    # silenzi ai bordi via, volume normalizzato
    soglia = 0.02 * max(1e-6, np.abs(x).max())
    attivi = np.where(np.abs(x) > soglia)[0]
    if len(attivi):
        a, b = max(0, attivi[0] - int(0.04 * FREQ)), min(len(x), attivi[-1] + int(0.08 * FREQ))
        x = x[a:b]
    x = x / max(1e-6, np.abs(x).max()) * 0.95
    return x


def wav8(x):
    b = io.BytesIO()
    with wave.open(b, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(1); w.setframerate(FREQ)
        w.writeframes(np.clip(x * 127 + 128, 0, 255).astype(np.uint8).tobytes())
    return b.getvalue()


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--cartella', default=str(WAV), help='dove sono i WAV (predefinita: voce/wav)')
    ap.add_argument('--anteprima', help='cartella dove scrivere i WAV convertiti, per ascoltarli')
    a = ap.parse_args()
    cartella = Path(a.cartella)
    if a.anteprima:
        Path(a.anteprima).mkdir(parents=True, exist_ok=True)
    righe = ['// Generato da orologio/firmware/strumenti/voce_firmware.py: non modificare a mano.',
             '#include "srm_voce.h"', 'namespace srm', '{']
    tab, tot = [], 0
    for p in sorted(cartella.glob('*.wav')) if cartella.exists() else []:
        dati = wav8(leggi(p))
        if a.anteprima:
            (Path(a.anteprima) / p.name).write_bytes(dati)
        nome = 'v_' + ''.join(c if c.isalnum() else '_' for c in p.stem)
        righe.append(f'static const uint8_t {nome}[] = {{' + ','.join(str(v) for v in dati) + '};')
        tab.append(f'    {{"{p.stem}", {nome}, {len(dati)}}},')
        tot += len(dati)
    righe.append('const Clip VOCE[] = {')
    righe += tab or ['    {"", nullptr, 0},']
    righe += ['};', f'const int N_VOCE = {len(tab)};', '} // namespace srm', '']
    OUT.write_text('\n'.join(righe))
    print(f'{len(tab)} frasi, {tot / 1024:.0f} kB → {OUT}')


if __name__ == '__main__':
    main()
