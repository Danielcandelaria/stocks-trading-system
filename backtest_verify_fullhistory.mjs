#!/usr/bin/env node
// backtest_verify_fullhistory.mjs — REVERIFICA las mejoras implementadas sobre el HISTÓRICO MÁXIMO
//   (range=max → EMA200 válida desde ~2012, no solo 2020). Corrige el "medían 2020-2026".
//   Confirma en ventana LARGA: (1) tail-dependence, (2) cap de extensión, (3) floor de calidad.
//   READ-ONLY (Yahoo max semanal). Uso: node backtest_verify_fullhistory.mjs [sample]

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const FAST = 8, SLOW = 21, TREND = 200, CAT = 0.18, GAPTH = 0.012, COST = 0.0006, CONFL_WIN = 8, STRONG_EXT = 8, EXT_MAX = 30;
const POSFRAC = 0.139, MAX_OPEN = 7, SAMPLE = +(process.argv[2] || 200), CONC = 12;
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup } from '../scanner/demark_calc.mjs';
const ROOT = dirname(fileURLToPath(import.meta.url));
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map(c => { e = e === null ? c : c * k + e * (1 - k); return e; }); };
const med = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sum = a => a.reduce((x, y) => x + y, 0);
const yr = t => new Date(t * 1000).getUTCFullYear();
async function getW(t) { const y = t.replace('.', '-');
  try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=max&interval=1wk`, { headers: UA });
    if (!r.ok) return null; const d = (await r.json()).chart?.result?.[0]; const q = d?.indicators?.quote?.[0];
    if (!d?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < d.timestamp.length; i++) if (q.close[i] != null && q.high[i] != null && q.low[i] != null)
      b.push({ t: d.timestamp[i], h: q.high[i], l: q.low[i], c: q.close[i] });
    return b.length > 240 ? b : null; } catch { return null; } }
async function mapLimit(items, n, fn) { const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }

function tradesOf(b) {
  const cl = b.map(x => x.c), ef = ema(cl, FAST), es = ema(cl, SLOW), e200 = ema(cl, TREND), out = [];
  const td = computeTDSetup(b);
  let inPos = false, ei = 0, sl = 0, ext = 0, d200 = 0, conf = false;
  for (let i = SLOW + 1; i < b.length; i++) {
    const gap = (ef[i] - es[i]) / cl[i], gp = (ef[i - 1] - es[i - 1]) / cl[i - 1];
    const longImm = gap < 0 && Math.abs(gap) < GAPTH && gap > gp;
    if (!inPos && longImm && i >= TREND) {   // i>=TREND: EMA200 válida (con range=max esto es ~2012+, no 2020)
      inPos = true; ei = i; sl = cl[i] * (1 - CAT);
      ext = (cl[i] - es[i]) / es[i] * 100; d200 = (cl[i] - e200[i]) / e200[i] * 100;
      conf = false; for (let k = i; k >= Math.max(0, i - CONFL_WIN); k--) if (td.bullSetup[k] === 9) { conf = true; break; }
      continue;
    }
    if (inPos) { const bear = gp >= 0 && gap < 0;
      if (b[i].l <= sl) { out.push({ tEntry: b[ei].t, weeks: Math.max(1, i - ei), ret: (sl / cl[ei] - 1) - COST * 2, retPct: (sl / cl[ei] - 1) * 100 - COST * 200, ext, d200, conf }); inPos = false; }
      else if (bear) { out.push({ tEntry: b[ei].t, weeks: Math.max(1, i - ei), ret: (cl[i] / cl[ei] - 1) - COST * 2, retPct: (cl[i] / cl[ei] - 1) * 100 - COST * 200, ext, d200, conf }); inPos = false; } }
  }
  return out;
}
function simP(sig) {
  sig = [...sig].sort((a, b) => a.tEntry - b.tEntry); if (!sig.length) return { eq: 1, maxdd: 0, n: 0 };
  const WEEK = 7 * 86400, t0 = sig[0].tEntry, tEnd = sig[sig.length - 1].tEntry + 60 * WEEK;
  let eq = 1, peak = 1, maxdd = 0, si = 0, n = 0; const open = [];
  for (let t = t0; t <= tEnd; t += WEEK) {
    for (let k = open.length - 1; k >= 0; k--) if (open[k].closeT <= t) { eq *= (1 + POSFRAC * open[k].ret); open.splice(k, 1); }
    while (si < sig.length && sig[si].tEntry <= t) { const g = sig[si++]; if (open.length < MAX_OPEN) { open.push({ closeT: g.tEntry + g.weeks * WEEK, ret: g.ret }); n++; } }
    if (eq > peak) peak = eq; const dd = eq / peak - 1; if (dd < maxdd) maxdd = dd;
  }
  return { eq, maxdd: maxdd * 100, n };
}
const pf = rs => { const w = sum(rs.filter(x => x > 0)), l = sum(rs.filter(x => x <= 0)); return l ? Math.abs(w / l) : 999; };
const fmt = r => ((r.eq - 1) >= 0 ? '+' : '') + ((r.eq - 1) * 100).toFixed(0) + '%';
const cal = r => (((r.eq - 1) * 100) / Math.abs(r.maxdd)).toFixed(2);

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  const list = (uni.universe || uni).map(u => u.ticker).slice(0, SAMPLE);
  console.log(`\n════ REVERIFICACIÓN sobre HISTÓRICO MÁXIMO (range=max) ════`);
  const bars = (await mapLimit(list, CONC, getW)).filter(Boolean);
  let all = [];
  for (const b of bars) for (const x of tradesOf(b)) all.push(x);
  const ys = all.map(t => yr(t.tEntry));
  console.log(`  ${bars.length} acciones · ${all.length} operaciones · años ${Math.min(...ys)}-${Math.max(...ys)} (EMA200 válida)\n`);

  const rets = all.map(t => t.retPct), sorted = [...rets].sort((a, b) => b - a), cut5 = Math.floor(rets.length * 0.05);
  console.log('── 1. TAIL-DEPENDENCE ──');
  console.log(`  Base: PF ${pf(rets).toFixed(2)} · WR ${(100*rets.filter(x=>x>0).length/rets.length).toFixed(0)}% · mediana ${med(rets).toFixed(2)}%`);
  console.log(`  Sin top-5%: PF ${pf(sorted.slice(cut5)).toFixed(2)} · top-5% aporta ${(100*sum(sorted.slice(0,cut5))/sum(rets)).toFixed(0)}% del ΣR\n`);

  console.log('── 2. CAP DE EXTENSIÓN (cartera) ──');
  const A = simP(all), B = simP(all.filter(t => t.d200 <= EXT_MAX));
  console.log(`  TODAS:            ${fmt(A)} · maxDD ${A.maxdd.toFixed(1)}% · Calmar ${cal(A)}`);
  console.log(`  sin parabólicas:  ${fmt(B)} · maxDD ${B.maxdd.toFixed(1)}% · Calmar ${cal(B)}\n`);

  console.log('── 3. FLOOR DE CALIDAD (cartera, ya ex-parabólicas) ──');
  const base = all.filter(t => t.d200 <= EXT_MAX);
  const C = simP(base);
  const D = simP(base.filter(t => t.conf || t.ext >= STRONG_EXT));
  console.log(`  rellenar TODO:    ${fmt(C)} · maxDD ${C.maxdd.toFixed(1)}% · Calmar ${cal(C)} · ${C.n} trades`);
  console.log(`  FLOOR calidad:    ${fmt(D)} · maxDD ${D.maxdd.toFixed(1)}% · Calmar ${cal(D)} · ${D.n} trades\n`);
  console.log('  Si el orden se mantiene (sin parabólicas > todas; floor > rellenar todo) en ventana larga →');
  console.log('  las mejoras NO eran artefacto de 2020-2026.\n');
})();
