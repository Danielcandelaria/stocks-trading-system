#!/usr/bin/env node
// backtest_anticip_detail.mjs — DETALLE de entrar ANTICIPADO (convergencia) vs CONFIRMADO (cruce).
//   Sistema final: LONG-only, stop -18%, salida cruce contrario. Large-caps 10y.
//   1) Barrido de umbral de anticipación (banda del hueco).
//   2) Para la banda elegida: cuántas semanas ANTES entras, ventaja de precio de entrada,
//      % de FALSOS (anticipas y el cruce nunca llega), y el recorrido EXTRA capturado.
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const COST = 0.0006, FAST = 8, SLOW = 21, CAT = 0.18, SAMPLE = +(process.argv[2] || 250);
const sleep = ms => new Promise(r => setTimeout(r, ms));
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const ROOT = dirname(fileURLToPath(import.meta.url));
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map(c => { e = e === null ? c : c * k + e * (1 - k); return e; }); };
const med = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

async function getW(t) { const y = t.replace('.', '-');
  try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`, { headers: UA });
    if (!r.ok) return null; const d = (await r.json()).chart?.result?.[0]; const q = d?.indicators?.quote?.[0];
    if (!d?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < d.timestamp.length; i++) if (q.close[i] != null && q.high[i] != null && q.low[i] != null) b.push({ t: d.timestamp[i], h: q.high[i], l: q.low[i], c: q.close[i] });
    return b.length > 60 ? b : null; } catch { return null; } }

// Genera trades LONG. mode: 'confirm' (bullcross) | 'anticip' (gap<TH convergiendo).
// Cada trade guarda: ret, entrada, y (si anticip) semanas hasta el bullcross y ventaja de precio.
function trades(bars, mode, TH) {
  const cl = bars.map(b => b.c), ef = ema(cl, FAST), es = ema(cl, SLOW), out = [];
  let inPos = false, ei = 0, stop = 0;
  for (let i = SLOW + 1; i < bars.length; i++) {
    const gap = (ef[i] - es[i]) / cl[i], gapPrev = (ef[i - 1] - es[i - 1]) / cl[i - 1];
    const bull = ef[i - 1] <= es[i - 1] && ef[i] > es[i];
    const bear = ef[i - 1] >= es[i - 1] && ef[i] < es[i];
    const longImm = gap < 0 && Math.abs(gap) < TH && gap > gapPrev;
    const enter = mode === 'anticip' ? (!inPos && longImm) : (!inPos && bull);
    if (enter) { inPos = true; ei = i; stop = cl[i] * (1 - CAT); continue; }
    if (inPos) {
      let ret = null, exitI = null;
      if (bars[i].l <= stop) { ret = (stop / cl[ei] - 1) * 100 - COST * 200; exitI = i; }
      else if (bear) { ret = (cl[i] / cl[ei] - 1) * 100 - COST * 200; exitI = i; }
      if (ret != null) {
        // ¿confirmó el cruce alcista entre la entrada y la salida? (para métricas anticip)
        let confW = null, confPx = null;
        for (let k = ei + 1; k <= exitI; k++) if (ef[k - 1] <= es[k - 1] && ef[k] > es[k]) { confW = k - ei; confPx = cl[k]; break; }
        out.push({ ret, t: bars[ei].t, wk: exitI - ei, entryPx: cl[ei], confW, confPx });
        inPos = false;
      }
    }
  }
  return out;
}
function stat(rs) { const n = rs.length; if (!n) return { n: 0, mean: 0, pf: 0, wr: 0, sum: 0 };
  const s = rs.reduce((a, b) => a + b, 0), w = rs.filter(x => x > 0), l = rs.filter(x => x <= 0), gl = l.reduce((a, b) => a + b, 0);
  return { n, sum: s, mean: s / n, wr: 100 * w.length / n, pf: gl ? Math.abs(w.reduce((a, b) => a + b, 0) / gl) : 0 }; }

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8')).universe.slice(0, SAMPLE).map(u => u.ticker);
  const byMode = { confirm: [], a05: [], a08: [], a12: [], a15: [], a20: [] }; let done = 0;
  for (const tk of uni) { const b = await getW(tk); done++; if (done % 50 === 0) process.stdout.write(`  …${done}\n`); await sleep(100); if (!b) continue;
    for (const t of trades(b, 'confirm')) byMode.confirm.push(t);
    for (const [key, th] of [['a05', .5], ['a08', .8], ['a12', 1.2], ['a15', 1.5], ['a20', 2.0]]) for (const t of trades(b, 'anticip', th / 100)) byMode[key].push(t); }

  const tAll = byMode.confirm.concat(...['a05', 'a08', 'a12', 'a15', 'a20'].map(k => byMode[k]));
  const tmin = Math.min(...tAll.map(t => t.t)), span = (Math.max(...tAll.map(t => t.t)) - tmin) / 4;
  const wfOf = arr => [0, 1, 2, 3].map(wi => stat(arr.filter(t => Math.min(3, Math.floor((t.t - tmin) / span)) === wi).map(t => t.ret))).filter(w => w.n >= 5 && w.mean > 0).length;

  console.log(`\n══ ANTICIPADO vs CONFIRMADO — detalle · ${uni.length} large-caps 10y ══\n`);
  console.log('  1) BARRIDO DE UMBRAL (sistema completo, stop -18%)');
  console.log('  ' + 'entrada'.padEnd(20) + 'n'.padStart(6) + 'WR'.padStart(6) + 'PF'.padStart(7) + 'exp%'.padStart(8) + 'Σret%'.padStart(10) + '  WF');
  console.log('  ' + '─'.repeat(60));
  const rows = [['CONFIRMADO (cruce)', byMode.confirm], ['anticip gap<0.5%', byMode.a05], ['anticip gap<0.8%', byMode.a08], ['anticip gap<1.2%', byMode.a12], ['anticip gap<1.5%', byMode.a15], ['anticip gap<2.0%', byMode.a20]];
  for (const [name, arr] of rows) { const s = stat(arr.map(t => t.ret));
    console.log('  ' + name.padEnd(20) + String(s.n).padStart(6) + (s.wr.toFixed(0) + '%').padStart(6) + s.pf.toFixed(2).padStart(7) + (('+' + s.mean.toFixed(2))).padStart(8) + ((s.sum >= 0 ? '+' : '') + s.sum.toFixed(0)).padStart(10) + `   ${wfOf(arr)}/4`); }

  // 2) detalle de la banda 1.2%
  const A = byMode.a12, conf = byMode.confirm;
  const confirmed = A.filter(t => t.confW != null), falsos = A.filter(t => t.confW == null);
  const wksEarly = confirmed.map(t => t.confW);
  const priceAdv = confirmed.map(t => (t.confPx / t.entryPx - 1) * 100);   // cuánto más barato entras vs el cruce
  console.log(`\n  2) DETALLE de la banda gap<1.2% (${A.length} entradas anticipadas):`);
  console.log(`     · CONFIRMARON el cruce: ${confirmed.length} (${(100 * confirmed.length / A.length).toFixed(0)}%)  ·  FALSOS (nunca cruzó): ${falsos.length} (${(100 * falsos.length / A.length).toFixed(0)}%)`);
  console.log(`     · de los confirmados: entras ${med(wksEarly).toFixed(0)} sem antes (mediana)  ·  a un precio ${med(priceAdv).toFixed(1)}% MÁS BAJO que en el cruce`);
  console.log(`     · retorno medio de los que CONFIRMAN: ${(confirmed.reduce((a, t) => a + t.ret, 0) / confirmed.length).toFixed(2)}%/tr`);
  console.log(`     · retorno medio de los FALSOS: ${falsos.length ? (falsos.reduce((a, t) => a + t.ret, 0) / falsos.length).toFixed(2) : '—'}%/tr  (coste de anticipar de más)`);
  const sA = stat(A.map(t => t.ret)), sC = stat(conf.map(t => t.ret));
  console.log(`\n  3) RECORRIDO capturado (media por trade):`);
  console.log(`     CONFIRMADO ${sC.mean.toFixed(2)}%  →  ANTICIPADO 1.2% ${sA.mean.toFixed(2)}%   (extra ${(sA.mean - sC.mean >= 0 ? '+' : '')}${(sA.mean - sC.mean).toFixed(2)}%/tr)`);
  console.log(`     El extra sale de: entrar antes y más barato en los que confirman, menos el peaje de los falsos.\n`);
})();
