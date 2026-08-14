#!/usr/bin/env node
// backtest_ema_cross.mjs — EMA 8/21 SEMANAL, cruce puro (replica el Pine del usuario).
//   LONG: EMA8 cruza sobre EMA21 · SHORT: EMA8 cruza bajo EMA21.
//   Aguanta hasta el cruce contrario. Sin TP/SL. Trend-following puro.
//
// Se prueban 3 modos (Solo LONG / Solo SHORT / LONG+SHORT) sobre el universo, con
// WALK-FORWARD (4 ventanas). Métrica de trend-following: NO tanto el WR (será bajo)
// como que la GANADORA media >> PERDEDORA media y que aguante fuera de muestra.
// READ-ONLY (Yahoo semanal, 10 años).

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const COST = 0.0005 + 0.0001;   // comisión 0.05% + slippage aprox, por lado
const SAMPLE = +(process.argv[2] || 250), RANGE = process.argv[3] || '10y';
const FAST = 8, SLOW = 21;
const sleep = ms => new Promise(r => setTimeout(r, ms));

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const ROOT = dirname(fileURLToPath(import.meta.url));
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map((c, i) => { e = e === null ? c : c * k + e * (1 - k); return i >= p - 1 ? e : null; }); };

async function getWeekly(t) { const y = t.replace('.', '-');
  try { const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=${RANGE}&interval=1wk`, { headers: UA });
    if (!res.ok) return null; const r = (await res.json()).chart?.result?.[0]; const q = r?.indicators?.quote?.[0];
    if (!r?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < r.timestamp.length; i++) if (q.close[i] != null) b.push({ t: r.timestamp[i], c: q.close[i] });
    return b.length > 40 ? b : null; } catch { return null; } }

// Devuelve los trades (entrada→salida por cruce contrario) de un ticker.
function tradesOf(bars) {
  const cl = bars.map(b => b.c), ef = ema(cl, FAST), es = ema(cl, SLOW);
  const out = [];
  let pos = 0, entryPx = 0, entryT = 0;   // pos: +1 long, -1 short, 0 flat
  for (let i = SLOW + 1; i < bars.length; i++) {
    if (ef[i - 1] == null || es[i - 1] == null) continue;
    const bull = ef[i - 1] <= es[i - 1] && ef[i] > es[i];   // cruce alcista en la vela i
    const bear = ef[i - 1] >= es[i - 1] && ef[i] < es[i];
    if (bull) {
      if (pos === -1) { out.push({ dir: 'S', ret: (entryPx / cl[i] - 1) * 100 - COST * 200, t: entryT }); }
      pos = 1; entryPx = cl[i]; entryT = bars[i].t;
    } else if (bear) {
      if (pos === 1) { out.push({ dir: 'L', ret: (cl[i] / entryPx - 1) * 100 - COST * 200, t: entryT }); }
      pos = -1; entryPx = cl[i]; entryT = bars[i].t;
    }
  }
  return out;
}

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  const tickers = (uni.universe || uni).slice(0, SAMPLE).map(u => u.ticker);
  console.log(`\n══ EMA 8/21 SEMANAL — CRUCE PURO (LONG+SHORT) ══`);
  console.log(`  ${tickers.length} tickers · ${RANGE} semanal · aguanta hasta cruce contrario\n`);

  const all = []; let done = 0, ok = 0, tmin = Infinity, tmax = -Infinity;
  for (const tk of tickers) {
    const bars = await getWeekly(tk); done++;
    if (done % 50 === 0) process.stdout.write(`  …${done}/${tickers.length}\n`);
    await sleep(110); if (!bars) continue; ok++;
    for (const tr of tradesOf(bars)) { all.push(tr); tmin = Math.min(tmin, tr.t); tmax = Math.max(tmax, tr.t); }
  }
  console.log(`\n  ${ok} tickers · ${all.length} trades (cruces completos)\n`);

  const span = (tmax - tmin) / 4, win = t => Math.min(3, Math.floor((t - tmin) / span));
  const stat = arr => { const n = arr.length; if (!n) return { n: 0 };
    const s = arr.reduce((a, b) => a + b, 0); const w = arr.filter(x => x > 0), l = arr.filter(x => x <= 0);
    const gl = l.reduce((a, b) => a + b, 0);
    return { n, sum: s, m: s / n, wr: 100 * w.length / n, pf: gl !== 0 ? Math.abs(w.reduce((a, b) => a + b, 0) / gl) : null,
      avgW: w.length ? w.reduce((a, b) => a + b, 0) / w.length : 0, avgL: l.length ? gl / l.length : 0 }; };
  const fmt = v => (v >= 0 ? '+' : '') + v.toFixed(2);

  console.log('  ' + 'modo'.padEnd(13) + 'n'.padStart(6) + 'Σret%'.padStart(9) + '%/tr'.padStart(7) + 'WR'.padStart(6) + 'PF'.padStart(6) + 'ganaMed'.padStart(9) + 'perdMed'.padStart(9) + '  WF');
  console.log('  ' + '─'.repeat(76));
  const modes = { 'Solo LONG': all.filter(t => t.dir === 'L'), 'Solo SHORT': all.filter(t => t.dir === 'S'), 'LONG+SHORT': all };
  for (const [name, arr] of Object.entries(modes)) {
    const s = stat(arr.map(t => t.ret));
    const wf = [0, 1, 2, 3].map(wi => stat(arr.filter(t => win(t.t) === wi).map(t => t.ret)));
    const wfPos = wf.filter(w => w.n >= 5 && w.m > 0).length;
    console.log('  ' + name.padEnd(13) + String(s.n).padStart(6) + fmt(s.sum).padStart(9) + fmt(s.m).padStart(7)
      + (s.wr.toFixed(0) + '%').padStart(6) + (s.pf ? s.pf.toFixed(2) : '—').padStart(6) + fmt(s.avgW).padStart(9) + fmt(s.avgL).padStart(9) + `   ${wfPos}/4`);
  }
  console.log(`\n  Trend-following sano: WR bajo (~40%) pero ganaMed >> |perdMed| y PF>1, WF 4/4.`);
  console.log(`  Ojo al SHORT en acciones: la deriva alcista y el coste de préstamo lo penalizan.\n`);
})();
