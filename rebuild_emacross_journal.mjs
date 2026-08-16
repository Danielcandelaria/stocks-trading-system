#!/usr/bin/env node
// rebuild_emacross_journal.mjs — reconstruye journal_emacross.json a la REALIDAD de HOY.
// Escanea el universo, encuentra las acciones AHORA en cruce alcista (EMA8>EMA21) y registra
// cada una con la fecha y precio REALES de su último cruce → P&L correcto desde el cruce.
// Sustituye el seed viejo del 3-ago (que quedó desincronizado por el bug de semana-en-formación).
//   node rebuild_emacross_journal.mjs            → solo CUENTA (no escribe)
//   node rebuild_emacross_journal.mjs --write    → escribe journal_emacross.json + seen
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getWeeklyBars } from './weekly_bars.mjs';
const ROOT = dirname(fileURLToPath(import.meta.url));
const F = n => join(ROOT, n);
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const FAST = 8, SLOW = 21;
const WRITE = process.argv.includes('--write');
const MAX_WEEKS = +(process.env.MAX_WEEKS || 4);   // solo cruces recientes (accionables); ajustable
const sleep = ms => new Promise(r => setTimeout(r, ms));
const load = (f, d) => existsSync(F(f)) ? JSON.parse(readFileSync(F(f), 'utf8')) : d;
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map((c, i) => { e = e === null ? c : c * k + e * (1 - k); return i >= p - 1 ? e : null; }); };
const NOW = Date.now() / 1000;
const _d = new Date(), WEEK_OVER = _d.getUTCDay() === 0 || _d.getUTCDay() === 6 || (_d.getUTCDay() === 5 && _d.getUTCHours() >= 20);

const getW = t => getWeeklyBars(t);   // módulo compartido (dedup + semana cerrada)

(async () => {
  const uni = load('universe.json', { universe: [] }).universe;
  const positions = []; let done = 0, errors = 0;
  for (const u of uni) {
    let b; try { b = await getW(u.ticker); await sleep(110); } catch { errors++; continue; }
    if (!b) continue;
    const cl = b.map(x => x.c), ef = ema(cl, FAST), es = ema(cl, SLOW), L = cl.length - 1;
    if (ef[L] == null || es[L] == null) continue;
    if (!(ef[L] > es[L])) continue;                       // solo las que están AHORA en cruce alcista
    // buscar el ÚLTIMO cruce alcista (donde ef pasó de <= a >)
    let ci = L; for (let i = L; i > SLOW; i--) { if (ef[i - 1] != null && ef[i - 1] <= es[i - 1] && ef[i] > es[i]) { ci = i; break; } if (i === SLOW + 1) ci = SLOW + 1; }
    const entryPx = +cl[ci].toFixed(2), signalT = b[ci].t, weeks = L - ci;
    positions.push({ ticker: u.ticker, tv: u.tv, sector: u.sector, entryPx, signalT, weeks, crossT: b[ci].t });
  }
  positions.sort((a, b) => a.weeks - b.weeks);
  const buckets = { '≤4 sem (fresco)': 0, '5-12 sem': 0, '13-26 sem': 0, '>26 sem (extendido)': 0 };
  positions.forEach(p => { buckets[p.weeks <= 4 ? '≤4 sem (fresco)' : p.weeks <= 12 ? '5-12 sem' : p.weeks <= 26 ? '13-26 sem' : '>26 sem (extendido)']++; });
  console.log(`\n══ Acciones AHORA en cruce alcista EMA8/21: ${positions.length} (de ${uni.length}) · ${errors} err ══`);
  console.log('  distribución por antigüedad del cruce:');
  for (const [k, v] of Object.entries(buckets)) console.log(`    ${k.padEnd(22)} ${v}`);
  console.log(`\n  frescas (≤4 sem):`, positions.filter(p => p.weeks <= 4).map(p => p.ticker).join(', '));
  console.log(`\n  ¿NU/DVN incluidas?`, ['NU', 'DVN'].map(t => t + ':' + (positions.find(p => p.ticker === t) ? 'SÍ' : 'no')).join(' '));

  if (WRITE) {
    const keep = positions.filter(p => p.weeks <= MAX_WEEKS);   // solo cruces recientes (accionables)
    const journal = keep.map(p => ({
      id: `EMAX:${p.ticker}:${p.crossT}:LONG`, ticker: p.ticker, tv: p.tv, sector: p.sector, strategy: 'EMACross',
      dir: 'LONG', status: 'open', signalT: p.signalT, entryT: p.signalT, entryPx: p.entryPx, stop: +(p.entryPx * 0.82).toFixed(2),
    }));
    writeFileSync(F('journal_emacross.json'), JSON.stringify(journal, null, 2));
    const seen = {}; journal.forEach(p => { seen[p.id] = true; });
    writeFileSync(F('seen_emacross.json'), JSON.stringify(seen, null, 2));
    console.log(`\n  ✅ journal_emacross.json reconstruido: ${journal.length} posiciones LONG reales.`);
  } else console.log(`\n  (solo cuenta — añade --write para reconstruir)`);
})();
