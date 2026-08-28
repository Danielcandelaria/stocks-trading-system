#!/usr/bin/env node
// backtest_prior_momentum.mjs — ¿El MOMENTUM PREVIO predice qué cruce anticipado será FUERTE?
//   Etiqueta cada trade EMACross anticipado con su retorno de las 26 semanas ANTES de la señal
//   (momentum previo), lo parte en terciles y compara el retorno FORWARD del trade.
//   Si el tercil de momentum previo ALTO rinde más (y aguanta en 2 mitades), priorizarlo sesga
//   las entradas hacia las que probablemente serán fuertes. Se mira también SIN parabólicas.
//   READ-ONLY (Yahoo 10y semanal). Uso: node backtest_prior_momentum.mjs [sample]

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const FAST = 8, SLOW = 21, TREND = 200, CAT = 0.18, GAPTH = 0.012, COST = 0.0006, LOOKBACK = 26, EXT_MAX = 30;
const SPLIT_YEAR = 2021, SAMPLE = +(process.argv[2] || 220), CONC = 12;
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const ROOT = dirname(fileURLToPath(import.meta.url));
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map(c => { e = e === null ? c : c * k + e * (1 - k); return e; }); };
const med = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sum = a => a.reduce((x, y) => x + y, 0);
const yearOf = t => new Date(t * 1000).getUTCFullYear();
async function getW(t) { const y = t.replace('.', '-');
  try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`, { headers: UA });
    if (!r.ok) return null; const d = (await r.json()).chart?.result?.[0]; const q = d?.indicators?.quote?.[0];
    if (!d?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < d.timestamp.length; i++) if (q.close[i] != null && q.high[i] != null && q.low[i] != null)
      b.push({ t: d.timestamp[i], h: q.high[i], l: q.low[i], c: q.close[i] });
    return b.length > 240 ? b : null; } catch { return null; } }
async function mapLimit(items, n, fn) { const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }
function stat(rs) { const n = rs.length; if (!n) return { n: 0, pf: 0, wr: 0, mean: 0, med: 0 };
  const w = rs.filter(x => x > 0), gw = sum(w), gl = sum(rs.filter(x => x <= 0));
  return { n, mean: sum(rs) / n, med: med(rs), wr: 100 * w.length / n, pf: gl ? Math.abs(gw / gl) : 999 }; }

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  const list = (uni.universe || uni).map(u => u.ticker).slice(0, SAMPLE);
  console.log(`\n════ ¿EL MOMENTUM PREVIO (${LOOKBACK} sem) PREDICE LA FUERZA DEL CRUCE? ════`);
  console.log(`  ${list.length} acc · 10y semanal · EMACross anticipado\n`);
  const bars = (await mapLimit(list, CONC, getW)).filter(Boolean);
  const trades = [];
  for (const b of bars) {
    const cl = b.map(x => x.c), ef = ema(cl, FAST), es = ema(cl, SLOW), e200 = ema(cl, TREND);
    let inPos = false, ei = 0, stop = 0, prior = 0, d200 = 0;
    for (let i = SLOW + 1; i < b.length; i++) {
      const gap = (ef[i] - es[i]) / cl[i], gp = (ef[i - 1] - es[i - 1]) / cl[i - 1];
      const longImm = gap < 0 && Math.abs(gap) < GAPTH && gap > gp;
      if (!inPos && longImm && i >= Math.max(TREND, LOOKBACK)) {
        inPos = true; ei = i; stop = cl[i] * (1 - CAT);
        prior = (cl[i] / cl[i - LOOKBACK] - 1) * 100; d200 = (cl[i] - e200[i]) / e200[i] * 100;
        continue;
      }
      if (inPos) { const bear = gp >= 0 && gap < 0;
        if (b[i].l <= stop) { trades.push({ ret: (stop / cl[ei] - 1) * 100 - COST * 200, t: b[ei].t, prior, d200 }); inPos = false; }
        else if (bear) { trades.push({ ret: (cl[i] / cl[ei] - 1) * 100 - COST * 200, t: b[ei].t, prior, d200 }); inPos = false; } }
    }
  }
  console.log(`  trades: ${trades.length}\n`);
  const analyze = (label, set) => {
    const ps = set.map(t => t.prior).sort((a, b) => a - b);
    const q1 = ps[Math.floor(ps.length / 3)], q2 = ps[Math.floor(2 * ps.length / 3)];
    const bin = t => t.prior <= q1 ? 'BAJO' : t.prior <= q2 ? 'MEDIO' : 'ALTO';
    console.log(`── ${label} (cortes momentum previo: BAJO ≤${q1.toFixed(0)}% · ALTO >${q2.toFixed(0)}%) ──`);
    for (const g of ['BAJO', 'MEDIO', 'ALTO']) {
      const arr = set.filter(t => bin(t) === g);
      const s = stat(arr.map(t => t.ret));
      const h1 = stat(arr.filter(t => yearOf(t.t) < SPLIT_YEAR).map(t => t.ret));
      const h2 = stat(arr.filter(t => yearOf(t.t) >= SPLIT_YEAR).map(t => t.ret));
      console.log(`  ${g.padEnd(6)} n=${String(s.n).padStart(4)}  PF ${s.pf.toFixed(2).padStart(5)}  WR ${s.wr.toFixed(0)}%  media ${(s.mean >= 0 ? '+' : '') + s.mean.toFixed(2)}%  med ${(s.med >= 0 ? '+' : '') + s.med.toFixed(2)}%  |  PF mitades ${h1.pf.toFixed(2)}/${h2.pf.toFixed(2)}`);
    }
    console.log('');
  };
  analyze('TODOS', trades);
  analyze('SIN parabólicas (d200≤30%)', trades.filter(t => t.d200 <= EXT_MAX));
  console.log('  VEREDICTO: si ALTO bate a BAJO en PF y media, en ambas mitades y también sin parabólicas →');
  console.log('  el momentum previo predice fuerza; priorizar entradas anticipadas con momentum previo alto.\n');
})();
