# Metodología de creación de sistemas de trading

Método canónico de este repo. Síntesis de nuestro proceso (forex + acciones) y de la metodología de Mariel/Trade Simple (vídeo torneo TradingView, adoptada 2026-06-11). **Toda estrategia nueva pasa por estos 9 pasos, en orden. Sin atajos.**

## Los 9 pasos

**1. Comportamiento antes que estrategia.**
No buscar "una estrategia ganadora": primero preguntar a los datos qué hace el activo estructuralmente (¿tendencial? ¿revierte a la media? ¿estacional?). La estrategia se diseña PARA el comportamiento encontrado, no al revés. *"Es el activo → procesamos sus datos → después creamos la estrategia."*

**2. Hipótesis explícita, no minería de datos.**
Prohibido "prueba 1.000 estrategias y dame la que más gane" — eso ajusta a ruido histórico (el gato negro + el trueno + la llamada). Cada test parte de una hipótesis con lógica económica: *por qué* debería funcionar (agotamiento del vendedor, pánico de corto plazo, deriva alcista...).

**3. Riesgo de ruina = filtro #1 (antes que la rentabilidad).**
La primera pregunta no es cuánto gana sino cuánto puede destruir. Cualquier estrategia que pueda reventar la cuenta queda descartada de entrada, por rentable que parezca. Primero sobrevivir, después ganar.

**4. Motor de backtest propio + barrido de variantes.**
Una idea sin motor que la teste es una opinión; con motor es un número defendible. Y nunca una sola configuración: la rejilla completa. Un edge real es una **meseta** (muchas variantes vecinas funcionan); un pico aislado es overfit.

**5. Validación en datos NO vistos (out-of-sample / walk-forward).**
La estrategia solo existe si funciona en datos que no se usaron para diseñarla. Nuestro estándar: walk-forward de 4 ventanas, todas positivas. Probar solo en el histórico completo es autoengaño.

**6. Distinguir EDGE de RÉGIMEN.**
Que funcione en una ventana reciente no es edge, es régimen (la lección del torneo: su ventaja era el mercado de esas semanas, lo confirmó y por eso NO la llevó a su portfolio real). Forward corto = régimen. Edge = sobrevive regímenes distintos. Y honestidad sobre los defectos del propio backtest: si el sesgo (supervivencia, datos aproximados) puede fabricar el resultado, el backtest no vale (caso momentum: +120% CAGR = artefacto → forward-only).

**7. Cartera de estrategias DESCORRELACIONADAS, no la estrategia mágica.**
No existe el sistema único que bate al índice. Existe el portfolio de sistemas con baja correlación entre sí. Dos estrategias brutales que ganan y pierden a la vez = una sola estrategia con el doble de riesgo. Medir la correlación de P&L antes de sumar un sistema al portfolio.

**8. Monte Carlo para conocer el futuro estadístico.**
Simular miles de secuencias con los trades del backtest para convertir "las rachas malas son normales" en números: peor racha esperable, drawdown p95 (= umbral de ALARMA), distribución de resultados anuales. El forward se juzga contra esas bandas, no contra sensaciones.

**9. Ejecución sistemática — el humano es el eslabón débil.**
Cada intervención discrecional documentada en el vídeo costó dinero (cerrar antes por miedo: −0.5R; el corto final que cerró en −0.26% habría dado +1.18%). Las reglas se siguen al 100% o el backtest no representa lo que estás operando. Nuestro mecanismo: señales automáticas con niveles exactos + journal que trackea la regla, no la emoción. Paper → 30 trades → real.

## Reglas transversales

- **La IA es el obrero, no el arquitecto**: escribe código, corre simulaciones, caza bugs, itera rápido. La dirección, la hipótesis y el criterio de descarte son humanos. Primera iteración con libertad de sugerir; después, a trabajar con los términos definidos.
- **El cementerio documentado vale tanto como la spec viva**: toda idea rechazada queda escrita con sus números para no re-tropezar (ver BACKTEST_RESULTADOS_STOCKS.md). Una estrategia descartada es un paso menos hacia perder dinero.
- **Si no puedes explicárselo a tu abuela, no funciona**: las specs se mantienen simples. Pocas condiciones = robustez; hipersensibilidad a parámetros = fragilidad.
- **A cualquiera que diga "tengo una estrategia que funciona": pedirle sus últimos 100 trades.** A nosotros también — eso es el journal forward.

## Aplicación a los sistemas actuales (análisis 2026-06-11, `analysis_mc_corr.mjs`)

### Correlación DeMark-9 ↔ RSI-2 (paso 7)
- **Correlación de P&L semanal: 0.06 — prácticamente cero. ✅ Diversifican de verdad.** Aunque ambos compran caídas sobre la EMA200, operan en frecuencias tan distintas (27 vs miles de trades/año, 2.5 vs 10 días de hold) que sus resultados son independientes.
- ⚠️ Matiz: el solapamiento de EXPOSICIÓN es alto (99% de los días con DeMark abierto también hay RSI2 abierto, porque RSI2 casi siempre tiene algo). En un crash ambos son largos de renta variable a la vez — la descorrelación es de resultados, no de riesgo de cola. El límite de calor global cubre esto.

### Bandas Monte Carlo (paso 8) — umbrales de ALARMA para el forward
5.000 simulaciones de un año con los trades del backtest:

| | DeMark-9 (1% riesgo/trade) | RSI2 (por posición) |
|---|---|---|
| Peor racha de pérdidas esperable | mediana 3, **p95 = 6 seguidas** | mediana 4, **p95 = 6** |
| Drawdown máx anual | mediana 4R, **ALARMA si > 7R** | mediana 33%, ALARMA si > 66% (suma de retornos por posición) |
| Resultado anual | p5 +3.8R · mediana +16.8R · p95 +30R | p5 −25% · mediana +53% · p95 +122% |
| Años perdedores | **1%** | 13% |

**Lectura operativa:**
- 6 stops seguidos en DeMark = NORMAL (pasará). 8-9 seguidos = revisar si algo se rompió.
- Drawdown de 4R en el año = esperado. Más de 7R = el sistema no se está comportando como el backtest → pausar y auditar.
- Con 1% por trade, el DeMark casi no puede tener año perdedor según el modelo (1%) — si el forward da un año negativo, la divergencia backtest↔real es la noticia, no la pérdida.
