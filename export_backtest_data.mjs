#!/usr/bin/env node
// export_backtest_data.mjs — Exporta TODAS las operaciones del backtest EMACross (10y, universo
//   completo) a CSV: ticker, fecha señal/entrada, precio entrada, SL (-18%), fecha/precio salida,
//   motivo (STOP | CRUCE), retorno %, semanas, dist EMA200, momentum previo 26s, confluencia.
//   (El sistema NO tiene TP: salida = cruce contrario o stop -18%.)
//   Salida: /scratch backtest_trades.csv + backtest_summary.json. READ-ONLY (Yahoo 10y semanal).

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const FAST = 8, SLOW = 21, TREND = 200, CAT = 0.18, GAPTH = 0.012, COST = 0.0006, LOOKBACK = 26, CONC = 12;
import { readFileSync, writeFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || ROOT;
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map(c => { e = e === null ? c : c * k + e * (1 - k); return e; }); };
const med = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sum = a => a.reduce((x, y) => x + y, 0);
const dstr = t => new Date(t * 1000).toISOString().slice(0, 10);
async function getW(t) { const y = t.replace('.', '-');
  try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`, { headers: UA });
    if (!r.ok) return null; const d = (await r.json()).chart?.result?.[0]; const q = d?.indicators?.quote?.[0];
    if (!d?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < d.timestamp.length; i++) if (q.close[i] != null && q.high[i] != null && q.low[i] != null)
      b.push({ t: d.timestamp[i], h: q.high[i], l: q.low[i], c: q.close[i] });
    return b.length > 240 ? b : null; } catch { return null; } }
async function mapLimit(items, n, fn) { const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }

function tradesOf(ticker, b) {
  const cl = b.map(x => x.c), ef = ema(cl, FAST), es = ema(cl, SLOW), e200 = ema(cl, TREND), out = [];
  let inPos = false, ei = 0, sl = 0, d200 = 0, mom = 0, conf = false, td = null;
  try { td = (globalThis.__td || (globalThis.__td = {})); } catch {}
  for (let i = SLOW + 1; i < b.length; i++) {
    const gap = (ef[i] - es[i]) / cl[i], gp = (ef[i - 1] - es[i - 1]) / cl[i - 1];
    const longImm = gap < 0 && Math.abs(gap) < GAPTH && gap > gp;
    if (!inPos && longImm) {   // 10 AÑOS COMPLETOS: entradas desde el principio (no gate a bar 200)
      inPos = true; ei = i; sl = cl[i] * (1 - CAT);
      // EMA200 y momentum previo: solo si hay historia suficiente; si no, en blanco.
      d200 = (i >= TREND && e200[i]) ? (cl[i] - e200[i]) / e200[i] * 100 : null;
      mom = i >= LOOKBACK ? (cl[i] / cl[i - LOOKBACK] - 1) * 100 : null;
      continue;
    }
    if (inPos) {
      const bear = gp >= 0 && gap < 0;
      if (b[i].l <= sl) { out.push(row(ticker, b, ei, i, cl[ei], sl, 'STOP', d200, mom)); inPos = false; }
      else if (bear) { out.push(row(ticker, b, ei, i, cl[ei], cl[i], 'CRUCE', d200, mom)); inPos = false; }
    }
  }
  return out;
}
function row(ticker, b, ei, xi, entry, exit, reason, d200, mom) {
  const ret = (exit / entry - 1) * 100 - COST * 200;
  return { ticker, signalDate: dstr(b[ei].t), entryDate: dstr(b[ei].t), entryPrice: +entry.toFixed(2),
    slPrice: +(entry * (1 - CAT)).toFixed(2), exitDate: dstr(b[xi].t), exitPrice: +exit.toFixed(2),
    reason, retPct: +ret.toFixed(2), weeks: xi - ei, distEMA200: d200 == null ? '' : +d200.toFixed(1), mom26w: mom == null ? '' : +mom.toFixed(1) };
}

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  const list = (uni.universe || uni);
  process.stderr.write(`Descargando ${list.length} acciones (10y)...\n`);
  const bars = await mapLimit(list.map(u => u.ticker), CONC, getW);
  const all = [];
  const analyzed = [];
  for (let k = 0; k < list.length; k++) { const b = bars[k]; if (!b) continue; analyzed.push(list[k].ticker); for (const r of tradesOf(list[k].ticker, b)) all.push(r); }
  all.sort((a, b) => a.entryDate < b.entryDate ? -1 : a.entryDate > b.entryDate ? 1 : (a.ticker < b.ticker ? -1 : 1));

  // CSV
  const cols = ['ticker', 'signalDate', 'entryDate', 'entryPrice', 'slPrice', 'exitDate', 'exitPrice', 'reason', 'retPct', 'weeks', 'distEMA200', 'mom26w'];
  const csv = [cols.join(',')].concat(all.map(r => cols.map(c => r[c]).join(','))).join('\n');
  writeFileSync(join(OUT, 'backtest_trades.csv'), csv + '\n');

  // Resumen
  const rets = all.map(r => r.retPct);
  const w = rets.filter(x => x > 0), l = rets.filter(x => x <= 0);
  const sorted = [...rets].sort((a, b) => b - a);
  const cut5 = Math.floor(rets.length * 0.05);
  const byStop = all.filter(r => r.reason === 'STOP').length;
  const summary = {
    universo: list.length, analizadas: analyzed.length, operaciones: all.length,
    reglas: { entrada: 'Anticipada (EMA8 converge hacia EMA21, hueco <1.2%)', salida: 'Cruce contrario (EMA8<EMA21) — NO hay TP', stop: '-18% del precio de entrada', coste: '0.06%/lado' },
    periodo: all.length ? `${all[0].entryDate} a ${all[all.length - 1].exitDate}` : '',
    WR: +(100 * w.length / rets.length).toFixed(1), PF: +(Math.abs(sum(w) / sum(l))).toFixed(2),
    mediaRet: +(sum(rets) / rets.length).toFixed(2), medianaRet: +med(rets).toFixed(2), sumaR: +sum(rets).toFixed(0),
    salidasPorStop: +(100 * byStop / all.length).toFixed(0),
    sinTop5pct: { PF: +(Math.abs(sum(sorted.slice(cut5).filter(x => x > 0)) / sum(sorted.slice(cut5).filter(x => x <= 0)))).toFixed(2), suma: +sum(sorted.slice(cut5)).toFixed(0) },
    top5pctAporta: +(100 * sum(sorted.slice(0, cut5)) / sum(rets)).toFixed(0),
    analyzed,
  };
  writeFileSync(join(OUT, 'backtest_summary.json'), JSON.stringify(summary, null, 2));
  process.stderr.write(`OK: ${all.length} operaciones · ${analyzed.length} acciones → ${OUT}\n`);
  console.log(JSON.stringify({ operaciones: all.length, analizadas: analyzed.length, PF: summary.PF, WR: summary.WR, mediana: summary.medianaRet }));
})();
