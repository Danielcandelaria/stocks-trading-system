#!/usr/bin/env node
// backtest_rsi2_distance.mjs — ¿Mejora RSI2 exigir una DISTANCIA MÍNIMA sobre la
// MA200? (hipótesis del estudio ma200×oversold: las señales pegadas a la media
// son las flojas). Con WALK-FORWARD para no comprar un espejismo (regla #8).
//
// Replica la mecánica EXACTA de RSI2 en producción:
//   señal: RSI2<10 Y cierre>EMA200 (aquí EMA=SMA200, como el filtro de régimen)
//   entrada: cierre de la vela de señal (×coste) — igual que la validación
//   salida: 1er cierre sobre SMA5, o time-stop 5 velas, + stop catástrofe −20%
// La ÚNICA variable es el filtro de distancia: precio ≥ X% sobre la MA200.
//
// Métrica: %/trade, WR, PF, y consistencia en 4 ventanas cronológicas (WF).
// READ-ONLY (Yahoo).

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const COST = 0.0005, DISASTER = 0.20, SAMPLE = +(process.argv[2] || 250), RANGE = process.argv[3] || '5y';
const THRESH = [0, 0.03, 0.05, 0.08, 0.10];   // distancia mínima sobre la MA200
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
    for (let i = 0; i < r.timestamp.length; i++) if (q.close[i] != null && q.open[i] != null) b.push({ t: r.timestamp[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
    return b.length > 230 ? b : null; } catch { return null; } }

// simula UN trade RSI2 desde la señal i → retorno %
function simulate(bars, s5, i) {
  const entry = bars[i].c * (1 + COST), disaster = entry * (1 - DISASTER);
  for (let k = 1; k <= 5; k++) { const j = i + k; if (j >= bars.length) return null;
    const b = bars[j];
    if (b.l <= disaster) return (Math.min(b.o, disaster) * (1 - COST) / entry - 1) * 100;
    if (s5[j] != null && b.c > s5[j]) return (b.c * (1 - COST) / entry - 1) * 100;
    if (k === 5) return (b.c * (1 - COST) / entry - 1) * 100;
  }
  return null;
}

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  const tickers = (uni.universe || uni).slice(0, SAMPLE).map(u => u.ticker);
  console.log(`\n══ RSI2 + FILTRO DE DISTANCIA A LA MA200 (walk-forward) ══`);
  console.log(`  ${tickers.length} tickers · ${RANGE} · mecánica exacta (SMA5/5d/−20%)\n`);

  const trades = [];   // { ret, dist, t }
  let done = 0, ok = 0, tmin = Infinity, tmax = -Infinity;
  for (const tk of tickers) {
    const bars = await getBars(tk); done++;
    if (done % 50 === 0) process.stdout.write(`  …${done}/${tickers.length}\n`);
    await sleep(110); if (!bars) continue; ok++;
    const cl = bars.map(b => b.c), ma = sma(cl, 200), s5 = sma(cl, 5), r2 = rsi(cl, 2);
    for (let i = 200; i < bars.length - 1; i++) {
      if (r2[i] == null || ma[i] == null) continue;
      if (r2[i] < 10 && cl[i] > ma[i]) {
        const ret = simulate(bars, s5, i);
        if (ret == null) continue;
        const dist = (cl[i] / ma[i] - 1);   // distancia sobre la MA200
        trades.push({ ret, dist, t: bars[i].t });
        tmin = Math.min(tmin, bars[i].t); tmax = Math.max(tmax, bars[i].t);
      }
    }
  }
  console.log(`\n  ${ok} tickers · ${trades.length} señales RSI2\n`);

  // 4 ventanas cronológicas iguales (walk-forward)
  const span = (tmax - tmin) / 4;
  const win = t => Math.min(3, Math.floor((t - tmin) / span));
  const stat = arr => { const n = arr.length; if (!n) return { n: 0, m: 0, wr: 0, pf: null };
    const s = arr.reduce((a, b) => a + b, 0); const w = arr.filter(x => x > 0), l = arr.filter(x => x <= 0);
    const pf = l.length && l.reduce((a, b) => a + b, 0) !== 0 ? Math.abs(w.reduce((a, b) => a + b, 0) / l.reduce((a, b) => a + b, 0)) : null;
    return { n, m: s / n, wr: 100 * w.length / n, pf }; };
  const fmt = v => (v >= 0 ? '+' : '') + v.toFixed(2);

  console.log('  ' + 'filtro'.padEnd(12) + 'n'.padStart(6) + '%/trade'.padStart(9) + 'WR'.padStart(6) + 'PF'.padStart(7) + '   4 ventanas (%/trade)      WF');
  console.log('  ' + '─'.repeat(74));
  for (const th of THRESH) {
    const kept = trades.filter(x => x.dist >= th);
    const s = stat(kept.map(x => x.ret));
    const wins = [0, 1, 2, 3].map(wi => stat(kept.filter(x => win(x.t) === wi).map(x => x.ret)));
    const wfPos = wins.filter(w => w.n >= 5 && w.m > 0).length;
    const wStr = wins.map(w => w.n >= 5 ? fmt(w.m) : '·').join(' ');
    const lbl = th === 0 ? 'BASE (>0%)' : `≥ ${(th * 100).toFixed(0)}%`;
    console.log('  ' + lbl.padEnd(12) + String(s.n).padStart(6) + fmt(s.m).padStart(9) + (s.wr.toFixed(0) + '%').padStart(6)
      + (s.pf ? s.pf.toFixed(2) : '—').padStart(7) + '   ' + wStr.padEnd(24) + `${wfPos}/4`);
  }
  console.log(`\n  Lectura: un filtro BUENO sube %/trade y PF SIN destrozar la muestra, y`);
  console.log(`  aguanta en las 4 ventanas (WF 4/4). Si mejora en total pero WF ≤2/4 = overfit.\n`);
})();
