# Cartera Asimétrica — Manual operativo (dinero real)

**Principio rector:** pérdidas pequeñas y ACOTADAS, ganancias grandes y SIN techo.
La asimetría no es una opinión: el sistema tiene **skew +1.99** (cola derecha gorda) — el dinero
está en unos pocos ganadores enormes, no en acertar la mayoría.

---

## 1. QUÉ se opera (el edge, validado)
- **Swing SEMANAL**, acciones large-cap USA, **long-only** (los cortos pierden: PF 0.41).
- Motor: **EMA 8/21** (tendencia) + **DeMark Setup-9** (agotamiento/suelo). La confluencia de ambos = máxima calidad.
- **Validación formal (2026-08-19):** Deflated Sharpe **100%** + PBO **7.1%** → edge REAL, no overfit al multiple-testing.
- ⚠️ **Caveat sin corregir:** sesgo de supervivencia (universo = vivos de hoy) → el edge EN VIVO será MENOR que el backtest. Por eso el sizing es conservador (abajo).

## 2. SELECCIÓN (escalera de prioridad — mecánica, sin sesgo)
Cuando se libere capital, tomar SIEMPRE la señal de mayor prioridad disponible. NUNCA por "me gusta la empresa".
1. ⭐⭐ **STACK** — confluencia + DEBAJO EMA200 (reversión profunda; lo más robusto, sin-top5% 3.64).
2. ⭐ **CONFLUENCIA** — cruce/anticipación EMA + Setup-9 reciente (PF 4.28).
3. 🎯 **P1 anticipadas / P2 cruzadas fuertes**.
- Anticipada ≈ cruzada (validado): entrar antes = más barato; esperar el cruce = más confirmación. Ambas valen.
- EVITAR: cruzadas "pegadas" (<8% ext) = breakeven.

## 3. SIZING (Kelly fraccional — el corazón de la asimetría)
Kelly completo sobre el backtest da f*≈2 (apalancar 2:1). **Es una trampa** (inflado por supervivencia + correlación). Regla real:
```
· SIN apalancamiento. Máximo 100% del capital invertido.
· 6-8 posiciones (Grinold: más apuestas = mejor retorno ajustado a riesgo).
· Cada posición ≈ 13-16% del capital.
· Riesgo por trade ≈ 2,5% del capital (tamaño × stop 18%).
· Equivale a ~¼ Kelly: red contra la inflación de supervivencia.
```
Ejemplo con $500: 7 posiciones de ~$70, riesgo ~$12,6 cada una.
(½ Kelly conserva ~75% del crecimiento con la mitad de la volatilidad — renuncias a poco upside por mucha menos ruina.)

## 4. GESTIÓN DE RIESGO
- **Stop catástrofe −18%** en TODA posición (la red que hace posible dimensionar con Kelly).
- **Salida:** cruce contrario EMA8<EMA21 (o Countdown-13 en WeeklySwing). **SIN toma de beneficios fija** — dejar correr.
- **NO** promediar a la baja. **NO** mover el stop en contra. **NO** apalancar.

## 5. LA ASIMETRÍA EN NÚMEROS (qué esperar psicológicamente)
- Mediana por trade ≈ 0 / ligeramente negativa · media positiva → **la mayoría de trades serán planos o rojos**.
- El beneficio llega en GRUMOS (pocos pelotazos). Rachas rojas largas = NORMAL, no es que falle.
- Cortar un ganador pronto = matar la cola derecha = destruir el edge. Aguantar hasta el cruce.

## 6. LO QUE ROMPE EL SISTEMA (evitar a toda costa)
1. **Cherry-picking por sesgo de valor** (elegir "la sólida y barata") → el mayor riesgo. Seguir la escalera.
2. **Impaciencia** (cortar ganadores, tomar beneficios) → mata la asimetría.
3. **Apalancarse a Kelly completo** → ruina.
4. **Operar en diario** → el edge no transfiere (es semanal); más ruido y coste.

## 7. RÉGIMEN
- El sistema SANGRA en mercado bajista (2022 EMA −2%). DeMark/confluencia lo amortigua pero no lo elimina.
- Combinar EMACross + DeMark/WeeklySwing reduce el drawdown (−25%→−17%) y tapa los años malos.

## 8. REVISIÓN
- **Forward = el juez.** Registrar cada trade real (ledger). El backtest ya está validado; ahora manda lo que ocurre.
- **Re-cuestionar todo** antes de cambiar cualquier regla (norma permanente).

---

### Caveats pendientes / próximos pasos
- Supervivencia NO corregida → sizing conservador es obligatorio (no opcional).
- **Pilar 3 (pendiente):** añadir CALIDAD + LOW-BETA como segundo motor (estilo Buffett's Alpha: calidad + baja beta + apalancamiento moderado, largo plazo) — edge poco correlacionado con momentum → más asimetría por diversificación.
