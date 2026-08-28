#!/usr/bin/env node
// backtest_ext_penalty_portfolio.mjs — ¿Penalizar las PARABÓLICAS mejora la CARTERA?
//   Simula cartera EMACross 10y (MAX_OPEN × ¼ Kelly). Compara:
//     A) TODAS las señales (baseline actual)
//     B) SKIP parabólicas (dist200 > EXT_MAX en la entrada)  ← el cap, en su forma dura
//   Mide retorno, maxDD, Calmar. Si B sube Calmar/baja DD sin perder mucho retorno → el cap
//   ayuda (degradar, que es más suave que skip, sería al menos igual de bueno). 2 mitades.
//   READ-ONLY (Yahoo 10y). Uso: node backtest_ext_penalty_portfolio.mjs [sample]

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const FAST = 8, SLOW = 21, TREND = 200, CAT = 0.18, GAPTH = 0.012, COST = 0.0006;
const POSFRAC = 0.139, MAX_OPEN = 7, EXT_MAX = 30;
const SPLIT_YEAR = 2021, SAMPLE = +(process.argv[2] || 220), CONC = 10;
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const ROOT = dirname(fileURLToPath(import.meta.url));
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map(c => { e = e === null ? c : c * k + e * (1 - k); return e; }); };
const yearOf = t => new Date(t * 1000).getUTCFullYear();
async function getW(t) { const y = t.replace('.', '-');
  try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`, { headers: UA });
    if (!r.ok) return null; const d = (await r.json()).chart?.result?.[0]; const q = d?.indicators?.quote?.[0];
    if (!d?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < d.timestamp.length; i++) if (q.close[i] != null && q.high[i] != null && q.low[i] != null)
      b.push({ t: d.timestamp[i], h: q.high[i], l: q.low[i], c: q.close[i] });
    return b.length > 220 ? b : null; } catch { return null; } }
async function mapLimit(items, n, fn) { const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }

function sim(signals) {
  signals = [...signals].sort((a, b) => a.tEntry - b.tEntry);
  const WEEK = 7 * 86400, t0 = signals[0].tEntry, tEnd = signals[signals.length - 1].tEntry + 60 * WEEK;
  let eq = 1, peak = 1, maxdd = 0, si = 0; const open = []; const path = [];
  for (let t = t0; t <= tEnd; t += WEEK) {
    for (let k = open.length - 1; k >= 0; k--) if (open[k].closeT <= t) { eq *= (1 + POSFRAC * open[k].ret); open.splice(k, 1); }
    while (si < signals.length && signals[si].tEntry <= t) { const g = signals[si++]; if (open.length < MAX_OPEN) open.push({ closeT: g.tEntry + g.weeks * WEEK, ret: g.ret }); }
    if (eq > peak) peak = eq; const dd = eq / peak - 1; if (dd < maxdd) maxdd = dd; path.push({ t, eq });
  }
  return { eq, maxdd: maxdd * 100, path };
}
const ddHalf = (path, first) => { const seg = path.filter(p => first ? yearOf(p.t) < SPLIT_YEAR : yearOf(p.t) >= SPLIT_YEAR);
  let peak = seg.length ? seg[0].eq : 1, dd = 0; for (const p of seg) { if (p.eq > peak) peak = p.eq; const d = p.eq / peak - 1; if (d < dd) dd = d; } return dd * 100; };

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  const list = (uni.universe || uni).map(u => u.ticker).slice(0, SAMPLE);
  console.log(`\n════ ¿PENALIZAR PARABÓLICAS (>${EXT_MAX}% s/EMA200) MEJORA LA CARTERA? ════`);
  console.log(`  ${list.length} acciones · 10y · ${MAX_OPEN} pos × ${(POSFRAC * 100).toFixed(1)}%\n`);
  const bars = (await mapLimit(list, CONC, getW)).filter(Boolean);
  const all = [];
  for (const b of bars) {
    const cl = b.map(x => x.c), ef = ema(cl, FAST), es = ema(cl, SLOW), e200 = ema(cl, TREND);
    let inPos = false, ei = 0, stop = 0, d200 = 0;
    for (let i = SLOW + 1; i < b.length; i++) {
      const gap = (ef[i] - es[i]) / cl[i], gapPrev = (ef[i - 1] - es[i - 1]) / cl[i - 1];
      const longImm = gap < 0 && Math.abs(gap) < GAPTH && gap > gapPrev;
      if (!inPos && longImm && i >= TREND) { inPos = true; ei = i; stop = cl[i] * (1 - CAT); d200 = (cl[i] - e200[i]) / e200[i] * 100; continue; }
      if (inPos) {
        const bear = gapPrev >= 0 && gap < 0;
        if (b[i].l <= stop) { all.push({ tEntry: b[ei].t, weeks: Math.max(1, i - ei), ret: (stop / cl[ei] - 1) - COST * 2, d200 }); inPos = false; }
        else if (bear) { all.push({ tEntry: b[ei].t, weeks: Math.max(1, i - ei), ret: (cl[i] / cl[ei] - 1) - COST * 2, d200 }); inPos = false; }
      }
    }
  }
  const nonPara = all.filter(s => s.d200 <= EXT_MAX);
  console.log(`  señales: todas ${all.length} · parabólicas ${all.length - nonPara.length} (${(100 * (all.length - nonPara.length) / all.length).toFixed(0)}%)\n`);
  const A = sim(all), B = sim(nonPara);
  const fmt = r => ((r.eq - 1) >= 0 ? '+' : '') + ((r.eq - 1) * 100).toFixed(0) + '%';
  const cal = r => (((r.eq - 1) * 100) / Math.abs(r.maxdd)).toFixed(2);
  console.log('  Política                RetTotal   maxDD     Calmar   |  DD 1ª/2ª mitad');
  console.log(`  A) TODAS (actual)       ${fmt(A).padStart(7)}    ${A.maxdd.toFixed(1)}%   ${cal(A).padStart(5)}   |  ${ddHalf(A.path, true).toFixed(1)}% / ${ddHalf(A.path, false).toFixed(1)}%`);
  console.log(`  B) SKIP parabólicas     ${fmt(B).padStart(7)}    ${B.maxdd.toFixed(1)}%   ${cal(B).padStart(5)}   |  ${ddHalf(B.path, true).toFixed(1)}% / ${ddHalf(B.path, false).toFixed(1)}%`);
  console.log('\n  LECTURA: si B mejora Calmar y/o DD → penalizar parabólicas ayuda (degradar, más suave que');
  console.log('  skip, es ≥ igual de bueno). Si B empeora → las parabólicas aportan y NO conviene el cap.\n');
})();
