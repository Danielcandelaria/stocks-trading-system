# Estrategia Justin Banks (@RealJGBanks) — Mentalidad y forma de analizar

> Capa **cualitativa / discrecional** que envuelve la estrategia mecánica `BreakoutRetest`
> (validada PF 2.65 / WF 4/4 — **NO se toca la lógica del scanner**). Esto es la
> *mentalidad* y el *método de análisis* del trader para decidir CON criterio sobre
> las señales que el sistema dispara. Fuente: posts de @RealJGBanks, junio 2026.

## 1. Mentalidad (filosofía Growth & Momentum)

- **Operar TEMAS, no tickers sueltos.** Identificar el *theme* líder del ciclo y operar
  los líderes dentro de él. No perseguir lo que YA subió mucho — buscar **lo que viene después**.
- **Fuerza relativa manda.** Dentro de cada tema, quedarse con los **2-4 nombres con mayor
  fuerza relativa** (los que lideran el movimiento), no el rezagado "barato".
- **Aguantar los ganadores estructurales MÁS TIEMPO** que el promedio del mercado. El edge
  está en no soltar pronto al líder de un tema en marcha.
- **Los dips en temas estructurales son OPORTUNIDAD de compra**, no motivo de pánico.
- Combina **price action + market structure + EMAs semanales** con **narrativa macro** de
  ciclos tecnológicos y megatendencias.

## 2. Setup técnico favorito (cómo analizar la entrada)

El setup que le ha dado sus mayores swings — **úsalo como checklist al validar una señal
de breakout del sistema antes de operarla**:

1. **Cruce 8/21 EMA semanal alcista** (el sistema ya lo exige).
2. **Expansión hacia la zona de supply** (resistencia previa).
3. **Pullback a la 8 EMA semanal** (no comprar extendido; esperar el retroceso a la media rápida).
4. **Break of Structure (BOS)** para confirmar la entrada (rompe el último máximo menor tras el pullback).
5. **Salida en la siguiente zona de supply** (no solo TP fijo — leer dónde está la próxima resistencia).

> Matiz vs nuestro scanner: el sistema entra en el **retest del nivel de ruptura** con TP **2R fijo**.
> Banks afina: retest **a la 8 EMA semanal**, entrada por **BOS**, y salida en la **próxima supply**.
> Esto es la lente DISCRECIONAL para gestionar la posición; la regla mecánica validada sigue siendo 2R.

## 3. Gestión de riesgo (Banks)

- **Stops debajo de la 8 EMA semanal.**
- **Trim parcial en fuerza extrema** (recoger parte cuando el precio se dispara, dejar correr el resto).
- Tamaño según convicción del tema + fuerza relativa del nombre.

## 4. Rotación temática (el ciclo)

El capital rota por fases del ciclo tecnológico. Saber en qué fase estamos orienta qué tema priorizar:

```
AI Chips → Memory → Infra/Data Centers → Power/Nuclear → Photonics/Quantum → Robotics/Space
```

## 5. Watchlist temática (junio 2026)

| Tema | Tickers líderes |
|------|-----------------|
| **AI Compute** | NVDA, AMD, AVGO, INTC |
| **Memory / Storage** | MU, SNDK, WDC |
| **Infra / Data Centers** | IREN, CORZ, CIFR, KEEL, SMCI, DELL |
| **Power & Cooling** | VRT, FLNC, NVTS |
| **Nuclear (energía para IA)** | OKLO, SMR, NNE |
| **Photonics / Optics** | GLW |
| **Quantum Computing** | IONQ, QBTS, QUBT, RGTI |
| **Miners (proxy de compute)** | RIOT, MARA |
| **Robotics / Space / Defense** | TSLA, SYM, OUST, ASTS, RKLB, PLTR, KTOS |

## 6. Asignación sugerida por Banks (orientativa, NO regla mecánica)

- **Core (40-60%)**: líderes AI — NVDA, AMD, MU, AVGO.
- **Temático (20-30%)**: Power, Nuclear, Photonics, Quantum.
- **Táctico (10-20%)**: setups momentum — miners, robotics.

## 7. Cómo se conecta con nuestro sistema

- El scanner **`BreakoutRetest`** sigue siendo la **señal mecánica validada** (no cambia).
- Esta metodología es la **capa de criterio del humano**: cuando el sistema dispara un breakout,
  el operador valida con el checklist de Banks (¿es líder de su tema? ¿fuerza relativa? ¿pullback a
  la 8 EMA + BOS? ¿hay recorrido hasta la próxima supply?) antes de operar y para gestionar la salida.
- La **watchlist temática** puede usarse como sesgo: priorizar señales del sistema que caigan en
  tickers líderes de temas activos.

> ⚠️ Disciplina del proyecto: cualquier intento de convertir estos matices (pullback 8 EMA, BOS,
> salida en supply) en REGLAS MECÁNICAS del scanner requiere backtest + walk-forward propios antes
> de tocar la lógica validada. Por ahora viven como criterio discrecional.
