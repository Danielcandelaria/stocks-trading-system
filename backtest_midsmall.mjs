#!/usr/bin/env node
// backtest_midsmall.mjs — EMA 8/21 semanal en MID/SMALL caps (long-only, stop -18%, salida cruce).
//   Compara contra la baseline large-cap (PF 2.36 WF 4/4). Universo: universe_midsmall.json.
//   ⚠️ Sesgo de supervivencia PEOR en small-caps → números optimistas. WF y estabilidad mandan.
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const COST = 0.0006, FAST = 8, SLOW = 21, CAT = 0.18, SAMPLE = +(process.argv[2] || 996);
const sleep = ms => new Promise(r => setTimeout(r, ms));
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const ROOT = dirname(fileURLToPath(import.meta.url));
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map(c => { e = e === null ? c : c * k + e * (1 - k); return e; }); };
const med = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
async function getW(t) { const y = t.replace('.', '-');
  try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`, { headers: UA });
    if (!r.ok) return null; const d = (await r.json()).chart?.result?.[0]; const q = d?.indicators?.quote?.[0];
    if (!d?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < d.timestamp.length; i++) if (q.close[i] != null && q.high[i] != null && q.low[i] != null) b.push({ t: d.timestamp[i], h: q.high[i], l: q.low[i], c: q.close[i] });
    return b.length > 60 ? b : null; } catch { return null; } }
function trades(bars) { const cl = bars.map(b => b.c), ef = ema(cl, FAST), es = ema(cl, SLOW), out = [];
  let inPos = false, ei = 0, stop = 0;
  for (let i = SLOW + 1; i < bars.length; i++) { const bull = ef[i - 1] <= es[i - 1] && ef[i] > es[i], bear = ef[i - 1] >= es[i - 1] && ef[i] < es[i];
    if (!inPos && bull) { inPos = true; ei = i; stop = cl[i] * (1 - CAT); continue; }
    if (inPos) { if (bars[i].l <= stop) { out.push({ ret: (stop / cl[ei] - 1) * 100 - COST * 200, t: bars[ei].t, wk: i - ei }); inPos = false; }
      else if (bear) { out.push({ ret: (cl[i] / cl[ei] - 1) * 100 - COST * 200, t: bars[ei].t, wk: i - ei }); inPos = false; } } }
  return out; }
function stat(rs) { const n = rs.length; if (!n) return { n: 0 }; const s = rs.reduce((a, b) => a + b, 0), w = rs.filter(x => x > 0), l = rs.filter(x => x <= 0), gl = l.reduce((a, b) => a + b, 0);
  return { n, sum: s, mean: s / n, wr: 100 * w.length / n, pf: gl ? Math.abs(w.reduce((a, b) => a + b, 0) / gl) : 0, avgW: w.length ? w.reduce((a, b) => a + b, 0) / w.length : 0, avgL: l.length ? gl / l.length : 0 }; }
(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe_midsmall.json'), 'utf8')).universe.slice(0, SAMPLE);
  console.log(`\n══ EMA 8/21 en MID/SMALL caps (long-only, stop -18%) · ${uni.length} tickers 10y ══\n`);
  const all = []; let done = 0, ok = 0;
  for (const u of uni) { const b = await getW(u.ticker); done++; if (done % 100 === 0) process.stdout.write(`  …${done}/${uni.length}\n`); await sleep(90); if (!b) continue; ok++; for (const t of trades(b)) all.push(t); }
  const s = stat(all.map(t => t.ret));
  const tmin = Math.min(...all.map(t => t.t)), tmax = Math.max(...all.map(t => t.t)), span = (tmax - tmin) / 4;
  const wf = [0, 1, 2, 3].map(wi => stat(all.filter(t => Math.min(3, Math.floor((t.t - tmin) / span)) === wi).map(t => t.ret)));
  const wfPos = wf.filter(w => w.n >= 5 && w.mean > 0).length;
  console.log(`  ${ok} acciones con datos · ${s.n} trades\n`);
  console.log(`  WR ${s.wr.toFixed(0)}%  ·  PF ${s.pf.toFixed(2)}  ·  expectancy ${s.mean >= 0 ? '+' : ''}${s.mean.toFixed(2)}%/trade  ·  Σret ${s.sum >= 0 ? '+' : ''}${s.sum.toFixed(0)}%`);
  console.log(`  ganadora media +${s.avgW.toFixed(1)}%  ·  perdedora media ${s.avgL.toFixed(1)}%  ·  duración mediana ${med(all.map(t => t.wk)).toFixed(0)} sem`);
  console.log(`  walk-forward: ` + wf.map((w, i) => `V${i + 1} ${w.n ? (w.mean >= 0 ? '+' : '') + w.mean.toFixed(1) + '%' : '—'}`).join(' · ') + `  →  ${wfPos}/4`);
  console.log(`\n  Baseline LARGE-cap (ref): PF 2.36, +7.57%/tr, WF 4/4.`);
  console.log(`  ⚠️ Recuerda: supervivencia peor en small-caps → este PF es OPTIMISTA.\n`);
})();
