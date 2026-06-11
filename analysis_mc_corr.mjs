// stocks/analysis_mc_corr.mjs
// Dos análisis de cartera (metodología Mariel adoptada 2026-06-11):
// 1) CORRELACIÓN entre DeMark-9 y RSI-2: ¿diversifican o son el mismo trade?
//    - solapamiento temporal de posiciones y correlación de P&L diario.
// 2) MONTE CARLO sobre los R/retornos del backtest: bandas de normalidad
//    para juzgar el forward (peor racha esperable, drawdown p95, etc.).

import { readFileSync, readdirSync } from 'fs';
import { computeTDSetup, isPerfected } from '../scanner/demark_calc.mjs';

const COST = 0.0005;
function ema(cl, p) { const k = 2 / (p + 1); let e = null; return cl.map((c, i) => { e = e === null ? c : c * k + e * (1 - k); return i >= p - 1 ? e : null; }); }
function sma(cl, p) { const out = new Array(cl.length).fill(null); let s = 0; for (let i = 0; i < cl.length; i++) { s += cl[i]; if (i >= p) s -= cl[i - p]; if (i >= p - 1) out[i] = s / p; } return out; }
function rsi(cl, p) {
  const out = new Array(cl.length).fill(null); let ag = 0, al = 0;
  for (let i = 1; i < cl.length; i++) {
    const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= p) { ag += g / p; al += l / p; if (i === p) out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
    else { ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p; out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
  }
  return out;
}

const { universe } = JSON.parse(readFileSync(new URL('./universe.json', import.meta.url)));
const top500 = new Set(universe.map(u => u.ticker));
const dmTrades = [], rsTrades = [];

for (const f of readdirSync(new URL('./data', import.meta.url))) {
  if (!top500.has(f.replace('.json', ''))) continue;
  const { bars } = JSON.parse(readFileSync(new URL(`./data/${f}`, import.meta.url)));
  const cl = bars.map(b => b.c);
  const e50 = ema(cl, 50), e200 = ema(cl, 200), s5 = sma(cl, 5), r2 = rsi(cl, 2);
  const td = computeTDSetup(bars);
  // DeMark TP2 spec actual
  let pos = null;
  for (let i = 0; i < bars.length - 1; i++) {
    if (pos) {
      const b = bars[i]; let x = null;
      if (b.l <= pos.sl) x = Math.min(b.o, pos.sl);
      else if (b.h >= pos.tp) x = Math.max(b.o, pos.tp);
      else if (i - pos.i >= 40) x = b.c;
      if (x != null) { const px = x * (1 - COST); dmTrades.push({ tIn: pos.t, tOut: bars[i].t, r: (px - pos.px) / pos.risk }); pos = null; }
    }
    if (!pos && td.bullSetup[i] === 9 && td.bullSetupBars[i] && e200[i] != null && e50[i] > e200[i] && bars[i].c > e200[i]) {
      if (!isPerfected(bars, td.bullSetupBars[i], 'bull')) continue;
      const sl = Math.min(...td.bullSetupBars[i].map(k => bars[k].l));
      const px = bars[i + 1].o * (1 + COST), risk = px - sl;
      if (risk <= 0 || risk / px > 0.25 || risk / px < 0.03) continue;
      pos = { i: i + 1, t: bars[i + 1].t, px, sl, tp: px + 2 * risk, risk };
    }
  }
  // RSI2 spec actual
  pos = null;
  for (let i = 0; i < bars.length - 1; i++) {
    if (pos) {
      const b = bars[i];
      if ((s5[i] != null && b.c > s5[i]) || i - pos.i >= 5) {
        const px = b.c * (1 - COST); rsTrades.push({ tIn: pos.t, tOut: bars[i].t, ret: px / pos.px - 1 }); pos = null;
      }
    }
    if (!pos && r2[i] != null && e200[i] != null && r2[i] < 10 && bars[i].c > e200[i]) {
      pos = { i: i + 1, t: bars[i + 1].t, px: bars[i + 1].o * (1 + COST) };
    }
  }
}

console.log(`DeMark: ${dmTrades.length} trades | RSI2: ${rsTrades.length} trades\n`);

// ---- 1) CORRELACIÓN ----
// P&L agregado por semana de cada sistema (en unidades comparables: R para DM,
// ret%/2 normalizado para RSI2) y correlación de Pearson entre las dos series.
const week = t => Math.floor(t / (7 * 86400));
const wk = {};
for (const t of dmTrades) { const w = week(t.tOut); (wk[w] ??= { dm: 0, rs: 0 }).dm += t.r; }
for (const t of rsTrades) { const w = week(t.tOut); (wk[w] ??= { dm: 0, rs: 0 }).rs += t.ret * 100; }
const weeks = Object.values(wk);
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const dmS = weeks.map(w => w.dm), rsS = weeks.map(w => w.rs);
const mD = mean(dmS), mR = mean(rsS);
let num = 0, dD = 0, dR = 0;
for (let i = 0; i < weeks.length; i++) { const a = dmS[i] - mD, b = rsS[i] - mR; num += a * b; dD += a * a; dR += b * b; }
const corr = num / Math.sqrt(dD * dR);
// solapamiento temporal: % de días con posición DM abierta en que también hay RSI2 abierta
const dmDays = new Set(), rsDays = new Set();
for (const t of dmTrades) for (let d = t.tIn; d <= t.tOut; d += 86400) dmDays.add(Math.floor(d / 86400));
for (const t of rsTrades) for (let d = t.tIn; d <= t.tOut; d += 86400) rsDays.add(Math.floor(d / 86400));
const overlap = [...dmDays].filter(d => rsDays.has(d)).length / dmDays.size;
console.log(`CORRELACIÓN P&L semanal DeMark↔RSI2: ${corr.toFixed(2)} (semanas con actividad: ${weeks.length})`);
console.log(`Solapamiento: ${(overlap * 100).toFixed(0)}% de los días con DeMark abierto también hay RSI2 abierto\n`);

// ---- 2) MONTE CARLO ----
// PRNG con semilla fija (reproducible; Math.random no disponible en workflows
// y queremos resultados auditables)
let seed = 42;
const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
function monteCarlo(vals, perYear, label, unit) {
  const SIMS = 5000;
  const streaks = [], dds = [], yearRets = [];
  for (let s = 0; s < SIMS; s++) {
    let eq = 0, peak = 0, dd = 0, streak = 0, worst = 0;
    for (let i = 0; i < perYear; i++) {
      const v = vals[Math.floor(rng() * vals.length)];
      eq += v; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak);
      if (v < 0) { streak++; worst = Math.max(worst, streak); } else streak = 0;
    }
    streaks.push(worst); dds.push(-dd); yearRets.push(eq);
  }
  const pct = (a, p) => a.sort((x, y) => x - y)[Math.floor(a.length * p)];
  console.log(`MC ${label} (${perYear} trades/año, 5000 sims):`);
  console.log(`  peor racha de pérdidas: mediana ${pct(streaks, 0.5)}, p95 ${pct(streaks, 0.95)} seguidas`);
  console.log(`  drawdown máx anual: mediana ${pct(dds, 0.5).toFixed(1)}${unit}, p95 ${pct(dds, 0.95).toFixed(1)}${unit} ← ALARMA si se supera`);
  console.log(`  resultado anual: p5 ${pct(yearRets, 0.05).toFixed(1)}${unit}, mediana ${pct(yearRets, 0.5).toFixed(1)}${unit}, p95 ${pct(yearRets, 0.95).toFixed(1)}${unit}`);
  console.log(`  años perdedores: ${(yearRets.filter(r => r < 0).length / SIMS * 100).toFixed(0)}%\n`);
}
monteCarlo(dmTrades.map(t => t.r), Math.round(dmTrades.length / 3), 'DeMark-9 (en R)', 'R');
monteCarlo(rsTrades.map(t => t.ret * 100), Math.round(rsTrades.length / 3 / 20), 'RSI2 cap5 (en %, ~1/20 del flujo total por el cap)', '%');
