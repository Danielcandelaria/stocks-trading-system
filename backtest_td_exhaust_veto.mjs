#!/usr/bin/env node
// backtest_td_exhaust_veto.mjs — ¿Vetar entradas con AGOTAMIENTO DeMark mejora EMACross?
//   Idea del material DeMark: la TD "Sell Setup" (bearSetup = cierres > close[-4] contando al alza)
//   marca un rally MADURO/exhausto. Hipótesis: si al disparar el cruce EMACross la cuenta de
//   agotamiento ya es alta, la entrada es de peor calidad → VETARLA.
//   Se compara CONTRA y ENCIMA de nuestro extension cap ya validado (dist EMA200 > 30% = fuera),
//   para ver si el veto TD aporta algo NUEVO o es redundante.
//   Metodología idéntica al resto: 2 mitades OOS, WR, PF, MEDIANA, PF-sin-top5%, %stop, Σret.
//   Long-only, entrada anticipada (gap converge <1.2%), salida cruce contrario, stop -18%, coste 0.06%/lado.
//   Universo = supervivientes de HOY (sesgo, cota superior). READ-ONLY (Yahoo 10y semanal).
//   Uso: node backtest_td_exhaust_veto.mjs [sample=250]
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup } from '../scanner/demark_calc.mjs';
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const FAST = 8, SLOW = 21, CAT = 0.18, GAPTH = 0.012, COST = 0.0006;
const EXT_MAX = 30, SAMPLE = +(process.argv[2] || 250), CONC = 12;
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

// Genera las operaciones EMACross base, guardando en cada entrada: dist200 y bearSetup (agotamiento).
function baseTrades(bars) {
  const cl = bars.map(x => x.c), ef = ema(cl, FAST), es = ema(cl, SLOW), e200 = ema(cl, 200);
  const td = computeTDSetup(bars);
  const out = []; let inPos = false, ei = 0, stop = 0;
  for (let i = SLOW + 1; i < bars.length; i++) {
    const gap = (ef[i] - es[i]) / cl[i], gp = (ef[i - 1] - es[i - 1]) / cl[i - 1];
    if (!inPos && gap < 0 && Math.abs(gap) < GAPTH && gap > gp) {
      inPos = true; ei = i; stop = cl[i] * (1 - CAT);
      var entryDist = i >= 200 ? (cl[i] - e200[i]) / e200[i] * 100 : null;
      var entryBear = td.bearSetup[i];  // cuenta de agotamiento al alza en la barra de entrada
      continue;
    }
    if (inPos) {
      const bear = gp >= 0 && gap < 0;
      if (bars[i].l <= stop) { out.push({ t: bars[ei].t, i: ei, ret: (stop / cl[ei] - 1) * 100 - COST * 200, wk: i - ei, why: 'stop', dist: entryDist, bs: entryBear }); inPos = false; }
      else if (bear) { out.push({ t: bars[ei].t, i: ei, ret: (cl[i] / cl[ei] - 1) * 100 - COST * 200, wk: i - ei, why: 'cross', dist: entryDist, bs: entryBear }); inPos = false; }
    }
  }
  return out;
}
function stat(rs) {
  const n = rs.length; if (!n) return { n: 0 };
  const rets = rs.map(x => x.ret).sort((a, b) => a - b);
  const sum = rets.reduce((a, b) => a + b, 0);
  const w = rets.filter(x => x > 0), l = rets.filter(x => x <= 0);
  const gp = w.reduce((a, b) => a + b, 0), gl = Math.abs(l.reduce((a, b) => a + b, 0));
  const median = rets.length % 2 ? rets[(rets.length - 1) / 2] : (rets[rets.length / 2 - 1] + rets[rets.length / 2]) / 2;
  // PF quitando el top-5% de ganadoras
  const cut = Math.max(1, Math.floor(rets.length * 0.05));
  const trimmed = rets.slice(0, rets.length - cut);
  const wt = trimmed.filter(x => x > 0).reduce((a, b) => a + b, 0), lt = Math.abs(trimmed.filter(x => x <= 0).reduce((a, b) => a + b, 0));
  const pfNoTop5 = lt ? wt / lt : 0;
  return { n, wr: 100 * w.length / n, pf: gl ? gp / gl : 0, mean: sum / n, median, sum, pfNoTop5, stopPct: 100 * rs.filter(x => x.why === 'stop').length / n };
}
function fmt(s) { return s.n ? `n=${String(s.n).padStart(5)} WR ${s.wr.toFixed(1).padStart(4)}% PF ${s.pf.toFixed(2)} med ${s.median >= 0 ? '+' : ''}${s.median.toFixed(1)}% mean ${s.mean >= 0 ? '+' : ''}${s.mean.toFixed(1)}% Σ${s.sum >= 0 ? '+' : ''}${s.sum.toFixed(0)} PFsinTop5% ${s.pfNoTop5.toFixed(2)} stop ${s.stopPct.toFixed(0)}%` : 'sin datos'; }

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8')).universe.slice(0, SAMPLE).map(u => u.ticker);
  console.log(`\n════ VETO DE AGOTAMIENTO DeMark (TD Sell Setup) sobre EMACross ════`);
  console.log(`  ${uni.length} large-caps · 10y semanal · entrada anticipada · salida cruce↓ · stop -18% · coste 0.06%/lado\n`);
  const bars = await mapLimit(uni, CONC, getW);
  const all = [];
  for (const b of bars) if (b) for (const tr of baseTrades(b)) all.push(tr);
  all.sort((a, b) => a.t - b.t);
  const mid = all[Math.floor(all.length / 2)].t;
  const H1 = all.filter(x => x.t < mid), H2 = all.filter(x => x.t >= mid);
  const yr = t => new Date(t * 1000).getUTCFullYear();
  console.log(`  ${all.length} operaciones base · mitad 1: ${yr(all[0].t)}-${yr(mid)} · mitad 2: ${yr(mid)}-${yr(all[all.length-1].t)}\n`);

  // ── TABLA A: efecto STANDALONE del veto TD sobre TODA la ventana (10y, no necesita EMA200) ──
  console.log(`── A) Veto TD standalone (ventana completa 10y) ──`);
  const vetoThresholds = [null, 7, 8, 9, 11, 13];
  for (const th of vetoThresholds) {
    const pass = tr => th === null ? true : !(tr.bs >= th);   // veto: fuera si bearSetup >= th
    const lab = th === null ? 'BASE EMACross     ' : `veto bearSetup>=${th} `.padEnd(18);
    console.log(`  ${lab}  ${fmt(stat(all.filter(pass)))}`);
    if (th !== null) {
      console.log(`      OOS mit1: ${fmt(stat(H1.filter(pass)))}`);
      console.log(`      OOS mit2: ${fmt(stat(H2.filter(pass)))}`);
    }
  }

  // ── TABLA B: redundancia vs/encima del EXTENSION CAP ya validado (ventana EMA200: ~2020-2026) ──
  const withDist = all.filter(x => x.dist !== null);
  const midD = withDist.length ? withDist[Math.floor(withDist.length / 2)].t : 0;
  const D1 = withDist.filter(x => x.t < midD), D2 = withDist.filter(x => x.t >= midD);
  console.log(`\n── B) ¿El veto TD aporta ENCIMA del extension cap? (solo entradas con EMA200 válida ≈2020-2026) ──`);
  console.log(`  ${withDist.length} operaciones con dist EMA200 · mit1 ${yr(withDist[0]?.t)}-${yr(midD)} · mit2 ${yr(midD)}-${yr(withDist[withDist.length-1]?.t)}\n`);
  const TD_TH = 9;   // umbral del veto elegido para la comparación
  const variants = {
    'BASE (EMA200 win)   ': tr => true,
    'EXTcap (dist>30 out)': tr => tr.dist <= EXT_MAX,
    [`TDveto (bear>=${TD_TH})     `]: tr => !(tr.bs >= TD_TH),
    'BOTH (ext + TDveto) ': tr => tr.dist <= EXT_MAX && !(tr.bs >= TD_TH),
  };
  for (const [lab, f] of Object.entries(variants)) {
    console.log(`  ${lab}  ${fmt(stat(withDist.filter(f)))}`);
    console.log(`      OOS mit1: ${fmt(stat(D1.filter(f)))}`);
    console.log(`      OOS mit2: ${fmt(stat(D2.filter(f)))}`);
  }
  console.log(`\n  LECTURA: si TDveto ≈ EXTcap y BOTH ≈ EXTcap → redundante (el veto ya lo hace el cap).`);
  console.log(`           si BOTH mejora claramente a EXTcap en AMBAS mitades → aporta y merece aplicarse.\n`);
})();
