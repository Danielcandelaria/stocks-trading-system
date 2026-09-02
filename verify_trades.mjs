#!/usr/bin/env node
// verify_trades.mjs — Verifica la COHERENCIA de cada operación del export contra los datos:
//   por cada trade del CSV, re-descarga las velas del ticker y comprueba de forma INDEPENDIENTE:
//     (1) el precio de entrada = cierre de la vela en la fecha de entrada (±0.5%);
//     (2) en la entrada EMA8 estaba DEBAJO de EMA21 y convergiendo (anticipación real);
//     (3) la salida coincide: STOP → el mínimo tocó el SL; CRUCE → hubo cruce bajista EMA8<EMA21;
//     (4) el precio de salida cuadra con la vela de salida.
//   Reporta cuántas pasan y lista las que NO cuadran. READ-ONLY (Yahoo 10y). Uso: [csv]

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const FAST = 8, SLOW = 21, CAT = 0.18, GAPTH = 0.012, CONC = 12;
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const ROOT = dirname(fileURLToPath(import.meta.url));
const CSV = process.argv[2] || '/private/tmp/claude-501/-Users-Daniel/ddf60929-5991-4041-9c3c-8b5696e70631/scratchpad/backtest_trades.csv';
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map(c => { e = e === null ? c : c * k + e * (1 - k); return e; }); };
const dstr = t => new Date(t * 1000).toISOString().slice(0, 10);
async function getW(t) { const y = t.replace('.', '-');
  try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`, { headers: UA });
    if (!r.ok) return null; const d = (await r.json()).chart?.result?.[0]; const q = d?.indicators?.quote?.[0];
    if (!d?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < d.timestamp.length; i++) if (q.close[i] != null && q.high[i] != null && q.low[i] != null)
      b.push({ t: d.timestamp[i], h: q.high[i], l: q.low[i], c: q.close[i], d: dstr(d.timestamp[i]) });
    return b; } catch { return null; } }
async function mapLimit(items, n, fn) { const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }

(async () => {
  const lines = readFileSync(CSV, 'utf8').trim().split('\n'); const cols = lines[0].split(',');
  const rows = lines.slice(1).map(l => { const v = l.split(','); return Object.fromEntries(cols.map((c, i) => [c, v[i]])); });
  const byTicker = {}; for (const r of rows) (byTicker[r.ticker] ||= []).push(r);
  const tickers = Object.keys(byTicker);
  process.stderr.write(`Verificando ${rows.length} operaciones en ${tickers.length} acciones...\n`);
  const barsArr = await mapLimit(tickers, CONC, getW);
  const bmap = {}; tickers.forEach((t, i) => bmap[t] = barsArr[i]);

  let ok = 0, fail = 0, noData = 0; const fails = [];
  for (const tk of tickers) {
    const b = bmap[tk]; if (!b) { noData += byTicker[tk].length; continue; }
    const cl = b.map(x => x.c), ef = ema(cl, FAST), es = ema(cl, SLOW);
    const idx = {}; b.forEach((x, i) => idx[x.d] = i);
    for (const r of byTicker[tk]) {
      const ei = idx[r.entryDate], xi = idx[r.exitDate];
      const errs = [];
      if (ei == null) errs.push('sin vela entrada');
      if (xi == null) errs.push('sin vela salida');
      if (ei != null) {
        if (Math.abs(cl[ei] - +r.entryPrice) / cl[ei] > 0.005) errs.push(`precio entrada ${r.entryPrice}≠${cl[ei].toFixed(2)}`);
        if (!(ef[ei] < es[ei])) errs.push('EMA8 NO estaba debajo en entrada');
        if (!(ef[ei] > es[ei] - (es[ei] - ef[ei]) - 1e9)) { /* noop */ }
        const gap = (ef[ei] - es[ei]) / cl[ei], gapPrev = (ef[ei - 1] - es[ei - 1]) / cl[ei - 1];
        if (!(gap > gapPrev)) errs.push('no convergía en entrada');
        if (Math.abs(gap) >= GAPTH) errs.push('gap fuera de banda anticipación');
      }
      if (xi != null && ei != null) {
        if (r.reason === 'STOP') {
          const sl = cl[ei] * (1 - CAT);
          if (!(b[xi].l <= sl * 1.001)) errs.push('STOP pero mínimo no tocó SL');
        } else if (r.reason === 'CRUCE') {
          if (!(ef[xi - 1] >= es[xi - 1] && ef[xi] < es[xi])) errs.push('CRUCE pero no hubo cruce bajista');
          if (Math.abs(cl[xi] - +r.exitPrice) / cl[xi] > 0.005) errs.push(`precio salida ${r.exitPrice}≠${cl[xi].toFixed(2)}`);
        }
      }
      if (errs.length) { fail++; if (fails.length < 25) fails.push(`${tk} ${r.entryDate}: ${errs.join('; ')}`); }
      else ok++;
    }
  }
  console.log(`\n════ VERIFICACIÓN DE COHERENCIA ════`);
  console.log(`  Operaciones: ${rows.length}`);
  console.log(`  ✅ COHERENTES: ${ok} (${(100 * ok / rows.length).toFixed(1)}%)`);
  console.log(`  ⚠️ discrepancias: ${fail}`);
  console.log(`  sin datos (ticker no descargó): ${noData}`);
  if (fails.length) { console.log('\n  Primeras discrepancias:'); for (const f of fails) console.log('   – ' + f); }
  console.log('');
})();
