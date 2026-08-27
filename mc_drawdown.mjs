#!/usr/bin/env node
// mc_drawdown.mjs — ¿Qué DRAWDOWN es "normal" del sistema y cuál ya es quemar cuenta?
//   Monte Carlo sobre la distribución empírica de trades EMACross (modo anticipado),
//   dimensionada al ¼ Kelly REAL: NSLOTS posiciones concurrentes de POSFRAC del capital cada una.
//   Simula la curva de equity marcada a cierre de trade, con NSLOTS ranuras que se rellenan
//   con trades bootstrap; reporta la distribución del MÁXIMO DRAWDOWN por horizonte.
//   El umbral del freno se pone POR ENCIMA del p95 "normal" para no cortar rachas sanas.
//   READ-ONLY (Yahoo 10y semanal). Uso: node mc_drawdown.mjs [sample]

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const FAST = 8, SLOW = 21, CAT = 0.18, GAPTH = 0.012, COST = 0.0006;
const POSFRAC = 0.139;   // ¼ Kelly: cada posición ~13.9% del capital (=2.5% riesgo / stop 18%)
const NSLOTS = 7;        // posiciones concurrentes objetivo (rango 6-8)
const PATHS = 20000;
const HORIZONS = [52, 156, 260];   // 1, 3, 5 años en semanas
const SAMPLE = +(process.argv[2] || 200), CONC = 10;
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const ROOT = dirname(fileURLToPath(import.meta.url));
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map(c => { e = e === null ? c : c * k + e * (1 - k); return e; }); };

// PRNG determinista (sin Math.random): xorshift con semilla fija → reproducible.
let _s = 88172645463325252n;
const rnd = () => { _s ^= _s << 13n; _s ^= _s >> 7n; _s ^= _s << 17n; return Number((_s >> 11n) & ((1n << 53n) - 1n)) / 2 ** 53; };

async function getW(t) { const y = t.replace('.', '-');
  try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`, { headers: UA });
    if (!r.ok) return null; const d = (await r.json()).chart?.result?.[0]; const q = d?.indicators?.quote?.[0];
    if (!d?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < d.timestamp.length; i++) if (q.close[i] != null && q.high[i] != null && q.low[i] != null)
      b.push({ h: q.high[i], l: q.low[i], c: q.close[i] });
    return b.length > 60 ? b : null; } catch { return null; } }
async function mapLimit(items, n, fn) { const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  const list = (uni.universe || uni).map(u => u.ticker).slice(0, SAMPLE);
  console.log(`\n════ MONTE CARLO DE DRAWDOWN — EMACross anticipado, ¼ Kelly ════`);
  console.log(`  ${NSLOTS} posiciones de ${(POSFRAC * 100).toFixed(1)}% · ${PATHS} simulaciones · sizing equiponderado 1x\n`);
  const bars = (await mapLimit(list, CONC, getW)).filter(Boolean);

  // Distribución empírica de trades: {ret%, dur semanas}
  const trades = [];
  for (const b of bars) {
    const cl = b.map(x => x.c), ef = ema(cl, FAST), es = ema(cl, SLOW);
    let inPos = false, ei = 0, stop = 0;
    for (let i = SLOW + 1; i < b.length; i++) {
      const gap = (ef[i] - es[i]) / cl[i], gapPrev = (ef[i - 1] - es[i - 1]) / cl[i - 1];
      const longImm = gap < 0 && Math.abs(gap) < GAPTH && gap > gapPrev;
      if (!inPos && longImm) { inPos = true; ei = i; stop = cl[i] * (1 - CAT); continue; }
      if (inPos) {
        const bear = gapPrev >= 0 && gap < 0;
        if (b[i].l <= stop) { trades.push({ r: (stop / cl[ei] - 1) - COST * 2, w: i - ei }); inPos = false; }
        else if (bear) { trades.push({ r: (cl[i] / cl[ei] - 1) - COST * 2, w: Math.max(1, i - ei) }); inPos = false; }
      }
    }
  }
  console.log(`  trades empíricos: ${trades.length} · ret medio ${(trades.reduce((a, t) => a + t.r, 0) / trades.length * 100).toFixed(1)}% · dur mediana ${[...trades].sort((a, b) => a.w - b.w)[trades.length >> 1].w}w\n`);

  // Simulación: NSLOTS ranuras; cada semana, si una ranura está libre abre un trade bootstrap
  // (dur w, ret r aplicado al cierre). Equity marcado a cierres. maxDD por camino.
  function simMaxDD(weeks) {
    let eq = 1, peak = 1, maxdd = 0;
    const slot = Array.from({ length: NSLOTS }, () => ({ left: 0, r: 0 }));
    for (let w = 0; w < weeks; w++) {
      for (const s of slot) {
        if (s.left <= 0) { const t = trades[(rnd() * trades.length) | 0]; s.left = t.w; s.r = t.r; }
        s.left--;
        if (s.left === 0) { eq *= (1 + POSFRAC * s.r); }   // realiza al cierre
      }
      if (eq > peak) peak = eq;
      const dd = eq / peak - 1;
      if (dd < maxdd) maxdd = dd;
    }
    return maxdd * 100;
  }

  console.log('  Horizonte   maxDD mediana   p75      p95      p99      peor');
  for (const H of HORIZONS) {
    const dds = Array.from({ length: PATHS }, () => simMaxDD(H));
    const yrs = (H / 52).toFixed(0);
    console.log(`   ${yrs} año${yrs > 1 ? 's' : ' '}      ${pct(dds, 50).toFixed(1)}%        ${pct(dds, 25).toFixed(1)}%   ${pct(dds, 5).toFixed(1)}%   ${pct(dds, 1).toFixed(1)}%   ${Math.min(...dds).toFixed(1)}%`);
  }
  console.log('\n  LECTURA: el DD "normal" del sistema ≈ mediana-p75. El p95-p99 = malas rachas esperables.');
  console.log('  Freno recomendado: por ENCIMA del p95 a ~3 años (si no, te saca en drawdowns sanos).');
  console.log('  "Quemar cuenta" = pérdida de la que el sistema no se recupera; por eso el sizing ¼ Kelly');
  console.log('  (sin apalancar) evita la ruina: ninguna racha de -% lleva el equity a 0.\n');
})();
