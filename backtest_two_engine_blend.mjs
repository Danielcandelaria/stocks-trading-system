#!/usr/bin/env node
// backtest_two_engine_blend.mjs — DECISIÓN con capital limitado: ¿momentum puro o blend?
//   1. RSI-2 en MEGA-CAPS líquidas (top-N del universo) con coste realista 0.10%/lado → ¿sobrevive?
//   2. Simula cada motor como sub-cartera (momentum 7 slots · reversión 3 slots, plenamente invertida)
//      → serie de retornos MENSUALES. Corrige la correlación.
//   3. BLEND por peso de capital w (100/0, 80/20, 70/30, 60/40): retorno anualizado, maxDD, Calmar,
//      % meses negativos, peor mes. Muestra si partir capital MEJORA el perfil o solo diluye momentum.
//   READ-ONLY (Yahoo 5y: momentum semanal, reversión diaria). Uso: [momentumSample] [liquidTopN]

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const FAST = 8, SLOW = 21, CAT = 0.18, GAPTH = 0.012;
const MOM_SAMPLE = +(process.argv[2] || 200), LIQ_TOPN = +(process.argv[3] || 50), CONC = 10;
const REV_COST = 0.0010, MOM_COST = 0.0006;   // reversión en líquidas: spread bajo realista
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const ROOT = dirname(fileURLToPath(import.meta.url));
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map(c => { e = e === null ? c : c * k + e * (1 - k); return e; }); };
const sma = (cl, p) => cl.map((_, i) => i < p - 1 ? null : cl.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p);
const med = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sum = a => a.reduce((x, y) => x + y, 0);
const monthKey = t => { const d = new Date(t * 1000); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
function rsi(cl, p) { const out = Array(cl.length).fill(null); let ag = 0, al = 0;
  for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= p) { ag += g; al += l; if (i === p) { ag /= p; al /= p; out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } }
    else { ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p; out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } }
  return out; }
async function fetchBars(t, range, interval) { const y = t.replace('.', '-');
  try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=${range}&interval=${interval}`, { headers: UA });
    if (!r.ok) return null; const d = (await r.json()).chart?.result?.[0]; const q = d?.indicators?.quote?.[0];
    if (!d?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < d.timestamp.length; i++) if (q.close[i] != null && q.high[i] != null && q.low[i] != null)
      b.push({ t: d.timestamp[i], h: q.high[i], l: q.low[i], c: q.close[i] });
    return b.length > 100 ? b : null; } catch { return null; } }
async function mapLimit(items, n, fn) { const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }

function rsi2Trades(b) { const cl = b.map(x => x.c), r = rsi(cl, 2), e200 = ema(cl, 200), s5 = sma(cl, 5), out = [];
  let inPos = false, ei = 0;
  for (let i = 200; i < b.length; i++) { if (!inPos) { if (r[i] != null && r[i] < 10 && cl[i] > e200[i]) { inPos = true; ei = i; } }
    else { if ((s5[i] != null && cl[i] > s5[i]) || i - ei >= 5) { out.push({ tEntry: b[ei].t, tExit: b[i].t, ret: cl[i] / cl[ei] - 1 - REV_COST * 2 }); inPos = false; } } }
  return out; }
function emaTrades(b) { const cl = b.map(x => x.c), ef = ema(cl, FAST), es = ema(cl, SLOW), out = [];
  let inPos = false, ei = 0, stop = 0;
  for (let i = SLOW + 1; i < b.length; i++) { const gap = (ef[i] - es[i]) / cl[i], gp = (ef[i - 1] - es[i - 1]) / cl[i - 1];
    if (!inPos && gap < 0 && Math.abs(gap) < GAPTH && gap > gp) { inPos = true; ei = i; stop = cl[i] * (1 - CAT); continue; }
    if (inPos) { const bear = gp >= 0 && gap < 0;
      if (b[i].l <= stop) { out.push({ tEntry: b[ei].t, tExit: b[i].t, ret: stop / cl[ei] - 1 - MOM_COST * 2 }); inPos = false; }
      else if (bear) { out.push({ tEntry: b[ei].t, tExit: b[i].t, ret: cl[i] / cl[ei] - 1 - MOM_COST * 2 }); inPos = false; } } }
  return out; }

// Sub-cartera: 'slots' plazas, cada una 1/slots del capital, plenamente invertida → retornos MENSUALES.
function monthlyReturns(signals, slots) {
  signals = [...signals].sort((a, b) => a.tEntry - b.tEntry);
  const posFrac = 1 / slots, DAY = 86400;
  const t0 = signals[0].tEntry, tEnd = Math.max(...signals.map(s => s.tExit));
  let eq = 1, si = 0; const open = []; const monthly = {}; let lastMonthEq = 1, curMonth = monthKey(t0);
  for (let t = t0; t <= tEnd; t += DAY) {
    for (let k = open.length - 1; k >= 0; k--) if (open[k].tExit <= t) { eq *= (1 + posFrac * open[k].ret); open.splice(k, 1); }
    while (si < signals.length && signals[si].tEntry <= t) { const g = signals[si++]; if (open.length < slots) open.push(g); }
    const mk = monthKey(t);
    if (mk !== curMonth) { monthly[curMonth] = eq / lastMonthEq - 1; lastMonthEq = eq; curMonth = mk; }
  }
  monthly[curMonth] = eq / lastMonthEq - 1;
  return monthly;
}
function stats(series) {   // series = array de retornos mensuales
  let eq = 1, peak = 1, dd = 0; const eqs = [];
  for (const r of series) { eq *= (1 + r); eqs.push(eq); if (eq > peak) peak = eq; const d = eq / peak - 1; if (d < dd) dd = d; }
  const years = series.length / 12;
  const cagr = (Math.pow(eq, 1 / years) - 1) * 100;
  const neg = series.filter(r => r < 0).length;
  return { totalPct: (eq - 1) * 100, cagr, maxdd: dd * 100, calmar: cagr / Math.abs(dd * 100 / 100) / 100 * 100, negPct: 100 * neg / series.length, worst: Math.min(...series) * 100 };
}

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  const all = (uni.universe || uni).map(u => u.ticker);
  const momList = all.slice(0, MOM_SAMPLE), liqList = all.slice(0, LIQ_TOPN);
  console.log(`\n════ MOMENTUM PURO vs BLEND (capital limitado) ════`);
  console.log(`  Momentum: ${momList.length} acc semanal 5y · Reversión: top-${liqList.length} líquidas diario 5y, coste ${(REV_COST*100).toFixed(2)}%/lado\n`);
  const [wk, dl] = await Promise.all([
    mapLimit(momList, CONC, t => fetchBars(t, '5y', '1wk')),
    mapLimit(liqList, CONC, t => fetchBars(t, '5y', '1d')),
  ]);
  const mom = [], rev = [];
  for (const b of wk) if (b) for (const x of emaTrades(b)) mom.push(x);
  for (const b of dl) if (b) for (const x of rsi2Trades(b)) rev.push(x);

  // 1. Viabilidad RSI-2 líquidas
  const rr = rev.map(x => x.ret * 100), pfR = (() => { const w = sum(rr.filter(x => x > 0)), l = sum(rr.filter(x => x <= 0)); return l ? Math.abs(w / l) : 999; })();
  console.log(`── 1. RSI-2 en mega-caps líquidas (coste 0.10%/lado) ──`);
  console.log(`  n=${rr.length}  PF ${pfR.toFixed(2)}  WR ${(100*rr.filter(x=>x>0).length/rr.length).toFixed(0)}%  media ${(sum(rr)/rr.length).toFixed(2)}%  MEDIANA ${(med(rr)>=0?'+':'')+med(rr).toFixed(2)}%  → ${pfR>1.15?'VIABLE':'NO viable'}\n`);

  // 2. Series mensuales + correlación
  const mM = monthlyReturns(mom, 7), mR = monthlyReturns(rev, 3);
  const keys = [...new Set([...Object.keys(mM), ...Object.keys(mR)])].map(Number).sort((a, b) => a - b);
  const M = keys.map(k => mM[k] || 0), R = keys.map(k => mR[k] || 0);
  const n = keys.length, mm = sum(M) / n, mr = sum(R) / n;
  let cov = 0, vm = 0, vr = 0; for (let i = 0; i < n; i++) { cov += (M[i] - mm) * (R[i] - mr); vm += (M[i] - mm) ** 2; vr += (R[i] - mr) ** 2; }
  console.log(`── 2. Correlación mensual momentum ↔ reversión (${n} meses): ρ = ${(cov / Math.sqrt(vm * vr)).toFixed(2)} ──\n`);

  // 3. Blend por peso de capital
  console.log('── 3. BLEND por peso de capital (w = % en momentum) ──');
  console.log('  Mezcla        CAGR     maxDD    Calmar   meses neg   peor mes');
  for (const w of [1.0, 0.8, 0.7, 0.6, 0.5]) {
    const blend = keys.map((_, i) => w * M[i] + (1 - w) * R[i]);
    const s = stats(blend);
    const tag = w === 1 ? ' (momentum puro)' : '';
    console.log(`  ${(w*100).toFixed(0)}/${((1-w)*100).toFixed(0)}         ${s.cagr.toFixed(1).padStart(5)}%   ${s.maxdd.toFixed(1).padStart(6)}%   ${s.calmar.toFixed(2).padStart(5)}     ${s.negPct.toFixed(0).padStart(3)}%        ${s.worst.toFixed(1)}%${tag}`);
  }
  console.log('\n  LECTURA: si un blend sube el Calmar y baja maxDD/meses-negativos vs 100/0, diversificar');
  console.log('  compensa pese a quitar capital al momentum. Si 100/0 gana en Calmar, mejor momentum puro.\n');
})();
