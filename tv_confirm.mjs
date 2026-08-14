#!/usr/bin/env node
// tv_confirm.mjs — CONFIRMA en TradingView (fuente de verdad) la EMA 8/21 de una acción.
//   Lee el OHLCV REAL de TV por CDP (no Yahoo) y calcula EMA8/EMA21 con el método limpio,
//   para resolver la discrepancia del radar (que usa Yahoo) en cruces al filo (ej. DIS).
//   Un solo chart: setea el símbolo, verifica el cambio, lee barras semanales, reporta.
//   Uso:  node tv_confirm.mjs DIS [CBOE PFE ...]      (tickers del universo)
//
//   NO toca cómo se lanzó TV/CDP (norma: el usuario gestiona el browser). Solo LEE.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { evaluate, disconnect } from '../src/connection.js';
import { setSymbol, setTimeframe } from '../src/core/chart.js';
import { getOhlcv } from '../src/core/data.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const FAST = 8, SLOW = 21;
const SLEEP = ms => new Promise(r => setTimeout(r, ms));
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map(c => { e = e === null ? c : c * k + e * (1 - k); return e; }); };

const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8')).universe;
const tvOf = t => (uni.find(u => u.ticker === t)?.tv) || t;   // símbolo TV (ej. NYSE:DIS)

async function getCurrentSymbol() {
  try { return await evaluate(`(function(){try{return window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().model().mainSeries().symbol()}catch(e){return null}})()`); }
  catch { return null; }
}

async function confirm(ticker) {
  const sym = tvOf(ticker);
  const base = sym.split(':').pop();
  // setear símbolo y verificar el cambio (TV tarda ~12s; poll hasta confirmar)
  await setSymbol({ symbol: sym });
  let ok = false;
  for (let i = 0; i < 60; i++) { await SLEEP(500); const cur = await getCurrentSymbol();
    if (cur && cur.toUpperCase().includes(base.toUpperCase())) { ok = true; break; } }
  if (!ok) return { ticker, error: 'no confirmó el símbolo en TV' };
  await setTimeframe({ timeframe: 'W' });      // semanal
  await SLEEP(2500);                            // que TV recargue las barras semanales
  let data; try { data = await getOhlcv({ count: 60 }); } catch (e) { return { ticker, error: 'sin OHLCV: ' + e.message }; }
  const bars = data.bars || [];
  if (bars.length < SLOW + 3) return { ticker, error: `pocas barras (${bars.length})` };
  // última barra puede ser la semana en curso (viva); TV la incluye igual que el chart
  const cl = bars.map(b => b.close);
  const ef = ema(cl, FAST), es = ema(cl, SLOW);
  const n = cl.length - 1;
  const live = cl[n];
  const gap = (ef[n] - es[n]) / live * 100;
  const crossed = ef[n] > es[n];
  return { ticker, sym, price: live, ema8: ef[n], ema21: es[n], gapPct: gap, crossed, bars: bars.length };
}

(async () => {
  const tickers = process.argv.slice(2);
  if (!tickers.length) { console.log('uso: node tv_confirm.mjs DIS [CBOE ...]'); process.exit(1); }
  console.log(`\n═══ CONFIRMACIÓN TV (fuente de verdad) — EMA 8/21 semanal ═══\n`);
  console.log('ticker  precio    EMA8     EMA21    hueco    estado');
  console.log('─'.repeat(64));
  for (const t of tickers) {
    const r = await confirm(t);
    if (r.error) { console.log(`${t.padEnd(6)}  ⚠️  ${r.error}`); continue; }
    const estado = r.crossed ? '🟢 EMA8>EMA21 (CRUZADO en TV)' : '🔴 EMA8<EMA21 (NO cruzado en TV)';
    console.log(`${r.ticker.padEnd(6)} ${r.price.toFixed(2).padStart(8)} ${r.ema8.toFixed(2).padStart(8)} ${r.ema21.toFixed(2).padStart(8)} ${(r.gapPct>=0?'+':'')+r.gapPct.toFixed(2)+'%'} ${estado}`);
  }
  console.log('');
  await disconnect();
  process.exit(0);
})();
