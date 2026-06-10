# Playbook de ejecución — Sistema de acciones (paper → real)

La parte del sistema que NO es código: las reglas que el humano ejecuta. Un sistema profesional falla casi siempre aquí, no en la señal.

## Cuando llega una señal 🟢 al Telegram

1. **Confirmar a ojo en TV** (símbolo en el aviso): ¿se ve el "9" de DeMark en diario? ¿El precio está sobre la EMA200? Si algo no cuadra con el aviso, NO operar y reportarlo (puede ser divergencia de datos Yahoo↔TV).
2. **Comprobar el calor**: si el aviso trae 🔥 (4 posiciones abiertas o 2 del mismo sector), la señal es solo informativa. No se añade riesgo.
3. **Calcular tamaño** (regla fija, sin excepciones):
   `acciones = (cuenta × 1%) / (entrada − SL)` — fracciones de acción en T212 Invest si hace falta.
4. **Orden**: market-on-open o límite cerca de la apertura del día siguiente. Inmediatamente después, **stop fijo en el SL del aviso**. Sin stop puesto no hay trade.
5. **Registrar**: el journal paper lo lleva el scanner; si se opera en real, apuntar fill real vs teórico (slippage).

## Reglas innegociables (donde mueren los sistemas)

- **El SL no se mueve nunca hacia abajo.** Ni "un poquito más de margen". El edge medido (+0.61R/tr) incluye todos los stops ejecutados.
- **El TP no se corta por miedo** ni se deja correr por avaricia: TP2 es la spec primaria hasta que el paper decida entre TP2/TP3.
- **No entrar si hay earnings en ≤7 días** (el scanner ya lo filtra; si TV muestra un ER que el scanner no vio, manda el calendario real).
- **Máx 1% de riesgo por trade, máx 4 posiciones (4% de calor), máx 2 por sector.**
- **Las rachas de 4-6 stops seguidos son NORMALES** con WR ~55%: están en el backtest. Abandonar el sistema en racha mala = comprar el backtest y vender el drawdown.
- **Ningún cambio de spec sin backtest + walk-forward** (así entró el filtro precio>EMA200; así se rechazó el filtro SPY).

## Qué está validado y qué no

| Pieza | Estado |
|---|---|
| Setup-9 perf + EMA50>200 + px>EMA200, SL=setupLow≥3%, TP2/TP3 | ✅ Backtest 3yr, WF 4/4 (aprox. Yahoo + sesgo supervivencia → valida la forward) |
| Filtro de mercado SPY>EMA200 | ❌ RECHAZADO con datos (0.61→0.46 R/tr, WF 3/4). No re-proponer sin evidencia nueva |
| Guardia earnings 7d | ⚠️ Regla de riesgo declarada, NO backtesteada (sin histórico de fechas ER) |
| Calor 4 pos / 2 sector | ⚠️ Regla de riesgo estándar, no optimizada |

## Criterio de paso a dinero real

Como con DVA: **mínimo 30 trades cerrados en paper** y expectancy positiva sostenida antes de arriesgar el primer euro. El paper acumula solo; el reporte de los domingos lleva la cuenta.

## Infraestructura

- Scanner diario 22:30: `com.stocks.scanner` → `scanner_forward.mjs` → señales Telegram + `journal.json`
- Reporte domingos 20:00: `com.stocks.report` → `weekly_report.mjs`
- Todo paralelo al sistema forex: HTTP puro, sin chart/CDP/mutex.
