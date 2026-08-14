#!/bin/zsh
# status.sh — "cómo está el escáner de acciones".
# Arranca TV/Edge+CDP si está caído, deja UN solo chart, y reporta el estado del sistema.
# Idempotente y seguro de correr al encender (o cuando quieras). No toca el forex.
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
PORT=9222
HC="$ROOT/scripts/cdp_health_check.mjs"

echo "═══ SISTEMA ACCIONES (EMACross + TradingView) ═══"

# 1) TV / CDP: arrancar si hace falta (Edge perfil dedicado, 1 chart)
if node "$HC" >/dev/null 2>&1; then
  echo "✅ TV/CDP arriba (puerto $PORT)"
else
  echo "⚠️  TV/CDP caído → arrancando Edge+TradingView (1 chart)…"
  bash "$ROOT/scripts/ensure_chrome_tv.sh" "$PORT" 1 >/dev/null 2>&1 &
  for i in {1..20}; do sleep 5; node "$HC" >/dev/null 2>&1 && break; done
  if node "$HC" >/dev/null 2>&1; then echo "✅ TV/CDP arriba"
  else echo "❌ TV no arrancó — revisa el login de TradingView en el Edge dedicado"; fi
fi

# 2) Dejar UN solo chart
node "$ROOT/scripts/ensure_chart_tabs.mjs" 1 "$PORT" >/dev/null 2>&1
if node "$HC" >/dev/null 2>&1; then
  SYM=$(node -e 'import("../src/connection.js").then(async C=>{try{const s=await C.evaluate("(function(){try{return window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().model().mainSeries().symbol()}catch(e){return null}})()");console.log(s||"?")}catch{console.log("?")}process.exit(0)}).catch(()=>{console.log("?");process.exit(0)})' 2>/dev/null)
  echo "   chart actual: ${SYM}"
fi

# 3) Agentes de acciones cargados
echo "── agentes ──"
for a in scanner emaradar confirmopen report watchlist; do
  if launchctl list 2>/dev/null | grep -q "com.stocks.$a"; then echo "  ✅ com.stocks.$a"; else echo "  ⚪ com.stocks.$a (no cargado)"; fi
done

# 4) Estado del journal + último radar
node -e 'const j=require("./journal_emacross.json");const o=j.filter(p=>p.status==="open").length,c=j.filter(p=>p.status==="closed").length;console.log("── EMACross paper: "+o+" abiertas · "+c+" cerradas")' 2>/dev/null || echo "── EMACross: sin journal aún"
[ -f seen_tv_confirmed.json ] && echo "   cruces confirmados en TV ahora: $(node -e 'const s=require("./seen_tv_confirmed.json");console.log(Object.keys(s).join(", ")||"ninguno")' 2>/dev/null)"
[ -f radar.log ] && echo "   último radar: $(tail -1 radar.log 2>/dev/null | cut -c1-90)"
echo "═════════════════════════════════════════════"
echo "Radar automático: lun-vie 14:00 (antes de apertura US). Para forzarlo: node radar_emacross.mjs"
