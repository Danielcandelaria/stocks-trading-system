#!/usr/bin/env node
// confirm_open.mjs — FASE 2 de RSI2: confirma la entrada tras la apertura US.
//
// El scan (scanner_forward.mjs) corre ~9:00 hora española, ANTES de que abra
// EE.UU. (15:30). En ese momento no se sabe el gap de apertura, así que la señal
// queda 'pending_open' SIN avisar. Este script corre DESPUÉS de la apertura,
// mira el precio de apertura real, y:
//   · gap ≤ 5%  → CONFIRMA: entra a la apertura real y manda "🔵 COMPRA ahora".
//   · gap > 5%  → CANCELA en silencio (el rebote ya ocurrió; no se persigue).
// Así el usuario recibe SOLO señales de compra válidas — el sistema hace la
// comprobación del 5%, no él.
//
// Idempotente: solo procesa 'pending_open'; si ya se confirmó/canceló, no repite.
// Expira las pendientes de más de 2 días (Mac apagado a la hora de abrir, etc.).
//
// Programado ~16:00 hora española (siempre ≥30 min tras la apertura US, todo el
// año pese al desfase de horario de verano). Uso: node confirm_open.mjs

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildStockAlert } from './alert_format.mjs';
import { coherentTrade, logDecision } from './integrity.mjs';
import { tgSend } from './tg.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const F = n => join(ROOT, n);
const COST = 0.0005, DISASTER = 0.20, GAP_MAX = 0.05;
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), '[CONFIRM]', ...a);

// Apertura de HOY de un ticker (barra diaria en curso, que ya tiene 'open' tras abrir).
async function todayOpen(ticker) {
  const y = ticker.replace('.', '-');
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=5d&interval=1d`, { headers: UA });
    if (!res.ok) return null;
    const r = (await res.json()).chart?.result?.[0];
    const q = r?.indicators?.quote?.[0];
    if (!r?.timestamp || !q) return null;
    const last = r.timestamp.length - 1;
    const day = new Date(r.timestamp[last] * 1000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    // la última barra debe ser la de HOY (el mercado ya abrió) y tener open
    if (day !== today || q.open[last] == null) return null;
    return q.open[last];
  } catch { return null; }
}

(async () => {
  const journal = existsSync(F('journal.json')) ? JSON.parse(readFileSync(F('journal.json'), 'utf8')) : [];
  const pend = journal.filter(p => p.status === 'pending_open' && p.strategy === 'RSI2');
  if (!pend.length) { log('0 señales pendientes de confirmar.'); process.exit(0); }
  log(`${pend.length} señal(es) RSI2 pendiente(s) de confirmar tras la apertura.`);

  let confirmed = 0, cancelled = 0, expired = 0, waiting = 0;
  const nowSec = Date.now() / 1000;

  for (const pos of pend) {
    // expira si la señal es de hace más de 2 días (no se pudo confirmar a tiempo)
    if (nowSec - pos.signalT > 2 * 86400) {
      pos.status = 'expired'; pos.exitReason = 'NO_CONFIRM_2D';
      expired++; log(`${pos.ticker}: EXPIRADA (>2 días sin confirmar)`); continue;
    }
    const open = await todayOpen(pos.ticker);
    await sleep(150);
    if (open == null) { waiting++; log(`${pos.ticker}: aún sin apertura de hoy — se reintenta en la próxima pasada`); continue; }

    const gapPct = (open / pos.signalClose - 1) * 100;
    if (gapPct > GAP_MAX * 100) {
      pos.status = 'cancelled_gap'; pos.exitReason = 'GAP_GUARD';
      pos.gapPct = +gapPct.toFixed(1); pos.openPx = +open.toFixed(4);
      cancelled++;
      logDecision({ system: 'RSI2', action: 'CANCEL_GAP', ticker: pos.ticker, gapPct: +gapPct.toFixed(1) });
      log(`${pos.ticker}: CANCELADA — abrió +${gapPct.toFixed(1)}% (>5%), no se persigue`);
      continue;
    }

    // CONFIRMA: entrada a la apertura real; stop de catástrofe recalculado desde ahí.
    const entryPx = +(open * (1 + COST)).toFixed(4);
    const disasterPx = +(entryPx * (1 - DISASTER)).toFixed(2);
    // SIN RECORRIDO: si el open ya está en/por encima del objetivo de venta (SMA5),
    // comprar sería vender al instante. NO es dato malo — es que el rebote ya pasó
    // de noche (primo del gap-guard). Se distingue de un dato incoherente de verdad.
    if (pos.targetRef != null && entryPx >= pos.targetRef) {
      pos.status = 'cancelled_no_room'; pos.exitReason = 'NO_ROOM';
      pos.openPx = +open.toFixed(4); pos.entryPx = entryPx; pos.gapPct = +gapPct.toFixed(1);
      cancelled++;
      logDecision({ system: 'RSI2', action: 'CANCEL_NO_ROOM', ticker: pos.ticker, entry: entryPx, target: pos.targetRef });
      log(`${pos.ticker}: SIN RECORRIDO — abrió $${entryPx} en/sobre el objetivo $${pos.targetRef}, no se compra`);
      continue;
    }
    // Incoherencia REAL (dato malo: entry inválido o stop mal): rechazo distinto.
    const chk = coherentTrade({ ticker: pos.ticker, entry: entryPx, stop: disasterPx, target: pos.targetRef });
    if (!chk.ok) { pos.status = 'cancelled_incoherent'; pos.entryPx = entryPx; log(`${pos.ticker}: descartada por coherencia (dato) — ${chk.reason}`); continue; }

    pos.status = 'open'; pos.entryT = nowSec | 0; pos.entryPx = entryPx;
    pos.openPx = +open.toFixed(4); pos.gapPct = +gapPct.toFixed(1); pos.stop = disasterPx;
    confirmed++;
    logDecision({ system: 'RSI2', action: 'ENTER', ticker: pos.ticker, entry: entryPx, stop: disasterPx, gapPct: +gapPct.toFixed(1) });

    await tgSend(buildStockAlert({
      emoji: '🔵', ticker: pos.ticker,
      entry: entryPx,
      target: pos.targetRef,                        // aprox: cierre sobre la SMA5
      stop: disasterPx, stopKind: 'catastrofe',
      note: 'vende cuando suba a la media, o a los 5 días',
      tv: pos.tv,
    }));
    log(`${pos.ticker}: ✅ CONFIRMADA (gap +${gapPct.toFixed(1)}%) → COMPRA ahora a $${entryPx}`);
  }

  writeFileSync(F('journal.json'), JSON.stringify(journal, null, 2));
  // backup versionado (igual que el scan diario)
  try {
    const { execSync } = await import('node:child_process');
    execSync('git add journal.json 2>/dev/null; git diff --cached --quiet || git commit -q -m "confirm_open: ' + confirmed + ' conf · ' + cancelled + ' gap · ' + new Date().toISOString().slice(0, 10) + '"; git push -q origin main 2>/dev/null || true', { cwd: ROOT, shell: '/bin/zsh' });
  } catch {}
  log(`resultado: ${confirmed} confirmadas · ${cancelled} canceladas (gap) · ${expired} expiradas · ${waiting} esperando apertura`);
})();
