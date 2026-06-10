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

## Filtro de mercado SPY — RECHAZADO (2026-06-10)

Probado SPY>EMA200 como gate adicional: R/trade 0.61→0.46, WF 4/4→3/4. Las mejores compras de agotamiento ocurren en los sustos del índice y el filtro por acción (px>EMA200) ya cubre el régimen. **No re-proponer sin evidencia nueva.**

## Capa profesional (2026-06-10, no-edge: reglas de riesgo)

- Guardia earnings: no entrar con ER ≤7 días (vía screener TV `earnings_release_next_date`). No backtesteable, declarada.
- Calor: máx 4 posiciones (1% riesgo c/u) y máx 2/sector — el aviso de Telegram advierte 🔥.
- Reporte semanal de gestor (domingos 20:00, `weekly_report.mjs` → Telegram): expectancy, WR, ΣR, maxDD en R, abiertas.
- Playbook de ejecución humano: `STOCKS_PLAYBOOK.md` (sizing 1%, stop intocable, criterio 30 trades paper → real).

Scripts: `fetch_universe.mjs`, `download_history.mjs`, `backtest_ema_demark.mjs`, `sweep_variants.mjs`, `scanner_forward.mjs`, `weekly_report.mjs`.
