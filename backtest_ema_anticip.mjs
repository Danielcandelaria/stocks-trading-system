#!/usr/bin/env node
// backtest_ema_anticip.mjs — ¿la ANTICIPACIÓN (metodología del radar) mejora de verdad?
//   Prueba una entrada CAUSAL (sin previsión): entrar cuando el hueco EMA8-EMA21 se
//   estrecha por debajo de un umbral Y converge hacia el cruce (idéntico al radar).
//   Compara contra la entrada CONFIRMADA (cruce cerrado). Salida común: cruce contrario.
//   Realista: incluye los falsos (anticipas y el cruce no llega → mal trade). Solo LONG.
// READ-ONLY (Yahoo 10y semanal).

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const COST = 0.0006, FAST = 8, SLOW = 21, SAMPLE = +(process.argv[2] || 250);
const sleep = ms => new Promise(r => setTimeout(r, ms));
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const ROOT = dirname(fileURLToPath(import.meta.url));
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map((c, i) => { e = e === null ? c : c * k + e * (1 - k); return i >= p - 1 ? e : null; }); };

async function getW(t) { const y = t.replace('.', '-');
  try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`, { headers: UA });
    if (!r.ok) return null; const d = (await r.json()).chart?.result?.[0]; const q = d?.indicators?.quote?.[0];
    if (!d?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < d.timestamp.length; i++) if (q.close[i] != null) b.push({ t: d.timestamp[i], c: q.close[i] });
    return b.length > 40 ? b : null; } catch { return null; } }

// LONG confirmado: entra en el cruce alcista, sale en el cruce bajista.
function longConfirmed(cl, ef, es) {
  const out = []; let inPos = false, ei = 0;
  for (let i = SLOW + 1; i < cl.length; i++) { if (ef[i - 1] == null) continue;
    const bull = ef[i - 1] <= es[i - 1] && ef[i] > es[i], bear = ef[i - 1] >= es[i - 1] && ef[i] < es[i];
    if (!inPos && bull) { inPos = true; ei = i; }
    else if (inPos && bear) { out.push({ ret: (cl[i] / cl[ei] - 1) * 100 - COST * 200, wk: i - ei }); inPos = false; } }
  return out;
}
// LONG anticipado: entra cuando |gap|<TH y converge hacia arriba (EMA8 sube hacia EMA21),
//   sale en el cruce bajista confirmado. Incluye los falsos (nunca cruzó al alza).
function longAnticip(cl, ef, es, TH) {
  const out = []; let inPos = false, ei = 0;
  for (let i = SLOW + 1; i < cl.length; i++) { if (ef[i - 1] == null) continue;
    const gap = (ef[i] - es[i]) / cl[i], gapPrev = (ef[i - 1] - es[i - 1]) / cl[i - 1];
    const bear = ef[i - 1] >= es[i - 1] && ef[i] < es[i];
    const longImm = gap < 0 && Math.abs(gap) < TH && gap > gapPrev;   // radar LONG
    if (!inPos && longImm) { inPos = true; ei = i; }
    else if (inPos && bear) { out.push({ ret: (cl[i] / cl[ei] - 1) * 100 - COST * 200, wk: i - ei }); inPos = false; } }
  return out;
}

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  const tickers = (uni.universe || uni).slice(0, SAMPLE).map(u => u.ticker);
  const conf = [], anti = { 0.5: [], 0.8: [], 1.2: [] }; let done = 0;
  for (const tk of tickers) { const b = await getW(tk); done++;
    if (done % 50 === 0) process.stdout.write(`  …${done}/${tickers.length}\n`);
    await sleep(110); if (!b) continue;
    const cl = b.map(x => x.c), ef = ema(cl, FAST), es = ema(cl, SLOW);
    for (const t of longConfirmed(cl, ef, es)) conf.push(t);
    for (const th of [0.5, 0.8, 1.2]) for (const t of longAnticip(cl, ef, es, th / 100)) anti[th].push(t); }

  const st = a => { const r = a.map(x => x.ret), s = r.reduce((x, y) => x + y, 0), w = r.filter(x => x > 0), l = r.filter(x => x <= 0), gl = l.reduce((x, y) => x + y, 0);
    return { n: a.length, sum: s, m: s / a.length, wr: 100 * w.length / a.length, pf: gl ? Math.abs(w.reduce((x, y) => x + y, 0) / gl) : 0, wk: a.reduce((x, y) => x + y.wk, 0) / a.length }; };
  const row = (name, s) => '  ' + name.padEnd(22) + String(s.n).padStart(6) + (('+' + s.m.toFixed(2))).padStart(8)
    + (s.wr.toFixed(0) + '%').padStart(6) + s.pf.toFixed(2).padStart(7) + (('+' + s.sum.toFixed(0))).padStart(10) + (s.wk.toFixed(0) + 'w').padStart(7);
  console.log(`\n══ ANTICIPACIÓN (radar) vs CONFIRMACIÓN — LONG EMA 8/21 semanal · ${tickers.length}t ══\n`);
  console.log('  ' + 'entrada'.padEnd(22) + 'n'.padStart(6) + '%/tr'.padStart(8) + 'WR'.padStart(6) + 'PF'.padStart(7) + 'Σret%'.padStart(10) + 'dur'.padStart(7));
  console.log('  ' + '─'.repeat(66));
  console.log(row('confirmado (cruce)', st(conf)));
  for (const th of [0.5, 0.8, 1.2]) console.log(row(`anticipado gap<${th}%`, st(anti[th])));
  console.log(`\n  Si anticipar sube PF y Σret NETO de falsos → la metodología del radar aporta.\n`);
})();
