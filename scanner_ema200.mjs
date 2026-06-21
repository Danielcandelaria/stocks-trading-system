// stocks/scanner_ema200.mjs
// SISTEMA 6 (paper) — Rebote en EMA200 Semanal con régimen EMA50 > EMA200
//
// Spec validada (backtest_ema200_bounce.mjs):
//   Señal   : close dentro del 8% por encima de EMA200 Y EMA50 > EMA200
//   Entrada : apertura de la siguiente semana (o siguiente día si escaneo diario)
//   Stop    : 8% por debajo de EMA200
//   Target  : 2R
//   WF      : 3/4 ventanas con PF>1 (PF global 1.58)
//
// ⚠️ W2 2021-2022 (bear market) el sistema pierde (PF 0.85). Añadir filtro de
//    tendencia de mercado general (SPY > EMA200) como circuit breaker adicional.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tgSend } from './tg.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const F  = n => join(ROOT, n);
const UA = { 'User-Agent': 'Mozilla/5.0' };
const COST = 0.0005;
const ZONE = 0.08;   // dentro del 8% sobre EMA200
const STOP_PCT = 0.08; // 8% bajo EMA200
const CAP  = 5;       // máx posiciones abiertas
const sleep = ms => new Promise(r => setTimeout(r, ms));
const load  = (f, d) => existsSync(F(f)) ? JSON.parse(readFileSync(F(f))) : d;
const save  = (f, v) => writeFileSync(F(f), JSON.stringify(v, null, 2));
const log   = (...a) => console.log(new Date().toISOString(), '[EMA200]', ...a);
const NOW   = Date.now() / 1000;

function emaArr(arr, period) {
  const k = 2 / (period + 1);
  let e = null;
  return arr.map(v => { e = e === null ? v : v * k + e * (1 - k); return e; });
}

async function getWeekly(ticker) {
  const y = ticker.replace('.', '-');
  const r = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,
    { headers: UA }
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = (await r.json()).chart?.result?.[0];
  const q = data?.indicators?.quote?.[0];
  if (!data?.timestamp || !q) throw new Error('sin datos');
  const bars = [];
  for (let i = 0; i < data.timestamp.length; i++) {
    if (q.open[i] == null || q.close[i] == null) continue;
    bars.push({ t: data.timestamp[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
  }
  // eliminar barra de la semana actual (incompleta)
  while (bars.length && NOW - bars[bars.length - 1].t < 7 * 86400) bars.pop();
  return bars;
}

// ---- SPY como filtro de régimen de mercado ----
async function spyInUptrend() {
  try {
    const bars = await getWeekly('SPY');
    if (bars.length < 220) return true; // si no hay datos, no filtrar
    const closes = bars.map(b => b.c);
    const e200 = emaArr(closes, 200);
    const last = bars.length - 1;
    return bars[last].c > e200[last]; // SPY por encima de su propia EMA200
  } catch { return true; }
}

function manageOpen(journal, ticker, bars) {
  for (const pos of journal.filter(p => p.ticker === ticker && p.status === 'open')) {
    const startIdx = bars.findIndex(b => b.t > pos.entryT);
    if (startIdx < 0) continue;
    for (let i = startIdx; i < bars.length; i++) {
      const b = bars[i];
      let exit = null, reason = null;
      if (b.l <= pos.stop)   { exit = Math.min(b.o, pos.stop); reason = 'STOP'; }
      else if (b.h >= pos.tp){ exit = pos.tp;                  reason = 'TP';   }
      if (exit) {
        const px = exit * (1 - COST);
        pos.status     = 'closed';
        pos.exitT      = b.t;
        pos.exitPx     = +px.toFixed(4);
        pos.exitReason = reason;
        pos.retPct     = +((px / pos.entryPx - 1) * 100).toFixed(2);
        tgSend(`🔵 <b>CIERRE EMA200</b> — ${ticker}\n${reason} → <b>${pos.retPct > 0 ? '+' : ''}${pos.retPct}%</b>\nEntrada $${pos.entryPx} → salida $${pos.exitPx}`);
        break;
      }
    }
  }
}

// ---- main ----
const universe = load('universe.json', { universe: [] }).universe;
const journal  = load('journal_ema200.json', []);
const seen     = load('seen_ema200.json', {});

const marketOk = await spyInUptrend();
if (!marketOk) {
  log('⚠️ SPY bajo su EMA200 — mercado bajista, no buscamos señales nuevas hoy');
  await tgSend('🔵 <b>EMA200 scanner</b>: SPY bajo EMA200 semanal → sin señales nuevas (filtro de régimen activo)');
  process.exit(0);
}

let signals = 0, errors = 0;
for (const u of universe) {
  let bars;
  try { bars = await getWeekly(u.ticker); await sleep(200); }
  catch { errors++; await sleep(400); continue; }
  if (bars.length < 220) continue;

  manageOpen(journal, u.ticker, bars);

  // revisar las últimas 2 velas cerradas (catch-up)
  const closes = bars.map(b => b.c);
  const e50  = emaArr(closes, 50);
  const e200 = emaArr(closes, 200);

  for (let i = Math.max(201, bars.length - 2); i < bars.length; i++) {
    const b = bars[i];
    if (e50[i] === null || e200[i] === null) continue;
    if (e50[i] <= e200[i]) continue; // régimen bajista

    const dist = (b.c - e200[i]) / e200[i];
    if (dist < 0 || dist > ZONE) continue; // fuera de zona

    const key = `EMA200:${u.ticker}:${b.t}`;
    if (seen[key]) continue;
    seen[key] = true;

    const open  = journal.filter(p => p.status === 'open');
    if (open.length >= CAP) { log(`${u.ticker}: señal EMA200 válida pero ${CAP} posiciones abiertas`); continue; }

    // ya hay posición abierta en este ticker
    if (open.some(p => p.ticker === u.ticker)) continue;

    const entryPx = bars[i + 1]?.o ?? b.c; // entrada en apertura de la siguiente semana
    const stopPx  = +(e200[i] * (1 - STOP_PCT)).toFixed(4);
    const riskPct = +((entryPx - stopPx) / entryPx * 100).toFixed(1);
    const tp      = +(entryPx + 2 * (entryPx - stopPx)).toFixed(4);

    if (riskPct <= 0.5) continue;

    journal.push({
      id: key, ticker: u.ticker, tv: u.tv, sector: u.sector,
      strategy: 'EMA200Bounce',
      status: 'open',
      signalT: b.t, entryT: b.t,
      entryPx: +entryPx.toFixed(4), stop: stopPx, tp, riskPct,
      ema200AtSignal: +e200[i].toFixed(4),
      distPct: +(dist * 100).toFixed(1),
    });
    signals++;

    await tgSend(
      `🔵 <b>SEÑAL EMA200 BOUNCE — COMPRA</b>\n` +
      `<b>${u.ticker}</b> — ${u.sector}\n\n` +
      `📍 <b>ENTRADA</b>: apertura próxima semana ~$${entryPx.toFixed(2)}\n` +
      `   (precio toca EMA200 a ${dist > 0 ? '+' : ''}${(dist*100).toFixed(1)}% sobre ella)\n` +
      `🛑 <b>STOP</b>: $${stopPx.toFixed(2)} (−${riskPct}% bajo EMA200)\n` +
      `🎯 <b>TARGET</b>: $${tp.toFixed(2)} (+2R)\n` +
      `📐 <b>Sizing</b>: 1% riesgo / distancia al stop\n\n` +
      `✅ Filtro: EMA50 > EMA200 (uptrend) + SPY en uptrend\n` +
      `⚠️ Sistema paper — WF 3/4, PF 1.58. Acumulando 30 trades.\n` +
      `TV: ${u.tv}`
    );
  }
}

save('journal_ema200.json', journal);
save('seen_ema200.json', seen);

// backup en git (igual que los otros scanners)
try {
  const { execSync } = await import('child_process');
  execSync(
    'git add journal_ema200.json seen_ema200.json 2>/dev/null; ' +
    'git diff --cached --quiet || git commit -q -m "journal ema200: scan ' + new Date().toISOString().slice(0, 10) + '"; ' +
    'git push -q origin main 2>/dev/null || true',
    { cwd: ROOT, shell: '/bin/zsh' }
  );
} catch {}

const open = journal.filter(p => p.status === 'open');
log(`scan: ${universe.length} tickers, ${signals} señales nuevas, ${errors} errores | abiertas ${open.length}/${CAP}`);
