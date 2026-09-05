#!/usr/bin/env node
// backtest_vs_buyhold.mjs — ¿El sistema EMACross BATE a comprar y mantener?
//   Compara sobre el MISMO periodo (10y semanal):
//     A) SISTEMA EMACross anticipado (cartera 7 pos × ¼ Kelly, caja ociosa cuando no hay señal)
//     B) BUY & HOLD SPY (el índice — el benchmark JUSTO: lo que harías en vez del sistema)
//     C) BUY & HOLD universo equiponderado (survivors — inflado por supervivencia, solo referencia)
//   Métricas: retorno total, CAGR, maxDD, Calmar (ret/DD), % tiempo invertido (sistema).
//   READ-ONLY (Yahoo 10y). Uso: node backtest_vs_buyhold.mjs [sample]

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const FAST = 8, SLOW = 21, CAT = 0.18, GAPTH = 0.012, COST = 0.0006;
const POSFRAC = 0.139, MAX_OPEN = 7, SAMPLE = +(process.argv[2] || 200), CONC = 12;
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const ROOT = dirname(fileURLToPath(import.meta.url));
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map(c => { e = e === null ? c : c * k + e * (1 - k); return e; }); };
async function getW(t) { const y = t.replace('.', '-');
  try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`, { headers: UA });
    if (!r.ok) return null; const d = (await r.json()).chart?.result?.[0]; const q = d?.indicators?.quote?.[0];
    if (!d?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < d.timestamp.length; i++) if (q.close[i] != null && q.high[i] != null && q.low[i] != null)
      b.push({ t: d.timestamp[i], h: q.high[i], l: q.low[i], c: q.close[i] });
    return b.length > 60 ? b : null; } catch { return null; } }
async function mapLimit(items, n, fn) { const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }

function emaTrades(b) {
  const cl = b.map(x => x.c), ef = ema(cl, FAST), es = ema(cl, SLOW), out = [];
  let inPos = false, ei = 0, stop = 0;
  for (let i = SLOW + 1; i < b.length; i++) {
    const gap = (ef[i] - es[i]) / cl[i], gp = (ef[i - 1] - es[i - 1]) / cl[i - 1];
    if (!inPos && gap < 0 && Math.abs(gap) < GAPTH && gap > gp) { inPos = true; ei = i; stop = cl[i] * (1 - CAT); continue; }
    if (inPos) { const bear = gp >= 0 && gap < 0;
      if (b[i].l <= stop) { out.push({ tEntry: b[ei].t, weeks: Math.max(1, i - ei), ret: (stop / cl[ei] - 1) - COST * 2 }); inPos = false; }
      else if (bear) { out.push({ tEntry: b[ei].t, weeks: Math.max(1, i - ei), ret: (cl[i] / cl[ei] - 1) - COST * 2 }); inPos = false; } }
  }
  return out;
}
// Cartera del sistema: serie semanal de equity. Devuelve {eqSeries, tSeries, investedPct}
function systemEquity(signals, t0, tEnd, WEEK) {
  signals = [...signals].sort((a, b) => a.tEntry - b.tEntry);
  let eq = 1, si = 0; const open = []; const eqS = [], tS = []; let investedWeeks = 0, totalWeeks = 0;
  for (let t = t0; t <= tEnd; t += WEEK) {
    for (let k = open.length - 1; k >= 0; k--) if (open[k].closeT <= t) { eq *= (1 + POSFRAC * open[k].ret); open.splice(k, 1); }
    while (si < signals.length && signals[si].tEntry <= t) { const g = signals[si++]; if (open.length < MAX_OPEN) open.push({ closeT: g.tEntry + g.weeks * WEEK, ret: g.ret }); }
    totalWeeks++; if (open.length) investedWeeks++;
    eqS.push(eq); tS.push(t);
  }
  return { eqS, tS, investedPct: 100 * investedWeeks / totalWeeks };
}
function metrics(eqS, years) {
  let peak = eqS[0], dd = 0; for (const e of eqS) { if (e > peak) peak = e; const d = e / peak - 1; if (d < dd) dd = d; }
  const tot = eqS[eqS.length - 1] / eqS[0] - 1;
  const cagr = (Math.pow(eqS[eqS.length - 1] / eqS[0], 1 / years) - 1) * 100;
  return { tot: tot * 100, cagr, maxdd: dd * 100, calmar: cagr / Math.abs(dd * 100) };
}

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  const list = (uni.universe || uni).map(u => u.ticker).slice(0, SAMPLE);
  console.log(`\n════ SISTEMA vs COMPRAR Y MANTENER (10 años) ════`);
  const [bars, spyArr] = await Promise.all([ mapLimit(list, CONC, getW), getW('SPY') ]);
  const ok = bars.filter(Boolean);
  const WEEK = 7 * 86400;
  // periodo = ventana completa del SPY (10 años). Los tickers con menos historia entran cuando existen.
  const t0 = spyArr[0].t;
  const tEnd = spyArr[spyArr.length - 1].t;
  const years = (tEnd - t0) / (365.25 * 86400);
  console.log(`  ${ok.length} acciones · periodo ${new Date(t0*1000).getUTCFullYear()}-${new Date(tEnd*1000).getUTCFullYear()} (${years.toFixed(1)} años)\n`);

  // A) Sistema
  const sig = []; for (const b of ok) for (const x of emaTrades(b)) sig.push(x);
  const sys = systemEquity(sig, t0, tEnd, WEEK);
  const mSys = metrics(sys.eqS, years);

  // B) SPY buy & hold (alineado al periodo)
  const spyIn = spyArr.filter(x => x.t >= t0 - WEEK && x.t <= tEnd + WEEK).map(x => x.c);
  const spyEq = spyIn.map(c => c / spyIn[0]);
  const mSpy = metrics(spyEq, years);

  // C) Universo equiponderado buy & hold: media de (precio/precio0) por semana
  const grid = []; for (let t = t0; t <= tEnd; t += WEEK) grid.push(t);
  const idxOf = b => { const m = {}; b.forEach((x, i) => m[x.t] = i); return m; };
  const ewEq = grid.map(t => {
    let s = 0, n = 0;
    for (const b of ok) { const i0 = b.findIndex(x => x.t >= t0); const cur = b.find(x => x.t >= t); if (i0 >= 0 && cur) { s += cur.c / b[i0].c; n++; } }
    return n ? s / n : 1;
  });
  const mEw = metrics(ewEq, years);

  const fmt = m => `ret ${(m.tot >= 0 ? '+' : '') + m.tot.toFixed(0)}%  ·  CAGR ${m.cagr.toFixed(1)}%  ·  maxDD ${m.maxdd.toFixed(1)}%  ·  Calmar ${m.calmar.toFixed(2)}`;
  console.log('  A) SISTEMA EMACross   ' + fmt(mSys) + `  ·  invertido ${sys.investedPct.toFixed(0)}% del tiempo`);
  console.log('  B) BUY & HOLD SPY     ' + fmt(mSpy) + '  ·  (benchmark JUSTO)');
  console.log('  C) B&H universo (EW)  ' + fmt(mEw) + '  ·  ⚠️ inflado por supervivencia');
  console.log('\n  LECTURA: contra el SPY (justo), mira si el sistema gana en CAGR o al menos en Calmar/maxDD.');
  console.log('  El B&H del universo (C) es survivor-bias puro: no es alcanzable en la vida real.\n');
})();
