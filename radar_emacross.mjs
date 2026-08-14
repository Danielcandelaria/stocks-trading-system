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

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tgSend } from './tg.mjs';
import { cdpUp, confirmSymbol, syncWatchlist } from './tv_layer.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const F = n => join(ROOT, n);
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const FAST = 8, SLOW = 21;
const DRY = process.argv.includes('--dry');
const SEND_SHORT = false;   // el usuario opera long-only (short débil en acciones); poner true para reactivar
const GAPMAX = (+process.argv.find(a => /^[\d.]+$/.test(a)) || 1.2) / 100;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const load = (f, d) => existsSync(F(f)) ? JSON.parse(readFileSync(F(f), 'utf8')) : d;
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map(c => { e = e === null ? c : c * k + e * (1 - k); return e; }); };
const NOW = Date.now() / 1000;

async function getWeekly(t) { const y = t.replace('.', '-');
  try { const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=2y&interval=1wk`, { headers: UA });
    if (!res.ok) return null; const r = (await res.json()).chart?.result?.[0]; const q = r?.indicators?.quote?.[0];
    if (!r?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < r.timestamp.length; i++) if (q.close[i] != null) b.push({ t: r.timestamp[i], c: q.close[i] });
    return b.length > SLOW + 5 ? b : null; } catch { return null; } }

function analyze(bars) {
  // separar la semana EN CURSO (viva) de las cerradas
  const forming = bars.length && NOW - bars[bars.length - 1].t < 7 * 86400;
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
  return { px: liveClose, gapC, gapL, vel, ext };
}

(async () => {
  const uni = load('universe.json', { universe: [] }).universe;
  const hits = []; let done = 0, errs = 0;
  for (const u of uni) {
    let bars; try { bars = await getWeekly(u.ticker); await sleep(120); } catch { errs++; continue; }
    if (!bars) continue;
    const a = analyze(bars); if (!a) continue;
    const { px, gapC, gapL, vel, ext } = a;

    // dirección del cruce que se aproxima (según el signo del hueco al cierre)
    const longSide = gapC < 0;   // EMA8 debajo → cruce alcista pendiente
    const dir = longSide ? 'LONG' : 'SHORT';

    // ¿ya cruzó con el precio vivo?  ¿converge?
    const crossedLive = longSide ? gapL >= 0 : gapL <= 0;
    const converging = longSide ? gapL > gapC : gapL < gapC;   // el hueco se cierra hacia cero
    const gLive = Math.abs(gapL);

    let level = null;
    if (crossedLive) level = 0;                          // 🔥 CRUZANDO YA
    else if (converging && gLive < 0.004) level = 1;     // ⚡ ESTA SEMANA (a <0.4%)
    else if (converging && gLive < GAPMAX) level = 2;    // ⏳ 1-2 SEMANAS
    else continue;

    hits.push({ ticker: u.ticker, tv: u.tv, dir, px, level, gLive: gLive * 100, ext });
    if (++done % 60 === 0) process.stderr.write(`  …revisadas ${done}\n`);
  }

  // orden: LONG antes que SHORT · nivel de urgencia · más cerca del cruce primero
  const rank = h => (h.dir === 'LONG' ? 0 : 100) + h.level * 10;
  hits.sort((a, b) => rank(a) - rank(b) || a.gLive - b.gLive);
  // extensión = cuánto ya subió sobre la EMA21 (SOLO INFO — backtest: NO filtrar por esto;
  // los extendidos son cruces con más momentum y rinden MEJOR, no peor).
  const dot = e => e < 3 ? '·' : e < 6 ? '•' : '‣';

  const LV = ['🔥 CRUZANDO YA', '⚡ ESTA SEMANA', '⏳ 1-2 SEMANAS'];
  const L = hits.filter(h => h.dir === 'LONG'), S = hits.filter(h => h.dir === 'SHORT');
  console.log(`RADAR: ${hits.length} · LONG ${L.length} (🔥${L.filter(h=>h.level===0).length} ⚡${L.filter(h=>h.level===1).length} ⏳${L.filter(h=>h.level===2).length}) · SHORT ${S.length} · ${errs} err`);
  for (const h of hits) console.log(`  ${LV[h.level].padEnd(16)} ${h.dir.padEnd(5)} ${h.ticker.padEnd(6)} $${h.px.toFixed(2)}  ext ${dot(h.ext)}${h.ext.toFixed(1)}%`);

  if (DRY || !hits.length) return;

  // ── CAPA TV (fuente de verdad): poblar watchlist + confirmar los 🔥 ──
  let tvNote;
  if (await cdpUp()) {
    try { const added = await syncWatchlist(L.map(h => h.tv)); log(`watchlist "Empresas para vigilar": +${added} símbolos nuevos`); } catch (e) { log('watchlist error: ' + e.message); }
    const fire = L.filter(h => h.level === 0).slice(0, 12);   // confirmar solo los "cruzando ya" (cap 12)
    for (const h of fire) { const r = await confirmSymbol(h.tv); if (!r.error) { h.tvCrossed = r.crossed; h.tvGap = r.gapPct; } log(`TV ${h.ticker}: ${r.error ? r.error : (r.crossed ? 'CRUZADO' : 'aún no') + ' (' + r.gapPct.toFixed(2) + '%)'}`); }
    tvNote = '✅ 🔥 verificados contra TV (fuente de verdad).';
  } else {
    tvNote = '⚠️ TV apagado → sin verificar (solo Yahoo). Arranca TV para confirmar.';
  }

  const fmtLevel = (arr, lv) => { const g = arr.filter(h => h.level === lv);
    if (!g.length) return '';
    const tv = h => h.tvCrossed === true ? '  ✅TV' : h.tvCrossed === false ? '  ⏳TV aún no' : '';
    const line = h => `  ${h.ticker.padEnd(6)} $${h.px.toFixed(2)}  (+${h.ext.toFixed(1)}% s/EMA21)` + (lv === 0 ? tv(h) : '');
    return `\n\n${LV[lv]}\n<code>${g.map(line).join('\n')}</code>`; };
  let msg = `📡 <b>RADAR EMA 8/21 — cruces inminentes</b>  <i>(antes del cierre del viernes)</i>`;
  msg += `\n\n🟢 <b>LONG</b> — operable`;
  msg += [0, 1, 2].map(lv => fmtLevel(L, lv)).join('') || '\n  <i>ninguno cerca</i>';
  if (SEND_SHORT && S.length) { msg += `\n\n🔴 <b>SHORT</b> — informativo (débil en acciones)`;
    msg += [0, 1, 2].map(lv => fmtLevel(S, lv)).join(''); }
  msg += `\n\n${tvNote}` +
         `\n✅TV = TV confirma el cruce (entrar). ⏳TV aún no = proyección Yahoo pero TV aún no cruza (esperar).` +
         `\n(+X% s/EMA21) = cuánto ya subió (info; NO descartar extendidos, son momentum).` +
         `\nTickers en watchlist "Empresas para vigilar". Cruce se cierra el viernes.`;
  await tgSend(msg);
})();
