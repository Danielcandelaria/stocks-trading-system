#!/usr/bin/env node
// backtest_ema_regime.mjs — ¿un filtro de RÉGIMEN de mercado mejora EMACross?
//   Régimen = SPY vs su EMA 40 semanas: BULL (SPY>EMA40) / BEAR (SPY<EMA40).
//   Genera cruces EMA 8/21 en AMBAS direcciones (long+short, reversión, stop ±18%),
//   etiqueta cada trade con el régimen a la ENTRADA, y compara:
//     A) Long-only TODO (actual)   B) Long-only en BULL   C) Short-only en BEAR
//     D) Régimen-switch (long en bull + short en bear)     + longs en bear / shorts en bull (control)
//   Si C (shorts en bear) da PF>1 y D bate a A → el filtro cubre el giro del mercado.
// READ-ONLY (Yahoo 10y semanal).

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const COST = 0.0006, FAST = 8, SLOW = 21, CAT = 0.18, SPYLEN = 40;
const SAMPLE = +(process.argv[2] || 250);
const sleep = ms => new Promise(r => setTimeout(r, ms));
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const ROOT = dirname(fileURLToPath(import.meta.url));
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map(c => { e = e === null ? c : c * k + e * (1 - k); return e; }); };

async function getW(t) { const y = t.replace('.', '-');
  try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`, { headers: UA });
    if (!r.ok) return null; const d = (await r.json()).chart?.result?.[0]; const q = d?.indicators?.quote?.[0];
    if (!d?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < d.timestamp.length; i++) if (q.close[i] != null && q.high[i] != null && q.low[i] != null)
      b.push({ t: d.timestamp[i], h: q.high[i], l: q.low[i], c: q.close[i] });
    return b.length > 60 ? b : null; } catch { return null; } }

// Trades EMA 8/21 en ambas direcciones (reversión), stop catástrofe ±18%.
function tradesBoth(bars, regimeAt) {
  const cl = bars.map(b => b.c), ef = ema(cl, FAST), es = ema(cl, SLOW), out = [];
  let pos = 0, ei = 0, stop = 0;
  for (let i = SLOW + 1; i < bars.length; i++) {
    const bull = ef[i - 1] <= es[i - 1] && ef[i] > es[i];
    const bear = ef[i - 1] >= es[i - 1] && ef[i] < es[i];
    if (pos === 1) {
      if (bars[i].l <= stop) { out.push({ dir: 'L', ret: (stop / cl[ei] - 1) * 100 - COST * 200, t: bars[ei].t, reg: regimeAt(bars[ei].t) }); pos = 0; }
      else if (bear) { out.push({ dir: 'L', ret: (cl[i] / cl[ei] - 1) * 100 - COST * 200, t: bars[ei].t, reg: regimeAt(bars[ei].t) }); pos = 0; }
    } else if (pos === -1) {
      if (bars[i].h >= stop) { out.push({ dir: 'S', ret: (cl[ei] / stop - 1) * 100 - COST * 200, t: bars[ei].t, reg: regimeAt(bars[ei].t) }); pos = 0; }
      else if (bull) { out.push({ dir: 'S', ret: (cl[ei] / cl[i] - 1) * 100 - COST * 200, t: bars[ei].t, reg: regimeAt(bars[ei].t) }); pos = 0; }
    }
    if (pos === 0) {
      if (bull) { pos = 1; ei = i; stop = cl[i] * (1 - CAT); }
      else if (bear) { pos = -1; ei = i; stop = cl[i] * (1 + CAT); }
    }
  }
  return out;
}

function stat(rs) { const n = rs.length; if (!n) return { n: 0, mean: 0, pf: 0, wr: 0, sum: 0 };
  const s = rs.reduce((a, b) => a + b, 0), w = rs.filter(x => x > 0), l = rs.filter(x => x <= 0), gl = l.reduce((a, b) => a + b, 0);
  return { n, sum: s, mean: s / n, wr: 100 * w.length / n, pf: gl ? Math.abs(w.reduce((a, b) => a + b, 0) / gl) : 0 }; }

(async () => {
  // 1) SPY → régimen por semana
  const spy = await getW('SPY');
  const sc = spy.map(b => b.c), se = ema(sc, SPYLEN);
  const regArr = spy.map((b, i) => ({ t: b.t, bull: b.c > se[i] }));
  const regimeAt = t => { let lo = 0, hi = regArr.length - 1, ans = regArr[0]; while (lo <= hi) { const m = (lo + hi) >> 1; if (regArr[m].t <= t) { ans = regArr[m]; lo = m + 1; } else hi = m - 1; } return ans.bull ? 'bull' : 'bear'; };
  const bullWeeks = regArr.filter(r => r.bull).length;
  console.log(`\n══ FILTRO DE RÉGIMEN (SPY vs EMA${SPYLEN}s) — EMACross long+short ══`);
  console.log(`  SPY: ${regArr.length} semanas · ${(100 * bullWeeks / regArr.length).toFixed(0)}% BULL / ${(100 * (1 - bullWeeks / regArr.length)).toFixed(0)}% BEAR\n`);

  // 2) trades de todo el universo
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  const tickers = (uni.universe || uni).slice(0, SAMPLE).map(u => u.ticker);
  const all = []; let done = 0;
  for (const tk of tickers) { const b = await getW(tk); done++;
    if (done % 50 === 0) process.stdout.write(`  …${done}/${tickers.length}\n`);
    await sleep(110); if (!b) continue; for (const t of tradesBoth(b, regimeAt)) all.push(t); }

  const tmin = Math.min(...all.map(t => t.t)), tmax = Math.max(...all.map(t => t.t)), span = (tmax - tmin) / 4;
  const wfOf = arr => { const wf = [0, 1, 2, 3].map(wi => stat(arr.filter(t => Math.min(3, Math.floor((t.t - tmin) / span)) === wi).map(t => t.ret))); return wf.filter(w => w.n >= 5 && w.mean > 0).length; };
  const row = (name, arr) => { const s = stat(arr.map(t => t.ret));
    console.log('  ' + name.padEnd(30) + String(s.n).padStart(6) + (s.wr.toFixed(0) + '%').padStart(6) + s.pf.toFixed(2).padStart(7) + ((s.mean >= 0 ? '+' : '') + s.mean.toFixed(2)).padStart(9) + ((s.sum >= 0 ? '+' : '') + s.sum.toFixed(0)).padStart(10) + `   ${wfOf(arr)}/4`); };

  console.log('  ' + 'estrategia'.padEnd(30) + 'n'.padStart(6) + 'WR'.padStart(6) + 'PF'.padStart(7) + 'exp%'.padStart(9) + 'Σret%'.padStart(10) + '  WF');
  console.log('  ' + '─'.repeat(76));
  const L = all.filter(t => t.dir === 'L'), S = all.filter(t => t.dir === 'S');
  row('A) LONG-only TODO (actual)', L);
  row('B) LONG-only en BULL', L.filter(t => t.reg === 'bull'));
  row('   LONG en BEAR (control)', L.filter(t => t.reg === 'bear'));
  row('C) SHORT-only en BEAR', S.filter(t => t.reg === 'bear'));
  row('   SHORT en BULL (control)', S.filter(t => t.reg === 'bull'));
  row('D) RÉGIMEN-SWITCH (Lbull+Sbear)', [...L.filter(t => t.reg === 'bull'), ...S.filter(t => t.reg === 'bear')]);
  console.log(`\n  Clave: si C (shorts en bear) PF>1 y D ≥ A → el régimen añade valor y cubre el giro.\n`);
})();
