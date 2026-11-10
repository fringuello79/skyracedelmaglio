#!/bin/sh
# Schermate dell'orologio rese sul PC (schermi/*.png e schermi/tutte.png). Uso: sh orologio/firmware/prove/schermi.sh
set -e
QUI=$(cd "$(dirname "$0")" && pwd)
node "$QUI/../strumenti/esporta_dati.mjs" > /dev/null
[ -f "$QUI/casi/gara_intera.fix" ] || node "$QUI/casi.mjs" > /dev/null
TMP=$(mktemp -d)
g++ -std=c++17 -O2 -Wall -Wextra -I"$QUI/../srm" "$QUI/schermi.cpp" "$QUI"/../srm/srm_app.cpp "$QUI"/../srm/srm_guida.cpp \
  "$QUI"/../srm/srm_dati.cpp "$QUI"/../srm/srm_rilievo.cpp "$QUI"/../srm/srm_terreno.cpp -o "$TMP/schermi"
(cd "$QUI" && "$TMP/schermi" > schermi/registro.txt 2>&1 || { cat schermi/registro.txt; exit 1; })
python3 "$QUI/schermi.py"
rm -rf "$TMP"
