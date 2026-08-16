#!/usr/bin/env node
// scanner_emacross.mjs — EMA 8/21 SEMANAL, cruce puro (LONG + SHORT).
//   LONG:  EMA8 cruza SOBRE EMA21  ·  SHORT: EMA8 cruza BAJO EMA21.
//   Aguanta hasta el cruce contrario. Sin TP/SL. Trend-following.
//
// Backtest (backtest_ema_cross.mjs, 10y, 5291 cruces): Solo LONG PF 2.35 WF 4/4
// (gana +39% / pierde −8%, perfil win-big/lose-small). El SHORT pierde en acciones
// (PF 0.48, WF 0/4) — se AVISA igual (el usuario quiere verlo) pero marcado como
// lado DÉBIL. Paper/shadow: recoge forward propio. Journal: journal_emacross.json.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tgSend } from './tg.mjs';
const SEED = process.argv.includes('--seed');   // 1ª pasada: un mensaje resumen, sin spam
import { coherentTrade, logDecision } from './integrity.mjs';
import { getWeeklyBars } from './weekly_bars.mjs';
import { buildSystemAlert } from './alert_system.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const F = n => join(ROOT, n);
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const FAST = 8, SLOW = 21, COST = 0.0006;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), '[EMACROSS]', ...a);
const load = (f, d) => existsSync(F(f)) ? JSON.parse(readFileSync(F(f), 'utf8')) : d;
const save = (f, v) => writeFileSync(F(f), JSON.stringify(v, null, 2));
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map((c, i) => { e = e === null ? c : c * k + e * (1 - k); return i >= p - 1 ? e : null; }); };
const DRY = process.argv.includes("--dry");
const NOW = Date.now() / 1000;
// La semana bursátil está CERRADA (finde o viernes tras el cierre US ~20:00 UTC) → la última
// vela YA es definitiva y NO se descarta. Si no, en finde/viernes-noche se perdían cruces
// recién cerrados (NU/DVN) por tratarlos como "en formación" (bug 2026-08-16).
const _d = new Date(), _dow = _d.getUTCDay(), _h = _d.getUTCHours();
const WEEK_OVER = _dow === 0 || _dow === 6 || (_dow === 5 && _h >= 20);
const DASH_URL = process.env.DASH_URL || 'http://localhost:8080';

const getWeekly = t => getWeeklyBars(t);   // módulo compartido (dedup + semana cerrada)

(async () => {
  const uni = load('universe.json', { universe: [] }).universe;
  const journal = load('journal_emacross.json', []);
  const seen = load('seen_emacross.json', {});
  let nLong = 0, nShort = 0, nClose = 0, errors = 0;
  const fresh = [];        // señales nuevas de esta pasada
  const closedList = [];   // cierres de esta pasada (para el aviso consolidado)

  for (const u of uni) {
    let bars; try { bars = await getWeekly(u.ticker); await sleep(120); } catch { errors++; continue; }
    if (!bars || bars.length < SLOW + 2) continue;
    const cl = bars.map(b => b.c), ef = ema(cl, FAST), es = ema(cl, SLOW);
    const L = bars.length - 1;                          // última vela semanal CERRADA
    if (ef[L - 1] == null || es[L - 1] == null) continue;
    const bull = ef[L - 1] <= es[L - 1] && ef[L] > es[L];
    const bear = ef[L - 1] >= es[L - 1] && ef[L] < es[L];
    if (!bull && !bear) continue;

    const dir = bull ? 'LONG' : 'SHORT';
    const key = `EMAX:${u.ticker}:${bars[L].t}:${dir}`;
    if (seen[key]) continue;
    seen[key] = true;
    const px = +(cl[L]).toFixed(2);

    // cerrar la posición contraria abierta de este ticker (aguanta hasta cruce contrario)
    for (const p of journal.filter(p => p.ticker === u.ticker && p.status === 'open')) {
      const ds = p.dir === 'LONG' ? 1 : -1;
      p.status = 'closed'; p.exitT = bars[L].t; p.exitPx = px;
      p.retPct = +(((px / p.entryPx - 1) * 100) * ds - COST * 200).toFixed(2);
      nClose++;
      log(`CIERRE ${p.dir} ${u.ticker}: ${p.retPct >= 0 ? '+' : ''}${p.retPct}% (cruce contrario)`);
      if (p.dir === 'LONG') closedList.push(u.ticker);   // solo LONG interesa al usuario
    }

    // coherencia (dato sano) antes de registrar
    const chk = coherentTrade({ ticker: u.ticker, entry: px });
    if (!chk.ok) { log(`${u.ticker}: descartada por coherencia — ${chk.reason}`); continue; }

    const stop = dir === 'LONG' ? +(px * 0.82).toFixed(2) : +(px * 1.18).toFixed(2);  // catástrofe -18%
    journal.push({ id: key, ticker: u.ticker, tv: u.tv, sector: u.sector, strategy: 'EMACross',
      dir, status: 'open', signalT: bars[L].t, entryT: bars[L].t, entryPx: px, stop });
    logDecision({ system: 'EMACross', action: dir, ticker: u.ticker, entry: px });
    if (dir === 'LONG') nLong++; else nShort++;
    fresh.push({ ticker: u.ticker, tv: u.tv, dir, px });
  }

  // AVISO SIMPLIFICADO (foco): no listamos tickers, solo "revisa el dashboard".
  const nL = fresh.filter(s => s.dir === 'LONG').length;   // solo LONG interesa al usuario
  if (!DRY && nL) await tgSend(buildSystemAlert('EMACross', nL));
  if (!DRY && closedList.length) await tgSend(buildSystemAlert('EMACross', closedList.length, { kind: 'salida' }));

  if (!DRY) { save('journal_emacross.json', journal); save('seen_emacross.json', seen); }
  const open = journal.filter(p => p.status === 'open');
  log(`scan: ${uni.length} tickers · ${nLong} LONG · ${nShort} SHORT · ${nClose} cierres · ${errors} err | abiertas ${open.length}`);
  console.log(`RESUMEN: ${nLong} señales LONG, ${nShort} SHORT, ${nClose} cierres por cruce contrario`);
})();
