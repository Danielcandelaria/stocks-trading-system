// stocks/scanner_forward.mjs
// Scanner FORWARD en PAPER — acciones US, diario. Sistema PARALELO:
// no toca chart/CDP/mutex ni nada del motor forex.
//
// Spec (backtest 2026-06-10, sweep 4/4 WF — ver BACKTEST_RESULTADOS_STOCKS.md):
//   Señal : DeMark setup-9 BUY *perfeccionado* en vela diaria CERRADA
//   Régimen: EMA50 > EMA200 Y precio > EMA200 (mejora 2026-06-10: evita comprar
//            tendencias ya rotas donde las medias aún no cruzaron — caso HCA;
//            backtest: R/tr 0.56→0.61, WF 4/4, ver BACKTEST_RESULTADOS_STOCKS.md)
//   Stop  : low del setup (setupLowBull), distancia mínima 3% del precio
//   Targets: TP2 (2R) y TP3 (3R) trackeados en paralelo; time-stop 40 velas
//
// Datos: universo = screener REST de TV (fuente TV). Barras = Yahoo (aproximación
// declarada). Telegram: token/chat en stocks/telegram.json → { token, chatId }.
// Journal: stocks/journal.json. Dedup señales: stocks/seen_signals.json.
//
// Uso: node scanner_forward.mjs            (escanea + gestiona posiciones abiertas)

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { computeTDSetup, isPerfected } from '../scanner/demark_calc.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const F = name => join(ROOT, name);
const COST = 0.0005, MIN_STOP = 0.03, MAX_STOP = 0.25, TIME_STOP = 40;
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const loadJson = (f, def) => existsSync(F(f)) ? JSON.parse(readFileSync(F(f))) : def;
const saveJson = (f, v) => writeFileSync(F(f), JSON.stringify(v, null, 2));
const log = (...a) => console.log(new Date().toISOString(), ...a);

function ema(cl, p) { const k = 2 / (p + 1); let e = null; return cl.map((c, i) => { e = e === null ? c : c * k + e * (1 - k); return i >= p - 1 ? e : null; }); }

// ---------- Telegram (opcional hasta tener token) ----------
const tg = loadJson('telegram.json', null);
async function notify(text) {
  log('SEÑAL/AVISO:', text.replace(/\n/g, ' | '));
  if (!tg?.token || !tg?.chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${tg.token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: tg.chatId, text, parse_mode: 'HTML' }),
    });
  } catch (e) { log('telegram error:', e.message); }
}

// ---------- universo (refresco semanal vía screener TV) ----------
async function getUniverse() {
  const cached = loadJson('universe.json', null);
  const ageDays = cached ? (Date.now() - new Date(cached.generatedAt)) / 864e5 : Infinity;
  if (cached && ageDays < 7) return cached.universe;
  try {
    const res = await fetch('https://scanner.tradingview.com/america/scan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filter: [
          { left: 'market_cap_basic', operation: 'greater', right: 2_000_000_000 },
          { left: 'average_volume_90d_calc', operation: 'greater', right: 1_000_000 },
          { left: 'close', operation: 'greater', right: 10 },
          { left: 'type', operation: 'equal', right: 'stock' },
          { left: 'is_primary', operation: 'equal', right: true },
        ],
        columns: ['name', 'close', 'average_volume_90d_calc', 'market_cap_basic', 'sector', 'EMA50', 'EMA200', 'earnings_release_next_date'],
        sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' }, range: [0, 500],
      }),
    });
    const j = await res.json();
    const universe = j.data.map(r => ({ tv: r.s, ticker: r.d[0], sector: r.d[4], ema50_tv: r.d[5], ema200_tv: r.d[6], nextEarnings: r.d[7] ?? null }));
    saveJson('universe.json', { generatedAt: new Date().toISOString(), totalCount: j.totalCount, universe });
    log(`universo refrescado: ${universe.length} tickers`);
    return universe;
  } catch (e) {
    log('screener TV no disponible, uso cache:', e.message);
    if (cached) return cached.universe;
    throw e;
  }
}

// ---------- barras diarias (Yahoo, ~400 velas) ----------
async function getBars(ticker) {
  const y = ticker.replace('.', '-');
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=2y&interval=1d`, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const r = (await res.json()).chart?.result?.[0];
  const q = r?.indicators?.quote?.[0];
  if (!r?.timestamp || !q) throw new Error('sin datos');
  const bars = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    if (q.open[i] == null || q.close[i] == null) continue;
    bars.push({ t: r.timestamp[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] ?? 0 });
  }
  // descartar la vela de HOY si el mercado aún no cerró (señales solo en vela cerrada)
  const last = bars[bars.length - 1];
  const lastDay = new Date(last.t * 1000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const closed = r.meta?.currentTradingPeriod?.regular?.end;
  if (lastDay === today && closed && Date.now() / 1000 < closed) bars.pop();
  return bars;
}

// ---------- gestión de posiciones paper abiertas ----------
function manageOpen(journal, ticker, bars) {
  for (const pos of journal.filter(p => p.ticker === ticker && p.status === 'open')) {
    const startIdx = bars.findIndex(b => b.t > pos.entryT);
    if (startIdx < 0) continue;
    for (let i = Math.max(startIdx, bars.length - 30); i < bars.length; i++) {
      const b = bars[i];
      let exit = null, reason = null;
      if (b.l <= pos.sl) { exit = Math.min(b.o, pos.sl); reason = 'SL'; }
      else if (b.h >= pos.tp) { exit = Math.max(b.o, pos.tp); reason = 'TP'; }
      else if (i - startIdx >= TIME_STOP) { exit = b.c; reason = 'TIME'; }
      if (exit) {
        const px = exit * (1 - COST);
        pos.status = 'closed'; pos.exitT = b.t; pos.exitPx = +px.toFixed(4);
        pos.exitReason = reason; pos.r = +((px - pos.entryPx) / pos.risk).toFixed(2);
        notify(`📕 <b>CIERRE ${pos.variant}</b> ${ticker} ${reason} → ${pos.r > 0 ? '+' : ''}${pos.r}R` +
          `\nEntrada ${pos.entryPx} → salida ${pos.exitPx}`);
        break;
      }
    }
  }
}

// ---------- main ----------
const universe = await getUniverse();
const journal = loadJson('journal.json', []);
const seen = loadJson('seen_signals.json', {});
let signals = 0, errors = 0;

for (const u of universe) {
  let bars;
  try { bars = await getBars(u.ticker); await sleep(200); }
  catch (e) { errors++; await sleep(400); continue; }
  if (bars.length < 250) continue;

  manageOpen(journal, u.ticker, bars);

  const cl = bars.map(b => b.c);
  const e50 = ema(cl, 50), e200 = ema(cl, 200);
  const td = computeTDSetup(bars);

  // Revisa las últimas 3 velas CERRADAS (no solo la última): si una noche el Mac
  // estuvo apagado a las 22:30, la señal de ese día se recupera en el siguiente
  // scan. El dedup (seen) evita avisos duplicados.
  for (let i = Math.max(0, bars.length - 3); i < bars.length; i++) {
  const isCatchUp = i < bars.length - 1;
  if (e200[i] == null || e50[i] <= e200[i]) continue;
  if (bars[i].c <= e200[i]) continue; // precio debe estar SOBRE la EMA200 (filtro anti-HCA)
  // contraste con TV cuando el screener trae las EMAs (fuente de verdad) — solo vela actual
  if (!isCatchUp && u.ema50_tv != null && u.ema200_tv != null && u.ema50_tv <= u.ema200_tv) continue;

  if (td.bullSetup[i] !== 9 || !td.bullSetupBars[i]) continue;
  if (!isPerfected(bars, td.bullSetupBars[i], 'bull')) continue;

  const key = `${u.ticker}:${bars[i].t}`;
  if (seen[key]) continue;
  seen[key] = true;

  // GUARDIA DE EARNINGS (regla de riesgo profesional, no backtesteada por falta
  // de histórico de fechas): un gap de resultados atraviesa cualquier stop.
  // No entrar si la empresa publica resultados en los próximos 7 días.
  if (u.nextEarnings) {
    const daysToER = (u.nextEarnings - bars[i].t) / 86400;
    if (daysToER >= 0 && daysToER <= 7) {
      log(`${u.ticker}: señal válida pero earnings en ${daysToER.toFixed(0)} días — DESCARTADA (guardia ER)`);
      await notify(`⚠️ Señal en ${u.ticker} descartada: earnings en ${daysToER.toFixed(0)} días (riesgo de gap).`);
      continue;
    }
  }

  const sl = Math.min(...td.bullSetupBars[i].map(k => bars[k].l));
  // entrada: open real del día siguiente si ya existe (señal recuperada);
  // si la señal es de la última vela, estimación open de mañana ≈ close de hoy
  const ref = isCatchUp ? bars[i + 1].o : bars[i].c;
  const entryPx = ref * (1 + COST);
  const risk = entryPx - sl;
  if (risk <= 0 || risk / entryPx > MAX_STOP) continue;
  if (risk / entryPx < MIN_STOP) { log(`${u.ticker}: setup-9 perf pero stop ${(risk / entryPx * 100).toFixed(1)}% < 3% — descartado`); continue; }

  for (const [variant, mult] of [['TP2', 2], ['TP3', 3]]) {
    journal.push({
      id: `${key}:${variant}`, ticker: u.ticker, tv: u.tv, sector: u.sector, variant,
      status: 'open', signalT: bars[i].t, entryT: isCatchUp ? bars[i + 1].t : bars[i].t,
      entryPx: +entryPx.toFixed(4), sl: +sl.toFixed(4), tp: +(entryPx + mult * risk).toFixed(4),
      risk: +risk.toFixed(4), riskPct: +(risk / entryPx * 100).toFixed(2),
    });
  }
  signals++;

  // CONTROL DE CALOR DE CARTERA (regla profesional): con 1% de riesgo/trade,
  // máx 4 posiciones abiertas (4% de cuenta en juego) y máx 2 por sector.
  // En paper se registra igual (queremos el dato), pero el aviso lo advierte.
  const openTP2 = journal.filter(p => p.status === 'open' && p.variant === 'TP2');
  const heatWarn = openTP2.length >= 4 ? `\n🔥 <b>CALOR: ya hay ${openTP2.length} posiciones abiertas (límite 4) — NO añadir riesgo real</b>`
    : openTP2.filter(p => p.sector === u.sector).length >= 2 ? `\n🔥 <b>CALOR: ya hay 2 abiertas en ${u.sector} — NO concentrar sector</b>` : '';

  await notify(`🟢 <b>SEÑAL STOCKS (paper)</b> — ${u.ticker} (${u.sector})` +
    (isCatchUp ? `\n♻️ <i>Señal RECUPERADA del ${new Date(bars[i].t * 1000).toISOString().slice(0, 10)} (scan perdido) — entrada al open real siguiente</i>` : '') +
    `\nDeMark setup-9 BUY perfeccionado + EMA50>200 + precio>EMA200 (diario)` +
    `\nEntrada ~${entryPx.toFixed(2)} | SL ${sl.toFixed(2)} (${(risk / entryPx * 100).toFixed(1)}%)` +
    `\nTP2 ${(entryPx + 2 * risk).toFixed(2)} | TP3 ${(entryPx + 3 * risk).toFixed(2)}` +
    `\nTamaño: riesgo fijo 1% de cuenta / distancia al SL` +
    heatWarn +
    `\nConfirmar a ojo en TV: ${u.tv}`);
  } // fin bucle últimas 3 velas
}

saveJson('journal.json', journal);
saveJson('seen_signals.json', seen);

// backup versionado del track record (lección del journal corrupto del e12 legacy):
// commit local automático tras cada scan — historial completo del journal.
try {
  const { execSync } = await import('child_process');
  execSync('git add journal.json seen_signals.json universe.json 2>/dev/null; git diff --cached --quiet || git commit -q -m "journal: scan ' + new Date().toISOString().slice(0, 10) + '"; git push -q origin main 2>/dev/null || true', { cwd: ROOT, shell: '/bin/zsh' });
} catch (e) { log('git backup skip:', e.message.slice(0, 80)); }

const open = journal.filter(p => p.status === 'open').length;
const closed = journal.filter(p => p.status === 'closed');
const sumR = v => closed.filter(p => p.variant === v).reduce((s, p) => s + p.r, 0).toFixed(1);
log(`scan completo: ${universe.length} tickers, ${signals} señales nuevas, ${errors} errores de datos`);
log(`journal: ${open} abiertas, ${closed.length} cerradas | ΣR TP2=${sumR('TP2')} TP3=${sumR('TP3')}`);
