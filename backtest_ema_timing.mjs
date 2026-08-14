#!/usr/bin/env node
// backtest_ema_timing.mjs — ¿cuánto movimiento pierdo por esperar la CONFIRMACIÓN del cruce?
//   Compara, sobre los LONG de EMA 8/21 semanal:
//     A) CONFIRMADO  : entro al cierre de la vela donde el cruce se confirma (lo actual).
//     B) ANTICIPADO  : entro al cierre de la vela ANTERIOR (adelanto 1 semana, previsión PERFECTA).
//        → cota SUPERIOR de lo que se puede ganar entrando antes (la anticipación real es peor,
//          porque a veces el cruce NO se confirma y entras en falso).
//   Salida común: cruce contrario. READ-ONLY (Yahoo 10y semanal).

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const COST = 0.0006, FAST = 8, SLOW = 21, SAMPLE = +(process.argv[2] || 250);
const sleep = ms => new Promise(r => setTimeout(r, ms));
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const ROOT = dirname(fileURLToPath(import.meta.url));
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map((c, i) => { e = e === null ? c : c * k + e * (1 - k); return i >= p - 1 ? e : null; }); };
const med = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

async function getW(t) { const y = t.replace('.', '-');
  try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`, { headers: UA });
    if (!r.ok) return null; const d = (await r.json()).chart?.result?.[0]; const q = d?.indicators?.quote?.[0];
    if (!d?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < d.timestamp.length; i++) if (q.close[i] != null) b.push({ c: q.close[i] });
    return b.length > 40 ? b : null; } catch { return null; } }

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  const tickers = (uni.universe || uni).slice(0, SAMPLE).map(u => u.ticker);
  const gains = [], confirmed = [], early = []; let done = 0;
  for (const tk of tickers) { const b = await getW(tk); done++;
    if (done % 50 === 0) process.stdout.write(`  …${done}/${tickers.length}\n`);
    await sleep(110); if (!b) continue;
    const cl = b.map(x => x.c), ef = ema(cl, FAST), es = ema(cl, SLOW);
    let inPos = false, ei = 0;
    for (let i = SLOW + 2; i < cl.length; i++) {
      if (ef[i - 1] == null) continue;
      const bull = ef[i - 1] <= es[i - 1] && ef[i] > es[i];
      const bear = ef[i - 1] >= es[i - 1] && ef[i] < es[i];
      if (!inPos && bull) { inPos = true; ei = i; }
      else if (inPos && bear) {
        const exit = cl[i];
        const rC = (exit / cl[ei] - 1) * 100 - COST * 200;        // entro en la vela del cruce
        const rE = (exit / cl[ei - 1] - 1) * 100 - COST * 200;    // entro 1 vela antes
        confirmed.push(rC); early.push(rE); gains.push(rE - rC);
        inPos = false;
      }
    }
  }
  const n = confirmed.length;
  const st = a => { const s = a.reduce((x, y) => x + y, 0), w = a.filter(x => x > 0), l = a.filter(x => x <= 0), gl = l.reduce((x, y) => x + y, 0);
    return { sum: s, m: s / a.length, wr: 100 * w.length / a.length, pf: gl ? Math.abs(w.reduce((x, y) => x + y, 0) / gl) : 0 }; };
  const A = st(confirmed), B = st(early);
  console.log(`\n══ TIMING de ENTRADA — LONG EMA 8/21 semanal · ${n} trades ══\n`);
  console.log(`  ${'entrada'.padEnd(26)}${'%/tr'.padStart(8)}${'WR'.padStart(6)}${'PF'.padStart(7)}${'Σret%'.padStart(10)}`);
  console.log('  ' + '─'.repeat(56));
  console.log('  ' + 'A) confirmado (actual)'.padEnd(26) + ('+' + A.m.toFixed(2)).padStart(8) + (A.wr.toFixed(0) + '%').padStart(6) + A.pf.toFixed(2).padStart(7) + ('+' + A.sum.toFixed(0)).padStart(10));
  console.log('  ' + 'B) 1 vela antes (ideal)'.padEnd(26) + ('+' + B.m.toFixed(2)).padStart(8) + (B.wr.toFixed(0) + '%').padStart(6) + B.pf.toFixed(2).padStart(7) + ('+' + B.sum.toFixed(0)).padStart(10));
  console.log(`\n  Ventaja de adelantar 1 semana (con previsión PERFECTA, cota máxima):`);
  console.log(`    ganancia mediana ${med(gains).toFixed(2)}%/tr  ·  media ${(gains.reduce((a,b)=>a+b,0)/n).toFixed(2)}%/tr`);
  console.log(`    veces que adelantar MEJORA: ${(100*gains.filter(g=>g>0).length/n).toFixed(0)}%  ·  EMPEORA: ${(100*gains.filter(g=>g<0).length/n).toFixed(0)}%`);
  console.log(`\n  (La anticipación REAL rinde MENOS que B: aquí asumimos que el cruce SIEMPRE se confirma.)\n`);
})();
