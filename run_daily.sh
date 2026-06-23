#!/bin/zsh
# Orquestador diario del sistema de acciones.
# Robusto a que el Mac duerma a la hora programada: el plist dispara a las 9:00
# Y CADA HORA (+ RunAtLoad). Este guard hace que solo CORRA UNA VEZ AL DÍA (la
# primera vez que el Mac está despierto a partir de las 9:00). Así un run perdido
# por sueño se recupera al despertar, sin re-enviar Telegram el resto del día.
cd "$(dirname "$0")"

STATE=".last_run_date"
TODAY=$(date +%Y-%m-%d)
HOUR=$(date +%H)
# no correr antes de las 9:00 (mantiene la intención original); ya corrido hoy → skip
if [ "$(cat "$STATE" 2>/dev/null)" = "$TODAY" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M')] ya corrió hoy ($TODAY) — skip"
  exit 0
fi
if [ "$HOUR" -lt 9 ]; then
  echo "[$(date '+%Y-%m-%d %H:%M')] antes de las 9:00 — esperando"
  exit 0
fi
echo "[$(date '+%Y-%m-%d %H:%M')] ▶ run diario de acciones (recuperación robusta a sueño)"

/usr/local/bin/node scanner_forward.mjs
/usr/local/bin/node scanner_weekly.mjs
/usr/local/bin/node scanner_breakout.mjs
/usr/local/bin/node momentum_monthly.mjs
/usr/local/bin/node scanner_ema200.mjs
/usr/local/bin/node watchlist_daily.mjs

# marcar como corrido hoy (al final → si el Mac se duerme a media ejecución, reintenta)
echo "$TODAY" > "$STATE"
echo "[$(date '+%Y-%m-%d %H:%M')] ✓ run diario completado"
