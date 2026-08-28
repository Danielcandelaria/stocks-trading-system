#!/usr/bin/env node
// backtest_combined_ladder.mjs — ¿La ESCALERA COMBINADA (EMACross + WeeklySwing) mejora
//   sobre cada sistema por separado? Simula 3 carteras 10y (MAX_OPEN pos × ¼ Kelly):
//     A) EMACross solo (momentum anticipado)
//     B) WeeklySwing solo (reversión DeMark-9, reglas reales de scanner_weekly.mjs)
//     C) Combinada (ambos alimentan los mismos slots, señales en orden temporal)
//   Mide retorno, maxDD, Calmar (ret/DD) y la CORRELACIÓN entre las curvas A y B
//   (la tesis del manual: ρ≈0.47 → combinar baja el drawdown). Desglose por 2 mitades.
//   READ-ONLY (Yahoo 10y semanal). Uso: node backtest_combined_ladder.mjs [sample]

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const FAST = 8, SLOW = 21, CAT = 0.18, GAPTH = 0.012, COST = 0.0006, WS_COST = 0.0005, TIME_STOP_W = 52;
const POSFRAC = 0.139, MAX_OPEN = 7;
const SPLIT_YEAR = 2021, SAMPLE = +(process.argv[2] || 200), CONC = 10;
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup, computeTDCountdown } from '../scanner/demark_calc.mjs';
const ROOT = dirname(fileURLToPath(import.meta.url));
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map(c => { e = e === null ? c : c * k + e * (1 - k); return e; }); };
const yearOf = t => new Date(t * 1000).getUTCFullYear();

async function getW(t) { const y = t.replace('.', '-');
  try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`, { headers: UA });
    if (!r.ok) return null; const d = (await r.json()).chart?.result?.[0]; const q = d?.indicators?.quote?.[0];
    if (!d?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < d.timestamp.length; i++) if (q.close[i] != null && q.high[i] != null && q.low[i] != null && q.open[i] != null)
      b.push({ t: d.timestamp[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
    return b.length > 60 ? b : null; } catch { return null; } }
async function mapLimit(items, n, fn) { const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }

// EMACross anticipado
function emaTrades(b) {
  const cl = b.map(x => x.c), ef = ema(cl, FAST), es = ema(cl, SLOW), out = [];
  let inPos = false, ei = 0, stop = 0;
  for (let i = SLOW + 1; i < b.length; i++) {
    const gap = (ef[i] - es[i]) / cl[i], gapPrev = (ef[i - 1] - es[i - 1]) / cl[i - 1];
    const longImm = gap < 0 && Math.abs(gap) < GAPTH && gap > gapPrev;
    if (!inPos && longImm) { inPos = true; ei = i; stop = cl[i] * (1 - CAT); continue; }
    if (inPos) {
      const bear = gapPrev >= 0 && gap < 0;
      if (b[i].l <= stop) { out.push({ tEntry: b[ei].t, weeks: Math.max(1, i - ei), ret: (stop / cl[ei] - 1) - COST * 2 }); inPos = false; }
      else if (bear) { out.push({ tEntry: b[ei].t, weeks: Math.max(1, i - ei), ret: (cl[i] / cl[ei] - 1) - COST * 2 }); inPos = false; }
    }
  }
  return out;
}
// WeeklySwing (DeMark-9), reglas de scanner_weekly.mjs: entrada setup-9, stop -18%, salida CD13/52sem/stop
function wsTrades(b) {
  const td = computeTDSetup(b), cd = computeTDCountdown(b, td), out = [];
  for (let i = SLOW; i < b.length - 1; i++) {
    if (td.bullSetup[i] !== 9 || !td.bullSetupBars[i]) continue;
    const ref = i < b.length - 1 ? b[i + 1].o : b[i].c;
    const entryPx = ref * (1 + WS_COST), stop = entryPx * (1 - CAT);
    let done = false;
    for (let j = i + 1; j < b.length && !done; j++) {
      let exit = null;
      if (b[j].l <= stop) exit = Math.min(b[j].o, stop);
      else if (cd.bearCountdown[j] === 13) exit = b[j].c;
      else if (j - i >= TIME_STOP_W) exit = b[j].c;
      if (exit != null) { out.push({ tEntry: b[i].t, weeks: j - i, ret: (exit * (1 - WS_COST) / entryPx - 1) }); done = true; }
    }
  }
  return out;
}

function simulate(signals) {
  signals = [...signals].sort((a, b) => a.tEntry - b.tEntry);
  const WEEK = 7 * 86400, t0 = signals[0].tEntry, tEnd = signals[signals.length - 1].tEntry + 60 * WEEK;
  let eq = 1, peak = 1, maxdd = 0, si = 0; const open = []; const path = [];
  for (let t = t0; t <= tEnd; t += WEEK) {
    for (let k = open.length - 1; k >= 0; k--) if (open[k].closeT <= t) { eq *= (1 + POSFRAC * open[k].ret); open.splice(k, 1); }
    while (si < signals.length && signals[si].tEntry <= t) { const g = signals[si++]; if (open.length < MAX_OPEN) open.push({ closeT: g.tEntry + g.weeks * WEEK, ret: g.ret }); }
    if (eq > peak) peak = eq; const dd = eq / peak - 1; if (dd < maxdd) maxdd = dd;
    path.push({ t, eq });
  }
  return { eq, maxdd: maxdd * 100, path };
}
function ddHalf(path, first) { const seg = path.filter(p => first ? yearOf(p.t) < SPLIT_YEAR : yearOf(p.t) >= SPLIT_YEAR);
  let peak = seg.length ? seg[0].eq : 1, dd = 0; for (const p of seg) { if (p.eq > peak) peak = p.eq; const d = p.eq / peak - 1; if (d < dd) dd = d; } return dd * 100; }
function corr(pa, pb) {   // correlación de retornos semanales alineados por timestamp
  const mb = new Map(pb.map(p => [p.t, p.eq])); const ra = [], rb = [];
  for (let i = 1; i < pa.length; i++) { const t = pa[i].t; if (mb.has(t) && mb.has(pa[i - 1].t)) { ra.push(pa[i].eq / pa[i - 1].eq - 1); rb.push(mb.get(t) / mb.get(pa[i - 1].t) - 1); } }
  const n = ra.length, ma = ra.reduce((a, b) => a + b, 0) / n, mbb = rb.reduce((a, b) => a + b, 0) / n;
  let cov = 0, va = 0, vb = 0; for (let i = 0; i < n; i++) { cov += (ra[i] - ma) * (rb[i] - mbb); va += (ra[i] - ma) ** 2; vb += (rb[i] - mbb) ** 2; }
  return cov / Math.sqrt(va * vb);
}

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  const list = (uni.universe || uni).map(u => u.ticker).slice(0, SAMPLE);
  console.log(`\n════ BACKTEST ESCALERA COMBINADA — EMACross + WeeklySwing ════`);
  console.log(`  ${list.length} acciones · 10y · ${MAX_OPEN} pos × ${(POSFRAC * 100).toFixed(1)}% · ¼ Kelly\n`);
  const bars = (await mapLimit(list, CONC, getW)).filter(Boolean);
  const ema_ = [], ws_ = [];
  for (const b of bars) { for (const t of emaTrades(b)) ema_.push(t); for (const t of wsTrades(b)) ws_.push(t); }
  console.log(`  señales: EMACross ${ema_.length} · WeeklySwing ${ws_.length} · tickers ${bars.length}\n`);

  const A = simulate(ema_), B = simulate(ws_), C = simulate(ema_.concat(ws_));
  const fmt = r => ((r.eq - 1) >= 0 ? '+' : '') + ((r.eq - 1) * 100).toFixed(0) + '%';
  const cal = r => (((r.eq - 1) * 100) / Math.abs(r.maxdd)).toFixed(2);
  console.log('  Cartera              RetTotal   maxDD     Calmar   |  DD 1ª/2ª mitad');
  console.log(`  A) EMACross solo     ${fmt(A).padStart(7)}    ${A.maxdd.toFixed(1)}%   ${cal(A).padStart(5)}    |  ${ddHalf(A.path, true).toFixed(1)}% / ${ddHalf(A.path, false).toFixed(1)}%`);
  console.log(`  B) WeeklySwing solo  ${fmt(B).padStart(7)}    ${B.maxdd.toFixed(1)}%   ${cal(B).padStart(5)}    |  ${ddHalf(B.path, true).toFixed(1)}% / ${ddHalf(B.path, false).toFixed(1)}%`);
  console.log(`  C) COMBINADA         ${fmt(C).padStart(7)}    ${C.maxdd.toFixed(1)}%   ${cal(C).padStart(5)}    |  ${ddHalf(C.path, true).toFixed(1)}% / ${ddHalf(C.path, false).toFixed(1)}%`);
  console.log(`\n  Correlación A↔B (retornos semanales): ρ = ${corr(A.path, B.path).toFixed(2)}`);
  console.log('  LECTURA: combinar VALE si la cartera C mejora el Calmar y/o BAJA el maxDD vs A y B,');
  console.log('  gracias a una ρ baja (los sistemas no caen a la vez). Consistente en ambas mitades.\n');
})();
