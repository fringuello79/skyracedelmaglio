#!/usr/bin/env python3
"""Rende in PNG le schermate salvate da schermi.cpp (forme + testi + zone colore come sul TFT di Meshtastic)."""
import glob, json, os
from PIL import Image, ImageDraw, ImageFont

def rgb565(c):
    return (((c >> 11) & 31) * 255 // 31, ((c >> 5) & 63) * 255 // 63, (c & 31) * 255 // 31)

FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf'
QUI = os.path.dirname(os.path.abspath(__file__))
for f in sorted(glob.glob(os.path.join(QUI, 'schermi', '*.json'))):
    d = json.load(open(f)); W, H = d['w'], d['h']
    mono = Image.new('1', (W, H), 0); px = mono.load(); s = d['px']
    for i, ch in enumerate(s):
        v = int(ch, 16)
        for b in range(4):
            k = i * 4 + b
            if v >> (3 - b) & 1: px[k % W, k // W] = 1
    dr = ImageDraw.Draw(mono)
    for t in d['testi']:
        font = ImageFont.truetype(FONT, int(t['d'] * 0.78))
        w = dr.textlength(t['s'], font=font)
        x = t['x'] - (w / 2 if t['a'] == 1 else w if t['a'] == 2 else 0)
        dr.text((x, t['y']), t['s'], font=font, fill=0 if t['n'] else 1)
    out = Image.new('RGB', (W, H)); o = out.load(); m = mono.load()
    zone = d['zone']
    for y in range(H):
        attive = [z for z in zone if z[1] <= y < z[1] + z[3]]
        for x in range(W):
            on = m[x, y]; col = (255, 255, 255) if on else (0, 0, 0)
            for z in reversed(attive):
                if z[0] <= x < z[0] + z[2]:
                    col = rgb565(z[4] if on else z[5]); break
            o[x, y] = col
    # bordo arrotondato dell'AMOLED
    maschera = Image.new('L', (W, H), 0); ImageDraw.Draw(maschera).rounded_rectangle([0, 0, W - 1, H - 1], 56, fill=255)
    fondo = Image.new('RGB', (W + 40, H + 40), (28, 31, 29)); fondo.paste(out, (20, 20), maschera)
    fondo.save(f[:-5] + '.png')
print('ok')
