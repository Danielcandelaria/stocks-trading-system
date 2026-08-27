#!/usr/bin/env node
// backtest_sector_cap_ab.mjs — ¿El GUARDARRAÍL DE SECTOR (máx 2/sector) aporta?
//   Simula la cartera real a lo largo de 10 años: hasta MAX_OPEN posiciones concurrentes,
//   ¼ Kelly (POSFRAC c/u), señales EMACross anticipado procesadas en ORDEN TEMPORAL.
//   A/B: mismo flujo de señales, con el cap 2/sector ACTIVADO vs DESACTIVADO.
//   Mide retorno compuesto, maxDD y Calmar (retorno/DD). Desglose por 2 mitades.
//   Hipótesis: el cap baja algo el retorno pero reduce el DD (evita caídas correlacionadas).
//   READ-ONLY (Yahoo 10y semanal). Uso: node backtest_sector_cap_ab.mjs [sample]

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const FAST = 8, SLOW = 21, CAT = 0.18, GAPTH = 0.012, COST = 0.0006;
const POSFRAC = 0.139, MAX_OPEN = 7, SECT_CAP = 2;
const SPLIT_YEAR = 2021, SAMPLE = +(process.argv[2] || 220), CONC = 10;
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const ROOT = dirname(fileURLToPath(import.meta.url));
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map(c => { e = e === null ? c : c * k + e * (1 - k); return e; }); };
const yearOf = t => new Date(t * 1000).getUTCFullYear();

async function getW(t) { const y = t.replace('.', '-');
  try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`, { headers: UA });
    if (!r.ok) return null; const d = (await r.json()).chart?.result?.[0]; const q = d?.indicators?.quote?.[0];
    if (!d?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < d.timestamp.length; i++) if (q.close[i] != null && q.high[i] != null && q.low[i] != null)
      b.push({ t: d.timestamp[i], h: q.high[i], l: q.low[i], c: q.close[i] });
    return b.length > 60 ? b : null; } catch { return null; } }
async function mapLimit(items, n, fn) { const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  const arr = (uni.universe || uni).slice(0, SAMPLE);
  const SECT = Object.fromEntries(arr.map(u => [u.ticker.toUpperCase(), u.sector || 'N/A']));
  console.log(`\n════ A/B GUARDARRAÍL DE SECTOR (máx ${SECT_CAP}/sector) — cartera EMACross ════`);
  console.log(`  ${arr.length} acciones · 10y · ${MAX_OPEN} posiciones × ${(POSFRAC * 100).toFixed(1)}% · ¼ Kelly\n`);
  const bars = (await mapLimit(arr.map(u => u.ticker), CONC, getW));

  // Señales: {tEntry, weeks, ret, sector} para cada ticker (EMACross anticipado)
  const signals = [];
  for (let k = 0; k < arr.length; k++) {
    const b = bars[k]; if (!b) continue;
    const sec = SECT[arr[k].ticker.toUpperCase()] || 'N/A';
    const cl = b.map(x => x.c), ef = ema(cl, FAST), es = ema(cl, SLOW);
    let inPos = false, ei = 0, stop = 0;
    for (let i = SLOW + 1; i < b.length; i++) {
      const gap = (ef[i] - es[i]) / cl[i], gapPrev = (ef[i - 1] - es[i - 1]) / cl[i - 1];
      const longImm = gap < 0 && Math.abs(gap) < GAPTH && gap > gapPrev;
      if (!inPos && longImm) { inPos = true; ei = i; stop = cl[i] * (1 - CAT); continue; }
      if (inPos) {
        const bear = gapPrev >= 0 && gap < 0;
        if (b[i].l <= stop) { signals.push({ tEntry: b[ei].t, weeks: Math.max(1, i - ei), ret: (stop / cl[ei] - 1) - COST * 2, sector: sec, ticker: arr[k].ticker }); inPos = false; }
        else if (bear) { signals.push({ tEntry: b[ei].t, weeks: Math.max(1, i - ei), ret: (cl[i] / cl[ei] - 1) - COST * 2, sector: sec, ticker: arr[k].ticker }); inPos = false; }
      }
    }
  }
  signals.sort((a, b) => a.tEntry - b.tEntry);
  console.log(`  señales totales: ${signals.length} · tickers OK: ${bars.filter(Boolean).length}\n`);

  const WEEK = 7 * 86400;
  const t0 = signals[0].tEntry, tEnd = signals[signals.length - 1].tEntry + 200 * WEEK;

  // Simula la cartera con o sin cap. Devuelve {equity path por semana, taken, maxDD, ret}
  function sim(capOn) {
    let eq = 1, peak = 1, maxdd = 0;
    const open = [];            // {closeT, ret, sector}
    const sectCount = {};
    let si = 0, taken = 0, skippedSector = 0;
    const path = [];
    for (let t = t0; t <= tEnd; t += WEEK) {
      // cerrar lo que vence
      for (let j = open.length - 1; j >= 0; j--) if (open[j].closeT <= t) {
        eq *= (1 + POSFRAC * open[j].ret); const s = open[j].sector; sectCount[s]--; open.splice(j, 1);
      }
      // abrir señales de esta semana (en orden temporal, first-come) si hay hueco
      while (si < signals.length && signals[si].tEntry <= t) {
        const g = signals[si]; si++;
        if (open.length >= MAX_OPEN) continue;                       // sin slot
        if (capOn && (sectCount[g.sector] || 0) >= SECT_CAP) { skippedSector++; continue; }  // cap
        open.push({ closeT: g.tEntry + g.weeks * WEEK, ret: g.ret, sector: g.sector });
        sectCount[g.sector] = (sectCount[g.sector] || 0) + 1; taken++;
      }
      if (eq > peak) peak = eq;
      const dd = eq / peak - 1; if (dd < maxdd) maxdd = dd;
      path.push({ t, eq });
    }
    return { eq, maxdd: maxdd * 100, taken, skippedSector, path };
  }

  function ddOfHalf(path, firstHalf) {
    const seg = path.filter(p => firstHalf ? yearOf(p.t) < SPLIT_YEAR : yearOf(p.t) >= SPLIT_YEAR);
    let peak = seg.length ? seg[0].eq : 1, dd = 0;
    for (const p of seg) { if (p.eq > peak) peak = p.eq; const d = p.eq / peak - 1; if (d < dd) dd = d; }
    return dd * 100;
  }

  const off = sim(false), on = sim(true);
  const fmt = r => ((r.eq - 1) >= 0 ? '+' : '') + ((r.eq - 1) * 100).toFixed(0) + '%';
  const calmar = r => (((r.eq - 1) * 100) / Math.abs(r.maxdd)).toFixed(2);
  console.log('  Config            RetTotal   maxDD     Calmar(ret/DD)   trades   |  DD 1ªmitad / 2ªmitad');
  console.log(`  SIN cap           ${fmt(off).padStart(7)}    ${off.maxdd.toFixed(1)}%   ${calmar(off).padStart(5)}            ${String(off.taken).padStart(4)}     |  ${ddOfHalf(off.path, true).toFixed(1)}% / ${ddOfHalf(off.path, false).toFixed(1)}%`);
  console.log(`  CON cap 2/sector  ${fmt(on).padStart(7)}    ${on.maxdd.toFixed(1)}%   ${calmar(on).padStart(5)}            ${String(on.taken).padStart(4)}     |  ${ddOfHalf(on.path, true).toFixed(1)}% / ${ddOfHalf(on.path, false).toFixed(1)}%`);
  console.log(`\n  cap saltó ${on.skippedSector} señales por sector lleno.`);
  console.log('  LECTURA: el cap ayuda si SUBE el Calmar (mejor retorno/DD) o BAJA el maxDD sin');
  console.log('  sacrificar demasiado retorno, de forma consistente en ambas mitades.\n');
})();
