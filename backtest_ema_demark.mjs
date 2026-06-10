// stocks/backtest_ema_demark.mjs
// Backtest LONG-only sobre diario (~3 años, universo screener TV).
// Variantes:
//   A1: cruce EMA20/50 como señal (entra cruce arriba, sale cruce abajo)
//   A2: cruce EMA50/200 como señal (idem)
//   B : régimen EMA50>EMA200 + entrada en DeMark setup-9 de COMPRA,
//       SL = setupLowBull (extremo del setup, regla validada del sistema forex),
//       TP = 2R, time-stop 40 barras.
// Costes: 0.05% por lado (slippage+comisión).
// ⚠️ Aproximación: datos Yahoo + universo actual (sesgo supervivencia).
//    Regla de oro: walk-forward por ventanas, no solo agregado.

import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { computeTDSetup } from '../scanner/demark_calc.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'data');
const COST = 0.0005; // por lado

function ema(closes, period) {
  const k = 2 / (period + 1);
  const out = new Array(closes.length).fill(null);
  let e = null;
  for (let i = 0; i < closes.length; i++) {
    e = e === null ? closes[i] : closes[i] * k + e * (1 - k);
    if (i >= period - 1) out[i] = e;
  }
  return out;
}

// ---- Variante A: cruce de EMAs como señal ----
function runCross(bars, fast, slow) {
  const closes = bars.map(b => b.c);
  const ef = ema(closes, fast), es = ema(closes, slow);
  const trades = [];
  let entry = null;
  for (let i = 1; i < bars.length - 1; i++) {
    if (ef[i - 1] == null || es[i - 1] == null) continue;
    const upCross = ef[i - 1] <= es[i - 1] && ef[i] > es[i];
    const dnCross = ef[i - 1] >= es[i - 1] && ef[i] < es[i];
    if (!entry && upCross) {
      entry = { i: i + 1, px: bars[i + 1].o * (1 + COST), t: bars[i + 1].t };
    } else if (entry && dnCross) {
      const exitPx = bars[i + 1].o * (1 - COST);
      trades.push({ t: entry.t, ret: exitPx / entry.px - 1, barsHeld: i + 1 - entry.i });
      entry = null;
    }
  }
  return trades;
}

// ---- Variante B: régimen EMA + DeMark setup-9 buy ----
function runDemark(bars) {
  const closes = bars.map(b => b.c);
  const e50 = ema(closes, 50), e200 = ema(closes, 200);
  const { bullSetup, bullSetupBars } = computeTDSetup(bars);
  const trades = [];
  let pos = null;
  for (let i = 0; i < bars.length - 1; i++) {
    if (pos) {
      const b = bars[i];
      let exitPx = null;
      if (b.l <= pos.sl) exitPx = Math.min(b.o, pos.sl);        // stop (gap incluido)
      else if (b.h >= pos.tp) exitPx = Math.max(b.o, pos.tp);   // target
      else if (i - pos.i >= 40) exitPx = b.c;                   // time-stop
      if (exitPx != null) {
        const px = exitPx * (1 - COST);
        trades.push({ t: pos.t, ret: px / pos.px - 1, r: (px - pos.px) / pos.risk, barsHeld: i - pos.i });
        pos = null;
      }
    }
    if (!pos && bullSetup[i] === 9 && bullSetupBars[i] && e200[i] != null && e50[i] > e200[i]) {
      const setupLow = Math.min(...bullSetupBars[i].map(k => bars[k].l));
      const px = bars[i + 1].o * (1 + COST);
      const risk = px - setupLow;
      if (risk <= 0 || risk / px > 0.25) continue; // setup roto o riesgo absurdo
      pos = { i: i + 1, t: bars[i + 1].t, px, sl: setupLow, tp: px + 2 * risk, risk };
    }
  }
  return trades;
}

// ---- métricas + walk-forward ----
function stats(trades) {
  if (!trades.length) return { n: 0 };
  const wins = trades.filter(t => t.ret > 0);
  const gp = wins.reduce((s, t) => s + t.ret, 0);
  const gl = trades.filter(t => t.ret <= 0).reduce((s, t) => s - t.ret, 0);
  const sumR = trades.some(t => t.r !== undefined) ? trades.reduce((s, t) => s + (t.r ?? 0), 0) : null;
  return {
    n: trades.length,
    wr: wins.length / trades.length,
    pf: gl > 0 ? gp / gl : Infinity,
    avgRet: trades.reduce((s, t) => s + t.ret, 0) / trades.length,
    sumR,
    avgBars: trades.reduce((s, t) => s + t.barsHeld, 0) / trades.length,
  };
}

const files = readdirSync(DIR).filter(f => f.endsWith('.json'));
console.log(`Tickers: ${files.length}`);
const all = { A1_ema20_50: [], A2_ema50_200: [], B_demark9_regime: [] };

for (const f of files) {
  const { bars } = JSON.parse(readFileSync(join(DIR, f)));
  all.A1_ema20_50.push(...runCross(bars, 20, 50));
  all.A2_ema50_200.push(...runCross(bars, 50, 200));
  all.B_demark9_regime.push(...runDemark(bars));
}

const ts = Object.values(all).flat().map(t => t.t);
const tMin = Math.min(...ts), tMax = Math.max(...ts);
const W = 4, span = (tMax - tMin) / W;

const fmt = s => s.n === 0 ? 'sin trades'
  : `n=${s.n}  WR=${(s.wr * 100).toFixed(1)}%  PF=${s.pf.toFixed(2)}  avg=${(s.avgRet * 100).toFixed(2)}%` +
    (s.sumR !== null ? `  ΣR=${s.sumR.toFixed(1)}` : '') + `  barsAvg=${s.avgBars.toFixed(0)}`;

for (const [name, trades] of Object.entries(all)) {
  console.log(`\n=== ${name} ===`);
  console.log('TOTAL  ', fmt(stats(trades)));
  let wfPass = 0;
  for (let w = 0; w < W; w++) {
    const lo = tMin + w * span, hi = lo + span;
    const sub = stats(trades.filter(t => t.t >= lo && t.t < hi));
    const d = new Date(lo * 1000).toISOString().slice(0, 10);
    console.log(`W${w + 1} (${d})`, fmt(sub));
    if (sub.n > 0 && sub.pf > 1) wfPass++;
  }
  console.log(`Walk-forward: ${wfPass}/${W} ventanas con PF>1`);
}
