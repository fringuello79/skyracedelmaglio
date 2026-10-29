#!/usr/bin/env python3
"""Voce sintetica italiana (Piper, voce «paola») per tutte le frasi di voce/frasi.tsv, finché non ci sono registrazioni vere.

    pip install piper-tts numpy
    python3 voce_sintesi.py /cartella/uscita
"""
import sys, urllib.request, wave
from pathlib import Path

QUI = Path(__file__).resolve().parent
FRASI = QUI.parent / 'voce' / 'frasi.tsv'
VOCE = 'it_IT-paola-medium'
URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/it/it_IT/paola/medium/'

# piccoli aggiustamenti di pronuncia (la sintesi legge alla lettera)
PRONUNCIA = {'3B': 'tre bi', 'E1': 'e uno', 'SOS': 'esse o esse', 'GPS': 'gi pi esse'}


def testo_parlato(t):
    for a, b in PRONUNCIA.items():
        t = t.replace(a, b)
    return t


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else 'voce_sintetica'); out.mkdir(parents=True, exist_ok=True)
    modelli = Path.home() / '.cache' / 'piper'; modelli.mkdir(parents=True, exist_ok=True)
    for est in ('.onnx', '.onnx.json'):
        f = modelli / (VOCE + est)
        if not f.exists():
            urllib.request.urlretrieve(URL + VOCE + est, f)
    from piper import PiperVoice
    voce = PiperVoice.load(str(modelli / (VOCE + '.onnx')))
    righe = [r.split('\t') for r in FRASI.read_text().splitlines()[1:] if r.strip()]
    for nome, testo, *_ in righe:
        with wave.open(str(out / f'{nome}.wav'), 'wb') as w:
            if hasattr(voce, 'synthesize_wav'):
                voce.synthesize_wav(testo_parlato(testo), w)
            else:                                   # piper-tts più vecchio
                voce.synthesize(testo_parlato(testo), w)
    print(f'{len(righe)} frasi sintetizzate in {out}')


if __name__ == '__main__':
    main()
