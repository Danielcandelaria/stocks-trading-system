# Plan operativo — EMACross con $500

> ⚠️ **No soy asesor financiero.** Esto es un plan **operativo** para desplegar de forma
> sistemática una estrategia que TÚ has construido y validado en backtest — no es
> recomendación de inversión personalizada. Toda inversión puede perder dinero. Decides tú.

## 0. Verdades incómodas antes de empezar (léelas)

1. **El sistema aún NO está validado en forward.** Lleva 25 posiciones abiertas y **0 cerradas** —
   ni un solo trade ha completado su ciclo todavía. El PF 2.36 es de **backtest** (con sesgo de
   supervivencia). Tu propia metodología dice: shadow → validar forward → promocionar. Meter dinero
   real ahora es **adelantarse**.
2. **$500 es demasiado poco para que el edge estadístico se materialice.** La ventaja está en la
   ley de los grandes números: WR 33%, la mayoría pierde poco y **unos pocos ganan enorme**. Con
   4-5 posiciones puedes perfectamente pillar solo los perdedores y **no** los 2-3 monstruos que
   pagan todo. **Alta varianza.** Podrías estar −25% antes de ver un ganador grande.
3. **Conclusión honesta:** trata estos $500 como **capital de aprendizaje** (matrícula) que puedes
   permitirte perder ENTERO, no como inversión que "debería" crecer. El objetivo es **aprender a
   ejecutar el sistema** y construir un track record real, no ganar dinero significativo.

## 1. Fase recomendada (staged)

- **Fase 0 — Paper (ahora, 1-3 meses):** sigue las señales confirmadas en TV en papel. Deja que el
  sistema cierre sus primeros trades. Comprueba que la forward se parece al backtest.
- **Fase 1 — $500 reales:** solo cuando la Fase 0 no contradiga el backtest. Posiciones minúsculas,
  como abajo. Es para curtirte en la ejecución, no para rentabilidad.

*(Si quieres empezar con real ya, adelante — pero con la mentalidad de la Fase 1: dinero de aprendizaje.)*

## 2. Broker y mecánica

- **Necesitas:** comisión **0** + **acciones fraccionadas** (para partir $500 en varias posiciones de
  acciones que cuestan $250-960/acción). Sin fraccionadas, $500 no da para diversificar.
- **Divisa:** estás en EUR y operas en USD → cuenta el **coste de conversión EUR↔USD** (elige broker
  con FX barato). Rellena el **W-8BEN** (retención reducida de dividendos US). Ganancias tributan en España.

## 3. Reglas de la estrategia (las validadas, sin desviarse)

| Regla | Valor |
|---|---|
| Universo | Large-caps top-500 (NYSE/NASDAQ), **solo LONG** |
| Señal de entrada | Cruce alcista EMA8>EMA21 **semanal**, **CONFIRMADO en TV tras el cierre del viernes** (la señal definitiva, no intradía) |
| Timeframe | Semanal |
| Salida | Cruce contrario (EMA8<EMA21). **SIN toma de beneficios** (probado: cualquier TP hunde el edge) |
| Stop de catástrofe | **−18%** desde la entrada (suelo raro de seguridad, no táctico) |
| Nada de | trailing, promediar a la baja, pirámide, filtrar por extensión |

## 4. Sizing con $500 (equiponderado)

- **Máximo 5 posiciones**, **~$100 cada una** (equal weight). Entras a medida que llegan señales
  confirmadas; si hay más de 5, esperas a que se libere un hueco.
- **Riesgo por trade:** posición $100 × stop −18% = **~$18 máx** por operación (3.6% de la cuenta).
  Si por desgracia las 5 tocaran stop a la vez (muy improbable, no correlacionan tanto): ~−$90 (−18%).
- **No** metas los $500 de golpe: despliega según lleguen señales. Mantén pólvora seca al principio.

## 5. Rutina semanal

1. **Vie 22:30** (tras cierre US) → llega la señal **definitiva** de cruces confirmados en TV.
2. **Lun apertura** → entras ~$100 fraccionado en cada cruce nuevo confirmado (hasta 5 abiertas).
3. **Cada semana** → si una abierta da el cruce contrario, la cierras (tomas beneficio/pérdida).
4. **Registro** → apunta cada trade (el journal del sistema ya lo hace en paper).

## 6. Cuándo escalar

Solo subes tamaño cuando el **forward real** confirme el edge: p.ej. ≥20-30 trades cerrados con
PF > ~1.5 y comportamiento parecido al backtest. Si sangra, paras y revisas. Nunca escalar por
"corazonada" ni tras una racha buena corta.

---

**Resumen en una línea:** con $500, esto es un **simulador con dinero real para aprender el sistema**,
no una fuente de ingresos. Riesgo acotado por posición (−$18), varianza alta por falta de
diversificación, y el sistema aún debe probarse en forward. Empieza pequeño, registra todo, escala
solo con evidencia.
