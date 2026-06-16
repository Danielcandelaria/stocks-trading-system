# Backtest acciones US — EMA cross vs EMA-régimen + DeMark setup-9

**Fecha:** 2026-06-10 · **Datos:** ~3 años diario, 496 tickers (universo screener TV: mcap>$2B, vol90d>1M, precio>$10) · **Fuente:** Yahoo (aproximación declarada) · **Costes:** 0.05%/lado · LONG-only · Walk-forward 4 ventanas.

⚠️ Sesgo de supervivencia (universo de hoy aplicado al pasado) — la validación que manda es la forward leyendo de TV.

## Resultados

| Variante | n | WR | PF | WF | Veredicto |
|---|---|---|---|---|---|
| A1: cruce EMA20/50 | 2993 | 37% | 1.89 | 3/4 | ⚠️ Espejismo: W4 (reciente) PF 0.37. Edge = beta del bull market |
| A2: cruce EMA50/200 | 479 | 16% | 0.35 | 0/4 | ❌ Muerta. Llega tardísimo en diario |
| B: EMA50>200 + DeMark9 buy, SL=setupLow, TP=2R | 1874 | 35.5% | 1.45 | 4/4 PF | ⚠️ ΣR −263 sin filtro de stop |
| **B + stop mínimo 2% del precio** | **820** | **42.7%** | — | **4/4 ΣR>0** | ✅ **Candidata.** ΣR +199, +0.24R/trade, todas las ventanas positivas incl. la reciente (+76.5R) |

## Hallazgo clave (anomalía R de la variante B)

Con PF>1 en retornos pero ΣR negativo: los trades con stop muy pegado (<2% del precio) destruyen en términos de R — los gaps de apertura saltan el stop con −2R/−5R y el ruido diario los barre (1054 trades, ΣR −462). Con stop ≥2% del precio: 820 trades, ΣR +199, WR 42.7%, robusto en las 4 ventanas. Mismo patrón que la lección forex: el sizing por R exige stops con holgura real.

El filtro 2% se descubrió in-sample → tratarlo con cautela aunque sea una regla de cordura (no un parámetro curve-fit). Confirmar en forward.

## Decisión

- Descartar cruces de EMA como señal (A1 es beta de mercado, A2 muerta).
- **Spec candidata:** diario, EMA50>EMA200 (régimen) + DeMark setup-9 BUY (`computeTDSetup` certificado) + stop=setupLowBull con distancia mínima 2% + TP 2R + time-stop 40 barras.
- Siguiente fase: scanner forward vía screener REST (`scanner.tradingview.com`, sin tocar chart/CDP) + Telegram SEPARADO + journal paper propio en `stocks/`.

## Barrido de variantes (2026-06-10, `sweep_variants.mjs`, 39 variantes con n≥100)

Grid: régimen (e50>e200, e20>e50, e20>50>200, sin régimen) × perfection × TP (1.5/2/3R) × stop mín (2/3%).

**Robustez notable: 28 de 39 variantes dan WF 4/4** — la señal DeMark setup-9 + stop mínimo es un edge de meseta, no un pico aislado. El cruce de EMAs concreto importa poco; lo que más añade es el **filtro de perfection** (`isPerfected`, ya certificado) y el stop mínimo 3%.

Top (todas WF 4/4):
| Variante | n | WR | R/trade | ΣR |
|---|---|---|---|---|
| e50>e200 +perf TP3 ms3% | 129 | 48.8% | **0.68** | 88 |
| e50>e200 +perf TP3 ms2% | 192 | 44.3% | 0.59 | 112 |
| **e50>e200 +perf TP2 ms3%** | 129 | **54.3%** | 0.56 | 73 |

**Spec elegida para forward (paper): e50>e200 + setup-9 perfeccionado + stop=setupLow (mín 3%) — trackear TP2 y TP3 en paralelo.** ~1 señal/semana sobre universo de 500.

## Mejora del régimen (2026-06-10, observación del usuario sobre HCA)

El filtro EMA50>EMA200 tiene lag: tras una caída fuerte el precio queda bajo ambas EMAs pero las medias tardan semanas en cruzar → se compraban tendencias ya muertas (caso HCA 2026-04-24, −1R, hoy −14%). Fix: exigir además **precio > EMA200** en la vela de la señal.
Backtest (TP2, perf, ms3%): n 129→83, WR 54.3→55.4%, R/trade 0.56→**0.61**, WF 4/4 se mantiene. Precio > ambas EMAs es demasiado restrictivo (28 trades). Aplicado a `scanner_forward.mjs`.

## Ampliación a 1000 tickers — RECHAZADA (2026-06-11)

Probado ampliar el universo de 500 a 1000 (mcap $2B+ las nuevas): las 500 medianas NO tienen edge con esta spec — WR 32.8%, −0.08 R/tr, WF 1/4 — y diluyen la mezcla (0.63→0.34 R/tr, WF 3/4). El patrón DeMark de agotamiento solo paga en large-caps muy seguidas. **Universo se queda en top-500 por mcap. No re-ampliar sin evidencia nueva.** La cadencia baja (~1 señal/1-2 semanas) ES el edge, no un defecto.

## Filtro de mercado SPY — RECHAZADO (2026-06-10)

Probado SPY>EMA200 como gate adicional: R/trade 0.61→0.46, WF 4/4→3/4. Las mejores compras de agotamiento ocurren en los sustos del índice y el filtro por acción (px>EMA200) ya cubre el régimen. **No re-proponer sin evidencia nueva.**

## Capa profesional (2026-06-10, no-edge: reglas de riesgo)

- Guardia earnings: no entrar con ER ≤7 días (vía screener TV `earnings_release_next_date`). No backtesteable, declarada.
- Calor: máx 4 posiciones (1% riesgo c/u) y máx 2/sector — el aviso de Telegram advierte 🔥.
- Reporte semanal de gestor (domingos 20:00, `weekly_report.mjs` → Telegram): expectancy, WR, ΣR, maxDD en R, abiertas.
- Playbook de ejecución humano: `STOCKS_PLAYBOOK.md` (sizing 1%, stop intocable, criterio 30 trades paper → real).

Scripts: `fetch_universe.mjs`, `download_history.mjs`, `backtest_ema_demark.mjs`, `sweep_variants.mjs`, `scanner_forward.mjs`, `weekly_report.mjs`.

## Expansión multi-sistema (2026-06-11)

**SHORT DeMark (espejo del largo) — RECHAZADO**: las 12 variantes pierden (R/tr −0.17 a −0.39, WF 1/4 todas). La deriva alcista estructural de las large-caps mata el lado corto. El edge largo = DeMark + deriva alcista, no DeMark solo. No reintentar sin evidencia nueva.

**RSI-2 mean reversion (Connors) — VALIDADO**: RSI(2)<10 + precio>EMA200, salida cierre>SMA5 o 5 días. n=7988 (3yr), WR 64.8%, PF 1.36, +0.41%/trade, 2.5d medios, WF 4/4 (meseta: 3 de 4 variantes pasan). SIN stop por spec; riesgo gestionado por cap de 5 posiciones simultáneas y salida temporal. EN PAPER desde 2026-06-11 (journal strategy='RSI2', señales 🔵).

**Momentum mensual top-10 (6m skip 1m) — FORWARD-ONLY**: el backtest da +120% CAGR = artefacto del sesgo de supervivencia (rankea a los ganadores de hoy); literatura real: +3-8%/año vs índice. NO validable en backtest con datos gratuitos → validación 100% forward: foto mensual a Telegram + `momentum_state.json`, comparar vs SPY mes a mes. Primer portfolio 2026-06 registrado.

Pipeline diario: `run_daily.sh` (scanner DeMark-9 + RSI2 → momentum mensual) a las 9:00 vía `com.stocks.scanner`.

## Estrategia intradía "motion/liquidaciones" (vídeo 2 de Mariel) — RECHAZADA (2026-06-11)

Formalización mecánica de sus dos setups (reversal-rechazo del "daily hold" y ruptura de extremos con volumen), 5m, top-100 líquidos, 60 días (límite Yahoo intradía), grid de 24 variantes (SL 0.3/0.5% × TP 1/2/3% × filtro rango): **las 24 pierden** (PF 0.62-0.88, WF 0/4 casi todas, R/tr −0.08 a −0.33).

Diagnóstico: con stops de 0.3-0.5%, los costes (0.1% ida+vuelta) consumen 0.2-0.3R por trade — el intradía con stop fino vive o muere de la ejecución. Bruto de costes la estrategia ronda breakeven: no hay edge mecánico que pagar. El edge que ella reporta (WR 61%, ratio 1:3 ≈ +1.4R/tr — sería élite mundial) reside, si existe, en su lectura discrecional de niveles y selección de trades — exactamente lo que un test mecánico no puede capturar ni nosotros replicar con un scanner.

Caveats declarados: solo 60 días (régimen reciente), y la formalización es una aproximación (la original es parcialmente discrecional). Aun así: 24/24 variantes en negativo en 4.100+ trades no deja espacio razonable para un edge robusto mecanizable. Script: `backtest_intradia_mariel.mjs` (datos en /tmp/intraday5m, re-descargables).

## Análisis de decay + monitor de salud forward (2026-06-16, Citadel Alpha Lab #4)

**Decay in-sample (¿cuánto vive el edge tras la señal?):**
- **DeMark-9**: R medio acumulado sube de +0.15R (día 1) a pico +0.72R (día 13), luego se aplana/cae (día 15 = 0.63R). Edge de construcción LENTA → estructural, no artefacto de microestructura. El time-stop de 40 velas es generoso; la acción real está en días 6-14. Confirma que las salidas por TP capturan el grueso.
- **RSI-2**: % medio sube monótono de +0.03% (día 1) a +0.66% (día 7), sin decaer. El rebote de mean-reversion persiste → edge robusto. Nuestra salida (cierre>SMA5, ~día 2-3) deja algo sobre la mesa pero a cambio de menos riesgo de path (el backtest ya validó hold≤5 con SMA5 > hold≤10 en WF).
- **Conclusión**: ninguna señal se degrada rápido. Las que mueren en horas son ruido; estas se construyen en días = bandera verde de robustez.

**Monitor de salud (`monitor_health.mjs`, integrado en reporte semanal):** compara el forward real (journal) vs backtest + bandas Monte Carlo. Veredicto por estrategia: 🟢 dentro / 🟡 muestra pequeña / 🔴 cruzó banda de alarma (racha>p95=6, DeMark maxDD>7R, WR<<backtest, o expectativa real negativa con n≥15). Alerta a Telegram solo si 🔴. Es la herramienta objetiva de la decisión paper→real: si el forward cae fuera de las bandas que el propio backtest predice, el edge era espejismo.
