#!/usr/bin/env node
// study_ma200_oversold.mjs — ¿Cuánto añade combinar SOPORTE en la MA200 con
// SOBREVENTA (RSI2<10)? Descompone el edge de RSI2 en sus dos piezas.
//
// Compara 4 cestas de días, todas con precio POR ENCIMA de la MA200 (régimen
// alcista), y mide el forward 10 días:
//   A) SOPORTE solo    — el día toca la MA200 desde arriba (low en banda ±3%).
//   B) SOBREVENTA sola — RSI2<10 (pánico corto), esté donde esté sobre la MA.
//   C) SOPORTE + SOBREVENTA — toca la MA200 Y RSI2<10 (≈ zona de RSI2 en su suelo).
//   D) BASELINE        — cualquier día sobre la MA200.
// Si C > A y C > B → la combinación es más que la suma de las partes.
// READ-ONLY (Yahoo).

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const SAMPLE = +(process.argv[2] || 250);
const RANGE  = process.argv[3] || '2y';
const NEAR   = 0.03;   // "cerca de la MA200" = dentro del 3%
const sleep = ms => new Promise(r => setTimeout(r, ms));

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const ROOT = dirname(fileURLToPath(import.meta.url));
const sma = (cl, p) => { const o = new Array(cl.length).fill(null); let s = 0; for (let i = 0; i < cl.length; i++) { s += cl[i]; if (i >= p) s -= cl[i - p]; if (i >= p - 1) o[i] = s / p; } return o; };
function rsi(cl, p) { const o = new Array(cl.length).fill(null); let ag = 0, al = 0;
  for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= p) { ag += g / p; al += l / p; if (i === p) o[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
    else { ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p; o[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } }
  return o; }

async function getBars(t) { const y = t.replace('.', '-');
  try { const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=${RANGE}&interval=1d`, { headers: UA });
    if (!res.ok) return null; const r = (await res.json()).chart?.result?.[0]; const q = r?.indicators?.quote?.[0];
    if (!r?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < r.timestamp.length; i++) if (q.close[i] != null && q.open[i] != null) b.push({ o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
    return b.length > 230 ? b : null; } catch { return null; } }

const A = [], B = [], C = [], D = [];   // soporte / sobreventa / ambos / baseline
const fwd10 = (bars, i) => (i + 10 < bars.length) ? (bars[i + 10].c / bars[i].c - 1) * 100 : null;

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  const tickers = (uni.universe || uni).slice(0, SAMPLE).map(u => u.ticker);
  console.log(`\n══ SOPORTE MA200 × SOBREVENTA (RSI2) — ¿qué aporta cada pieza? ══`);
  console.log(`  ${tickers.length} tickers · ${RANGE} · forward 10 días · todo POR ENCIMA de la MA200\n`);

  let done = 0, ok = 0;
  for (const t of tickers) {
    const bars = await getBars(t); done++;
    if (done % 50 === 0) process.stdout.write(`  …${done}/${tickers.length}\n`);
    await sleep(110); if (!bars) continue; ok++;
    const cl = bars.map(b => b.c), ma = sma(cl, 200), r2 = rsi(cl, 2);
    for (let i = 205; i < bars.length - 10; i++) {
      if (ma[i] == null || r2[i] == null) continue;
      const above = cl[i] > ma[i];               // régimen: por encima de la MA200
      if (!above) continue;
      const cerca = cl[i] <= ma[i] * (1 + NEAR); // dentro del 3% de la media = "en soporte"
      const sobreV = r2[i] < 10;                 // sobreventa (pánico corto)
      const f = fwd10(bars, i); if (f == null) continue;
      D.push(f);                                  // baseline: cualquier día sobre la MA200
      if (cerca && !sobreV) A.push(f);
      if (sobreV && !cerca) B.push(f);
      if (cerca && sobreV) C.push(f);
    }
  }

  const stat = arr => { const n = arr.length; const m = arr.reduce((a, b) => a + b, 0) / n;
    return { n, m, up: 100 * arr.filter(x => x > 0).length / n }; };
  const fmt = v => (v >= 0 ? '+' : '') + v.toFixed(2);
  const row = (lbl, arr) => { const s = stat(arr);
    console.log(`  ${lbl.padEnd(34)} media ${fmt(s.m).padStart(6)}%  ·  ${s.up.toFixed(0)}% arriba  ·  n=${s.n}`); };

  console.log(`\n  ${ok} tickers\n`);
  row('D) BASELINE (sobre la MA200)', D);
  row('A) SOPORTE solo (≤3% de la MA)', A);
  row('B) SOBREVENTA sola (RSI2<10)', B);
  row('C) SOPORTE + SOBREVENTA', C);
  const sA = stat(A), sB = stat(B), sC = stat(C), sD = stat(D);
  console.log(`\n  ¿la combinación (C) bate a cada pieza suelta y al baseline?`);
  console.log(`   C vs baseline: ${fmt(sC.m - sD.m)}pp   ·   C vs soporte: ${fmt(sC.m - sA.m)}pp   ·   C vs sobreventa: ${fmt(sC.m - sB.m)}pp`);
  console.log(`   ${sC.m > sA.m && sC.m > sB.m && sC.m > sD.m ? '✅ SÍ — juntas dan más que cada una sola (por eso funciona RSI2)' : '⚠️ no claramente — revisar'}\n`);
})();
