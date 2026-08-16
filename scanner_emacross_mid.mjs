#!/usr/bin/env node
// scanner_emacross_mid.mjs — EMA 8/21 SEMANAL en MID-caps ($2-8B), SOLO LONG. SHADOW.
//   Backtest (backtest_midsmall_split.mjs, 10y): MID PF 1.82, WF 4/4, ganadora media +56%.
//   Secundario al core large-cap (PF 2.36). Recoge FORWARD propio, NO operar aún.
//   Mismo motor que scanner_emacross: cruce alcista → LONG, aguanta hasta cruce contrario,
//   stop catástrofe -18%. Digest CONSOLIDADO (679 tickers → un solo mensaje, sin spam).
//   Journal: journal_emacross_mid.json · seen: seen_emacross_mid.json.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tgSend } from './tg.mjs';
import { coherentTrade, logDecision } from './integrity.mjs';
import { getWeeklyBars } from './weekly_bars.mjs';
import { buildSystemAlert } from './alert_system.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const F = n => join(ROOT, n);
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const FAST = 8, SLOW = 21, COST = 0.0006, MIN_MCAP = 2e9;
const DRY = process.argv.includes('--dry');
const SEED = process.argv.includes('--seed');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), '[EMACROSS-MID]', ...a);
const load = (f, d) => existsSync(F(f)) ? JSON.parse(readFileSync(F(f), 'utf8')) : d;
const save = (f, v) => writeFileSync(F(f), JSON.stringify(v, null, 2));
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map((c, i) => { e = e === null ? c : c * k + e * (1 - k); return i >= p - 1 ? e : null; }); };
const NOW = Date.now() / 1000;

const getWeekly = t => getWeeklyBars(t);   // módulo compartido (dedup + semana cerrada)

(async () => {
  const uni = load('universe_midsmall.json', { universe: [] }).universe.filter(u => u.mcap >= MIN_MCAP);
  const journal = load('journal_emacross_mid.json', []);
  const seen = load('seen_emacross_mid.json', {});
  let nLong = 0, nClose = 0, errors = 0;
  const fresh = [], closed = [];

  for (const u of uni) {
    let bars; try { bars = await getWeekly(u.ticker); await sleep(110); } catch { errors++; continue; }
    if (!bars || bars.length < SLOW + 2) continue;
    const cl = bars.map(b => b.c), ef = ema(cl, FAST), es = ema(cl, SLOW);
    const L = bars.length - 1;
    if (ef[L - 1] == null || es[L - 1] == null) continue;
    const bull = ef[L - 1] <= es[L - 1] && ef[L] > es[L];
    const bear = ef[L - 1] >= es[L - 1] && ef[L] < es[L];
    const px = +(cl[L]).toFixed(2);

    // cierre por cruce contrario (bajista) de un LONG abierto
    if (bear) for (const p of journal.filter(p => p.ticker === u.ticker && p.status === 'open')) {
      p.status = 'closed'; p.exitT = bars[L].t; p.exitPx = px;
      p.retPct = +(((px / p.entryPx - 1) * 100) - COST * 200).toFixed(2);
      nClose++; closed.push({ ticker: u.ticker, retPct: p.retPct });
      log(`CIERRE LONG ${u.ticker}: ${p.retPct >= 0 ? '+' : ''}${p.retPct}%`);
    }

    if (!bull) continue;                                  // solo LONG
    const key = `EMAXMID:${u.ticker}:${bars[L].t}`;
    if (seen[key]) continue; seen[key] = true;
    if (journal.some(p => p.ticker === u.ticker && p.status === 'open')) continue;   // ya abierto
    const chk = coherentTrade({ ticker: u.ticker, entry: px });
    if (!chk.ok) { log(`${u.ticker}: descartada — ${chk.reason}`); continue; }
    const stop = +(px * 0.82).toFixed(2);
    journal.push({ id: key, ticker: u.ticker, tv: u.tv, sector: u.sector, strategy: 'EMACrossMid',
      dir: 'LONG', status: 'open', signalT: bars[L].t, entryT: bars[L].t, entryPx: px, stop });
    logDecision({ system: 'EMACrossMid', action: 'LONG', ticker: u.ticker, entry: px });
    nLong++; fresh.push({ ticker: u.ticker, tv: u.tv, px });
  }

  // digest consolidado (un solo mensaje) — shadow, informativo
  if (!DRY && fresh.length) await tgSend(buildSystemAlert('EMACrossMid', fresh.length));

  if (!DRY) { save('journal_emacross_mid.json', journal); save('seen_emacross_mid.json', seen); }
  const open = journal.filter(p => p.status === 'open');
  log(`scan: ${uni.length} MID · ${nLong} LONG nuevos · ${nClose} cierres · ${errors} err | abiertas ${open.length}`);
  console.log(`RESUMEN MID: ${nLong} LONG nuevos, ${nClose} cierres`);
})();
