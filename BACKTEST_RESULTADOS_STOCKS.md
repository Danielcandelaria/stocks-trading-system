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

## Búsqueda de edge adicional en RSI-2 (2026-06-17) — volumen ✅ / calidad ❌

Testeadas dos hipótesis con respaldo económico, como research separado del sistema vivo (no se tocó la spec en validación).

**Volumen — VALIDADO.** relVol = vol(día pánico)/media 20d. Mejora MONÓTONA y robusta:
| relVol≥ | n | WR | PF | avg% | WF |
|---|---|---|---|---|---|
| 0 (base) | 7886 | 65% | 1.38 | 0.44 | 4/4 |
| 1.5 | 1980 | 65% | 1.62 | 0.73 | 4/4 |
| 2.0 | 909 | 65% | 1.77 | 0.92 | 4/4 |
Gradiente suave + WF 4/4 en todos los niveles + sin sesgo (volumen del propio día de señal) = edge real, no overfit. Lógica: pánico con volumen alto = capitulación verdadera = mejor rebote.
**Acción disciplinada:** NO se cambia la spec (reiniciaría el contador 3/30). Se REGISTRA `relVol` en cada señal RSI-2 forward (`scanner_forward.mjs`) para confirmar el hallazgo con datos en vivo antes de adoptarlo.

**Calidad — RECHAZADA.** Overlay de ROE/deuda. La baja calidad (ROE<15%) rebotó IGUAL o mejor (PF 1.42) que la alta (PF 1.38) → contradice la tesis. El único combo con mejora (ROE≥20%+D/E<1, PF 1.48) está contaminado por look-ahead/supervivencia (fundamentales de hoy sobre trades pasados). No es edge fiable. Al cementerio.

## 4º SISTEMA: DeMark-9 SEMANAL swing largo (2026-06-18) — idea Carlos + corrección usuario

Origen: Carlos Mantilla propuso "operar del 1 al 13" en semanal/mensual para tendencias largas (+20-100%). Primera mecanización (entrada en bearSetup==1) NO batía al azar = supervivencia pura → habría ido al cementerio. **El usuario corrigió visualmente (chart CRDO): se compra el 9-SUELO, no el 13-TECHO.** Re-test con entrada correcta + suelo de stop:

| Versión (hold 52sem, salida en bearCD-13) | n | WR | PF | avgRet | vs AZAR |
|---|---|---|---|---|---|
| entrada bearSetup==1 (mi bug) | 15491 | 29% | 1.91 | +3.5% | azar 1.79 → SIN edge |
| entrada bullSetup==9, sin suelo stop | 1806 | 20% | 3.98 | +11.9% | azar 2.31 → bate |
| **bullSetup==9 + suelo stop 8%** | **417** | **42%** | **6.95** | **+41.8%** | **azar 2.42 → CRUSHEA** |

Con la entrada correcta (comprar el 9) + suelo de stop 8% (~2.5× el 3% diario, por el mayor ruido semanal), el edge sobre el azar es contundente (PF 6.95 vs 2.42, +41.8% vs +10.2%/trade). WF 4/4. ⚠️ Absolutos inflados por supervivencia; el edge REAL es el relativo al azar. WR 42% pero ganadores enormes.

**Spec paper (`scanner_weekly.mjs`, en `run_daily.sh`):** semanal, LONG en bullSetup==9, stop=setupLow (mín 8%, máx 30%), salida en bearCountdown==13 / time-stop 52sem / stop. Cap 5 abiertas. Journal propio `journal_weekly.json`, Telegram 🟣, horizonte semanas-meses.

**2 bugs cazados en montaje (paper hace su trabajo):** (1) faltaba el suelo de stop → señales con stop 0.3% que se noisean al instante; (2) la vela de la semana en curso no se descartaba del todo. Ambos corregidos antes de emitir nada real.

### Filtro EMA200 en el swing semanal — RECHAZADO (2026-06-18)
Probado precio>EMA200(semanal) sobre el swing: sube WR (42→46%) pero BAJA el edge — PF 6.95→6.35, avgRet 41.8→33.5%, recorta 70% de señales. EMA40 lo destroza (PF 1.63, WF 3/4). Prueba concreta: el filtro habría ELIMINADO NVDA oct-2022 (+223%, precio bajo EMA200) y CRDO abr-2025 (+293%). Razón: el diario compra pullbacks (filtro ayuda, lección HCA); el SEMANAL compra capitulación profunda (los suelos bajo EMA200 dan las mayores recuperaciones → filtro hace daño). Sistemas opuestos, efecto opuesto. NO añadir.

## 5º SISTEMA: BREAKOUT RETEST semanal (2026-06-18) — idea Justin Banks @RealUGBanks

Tweet: cruce semanal 8/21 EMA + ruptura de resistencia + entrada en retest + venta en siguiente resistencia ("100% en HOOD"). Mecanizado y testeado:
- Entrada en la RUPTURA: PF 1.50 (≈ azar 1.37) → casi beta, sin edge.
- **Entrada en el RETEST: PF 2.65 vs azar 1.37, WR 56%, +5.5%/trade, WF 4/4** → edge real, en la paciencia del retroceso (justo lo que el tweet enfatiza).
- Robustez: 18/18 variantes (resLB 15/20/26 × retest 4/6/8 × tp 2/3R) dan PF 2.25-2.65, todas WF 4/4 → meseta.
- Correlación 0.04 con el swing DeMark de Carlos → DIVERSIFICA (Carlos compra suelos, Justin compra rupturas).

Spec paper (`scanner_breakout.mjs`, en `run_daily.sh`, journal `journal_breakout.json`, Telegram 🟠): semanal, cruce 8>21 + cierre>máx(20sem) + retest del nivel (≤6sem, banda 2%), stop 8% bajo ruptura, target 2R / cruce 8<21 / time 52sem. Cap 5. Pine para TV: `breakout_retest.pine`.
⚠️ Absolutos inflados por supervivencia; el retest asume fill límite. Edge real = el relativo al azar. Valida la forward.

### Fix nivel de resistencia: 20→8 semanas (2026-06-18, detectado por usuario)
El usuario observó (chart SNOW) que el retest debía ser ~$175, no $236. Causa: "resistencia = máx 20 semanas" captura máximos OBSOLETOS cuando la acción cayó meses y luego explotó (SNOW pasó de $172 a $255 en una vela; el sistema usaba el máx de $236 de hace 5 meses en vez del nivel real de ruptura ~$177, la cima de la base reciente). Re-test de lookbacks: 6/8/10/12/15 sem todos validan (PF 1.78-1.84, WF 4/4, baten azar 1.37). Elegido **8 semanas**: da el nivel reciente correcto (SNOW $176.98) a coste mínimo de PF (1.84 vs 1.93 del 20sem) y más operable. Aplicado a `scanner_breakout.mjs` y `breakout_retest.pine`.

### Filtro de ruptura decisiva ≥3% (2026-06-18, detectado por usuario en AMT)
Usuario marcó AMT como señal sin sentido (breakout marginal en tendencia bajista que falló). Análisis: AMT cerró solo +2.93% sobre la resistencia. Filtros de tendencia (EMA40, EMA21 subiendo) NO ayudan (PF ~1.8). Pero exigir ruptura DECISIVA (cierre ≥X% sobre resistencia) sí: robusto y monótono — 2% PF 2.05, 3% PF 2.01, 4% PF 2.21, todos WF 4/4 (5% rompe WF). Elegido 3% (excluye AMT, PF 1.84→2.01, 596 señales, no reaching). Aplicado a `scanner_breakout.mjs` (BREAK_MIN) y `breakout_retest.pine`.

### Filtro anti-gap (tope ruptura 15%) + Pine en semanal (2026-06-18, detectado por usuario en SNOW)
Usuario: "compra en $176.98 cuando SNOW está a $232 no tiene sentido". Causa: SNOW rompió con gap explosivo (+44% sobre la resistencia), el retest al nivel quedaba 24% bajo el precio = entrada irreal. Fix: tope de ruptura — cierre entre +3% y +15% sobre resistencia (descarta gaps fugitivos). Backtest: PF 2.01→2.04, WF 4/4. SNOW excluido. También: Pine reescrito con request.security para calcular SIEMPRE en semanal (el usuario lo tenía en chart diario → niveles erróneos). `BREAK_MAX=1.15` en scanner.

### Entrada en ZONA de retest, no toque exacto (2026-06-19, detectado por usuario en PRU)
Usuario preguntó si entrar en PRU (Pine marcaba ENTRA, scanner decía pending). Causa: inconsistencia — Pine usaba banda 2%, scanner exigía toque exacto del nivel. Backtest decisivo: entrada EXACTA (low≤nivel) da PF 1.42; entrada en ZONA (low≤nivel×1.02, a MERCADO) da PF 2.11. El edge está en entrar cuando el precio llega a la zona, no en esperar el toque exacto (que suele ser un breakout ya fallido). Fix: scanner detecta retest en la zona y entra a precio de mercado (no el nivel idealizado), stop 8% bajo el nivel, target 2R desde entrada real. Pine ya usaba la zona (consistente). PRU entró 06-17 @107.01.

## Núcleo "8 EMA pullback" de Justin Banks (PDF Grok) — RECHAZADO (2026-06-19)
Guía Grok del enfoque amplio de Justin Banks (8 EMA + price action + supply/demand). Núcleo mecanizable testeado: en tendencia (close>EMA200 & 8>21), comprar pullback+reclaim de la 8 EMA, salir al perder la 8 EMA. Diario: PF 1.13 vs azar 1.12 (mismo filtro tendencia+stop+salida) → SIN edge, es beta. El poco PF viene del filtro de tendencia y la salida, no del timing de entrada. Misma trampa que los cruces de EMA. 
Lo NO mecanizable (supply/demand a mano, BOS/CHOCH/liquidity grabs): subjetivo, sin edge probado, descartado. Intradía 5min: costes lo matan (ver Mariel). 
Lo positivo: su gestión de riesgo (1%, stop bajo swing, RR 1:2-3, máx 3-4) coincide con la nuestra (cross-check). Su ÚNICO edge mecanizable es el breakout retest semanal, que ya tenemos (PF 2.11). Patrón repetido: el edge del trader discrecional está en el juicio, no en las reglas mecánicas.

---

## Estudio MA200 como soporte/resistencia + filtro de distancia (2026-07-30)

**La MA200 es un nivel REAL** (250 acciones, 2y): como soporte aguanta el 78%, como
resistencia el 69% (soporte > resistencia = sesgo del sample alcista). PERO como
ENTRADA sola es floja: tocar la MA da +0.97% forward 10d, por debajo del baseline
(+1.37%). El toque es señal de debilidad. → valida usar px>EMA200 como FILTRO DE
RÉGIMEN (no como disparador), que es como ya lo usan RSI2/DeMark.

**Descomposición soporte × sobreventa** (refutó la hipótesis de que se potencian):
- Sobreventa sola (RSI2<10, sobre MA200): +1.81% forward 10d — el edge está aquí.
- Soporte solo (≤3% de la MA): +0.99% — LASTRE, bajo baseline.
- Soporte + sobreventa: +1.02% — juntarlas EMPEORA vs sobreventa sola.
→ Hallazgo útil: la DISTANCIA sobre la MA200 es filtro de calidad. Sobreventa
  LEJOS de la MA (+1.81%) >> sobreventa PEGADA a la MA (+1.02%). Pegada = ya cayó
  mucho, el pánico es parte de un desplome mayor.

**Backtest del filtro de distancia con WALK-FORWARD** (backtest_rsi2_distance.mjs,
250 tickers, 5y, mecánica exacta SMA5/5d/−20%, 14100 señales):
| Filtro | n | %/tr | PF | WF |
|---|---|---|---|---|
| BASE >0% | 14100 | +0.42 | 1.39 | 3/4 |
| ≥5% | 9576 | +0.52 | 1.48 | 3/4 |
| ≥10% | 5919 | +0.64 | 1.55 | 3/4 |
Base clava la validación (+0.41/PF1.36 → réplica fiel). El filtro mejora %/trade y
PF de forma MONÓTONA (efecto real), PERO:
- WF NO mejora (sigue 3/4). No arregla la robustez, solo amplifica lo bueno.
- La ventana 1 (bajista ~2022) es NEGATIVA en todo y el filtro la EMPEORA
  (−0.06→−0.27). El filtro AYUDA en alcista, HACE DAÑO en bajista.
- La mejora se concentra en la ventana 4 (reciente) → posible dependencia de régimen.

**DECISIÓN (usuario, 2026-07-30): DOCUMENTADO, NO aplicado.** No cruza la vara WF
4/4 (regla #8). Re-evaluar solo si el FORWARD confirma que las señales pegadas a la
MA rinden peor en vivo. NO tocar la spec de RSI2 por un backtest régimen-dependiente.
Scripts: study_ma200.mjs, study_ma200_oversold.mjs, backtest_rsi2_distance.mjs.

---

## RSI2 — filtro de volatilidad REFUTADO + reconciliación forward/backtest (2026-08-04)

Motivo: el forward de RSI2 iba −3.4% (47 tr), con perdedora media −6.7% vs ganadora
+3.0% — el usuario objetó "gana 1% y arriesga 20%, no es rentable".

**Filtro de volatilidad (ATR%) — backtest_rsi2_volfilter.mjs, 250 tickers, 5y, 14120 señales:**
| Filtro | n | %/tr | PF | ganaMed | perdMed | peor | WF |
|---|---|---|---|---|---|---|---|
| SIN | 14120 | +0.42 | 1.39 | +2.23 | −3.14 | −30.66 | 3/4 |
| ATR%≤5 | 13239 | +0.28 | 1.27 | +1.97 | −2.97 | −25.70 | 3/4 |
| ATR%≤3 | 10535 | +0.21 | 1.23 | +1.71 | −2.63 | −20.04 | 3/4 |
→ **REFUTADO**: el filtro EMPEORA monótonamente (%/tr y PF bajan). Los nombres
volátiles llevan TANTO las ganadoras grandes como las perdedoras — cortarlos
encoge las dos colas por igual y la asimetría no mejora (ratio 0.71→0.65). No se
puede quitar la pérdida sin quitar la ganancia. NO aplicar.

**Reconciliación clave:** el BACKTEST de RSI2 (5y, 14120 tr) es SÓLIDAMENTE rentable
(+0.42%/tr, PF 1.39, clava la validación +0.41/1.36). El forward −3.4% es un
ARTEFACTO DE MUESTRA CHICA (47 tr vs 14120): mean-reversion tiene cola gorda (peor
histórico −30% por gaps que rebasan el −20%), así que 2-3 gaps malos en 47 trades
dominan. La asimetría (gana +2.2/pierde −3.1) ES rentable porque el WR 68% compensa:
0.68×2.23 − 0.32×3.14 = +0.52 ≈ +0.42/tr. NO es un bug — es la naturaleza, y funciona
con muchas operaciones, no con 47.

**DECISIÓN (usuario 2026-08-04): mantener TODOS los sistemas activos, RSI2 sin tocar
la spec.** CHECKPOINT: si a ~150-200 forward sigue negativo → fallo real, no ruido.
Todos los filtros probados (safety-net, gap-guard, distancia, volatilidad): ninguno
mejora RSI2 de forma robusta (WF 4/4). La spec validada se queda como está.

## EMA 8/21 semanal — análisis MAE/MFE y salida óptima (2026-08-14)

`backtest_ema_mfe.mjs` sobre 2585 LONG (250 tickers, 10y). Perfil por trade (salida=cruce):
- MFE (máx a favor): mediana **10.7%**, media **31.8%** ← la media >> mediana = cola gorda (pocos trends enormes cargan todo).
- MAE (máx en contra): mediana −8.1%, peor −62.6%.
- final@cruce: mediana **−4.5%** (¡el trade típico pierde!), media **+7.6%**.
- giveback pico→cruce: mediana 16.8%. Duración: 17 semanas.
- MAE de las GANADORAS: mediana −5.6%, **p90 −14.2%** → un stop más ajustado que ~15% mata ganadores.

**Comparativa de salidas (Σret / PF):** cruce contrario **+19618 / PF 2.35** (mejor). Trailing 15/20/30% = PF 1.50/1.71/1.95 (peor). Toma fija +25/40% = PF 1.45/1.60 (peor). **Cruce + stop duro −18% = +19662 / PF 2.38** (marginalmente mejor, corta la cola de −62% sin tocar ganadores).

**CONCLUSIÓN (regla de oro trend-following):** intentar "capturar el pico antes de la reversión" con trailing o toma fija DESTRUYE el edge — corta los pocos trends monstruo que SON la ventaja. La salida óptima es el **cruce contrario**, aceptando el giveback. Única mejora libre: **stop de catástrofe en −18%** (los ganadores rara vez caen >14% en contra). NO usar trailing ni toma fija.

## EMA 8/21 — timing de entrada: ANTICIPACIÓN valida (2026-08-14)

`backtest_ema_timing.mjs`: entrar 1 semana antes con previsión perfecta lleva PF 2.35→4.18 (+7.59→+12.04%/tr), mejor el 87% de las veces → hay premio real por adelantar. Cota máxima teórica.

`backtest_ema_anticip.mjs` (CAUSAL, sin trampa, incluye falsos): entrada por convergencia del hueco EMA8-EMA21 (= regla del radar), salida por cruce contrario. LONG, 250t 10y:
| entrada | n | %/tr | WR | PF | Σret% |
|---|---|---|---|---|---|
| confirmado (cruce) | 2585 | +7.59 | 33% | 2.35 | +19618 |
| anticipado gap<0.5% | 1567 | +6.69 | 36% | 2.36 | +10488 |
| anticipado gap<0.8% | 1932 | +7.19 | 38% | 2.46 | +13890 |
| **anticipado gap<1.2%** | 2144 | **+8.74** | **40%** | **2.81** | +18731 |

**CONCLUSIÓN:** anticipar por convergencia MEJORA de verdad (PF 2.35→2.81, WR 33→40%) neto de señales falsas. La banda óptima de entrada es gap<1.2%. `radar_emacross.mjs` implementa esto (umbral 0.8% por defecto, conservador; corre jueves). No es solo watchlist: entrar en la banda es mejor entrada que esperar al cierre del cruce.

## WeeklySwing — análisis MAE/MFE: la salida actual (13/time/stop) es óptima (2026-08-14)

`backtest_weekly_mfe.mjs` (190 trades, 250t 10y, misma lógica que el scanner). Perfil por trade:
- MFE mediana 36.5% / media **63.7%** (cola aún más gorda que EMACross). MAE mediana −9.9% / peor −44.2%.
- final mediana +8.5% / media +40.1%. Giveback mediana 17%. Duración mediana 33 sem.
- Motivo de salida: STOP 47% · TIME(52w) 31% · countdown-13 18% · END 4%.

**Comparativa de salidas (PF / Σret):** actual 13/time/stop **7.51 / +7617** (mejor). Trailing 30/40% = 7.03/7.06. Toma fija +25/50/80% = 2.99/3.91/5.12 (peor). 

**CONCLUSIÓN:** igual que EMACross — NO poner toma de beneficios. La salida por agotamiento (countdown-13) + time-stop + stop estructural captura los trends monstruo (MFE media +64%); cualquier TP fijo hunde el PF (de 7.51 a ~3). El WR ya es alto (53%) por el suelo del setup-9 + stop 8%. El countdown-13 solo cierra el 18% (el stop y el time hacen el grueso), pero la combinación es la óptima. Confirmado: las dos trend-following (EMACross, WeeklySwing) NO usan TP; las de reversión (RSI2, DeMark, BreakoutRetest) SÍ.

## EMACross — BACKTEST CONSOLIDADO del sistema final (2026-08-14)

`backtest_emacross_full.mjs` (249 acciones, 10y semanal, LONG-only, stop −18%, salida cruce, coste 0.06%/lado):

| | CONFIRMADO (cruce) | ANTICIPADO (gap<1.2%) |
|---|---|---|
| trades | 2589 | 2328 |
| WR | 33% | 38% |
| PF | 2.36 | 2.42 |
| expectancy | +7.57%/tr | +7.50%/tr |
| ganadora/perdedora media | +39.7% / −8.3% | +34.1% / −8.5% |
| payoff | 4.80x | 4.03x |
| mejor / peor | +1443% / **−18%** | +1099% / **−18%** |
| duración mediana | 16 sem | 19 sem |
| salidas por stop −18% | 7% | 13% |
| retorno/drawdown | 11.0x | 9.9x |
| walk-forward | **4/4** | **4/4** |

Por año (expectancy, entrada): fuerte en años alcistas (2020 +27%, 2023 +24%), plano/negativo en choppy/bear (2018 −3%, 2022 −2%, 2026 −9%). **Regime-dependent**, como toda trend-following.

**Lecturas clave:**
- El stop −18% FUNCIONA: la peor operación queda capada exactamente en −18% (sin él había −62%). Solo cierra el 7-13% de trades → no estorba a los ganadores.
- Payoff ~4-5x compensa el WR bajo (33-38%): pierdes pequeño y seguido, ganas grande y de vez en cuando. Perfil win-big/lose-small confirmado.
- Anticipado sube WR (33→38%) y PF (2.36→2.42) con menos trades — mejor entrada, como ya vimos.
- WF 4/4 en ambos = edge estable en las 4 ventanas temporales (no un artefacto de un solo régimen).
- ⚠️ Sesgo de supervivencia (universo de hoy sobre el pasado) → son números de EDGE RELATIVO, no retorno garantizado. Por eso el sistema es SHADOW hasta acumular forward propio. El drawdown de −1775% es de la curva equiponderada acumulada (no compón.), no de una cuenta real con sizing.

## EMACross — filtro de FRESCURA (extensión sobre EMA21): NO usar (2026-08-14)

`backtest_emacross_ext.mjs` (250t 10y, LONG, stop −18%, salida cruce). Filtrar por baja extensión al entrar EMPEORA:
| filtro | n | WR | PF | exp%/tr | WF |
|---|---|---|---|---|---|
| TODOS | 2590 | 33% | **2.36** | +7.56 | 4/4 |
| ext<8% | 1975 | 30% | 1.64 | +3.31 | 3/4 |
| ext<5% | 1287 | 26% | 1.16 | +0.79 | 3/4 |
| ext<3% | 621 | 23% | 1.01 | +0.03 | 1/4 |

**CONCLUSIÓN (corrige la intuición "fresco = mejor entrada"):** la extensión sobre la EMA21 NO es "llegas tarde" — es MOMENTUM. El cruce extendido (precio bien por encima de EMA21) es una tendencia potente y rinde MEJOR; el cruce fresco (pegado a EMA21) es tibio y whipsapea. Filtrar a frescos deja los cruces débiles → breakeven. **Entrar en TODOS los cruces es óptimo.** El radar muestra la extensión SOLO como info (no como filtro ni prioridad). Regla de oro reconfirmada: no aplicar una intuición sin backtestearla.

## EMACross — filtro de RÉGIMEN de mercado (SPY vs EMA40s): NO usar (2026-08-16)

`backtest_ema_regime.mjs` (250t 10y, long+short, stop ±18%). SPY: 81% semanas BULL / 19% BEAR.
| estrategia | n | WR | PF | exp% | WF |
|---|---|---|---|---|---|
| A) Long-only TODO (actual) | 2587 | 33% | **2.36** | +7.57 | 4/4 |
| B) Long-only en BULL | 2222 | 33% | 2.29 | +7.15 | 4/4 |
| Long en BEAR (control) | 365 | 33% | **2.84** | +10.13 | 4/4 |
| C) Short-only en BEAR | 893 | 13% | **0.22** | −6.86 | **0/4** |
| D) Régimen-switch (Lbull+Sbear) | 3115 | 27% | 1.48 | +3.13 | 2/4 |

**CONCLUSIÓN (refuta la hipótesis "shorts en bear / regime-switch"):**
- Filtrar longs por régimen EMPEORA (B 2.29 < A 2.36). Los longs en BEAR son los MEJORES (PF 2.84) — los mejores cruces alcistas ocurren con SPY aún bajo su media (suelos/inicio de recuperación); filtrarlos quita las mejores entradas.
- Shorts NO funcionan ni en bear (PF 0.22, WF 0/4): el cruce 8/21 semanal come los rallies de rebote/short-squeeze. WR 13%.
- Régimen-switch (D) PEOR que long-only (1.48 < 2.36). **Se mantiene long-only en todo régimen.**
- Nota: el 8/21 no es vehículo bajista; una estrategia para el giro necesitaría OTRO diseño (sistema aparte).

## EMACross — MID/SMALL caps (2026-08-16)

`backtest_midsmall.mjs` (996 tickers $300M-$8B, 10y, long-only stop -18%): PF **1.65**, WR 25%, exp +5.61%/tr, ganadora media **+57.5%** (tienden más fuerte que large), perdedora −11.5%, WF 4/4. Peor que large-cap (PF 2.36) y **optimista** por supervivencia. Los ganadores son mayores pero más whipsaw y pérdidas más grandes. Large-cap sigue siendo el núcleo; mid/small solo como shadow de baja convicción si se quiere. Split MID vs SMALL en curso.

## EMACross — comparación por TEMPORALIDAD (2026-08-16)

`backtest_ema_tf.mjs` (200 large-caps, long-only stop -18%, salida cruce):
| TF | n | WR | PF | exp/tr | ganaMed | durMed | WF |
|---|---|---|---|---|---|---|---|
| DIARIO | 10918 | 35% | 1.76 | +2.01% | +13% | 17 días | 4/4 |
| **SEMANAL** | 2060 | 34% | **2.52** | +8.22% | +40% | 17 sem | 3/4 |
| MENSUAL | 650 | 34% | **7.48** | +65.85% | +224% | 11 meses | 4/4 |

**CONCLUSIÓN:** TF más alto = menos señales, mucha más calidad (principio trend-following confirmado). **SEMANAL sigue siendo lo correcto** (equilibrio señales/calidad/holds). DIARIO descartado (PF 1.76, mucho ruido). MENSUAL seductor (PF 7.48, ganadora +224%) pero IMPRÁCTICO: sesgo de supervivencia MÁXIMO (holds de 11 meses = solo supervivientes), muestra pequeña (650), señales rarísimas y capital inmovilizado ~1 año. No fiarse del 7.48.

## EMACross — ANTICIPADO vs CONFIRMADO a detalle + banda óptima 2.0% (2026-08-16)

`backtest_anticip_detail.mjs` (250 large-caps, 10y, long-only stop -18%, salida cruce).
Barrido de umbral de anticipación (convergencia del hueco EMA8-EMA21):
| entrada | n | WR | PF | exp/tr | WF |
|---|---|---|---|---|---|
| CONFIRMADO (cruce) | 2587 | 33% | 2.36 | +7.57% | 4/4 |
| anticip gap<0.5% | 1628 | 34% | 1.98 | +5.22% | 4/4 |
| anticip gap<1.2% | 2326 | 37% | 2.41 | +7.50% | 4/4 |
| anticip gap<1.5% | 2451 | 38% | 2.47 | +7.94% | 4/4 |
| **anticip gap<2.0%** | 2554 | **40%** | **2.52** | **+8.26%** | 4/4 |

Detalle banda 1.2%: 91% CONFIRMAN (entras 2 sem antes, 2.8% más barato → +10.06%/tr), 9% FALSOS (−18.12%/tr, tocan el stop). Neto a 1.2% = empate (+7.50 vs +7.57). A 2.0% = +0.69%/tr mejor que confirmado.

**CONCLUSIÓN:** anticipar SÍ captura más recorrido en los que funcionan (antes + más barato), pero cada falso cuesta −18%. Banda estrecha = empate; **banda ANCHA (2.0%) = mejor (PF 2.52 vs 2.36)** porque captura más cruces temprano. El backtest entra a ciegas; con CONFIRMACIÓN VISUAL el usuario filtra falsos → inclina la balanza aún más a favor. **Ajustado radar + Pine a gap 2.0%.**

## EMACross + DeMark 9-13 — combinaciones (2026-08-16)

`backtest_ema_demark_combo.mjs` (250 large-caps, 10y semanal, long-only stop -18%):
| variante | n | WR | PF | exp/tr | dur | WF |
|---|---|---|---|---|---|---|
| BASE (EMACross puro) | 2587 | 33% | 2.36 | +7.57% | 25 sem | 4/4 |
| **D9-ENTRY (setup-9 → salida cruce↓)** | 818 | 54% | **3.30** | +13.61% | 30 sem | 4/4 |
| D13-EXIT (cruce↑ → salida cd-13) | 2654 | 39% | 2.13 | +5.74% | 17 sem | 4/4 |
| D9+D13 (setup-9 → cd-13 = WeeklySwing) | 843 | 55% | 3.46 | +14.23% | 26 sem | 4/4 |
| Confluencia (cruce + D9 en <8v) | 223 | 36% | 3.18 | +11.59% | 26 sem | 4/4 |

**CONCLUSIÓN (continuidad):** salir con el 13 (D13-EXIT) EMPEORA (PF 2.36→2.13, dur 25→17 sem) — fadea la tendencia y corta ganadores, contra la continuidad. El ganador es **D9-ENTRY: usar el Setup-9 para entrar temprano (en el suelo, antes del cruce) y RODAR hasta el cruce contrario** (PF 3.30, WR 54%, +13.6%/tr). DeMark mete temprano en el giro (captura recorrido); la continuidad (cruce EMA) manda en la salida, NO el 13. Pero n=818 (subconjunto alta convicción) solapa con DeMark-9/WeeklySwing ya existentes. Pendiente: continuación pura por TDST break.

## WeeklySwing — ¿filtrar por tendencia? NO (2026-08-17)

Duda real del usuario (caso CCI): el Setup-9 semanal dispara con las EMAs claramente bajistas;
¿conviene exigir tendencia alcista de fondo, como hace el DeMark diario (EMA50>EMA200)?

`backtest_weekly_filter.mjs` (250 large-caps, 10y):
| filtro | n | WR | PF | exp/tr | WF |
|---|---|---|---|---|---|
| **SIN filtro (actual)** | 193 | 51% | **7.63** | +39.47% | **4/4** |
| precio > EMA30 sem | 21 | 43% | 1.21 | +1.53% | 1/4 |
| precio > EMA50 sem | 29 | 45% | 3.05 | +14.18% | 1/4 |
| EMA10 > EMA30 sem | 26 | 42% | 3.54 | +18.70% | 1/4 |
| precio > SMA200 sem | 74 | 47% | 4.47 | +22.11% | 2/4 |

**CONCLUSIÓN:** filtrar por tendencia DESTRUYE el sistema — elimina 62-89% de las señales y TODAS las variantes suspenden el walk-forward. El Setup-9 ES por definición una señal de cuchillo cayendo (9 semanas de caída ⇒ EMAs bajistas); exigir tendencia alcista quita justo los mejores rebotes. **WeeklySwing se queda SIN filtro de tendencia.** Que las EMAs estén bajistas es el REQUISITO, no una contraindicación (caso CCI = señal legítima).
⚠️ n=193 (muestra modesta) y PF inflado por supervivencia; lo robusto aquí es la comparación relativa (filtro empeora en todas las ventanas).

## EMACross — ¿filtro de momentum en la anticipación? NO (2026-08-17)

Duda del usuario: ¿un filtro de momentum mejora la anticipación y permite quitar el factor humano?
`backtest_anticip_momentum.mjs` (250 large-caps, 10y, anticipación gap<2% convergiendo, stop -18%):
| filtro | n | PF | exp/tr | %falsas | WF |
|---|---|---|---|---|---|
| SIN filtro | 2550 | **2.52** | +8.26% | 12% | 4/4 |
| precio sube 2 sem | 2507 | 2.50 | +8.14% | 12% | 4/4 |
| precio sube 4 sem | 2406 | 2.51 | +8.33% | 11% | 4/4 |
| precio > EMA5 | 2540 | 2.53 | +8.31% | 12% | 4/4 |
| EMA8 sube 2 sem | 2287 | 2.46 | +8.20% | 11% | 4/4 |
| sube 4s + precio>EMA5 | 2403 | 2.50 | +8.33% | 11% | 4/4 |

**CONCLUSIÓN:** el filtro de momentum NO aporta — la anticipación (EMAs convergiendo al alza) YA contiene el momentum, así que el filtro es redundante (PF ~2.52 sin cambio, %falsas ~12% sin cambio). El 12% de falsas es IRREDUCIBLE: también tienen momentum al entrar y su reversión no es predecible; el stop -18% es la red. IMPORTANTE: la anticipación SISTEMÁTICA (a ciegas, sin humano) ya bate al confirmado (2.52 vs 2.36) → se PUEDE quitar el factor humano y operar mecánico. No añadir filtro de momentum.

## EMACross — SELECCIÓN con capital limitado: ranquear por FUERZA (2026-08-17)

Problema real: no hay capital para todas las señales; ¿cuáles elegir? `backtest_ranking.mjs`
(250 large-caps, 10y, entradas en tercios por métrica):
| ranquear por | tercio bajo | tercio medio | tercio ALTO |
|---|---|---|---|
| Extensión s/EMA21 | PF 1.09 (+0.4%) | 1.63 | **PF 3.86 (+18.7%, WR 41%)** |
| Momentum 12 sem | 1.81 (+4.1%) | 2.04 | **3.04 (+13.3%)** |
| Momentum 26 sem | 2.20 | 1.48 | **3.26 (+13.0%)** |

**CONCLUSIÓN:** las señales MÁS FUERTES (extendidas / con más momentum) son las ganadoras — tercio alto ≈ 3.5× el bajo, consistente en las 3 métricas. Las "pegadas y seguras" (tercio bajo de extensión) son breakeven (PF 1.09) = coincide con "filtrar a frescas empeora". REGLA DE SELECCIÓN con capital limitado: priorizar las de MAYOR extensión sobre EMA21 / mayor momentum, NO las pegadas. Contraintuitivo (parece perseguir) pero robusto. La extensión es SOLO para RANQUEAR/seleccionar, nunca para descartar (el sistema entra en todas si hay capital).

## EMACross — ¿filtro por EMA200 semanal (solo entrar sobre la 200)? NO (2026-08-18)

Duda del usuario: ¿mejora entrar solo con precio por encima de la EMA200 (tendencia mayor alcista)?
`backtest_ema200_filter.mjs` (250 large-caps, 242 con datos, 10y, stop -18%, salida cruce):
| MODO | variante | n | WR | PF | exp/tr | Σret | WF |
|---|---|---|---|---|---|---|---|
| Confirmado | SIN filtro (actual) | 1569 | 34% | **2.12** | +6.07% | **+9522%** | 3/4 |
| Confirmado | close > EMA200 | 1278 | 31% | 1.64 | +3.57% | +4560% | 3/4 |
| Confirmado | EMA8 > EMA200 | 1137 | 31% | 1.65 | +3.56% | +4047% | 3/4 |
| Anticipado | SIN filtro (actual) | 1415 | 38% | **2.31** | +6.92% | **+9787%** | 4/4 |
| Anticipado | close > EMA200 | 1112 | 37% | 1.77 | +4.03% | +4477% | 4/4 |
| Anticipado | EMA8 > EMA200 | 1020 | 36% | 1.75 | +3.93% | +4010% | 4/4 |

**CONCLUSIÓN:** el filtro EMA200 EMPEORA el sistema — corta la rentabilidad casi a la mitad (Σret +9787%→+4477%) y baja el PF de 2.31 a 1.77 en ambos modos. Vetó 668 trades en Anticipado, y eran de los BUENOS: cuando la EMA8 cruza al alza la EMA21 estando el precio aún DEBAJO de la EMA200, se está pillando el giro de tendencia TEMPRANO = el de mayor recorrido posterior. Exigir precio>EMA200 obliga a entrar tarde, con el movimiento ya maduro. Coherente con "filtrar a frescas empeora" y con el ranking por fuerza. NO añadir filtro EMA200 (ni de tendencia mayor en general): los mejores cruces del EMACross nacen POR DEBAJO de la media de 200.

## OTRAS CLASES DE ACTIVO — ¿sirve el EMA8/21? (2026-08-18)

`backtest_multiasset.mjs` (10 años semanal, SIN sesgo de supervivencia, coste 0.06%/lado). Listón = acciones PF 2.52 WF 4/4.

**FOREX (20 pares) — NO transfiere:**
| variante | PF | WF |
|---|---|---|
| Long-only Anticipado | 1.20 | 2/4 |
| Long-only Confirmado | 0.67 | 1/4 |
| Long+Short (ambos modos) | 0.44-0.67 | 0-1/4 |

CONCLUSIÓN forex: el cruce EMA NO vale (no hay deriva alcista). Confirma por qué el sistema forex en vivo usa DeMark/FOTSI/DVA, NO este cruce. No tocar.

**MATERIAS PRIMAS (22 futuros) — solo un subconjunto robusto:**
- Global long-only anticipado: PF 1.69 pero WF 2/4 (régimen). Long+Short = negativo (los cortos matan).
- Por subgrupo (long-only anticipado):
  | subgrupo | PF | exp | WF |
  |---|---|---|---|
  | **Metales preciosos (GC/SI/PL/PA)** | **2.43** | +6.71% | **4/4** ✅ |
  | Ganado (LE/HE/GF) | 1.56 | +2.82% | 3/4 🟡 |
  | Energía | 1.68 | +4.43% | 1/4 ❌ |
  | Agrícolas | 1.46 | +2.58% | 2/4 ❌ |
  | Cobre | 2.02 | +4.61% | 1/4 (9tr) ❌ |

CONCLUSIÓN materias primas: igual que en acciones, el edge está en un SUBCONJUNTO. **METALES PRECIOSOS = edge robusto (PF 2.43, WF 4/4, long-only anticipado)** — candidato real, misma lógica que el sistema de acciones. Ganado secundario (WF 3/4). Energía/agrícolas/cobre = régimen, NO robusto. Cortos OFF en todo (pierden). Cautela: 44 trades (muestra modesta vs miles en acciones) → validar forward antes de real, misma disciplina.

## EMACross — ENCIMA vs DEBAJO de la EMA200 (no filtrar, comparar cubos) (2026-08-19)

Reformulación del filtro EMA200: en vez de filtrar, se COMPARAN los dos grupos de entradas (modo Anticipado, 250 large-caps, 10y):
| grupo | trades | WR | PF | exp/tr | Σret | WF |
|---|---|---|---|---|---|---|
| Todas | 1425 | 38% | 2.35 | +7.07% | +10073% | 4/4 |
| Entrada ENCIMA EMA200 | 1106 | 37% | 1.80 | +4.16% | +4599% | 4/4 |
| **Entrada DEBAJO EMA200** | 319 | 41% | **4.16** | **+17.16%** | +5474% | 3/4 |

CONCLUSIÓN: al revés de la sabiduría popular. Entrar DEBAJO de la EMA200 (cruce 8/21 naciente desde el fondo = giro temprano) rinde >2x el PF y >4x la expectancy que encima. Los 319 de debajo (22%) generan MÁS Σret que los 1106 de encima. Confirma por qué el filtro EMA200 empeoraba: quitaba las joyas. NO filtrar por encima de la 200. ⚠️ PENDIENTE de auditar por outliers/supervivencia (ver sección siguiente): el cubo debajo-200 es el MÁS expuesto a sesgo de supervivencia (las que rebotan sobreviven, las que siguen cayendo a cero no están en el universo).

## ⚠️ AUDITORÍA ESCÉPTICA — cuestionar todo antes de real (2026-08-19)

`backtest_audit.mjs` — ataque a los pilares. Hallazgos que CAMBIAN cómo hay que operar:

**1) DEPENDENCIA DE OUTLIERS (lo más importante):**
- **MEDIANA por trade = −3.01% (NEGATIVA).** El trade típico PIERDE. La media +7.07% la sostienen unos pocos pelotazos.
- Top-10 trades = 19% de todo el beneficio (39% en el cubo debajo-200).
- **PF 2.35 → sin el top-5% de ganadoras → PF 1.08 (breakeven).** Encima-EMA200 sin top5% = PF 0.85 (PIERDE). Debajo-200 aguanta mejor (4.16→2.16).
- ⇒ Es un sistema de SESGO POSITIVO (trend-following clásico): pierdes poco a menudo, ganas mucho rara vez. Legítimo, pero exige CAPTURAR los pocos ganadores. Con 5 posiciones y capital limitado, si no cazas un pelotazo te quedas en breakeven.

**2) RÉGIMEN (expectancy por año de entrada):**
2020:+28% · 2021:+4% · 2022:−2% · 2023:+16% · 2024:+3% · 2025:+4% · 2026:−7%
- **En el año bajista (2022) PIERDE. 2026 en curso −7%.** Los años buenos (2020/2023) cargan todo. El "WF 4/4" que citábamos eran 4 trozos de UNA década alcista, NO out-of-sample real. Sangra en mercados bajistas/laterales.

**3) REALISMO DE ENTRADA (✅ pasa limpio):**
Cierre de vela señal PF 2.35 vs apertura siguiente semana PF 2.37 — idéntico. El edge NO depende de entrar al cierre exacto.

**4) STOP -18%:** 13% de trades salen por stop (16% debajo-200). Riesgo de cola acotado, coherente con ~12% de falsas.

**VEREDICTO:** el edge es REAL pero NO es el "PF 2.5 dinero fácil" que parecía. Es un sistema de cola gorda: mediana negativa, el dinero llega en grumos de pocos ganadores grandes. Implicaciones para real: (a) 5 posiciones es POCO para muestrear la cola con fiabilidad → conviene más posiciones/menor tamaño si el capital lo permite, o asumir varianza alta; (b) NO evitar las "que dan miedo" (debajo-200, muy extendidas) — ESAS son las ganadoras; (c) aguantar hasta el cruce contrario (los pelotazos necesitan tiempo); (d) esperar rojo la mayor parte del tiempo; (e) en mercado bajista, sangra — vigilar régimen. Supervivencia sigue inflando todo (más el cubo debajo-200).

## NUESTRO DeMark (setup-9/cd-13) en ACCIONES — vs EMACross, misma lupa escéptica (2026-08-19)

`backtest_demark.mjs` — usa el motor verificado `scanner/demark_calc.mjs` (réplica fiel del Pine Mantilla PB DeMARK 9-13). 246 large-caps, 10y semanal, una posición a la vez, coste 0.06%/lado.

**COMPARATIVA DIRECTA (ambos con stop -18%, una posición a la vez):**
| métrica | EMACross | DeMark SETUP-9 |
|---|---|---|
| trades | 1425 | 873 |
| WR | 38% | **61%** |
| PF | 2.35 | **2.81** |
| MEDIANA/trade | **−3.0%** ❌ | **+9.43%** ✅ |
| PF sin top-5% | **1.08** (breakeven) | **1.95** ✅ |
| peor año (2022 bajista) | **−2%** ❌ | **+4%** ✅ |
| ¿todos los años +? | NO (2022,2026 neg) | **SÍ, los 11 años** ✅ |
| WF | 4/4 | 4/4 |

**DeMark SETUP-9 es MÁS ROBUSTO que EMACross en TODAS las dimensiones escépticas**: gana la mayoría de trades (mediana +9%, no depende de pelotazos), aguanta quitar el top-5% (1.95 vs 1.08), y es rentable CADA año incluido el bajista 2022 donde EMACross sangraba. Razón: setup-9 compra AGOTAMIENTO/suelos (mean-reversion) → funciona en lateral y bajista, justo donde el trend-following (EMACross) falla. **Son COMPLEMENTARIOS** (tendencia + reversión).

**Matices/debilidades (sigue el escepticismo):**
- SETUP-9 salida NATIVA (stop=setupLow tight, exit cd13/52w): PF 6.09 pero MEDIANA −8.2%, 51% stops = muerte por mil cortes. El stop AMPLIO −18% + salida en setup-9 opuesto es MUY superior (mediana +9.4%). ⚠️ sugiere revisar el stop de WeeklySwing en vivo (usa setupLow) → probar −18%. Nota: native y cat18 difieren en stop Y en trigger de salida; falta aislar cada uno.
- COUNTDOWN-13 solo: PF 1.42, WF 2/4, mediana −9.9%, se hunde sin top-5% (0.79). NO es edge por sí solo — confirma la cautela histórica sobre el 13.
- Mismo sesgo de supervivencia que EMACross (comprar sobrevendido incluye value-traps que no están en el universo → algo inflado; el −18% acota).

## CARTERA COMBINADA EMACross + DeMark (50/50) — ¿diversifica y tapa 2022? SÍ (2026-08-19)

`backtest_combo.mjs` (246 large-caps, 10y, ambos LONG stop -18%, curva por media trimestral):
- **Correlación trimestral ρ = 0.47** (media) — suficiente para diversificar.
- **Max drawdown: EMA −25% · DeMark −21% · COMBINADO −17%** → la combinación tiene MENOS drawdown que CUALQUIERA de los dos solos. Peor trimestre: −13.1% cada uno → −10.6% combinado.
- **Año a año la cartera combinada es POSITIVA TODOS los años**, incluidos los que EMACross perdía:
  | año | EMA | DeMark | COMBO |
  |---|---|---|---|
  | 2018 | −2% | +7% | +3% ✅ |
  | 2022 | −2% | +4% | +1% ✅ |
  (resto: todos verdes; años grandes 2020 +33%, 2023 +18%, 2025 +24%)

CONCLUSIÓN: combinar los dos sistemas REDUCE el drawdown ~32% (−25%→−17%) y convierte en positivos los años malos de EMACross (2018, 2022) manteniendo casi todo el upside. DeMark rescata justo cuando el trend-following sufre (lateral/bajista). Cartera combinada = más suave y robusta que cualquiera solo. Recomendación de asignación: repartir capital entre ambos sistemas, no todo a EMACross.

## WeeklySwing — AISLAR el STOP: setupLow vs -18% (2026-08-19)

`backtest_ws_stop.mjs` — mismas señales (todos los setup-9, sin filtro riesgo), MISMA salida, SOLO cambia el stop.
| salida | stop | WR | PF | MEDIANA | sin-top5% | %stop | WF |
|---|---|---|---|---|---|---|---|
| cd13/52w (VIVO) | **setupLow** | 23% | 5.25 | **−2.5%** | 1.87 | **76%** | 4/4 |
| cd13/52w | **−18%** | 54% | 4.12 | **+5.4%** | 2.32 | 37% | 4/4 |
| setup-9 opp | setupLow | 27% | 3.00 | −2.2% | 1.55 | 73% | 4/4 |
| setup-9 opp | **−18%** | 61% | 2.81 | **+9.4%** | 1.95 | 34% | 4/4 |

CONFIRMADO: el stop −18% es CLARAMENTE superior al setupLow con la salida fija. Mediana pasa de NEGATIVA a POSITIVA, WR se duplica (23→54%), robustez sube (sin-top5% 1.87→2.32), te barren la mitad (%stop 76→37%), mejor casi cada año (2018 −0→+11, 2023 +10→+25). El único "peor" es el PF (5.25→4.12) = espejismo del stop estrecho (pérdidas diminutas inflan el PF, no es más edge). El setup-9 es reversión: el stop estrecho saca con el primer ruido ANTES del rebote; el −18% le da aire. ⇒ ACCIÓN: cambiar el stop de WeeklySwing en vivo (`scanner_weekly.mjs`) de setupLow a −18% y quitar el filtro de riesgo 8-30% (con stop fijo ya no aplica). Contradice la lección #9 del CLAUDE.md (que era para forex/DeMark diario); en acciones semanal, −18% gana.

## CAPITAL LIMITADO — ¿se rompe el edge? ¿uno o dos sistemas? (2026-08-19)

`backtest_capital.mjs` — N sleeves (N posiciones máx), señales por ORDEN DE LLEGADA (sin cherry-picking), cada sleeve compone. 246 acciones, 10y.
| N | sistema | tomadas | x10y | CAGR | maxDD | mediana |
|---|---|---|---|---|---|---|
| 5 | EMACross solo | 81/2484 (3%) | x3.7 | 14% | **−26%** | +0.4% |
| 5 | DeMark solo | 106/873 (12%) | x1.9 | 7% | **−51%** | +6.0% |
| 5 | Combinado | 98/3357 (3%) | **x4.2** | **16%** | −33% | −2.0% |
(patrón consistente en N=3 y N=8: DeMark solo SIEMPRE el peor maxDD −49..−57%; combinado mejor o casi-mejor return y en N=3/8 el mejor maxDD −21/−23%.)

CONCLUSIONES:
1. **El edge NO se rompe con capital limitado.** Tomando señales por orden de llegada (SIN cherry-picking), todas las configs dan CAGR +7..16%. El miedo "se cae el sistema" es infundado SI se selecciona mecánicamente, no por gusto. El peligro real = cherry-picking por sesgo (value bias), no la falta de capital.
2. **DeMark SOLO es el PEOR bajo capital limitado** (maxDD −51%, x1.9) pese a su mejor calidad por-trade: baja frecuencia (873 señales) + holds largos (hasta 52w) → pocas posiciones → concentración → drawdowns profundos. Su edge per-trade necesita MUCHAS posiciones para cosecharse sin concentración.
3. **EMACross solo** = mejor standalone bajo capital tight (más señales → más rotación → diversificación → maxDD −26%).
4. **Combinado** = mejor return y (en N=3/8) mejor maxDD: más fuentes de señal mantienen los slots llenos y diversifican dos edges poco correlacionados. Capital limitado NO significa abandonar un sistema — significa tomar menos de CADA uno pero mantener ambos alimentando la cola.
⚠️ Sims con 47-163 trades tomados = ALTA varianza (order-dependent). Robusto: (a) el edge sobrevive, (b) DeMark solo concentra mal, (c) cherry-picking por sesgo es el riesgo real → usar regla de selección MECÁNICA (por fuerza/ranking).

## CONFLUENCIA — cruce EMA + setup-9 reciente debajo (idea del usuario) (2026-08-19)

`backtest_confluence.mjs` — entrar en el cruce EMA8/21 SOLO si hubo un Buy Setup-9 dentro de las últimas K velas (el 9 respalda el giro). 246 large-caps, 10y, stop -18%.
| filtro | n | WR | PF | exp | MEDIANA | sin-top5% | WF |
|---|---|---|---|---|---|---|---|
| EMA anticip SOLO (baseline) | 2484 | 41% | 3.24 | +11.2% | −2.5% | 1.35 | 4/4 |
| **EMA + 9 en ≤13 velas** | **529** | 43% | **4.28** | **+15.3%** | −2.0% | **1.66** | 4/4 |
| EMA + 9 en ≤26 velas | 815 | 40% | 3.34 | +12.1% | −2.8% | 1.30 | 4/4 |
| EMA + 9 en ≤52 velas | 1166 | 40% | 3.21 | +11.3% | −2.6% | 1.27 | 4/4 |

CONCLUSIÓN: la confluencia FUNCIONA como filtro de calidad, pero SOLO con ventana TIGHT (9 en ≤13 semanas = giro reciente). Mejora PF 3.24→4.28, expectancy +11.2%→+15.3%, robustez sin-top5% 1.35→1.66 (menos dependiente de outliers). Ventanas anchas (26/52) ≈ baseline (deja de filtrar). Coste: ~1/5 de las señales (529 vs 2484 = ~53/año ≈ 1/semana en todo el universo). ⇒ IDEAL para capital limitado: menos señales (menos presión de sesgo, las tomas casi todas) Y de más calidad, en UNA sola señal combinada. LÍMITES honestos: NO arregla la mediana negativa (−2.0%, sigue siendo sistema de cola/positive-skew → necesita ganadores) NI el año bajista 2022 (−2%). Es un EMACross MEJOR, no un sistema distinto. Perfil distinto a DeMark solo (mediana +9.4% pero avg menor).

## SÍNTESIS — apilar lo aprendido: ¿cuál es la MEJOR opción? (2026-08-19)

`backtest_synthesis.mjs` — stack de filtros sobre EMA anticipado (stop -18%, salida cruce). 242 large-caps, 10y.
| combinación | n | WR | PF | exp | MEDIANA | sin-top5% | WF |
|---|---|---|---|---|---|---|---|
| EMA anticip SOLO (baseline) | 1575 | 42% | 3.64 | +12.7% | −2.1% | 1.55 | 4/4 |
| EMA + confluencia 9 | 345 | 43% | 4.63 | +17.6% | −2.2% | 1.72 | 4/4 |
| EMA + debajo EMA200 | 378 | 45% | 4.73 | +18.2% | −1.7% | 2.48 | 4/4 |
| **EMA + 9 + DEBAJO 200 (STACK)** | **65** | 48% | **5.75** | +19.1% | **−0.3%** | **3.64** | 4/4 |
| EMA + 9 + encima 200 | 295 | 41% | 4.34 | +16.8% | −3.0% | 1.43 | 4/4 |
| DeMark setup-9 solo (ref) | 867 | 61% | 2.83 | +11.7% | **+9.5%** | 1.96 | 4/4 |

CONCLUSIÓN (síntesis): TODO lo aprendido apunta a lo MISMO — **reversión desde un suelo oversold cazada temprano**. Anticipado (timing) + Setup-9 (agotamiento) + debajo-EMA200 (reversión profunda) son 3 lentes del mismo fenómeno. Apilarlos mejora la robustez MONÓTONAMENTE: sin-top5% 1.55→1.72→2.48→**3.64**. El STACK (EMA+9+debajo200) deja de ser lotería de outliers y se vuelve edge FIABLE: PF 5.75, mediana casi-cero (−0.3% vs −2.1% baseline), sin-top5% 3.64, POSITIVO todos los años (2022 +3%, 2021 +21 vs +4, 2024 +16 vs +3). El "+encima 200" es el PEOR (mediana −3.0%) → confirma que la magia está DEBAJO de la 200 (reversión, no continuación). ⚠️ n=65 (pocas, ~6.5/año) = ruidoso en el número exacto, pero la mejora MONÓTONA de robustez al apilar es el takeaway sólido. Para capital limitado es IDEAL (pocas, ultra-calidad, se toman todas, sin sesgo). DeMark solo sigue siendo el de mediana positiva (+9.5%) y más frecuente = flujo estable. PRÁCTICA: marcar las confluencias que además están DEBAJO de la EMA200 = la crème de la crème (máxima prioridad dentro de máxima prioridad).

## CONFLUENCIA — ANTICIPADA vs YA CRUZADA, por separado (2026-08-19)

`backtest_confluence_split.mjs` (242 large-caps, 10y, stop -18%, salida cruce). El trigger es la única diferencia.
| variante | n | WR | PF | exp | MEDIANA | sin-top5% | WF |
|---|---|---|---|---|---|---|---|
| ANTICIPADA (todas) | 345 | 43% | 4.63 | +17.6% | −2.2% | 1.72 | 4/4 |
| └ anticipada DEBAJO 200 | 58 | 48% | 5.79 | +19.5% | −0.3% | 4.01 | 4/4 |
| └ anticipada encima 200 | 287 | 41% | 4.44 | +17.2% | −2.8% | 1.43 | 4/4 |
| YA CRUZADA (todas) | 314 | 40% | 4.72 | +19.1% | −3.5% | 1.78 | 4/4 |
| └ cruzada DEBAJO 200 | 33 | 58% | 5.41 | +19.6% | **+4.3%** | 4.29 | 3/4 |
| └ cruzada encima 200 | 281 | 38% | 4.65 | +19.1% | −4.1% | 1.54 | 4/4 |

CONCLUSIÓN: anticipada y ya-cruzada son ~EQUIVALENTES en agregado (PF 4.63 vs 4.72, ambas WF 4/4). Anticipada = mediana algo mejor (−2.2 vs −3.5%) y entra más barato; cruzada = PF/expectancy algo mayor (más certeza). NINGUNA domina claramente → CORRIGE la afirmación previa de "priorizar anticipada" (fue una sobreestimación; el backtest anticipado era el único hecho entonces). El factor DOMINANTE NO es anticipada-vs-cruzada, es **DEBAJO 200** (el stack): en ambos modos sin-top5% salta a ~4.0-4.3 (vs 1.4-1.5 encima). La cruzada+debajo200 tiene incluso MEDIANA POSITIVA (+4.3%) y WR 58%, pero n=33 (ruidoso, WF 3/4); la anticipada+debajo200 tiene más muestra (58, WF 4/4) con mediana −0.3%. PRÁCTICA: tomar la confluencia en CUALQUIER modo (cruzada o anticipada), priorizando SIEMPRE las de debajo-200 (stack). Anticipar = entrada más barata; esperar el cruce = más confirmación. Ambas válidas. ⚠️ buckets debajo-200 = 33-58 trades (ruido en el decimal; el patrón debajo≫encima es sólido).

## ¿Transfiere a DIARIO? NO — es un sistema SEMANAL (2026-08-19)

`backtest_daily.mjs` (200 large-caps, 5 años DIARIO, stop -18%, salida cruce). Comparado con semanal:
| config | DIARIO PF | DIARIO sin-top5% | DIARIO mediana | vs SEMANAL |
|---|---|---|---|---|
| EMA anticipado | 2.14 | 1.11 | −0.7% | peor (sem 2.35, sin-top5% 1.55) |
| EMA confirmado | 1.99 | **0.93** | −1.9% | peor (sin-top5%<1 = pierde sin outliers) |
| DeMark setup-9 | 2.57 | 1.79 | +5.8% · WR 71% | peor pero DECENTE (sem 2.83/+9.5%) |
| Confluencia (EMA+9) | 2.29 | 1.27 | −0.6% | MUCHO peor (sem 4.28) |
| ⭐⭐ STACK | 2.46 | **1.34** | −0.4% | MUCHO peor (sem sin-top5% 3.64) |

CONCLUSIÓN: el edge NO transfiere bien a diario. TODO se debilita y, lo crítico, la ROBUSTEZ (sin-top5%) se derrumba: la confluencia/stack que en semanal eran ultra-robustas (3.64) en diario quedan en 1.34 (frágiles, dependientes de outliers otra vez). El diario tiene 3-4× más señales (4552 vs 1575), más ruido, más coste, holds cortos (16-34d) y más trabajo de monitoreo. La "reversión desde el suelo" es un fenómeno SEMANAL; en diario es ruido. ÚNICA pieza que aguanta razonablemente en diario = DeMark setup-9 (WR 71%, mediana +5.8%, único con robustez decente 1.79) — patrón estructural de agotamiento que cruza timeframes; aun así MEJOR en semanal. VEREDICTO: quedarse en SEMANAL. No mover a diario. (Caveat: diario 5y y stop -18% probablemente ancho; un stop más ceñido podría cambiar detalles, pero la caída de robustez es estructural, no de calibración.)

## VALIDACIÓN FORMAL — Deflated Sharpe + PBO (Pilar 2) (2026-08-19)

`backtest_validation.mjs` — 12 variantes como "trials", series mensuales, 242 acciones, 10y.
- **Sharpe mensual**: el más alto = EMA anticipado (0.563). ⚠️ Confluencia/stack salen MÁS BAJOS (0.35) por artefacto: pocas señales → muchos meses a cero → el Sharpe-sobre-calendario premia FRECUENCIA, no calidad por-trade. (PF/skew dicen lo contrario: confluencia mejor por trade.) Dos lentes distintas, ambas válidas.
- **DEFLATED SHARPE del elegido (EMA antic)**: SR 0.563 vs SR0-por-azar (12 trials) 0.176; skew +1.99, kurt 9.79, T=75 meses → **DSR = 100%** ✅. El edge SUPERA el ajuste por multiple-testing: NO es un artefacto de data-mining entre nuestras variantes.
- **PBO (CSCV, S=8, 70 splits)** = **7.1%** ✅. El mejor in-sample sigue por encima de la mediana out-of-sample en el 93% de las particiones → NO overfit.

CONCLUSIÓN: el edge es estadísticamente REAL y robusto al multiple-testing (DSR 100%, PBO 7%). Nuestras auditorías informales (mediana, quitar top-5%, walk-forward) eran versiones caseras de esto y el test formal las confirma. ⚠️ PERO estos tests NO corrigen el SESGO DE SUPERVIVENCIA (universo = vivos de hoy) — eso es una inflación SEPARADA y sin corregir → el edge EN VIVO será menor que el backtest. Por eso el sizing fraccional (¼ Kelly) NO es opcional. skew +1.99 confirma la asimetría (cola derecha gorda). El Sharpe premia frecuencia (EMA) y el PF premia calidad (stack) → refuerza COMBINAR ambos, no elegir uno.

## PILAR 3 — low-beta / quality (Buffett) sobre el sistema (2026-08-19)

`backtest_lowbeta.mjs` — tilt de beta (trailing 104s vs SPY) sobre las señales. 242 acciones, 10y.
| | BAJA beta (~0.5) | MEDIA (~1.0) | ALTA beta (~1.5) |
|---|---|---|---|
| EMA antic PF | 1.91 | 3.19 | **5.23** |
| EMA antic sin-top5% | 1.08 | 1.59 | **2.19** |
| Confluencia PF | 1.89 | 3.70 | **7.05** |
| Confluencia sin-top5% | 1.16 | 1.98 | **2.88** |

CONCLUSIÓN: el tilt de BAJA BETA NO mejora nuestras señales — al revés, la ALTA beta es mejor en PF, expectancy Y robustez. Tiene sentido: nuestro sistema es momentum/reversión CONVEXO (pérdida acotada por el stop −18%, ganancia abierta); las acciones de alta beta se mueven más → cuando la señal acierta, el pelotazo es mayor con la MISMA pérdida máxima. Es lo contrario de BAB en aislado, pero NO es contradicción: BAB/Buffett funciona para BUY-AND-HOLD largo plazo SIN apalancar (baja beta = mejor Sharpe con exposición continua); nuestro sistema es momentum TIMED con stop duro → quiere convexidad = alta beta.
⚠️ MATIZ: la alta beta es el cubo MÁS inflado por supervivencia (las de alta beta que sobrevivieron son los mayores ganadores; las que fueron a cero no están) + riesgo de gap a través del stop. NO perseguir alta beta a ciegas; el sistema ya vive en beta media-alta y el −18% es la red.
VEREDICTO Pilar 3: (1) NO filtrar señales por low-beta. (2) El motor Buffett (calidad+low-beta) es un SLEEVE SEPARADO (buy-and-hold), no un filtro de momentum — diversifica a nivel CARTERA, no de señal; requiere fundamentales punto-en-el-tiempo (no disponibles aquí) y cambia la operación. Para capital pequeño, la diversificación real que YA tienes es EMACross (momentum) + DeMark (reversión). Añadir sleeve de calidad = prematuro. Quality-momentum combo (Asness) es hipótesis válida pero requiere datos fundamentales para validar — NO añadir filtro sin validar.

## CONFLUENCIA — optimización de la ventana del 9: 13→8 velas (2026-08-21)

`backtest_confl_window.mjs` — barrido de cuán reciente debe ser el Buy Setup-9 antes del cruce (2..52 velas), 242 large-caps, 10y, stop -18%.
| ventana | n | PF | exp | sin-top5% | WF |
|---|---|---|---|---|---|
| ≤6v | 171 | 4.74 | +18.7% | 1.93 | 4/4 |
| **≤8v (NUEVO óptimo)** | 215 | **5.45** | **+21.9%** | **1.99** | 4/4 |
| ≤10v | 265 | 5.07 | +19.6% | 1.79 | 4/4 |
| ≤13v (viejo) | 334 | 4.47 | +17.2% | 1.66 | 4/4 |
| ≤20v | 451 | 3.92 | +15.2% | 1.40 | 4/4 |
| ≤26v+ | 540+ | ~3.5 | ~+13% | ~1.3 | 4/4 |

CONCLUSIÓN: acercar el 9 de 13→8 velas MEJORA todo (PF 4.47→5.45, exp +17→+22%, sin-top5% 1.66→1.99, muestra sana 215tr). Alejarlo empeora monótonamente. NO es overfit: es una MESETA (6-8-10 todas fuertes, PF 4.7-5.5), no un pico aislado — señal de efecto real (el 9 reciente respalda un giro vigente; a 13 semanas está rancio). El STACK confirma la dirección (más tight = mejor) con muestras pequeñas. APLICADO: `CONFL_WIN=8` en radar_emacross.mjs + Pine conflWin=8. ⚠️ Añade un parámetro al multiple-testing; el forward manda.

## ⚠️ CORRECCIÓN — ventana de confluencia: confirmación OOS + dependencia de régimen (2026-08-21)

RECTIFICACIÓN: el cambio 13→8 se aplicó IN-SAMPLE sin confirmar (error de proceso). Revertido a 13; confirmado con `backtest_confl_window_oos.mjs` (2 mitades temporales):
| ventana | Mitad1 2016-21 PF | Mitad2 2021-26 PF |
|---|---|---|
| ≤6v | 2.09 | 9.08 |
| ≤8v | 1.84 | 11.50 |
| ≤13v | 1.84 | 8.15 |
| ≤26v | 2.07 | 5.59 |

DOS conclusiones: (1) la DIRECCIÓN tight se confirma OOS (óptimo 6 en mitad-1, 8 en mitad-2, ambos <13) → acercar el 9 NO es overfit de dirección. (2) HALLAZGO MAYOR que se había pasado: la confluencia es FUERTEMENTE dependiente de RÉGIMEN — mitad vieja mediocre (PF ~1.8, mediana −4.5%, sin-top5% <1 = pierde sin outliers), mitad reciente espectacular (PF 8-11). El PF 5.45 full-sample estaba inflado por el régimen reciente. ⇒ Operar la confluencia con humildad (no PF garantizado); el forward podría parecerse a cualquiera de las dos mitades. REGLA DE PROCESO grabada: NINGÚN parámetro al sistema en vivo sin confirmación out-of-sample, y NINGÚN número full-sample sin desglose por régimen/mitades. Valor en vivo: revertido a 13 pendiente de decisión del usuario (8 está confirmado en dirección, mejora marginal).

## RE-EXAMEN anticipado vs confirmado POR RÉGIMEN (OOS) (2026-08-21)

`backtest_antic_vs_confirm_oos.mjs` — el full-sample daba ~equivalentes; ¿aguanta por régimen?
| | FULL PF/med | H1 2016-21 PF/med | H2 2021-26 PF/med |
|---|---|---|---|
| EMA anticipado | 3.59 / −2.2% | 2.49 / −3.6% | 5.11 / +0.1% |
| EMA confirmado | 3.31 / −3.7% | 2.49 / −4.9% | 4.36 / −2.0% |
| Conf-9 anticipado | 5.54 / −1.8% | 2.11 / −4.5% (n111) | 11.40 / +3.2% (n112) |
| Conf-9 confirmado | 6.95 / −1.2% | 2.64 / −5.0% (n75) | 12.85 / +3.6% (n96) |

CONCLUSIONES: (1) siguen ~EQUIVALENTES por régimen, ninguno domina decisivamente → confirmado OOS. (2) MATIZ: EMA sola favorece ANTICIPADO en ambas mitades (mejor mediana); la CONFLUENCIA favorece CONFIRMADO en ambas mitades (PF 2.64>2.11 en H1, 12.85>11.40 en H2) — pero muestras pequeñas (n75-112, ruidoso). (3) LO GRANDE: el RÉGIMEN eclipsa la decisión de timing — en H1 (malo) AMBOS son mediocres (PF 2.1-2.6, mediana −4.5 a −5%); en H2 ambos brillan. La elección anticipado/confirmado importa MUCHO menos que el régimen. IMPLICACIÓN dinero real: para el tier CONFLUENCIA/STACK, el CONFIRMADO es marginalmente más robusto Y evita el ~12% de falsas anticipaciones → ligera ventaja a esperar el cruce, sobre todo en señales lejos de cruzar. Diferencia pequeña; ni anticipar ni confirmar te salva en régimen malo.

## ¿AYUDA UN TP FIJO? NO (OOS) + proyección honesta $100×N (2026-08-21)

`backtest_tp_projection.mjs` — cartera 6 posiciones, señales EMA antic + DeMark, 10y.
TP fijo por régimen (CAGR): sin-TP H1 12.0%/H2 16.1% · TP+25% H1 27.9%/H2 12.1% · TP+50% 11.7/10.9 · TP+100% 11.9/16.1.
CONCLUSIÓN TP: el TP+25% que brillaba full-sample (26.4% CAGR) era ARTEFACTO DE RÉGIMEN — genial en 2016-21 (27.9%) pero PEOR que sin-TP en 2021-26 (12.1% vs 16.1%). En el régimen actual/relevante, SIN TP (dejar correr hasta cruce contrario) gana o empata. NO añadir TP fijo. Confirma la regla validada y la disciplina de no fiarse de números in-sample sin desglose por régimen.
PROYECCIÓN $600 (6×$100), sin TP, CAGR base 14.8% pero INFLADO por supervivencia → escenarios con haircut: malo (3.7%) $600→$719 en 5y · base (haircut 50%, 7.4%) →$857 · bueno (12.5%) →$1083. ⚠️ NO predicción; varianza -30%..+60% anual; fricciones (comisiones/impuestos) recortan más; haircut 50% es asunción. Realista 5y: ~$700-1100. El valor está en componer disciplina + escalar capital cuando el forward confirme + track record para copiadores.

## REVIEW de parámetros con disciplina OOS (2026-08-21)

**VOLUMEN — NO ayuda** (`backtest_volume.mjs`, OOS por régimen). Todos los filtros de volumen empeoran vs sin-filtro, en full-sample Y en H2 (régimen actual): vol>media20 (la "confirmación" clásica) baja H2 de PF 5.05→3.18 y recorta la muestra a la mitad. Lógica: el sistema compra suelos sobrevendidos (capitulación = volumen BAJO); exigir volumen alto filtra los rebotes silenciosos que funcionan. Confirma literatura académica (momentum de precio funciona sin volumen). NO añadir.

**LONGITUDES EMA** (`backtest_ema_lengths.mjs`, sweep OOS). Actual 8/21: FULL PF 3.59, sin5% 1.53, H1 2.50, H2 5.05.
| pareja | FULL PF/sin5% | H1 | H2 |
|---|---|---|---|
| 8/21 (actual) | 3.59 / 1.53 | 2.50 | 5.05 |
| **10/30** | **4.15 / 1.89** | **3.35** | **5.16** |
| 13/34 | 4.77 / 2.23 | 5.38 | 4.15 (peor H2) |
| 12/26, 8/34, 9/26 | mixtas | | |

HALLAZGO: **10/30 bate a 8/21 en AMBAS mitades Y es más robusto** (sin-top5% 1.53→1.89 = menos dependiente de outliers, justo nuestra debilidad). Es candidato OOS-robusto REAL (no artefacto: EMAs más lentas = menos whipsaw, menos señales más limpias). 13/34 = régimen-tradeoff (genial H1, peor H2) → NO dominante. ⚠️ NO aplicado: cambiar el EMA base obliga a RE-VALIDAR toda la pila (confluencia, DeMark overlay, debajo-200, stop, ventana) sobre 10/30 + actualizar radar/Pine/dashboard/indicador. Y es UNA sola partición OOS (falta walk-forward multi-ventana). Decisión del usuario. Otros params ya validados: stop -18%, ventana confluencia 8, debajo-200.

## ⚠️ DECISIÓN FINAL — EMA 10/30: NO migrar (re-examen crítico, 2026-08-22)

Al re-examinar `backtest_1030_revalidate.mjs` con más escepticismo (no solo mirar PF/robustez agregados):
1. **10/30 da 25-40% MENOS señales** en las 3 capas (1572→1175 base, 223→147 conf, 29→17 stack). Con capital limitado, menos señales = peor despliegue/diversificación (Grinold). No capturado por el PF.
2. **La MEDIANA empeora** en base y confluencia (−2.2→−2.8%, −1.8→−2.7%): el trade típico es MÁS rojo, ganancia más lumpy → mayor riesgo psicológico de abandono (riesgo #1 de REALIDAD_DINERO_REAL.md).
3. **Justo en confluencia (la capa que SÍ operamos), el walk-forward EMPEORA** (4/4→3/4). BR y LYB (posiciones reales) son STACK — ahí no hay mejora clara, hay degradación de robustez.
4. **Stack n=17** (vs 29) — muestra demasiado pequeña para concluir nada; el "PF 9.36" es ruido, no señal.
5. Coste de cambio real: reescribir radar + 2 Pine strategies (nombradas literalmente "8_21") + dashboard + docs, sobre UNA sola partición OOS (no walk-forward multi-corte).

VEREDICTO: NO migrar. Mejora agregada que se diluye/revierte justo donde se opera con dinero real, con coste de cambio alto. Se mantiene EMA 8/21. Descartado (no "pendiente"). Lección: un backtest "gana en el agregado" no basta — hay que mirar si gana en la capa donde realmente se despliega capital.

## WeeklySwing — Stop -18% → -25% CONFIRMADO OOS (2026-08-22)

`backtest_ref_demark_stop.mjs` (barrido -12..30%) + `backtest_ref_demark_stop_oos.mjs` (verificación adversarial OOS):

| stop | H1 PF | H1 med | H1 PF-sin5% | H1 WR | H2 PF | H2 med | H2 PF-sin5% | H2 WR |
|------|-------|--------|-------------|-------|-------|--------|-------------|-------|
| -18% (actual) | 1.83 | +5.4% | 1.31 | 56% | 3.19 | +11.6% | 2.40 | 62% |
| **-25%** | **2.14** | **+8.6%** | **1.60** | **65%** | 3.15 | **+12.9%** | **2.46** | **66%** |
| -30% | 2.12 | +8.6% | 1.58 | 68% | 3.89 | +13.6% | 3.06 | 71% |

CONFIRMADO OOS en AMBAS mitades: -25% bate a -18% en mediana, PF-sin5%, WR. Meseta 15-30% (no pico aislado). -25% elegido como punto medio (no -30% para limitar pérdida por trade).

**Caveat sizing:** con stop -25%, la pérdida por trade fallido sube 39% (de $18 a $25 sobre $100). Para mantener riesgo constante por operación, el tamaño por posición debe bajar de ~$100 a ~$72 (= $18 de riesgo / 0.25). O mantener $100 y aceptar riesgo de $25/trade.

⇒ APLICADO en `scanner_weekly.mjs` (CAT=0.25) y `CARTERA_ASIMETRICA.md`.

---

## A/B Histéresis de salida — EMACross (2026-08-26) — REFUTADO

**Hipótesis:** en lateral, salir "al primer roce" del cruce contrario provoca whipsaw. Probada banda de histéresis H (salir solo cuando EMA8 esté H% por debajo de EMA21) = 0 (actual), 0.5%, 1.0%. Entrada y stop idénticos. 180 acciones, 10y semanal, coste 0.06%/lado. Desglose en 2 mitades (frontera 2021) para cazar overfit. Script: `backtest_exit_hysteresis_ab.mjs`.

**MODO ANTICIPADO (el que se opera) — H=0 GANA en ambas mitades:**
- H=0 (actual): PF **2.55**, mediana **−2.82%**, WR 39%, dur 20w · mitades PF 3.32/2.09.
- H=0.5%: PF 2.42 (↓), mediana −4.15% (peor), maxDD peor.
- H=1.0%: PF 2.38 (↓), mediana −5.04% (peor).
⇒ La histéresis BAJA el PF y empeora la mediana en las DOS mitades. No reduce whipsaw (la entrada anticipada convergente ya filtra; duración mediana 20w, no hay flip-flop semanal). **NO tocar la salida.**

**MODO CONFIRMADO (no se opera):** H sube PF (2.67→2.97) y baja maxDD, PERO empeora la mediana (−4.38→−5.81) alargando trades (17w→25w) = más dependencia de cola, no un win limpio. Irrelevante porque se opera anticipado.

**Veredicto:** mismo patrón que los filtros de tendencia/momentum/ADX ya refutados — la "mejora obvia" no aporta. Salida se queda como está (cruce contrario al primer roce). Regla de proceso cumplida: A/B en 2 mitades antes de tocar nada; el óptimo (H=0) NO salta entre mitades.

---

## Interruptor de exposición por AMPLITUD de mercado (2026-08-26) — REFUTADO (y al revés)

**Pregunta:** ¿reducir entradas cuando el mercado está "roto" (baja amplitud = pocas acciones sobre EMA200) mejora EMACross anticipado? Trades etiquetados por amplitud en la entrada, terciles, 2 mitades. Script: `backtest_breadth_gate.mjs` (200 tickers, 10y).

**Resultado (contraintuitivo pero consistente en ambas mitades):**
- Amplitud BAJA (≤77%): PF **4.18**, exp +13.7% — la MEJOR.
- Amplitud MEDIA (≤86%): PF 2.37, exp +8.1%.
- Amplitud ALTA (>86%): PF **1.15**, exp +0.85% — la PEOR (breakeven). ALTA es la peor en las DOS mitades.

**Veredicto:** vetar/reducir entradas en baja amplitud = el filtro SPY>EMA200 ya REFUTADO, y encima al revés (quitaría las mejores entradas). El momentum rinde mejor comprando el reseteo, no la euforia. NO montar gate de amplitud. Caveat: cortes altos (77-86%) por sesgo de supervivencia → nivel absoluto no fiable como umbral en vivo; es pista de investigación, no interruptor. El "interruptor de cartera" real debe ser un circuit-breaker por DRAWDOWN realizado + regla de caja (reactivo, no filtro predictivo).

---

## Monte Carlo de DRAWDOWN — base del freno de cartera (2026-08-27)

20.000 simulaciones, EMACross anticipado, ¼ Kelly (7 pos × 13.9%, 1x), 1868 trades empíricos. Script: `mc_drawdown.mjs`. Peor drawdown en 1 año:
- Mediana −9.7% · p75 −13.0% · **p95 −18.1%** · p99 −21.9% · peor −30.5%.

**Lectura:** DD "normal" del sistema = −10 a −13%. Hasta −18% (p95) es mala racha esperable, NO rota. El freno debe ir POR ENCIMA del p95. Con ¼ Kelly sin apalancar no hay ruina (equity no llega a 0); el riesgo real es el ABANDONO por drawdown hondo. Sesgos (supervivencia + marca a cierre) → DD real ≥ simulado, ser conservador.

**RECOMENDACIÓN:** freno de cartera = pausar entradas nuevas en **−25%** del valor total desde el pico, reactivar en **−15%**. Coincide con el DD esperado del manual y el stop −25% de WeeklySwing. Pendiente de cablear en select_entries.mjs (requiere trackear el pico de equity).

---

## A/B Guardarraíl de sector (máx 2/sector) (2026-08-27) — NO CONFIRMABLE con estos datos

Simulación de cartera 10y (220 tickers, 7 pos × 13.9%, ¼ Kelly), señales EMACross anticipado en orden temporal, cap ON vs OFF. Script: `backtest_sector_cap_ab.mjs`.
- SIN cap: +900%, maxDD −18.9%, Calmar 47.7.
- CON cap: +1033%, maxDD −20.0%, Calmar 51.5. **El cap solo saltó 10 de 2068 señales.**

**Veredicto:** el backtest NO puede validar el cap. (1) Casi nunca se activa con selección neutral (first-come) y universo diverso → diferencia = ruido. (2) La protección del cap (desplome sectorial correlacionado) NO está en la muestra (10y alcista + survivors) → sesgo esconde el riesgo de cola que el cap cubre. (3) En uso real el cap SÍ muerde porque se rellena por prioridad/fuerza (un sector caliente da muchas señales fuertes juntas), no first-come. CONCLUSIÓN: regla prudente de cola, coste ≈0 en normal, se mantiene por fundamento teórico (correlación/papers), no por backtest. No confirmable ni refutable aquí.

---

## Backtest ESCALERA COMBINADA (EMACross + WeeklySwing) (2026-08-28)

Simulación 10y (200 tickers, 7 pos × 13.9%, ¼ Kelly), señales por orden temporal. Script: `backtest_combined_ladder.mjs`.
- A) EMACross solo: **+1012%, maxDD −19.2%, Calmar 52.8** — DOMINA.
- B) WeeklySwing solo: +178%, maxDD −24.0%, Calmar 7.4 — sistema mucho más débil.
- C) Combinada: +368%, maxDD −21.5%, Calmar 17.1 — en medio (diluye al fuerte).
- Correlación A↔B: ρ = −0.02 (diversificación real, incluso mejor que el 0.47 del manual).

**Veredicto:** combinar NO mejora sobre EMACross solo; empeora Calmar y DD porque WeeklySwing es más débil y le quita slots. La ρ≈0 es buena pero diversificar hacia un activo peor no ayuda al retorno ajustado a riesgo. CONTRADICE la nota del manual (−25→−17); método distinto. ACCIÓN: WeeklySwing degradado al FONDO de la escalera (solo relleno de slots ociosos), no coequal. Caveat: sim reparte por orden temporal (sobrepondera WeeklySwing); la escalera real le da menos peso → combinada real más cerca de EMACross solo.

---

## Salud del momentum (dist a EMA200 en la entrada) (2026-08-28)

EMACross anticipado, trades por bin de dist200. Script: `backtest_momentum_health.mjs` (220 tickers, 10y).
- DEBAJO (<0%): PF 4.44, exp +18.6% — 🔴 INFLADO POR SUPERVIVENCIA (los que caen bajo EMA200 y no rebotan desaparecen del universo; espejismo "comprar el hundimiento"). NO actuar sobre esto.
- SANO (0-30%): PF 1.98, exp +4.5%.
- EXTENDIDO (>30%): PF 1.59, exp +4.1%, med −4.26% — PEOR en AMBAS mitades. ✅ FIABLE (no lo esconde la supervivencia).

**Veredicto:** la parte robusta es que lo EXTENDIDO (>30% s/EMA200, parabólico) rinde peor de forma consistente → penalizar extensión en la escalera. NO "preferir pullbacks" (trampa de supervivencia). Ajuste aplicado: degradar candidatas EMACross con dist200>30% al fondo de la sección EMACross.

---

## A/B Cap de extensión a nivel CARTERA (2026-08-28) — VALIDADO ✅

Cartera EMACross 10y (220 tickers, 7 pos × 13.9%). Script: `backtest_ext_penalty_portfolio.mjs`. Parabólicas = 17% de señales.
- A) TODAS (actual): +56%, maxDD −18.0%, Calmar 3.11.
- B) SKIP parabólicas (>30% s/EMA200): **+71%, maxDD −11.4%, Calmar 6.25**.

**Veredicto:** penalizar parabólicas MEJORA retorno Y drawdown Y Calmar, consistente en 2 mitades. Con slots limitados, la parabólica ocupa un hueco que rinde más con una entrada sana (coste de oportunidad > su expectancy +4%). APLICADO en entry_engine.mjs (EXT_MAX=30): las candidatas EMACross con dist200>30% se DEGRADAN al fondo de EMACross (más suave que skip, ≥ igual de bueno; transparente). Efecto real hoy: EQX(+51%) y AU(+124%) degradadas → CEG(+25%) pasa a #1 mecánica.

---

## INFORME DE ROBUSTEZ — universo COMPLETO (2026-08-28) — CRÍTICO

`backtest_robustness.mjs`, 470/495 tickers, 2780 trades, 10y.
- Base: PF 1.84, WR 34%, media +4.84%, MEDIANA −3.63%, ΣR +13464% (PF baja de ~2.5 en muestra de 220 a 1.84 en el universo completo).
- **DEPENDENCIA DE COLA (crítica):** sin top-1% PF 1.42 · **sin top-5% PF 0.83 (PIERDE, ΣR −2650%)** · sin top-10% PF 0.46. El top-1% (27 trades) = 51% del ΣR; top-5% (139) = 120% del ΣR. El 95% de trades juntos pierde.
- Costes: robusto (PF 1.84→1.62 a 0.50%/lado). NO es el problema.
- Régimen: pierde 2022 (−4%) y 2026 (−8% parcial); resto +2..+10%/año.
- Walk-forward 5 ventanas: 4/5 positivas pero V2 pierde (PF 0.58) y decae V1 4.88→V5 1.20.
- Cap de extensión confirmado a escala: sin parabólicas PF 1.97 > 1.84.

**VEREDICTO:** el sistema es extremadamente TAIL-DEPENDENT (intrínseco al momentum, no un bug). Riesgo real para cuenta pequeña = SUBMUESTREO del tail (pocos trades → puede no pillar los monstruos). Supervivencia adelgaza el tail en vivo → PF real < 1.84, quizá ~breakeven. Mitigación (NO cura): ¼ Kelly sin apalancar (sobrevivir), tomar suficientes trades, no cortar ganadoras, no abandonar en frío, cap de extensión. NO se puede hacer la mediana positiva sin matar el edge. El forward es el juez.
