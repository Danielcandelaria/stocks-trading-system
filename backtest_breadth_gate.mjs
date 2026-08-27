#!/usr/bin/env node
// backtest_breadth_gate.mjs — ¿Sirve un INTERRUPTOR de exposición por AMPLITUD de mercado?
//   Pregunta: ¿el sistema EMACross (modo anticipado) rinde PEOR cuando entra en semanas de
//   mercado "roto" (poca amplitud = pocas acciones sobre su EMA200)? Si SÍ y de forma estable
//   en ambas mitades → un gate que reduzca exposición en baja amplitud está justificado.
//   Si NO → es el filtro SPY ya REFUTADO otra vez; no añadir.
//
//   Amplitud[semana] = % de tickers del universo con cierre > su EMA200 (semanal).
//   Cada trade se etiqueta con la amplitud de su semana de entrada → se parte en terciles
//   (BAJA/MEDIA/ALTA) y se comparan PF, mediana, expectancy, WR. Desglose por 2 mitades.
//   READ-ONLY (Yahoo 10y semanal). Uso: node backtest_breadth_gate.mjs [sample]

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const COST = 0.0006, FAST = 8, SLOW = 21, CAT = 0.18, GAPTH = 0.012, TREND = 200;
const SPLIT_YEAR = 2021, SAMPLE = +(process.argv[2] || 200), CONC = 10;
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const ROOT = dirname(fileURLToPath(import.meta.url));
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map(c => { e = e === null ? c : c * k + e * (1 - k); return e; }); };
const med = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const yearOf = t => new Date(t * 1000).getUTCFullYear();

async function getW(t) { const y = t.replace('.', '-');
  try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`, { headers: UA });
    if (!r.ok) return null; const d = (await r.json()).chart?.result?.[0]; const q = d?.indicators?.quote?.[0];
    if (!d?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < d.timestamp.length; i++) if (q.close[i] != null && q.high[i] != null && q.low[i] != null)
      b.push({ t: d.timestamp[i], h: q.high[i], l: q.low[i], c: q.close[i] });
    return b.length > 220 ? b : null; } catch { return null; } }

function stat(rs) { const n = rs.length; if (!n) return { n: 0, pf: 0, wr: 0, mean: 0, med: 0, sum: 0 };
  const s = rs.reduce((a, b) => a + b, 0), w = rs.filter(x => x > 0), l = rs.filter(x => x <= 0);
  const gw = w.reduce((a, b) => a + b, 0), gl = l.reduce((a, b) => a + b, 0);
  return { n, sum: s, mean: s / n, med: med(rs), wr: 100 * w.length / n, pf: gl ? Math.abs(gw / gl) : 999 }; }

async function mapLimit(items, n, fn) { const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out; }

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  const list = (uni.universe || uni).map(u => u.ticker).slice(0, SAMPLE);
  console.log(`\n════ ¿INTERRUPTOR POR AMPLITUD DE MERCADO? — EMACross anticipado ════`);
  console.log(`  ${list.length} acciones · 10y semanal · amplitud = % universo sobre EMA200\n`);
  const bars = (await mapLimit(list, CONC, getW)).filter(Boolean);
  console.log(`  datos OK: ${bars.length} tickers\n`);

  // ── Serie de AMPLITUD por timestamp: fracción de tickers con close>EMA200 esa semana ──
  const above = new Map();   // t -> {up, tot}
  for (const b of bars) {
    const cl = b.map(x => x.c), e200 = ema(cl, TREND);
    for (let i = TREND; i < b.length; i++) {
      const rec = above.get(b[i].t) || { up: 0, tot: 0 };
      rec.tot++; if (cl[i] > e200[i]) rec.up++;
      above.set(b[i].t, rec);
    }
  }
  const breadthAt = t => { const r = above.get(t); return r && r.tot >= 20 ? r.up / r.tot : null; };

  // ── Trades (modo anticipado, el que se opera), etiquetados con amplitud de entrada ──
  const all = [];
  for (const b of bars) {
    const cl = b.map(x => x.c), ef = ema(cl, FAST), es = ema(cl, SLOW);
    let inPos = false, ei = 0, stop = 0;
    for (let i = SLOW + 1; i < b.length; i++) {
      const gap = (ef[i] - es[i]) / cl[i], gapPrev = (ef[i - 1] - es[i - 1]) / cl[i - 1];
      const longImm = gap < 0 && Math.abs(gap) < GAPTH && gap > gapPrev;
      if (!inPos && longImm) { inPos = true; ei = i; stop = cl[i] * (1 - CAT); continue; }
      if (inPos) {
        const bear = gapPrev >= 0 && gap < 0;
        if (b[i].l <= stop) { all.push({ ret: (stop / cl[ei] - 1) * 100 - COST * 200, t: b[ei].t, br: breadthAt(b[ei].t) }); inPos = false; }
        else if (bear) { all.push({ ret: (cl[i] / cl[ei] - 1) * 100 - COST * 200, t: b[ei].t, br: breadthAt(b[ei].t) }); inPos = false; }
      }
    }
  }
  const tagged = all.filter(t => t.br != null);
  console.log(`  trades con amplitud conocida: ${tagged.length} / ${all.length}\n`);

  // ── Terciles de amplitud ──
  const brs = tagged.map(t => t.br).sort((a, b) => a - b);
  const q1 = brs[Math.floor(brs.length / 3)], q2 = brs[Math.floor(2 * brs.length / 3)];
  const band = t => t.br <= q1 ? 'BAJA' : t.br <= q2 ? 'MEDIA' : 'ALTA';
  console.log(`  Cortes de amplitud: BAJA ≤${(q1 * 100).toFixed(0)}% · MEDIA ≤${(q2 * 100).toFixed(0)}% · ALTA >${(q2 * 100).toFixed(0)}%\n`);

  const show = (label, arr) => {
    const s = stat(arr.map(t => t.ret));
    const h1 = stat(arr.filter(t => yearOf(t.t) < SPLIT_YEAR).map(t => t.ret));
    const h2 = stat(arr.filter(t => yearOf(t.t) >= SPLIT_YEAR).map(t => t.ret));
    console.log(`  ${label.padEnd(6)} n=${String(s.n).padStart(4)}  PF ${s.pf.toFixed(2)}  WR ${s.wr.toFixed(0)}%  exp ${(s.mean >= 0 ? '+' : '') + s.mean.toFixed(2)}%  med ${(s.med >= 0 ? '+' : '') + s.med.toFixed(2)}%  |  PF mitades ${h1.pf.toFixed(2)}/${h2.pf.toFixed(2)}  exp ${(h1.mean >= 0 ? '+' : '') + h1.mean.toFixed(1)}/${(h2.mean >= 0 ? '+' : '') + h2.mean.toFixed(1)}`);
  };
  console.log('  ── Rendimiento por RÉGIMEN DE AMPLITUD en la entrada ──');
  for (const g of ['BAJA', 'MEDIA', 'ALTA']) show(g, tagged.filter(t => band(t) === g));
  console.log('');
  show('TODOS', tagged);
  console.log('\n  VEREDICTO: si BAJA amplitud rinde CLARAMENTE peor (PF y exp) en AMBAS mitades →');
  console.log('  el interruptor ayuda (reducir exposición en baja amplitud). Si es igual o mejor →');
  console.log('  es el filtro SPY ya refutado; NO añadir gate.\n');
})();
