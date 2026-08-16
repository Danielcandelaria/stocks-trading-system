#!/bin/zsh
# run_weekly_close.sh — EL MOMENTO de los sistemas semanales: viernes tras el cierre US.
# La vela semanal ya es definitiva → se detectan los cruces/setups reales y AVISA al instante.
cd "$(dirname "$0")"
echo "[$(date '+%Y-%m-%d %H:%M')] ▶ CIERRE SEMANAL — revisando todos los sistemas"
/usr/local/bin/node scanner_emacross.mjs        # cruces EMA confirmados (entradas + salidas)
/usr/local/bin/node scanner_weekly.mjs          # DeMark Setup-9 semanal
/usr/local/bin/node radar_emacross.mjs --definitive   # radar definitivo + confirma en TV
/usr/local/bin/node scanner_emacross_mid.mjs    # mid-caps (observación)
/usr/local/bin/node track_pnl.mjs               # refresca datos del panel
echo "[$(date '+%Y-%m-%d %H:%M')] ✓ cierre semanal completado"
