#!/usr/bin/env node
// backtest_meanrev_sleeve.mjs — ¿Un motor de REVERSIÓN A LA MEDIA (RSI-2) equilibra la cartera?
//   Tesis: momentum (EMACross) es tail-dependent (mediana −). Un motor con MEDIANA POSITIVA y
//   poca correlación suaviza. RSI-2: RSI(2)<10 + close>EMA200(diario), salida close>SMA5 ó 5 días.
//   Mide para RSI-2: PF, WR, MEDIANA, dependencia de cola (sin top-5%), sensibilidad a costes
//   (clave: muchos trades pequeños), y la CORRELACIÓN con EMACross. Compara perfiles.
//   READ-ONLY (Yahoo 5y DIARIO para RSI-2, 10y semanal para EMACross). Uso: [sample]

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const FAST = 8, SLOW = 21, CAT = 0.18, GAPTH = 0.012;
const SAMPLE = +(process.argv[2] || 200), CONC = 10;
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const ROOT = dirname(fileURLToPath(import.meta.url));
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map(c => { e = e === null ? c : c * k + e * (1 - k); return e; }); };
const sma = (cl, p) => cl.map((_, i) => i < p - 1 ? null : cl.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p);
const med = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sum = a => a.reduce((x, y) => x + y, 0);
const monthOf = t => { const d = new Date(t * 1000); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
function rsi(cl, p) { const out = Array(cl.length).fill(null); let ag = 0, al = 0;
  for (let i = 1; i < cl.length; i++) { const ch = cl[i] - cl[i - 1]; const g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= p) { ag += g; al += l; if (i === p) { ag /= p; al /= p; out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } }
    else { ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p; out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } }
  return out; }

async function fetchBars(t, range, interval) { const y = t.replace('.', '-');
  try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=${range}&interval=${interval}`, { headers: UA });
    if (!r.ok) return null; const d = (await r.json()).chart?.result?.[0]; const q = d?.indicators?.quote?.[0];
    if (!d?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < d.timestamp.length; i++) if (q.close[i] != null && q.high[i] != null && q.low[i] != null)
      b.push({ t: d.timestamp[i], h: q.high[i], l: q.low[i], c: q.close[i] });
    return b.length > 220 ? b : null; } catch { return null; } }
async function mapLimit(items, n, fn) { const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }

// RSI-2 mean reversion (diario). ret en % sin coste; coste aplicado luego.
function rsi2Trades(b) {
  const cl = b.map(x => x.c), r = rsi(cl, 2), e200 = ema(cl, 200), s5 = sma(cl, 5), out = [];
  let inPos = false, ei = 0;
  for (let i = 200; i < b.length; i++) {
    if (!inPos) { if (r[i] != null && r[i] < 10 && cl[i] > e200[i]) { inPos = true; ei = i; } }
    else { const held = i - ei; if ((s5[i] != null && cl[i] > s5[i]) || held >= 5) { out.push({ raw: (cl[i] / cl[ei] - 1) * 100, t: b[ei].t }); inPos = false; } }
  }
  return out;
}
// EMACross anticipado (semanal)
function emaTrades(b) {
  const cl = b.map(x => x.c), ef = ema(cl, FAST), es = ema(cl, SLOW), out = [];
  let inPos = false, ei = 0, stop = 0;
  for (let i = SLOW + 1; i < b.length; i++) {
    const gap = (ef[i] - es[i]) / cl[i], gapPrev = (ef[i - 1] - es[i - 1]) / cl[i - 1];
    if (!inPos && gap < 0 && Math.abs(gap) < GAPTH && gap > gapPrev) { inPos = true; ei = i; stop = cl[i] * (1 - CAT); continue; }
    if (inPos) { const bear = gapPrev >= 0 && gap < 0;
      if (b[i].l <= stop) { out.push({ raw: (stop / cl[ei] - 1) * 100, t: b[ei].t }); inPos = false; }
      else if (bear) { out.push({ raw: (cl[i] / cl[ei] - 1) * 100, t: b[ei].t }); inPos = false; } }
  }
  return out;
}
const pf = rs => { const w = sum(rs.filter(x => x > 0)), l = sum(rs.filter(x => x <= 0)); return l ? Math.abs(w / l) : 999; };
const wc = (tr, c) => tr.map(x => x.raw - c * 200);
function report(label, tr, cost) { const rs = wc(tr, cost), w = rs.filter(x => x > 0);
  console.log(`  ${label.padEnd(16)} n=${String(rs.length).padStart(5)}  PF ${pf(rs).toFixed(2)}  WR ${(100 * w.length / rs.length).toFixed(0)}%  media ${(sum(rs) / rs.length).toFixed(2)}%  MEDIANA ${(med(rs) >= 0 ? '+' : '') + med(rs).toFixed(2)}%`); }

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  const list = (uni.universe || uni).map(u => u.ticker).slice(0, SAMPLE);
  console.log(`\n════ SEGUNDO MOTOR: REVERSIÓN A LA MEDIA (RSI-2) vs MOMENTUM (EMACross) ════`);
  console.log(`  ${list.length} acciones · RSI-2 diario 5y · EMACross semanal 10y\n`);
  const [daily, weekly] = await Promise.all([
    mapLimit(list, CONC, t => fetchBars(t, '5y', '1d')),
    mapLimit(list, CONC, t => fetchBars(t, '10y', '1wk')),
  ]);
  const rsi2 = [], emac = [];
  for (const b of daily) if (b) for (const x of rsi2Trades(b)) rsi2.push(x);
  for (const b of weekly) if (b) for (const x of emaTrades(b)) emac.push(x);

  console.log('── PERFILES (coste 0.06%/lado) ──');
  report('RSI-2 (reversión)', rsi2, 0.0006);
  report('EMACross (momentum)', emac, 0.0006);

  console.log('\n── DEPENDENCIA DE COLA de RSI-2 (sin top-5%) ──');
  const rs = wc(rsi2, 0.0006).sort((a, b) => b - a);
  const cut = Math.floor(rs.length * 0.05);
  const trim = rs.slice(cut);
  console.log(`  RSI-2 sin top-5%: PF ${pf(trim).toFixed(2)} · media ${(sum(trim) / trim.length).toFixed(2)}% · MEDIANA ${(med(trim) >= 0 ? '+' : '') + med(trim).toFixed(2)}%  (¿aguanta sin la cola?)`);

  console.log('\n── SENSIBILIDAD A COSTES de RSI-2 (muchos trades pequeños = crítico) ──');
  for (const c of [0.0006, 0.0015, 0.0030, 0.0050]) { const r = wc(rsi2, c); console.log(`  coste ${(c * 100).toFixed(2)}%/lado → PF ${pf(r).toFixed(2)} · media ${(sum(r) / r.length).toFixed(3)}%`); }

  console.log('\n── CORRELACIÓN entre motores (retornos MENSUALES agregados) ──');
  const byMonth = tr => { const m = {}; for (const x of wc(tr, 0.0006)) { const k = monthOf(x.t); m[k] = (m[k] || 0) + x; } return m; };
  const ma = byMonth(rsi2), mb = byMonth(emac);
  const keys = [...new Set([...Object.keys(ma), ...Object.keys(mb)])];
  const A = keys.map(k => ma[k] || 0), B = keys.map(k => mb[k] || 0);
  const n = A.length, meanA = sum(A) / n, meanB = sum(B) / n;
  let cov = 0, va = 0, vb = 0; for (let i = 0; i < n; i++) { cov += (A[i] - meanA) * (B[i] - meanB); va += (A[i] - meanA) ** 2; vb += (B[i] - meanB) ** 2; }
  console.log(`  ρ (RSI-2 ↔ EMACross), ${n} meses: ${(cov / Math.sqrt(va * vb)).toFixed(2)}`);
  console.log('\n  LECTURA: RSI-2 sirve de diversificador si tiene MEDIANA POSITIVA, aguanta algo sin el top-5%,');
  console.log('  no lo matan los costes, y ρ es baja con EMACross. Su riesgo propio: skew NEGATIVO (pérdidas');
  console.log('  raras grandes, sin stop) — el par momentum+reversión se cubre mutuamente si ρ es baja.\n');
})();
