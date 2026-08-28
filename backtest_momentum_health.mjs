#!/usr/bin/env node
// backtest_momentum_health.mjs — ¿Vale ordenar/filtrar la escalera por SALUD DEL MOMENTUM?
//   "Salud" = distancia del precio a su EMA200 en la entrada (dist200):
//     DEBAJO (<0%)  ·  SANO (0-30%)  ·  EXTENDIDO (>30%, parabólico).
//   Clasifica cada trade EMACross anticipado por dist200 y compara PF/mediana/expectancy.
//   Si el tramo SANO bate a EXTENDIDO y DEBAJO de forma consistente en 2 mitades → vale
//   priorizar salud. Si EXTENDIDO gana (como sugería el ranking por fuerza) → NO tocar.
//   READ-ONLY (Yahoo 10y semanal). Uso: node backtest_momentum_health.mjs [sample]

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const FAST = 8, SLOW = 21, TREND = 200, CAT = 0.18, GAPTH = 0.012, COST = 0.0006;
const SPLIT_YEAR = 2021, SAMPLE = +(process.argv[2] || 220), CONC = 10;
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
    return b.length > 220 ? b : null; } catch { return null; } }
async function mapLimit(items, n, fn) { const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }
function stat(rs) { const n = rs.length; if (!n) return { n: 0, pf: 0, wr: 0, mean: 0, med: 0 };
  const s = rs.reduce((a, b) => a + b, 0), w = rs.filter(x => x > 0), l = rs.filter(x => x <= 0);
  const gw = w.reduce((a, b) => a + b, 0), gl = l.reduce((a, b) => a + b, 0);
  return { n, mean: s / n, med: med(rs), wr: 100 * w.length / n, pf: gl ? Math.abs(gw / gl) : 999 }; }

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  const list = (uni.universe || uni).map(u => u.ticker).slice(0, SAMPLE);
  console.log(`\n════ SALUD DEL MOMENTUM (dist a EMA200) — EMACross anticipado ════`);
  console.log(`  ${list.length} acciones · 10y semanal · bins: DEBAJO<0% · SANO 0-30% · EXTENDIDO>30%\n`);
  const bars = (await mapLimit(list, CONC, getW)).filter(Boolean);

  const trades = [];
  for (const b of bars) {
    const cl = b.map(x => x.c), ef = ema(cl, FAST), es = ema(cl, SLOW), e200 = ema(cl, TREND);
    let inPos = false, ei = 0, stop = 0, d200 = 0;
    for (let i = SLOW + 1; i < b.length; i++) {
      const gap = (ef[i] - es[i]) / cl[i], gapPrev = (ef[i - 1] - es[i - 1]) / cl[i - 1];
      const longImm = gap < 0 && Math.abs(gap) < GAPTH && gap > gapPrev;
      if (!inPos && longImm && i >= TREND) { inPos = true; ei = i; stop = cl[i] * (1 - CAT); d200 = (cl[i] - e200[i]) / e200[i] * 100; continue; }
      if (inPos) {
        const bear = gapPrev >= 0 && gap < 0;
        if (b[i].l <= stop) { trades.push({ ret: (stop / cl[ei] - 1) * 100 - COST * 200, t: b[ei].t, d200 }); inPos = false; }
        else if (bear) { trades.push({ ret: (cl[i] / cl[ei] - 1) * 100 - COST * 200, t: b[ei].t, d200 }); inPos = false; }
      }
    }
  }
  console.log(`  trades: ${trades.length}\n`);
  const bin = t => t.d200 < 0 ? 'DEBAJO' : (t.d200 <= 30 ? 'SANO' : 'EXTENDIDO');
  const show = (label, arr) => {
    const s = stat(arr.map(t => t.ret));
    const h1 = stat(arr.filter(t => yearOf(t.t) < SPLIT_YEAR).map(t => t.ret));
    const h2 = stat(arr.filter(t => yearOf(t.t) >= SPLIT_YEAR).map(t => t.ret));
    console.log(`  ${label.padEnd(10)} n=${String(s.n).padStart(4)}  PF ${s.pf.toFixed(2).padStart(5)}  WR ${s.wr.toFixed(0)}%  exp ${(s.mean >= 0 ? '+' : '') + s.mean.toFixed(2)}%  med ${(s.med >= 0 ? '+' : '') + s.med.toFixed(2)}%  |  PF mitades ${h1.pf.toFixed(2)}/${h2.pf.toFixed(2)}`);
  };
  console.log('  ── Rendimiento por SALUD DEL MOMENTUM en la entrada ──');
  for (const g of ['DEBAJO', 'SANO', 'EXTENDIDO']) show(g, trades.filter(t => bin(t) === g));
  console.log('');
  show('TODOS', trades);
  console.log('\n  VEREDICTO: si SANO bate claramente a EXTENDIDO y DEBAJO en ambas mitades → priorizar salud.');
  console.log('  Si EXTENDIDO gana → el momentum fuerte manda, NO penalizar la extensión (mi intuición CEG>EQX sería errónea).\n');
})();
