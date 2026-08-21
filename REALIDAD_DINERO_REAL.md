# Realidad de DINERO REAL — el estándar honesto (2026-08-21)

Documento-brújula. Es dinero real. No se opera con lo que "parece bueno", sino con lo que está
CONFIRMADO, sabiendo exactamente dónde está la incertidumbre. Cada afirmación aquí está respaldada
por backtest validado o por los papers; lo que es asunción, se dice.

## ✅ LO QUE SÍ ESTÁ CONFIRMADO
- **El edge no es data-mining.** Deflated Sharpe ~100% + PBO 7.1% (López de Prado/Bailey): supera el
  multiple-testing de las ~12 variantes. `backtest_validation.mjs`.
- **El −18% acota el downside** → hace posible dimensionar (Kelly). Sizing = **¼ Kelly**: sin
  apalancar, 6-8 posiciones de 13-16%, ~2,5% riesgo/trade. `backtest_kelly.mjs`.
- **Dos motores poco correlacionados** (momentum EMACross + reversión DeMark, ρ 0.47): combinarlos
  baja el drawdown −25%→−17%. `backtest_combo.mjs`.
- **Entrada robusta**: entrar al cierre o a la apertura siguiente da lo mismo (no dependía de un timing exacto).

## ⚠️ LO QUE ES INCIERTO / ASUMIDO — AQUÍ ESTÁ EL RIESGO REAL
- **SESGO DE SUPERVIVENCIA no corregido.** El universo son los supervivientes de hoy → el edge EN
  VIVO será MENOR que el backtest. Cuánto menos, NO lo sabemos. Por eso el sizing es conservador (no opcional).
- **DEPENDENCIA DE RÉGIMEN.** La confluencia (y parte del edge) brilla en 2021-26 (PF 8-11) y flojeaba
  en 2016-21 (PF ~1.8, mediana −4.5%, pierde sin outliers). El forward puede parecerse al régimen MALO.
- **MEDIANA NEGATIVA (positive-skew).** La mayoría de trades serán planos/rojos; el dinero llega en
  POCOS ganadores grandes (Moskowitz/TSM). Vas a pasar MUCHO tiempo en drawdown. Es normal, no un fallo.
- **Cero forward real de un ciclo completo.** Estamos en el minuto 1. El backtest es hipótesis; el forward es el juez.

## 🔴 RIESGOS CONCRETOS A TU DINERO AHORA
- **NU y SYK = pegadas / baja convicción** (peor tercil del ranking, mediana breakeven).
- **Riesgo psicológico #1: abandonar el sistema en la racha roja** (que VENDRÁ). Ese es el error que
  mata el edge, no el mercado. La disciplina es el activo.

## ⚡ INCIDENTE REAL — apalancamiento oculto (SYK, 2026-08-21)
Se cerró SYK con **−18.11% de cuenta** creyendo que era el stop del sistema. Diagnóstico: la posición
era **CFD con apalancamiento x2 sin saberlo**. El movimiento REAL del precio fue solo **−9.05%**
(348.80→317.22) — con 1x, la posición seguiría abierta hoy (precio ~$327, solo −6% desde entrada).
El −18% del sistema está calibrado para **precio 1x**; con 2x sin saberlo, el stop de cuenta salta a
mitad de camino del stop real diseñado → sales antes de tiempo, sistemáticamente, en TODAS las
posiciones que tengan el mismo problema. Esto invalida el sizing/backtest de esa posición concreta.
**ACCIÓN OBLIGATORIA antes de cada entrada: verificar apalancamiento = 1x explícitamente en el
bróker.** No asumir. Confirmado 2026-08-21: NU/TPG/BR/LYB están en 1x (sin apalancar) — solo SYK
tuvo el problema, ya cerrada y corregida en el ledger con los datos reales de la cuenta (no la
estimación previa).

## 🛡️ LA DISCIPLINA (no negociable con dinero real)
1. NADA al sistema en vivo sin confirmación **out-of-sample**.
2. NINGÚN número full-sample sin su **desglose por régimen/mitades**.
3. Sizing **conservador** (¼ Kelly o menos) por el haircut de supervivencia. Nunca full Kelly.
4. **Registrar y mark-to-market HONESTO** — cerrar perdedores, no retenerlos (efecto disposición, Fischbacher).
5. **Seguir la escalera de prioridad mecánica**, nunca elegir por la empresa (sesgo de valor).
6. **Dejar correr los ganadores** hasta el cruce contrario — la cola derecha es el edge.
7. El **forward manda**, no el backtest. Re-cuestionar todo antes de cambiar reglas.

## 📚 LO QUE LOS PAPERS NOS OBLIGAN A RECORDAR
- **López de Prado (DSR/PBO):** el backtest miente si no ajustas por trials → ajustado. Pero no corrige supervivencia.
- **Moskowitz-Ooi-Pedersen (Time Series Momentum):** momentum = positive-skew + drawdowns → normales, no huir.
- **Kelly/Thorp:** fraccional o ruina. El stop hace el Kelly posible.
- **Fischbacher (disposición):** no retener perdedores esperando el rebote.
- **Jensen-Kelly-Pedersen / Feng-Giglio-Xiu (factor zoo):** la mayoría de "anomalías" no replican → escepticismo por defecto.

## Veredicto honesto
El sistema tiene un **edge real pero modesto, régimen-dependiente y lumpy**. NO es una máquina de
imprimir dinero; es una apuesta asimétrica disciplinada con ventaja estadística, que exige sizing
conservador, aguante psicológico en drawdowns, y honestidad brutal en el seguimiento. Operado así,
tiene sentido con dinero real. Operado con prisa, apalancamiento o sesgo, destruye capital.
