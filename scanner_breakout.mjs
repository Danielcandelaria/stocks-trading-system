// stocks/scanner_breakout.mjs
// 5º SISTEMA (paper) — BREAKOUT RETEST SEMANAL (idea Justin Banks @RealUGBanks).
// Backtest 10y semanal: PF 2.65 vs azar 1.37 (bate al azar), meseta robusta
// (18/18 variantes WF 4/4), correlación 0.04 con el swing de Carlos (diversifica).
//
// Los 4 pasos del tweet, mecanizados:
//   1. Cruce semanal 8 EMA por encima de 21 EMA (fresco)
//   2. Ruptura de resistencia = cierre > máximo de las 20 semanas previas
//   3. Entrada en el RETEST del nivel de ruptura (límite, ≤6 semanas tras romper)
//   4. Salida "en la siguiente resistencia" → target 2R, o cruce 8<21, o 52 sem
//   Stop: 8% bajo el nivel de ruptura.
//
// ⚠️ Absolutos inflados por supervivencia; el edge REAL es el relativo al azar.
//    El retest asume fill límite en el nivel. Validación que manda: forward.
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

function manageOpen(journal, ticker, bars, e8, e21) {
  for (const pos of journal.filter(p => p.ticker === ticker && p.status === 'open')) {
    const startIdx = bars.findIndex(b => b.t > pos.entryT);
    if (startIdx < 0) continue;
    for (let i = startIdx; i < bars.length; i++) {
      const b = bars[i];
      let exit = null, reason = null;
      if (b.l <= pos.stop) { exit = Math.min(b.o, pos.stop); reason = 'STOP'; }
      else if (b.h >= pos.tp) { exit = Math.max(b.o, pos.tp); reason = 'TARGET 2R'; }
      else if (e8[i] < e21[i]) { exit = b.c; reason = 'cruce 8<21 (tendencia gira)'; }
      else if (i - startIdx >= TIME_W) { exit = b.c; reason = 'TIME 52sem'; }
      if (exit != null) {
        const px = exit * (1 - COST);
        pos.status = 'closed'; pos.exitT = b.t; pos.exitPx = +px.toFixed(4);
        pos.exitReason = reason; pos.retPct = +((px / pos.entryPx - 1) * 100).toFixed(2);
        pos.r = +((px - pos.entryPx) / (pos.entryPx - pos.stop)).toFixed(2); pos.weeksHeld = i - startIdx;
        tgSend(`🟠 <b>CIERRE BREAKOUT RETEST</b> — ${ticker}\n${reason} → <b>${pos.retPct > 0 ? '+' : ''}${pos.retPct}% (${pos.r > 0 ? '+' : ''}${pos.r}R)</b> en ${pos.weeksHeld} semanas\nEntrada $${pos.entryPx} → salida $${pos.exitPx}`);
        break;
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
  manageOpen(journal, u.ticker, bars, e8, e21);

  // detectar: en alguna de las últimas ~8 semanas hubo cruce+ruptura, y AHORA estamos
  // en zona de retest (la última vela cerrada toca el nivel de ruptura por arriba).
  const i = bars.length - 1; // última semana cerrada
  if (e8[i] == null || e21[i] == null) continue;
  // buscar la ruptura más reciente dentro de la ventana de retest
  let breakout = null;
  for (let k = i; k >= Math.max(RES_LB, i - RETEST_W); k--) {
    const cross = e8[k - 1] != null && e8[k - 1] <= e21[k - 1] && e8[k] > e21[k];
    const res = Math.max(...bars.slice(k - RES_LB, k).map(b => b.h));
    if (cross && bars[k].c > res) { breakout = res; break; }
  }
  if (breakout == null) continue;
  // retest: la última vela cerrada bajó a tocar el nivel (low ≤ nivel*(1+band)) y sigue 8>21
  if (bars[i].l > breakout * (1 + RETEST_BAND) || e8[i] <= e21[i]) continue;

  const key = `B:${u.ticker}:${breakout.toFixed(2)}`;
  if (seen[key]) continue;
  seen[key] = true;

  const entryPx = +(breakout * (1 + COST)).toFixed(4);
  const stop = +(breakout * (1 - STOP_BUF)).toFixed(4);
  const risk = entryPx - stop;
  if (risk <= 0) continue;
  const tp = +(entryPx + TP_R * risk).toFixed(4);

  const open = journal.filter(p => p.status === 'open');
  if (open.length >= CAP) { log(`${u.ticker}: retest válido pero ya hay ${CAP} abiertas — descartado`); continue; }

  journal.push({
    id: key, ticker: u.ticker, tv: u.tv, sector: u.sector, strategy: 'BreakoutRetest',
    status: 'open', signalT: bars[i].t, entryT: bars[i].t, entryPx, stop, tp,
    breakout: +breakout.toFixed(4), riskPct: +(risk / entryPx * 100).toFixed(1),
  });
  signals++;
  await tgSend(`🟠 <b>SEÑAL BREAKOUT RETEST — COMPRA (LONG)</b>\n<b>${u.ticker}</b> — ${u.sector}` +
    `\n` +
    `\n📍 <b>ENTRADA</b>: límite en el retest del nivel de ruptura ~$${entryPx.toFixed(2)}` +
    `\n🛑 <b>STOP</b>: $${stop.toFixed(2)} (−${(risk / entryPx * 100).toFixed(1)}%, bajo la ruptura)` +
    `\n🎯 <b>TARGET</b>: $${tp.toFixed(2)} (+2R) — la siguiente resistencia` +
    `\n⏳ <b>Horizonte</b>: semanas a meses · salida también si 8EMA cruza bajo 21EMA` +
    `\n📐 <b>Tamaño</b>: 1% de riesgo / distancia al stop` +
    `\n\nSetup: cruce semanal 8/21 EMA + ruptura de 20 sem + retest. TV (semanal): ${u.tv}`);
}

save('journal_breakout.json', journal);
save('seen_breakout.json', seen);
try {
  const { execSync } = await import('child_process');
  execSync('git add journal_breakout.json seen_breakout.json 2>/dev/null; git diff --cached --quiet || git commit -q -m "journal breakout: scan ' + new Date().toISOString().slice(0, 10) + '"; git push -q origin main 2>/dev/null || true', { cwd: ROOT, shell: '/bin/zsh' });
} catch {}

const open = journal.filter(p => p.status === 'open');
log(`scan: ${universe.length} tickers, ${signals} señales nuevas, ${errors} errores | abiertas ${open.length}/${CAP}`);
