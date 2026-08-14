#!/usr/bin/env node
// backtest_emacross_full.mjs — BACKTEST CONSOLIDADO del sistema EMACross tal como opera.
//   Reglas FINALES: LONG-only · entrada (Confirmado=cruce | Anticipado=gap<1.2% convergiendo)
//   · stop catástrofe -18% · salida por cruce contrario. Coste 0.06%/lado.
//   Saca el comportamiento completo: WR, PF, expectancy, Σret, drawdown de la curva,
//   walk-forward 4 ventanas, desglose por AÑO, motivo de salida, mejores/peores, duración.
// READ-ONLY (Yahoo 10y semanal).

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const COST = 0.0006, FAST = 8, SLOW = 21, CAT = 0.18, GAPTH = 0.012;
const SAMPLE = +(process.argv[2] || 250);
const sleep = ms => new Promise(r => setTimeout(r, ms));
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const ROOT = dirname(fileURLToPath(import.meta.url));
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map(c => { e = e === null ? c : c * k + e * (1 - k); return e; }); };
const med = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const yearOf = t => new Date(t * 1000).getUTCFullYear();

async function getW(t) { const y = t.replace('.', '-');
  try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`, { headers: UA });
    if (!r.ok) return null; const d = (await r.json()).chart?.result?.[0]; const q = d?.indicators?.quote?.[0];
    if (!d?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < d.timestamp.length; i++) if (q.close[i] != null && q.high[i] != null && q.low[i] != null)
      b.push({ t: d.timestamp[i], h: q.high[i], l: q.low[i], c: q.close[i] });
    return b.length > 60 ? b : null; } catch { return null; } }

// Genera trades LONG de un ticker según el modo. Salida = stop -18% o cruce bajista.
function trades(bars, mode) {
  const cl = bars.map(b => b.c), ef = ema(cl, FAST), es = ema(cl, SLOW), out = [];
  let inPos = false, ei = 0, stop = 0;
  for (let i = SLOW + 1; i < bars.length; i++) {
    const gap = (ef[i] - es[i]) / cl[i], gapPrev = (ef[i - 1] - es[i - 1]) / cl[i - 1];
    const bull = ef[i - 1] <= es[i - 1] && ef[i] > es[i];
    const bear = ef[i - 1] >= es[i - 1] && ef[i] < es[i];
    const longImm = gap < 0 && Math.abs(gap) < GAPTH && gap > gapPrev;
    const enter = mode === 'anticip' ? (!inPos && longImm) : (!inPos && bull);
    if (enter) { inPos = true; ei = i; stop = cl[i] * (1 - CAT); continue; }
    if (inPos) {
      if (bars[i].l <= stop) { out.push({ ret: (stop / cl[ei] - 1) * 100 - COST * 200, t: bars[ei].t, wk: i - ei, why: 'stop' }); inPos = false; }
      else if (bear) { out.push({ ret: (cl[i] / cl[ei] - 1) * 100 - COST * 200, t: bars[ei].t, wk: i - ei, why: 'cruce' }); inPos = false; }
    }
  }
  return out;
}

function stat(rs) { const n = rs.length; if (!n) return { n: 0 };
  const s = rs.reduce((a, b) => a + b, 0), w = rs.filter(x => x > 0), l = rs.filter(x => x <= 0);
  const gw = w.reduce((a, b) => a + b, 0), gl = l.reduce((a, b) => a + b, 0);
  return { n, sum: s, mean: s / n, wr: 100 * w.length / n, pf: gl ? Math.abs(gw / gl) : 0,
    avgW: w.length ? gw / w.length : 0, avgL: l.length ? gl / l.length : 0,
    best: Math.max(...rs), worst: Math.min(...rs) }; }

function maxDD(trades) {   // drawdown de la curva de %-acumulado (equiponderada, sin compón.)
  const sorted = [...trades].sort((a, b) => a.t - b.t);
  let eq = 0, peak = 0, dd = 0;
  for (const t of sorted) { eq += t.ret; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); }
  return dd;
}

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  const tickers = (uni.universe || uni).slice(0, SAMPLE).map(u => u.ticker);
  console.log(`\n════ BACKTEST CONSOLIDADO — EMACross (LONG, stop -18%, salida cruce) ════`);
  console.log(`  ${tickers.length} acciones · 10 años semanal · coste 0.06%/lado\n`);
  const C = [], A = []; let done = 0, ok = 0;
  for (const tk of tickers) { const b = await getW(tk); done++;
    if (done % 50 === 0) process.stdout.write(`  …${done}/${tickers.length}\n`);
    await sleep(110); if (!b) continue; ok++;
    for (const t of trades(b, 'confirm')) C.push(t);
    for (const t of trades(b, 'anticip')) A.push(t); }
  console.log(`  ${ok} acciones con datos\n`);

  for (const [name, T] of [['CONFIRMADO (cruce)', C], ['ANTICIPADO (gap<1.2%)', A]]) {
    const s = stat(T.map(t => t.ret)), dd = maxDD(T);
    const payoff = s.avgL ? Math.abs(s.avgW / s.avgL) : 0;
    const tmin = Math.min(...T.map(t => t.t)), tmax = Math.max(...T.map(t => t.t)), span = (tmax - tmin) / 4;
    const wf = [0, 1, 2, 3].map(wi => { const seg = T.filter(t => Math.min(3, Math.floor((t.t - tmin) / span)) === wi).map(t => t.ret); return stat(seg); });
    const wfPos = wf.filter(w => w.n >= 5 && w.mean > 0).length;
    const byStop = T.filter(t => t.why === 'stop').length;
    console.log(`── ${name} ──`);
    console.log(`  trades ${s.n}  ·  WR ${s.wr.toFixed(0)}%  ·  PF ${s.pf.toFixed(2)}  ·  expectancy ${s.mean >= 0 ? '+' : ''}${s.mean.toFixed(2)}%/trade`);
    console.log(`  Σret ${s.sum >= 0 ? '+' : ''}${s.sum.toFixed(0)}%  ·  ganadora media +${s.avgW.toFixed(1)}%  ·  perdedora media ${s.avgL.toFixed(1)}%  ·  payoff ${payoff.toFixed(2)}x`);
    console.log(`  mejor +${s.best.toFixed(0)}%  ·  peor ${s.worst.toFixed(0)}%  ·  duración mediana ${med(T.map(t => t.wk)).toFixed(0)} sem  ·  salidas por stop -18%: ${(100 * byStop / s.n).toFixed(0)}%`);
    console.log(`  maxDrawdown curva-% ${dd.toFixed(0)}%  ·  retorno/drawdown ${(s.sum / Math.abs(dd || 1)).toFixed(1)}x`);
    console.log(`  walk-forward: ` + wf.map((w, i) => `V${i + 1} ${w.n ? (w.mean >= 0 ? '+' : '') + w.mean.toFixed(1) + '%' : '—'}`).join(' · ') + `  →  ${wfPos}/4`);
    // por año de entrada
    const years = [...new Set(T.map(t => yearOf(t.t)))].sort();
    console.log('  por año: ' + years.map(y => { const seg = T.filter(t => yearOf(t.t) === y).map(t => t.ret); const ss = stat(seg); return `${y}:${ss.mean >= 0 ? '+' : ''}${ss.mean.toFixed(0)}%(${ss.n})`; }).join(' '));
    console.log('');
  }
  console.log(`  Nota: dataset = universo de HOY sobre el pasado (sesgo de supervivencia).`);
  console.log(`  Los números son de EDGE RELATIVO, no de retorno garantizado. Robustez = WF + estabilidad por año.\n`);
})();
