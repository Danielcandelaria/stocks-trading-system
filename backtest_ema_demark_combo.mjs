#!/usr/bin/env node
// backtest_ema_demark_combo.mjs — ¿combinar DeMark 9-13 con EMACross mejora?
//   Ataca las 2 debilidades de EMACross: entrada tardía (Setup-9 entra antes en el suelo)
//   y salida tardía (Countdown-13 sale antes en el techo). Long-only, stop -18%, large-caps 10y.
//   Variantes:
//     BASE      : entrada cruce↑, salida cruce↓ (EMACross puro)
//     D9-ENTRY  : entrada DeMark Setup-9 (suelo), salida cruce↓
//     D13-EXIT  : entrada cruce↑, salida Countdown-13 (techo) O cruce↓ (lo 1º)
//     D9+D13    : entrada Setup-9, salida Countdown-13 O cruce↓  (= tipo WeeklySwing)
//     CONFLUENC : entrada cruce↑ SOLO si hubo Setup-9 en las últimas 8 velas, salida cruce↓
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup, computeTDCountdown } from '../scanner/demark_calc.mjs';
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const COST = 0.0006, FAST = 8, SLOW = 21, CAT = 0.18, SAMPLE = +(process.argv[2] || 250);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ROOT = dirname(fileURLToPath(import.meta.url));
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map(c => { e = e === null ? c : c * k + e * (1 - k); return e; }); };

async function getW(t) { const y = t.replace('.', '-');
  try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`, { headers: UA });
    if (!r.ok) return null; const d = (await r.json()).chart?.result?.[0]; const q = d?.indicators?.quote?.[0];
    if (!d?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < d.timestamp.length; i++) if (q.close[i] != null && q.high[i] != null && q.low[i] != null) b.push({ t: d.timestamp[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
    return b.length > 60 ? b : null; } catch { return null; } }

function tradesGen(bars, ef, es, entryFn, exitFn) {
  const cl = bars.map(b => b.c), out = []; let inPos = false, ei = 0, stop = 0;
  for (let i = SLOW + 1; i < bars.length; i++) {
    if (!inPos && entryFn(i)) { inPos = true; ei = i; stop = cl[i] * (1 - CAT); continue; }
    if (inPos) {
      if (bars[i].l <= stop) { out.push({ ret: (stop / cl[ei] - 1) * 100 - COST * 200, t: bars[ei].t, wk: i - ei }); inPos = false; }
      else if (exitFn(i)) { out.push({ ret: (cl[i] / cl[ei] - 1) * 100 - COST * 200, t: bars[ei].t, wk: i - ei }); inPos = false; }
    }
  }
  return out;
}
function stat(rs) { const n = rs.length; if (!n) return { n: 0, mean: 0, pf: 0, wr: 0, sum: 0, wk: 0 };
  const s = rs.reduce((a, b) => a + b.ret, 0), w = rs.filter(x => x.ret > 0), l = rs.filter(x => x.ret <= 0), gl = l.reduce((a, b) => a + b.ret, 0);
  return { n, sum: s, mean: s / n, wr: 100 * w.length / n, pf: gl ? Math.abs(w.reduce((a, b) => a + b.ret, 0) / gl) : 0, wk: rs.reduce((a, b) => a + b.wk, 0) / n }; }

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8')).universe.slice(0, SAMPLE).map(u => u.ticker);
  const V = { BASE: [], D9E: [], D13X: [], D9D13: [], CONF: [] }; let done = 0;
  for (const tk of uni) { const b = await getW(tk); done++; if (done % 50 === 0) process.stdout.write(`  …${done}\n`); await sleep(100); if (!b) continue;
    const cl = b.map(x => x.c), ef = ema(cl, FAST), es = ema(cl, SLOW);
    const td = computeTDSetup(b), cd = computeTDCountdown(b, td);
    const bull = i => ef[i - 1] <= es[i - 1] && ef[i] > es[i];
    const bear = i => ef[i - 1] >= es[i - 1] && ef[i] < es[i];
    const d9 = i => td.bullSetup[i] === 9;
    const d13 = i => cd.bearCountdown[i] === 13;
    const recentD9 = i => { for (let k = Math.max(0, i - 8); k <= i; k++) if (td.bullSetup[k] === 9) return true; return false; };
    for (const t of tradesGen(b, ef, es, bull, bear)) V.BASE.push(t);
    for (const t of tradesGen(b, ef, es, d9, bear)) V.D9E.push(t);
    for (const t of tradesGen(b, ef, es, bull, i => d13(i) || bear(i))) V.D13X.push(t);
    for (const t of tradesGen(b, ef, es, d9, i => d13(i) || bear(i))) V.D9D13.push(t);
    for (const t of tradesGen(b, ef, es, i => bull(i) && recentD9(i), bear)) V.CONF.push(t);
  }
  const allT = [].concat(...Object.values(V));
  const tmin = Math.min(...allT.map(t => t.t)), span = (Math.max(...allT.map(t => t.t)) - tmin) / 4;
  const wfOf = arr => [0, 1, 2, 3].map(wi => stat(arr.filter(t => Math.min(3, Math.floor((t.t - tmin) / span)) === wi))).filter(w => w.n >= 5 && w.mean > 0).length;
  console.log(`\n══ EMACross + DeMark 9-13 — combinaciones · ${uni.length} large-caps 10y ══\n`);
  console.log('  ' + 'variante'.padEnd(28) + 'n'.padStart(6) + 'WR'.padStart(6) + 'PF'.padStart(7) + 'exp%'.padStart(8) + 'Σret%'.padStart(10) + 'durMed'.padStart(8) + '  WF');
  console.log('  ' + '─'.repeat(78));
  const names = { BASE: 'BASE (EMACross puro)', D9E: 'D9-ENTRY (setup-9 → cruce↓)', D13X: 'D13-EXIT (cruce↑ → cd-13)', D9D13: 'D9+D13 (setup-9 → cd-13)', CONF: 'CONFLUENCIA (cruce+D9<8v)' };
  for (const k of ['BASE', 'D9E', 'D13X', 'D9D13', 'CONF']) { const s = stat(V[k]);
    console.log('  ' + names[k].padEnd(28) + String(s.n).padStart(6) + (s.wr.toFixed(0) + '%').padStart(6) + s.pf.toFixed(2).padStart(7) + (('+' + s.mean.toFixed(2))).padStart(8) + ((s.sum >= 0 ? '+' : '') + s.sum.toFixed(0)).padStart(10) + ((s.wk.toFixed(0) + 'sem')).padStart(8) + `   ${wfOf(V[k])}/4`); }
  console.log(`\n  ¿Alguna combinación bate a BASE en PF/exp SIN romper WF? → ahí mejora DeMark.\n`);
})();
