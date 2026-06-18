// stocks/scanner_breakout.mjs
// 5º SISTEMA (paper) — BREAKOUT RETEST SEMANAL (idea Justin Banks @RealUGBanks).
// Backtest 10y semanal: PF 2.65 vs azar 1.37, meseta robusta (18/18 WF 4/4),
// correlación 0.04 con el swing de Carlos (diversifica).
//
// TIMING CORRECTO (fix 2026-06-18): la alerta sale en la RUPTURA, no en el retest.
// Se coloca una orden LÍMITE en el nivel de ruptura; el retroceso la ejecuta sola.
// Avisar en el retest ya confirmado llega tarde (en semanal, retest+rebote ocurren
// en la misma vela → al cerrar el viernes el precio ya se fue).
//
// Flujo de estados del journal:
//   1. RUPTURA detectada (cierre semanal > máx 20sem + cruce 8>21) → 'pending' +
//      ALERTA "coloca límite en $X". Caduca a las 6 semanas sin retest.
//   2. RETEST (una semana baja a tocar el nivel) → 'open' (orden ejecutada).
//   3. Salida: target 2R / cruce 8<21 / time-stop 52sem / stop → 'closed'.
//   Stop: 8% bajo el nivel de ruptura.
//
// ⚠️ Absolutos inflados por supervivencia; edge real = el relativo al azar. Forward manda.
// Paralelo total: HTTP puro (Yahoo semanal), sin chart/CDP. Journal propio.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tgSend } from './tg.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const F = n => join(ROOT, n);
const COST = 0.0005, RES_LB = 20, RETEST_W = 6, RETEST_BAND = 0.02, STOP_BUF = 0.08, TP_R = 2, TIME_W = 52, CAP = 5;
const UA = { 'User-Agent': 'Mozilla/5.0' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const load = (f, d) => existsSync(F(f)) ? JSON.parse(readFileSync(F(f))) : d;
const save = (f, v) => writeFileSync(F(f), JSON.stringify(v, null, 2));
const log = (...a) => console.log(new Date().toISOString(), '[BREAKOUT]', ...a);
const NOW = Date.now() / 1000;
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map((c, i) => { e = e === null ? c : c * k + e * (1 - k); return i >= p - 1 ? e : null; }); };

async function getWeekly(ticker) {
  const y = ticker.replace('.', '-');
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=5y&interval=1wk`, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const r = (await res.json()).chart?.result?.[0];
  const q = r?.indicators?.quote?.[0];
  if (!r?.timestamp || !q) throw new Error('sin datos');
  const bars = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    if (q.open[i] == null || q.close[i] == null) continue;
    bars.push({ t: r.timestamp[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] ?? 0 });
  }
  while (bars.length && NOW - bars[bars.length - 1].t < 7 * 86400) bars.pop(); // semana en curso
  return bars;
}

// pending → fill (si retesta) o cancel (si caduca); open → cierre
function managePositions(journal, ticker, bars, e8, e21) {
  for (const pos of journal.filter(p => p.ticker === ticker && (p.status === 'pending' || p.status === 'open'))) {
    const startIdx = bars.findIndex(b => b.t > pos.signalT);
    if (startIdx < 0) continue;

    if (pos.status === 'pending') {
      // ¿retestó el nivel dentro de la ventana? (low ≤ límite) → orden ejecutada
      for (let i = startIdx; i < bars.length && i - startIdx <= RETEST_W; i++) {
        if (bars[i].l <= pos.entryPx) {
          pos.status = 'open'; pos.entryT = bars[i].t; pos.filledWeek = i - startIdx;
          tgSend(`🟠 <b>EJECUTADA</b> — ${ticker}: tu límite en $${pos.entryPx} se llenó (retest). Trade ACTIVO. Stop $${pos.stop}, target $${pos.tp}.`);
          break;
        }
      }
      // caducó sin retest → cancelada (la ruptura se fue sin retroceso)
      if (pos.status === 'pending') {
        const wksSince = bars.length - 1 - startIdx;
        if (wksSince > RETEST_W) { pos.status = 'cancelled'; pos.exitT = bars[bars.length - 1].t; log(`${ticker}: orden caducada sin retest`); }
      }
    }

    if (pos.status === 'open') {
      const fi = bars.findIndex(b => b.t > pos.entryT);
      if (fi < 0) continue;
      for (let i = fi; i < bars.length; i++) {
        const b = bars[i];
        let exit = null, reason = null;
        if (b.l <= pos.stop) { exit = Math.min(b.o, pos.stop); reason = 'STOP'; }
        else if (b.h >= pos.tp) { exit = Math.max(b.o, pos.tp); reason = 'TARGET 2R'; }
        else if (e8[i] < e21[i]) { exit = b.c; reason = 'cruce 8<21 (tendencia gira)'; }
        else if (i - fi >= TIME_W) { exit = b.c; reason = 'TIME 52sem'; }
        if (exit != null) {
          const px = exit * (1 - COST);
          pos.status = 'closed'; pos.exitT = b.t; pos.exitPx = +px.toFixed(4);
          pos.exitReason = reason; pos.retPct = +((px / pos.entryPx - 1) * 100).toFixed(2);
          pos.r = +((px - pos.entryPx) / (pos.entryPx - pos.stop)).toFixed(2); pos.weeksHeld = i - fi;
          tgSend(`🟠 <b>CIERRE BREAKOUT RETEST</b> — ${ticker}\n${reason} → <b>${pos.retPct > 0 ? '+' : ''}${pos.retPct}% (${pos.r > 0 ? '+' : ''}${pos.r}R)</b> en ${pos.weeksHeld} semanas\nEntrada $${pos.entryPx} → salida $${pos.exitPx}`);
          break;
        }
      }
    }
  }
}

// ---------- main ----------
const universe = load('universe.json', { universe: [] }).universe;
const journal = load('journal_breakout.json', []);
const seen = load('seen_breakout.json', {});
let signals = 0, errors = 0;

for (const u of universe) {
  let bars;
  try { bars = await getWeekly(u.ticker); await sleep(150); }
  catch { errors++; await sleep(300); continue; }
  if (bars.length < RES_LB + 25) continue;

  const cl = bars.map(b => b.c);
  const e8 = ema(cl, 8), e21 = ema(cl, 21);
  managePositions(journal, u.ticker, bars, e8, e21);

  // ¿RUPTURA en la última vela semanal cerrada (+ catch-up de 2 semanas)?
  for (let i = Math.max(RES_LB, bars.length - 3); i < bars.length; i++) {
    if (e8[i] == null || e21[i] == null) continue;
    const cross = e8[i - 1] != null && e8[i - 1] <= e21[i - 1] && e8[i] > e21[i];
    const resist = Math.max(...bars.slice(i - RES_LB, i).map(b => b.h));
    if (!(cross && bars[i].c > resist)) continue;

    const key = `B:${u.ticker}:${bars[i].t}`;
    if (seen[key]) continue;
    seen[key] = true;

    const entryPx = +resist.toFixed(4);           // límite = nivel de ruptura
    const stop = +(resist * (1 - STOP_BUF)).toFixed(4);
    const risk = entryPx - stop;
    const tp = +(entryPx + TP_R * risk).toFixed(4);

    const active = journal.filter(p => p.status === 'pending' || p.status === 'open');
    if (active.length >= CAP) { log(`${u.ticker}: ruptura válida pero ya hay ${CAP} activas — descartada`); continue; }

    journal.push({
      id: key, ticker: u.ticker, tv: u.tv, sector: u.sector, strategy: 'BreakoutRetest',
      status: 'pending', signalT: bars[i].t, entryPx, stop, tp,
      breakClose: +bars[i].c.toFixed(4), riskPct: +(risk / entryPx * 100).toFixed(1),
    });
    signals++;
    await tgSend(`🟠 <b>RUPTURA — PREPARA ORDEN LÍMITE</b>\n<b>${u.ticker}</b> — ${u.sector}` +
      `\n` +
      `\n⚡ Acaba de romper resistencia (cierre semanal $${bars[i].c.toFixed(2)}, cruce 8/21 EMA).` +
      `\n📍 <b>COLOCA ORDEN LÍMITE DE COMPRA</b> en $${entryPx.toFixed(2)} (el nivel de ruptura)` +
      `\n🛑 <b>STOP</b>: $${stop.toFixed(2)} (−${(risk / entryPx * 100).toFixed(1)}%)` +
      `\n🎯 <b>TARGET</b>: $${tp.toFixed(2)} (+2R)` +
      `\n⏳ La orden se ejecuta cuando el precio RETROCEDE al nivel (próximas ~6 semanas). Si no retrocede, se cancela sola.` +
      `\n\nConfirmar en TV (semanal): ${u.tv}`);
  }
}

save('journal_breakout.json', journal);
save('seen_breakout.json', seen);
try {
  const { execSync } = await import('child_process');
  execSync('git add journal_breakout.json seen_breakout.json 2>/dev/null; git diff --cached --quiet || git commit -q -m "journal breakout: scan ' + new Date().toISOString().slice(0, 10) + '"; git push -q origin main 2>/dev/null || true', { cwd: ROOT, shell: '/bin/zsh' });
} catch {}

const pending = journal.filter(p => p.status === 'pending').length;
const open = journal.filter(p => p.status === 'open').length;
log(`scan: ${universe.length} tickers, ${signals} rupturas nuevas, ${errors} errores | pending ${pending}, abiertas ${open} (cap ${CAP})`);
