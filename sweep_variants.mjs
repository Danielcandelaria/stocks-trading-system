// stocks/sweep_variants.mjs
// Barrido disciplinado (regla 8): TODAS las variantes con walk-forward, no cherry-pick.
// Grid: régimen EMA × perfection × TP × stop mínimo. Señal base: DeMark setup-9 BUY.
// Diario LONG-only, costes 0.05%/lado, time-stop 40 barras.

import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { computeTDSetup, isPerfected } from '../scanner/demark_calc.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'data');
const COST = 0.0005;

function ema(cl, p) { const k = 2 / (p + 1); let e = null; return cl.map((c, i) => { e = e === null ? c : c * k + e * (1 - k); return i >= p - 1 ? e : null; }); }

const REGIMES = {
  'e50>e200':   (E, i) => E[200][i] != null && E[50][i] > E[200][i],
  'e20>e50':    (E, i) => E[50][i] != null && E[20][i] > E[50][i],
  'e20>50>200': (E, i) => E[200][i] != null && E[20][i] > E[50][i] && E[50][i] > E[200][i],
  'sin-regimen':(E, i) => true,
};
const TPS = [1.5, 2, 3];
const MINSTOPS = [0.02, 0.03];
const PERF = [false, true];

// pre-carga
const DATA = readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => {
  const { bars } = JSON.parse(readFileSync(join(DIR, f)));
  const cl = bars.map(b => b.c);
  return { bars, E: { 20: ema(cl, 20), 50: ema(cl, 50), 200: ema(cl, 200) }, td: computeTDSetup(bars) };
});

function run(regimeFn, perf, tpMult, minStop) {
  const trades = [];
  for (const { bars, E, td } of DATA) {
    let pos = null;
    for (let i = 0; i < bars.length - 1; i++) {
      if (pos) {
        const b = bars[i]; let x = null;
        if (b.l <= pos.sl) x = Math.min(b.o, pos.sl);
        else if (b.h >= pos.tp) x = Math.max(b.o, pos.tp);
        else if (i - pos.i >= 40) x = b.c;
        if (x != null) { const px = x * (1 - COST); trades.push({ t: pos.t, r: (px - pos.px) / pos.risk }); pos = null; }
      }
      if (!pos && td.bullSetup[i] === 9 && td.bullSetupBars[i] && regimeFn(E, i)) {
        if (perf && !isPerfected(bars, td.bullSetupBars[i], 'bull')) continue;
        const sl = Math.min(...td.bullSetupBars[i].map(k => bars[k].l));
        const px = bars[i + 1].o * (1 + COST);
        const risk = px - sl;
        if (risk <= 0 || risk / px > 0.25 || risk / px < minStop) continue;
        pos = { i: i + 1, t: bars[i + 1].t, px, sl, tp: px + tpMult * risk, risk };
      }
    }
  }
  if (trades.length < 100) return null;
  const ts = trades.map(t => t.t), lo = Math.min(...ts), span = (Math.max(...ts) - lo) / 4;
  let pass = 0; const wf = [];
  for (let w = 0; w < 4; w++) {
    const sub = trades.filter(t => t.t >= lo + w * span && t.t < lo + (w + 1) * span);
    const sr = sub.reduce((s, t) => s + t.r, 0);
    wf.push(sub.length ? +(sr / sub.length).toFixed(2) : null);
    if (sub.length && sr > 0) pass++;
  }
  const sumR = trades.reduce((s, t) => s + t.r, 0);
  return {
    n: trades.length,
    wr: +(trades.filter(t => t.r > 0).length / trades.length * 100).toFixed(1),
    sumR: +sumR.toFixed(0),
    rPerTrade: +(sumR / trades.length).toFixed(2),
    wfPass: pass, wf,
  };
}

const rows = [];
for (const [rName, rFn] of Object.entries(REGIMES))
  for (const perf of PERF)
    for (const tp of TPS)
      for (const ms of MINSTOPS) {
        const s = run(rFn, perf, tp, ms);
        if (s) rows.push({ variante: `${rName} ${perf ? '+perf' : ''} tp${tp} ms${ms * 100}%`, ...s });
      }

rows.sort((a, b) => b.wfPass - a.wfPass || b.rPerTrade - a.rPerTrade);
console.log('variante | n | WR% | ΣR | R/trade | WF | R/trade por ventana');
for (const r of rows)
  console.log(`${r.variante} | ${r.n} | ${r.wr} | ${r.sumR} | ${r.rPerTrade} | ${r.wfPass}/4 | [${r.wf.join(', ')}]`);
