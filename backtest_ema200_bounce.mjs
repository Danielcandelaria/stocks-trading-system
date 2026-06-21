// stocks/backtest_ema200_bounce.mjs
// Backtest LONG-only: rebote en EMA200 SEMANAL (régimen EMA50 > EMA200)
//
// Señal: close ≤ EMA200 × (1 + ZONE) con EMA50 > EMA200 → entra apertura siguiente.
// Stop: EMA200 × (1 - STOP_PCT). TP: 2R (fijo).
// Walk-forward: 4 ventanas 2020-2026 (único rango donde EMA200 semanal tiene valores).
// Costes: 0.05%/lado. ⚠️ Sesgo de supervivencia (S&P500 actual, 10 años de datos).

import { readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'data_weekly');
const COST = 0.0005;

function emaArr(arr, period) {
  const k = 2 / (period + 1);
  let e = null;
  return arr.map(v => { e = e === null ? v : v * k + e * (1 - k); return e; });
}

function backtestRange(bars, cfg, fromT, toT) {
  const closes = bars.map(b => b.c);
  const e50  = emaArr(closes, 50);
  const e200 = emaArr(closes, 200);
  const trades = [];
  let inTrade = null;

  for (let i = 201; i < bars.length - 1; i++) {
    const b = bars[i], nx = bars[i + 1];

    if (inTrade) {
      let exit = null, reason = null;
      if (nx.o <= inTrade.stop)  { exit = nx.o;          reason = 'STOP'; }
      else if (b.l <= inTrade.stop) { exit = inTrade.stop; reason = 'STOP'; }
      else if (b.h >= inTrade.tp)   { exit = inTrade.tp;   reason = 'TP';   }
      if (exit) {
        const pnl      = (exit * (1 - COST)) / (inTrade.entry * (1 + COST)) - 1;
        const riskPct  = (inTrade.entry - inTrade.stop) / inTrade.entry;
        if (b.t >= fromT && b.t <= toT)
          trades.push({ t: b.t, pnl, r: riskPct > 0 ? pnl / riskPct : 0, reason });
        inTrade = null;
      }
      continue;
    }

    if (b.t < fromT || b.t > toT) continue;
    if (e50[i] === null || e200[i] === null || e50[i] <= e200[i]) continue;

    const dist = (b.c - e200[i]) / e200[i];
    if (dist < 0 || dist > cfg.zone) continue;
    if (cfg.confirm && b.c <= b.o) continue;

    const entry  = nx.o;
    const stopPx = e200[i] * (1 - cfg.stop);
    const risk   = (entry - stopPx) / entry;
    if (risk <= 0.005) continue;
    inTrade = { entry, stop: stopPx, tp: entry + 2 * (entry - stopPx) };
  }
  return trades;
}

const WINDOWS = [
  { from: new Date('2020-04-01').getTime()/1000, to: new Date('2021-12-31').getTime()/1000, label: '2020-2021 (bull COVID)' },
  { from: new Date('2021-01-01').getTime()/1000, to: new Date('2022-12-31').getTime()/1000, label: '2021-2022 (correction)' },
  { from: new Date('2022-01-01').getTime()/1000, to: new Date('2024-06-30').getTime()/1000, label: '2022-2024 (bear+recovery)' },
  { from: new Date('2023-06-01').getTime()/1000, to: new Date('2026-06-30').getTime()/1000, label: '2023-2026 (AI bull)' },
];

const VARIANTS = [];
for (const zone    of [0.03, 0.05, 0.08])
for (const confirm of [false, true])
for (const stop    of [0.05, 0.08])
  VARIANTS.push({ zone, confirm, stop,
    label: `zona${(zone*100).toFixed(0)}%_conf${confirm?'Y':'N'}_stop${(stop*100).toFixed(0)}%` });

const files = readdirSync(DIR).filter(f => f.endsWith('.json'));
console.log(`Backtesting ${files.length} tickers, ${VARIANTS.length} variantes...\n`);

const agg = VARIANTS.map(() => ({ all: [], wTrades: WINDOWS.map(() => []) }));
let processed = 0;

for (const f of files) {
  const { bars } = JSON.parse(readFileSync(join(DIR, f)));
  if (bars.length < 250) continue;
  processed++;
  const minT = bars[0].t, maxT = bars[bars.length - 1].t;

  for (let vi = 0; vi < VARIANTS.length; vi++) {
    const cfg = VARIANTS[vi];
    agg[vi].all.push(...backtestRange(bars, cfg, minT, maxT));
    for (let w = 0; w < 4; w++)
      agg[vi].wTrades[w].push(...backtestRange(bars, cfg, WINDOWS[w].from, WINDOWS[w].to));
  }
}

function pf(tr) {
  const gW = tr.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const gL = Math.abs(tr.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
  return gL > 0 ? gW / gL : 9.99;
}

console.log(`Tickers: ${processed}   ⚠️ Sesgo supervivencia\n`);
console.log('VARIANTE'.padEnd(36), 'TOTAL', 'PF'.padStart(6), 'WR%'.padStart(5), 'WF'.padStart(4), 'avgR'.padStart(6));
console.log('─'.repeat(66));

const rows = agg.map((a, vi) => {
  const tr = a.all;
  if (tr.length < 15) return null;
  const pfAll = pf(tr);
  const wr = tr.filter(t => t.pnl > 0).length / tr.length * 100;
  const avgR = tr.reduce((s, t) => s + t.r, 0) / tr.length;
  const wfScore = a.wTrades.filter(wt => wt.length >= 5 && pf(wt) > 1.0).length;
  return { vi, tr, pfAll, wr, avgR, wfScore, wTrades: a.wTrades };
}).filter(Boolean).sort((a, b) => b.wfScore - a.wfScore || b.pfAll - a.pfAll);

for (const r of rows) {
  const v = VARIANTS[r.vi];
  const star = r.wfScore >= 3 ? ' ⭐' : r.wfScore >= 2 ? ' ✓' : '';
  console.log(
    v.label.padEnd(36),
    String(r.tr.length).padStart(5),
    r.pfAll.toFixed(2).padStart(6),
    r.wr.toFixed(0).padStart(5) + '%',
    String(r.wfScore).padStart(3) + '/4',
    r.avgR.toFixed(2).padStart(6) + 'R' + star
  );
}

// desglose de los top-3 por WF
const tops = rows.filter(r => r.wfScore >= 2).slice(0, 3);
if (tops.length) {
  console.log('\n📊 Desglose por ventana (top variantes):');
  for (const r of tops) {
    const v = VARIANTS[r.vi];
    console.log(`\n  ${v.label}:`);
    for (let w = 0; w < 4; w++) {
      const wt = r.wTrades[w];
      const line = wt.length >= 5
        ? `PF ${pf(wt).toFixed(2)}, WR ${(wt.filter(t=>t.pnl>0).length/wt.length*100).toFixed(0)}%, ${wt.length} trades`
        : `sin datos suficientes (${wt.length} trades)`;
      console.log(`    W${w+1} ${WINDOWS[w].label}: ${line}`);
    }
  }
}
console.log('\n📌 WF = ventanas con PF>1 y ≥5 trades. 4/4 = robusto | 3/4 = bueno | <3 = ojo.');
