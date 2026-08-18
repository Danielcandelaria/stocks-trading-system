#!/usr/bin/env node
// backtest_ema200_filter.mjs — ¿mejora EMACross si SOLO entramos con precio > EMA200 semanal?
//   Hipótesis: filtrar por tendencia mayor (close>EMA200w) evita comprar cruces en pleno
//   mercado bajista. Compara, en Confirmado y Anticipado:
//     · SIN filtro (sistema actual)
//     · close > EMA200w en la entrada
//     · EMA8 > EMA200w (más estricto: la propia rápida sobre la 200)
//   Métricas: trades, WR, PF, expectancy, Σret, %filtrado, walk-forward 4v.  READ-ONLY (Yahoo 10y).
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const COST = 0.0006, FAST = 8, SLOW = 21, LONGL = 200, CAT = 0.18, GAPTH = 0.012;
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
    return b.length > 220 ? b : null; } catch { return null; } }

// filt: null=sin filtro | 'close'=close>ema200 | 'fast'=ema8>ema200. Devuelve {trades, skipped}
function trades(bars, mode, filt) {
  const cl = bars.map(b => b.c), ef = ema(cl, FAST), es = ema(cl, SLOW), el = ema(cl, LONGL), out = [];
  let inPos = false, ei = 0, stop = 0, skipped = 0;
  for (let i = LONGL + 1; i < bars.length; i++) {
    const gap = (ef[i] - es[i]) / cl[i], gapPrev = (ef[i - 1] - es[i - 1]) / cl[i - 1];
    const bull = ef[i - 1] <= es[i - 1] && ef[i] > es[i];
    const longImm = gap < 0 && Math.abs(gap) < GAPTH && gap > gapPrev;
    const bear = ef[i - 1] >= es[i - 1] && ef[i] < es[i];
    const signal = mode === 'anticip' ? (!inPos && longImm) : (!inPos && bull);
    if (signal) {
      const pass = filt === null ? true : filt === 'close' ? cl[i] > el[i] : ef[i] > el[i];
      if (!pass) { skipped++; continue; }
      inPos = true; ei = i; stop = cl[i] * (1 - CAT); continue;
    }
    if (inPos) {
      if (bars[i].l <= stop) { out.push({ ret: (stop / cl[ei] - 1) * 100 - COST * 200, t: bars[ei].t }); inPos = false; }
      else if (bear) { out.push({ ret: (cl[i] / cl[ei] - 1) * 100 - COST * 200, t: bars[ei].t }); inPos = false; }
    }
  }
  return { out, skipped };
}

function stat(rs) { const n = rs.length; if (!n) return { n: 0, sum: 0, mean: 0, wr: 0, pf: 0 };
  const s = rs.reduce((a, b) => a + b, 0), w = rs.filter(x => x > 0), l = rs.filter(x => x <= 0);
  const gw = w.reduce((a, b) => a + b, 0), gl = l.reduce((a, b) => a + b, 0);
  return { n, sum: s, mean: s / n, wr: 100 * w.length / n, pf: gl ? Math.abs(gw / gl) : 0 }; }

function wf4(T) { if (!T.length) return '—';
  const tmin = Math.min(...T.map(t => t.t)), tmax = Math.max(...T.map(t => t.t)), span = (tmax - tmin) / 4;
  const w = [0, 1, 2, 3].map(wi => stat(T.filter(t => Math.min(3, Math.floor((t.t - tmin) / span)) === wi).map(t => t.ret)));
  const pos = w.filter(x => x.n >= 5 && x.mean > 0).length;
  return w.map((x, i) => `V${i + 1} ${x.n ? (x.mean >= 0 ? '+' : '') + x.mean.toFixed(1) : '—'}`).join(' ') + ` → ${pos}/4`; }

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  const tickers = (uni.universe || uni).slice(0, SAMPLE).map(u => u.ticker);
  console.log(`\n════ FILTRO EMA200 semanal sobre EMACross (LONG, stop -18%, salida cruce) ════`);
  console.log(`  ${tickers.length} acciones · 10 años semanal · coste 0.06%/lado\n`);
  const acc = { confirm: { none: [], close: [], fast: [], skC: 0, skF: 0 },
                anticip: { none: [], close: [], fast: [], skC: 0, skF: 0 } };
  let done = 0, ok = 0;
  for (const tk of tickers) { const b = await getW(tk); done++;
    if (done % 50 === 0) process.stdout.write(`  …${done}/${tickers.length}\n`);
    await sleep(110); if (!b) continue; ok++;
    for (const mode of ['confirm', 'anticip']) {
      acc[mode].none.push(...trades(b, mode, null).out);
      const c = trades(b, mode, 'close'); acc[mode].close.push(...c.out); acc[mode].skC += c.skipped;
      const f = trades(b, mode, 'fast');  acc[mode].fast.push(...f.out);  acc[mode].skF += f.skipped;
    } }
  console.log(`  ${ok} acciones con datos\n`);

  for (const mode of ['confirm', 'anticip']) {
    console.log(`════ MODO ${mode === 'confirm' ? 'CONFIRMADO (cruce)' : 'ANTICIPADO (gap<1.2%)'} ════`);
    const rows = [['SIN filtro (actual)', acc[mode].none, 0], ['close > EMA200', acc[mode].close, acc[mode].skC], ['EMA8 > EMA200', acc[mode].fast, acc[mode].skF]];
    for (const [name, T, sk] of rows) {
      const s = stat(T.map(t => t.ret));
      console.log(`  ${name.padEnd(22)} trades ${String(s.n).padStart(4)} · WR ${s.wr.toFixed(0).padStart(2)}% · PF ${s.pf.toFixed(2)} · exp ${s.mean >= 0 ? '+' : ''}${s.mean.toFixed(2)}%/tr · Σ ${s.sum >= 0 ? '+' : ''}${s.sum.toFixed(0)}%${sk ? ` · vetó ${sk}` : ''}`);
      console.log(`  ${''.padEnd(22)} WF: ${wf4(T)}`);
    }
    console.log('');
  }
  console.log(`  Nota: universo de HOY sobre el pasado (sesgo de supervivencia). Edge RELATIVO, no retorno garantizado.\n`);
})();
