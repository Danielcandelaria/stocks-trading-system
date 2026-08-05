#!/usr/bin/env node
// backtest_rsi2_volfilter.mjs — ¿Arregla RSI2 excluir los nombres MUY VOLÁTILES?
// (forward: las perdedoras enormes —AMKR −20%, RKLB −19%— son todas alta-beta).
//
// Hipótesis: filtrar por VOLATILIDAD (ATR% = ATR20/precio) recorta las perdedoras
// grandes sin destrozar el edge. Se prueban techos de ATR%: sin filtro / ≤3 / ≤4 /
// ≤5 / ≤6%. Métrica clave: NO solo %/trade, sino la PERDEDORA MEDIA y el peor
// trade — el problema del usuario es la asimetría (gana +3%, pierde −6.7%).
// Mecánica EXACTA de RSI2 (SMA5/5d/−20%). Walk-forward 4 ventanas. READ-ONLY.

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const COST = 0.0005, DISASTER = 0.20, SAMPLE = +(process.argv[2] || 250), RANGE = process.argv[3] || '5y';
const CAPS = [99, 3, 4, 5, 6];   // techos de ATR% (99 = sin filtro)
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
// ATR(20) en % del precio
function atrPct(bars, p = 20) { const tr = [], out = new Array(bars.length).fill(null);
  for (let i = 0; i < bars.length; i++) { if (i === 0) { tr.push(bars[0].h - bars[0].l); continue; }
    const pc = bars[i - 1].c; tr.push(Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - pc), Math.abs(bars[i].l - pc))); }
  let s = 0; for (let i = 0; i < bars.length; i++) { s += tr[i]; if (i >= p) s -= tr[i - p]; if (i >= p - 1) out[i] = (s / p) / bars[i].c * 100; }
  return out; }

async function getBars(t) { const y = t.replace('.', '-');
  try { const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=${RANGE}&interval=1d`, { headers: UA });
    if (!res.ok) return null; const r = (await res.json()).chart?.result?.[0]; const q = r?.indicators?.quote?.[0];
    if (!r?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < r.timestamp.length; i++) if (q.close[i] != null && q.open[i] != null) b.push({ t: r.timestamp[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
    return b.length > 230 ? b : null; } catch { return null; } }

function simulate(bars, s5, i) {
  const entry = bars[i].c * (1 + COST), disaster = entry * (1 - DISASTER);
  for (let k = 1; k <= 5; k++) { const j = i + k; if (j >= bars.length) return null; const b = bars[j];
    if (b.l <= disaster) return (Math.min(b.o, disaster) * (1 - COST) / entry - 1) * 100;
    if (s5[j] != null && b.c > s5[j]) return (b.c * (1 - COST) / entry - 1) * 100;
    if (k === 5) return (b.c * (1 - COST) / entry - 1) * 100;
  }
  return null;
}

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  const tickers = (uni.universe || uni).slice(0, SAMPLE).map(u => u.ticker);
  console.log(`\n══ RSI2 + FILTRO DE VOLATILIDAD (ATR%) — walk-forward ══`);
  console.log(`  ${tickers.length} tickers · ${RANGE} · mecánica exacta (SMA5/5d/−20%)\n`);

  const trades = [];   // { ret, atr, t }
  let done = 0, ok = 0, tmin = Infinity, tmax = -Infinity;
  for (const tk of tickers) {
    const bars = await getBars(tk); done++;
    if (done % 50 === 0) process.stdout.write(`  …${done}/${tickers.length}\n`);
    await sleep(110); if (!bars) continue; ok++;
    const cl = bars.map(b => b.c), s5 = sma(cl, 5), r2 = rsi(cl, 2), e200 = sma(cl, 200), atr = atrPct(bars, 20);
    for (let i = 200; i < bars.length - 1; i++) {
      if (r2[i] == null || e200[i] == null || atr[i] == null) continue;
      if (r2[i] < 10 && cl[i] > e200[i]) {
        const ret = simulate(bars, s5, i);
        if (ret == null) continue;
        trades.push({ ret, atr: atr[i], t: bars[i].t });
        tmin = Math.min(tmin, bars[i].t); tmax = Math.max(tmax, bars[i].t);
      }
    }
  }
  console.log(`\n  ${ok} tickers · ${trades.length} señales RSI2\n`);

  const span = (tmax - tmin) / 4;
  const win = t => Math.min(3, Math.floor((t - tmin) / span));
  const stat = arr => { const n = arr.length; if (!n) return { n: 0, m: 0, wr: 0, pf: null, avgW: 0, avgL: 0, worst: 0 };
    const s = arr.reduce((a, b) => a + b, 0); const w = arr.filter(x => x > 0), l = arr.filter(x => x <= 0);
    const pf = l.length && l.reduce((a, b) => a + b, 0) !== 0 ? Math.abs(w.reduce((a, b) => a + b, 0) / l.reduce((a, b) => a + b, 0)) : null;
    return { n, m: s / n, wr: 100 * w.length / n, pf, avgW: w.length ? w.reduce((a, b) => a + b, 0) / w.length : 0,
      avgL: l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0, worst: Math.min(...arr) }; };
  const fmt = v => (v >= 0 ? '+' : '') + v.toFixed(2);

  console.log('  ' + 'filtro'.padEnd(11) + 'n'.padStart(6) + '%/tr'.padStart(7) + 'PF'.padStart(6) + 'ganaMed'.padStart(9) + 'perdMed'.padStart(9) + 'peor'.padStart(8) + '  WF');
  console.log('  ' + '─'.repeat(72));
  for (const cap of CAPS) {
    const kept = trades.filter(x => x.atr <= cap);
    const s = stat(kept.map(x => x.ret));
    const wins = [0, 1, 2, 3].map(wi => stat(kept.filter(x => win(x.t) === wi).map(x => x.ret)));
    const wfPos = wins.filter(w => w.n >= 5 && w.m > 0).length;
    const lbl = cap === 99 ? 'SIN filtro' : `ATR% ≤ ${cap}`;
    console.log('  ' + lbl.padEnd(11) + String(s.n).padStart(6) + fmt(s.m).padStart(7) + (s.pf ? s.pf.toFixed(2) : '—').padStart(6)
      + fmt(s.avgW).padStart(9) + fmt(s.avgL).padStart(9) + fmt(s.worst).padStart(8) + `   ${wfPos}/4`);
  }
  console.log(`\n  Lectura: buscamos que 'perdMed' se acerque a 'ganaMed' (asimetría arreglada)`);
  console.log(`  y que %/tr y PF suban SIN destrozar la muestra, aguantando WF 4/4.\n`);
})();
