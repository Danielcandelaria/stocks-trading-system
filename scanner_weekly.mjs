// stocks/scanner_weekly.mjs
import { buildStockAlert } from './alert_format.mjs';
// CUARTO SISTEMA (paper) — DeMark-9 SEMANAL de aguante largo ("swing de meses").
// Origen: idea de Carlos Mantilla + corrección visual del usuario (CRDO: se compra
// el 9-SUELO, no el 13-TECHO). Backtest 10y semanal: PF 3.98 vs azar 2.31 (bate al
// azar = timing real, no solo supervivencia), WF 4/4. WR ~20% pero ganadores +79%.
//
// Spec validada (backtest_weekly):
//   TF      : SEMANAL
//   Entrada : bullSetup==9 (suelo de agotamiento vendedor) en vela semanal cerrada
//   Stop    : mínimo del setup (setupLow); descartar si dista >30% del precio
//   Salida  : bearCountdown==13 (techo) Ó time-stop 52 semanas Ó stop
//   Horizonte: semanas a meses (busca +20% a +100%)
//   Cap     : máx 5 posiciones abiertas
//
// ⚠️ Absolutos inflados por sesgo de supervivencia; el edge REAL es el relativo al
//    azar. Validación que manda: la forward. Long-only (el corto no funciona en large-caps).
//
// Paralelo total: HTTP puro (Yahoo semanal), sin chart/CDP. Journal propio.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { computeTDSetup, computeTDCountdown } from '../scanner/demark_calc.mjs';
import { tgSend } from './tg.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const F = n => join(ROOT, n);
const COST = 0.0005, MIN_STOP = 0.08, MAX_STOP = 0.30, TIME_STOP_W = 52, CAP = 5;
const UA = { 'User-Agent': 'Mozilla/5.0' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const load = (f, d) => existsSync(F(f)) ? JSON.parse(readFileSync(F(f))) : d;
const save = (f, v) => writeFileSync(F(f), JSON.stringify(v, null, 2));
const log = (...a) => console.log(new Date().toISOString(), '[WEEKLY]', ...a);
const NOW = Date.now() / 1000;

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
  // descartar TODA barra de la semana en curso (incompleta): Yahoo a veces
  // devuelve la semana viva como 1-2 barras de <7 días. Quitar todas.
  while (bars.length && NOW - bars[bars.length - 1].t < 7 * 86400) bars.pop();
  return bars;
}

function manageOpen(journal, ticker, bars, cd) {
  for (const pos of journal.filter(p => p.ticker === ticker && p.status === 'open')) {
    const startIdx = bars.findIndex(b => b.t > pos.entryT);
    if (startIdx < 0) continue;
    for (let i = startIdx; i < bars.length; i++) {
      const b = bars[i];
      let exit = null, reason = null;
      if (b.l <= pos.stop) { exit = Math.min(b.o, pos.stop); reason = 'STOP'; }
      else if (cd.bearCountdown[i] === 13) { exit = b.c; reason = '13 (techo)'; }
      else if (i - startIdx >= TIME_STOP_W) { exit = b.c; reason = 'TIME 52sem'; }
      if (exit != null) {
        const px = exit * (1 - COST);
        pos.status = 'closed'; pos.exitT = b.t; pos.exitPx = +px.toFixed(4);
        pos.exitReason = reason; pos.retPct = +((px / pos.entryPx - 1) * 100).toFixed(2);
        pos.weeksHeld = i - startIdx;
        // CIERRE: solo INTERNO (log + journal → dashboard), NO a Telegram (solo compras).
        log(`CIERRE SwingSemanal ${ticker}: ${pos.retPct > 0 ? '+' : ''}${pos.retPct}% en ${pos.weeksHeld}sem (${reason}) — no Telegram`);
        break;
      }
    }
  }
}

// ---------- main ----------
const universe = load('universe.json', { universe: [] }).universe;
const journal = load('journal_weekly.json', []);
const seen = load('seen_weekly.json', {});
let signals = 0, errors = 0;

for (const u of universe) {
  let bars;
  try { bars = await getWeekly(u.ticker); await sleep(150); }
  catch { errors++; await sleep(300); continue; }
  if (bars.length < 60) continue;

  const td = computeTDSetup(bars);
  const cd = computeTDCountdown(bars, td);

  manageOpen(journal, u.ticker, bars, cd);

  // revisa las últimas 3 velas semanales cerradas (catch-up de semanas perdidas)
  for (let i = Math.max(0, bars.length - 3); i < bars.length; i++) {
    if (td.bullSetup[i] !== 9 || !td.bullSetupBars[i]) continue;
    const key = `W:${u.ticker}:${bars[i].t}`;
    if (seen[key]) continue;
    seen[key] = true;

    const stop = Math.min(...td.bullSetupBars[i].map(k => bars[k].l));
    const ref = i < bars.length - 1 ? bars[i + 1].o : bars[i].c;
    const entryPx = +(ref * (1 + COST)).toFixed(4);
    const risk = entryPx - stop;
    // suelo de stop 8% (validado: sin él, los stops diminutos se noisean al instante;
    // con él PF 3.98→6.95 y bate al azar 2.42). ~2.5× el 3% del sistema diario.
    if (risk <= 0 || risk / entryPx > MAX_STOP || risk / entryPx < MIN_STOP) continue;

    const open = journal.filter(p => p.status === 'open');
    if (open.length >= CAP) { log(`${u.ticker}: 9 semanal válido pero ya hay ${CAP} abiertas — descartado`); continue; }

    journal.push({
      id: key, ticker: u.ticker, tv: u.tv, sector: u.sector, strategy: 'WeeklySwing',
      status: 'open', signalT: bars[i].t, entryT: bars[i].t, entryPx,
      stop: +stop.toFixed(4), riskPct: +(risk / entryPx * 100).toFixed(1),
    });
    signals++;
    await tgSend(buildStockAlert({
      emoji: '🟣', system: 'Swing Semanal', ticker: u.ticker, sector: u.sector,
      entry: entryPx, entryNote: 'apertura de la próxima semana',
      targetNote: 'con el "13" semanal (techo) o ~12 meses',
      stop, stopNote: 'bajo el suelo del setup-9',
      size: '1% riesgo', horizon: 'semanas a meses (+20% a +100%)',
      why: 'Aguante largo, WR bajo (~20%): pocas ganadoras, pero grandes.',
      tv: u.tv,
    }));
  }
}

save('journal_weekly.json', journal);
save('seen_weekly.json', seen);

// backup versionado del journal (igual que el diario)
try {
  const { execSync } = await import('child_process');
  execSync('git add journal_weekly.json seen_weekly.json 2>/dev/null; git diff --cached --quiet || git commit -q -m "journal weekly: scan ' + new Date().toISOString().slice(0, 10) + '"; git push -q origin main 2>/dev/null || true', { cwd: ROOT, shell: '/bin/zsh' });
} catch {}

const open = journal.filter(p => p.status === 'open');
log(`scan: ${universe.length} tickers, ${signals} señales nuevas, ${errors} errores | abiertas ${open.length}/${CAP}`);
