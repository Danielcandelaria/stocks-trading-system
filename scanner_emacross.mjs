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

async function getWeekly(t) {
  const y = t.replace('.', '-');
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=2y&interval=1wk`, { headers: UA });
    if (!res.ok) return null;
    const r = (await res.json()).chart?.result?.[0]; const q = r?.indicators?.quote?.[0];
    if (!r?.timestamp || !q) return null;
    const b = [];
    for (let i = 0; i < r.timestamp.length; i++) if (q.close[i] != null) b.push({ t: r.timestamp[i], c: q.close[i] });
    // descartar la semana EN CURSO (incompleta)
    while (b.length && NOW - b[b.length - 1].t < 7 * 86400) b.pop();
    return b.length > 30 ? b : null;
  } catch { return null; }
}

(async () => {
  const uni = load('universe.json', { universe: [] }).universe;
  const journal = load('journal_emacross.json', []);
  const seen = load('seen_emacross.json', {});
  let nLong = 0, nShort = 0, nClose = 0, errors = 0;
  const fresh = [];   // señales nuevas de esta pasada (para modo --seed)

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
      log(`CIERRE ${p.dir} ${u.ticker}: ${p.retPct > 0 ? '+' : ''}${p.retPct}% (cruce contrario) — no Telegram`);
    }

    // coherencia (dato sano) antes de registrar
    const chk = coherentTrade({ ticker: u.ticker, entry: px });
    if (!chk.ok) { log(`${u.ticker}: descartada por coherencia — ${chk.reason}`); continue; }

    journal.push({ id: key, ticker: u.ticker, tv: u.tv, sector: u.sector, strategy: 'EMACross',
      dir, status: 'open', signalT: bars[L].t, entryT: bars[L].t, entryPx: px });
    logDecision({ system: 'EMACross', action: dir, ticker: u.ticker, entry: px });
    if (dir === 'LONG') nLong++; else nShort++;
    fresh.push({ ticker: u.ticker, tv: u.tv, dir, px });

    // aviso individual (cadencia normal). En --seed se acumula y sale un solo resumen.
    const emoji = dir === 'LONG' ? '🟢' : '🔴';
    const accion = dir === 'LONG' ? 'COMPRA (LONG)' : 'VENTA (SHORT)';
    const salida = dir === 'LONG' ? 'la EMA8 cruce BAJO la EMA21' : 'la EMA8 cruce SOBRE la EMA21';
    const nota = dir === 'LONG'
      ? '📊 semanal · sin stop fijo (sales en el cruce contrario)'
      : '⚠️ lado DÉBIL en acciones (backtest PF 0.48) — informativo · semanal';
    if (!DRY && !SEED) await tgSend(
      `${emoji} <b>${accion} ${u.ticker}</b>` +
      `\n${emoji} Entra  <b>$${px.toFixed(2)}</b>` +
      `\n🔄 Cierra  <i>cuando ${salida}</i>` +
      `\n${nota}` +
      `\n📈 ${u.tv}`
    );
  }

  // modo --seed: un único mensaje resumen con todas las señales frescas
  if (!DRY && SEED && fresh.length) {
    const L = fresh.filter(s => s.dir === 'LONG'), S = fresh.filter(s => s.dir === 'SHORT');
    const line = s => `  ${s.ticker.padEnd(6)} $${s.px.toFixed(2)}`;
    await tgSend(
      `📐 <b>EMA 8/21 semanal — cruces de esta semana</b>` +
      `\n\n🟢 <b>LONG</b> (${L.length}) · lado fuerte (PF 2.35)\n<code>${L.map(line).join('\n') || '  —'}</code>` +
      `\n\n🔴 <b>SHORT</b> (${S.length}) · lado débil, informativo (PF 0.48)\n<code>${S.map(line).join('\n') || '  —'}</code>` +
      `\n\n🔄 Cada uno se cierra en el cruce contrario. Sin stop fijo.`
    );
  }

  if (!DRY) { save('journal_emacross.json', journal); save('seen_emacross.json', seen); }
  const open = journal.filter(p => p.status === 'open');
  log(`scan: ${uni.length} tickers · ${nLong} LONG · ${nShort} SHORT · ${nClose} cierres · ${errors} err | abiertas ${open.length}`);
  console.log(`RESUMEN: ${nLong} señales LONG, ${nShort} SHORT, ${nClose} cierres por cruce contrario`);
})();
