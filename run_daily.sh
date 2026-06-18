#!/bin/zsh
# Orquestador diario del sistema de acciones (9:00 via com.stocks.scanner):
# 1) scanner DeMark-9 + RSI2 (señales + gestión de posiciones paper)
# 2) momentum mensual (solo actúa si cambió el mes)
cd "$(dirname "$0")"
/usr/local/bin/node scanner_forward.mjs
/usr/local/bin/node scanner_weekly.mjs
/usr/local/bin/node momentum_monthly.mjs
