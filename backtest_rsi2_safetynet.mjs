#!/usr/bin/env node
// backtest_rsi2_safetynet.mjs — ¿Se le puede poner una RED DE SEGURIDAD a RSI2
// sin destruir su edge?
//
// RSI2 (Connors) está validado SIN stop (PF 1.36, WF 4/4). El motivo teórico: en
// mean-reversion el precio entra en pánico → un stop cercano salta justo donde
// está el edge y convierte ganadores en perdedores. Pero operar sin ninguna red
// da vértigo (petición del usuario, 2026-07-24). Pregunta empírica: ¿existe una
// red que recorte SOLO las catástrofes (la cola) sin tocar el cuerpo del edge?
//
// Se replica la spec EXACTA y se comparan variantes de salida añadidas encima:
//   BASE      — sin stop (lo actual): vende al cerrar sobre SMA5, o 5 días
//   EMA200    — además, vende si CIERRA por debajo de su EMA200 (tesis rota)
//   EMA10     — además, vende si CIERRA por debajo de su EMA10 (más rápido)
//   CAT-8/12/15 — stop de catástrofe intradía a −8% / −12% / −15%
//
// Métrica que decide: no solo PF/retorno medio, sino el PEOR trade y la suma —
// una red buena baja el peor caso SIN bajar (mucho) la suma. READ-ONLY (Yahoo).

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const COST = 0.0005;
const SAMPLE = +(process.argv[2] || 200);       // nº de tickers (por mcap desc)
const sleep = ms => new Promise(r => setTimeout(r, ms));

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const ROOT = dirname(fileURLToPath(import.meta.url));

const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map((c, i) => { e = e === null ? c : c * k + e * (1 - k); return i >= p - 1 ? e : null; }); };
const sma = (cl, p) => { const o = new Array(cl.length).fill(null); let s = 0; for (let i = 0; i < cl.length; i++) { s += cl[i]; if (i >= p) s -= cl[i - p]; if (i >= p - 1) o[i] = s / p; } return o; };
function rsi(cl, p) {
  const o = new Array(cl.length).fill(null); let ag = 0, al = 0;
  for (let i = 1; i < cl.length; i++) {
    const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= p) { ag += g / p; al += l / p; if (i === p) o[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
    else { ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p; o[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
  }
  return o;
}

async function getBars(ticker) {
  const y = ticker.replace('.', '-');
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=2y&interval=1d`, { headers: UA });
    if (!res.ok) return null;
    const r = (await res.json()).chart?.result?.[0];
    const q = r?.indicators?.quote?.[0];
    if (!r?.timestamp || !q) return null;
    const b = [];
    for (let i = 0; i < r.timestamp.length; i++)
      if (q.close[i] != null && q.open[i] != null) b.push({ o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
    return b.length > 220 ? b : null;
  } catch { return null; }
}

// Variantes de red de seguridad. Cada una recibe el estado del día y decide si
// fuerza la salida ANTES de la salida normal (SMA5 / 5 días).
const NETS = {
  BASE:    () => null,
  EMA200:  (d) => d.c < d.e200 ? { px: d.c, why: 'EMA200' } : null,
  EMA10:   (d) => d.c < d.e10 ? { px: d.c, why: 'EMA10' } : null,
  'CAT-8': (d, entry) => d.l <= entry * 0.92 ? { px: Math.min(d.o, entry * 0.92), why: 'CAT8' } : null,
  'CAT-12':(d, entry) => d.l <= entry * 0.88 ? { px: Math.min(d.o, entry * 0.88), why: 'CAT12' } : null,
  'CAT-15':(d, entry) => d.l <= entry * 0.85 ? { px: Math.min(d.o, entry * 0.85), why: 'CAT15' } : null,
  'CAT-18':(d, entry) => d.l <= entry * 0.82 ? { px: Math.min(d.o, entry * 0.82), why: 'CAT18' } : null,
  'CAT-20':(d, entry) => d.l <= entry * 0.80 ? { px: Math.min(d.o, entry * 0.80), why: 'CAT20' } : null,
};

// Simula un trade RSI2 desde el bar de señal `i` con una red dada.
function simulate(bars, e200, e10, s5, i, net) {
  const entry = bars[i].c * (1 + COST);
  for (let k = 1; k <= 5; k++) {
    const j = i + k;
    if (j >= bars.length) return null;                 // sin datos para cerrar → descartar
    const d = { ...bars[j], e200: e200[j], e10: e10[j] };
    // 1) red de seguridad primero (peor caso: se mira antes del objetivo)
    const hit = net(d, entry);
    if (hit) return { ret: (hit.px * (1 - COST) / entry - 1) * 100, why: hit.why, days: k };
    // 2) salida normal: cierre sobre SMA5
    if (s5[j] != null && d.c > s5[j]) return { ret: (d.c * (1 - COST) / entry - 1) * 100, why: 'SMA5', days: k };
    // 3) time-stop 5 días
    if (k === 5) return { ret: (d.c * (1 - COST) / entry - 1) * 100, why: 'TIME', days: k };
  }
  return null;
}

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  const tickers = (uni.universe || uni).slice(0, SAMPLE).map(u => u.ticker);
  console.log(`\n══ RSI2 — ¿RED DE SEGURIDAD SIN MATAR EL EDGE? ══`);
  console.log(`  ${tickers.length} tickers · 2 años · replay de la spec exacta\n`);

  // Genera las señales una sola vez; cada red se evalúa sobre las MISMAS señales.
  const signals = [];  // {bars,e200,e10,s5,i}
  let done = 0, ok = 0;
  for (const t of tickers) {
    const bars = await getBars(t);
    done++;
    if (done % 40 === 0) process.stdout.write(`  …${done}/${tickers.length}\n`);
    await sleep(120);
    if (!bars) continue;
    ok++;
    const cl = bars.map(b => b.c);
    const e200 = ema(cl, 200), e10 = ema(cl, 10), s5 = sma(cl, 5), r2 = rsi(cl, 2);
    for (let i = 200; i < bars.length - 1; i++) {
      if (r2[i] != null && e200[i] != null && r2[i] < 10 && bars[i].c > e200[i])
        signals.push({ bars, e200, e10, s5, i });
    }
  }
  console.log(`\n  ${ok} tickers con datos · ${signals.length} señales RSI2 encontradas\n`);

  // Evalúa cada red sobre TODAS las señales.
  const fmt = (v, d = 1) => (v >= 0 ? '+' : '') + v.toFixed(d);
  console.log('  ' + 'red'.padEnd(9) + 'n'.padStart(5) + 'Σret%'.padStart(9) + 'media%'.padStart(8) + 'WR'.padStart(6) + 'PF'.padStart(7) + 'PEOR%'.padStart(8) + '  salidas por red');
  console.log('  ' + '─'.repeat(70));
  const base = {};
  for (const [name, net] of Object.entries(NETS)) {
    const R = [], byWhy = {};
    for (const s of signals) {
      const r = simulate(s.bars, s.e200, s.e10, s.s5, s.i, net);
      if (!r) continue;
      R.push(r.ret); byWhy[r.why] = (byWhy[r.why] || 0) + 1;
    }
    const sum = R.reduce((a, b) => a + b, 0), n = R.length;
    const w = R.filter(x => x > 0), l = R.filter(x => x <= 0);
    const pf = l.length && l.reduce((a, b) => a + b, 0) !== 0 ? Math.abs(w.reduce((a, b) => a + b, 0) / l.reduce((a, b) => a + b, 0)) : null;
    const worst = Math.min(...R);
    const netExits = Object.entries(byWhy).filter(([k]) => !['SMA5', 'TIME'].includes(k)).map(([k, v]) => `${k}:${v}`).join(' ');
    if (name === 'BASE') { base.sum = sum; base.worst = worst; }
    const dSum = name === 'BASE' ? '' : `  (${fmt(sum - base.sum)}pp vs base)`;
    console.log('  ' + name.padEnd(9) + String(n).padStart(5) + fmt(sum).padStart(9) + fmt(sum / n, 2).padStart(8)
      + (100 * w.length / n).toFixed(0).padStart(5) + '%' + (pf ? pf.toFixed(2) : '—').padStart(7)
      + fmt(worst).padStart(8) + '   ' + (netExits || '—') + dSum);
  }
  console.log(`\n  Lectura: una BUENA red sube 'PEOR%' (menos catastrófico) SIN bajar mucho 'Σret%'.`);
  console.log(`  Si una red baja el Σret tanto como sube el peor trade → no compensa (mata el edge).\n`);
})();
