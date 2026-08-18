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
