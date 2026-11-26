#!/bin/sh
# Confronta il motore C++ con guida/motore.js su tutti i casi. Uso: sh orologio/firmware/prove/esegui.sh (da qualunque cartella)
set -e
QUI=$(cd "$(dirname "$0")" && pwd)
node "$QUI/../strumenti/esporta_dati.mjs"
node "$QUI/casi.mjs" > /dev/null
TMP=$(mktemp -d)
g++ -std=c++17 -O2 -Wall -Wextra -I"$QUI/../srm" "$QUI/banco.cpp" "$QUI/../srm/srm_guida.cpp" "$QUI/../srm/srm_dati.cpp" -o "$TMP/banco"
esito=0
for c in "$QUI"/casi/*.fix; do
  b=${c%.fix}; "$TMP/banco" "$c" > "$TMP/out"
  if cmp -s "$b.attesi" "$TMP/out"; then echo "uguale   $(basename "$b") ($(wc -l < "$b.attesi") avvisi)"
  else echo "DIVERSO  $(basename "$b")"; diff "$b.attesi" "$TMP/out" | head -10; esito=1; fi
done
rm -rf "$TMP"
exit $esito
