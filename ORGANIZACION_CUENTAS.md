# Organización de las 2 cuentas (2026-08-20)

Dos cuentas, dos lógicas, dos reglas. **La regla de oro: cada acción vive en UNA cuenta con UN ruleset.
Nunca mover un trade perdedor a "valor" para no asumir la pérdida (eso es efecto disposición).**

---

## 🏛️ CUENTA 1 — TRADING212 = VALOR (patrimonio a largo)
| | |
|---|---|
| Propósito | Acumular CALIDAD para el futuro (estilo Buffett) |
| Qué se compra | Solo empresas de calidad: rentables, foso, líderes. NO temáticas ni penny |
| Entrada | Cuando hay tesis de calidad + precio razonable; se puede promediar a la baja si la tesis aguanta |
| Salida | **Stop de TESIS** (fundamentales rotos), NO stop de precio. El −18% NO aplica aquí |
| Actividad | Baja (comprar y mantener años) |
| Fiscal | Eficiente: plusvalía tributa al VENDER → impuesto diferido, compones sobre el bruto |
| Visibilidad | PRIVADA (patrimonio propio) |

**Se QUEDAN (calidad genuina):** AAPL, MSFT, GOOGL, AMZN, NVDA, META, ISRG, MDT, SYK, CPRT, ROK,
CGNX, PTC, NOW, BWXT, NKE, RR, MRL, CCJ, XIACY, CEG, PEG, PCG, CEZ + **UBER** (nueva).

**A DECIDIR (especulativas que NO son valor):** ASTS, RKLB, RDW, KRKNF, PL, AVAV, SERV, OKLO, SMR,
LEU, NXE, UUUU, UEC, DNN, YCA, PDN, KOID, FOIL, SGLN, SSLN, SYM, PRCT, MBLY, OUST, ARDX, ADX, SPCX, FOT.
→ Opciones: (a) cerrar y realizar (redeploy + pérdida fiscal), (b) mover a eToro con stop −18%, (c) mantener
SOLO si escribes una tesis concreta. **GMVDF (−100%) = muerta → cerrar (pérdida fiscal).**

---

## 🎯 CUENTA 2 — ETORO = TRADING (sistema, para Popular Investor)
| | |
|---|---|
| Propósito | Track record PÚBLICO del sistema validado → que te copien |
| Qué se compra | Señales del sistema semanal: escalera ⭐⭐STACK → ⭐Confluencia → P1/P2 |
| Entrada | Anticipada o cruce EMA 8/21; solo lo que marca el radar |
| Salida | Cruce contrario · **stop −18%** (mecánico) |
| Sizing | ¼ Kelly: sin apalancar, 6-8 posiciones de 13-16%, ~2,5% riesgo/trade |
| Fiscal | Muchos eventos → compensar pérdidas (ojo regla 2 meses); auto-declaración en España |
| Visibilidad | PÚBLICA (perfil Popular Investor) |

**Posiciones actuales (reales):** NU, SYK, TPG, BR.
**Clave para copiadores:** risk score bajo (el ¼ Kelly ayuda) + transparencia (posts por entrada) +
gestionar la narrativa de la asimetría (rachas rojas normales) para que no huyan en el drawdown.

---

## Mecánica práctica
1. **Capital:** decidir cuánto a cada cuenta. Valor = largo plazo (lo que no necesites tocar). Trading = el
   capital "de riesgo" para el sistema (5-8 posiciones × ~sizing). No mezclar los bolsillos.
2. **Tracking:** eToro/trading → `trades_real.json` (ya existe). T212/valor → ledger nuevo con TESIS por posición.
3. **SYK está en las DOS** (swing en eToro + posible valor en T212) — son cuentas distintas, ok, pero tenerlo claro.
4. **Nunca reclasificar** un trade fallido como "valor". Si rompió el −18% en eToro, se cierra ahí; no se "rescata" moviéndolo a T212.

## PENDIENTE
- [ ] Decidir qué hacer con las especulativas de T212 (cerrar/mover/mantener-con-tesis).
- [ ] Montar el ledger de valor de T212 (con tesis por posición) + registrar UBER.
- [ ] Definir el reparto de capital entre las dos cuentas.
- [ ] Posts de eToro pendientes: SYK, TPG.
