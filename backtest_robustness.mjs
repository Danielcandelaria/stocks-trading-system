#!/usr/bin/env node
// backtest_robustness.mjs — INFORME DE ROBUSTEZ del sistema EMACross (cruce EMA 8/21 semanal,
//   anticipado, stop -18%, salida cruce contrario). Universo COMPLETO. Toca todo lo que afecta:
//     1. Base: n, PF, WR, media, MEDIANA, ΣR.
//     2. DEPENDENCIA DE COLA: quitar top-1/5/10% de ganadoras → ¿aguanta o es breakeven?
//     3. CONCENTRACIÓN: % del beneficio total que aporta el top-1% y top-5% de trades.
//     4. SENSIBILIDAD A COSTES: ΣR con coste 0.06 / 0.15 / 0.30 / 0.50 % por lado (slippage).
//     5. RÉGIMEN: media R por AÑO de entrada (¿pierde en años malos?).
//     6. WALK-FORWARD: 5 ventanas temporales (¿estable o un solo tramo lo sostiene?).
//     7. CAP DE EXTENSIÓN: base vs sin parabólicas (>30% s/EMA200) en el universo completo.
//   READ-ONLY (Yahoo 10y). Uso: node backtest_robustness.mjs [sample]   (default = TODAS)

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const FAST = 8, SLOW = 21, TREND = 200, CAT = 0.18, GAPTH = 0.012;
const CONC = 12;
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const ROOT = dirname(fileURLToPath(import.meta.url));
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map(c => { e = e === null ? c : c * k + e * (1 - k); return e; }); };
const med = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const yearOf = t => new Date(t * 1000).getUTCFullYear();
const sum = a => a.reduce((x, y) => x + y, 0);

async function getW(t) { const y = t.replace('.', '-');
  try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`, { headers: UA });
    if (!r.ok) return null; const d = (await r.json()).chart?.result?.[0]; const q = d?.indicators?.quote?.[0];
    if (!d?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < d.timestamp.length; i++) if (q.close[i] != null && q.high[i] != null && q.low[i] != null)
      b.push({ t: d.timestamp[i], h: q.high[i], l: q.low[i], c: q.close[i] });
    return b.length > 220 ? b : null; } catch { return null; } }
async function mapLimit(items, n, fn) { const out = []; let i = 0, done = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); if (++done % 100 === 0) process.stderr.write(`  ...${done}/${items.length}\n`); } })); return out; }

// Trades con coste variable: devuelve {retNoCost, t, d200}. El coste se aplica luego.
function rawTrades(b) {
  const cl = b.map(x => x.c), ef = ema(cl, FAST), es = ema(cl, SLOW), e200 = ema(cl, TREND), out = [];
  let inPos = false, ei = 0, stop = 0, d200 = 0;
  for (let i = SLOW + 1; i < b.length; i++) {
    const gap = (ef[i] - es[i]) / cl[i], gapPrev = (ef[i - 1] - es[i - 1]) / cl[i - 1];
    const longImm = gap < 0 && Math.abs(gap) < GAPTH && gap > gapPrev;
    if (!inPos && longImm && i >= TREND) { inPos = true; ei = i; stop = cl[i] * (1 - CAT); d200 = (cl[i] - e200[i]) / e200[i] * 100; continue; }
    if (inPos) {
      const bear = gapPrev >= 0 && gap < 0;
      if (b[i].l <= stop) { out.push({ raw: (stop / cl[ei] - 1) * 100, t: b[ei].t, d200 }); inPos = false; }
      else if (bear) { out.push({ raw: (cl[i] / cl[ei] - 1) * 100, t: b[ei].t, d200 }); inPos = false; }
    }
  }
  return out;
}
const withCost = (tr, cLado) => tr.map(x => x.raw - cLado * 200);
function pf(rs) { const w = sum(rs.filter(x => x > 0)), l = sum(rs.filter(x => x <= 0)); return l ? Math.abs(w / l) : 999; }
function line(label, rs) { const w = rs.filter(x => x > 0); return `${label.padEnd(22)} n=${String(rs.length).padStart(5)}  PF ${pf(rs).toFixed(2).padStart(5)}  WR ${(100 * w.length / rs.length).toFixed(0)}%  media ${(sum(rs) / rs.length >= 0 ? '+' : '') + (sum(rs) / rs.length).toFixed(2)}%  MEDIANA ${(med(rs) >= 0 ? '+' : '') + med(rs).toFixed(2)}%  ΣR ${(sum(rs) >= 0 ? '+' : '') + sum(rs).toFixed(0)}%`; }

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  let list = (uni.universe || uni).map(u => u.ticker);
  if (process.argv[2]) list = list.slice(0, +process.argv[2]);
  console.log(`\n════════ INFORME DE ROBUSTEZ — EMACross anticipado ════════`);
  console.log(`  Universo: ${list.length} acciones · ~6a (2020-2026, EMA200 valida) semanal · stop -18%\n`);
  const bars = (await mapLimit(list, CONC, getW)).filter(Boolean);
  const raw = [];
  for (const b of bars) for (const x of rawTrades(b)) raw.push(x);
  console.log(`  Tickers con datos: ${bars.length}/${list.length} · trades: ${raw.length}\n`);

  const base = withCost(raw, 0.0006);
  console.log('── 1. BASE (coste 0.06%/lado) ──');
  console.log('  ' + line('Todos', base));

  console.log('\n── 2. DEPENDENCIA DE COLA (quitar las mejores ganadoras) ──');
  const sorted = [...base].sort((a, b) => b - a);
  for (const pctCut of [0.01, 0.05, 0.10]) {
    const cut = Math.floor(base.length * pctCut);
    const trimmed = sorted.slice(cut);   // quita las 'cut' mejores
    console.log('  ' + line(`sin top-${(pctCut * 100).toFixed(0)}%`, trimmed));
  }

  console.log('\n── 3. CONCENTRACIÓN DEL BENEFICIO ──');
  const totalWin = sum(base.filter(x => x > 0));
  for (const pctTop of [0.01, 0.05]) {
    const cut = Math.floor(base.length * pctTop);
    const topWin = sum(sorted.slice(0, cut));
    console.log(`  El top-${(pctTop * 100).toFixed(0)}% de trades (${cut}) aporta ${(100 * topWin / sum(base)).toFixed(0)}% del ΣR total y ${(100 * topWin / totalWin).toFixed(0)}% de las ganancias brutas.`);
  }

  console.log('\n── 4. SENSIBILIDAD A COSTES / SLIPPAGE ──');
  for (const c of [0.0006, 0.0015, 0.0030, 0.0050]) {
    const rs = withCost(raw, c); console.log(`  coste ${(c * 100).toFixed(2)}%/lado → PF ${pf(rs).toFixed(2)} · media ${(sum(rs) / rs.length).toFixed(2)}% · ΣR ${sum(rs).toFixed(0)}%`);
  }

  console.log('\n── 5. RÉGIMEN: media R por AÑO de entrada ──');
  const years = [...new Set(raw.map(x => yearOf(x.t)))].sort();
  console.log('  ' + years.map(y => { const seg = base.filter((_, i) => yearOf(raw[i].t) === y); return `${y}:${(sum(seg) / seg.length >= 0 ? '+' : '') + (sum(seg) / seg.length).toFixed(0)}%(${seg.length})`; }).join('  '));

  console.log('\n── 6. WALK-FORWARD (5 ventanas por tiempo) ──');
  const byT = raw.map((x, i) => ({ t: x.t, r: base[i] })).sort((a, b) => a.t - b.t);
  const W = 5, seg = Math.floor(byT.length / W);
  for (let w = 0; w < W; w++) { const s = byT.slice(w * seg, w === W - 1 ? byT.length : (w + 1) * seg).map(x => x.r); const wins = s.filter(x => x > 0).length; console.log(`  V${w + 1}: PF ${pf(s).toFixed(2)} · media ${(sum(s) / s.length >= 0 ? '+' : '') + (sum(s) / s.length).toFixed(2)}% · WR ${(100 * wins / s.length).toFixed(0)}%`); }
  const wfPos = Array.from({ length: W }, (_, w) => byT.slice(w * seg, w === W - 1 ? byT.length : (w + 1) * seg).map(x => x.r)).filter(s => sum(s) / s.length > 0).length;
  console.log(`  → ${wfPos}/${W} ventanas positivas`);

  console.log('\n── 7. CAP DE EXTENSIÓN en el universo completo ──');
  const nonPara = raw.filter(x => x.d200 <= 30);
  console.log('  ' + line('base (todas)', base));
  console.log('  ' + line('sin parabólicas', withCost(nonPara, 0.0006)));
  console.log('\n  El "forward es el juez": estos números son EDGE RELATIVO sobre survivors; el vivo será menor.\n');
})();
