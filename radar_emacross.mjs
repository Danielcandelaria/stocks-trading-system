#!/usr/bin/env node
// radar_emacross.mjs — RADAR de cruces EMA 8/21 semanal (jueves/viernes, antes del cierre).
//   OBJETIVO: ver qué empresas van a cruzar ANTES de que cierre la vela semanal, para
//   entrar sin perder recorrido (backtest: anticipar mejora PF 2.35→2.81).
//
//   Clave: usa el precio EN VIVO de la semana en curso para calcular la EMA "si la vela
//   cerrase ahora". Así distingue:
//     🔥 CRUZANDO YA  — con el precio de esta semana el cruce YA ha ocurrido (entrar hoy).
//     ⚡ ESTA SEMANA  — a un pelo del cruce y convergiendo rápido (probable antes del viernes).
//     ⏳ 1-2 SEMANAS  — acercándose, vigilar.
//   Ordena LONG (operable) primero; SHORT informativo (débil en acciones).
//   Manda UN digest a Telegram por niveles. NO es orden de entrada: confirmar en la gráfica.
//
//   Uso:  node radar_emacross.mjs [--dry] [gapMax%]     (gapMax% por defecto 1.2)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tgSend } from './tg.mjs';
import { beat } from './heartbeat.mjs';
import { cdpUp, confirmSymbol, syncWatchlist, reconnect } from './tv_layer.mjs';
import { getWeeklyBars, weekIsOver } from './weekly_bars.mjs';
import { buildRadarAlert } from './alert_system.mjs';
import { computeTDSetup } from '../scanner/demark_calc.mjs';

// Confluencia: un cruce EMA respaldado por un Buy Setup-9 DEBAJO en las últimas N velas
// (backtest 2026-08-19: sube PF 3.24→4.28 y expectancy +11→+15%, ~1/5 de señales). Ventana TIGHT.
const CONFL_WIN = 13;

const ROOT = dirname(fileURLToPath(import.meta.url));
const F = n => join(ROOT, n);
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const FAST = 8, SLOW = 21;
const DRY = process.argv.includes('--dry');
const SEND_SHORT = false;   // el usuario opera long-only (short débil en acciones); poner true para reactivar
const DEFINITIVE = process.argv.includes('--definitive');   // viernes tras cierre US: dispara señales de ENTRADA reales
const FRESH_W = +(process.env.FRESH_W || 1);   // semanas máx desde el cruce para seguir siendo entrada fresca
const GAPMAX = (+process.argv.find(a => /^[\d.]+$/.test(a)) || 2.0) / 100;   // banda óptima 2.0% (backtest_anticip_detail)
const sleep = ms => new Promise(r => setTimeout(r, ms));
const load = (f, d) => existsSync(F(f)) ? JSON.parse(readFileSync(F(f), 'utf8')) : d;
const save = (f, v) => writeFileSync(F(f), JSON.stringify(v, null, 2));
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map(c => { e = e === null ? c : c * k + e * (1 - k); return e; }); };
const NOW = Date.now() / 1000;

// barras deduplicadas CONSERVANDO la semana viva (el radar proyecta con el precio actual)
const getWeekly = t => getWeeklyBars(t, { keepForming: true });

function analyze(bars) {
  // separar la semana EN CURSO (viva) de las cerradas.
  // BUG-FIX: en modo DEFINITIVO (viernes tras cierre / finde) la última vela YA está cerrada
  // y es la buena → NO tratarla como "en formación" (si no, se pierden cruces reales tipo NU/DVN).
  // En provisional (intradía 14:00) sí es en formación → proyección viva.
  const forming = !weekIsOver() && bars.length && NOW - bars[bars.length - 1].t < 7 * 86400;
  const closed = forming ? bars.slice(0, -1) : bars;
  const liveClose = bars[bars.length - 1].c;            // precio actual (semana viva o último cierre)
  if (closed.length < SLOW + 3) return null;
  const cl = closed.map(b => b.c), ef = ema(cl, FAST), es = ema(cl, SLOW);
  const n = cl.length - 1;
  const efC = ef[n], esC = es[n], px = cl[n];
  const gapC = (efC - esC) / px;                        // hueco al último cierre
  const gapPrev = (ef[n - 1] - es[n - 1]) / cl[n - 1];  // hueco anterior (velocidad)
  // EMA "si la vela cerrase al precio de AHORA":
  const k8 = 2 / (FAST + 1), k21 = 2 / (SLOW + 1);
  const efL = liveClose * k8 + efC * (1 - k8);
  const esL = liveClose * k21 + esC * (1 - k21);
  const gapL = (efL - esL) / liveClose;                 // hueco proyectado con el precio vivo
  const vel = gapC - gapPrev;                            // cambio del hueco por semana
  const ext = Math.abs((liveClose - esL) / esL) * 100;  // extensión sobre la EMA21 (recorrido ya hecho)
  // si YA está cruzado al alza, ¿hace cuántas semanas cruzó? (para saber si la entrada sigue fresca)
  let weeksSinceCross = null;
  if (efC > esC) { for (let i = n; i > 0; i--) { if (ef[i - 1] <= es[i - 1] && ef[i] > es[i]) { weeksSinceCross = n - i; break; } } }
  // Confluencia DeMark: ¿hubo un Buy Setup-9 en las últimas CONFL_WIN velas cerradas?
  let conf9 = false, bars9 = null;
  try {
    const td = computeTDSetup(closed);
    for (let i = n; i >= Math.max(0, n - CONFL_WIN); i--) { if (td.bullSetup[i] === 9) { conf9 = true; bars9 = n - i; break; } }
  } catch { /* si falla, sin confluencia */ }
  return { px: liveClose, gapC, gapL, vel, ext, weeksSinceCross, conf9, bars9 };
}

(async () => {
  const uni = load('universe.json', { universe: [] }).universe;
  const hits = []; let done = 0, errs = 0;
  for (const u of uni) {
    let bars; try { bars = await getWeekly(u.ticker); await sleep(120); } catch { errs++; continue; }
    if (!bars) continue;
    const a = analyze(bars); if (!a) continue;
    const { px, gapC, gapL, vel, ext, weeksSinceCross, conf9, bars9 } = a;

    // dirección del cruce que se aproxima (según el signo del hueco al cierre)
    const longSide = gapC < 0;   // EMA8 debajo → cruce alcista pendiente
    const dir = longSide ? 'LONG' : 'SHORT';

    // ¿ya cruzó?  Si la semana YA CERRÓ, manda el hueco REAL al cierre (gapC): proyectar
    // una semana extra inventaría cruces que TV no pinta (DIS/CRM, 2026-08-16). Si la semana
    // está VIVA, sí se proyecta con el precio actual ("si cerrase ahora").
    const WEEKDONE = weekIsOver();
    const gapRef = WEEKDONE ? gapC : gapL;
    const crossedLive = longSide ? gapRef >= 0 : gapRef <= 0;
    const converging = longSide ? gapL >= gapC : gapL <= gapC;   // el hueco se cierra hacia cero
    const gLive = Math.abs(gapRef);

    let level = null, weeks = null;
    // (A) YA CRUZADO y la entrada sigue FRESCA (≤ FRESH_W semanas) → accionable AHORA
    if (!longSide && weeksSinceCross != null && weeksSinceCross <= FRESH_W) { level = 0; weeks = weeksSinceCross; }
    else if (!longSide) continue;                        // cruzado hace mucho → no es señal nueva
    else if (crossedLive) level = 0;                     // cruzando justo ahora (semana viva)
    else if (converging && gLive < 0.004) level = 1;      // ⚡ a punto (a <0.4%)
    else if (converging && gLive < GAPMAX) level = 2;     // ⏳ acercándose
    else continue;

    hits.push({ ticker: u.ticker, tv: u.tv, dir: 'LONG', px, level, gLive: gLive * 100, ext, weeks, conf9: !!conf9, bars9 });
    if (++done % 60 === 0) process.stderr.write(`  …revisadas ${done}\n`);
  }

  // orden: LONG antes que SHORT · nivel de urgencia · más cerca del cruce primero
  const rank = h => (h.dir === 'LONG' ? 0 : 100) + h.level * 10;
  hits.sort((a, b) => rank(a) - rank(b) || ((a.weeks ?? 99) - (b.weeks ?? 99)) || a.gLive - b.gLive);   // nivel → más fresco → más cerca
  // extensión = cuánto ya subió sobre la EMA21 (SOLO INFO — backtest: NO filtrar por esto;
  // los extendidos son cruces con más momentum y rinden MEJOR, no peor).
  const dot = e => e < 3 ? '·' : e < 6 ? '•' : '‣';

  const LV = ['🟢 YA CRUZADO', '⚡ A PUNTO', '⏳ ACERCÁNDOSE'];
  const L = hits.filter(h => h.dir === 'LONG'), S = hits.filter(h => h.dir === 'SHORT');
  console.log(`RADAR: ${hits.length} · LONG ${L.length} (🔥${L.filter(h=>h.level===0).length} ⚡${L.filter(h=>h.level===1).length} ⏳${L.filter(h=>h.level===2).length}) · SHORT ${S.length} · ${errs} err`);
  for (const h of hits) console.log(`  ${LV[h.level].padEnd(16)} ${h.dir.padEnd(5)} ${h.ticker.padEnd(6)} $${h.px.toFixed(2)}  ext ${dot(h.ext)}${h.ext.toFixed(1)}%`);

  // PERSISTIR para el dashboard (aunque sea --dry): la lista de QUÉ VIGILAR.
  const LV_TXT = ['YA CRUZADO — entrada válida', 'A PUNTO DE CRUZAR', 'ACERCÁNDOSE (1-2 sem)'];
  const persist = () => save('radar_live.json', {
    updatedAt: new Date().toISOString(),
    definitive: DEFINITIVE,
    levels: [0, 1, 2].map(lv => {
      let tk = L.filter(h => h.level === lv).map(h => ({
        ticker: h.ticker, tv: h.tv, price: +h.px.toFixed(2), extPct: +h.ext.toFixed(1),
        gapPct: +h.gLive.toFixed(2), tvCrossed: h.tvCrossed ?? null, weeks: h.weeks ?? null,
        conf9: !!h.conf9, bars9: h.bars9 ?? null,   // ⭐ confluencia: setup-9 reciente debajo
      }));
      // anticipación (nivel 1 y 2): ordenar por CERCANÍA al cruce (menos hueco que cerrar, primero)
      if (lv >= 1) tk = tk.sort((a, b) => a.gapPct - b.gapPct);
      return { level: lv, label: LV_TXT[lv], tickers: tk };
    }),
  });
  persist();
  beat('radar', { yaCruzado: L.filter(h => h.level === 0).length, aPunto: L.filter(h => h.level === 1).length, acercandose: L.filter(h => h.level === 2).length });
  if (DRY || !hits.length) return;

  // ── CAPA TV (fuente de verdad): poblar watchlist + confirmar los 🔥 ──
  let tvNote;
  if (await cdpUp()) {
    const fire = L.filter(h => h.level === 0);   // 🔥 = "cruzando ya" → los que se validan en TV
    // watchlist "Empresas para vigilar" = SOLO los 🔥 (el usuario la gestiona/borra a mano)
    // la watchlist la gestiona sync_watchlist.mjs (añade lo accionable y borra lo obsoleto)
    // confirmar el cruce en TV; señal NUEVA de Telegram cuando TV confirma un cruce por 1ª vez
    const prev = DEFINITIVE ? load('seen_tv_confirmed.json', {}) : {};   // { TICKER: true } cruces ya avisados
    const now = {};
    let ci = 0;
    for (const h of fire) {
      const r = await confirmSymbol(h.tv);
      ci++;
      if (r.timedOut || ci % 5 === 0) await reconnect();   // CDP zombi o cada 5 → reconexión fresca
      if (r.error) { console.log(`TV ${h.ticker}: ${r.error}`); continue; }
      h.tvCrossed = r.crossed; h.tvGap = r.gapPct;
      console.log(`TV ${h.ticker}: ${r.crossed ? 'CRUZADO' : 'aún no'} (${r.gapPct.toFixed(2)}%)`);
      // La señal de ENTRADA solo se dispara en la corrida DEFINITIVA (viernes tras el cierre semanal).
      // Intradía un cruce puede deshacerse antes del cierre (visto: CVNA/GEHC/ADSK el 14-ago).
      if (r.crossed && DEFINITIVE) {
        now[h.ticker] = true;
        if (!prev[h.ticker]) await tgSend(
          `✅ <b>CRUCE CONFIRMADO EN TV — ${h.ticker}</b>` +
          `\n🟢 La EMA8 cruzó SOBRE la EMA21 al CIERRE semanal (definitivo)` +
          `\n💵 Precio  <b>$${r.price.toFixed(2)}</b>` +
          `\n🎯 Entrada · salida en el cruce contrario · stop catástrofe −18%` +
          `\n📈 ${h.tv}`
        );
      }
    }
    if (DEFINITIVE) save('seen_tv_confirmed.json', now);   // solo cruzados AHORA → si descruza y recruza, re-avisa
    tvNote = DEFINITIVE
      ? '✅ DEFINITIVO (cierre semanal). Señal de ENTRADA enviada por cada cruce confirmado.'
      : '⏳ PROVISIONAL (mercado abierto/semana en curso). ✅TV = cruzado AHORA, puede deshacerse al cierre. Las entradas reales salen el VIERNES tras el cierre.';
  } else {
    tvNote = '⚠️ TV apagado → sin verificar (solo Yahoo). Arranca TV para confirmar.';
  }

  persist();   // re-guardar ya con el estado de TV

  // Alerta ENFOCADA a los 2 cubos accionables (sin ruido):
  //   P1 = anticipadas inminentes (nivel 1, <0.4%) · P2 = cruzadas FUERTES (nivel 0, weeks 0, ext≥15%)
  const SL = px => +(px * 0.82).toFixed(2);
  const p1 = L.filter(h => h.level === 1)
    .sort((a, b) => a.gLive - b.gLive)
    .map(h => ({ ticker: h.ticker, price: +h.px.toFixed(2), stop: SL(h.px) }));
  const p2 = L.filter(h => h.level === 0 && (h.weeks ?? 0) === 0 && (h.ext ?? 0) >= 15)
    .sort((a, b) => b.ext - a.ext)
    .map(h => ({ ticker: h.ticker, price: +h.px.toFixed(2), stop: SL(h.px) }));
  await tgSend(buildRadarAlert({ p1, p2, vigilar: L.filter(h => h.level === 2).length }));
})();
