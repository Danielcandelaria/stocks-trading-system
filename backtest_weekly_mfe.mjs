#!/usr/bin/env node
// backtest_weekly_mfe.mjs — MAE/MFE de WeeklySwing (TD Setup-9 semanal → salida countdown-13).
//   Reusa la MISMA lógica del scanner: entrada en el 9-suelo (apertura siguiente),
//   stop = mínimo del setup (suelo 8%, techo 30%), salida = countdown-13 / time-52w / stop.
//   Mide MFE/MAE por trade y COMPARA la salida actual (13-techo) contra trailing y toma fija,
//   para responder: ¿el countdown-13 captura el pico o conviene otra salida?
// READ-ONLY (Yahoo 10y semanal). Solo LONG (el sistema es solo suelos).

const UA = { 'User-Agent': 'Mozilla/5.0' };
const COST = 0.0005, MIN_STOP = 0.08, MAX_STOP = 0.30, TIME_STOP_W = 52, SAMPLE = +(process.argv[2] || 250);
const sleep = ms => new Promise(r => setTimeout(r, ms));
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup, computeTDCountdown } from '../scanner/demark_calc.mjs';
const ROOT = dirname(fileURLToPath(import.meta.url));
const med = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (x, e) => (x / e - 1) * 100;

async function getW(t) { const y = t.replace('.', '-');
  try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`, { headers: UA });
    if (!r.ok) return null; const d = (await r.json()).chart?.result?.[0]; const q = d?.indicators?.quote?.[0];
    if (!d?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < d.timestamp.length; i++) if (q.open[i] != null && q.close[i] != null && q.high[i] != null && q.low[i] != null)
      b.push({ t: d.timestamp[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
    return b.length > 60 ? b : null; } catch { return null; } }

// Genera los trades de WeeklySwing con su camino (barras entryIdx..exitIdx) — misma lógica que el scanner.
function weeklyTrades(bars) {
  const td = computeTDSetup(bars), cd = computeTDCountdown(bars, td);
  const out = []; let i = 0;
  while (i < bars.length - 1) {
    if (td.bullSetup[i] !== 9 || !td.bullSetupBars[i]) { i++; continue; }
    const stop = Math.min(...td.bullSetupBars[i].map(k => bars[k].l));
    const entryPx = bars[i + 1].o * (1 + COST);
    const risk = entryPx - stop;
    if (risk <= 0 || risk / entryPx > MAX_STOP || risk / entryPx < MIN_STOP) { i++; continue; }
    const ei = i + 1;                                  // entra en la apertura de la semana siguiente
    // recorrer hasta la salida natural
    let xi = null, reason = null;
    for (let j = ei; j < bars.length; j++) {
      if (bars[j].l <= stop) { xi = j; reason = 'STOP'; break; }
      if (cd.bearCountdown[j] === 13) { xi = j; reason = '13'; break; }
      if (j - ei >= TIME_STOP_W) { xi = j; reason = 'TIME'; break; }
    }
    if (xi == null) { xi = bars.length - 1; reason = 'END'; }
    out.push({ path: bars.slice(ei, xi + 1), entryPx, stop, reason });
    i = xi + 1;                                        // sin solapar (una posición por ticker a la vez)
  }
  return out;
}

// Salida alternativa sobre el mismo camino.
function simExit(tr, rule) {
  const e = tr.entryPx, p = tr.path;
  if (rule.type === 'natural') return pct(p[p.length - 1].c, e) - COST * 100;   // 13/time/stop tal cual
  let peak = p[0].h;
  for (let k = 1; k < p.length; k++) { const b = p[k];
    if (rule.type === 'target' && b.h >= e * (1 + rule.pct / 100)) return rule.pct - COST * 100;
    peak = Math.max(peak, b.h);
    if (rule.type === 'trail' && b.l <= peak * (1 - rule.pct / 100)) return pct(peak * (1 - rule.pct / 100), e) - COST * 100;
  }
  return pct(p[p.length - 1].c, e) - COST * 100;
}

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  const tickers = (uni.universe || uni).slice(0, SAMPLE).map(u => u.ticker);
  console.log(`\n══ MAE/MFE — WeeklySwing (Setup-9 → countdown-13) · ${tickers.length}t · 10y ══\n`);
  const trades = []; let done = 0;
  for (const tk of tickers) { const b = await getW(tk); done++;
    if (done % 50 === 0) process.stdout.write(`  …${done}/${tickers.length}\n`);
    await sleep(110); if (!b) continue;
    for (const t of weeklyTrades(b)) trades.push(t); }

  const rows = trades.map(t => { const e = t.entryPx, p = t.path;
    return { mfe: Math.max(...p.map(x => pct(x.h, e))), mae: Math.min(...p.map(x => pct(x.l, e))),
      fin: pct(p[p.length - 1].c, e) - COST * 100, weeks: p.length - 1, reason: t.reason }; });
  const n = rows.length;
  console.log(`  ${n} trades\n`);
  console.log(`  PERFIL POR TRADE (salida actual = 13/time/stop):`);
  console.log(`    MFE mediana ${med(rows.map(r => r.mfe)).toFixed(1)}%  ·  media ${(rows.reduce((a, r) => a + r.mfe, 0) / n).toFixed(1)}%`);
  console.log(`    MAE mediana ${med(rows.map(r => r.mae)).toFixed(1)}%  ·  peor ${Math.min(...rows.map(r => r.mae)).toFixed(1)}%`);
  console.log(`    final mediana ${med(rows.map(r => r.fin)).toFixed(1)}%  ·  media ${(rows.reduce((a, r) => a + r.fin, 0) / n).toFixed(1)}%`);
  console.log(`    giveback (pico→salida) mediana ${med(rows.map(r => r.mfe - r.fin)).toFixed(1)}%  ·  duración mediana ${med(rows.map(r => r.weeks)).toFixed(0)}sem`);
  const byR = {}; rows.forEach(r => byR[r.reason] = (byR[r.reason] || 0) + 1);
  console.log(`    motivo de salida: ` + Object.entries(byR).map(([k, v]) => `${k} ${(100 * v / n).toFixed(0)}%`).join(' · '));

  const st = arr => { const s = arr.reduce((a, b) => a + b, 0), w = arr.filter(x => x > 0), l = arr.filter(x => x <= 0), gl = l.reduce((a, b) => a + b, 0);
    return { m: s / arr.length, wr: 100 * w.length / arr.length, pf: gl ? Math.abs(w.reduce((a, b) => a + b, 0) / gl) : 0, sum: s }; };
  const rules = [{ name: 'actual (13/time/stop)', rule: { type: 'natural' } },
    ...[20, 30, 40].map(p => ({ name: `trailing ${p}%`, rule: { type: 'trail', pct: p } })),
    ...[25, 50, 80].map(p => ({ name: `toma fija +${p}%`, rule: { type: 'target', pct: p } }))];
  console.log(`\n  COMPARA SALIDAS:`);
  console.log(`  ${'salida'.padEnd(22)}${'%/tr'.padStart(8)}${'WR'.padStart(6)}${'PF'.padStart(7)}${'Σret%'.padStart(10)}`);
  console.log('  ' + '─'.repeat(52));
  for (const r of rules) { const s = st(trades.map(t => simExit(t, r.rule)));
    console.log('  ' + r.name.padEnd(22) + (('+' + s.m.toFixed(2))).padStart(8) + (s.wr.toFixed(0) + '%').padStart(6) + s.pf.toFixed(2).padStart(7) + (('+' + s.sum.toFixed(0))).padStart(10)); }
  console.log('');
})();
