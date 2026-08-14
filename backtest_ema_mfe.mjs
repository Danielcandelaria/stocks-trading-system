#!/usr/bin/env node
// backtest_ema_mfe.mjs — MAE/MFE de los LONG de EMA 8/21 SEMANAL.
//   Entrada: cruce alcista EMA8>EMA21 (cierre semanal).
//   Mide por trade:  MFE (máx a favor, sobre el HIGH)  ·  MAE (máx en contra, sobre el LOW)
//                    final@cruce (salida por cruce contrario)  ·  giveback = MFE - final.
//   Luego COMPARA salidas alternativas para capturar el pico antes de la reversión:
//     · cruce contrario (baseline)   · trailing stop desde el pico a X%   · toma X% fija.
// READ-ONLY (Yahoo semanal 10y). Solo LONG (el short no vale en acciones).

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const COST = 0.0006, SLOW = 21, FAST = 8;
const SAMPLE = +(process.argv[2] || 250);
const sleep = ms => new Promise(r => setTimeout(r, ms));
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const ROOT = dirname(fileURLToPath(import.meta.url));
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map((c, i) => { e = e === null ? c : c * k + e * (1 - k); return i >= p - 1 ? e : null; }); };
const med = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (x, e) => (x / e - 1) * 100;

async function getW(t) { const y = t.replace('.', '-');
  try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`, { headers: UA });
    if (!r.ok) return null; const d = (await r.json()).chart?.result?.[0]; const q = d?.indicators?.quote?.[0];
    if (!d?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < d.timestamp.length; i++) if (q.close[i] != null && q.high[i] != null && q.low[i] != null)
      b.push({ t: d.timestamp[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
    return b.length > 40 ? b : null; } catch { return null; } }

// Extrae los LONG: cada trade con su camino (barras entryIdx..crossIdx).
function longTrades(bars) {
  const cl = bars.map(b => b.c), ef = ema(cl, FAST), es = ema(cl, SLOW);
  const out = []; let inPos = false, ei = 0;
  for (let i = SLOW + 1; i < bars.length; i++) {
    if (ef[i - 1] == null) continue;
    const bull = ef[i - 1] <= es[i - 1] && ef[i] > es[i];
    const bear = ef[i - 1] >= es[i - 1] && ef[i] < es[i];
    if (!inPos && bull) { inPos = true; ei = i; }
    else if (inPos && bear) { out.push({ path: bars.slice(ei, i + 1) }); inPos = false; }
  }
  return out;
}

// Simula UNA salida sobre el camino. Devuelve ret% neto.
//  rule: {type:'cross'} | {type:'trail', pct:X} | {type:'target', pct:X}
function simExit(path, rule) {
  const entry = path[0].c;
  if (rule.type === 'cross') return pct(path[path.length - 1].c, entry) - COST * 200;
  if (rule.type === 'crossStop') {                                   // cruce PERO con stop duro
    for (let k = 1; k < path.length; k++)
      if (path[k].l <= entry * (1 - rule.pct / 100)) return -rule.pct - COST * 200;
    return pct(path[path.length - 1].c, entry) - COST * 200;
  }
  let peak = path[0].h;
  for (let k = 1; k < path.length; k++) {
    const b = path[k];
    if (rule.type === 'target' && b.h >= entry * (1 + rule.pct / 100))
      return rule.pct - COST * 200;                                   // toma fija tocada
    peak = Math.max(peak, b.h);
    if (rule.type === 'trail') {
      const stop = peak * (1 - rule.pct / 100);
      if (b.l <= stop) return pct(stop, entry) - COST * 200;          // trailing tocado
    }
  }
  return pct(path[path.length - 1].c, entry) - COST * 200;            // no tocó → sale al cruce
}

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  const tickers = (uni.universe || uni).slice(0, SAMPLE).map(u => u.ticker);
  console.log(`\n══ MAE/MFE — LONG EMA 8/21 semanal · ${tickers.length} tickers · 10y ══\n`);

  const trades = []; let done = 0;
  for (const tk of tickers) { const b = await getW(tk); done++;
    if (done % 50 === 0) process.stdout.write(`  …${done}/${tickers.length}\n`);
    await sleep(110); if (!b) continue;
    for (const t of longTrades(b)) trades.push(t); }

  // 1) Perfil MAE/MFE con salida por cruce (baseline)
  const rows = trades.map(t => { const p = t.path, e = p[0].c;
    const mfe = Math.max(...p.map(x => pct(x.h, e)));
    const mae = Math.min(...p.map(x => pct(x.l, e)));
    const fin = pct(p[p.length - 1].c, e) - COST * 200;
    return { mfe, mae, fin, giveback: mfe - fin, weeks: p.length - 1 }; });
  const n = rows.length;
  console.log(`  ${n} trades LONG\n`);
  console.log(`  PERFIL POR TRADE (salida = cruce contrario):`);
  console.log(`    MFE  (máx a favor)   mediana ${med(rows.map(r => r.mfe)).toFixed(1)}%   ·  media ${(rows.reduce((a, r) => a + r.mfe, 0) / n).toFixed(1)}%`);
  console.log(`    MAE  (máx en contra) mediana ${med(rows.map(r => r.mae)).toFixed(1)}%   ·  peor  ${Math.min(...rows.map(r => r.mae)).toFixed(1)}%`);
  console.log(`    final@cruce          mediana ${med(rows.map(r => r.fin)).toFixed(1)}%   ·  media ${(rows.reduce((a, r) => a + r.fin, 0) / n).toFixed(1)}%`);
  console.log(`    GIVEBACK (pico→cruce) mediana ${med(rows.map(r => r.giveback)).toFixed(1)}%   ← lo que devuelves esperando el cruce`);
  console.log(`    duración             mediana ${med(rows.map(r => r.weeks)).toFixed(0)} semanas`);
  // MAE de las GANADORAS: hasta cuánto aguantar en contra sin matar un futuro ganador
  const win = rows.filter(r => r.fin > 0);
  console.log(`    MAE de las GANADORAS: mediana ${med(win.map(r => r.mae)).toFixed(1)}%  ·  p90 ${med(win.map(r => r.mae).sort((a,b)=>a-b).slice(0, Math.ceil(win.length*0.1))).toFixed(1)}%  (aguantar más que esto = matar ganadores)`);

  // 2) Comparar salidas
  const stat = arr => { const s = arr.reduce((a, b) => a + b, 0), w = arr.filter(x => x > 0), l = arr.filter(x => x <= 0);
    const gl = l.reduce((a, b) => a + b, 0);
    return { sum: s, m: s / arr.length, wr: 100 * w.length / arr.length, pf: gl ? Math.abs(w.reduce((a, b) => a + b, 0) / gl) : null }; };
  const rules = [ { name: 'cruce contrario', rule: { type: 'cross' } },
    ...[12, 15, 18, 20, 25].map(p => ({ name: `cruce + stop -${p}%`, rule: { type: 'crossStop', pct: p } })),
    ...[15, 20, 30].map(p => ({ name: `trailing ${p}%`, rule: { type: 'trail', pct: p } })),
    ...[25, 40].map(p => ({ name: `toma fija +${p}%`, rule: { type: 'target', pct: p } })) ];
  console.log(`\n  COMPARA SALIDAS (mismo universo de trades):`);
  console.log(`  ${'salida'.padEnd(18)}${'%/tr'.padStart(7)}${'WR'.padStart(6)}${'PF'.padStart(7)}${'Σret%'.padStart(10)}`);
  console.log('  ' + '─'.repeat(48));
  for (const r of rules) { const s = stat(trades.map(t => simExit(t.path, r.rule)));
    console.log('  ' + r.name.padEnd(18) + ((s.m >= 0 ? '+' : '') + s.m.toFixed(2)).padStart(7)
      + (s.wr.toFixed(0) + '%').padStart(6) + (s.pf ? s.pf.toFixed(2) : '—').padStart(7)
      + ((s.sum >= 0 ? '+' : '') + s.sum.toFixed(0)).padStart(10)); }
  console.log('');
})();
