#!/usr/bin/env node
// backtest_quality_gate.mjs — ¿Un FILTRO DE CALIDAD (no tomar "lo que sobra") mejora la cartera?
//   Compara 3 políticas de cartera EMACross (7 slots × ¼ Kelly, ex-parabólicas >30% s/EMA200):
//     A) TODAS (actual): rellena con la mejor disponible, sea buena o marginal.
//     B) SOLO CONFLUENCIA: exige setup-9 DeMark reciente (confluencia) — máxima calidad, pocos trades.
//     C) FLOOR DE CALIDAD: confluencia (setup-9) O cruce fuerte (ext≥8% s/EMA21). Salta lo débil/naked.
//   Mide retorno, maxDD, Calmar y Nº de trades (para ver el coste en muestreo del tail).
//   READ-ONLY (Yahoo 10y semanal). Uso: node backtest_quality_gate.mjs [sample]

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const FAST = 8, SLOW = 21, TREND = 200, CAT = 0.18, GAPTH = 0.012, COST = 0.0006;
const POSFRAC = 0.139, MAX_OPEN = 7, EXT_MAX = 30, CONFL_WIN = 8, STRONG_EXT = 8;
const SPLIT_YEAR = 2021, SAMPLE = +(process.argv[2] || 220), CONC = 12;
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup } from '../scanner/demark_calc.mjs';
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

function trades(b) {
  const cl = b.map(x => x.c), ef = ema(cl, FAST), es = ema(cl, SLOW), e200 = ema(cl, TREND), out = [];
  const td = computeTDSetup(b);
  let inPos = false, ei = 0, stop = 0, ext = 0, d200 = 0, conf9 = false;
  for (let i = SLOW + 1; i < b.length; i++) {
    const gap = (ef[i] - es[i]) / cl[i], gp = (ef[i - 1] - es[i - 1]) / cl[i - 1];
    const longImm = gap < 0 && Math.abs(gap) < GAPTH && gap > gp;
    if (!inPos && longImm && i >= TREND) {
      inPos = true; ei = i; stop = cl[i] * (1 - CAT);
      ext = (cl[i] - es[i]) / es[i] * 100; d200 = (cl[i] - e200[i]) / e200[i] * 100;
      conf9 = false; for (let k = i; k >= Math.max(0, i - CONFL_WIN); k--) if (td.bullSetup[k] === 9) { conf9 = true; break; }
      continue;
    }
    if (inPos) { const bear = gp >= 0 && gap < 0;
      if (b[i].l <= stop) { out.push({ tEntry: b[ei].t, weeks: Math.max(1, i - ei), ret: (stop / cl[ei] - 1) - COST * 2, ext, d200, conf9 }); inPos = false; }
      else if (bear) { out.push({ tEntry: b[ei].t, weeks: Math.max(1, i - ei), ret: (cl[i] / cl[ei] - 1) - COST * 2, ext, d200, conf9 }); inPos = false; } }
  }
  return out;
}
function sim(signals) {
  signals = [...signals].sort((a, b) => a.tEntry - b.tEntry);
  if (!signals.length) return { eq: 1, maxdd: 0, path: [], n: 0 };
  const WEEK = 7 * 86400, t0 = signals[0].tEntry, tEnd = signals[signals.length - 1].tEntry + 60 * WEEK;
  let eq = 1, peak = 1, maxdd = 0, si = 0, taken = 0; const open = []; const path = [];
  for (let t = t0; t <= tEnd; t += WEEK) {
    for (let k = open.length - 1; k >= 0; k--) if (open[k].closeT <= t) { eq *= (1 + POSFRAC * open[k].ret); open.splice(k, 1); }
    while (si < signals.length && signals[si].tEntry <= t) { const g = signals[si++]; if (open.length < MAX_OPEN) { open.push({ closeT: g.tEntry + g.weeks * WEEK, ret: g.ret }); taken++; } }
    if (eq > peak) peak = eq; const dd = eq / peak - 1; if (dd < maxdd) maxdd = dd; path.push({ t, eq });
  }
  return { eq, maxdd: maxdd * 100, path, n: taken };
}
const ddHalf = (path, first) => { const seg = path.filter(p => first ? yearOf(p.t) < SPLIT_YEAR : yearOf(p.t) >= SPLIT_YEAR);
  let peak = seg.length ? seg[0].eq : 1, dd = 0; for (const p of seg) { if (p.eq > peak) peak = p.eq; const d = p.eq / peak - 1; if (d < dd) dd = d; } return dd * 100; };

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  const list = (uni.universe || uni).map(u => u.ticker).slice(0, SAMPLE);
  console.log(`\n════ ¿FILTRO DE CALIDAD (no rellenar con lo que sobra) MEJORA LA CARTERA? ════`);
  console.log(`  ${list.length} acc · 10y · ${MAX_OPEN} pos × ${(POSFRAC*100).toFixed(1)}% · ex-parabólicas >${EXT_MAX}%\n`);
  const bars = (await mapLimit(list, CONC, getW)).filter(Boolean);
  let raw = [];
  for (const b of bars) for (const x of trades(b)) raw.push(x);
  raw = raw.filter(s => s.d200 <= EXT_MAX);   // el cap de extensión ya está puesto en todas las políticas

  const A = raw;
  const B = raw.filter(s => s.conf9);
  const C = raw.filter(s => s.conf9 || s.ext >= STRONG_EXT);
  console.log(`  señales (ex-parabólicas): ${A.length} · confluencia ${B.length} · calidad(conf o ext≥${STRONG_EXT}%) ${C.length}\n`);
  const rA = sim(A), rB = sim(B), rC = sim(C);
  const fmt = r => ((r.eq - 1) >= 0 ? '+' : '') + ((r.eq - 1) * 100).toFixed(0) + '%';
  const cal = r => (((r.eq - 1) * 100) / Math.abs(r.maxdd)).toFixed(2);
  console.log('  Política                    RetTotal   maxDD    Calmar   trades   |  DD 1ª/2ª mitad');
  console.log(`  A) TODAS (actual)           ${fmt(rA).padStart(7)}   ${rA.maxdd.toFixed(1)}%   ${cal(rA).padStart(5)}    ${String(rA.n).padStart(4)}    |  ${ddHalf(rA.path,true).toFixed(1)}% / ${ddHalf(rA.path,false).toFixed(1)}%`);
  console.log(`  B) SOLO confluencia         ${fmt(rB).padStart(7)}   ${rB.maxdd.toFixed(1)}%   ${cal(rB).padStart(5)}    ${String(rB.n).padStart(4)}    |  ${ddHalf(rB.path,true).toFixed(1)}% / ${ddHalf(rB.path,false).toFixed(1)}%`);
  console.log(`  C) FLOOR calidad            ${fmt(rC).padStart(7)}   ${rC.maxdd.toFixed(1)}%   ${cal(rC).padStart(5)}    ${String(rC.n).padStart(4)}    |  ${ddHalf(rC.path,true).toFixed(1)}% / ${ddHalf(rC.path,false).toFixed(1)}%`);
  console.log('\n  LECTURA: si B o C suben el Calmar/bajan DD vs A → filtrar por calidad compensa (mejor caja');
  console.log('  que trade marginal). Ojo al Nº de trades: menos trades = más riesgo de no muestrear el tail.\n');
})();
