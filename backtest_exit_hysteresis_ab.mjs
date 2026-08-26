#!/usr/bin/env node
// backtest_exit_hysteresis_ab.mjs — A/B de HISTÉRESIS DE SALIDA para EMACross.
//   Hipótesis: en lateral, el cruce contrario "al primer roce" provoca whipsaw.
//   Cambio probado: salir solo cuando EMA8 esté H% POR DEBAJO de EMA21 (banda muerta),
//   en vez de al cruzar 0. Entrada IDÉNTICA. Stop -18% idéntico. Coste 0.06%/lado.
//   Se prueba H = 0 (ACTUAL), 0.5% y 1.0%, en modo confirmado y anticipado.
//   CLAVE (norma dura del usuario): desglose en DOS MITADES temporales — si el óptimo
//   salta entre mitades, es overfit y se descarta. READ-ONLY (Yahoo 10y semanal).
//
// Uso: node backtest_exit_hysteresis_ab.mjs [sample]   (default 180)

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const COST = 0.0006, FAST = 8, SLOW = 21, CAT = 0.18, GAPTH = 0.012;
const SPLIT_YEAR = 2021;                 // frontera de mitades (10y ≈ 2016-2026)
const HS = [0, 0.005, 0.010];            // bandas de histéresis a comparar
const SAMPLE = +(process.argv[2] || 180);
const CONC = 10;
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
    return b.length > 60 ? b : null; } catch { return null; } }

// Trades LONG. mode: 'confirm'|'antic'. H = banda de histéresis de salida (fracción).
function trades(bars, mode, H) {
  const cl = bars.map(b => b.c), ef = ema(cl, FAST), es = ema(cl, SLOW), out = [];
  let inPos = false, ei = 0, stop = 0;
  for (let i = SLOW + 1; i < bars.length; i++) {
    const gap = (ef[i] - es[i]) / cl[i], gapPrev = (ef[i - 1] - es[i - 1]) / cl[i - 1];
    const bull = ef[i - 1] <= es[i - 1] && ef[i] > es[i];
    const longImm = gap < 0 && Math.abs(gap) < GAPTH && gap > gapPrev;
    const enter = mode === 'antic' ? (!inPos && longImm) : (!inPos && bull);
    if (enter) { inPos = true; ei = i; stop = cl[i] * (1 - CAT); continue; }
    if (inPos) {
      // Salida por CRUCE contrario con banda de histéresis: el gap CRUZA por debajo de -H
      // (de >=-H a <-H). Con H=0 es exactamente el cruce bajista canónico (bear = de >=0 a <0).
      const bearH = gapPrev >= -H && gap < -H;
      if (bars[i].l <= stop) { out.push({ ret: (stop / cl[ei] - 1) * 100 - COST * 200, t: bars[ei].t, wk: i - ei, why: 'stop' }); inPos = false; }
      else if (bearH) { out.push({ ret: (cl[i] / cl[ei] - 1) * 100 - COST * 200, t: bars[ei].t, wk: i - ei, why: 'cruce' }); inPos = false; }
    }
  }
  return out;
}

function stat(rs) { const n = rs.length; if (!n) return { n: 0, pf: 0, wr: 0, mean: 0, sum: 0, med: 0 };
  const s = rs.reduce((a, b) => a + b, 0), w = rs.filter(x => x > 0), l = rs.filter(x => x <= 0);
  const gw = w.reduce((a, b) => a + b, 0), gl = l.reduce((a, b) => a + b, 0);
  return { n, sum: s, mean: s / n, med: med(rs), wr: 100 * w.length / n, pf: gl ? Math.abs(gw / gl) : 999 }; }

function maxDD(ts) { const sorted = [...ts].sort((a, b) => a.t - b.t); let eq = 0, peak = 0, dd = 0;
  for (const t of sorted) { eq += t.ret; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); } return dd; }

async function mapLimit(items, n, fn) { const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out; }

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  const list = (uni.universe || uni).map(u => u.ticker).slice(0, SAMPLE);
  console.log(`\n════ A/B HISTÉRESIS DE SALIDA — EMACross ════`);
  console.log(`  ${list.length} acciones · 10 años semanal · coste 0.06%/lado · frontera mitades ${SPLIT_YEAR}`);
  console.log(`  H = banda: salir solo si EMA8 está H% por debajo de EMA21 (H=0 = sistema ACTUAL)\n`);

  const barsAll = await mapLimit(list, CONC, getW);
  const ok = barsAll.filter(Boolean);
  console.log(`  datos OK: ${ok.length}/${list.length} tickers\n`);

  for (const mode of ['confirm', 'antic']) {
    console.log(`──── MODO ${mode === 'antic' ? 'ANTICIPADO (el que operas)' : 'CONFIRMADO'} ────`);
    console.log('   H       trades   WR     PF     medRet   Σret     maxDD    dur   |  PF 1ªmitad / 2ªmitad   med 1ª/2ª');
    for (const H of HS) {
      const all = [];
      for (const b of ok) all.push(...trades(b, mode, H));
      const s = stat(all.map(t => t.ret));
      const h1 = all.filter(t => yearOf(t.t) < SPLIT_YEAR), h2 = all.filter(t => yearOf(t.t) >= SPLIT_YEAR);
      const s1 = stat(h1.map(t => t.ret)), s2 = stat(h2.map(t => t.ret));
      const dd = maxDD(all), dur = med(all.map(t => t.wk));
      const tag = H === 0 ? ' (ACTUAL)' : '';
      console.log(`  ${(H * 100).toFixed(1).padStart(4)}%  ${String(s.n).padStart(6)}  ${s.wr.toFixed(0).padStart(3)}%  ${s.pf.toFixed(2).padStart(5)}  ${(s.med >= 0 ? '+' : '') + s.med.toFixed(2).padStart(5)}%  ${(s.sum >= 0 ? '+' : '') + s.sum.toFixed(0).padStart(5)}%  ${dd.toFixed(0).padStart(5)}%  ${dur.toFixed(0).padStart(3)}w  |  ${s1.pf.toFixed(2)} / ${s2.pf.toFixed(2)}       ${(s1.med >= 0 ? '+' : '') + s1.med.toFixed(1)} / ${(s2.med >= 0 ? '+' : '') + s2.med.toFixed(1)}${tag}`);
    }
    console.log('');
  }
  console.log('  LECTURA: mejor H = el que sube PF y mediana SIN que el óptimo salte entre mitades.');
  console.log('  Si H=0 ya es el mejor en ambas mitades → NO tocar la salida (la histéresis no aporta).\n');
})();
