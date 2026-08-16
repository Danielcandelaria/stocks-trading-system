// stocks/scanner_forward.mjs
import { buildStockAlert } from './alert_format.mjs';
import { coherentTrade, logDecision } from './integrity.mjs';
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
function sma(cl, p) { const out = new Array(cl.length).fill(null); let s = 0; for (let i = 0; i < cl.length; i++) { s += cl[i]; if (i >= p) s -= cl[i - p]; if (i >= p - 1) out[i] = s / p; } return out; }
function rsi(cl, p) {
  const out = new Array(cl.length).fill(null); let ag = 0, al = 0;
  for (let i = 1; i < cl.length; i++) {
    const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= p) { ag += g / p; al += l / p; if (i === p) out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
    else { ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p; out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
  }
  return out;
}

// ---------- Telegram (multi-destinatario vía helper compartido) ----------
import { tgSend } from './tg.mjs';
async function notify(text) {
  log('SEÑAL/AVISO:', text.replace(/\n/g, ' | '));
  await tgSend(text);
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
        columns: ['name', 'close', 'average_volume_90d_calc', 'market_cap_basic', 'sector', 'EMA50', 'EMA200', 'earnings_release_next_date', 'description'],
        sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' }, range: [0, 500],
      }),
    });
    const j = await res.json();
    // EXCLUIR MLPs (Master Limited Partnerships, nombre acaba en "L.P."/"LP"):
    // retención fiscal US de hasta 37% sobre distribuciones a no residentes +
    // formularios K-1 + muchos brokers EU (T212) no las permiten. No operables
    // en real para un inversor español → fuera del universo desde ya.
    const isMLP = name => /L\.?\s*P\.?$| LP$/.test(name || '');
    const universe = j.data
      .filter(r => !isMLP(r.d[8]))
      .map(r => ({ tv: r.s, ticker: r.d[0], sector: r.d[4], ema50_tv: r.d[5], ema200_tv: r.d[6], nextEarnings: r.d[7] ?? null }));
    const excluded = j.data.length - universe.length;
    if (excluded) log(`excluidas ${excluded} MLPs del universo (fiscalidad/no operables en EU)`);
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
// RSI2 (mean reversion, estilo Connors validado 2026-06-11: PF 1.36, WF 4/4):
// Salida al cierre sobre SMA5 o time-stop 5 velas + STOP DE CATÁSTROFE −20%.
//
// El −20% se añadió el 2026-07-24 tras backtest (backtest_rsi2_safetynet.mjs,
// 3235 señales): un stop CERCANO destruye el edge (EMA10 −70%, −8% −13%) porque
// en mean-reversion salta en el punto de máximo edge. El −20% cuesta −2pp de
// +2414 (nada) y salta 5 veces en 2 años: es un SUELO de catástrofe, no una
// salida normal. NO protege de gaps (abren ya por debajo) — la red real es el
// TAMAÑO PEQUEÑO. Es un límite de tranquilidad, honesto sobre lo que hace.
const RSI2_ENABLED = false;                       // ⛔ RSI2 ELIMINADO 2026-08-16 (petición usuario)
const RSI2_DISASTER = 0.20;                       // stop de catástrofe (fracción)
const RSI2_GAP_MAX = 0.05;                        // guardia de gap: no entrar si abre >5% arriba
function manageOpenRSI2(journal, ticker, bars, s5) {
  for (const pos of journal.filter(p => p.ticker === ticker && p.status === 'open' && p.strategy === 'RSI2')) {
    const startIdx = bars.findIndex(b => b.t > pos.entryT);
    if (startIdx < 0) continue;
    // (La guardia de gap >5% se aplica ANTES, en confirm_open.mjs, al confirmar
    //  la entrada tras la apertura US. Aquí solo se gestionan posiciones ya
    //  confirmadas 'open', cuya entrada es la apertura real del día de compra.)
    const disaster = pos.entryPx * (1 - RSI2_DISASTER);
    for (let i = Math.max(startIdx, bars.length - 15); i < bars.length; i++) {
      const b = bars[i];
      let exitPx = null, reason = null;
      if (b.l <= disaster) {                       // catástrofe primero (peor caso)
        exitPx = Math.min(b.o, disaster); reason = 'CATASTROFE';
      } else if (s5[i] != null && b.c > s5[i]) {
        exitPx = b.c; reason = 'SMA5';
      } else if (i - startIdx >= 5) {
        exitPx = b.c; reason = 'TIME';
      }
      if (exitPx != null) {
        const px = exitPx * (1 - COST);
        pos.status = 'closed'; pos.exitT = b.t; pos.exitPx = +px.toFixed(4);
        pos.exitReason = reason;
        pos.retPct = +((px / pos.entryPx - 1) * 100).toFixed(2);
        // CIERRE: solo INTERNO (log + journal → dashboard), NO a Telegram.
        // El usuario solo quiere señales de COMPRA en Telegram (2026-07-06).
        log(`CIERRE RSI2 ${ticker}: ${pos.retPct > 0 ? '+' : ''}${pos.retPct}% en ${i - startIdx}d (${reason}) — no Telegram`);
        break;
      }
    }
  }
}

function manageOpen(journal, ticker, bars) {
  for (const pos of journal.filter(p => p.ticker === ticker && p.status === 'open' && p.strategy !== 'RSI2')) {
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
        // CIERRE: solo INTERNO (log + journal → dashboard), NO a Telegram.
        log(`CIERRE DeMark ${pos.variant} ${ticker}: ${pos.r > 0 ? '+' : ''}${pos.r}R (${reason}) — no Telegram`);
        break;
      }
    }
  }
}

// ---------- main ----------
import { evaluateBreaker, isPaused } from './circuit_breaker.mjs';
const universe = await getUniverse();
const journal = loadJson('journal.json', []);
const seen = loadJson('seen_signals.json', {});
let signals = 0, errors = 0;

// CIRCUIT-BREAKER: evalúa drawdown contra bandas MC y pausa estrategias degradadas.
// Las entradas nuevas de una estrategia pausada se bloquean (las abiertas siguen).
evaluateBreaker(journal);
const demarkPaused = isPaused('DeMark'), rsi2Paused = isPaused('RSI2');
if (demarkPaused) log('⛔ DeMark PAUSADO por circuit-breaker — no se abren entradas nuevas');
if (rsi2Paused) log('⛔ RSI2 PAUSADO por circuit-breaker — no se abren entradas nuevas');

for (const u of universe) {
  let bars;
  try { bars = await getBars(u.ticker); await sleep(200); }
  catch (e) { errors++; await sleep(400); continue; }
  if (bars.length < 250) continue;

  const cl = bars.map(b => b.c);
  const e50 = ema(cl, 50), e200 = ema(cl, 200);
  const s5 = sma(cl, 5), r2 = rsi(cl, 2);
  const td = computeTDSetup(bars);

  manageOpen(journal, u.ticker, bars);
  if (RSI2_ENABLED) manageOpenRSI2(journal, u.ticker, bars, s5);

  // --- Sistema RSI2 (mean reversion): RSI(2)<10 + precio>EMA200, vela cerrada.
  // Paper SIN stop (spec Connors validada). Máx 5 posiciones abiertas a la vez.
  {
    const i = bars.length - 1;
    const openRSI2 = journal.filter(p => p.status === 'open' && p.strategy === 'RSI2');
    const rKey = `RSI2:${u.ticker}:${bars[i].t}`;
    if (RSI2_ENABLED && !rsi2Paused && r2[i] != null && e200[i] != null && r2[i] < 10 && bars[i].c > e200[i] && !seen[rKey]) {
      seen[rKey] = true;
      if (openRSI2.length >= 5) {
        log(`RSI2 ${u.ticker}: señal válida pero ya hay 5 abiertas — descartada`);
      } else {
        const entryPx = +(bars[i].c * (1 + COST)).toFixed(4);
        // volumen relativo de la vela de pánico (research 2026-06-17: relVol≥1.5
        // sube el PF de 1.38 a 1.62 en backtest). Se REGISTRA (no filtra) para
        // confirmar el hallazgo en forward sin cambiar la spec en validación.
        const vAvg = bars.slice(Math.max(0, i - 20), i).reduce((s, x) => s + x.v, 0) / Math.min(i, 20);
        const relVol = vAvg ? +(bars[i].v / vAvg).toFixed(2) : null;
        // VERIFICADOR DE COHERENCIA: el número no cuadra → no se registra.
        const chk = coherentTrade({ ticker: u.ticker, entry: entryPx, stop: +(entryPx * (1 - RSI2_DISASTER)).toFixed(2), target: s5[i] }, bars[i]);
        if (!chk.ok) { log(`RSI2 ${u.ticker}: DESCARTADA por coherencia — ${chk.reason}`); seen[rKey] = true; continue; }
        // 2 FASES (2026-07-30): el scan corre ANTES de la apertura US → aún no
        // se sabe el gap. La señal queda PENDING_OPEN (sin avisar); confirm_open.mjs
        // la confirma tras la apertura, comprueba el gap ≤5% él solo, y solo
        // entonces manda "COMPRA ahora". El usuario NO revisa nada.
        journal.push({
          id: rKey, ticker: u.ticker, tv: u.tv, sector: u.sector, strategy: 'RSI2', variant: 'RSI2',
          status: 'pending_open', signalT: bars[i].t,
          signalClose: bars[i].c,                  // ref del gap (apertura vs este cierre)
          targetRef: +s5[i].toFixed(2),            // SMA5: referencia de venta
          rsi2: +r2[i].toFixed(1), relVol,
        });
        logDecision({ system: 'RSI2', action: 'DETECT', ticker: u.ticker, signalClose: bars[i].c, rsi2: +r2[i].toFixed(1) });
        signals++;
        log(`RSI2 ${u.ticker}: señal detectada → PENDIENTE de confirmar al abrir (gap ≤5%), sin avisar aún`);
      }
    }
  }

  // Revisa las últimas 3 velas CERRADAS (no solo la última): si una noche el Mac
  // estuvo apagado a las 22:30, la señal de ese día se recupera en el siguiente
  // scan. El dedup (seen) evita avisos duplicados.
  for (let i = Math.max(0, bars.length - 3); i < bars.length; i++) {
  const isCatchUp = i < bars.length - 1;
  if (e200[i] == null || e50[i] <= e200[i]) continue;
  if (bars[i].c <= e200[i]) continue; // precio debe estar SOBRE la EMA200 (filtro anti-HCA)
  // contraste con TV cuando el screener trae las EMAs (fuente de verdad) — solo vela actual
  if (!isCatchUp && u.ema50_tv != null && u.ema200_tv != null && u.ema50_tv <= u.ema200_tv) continue;

  if (demarkPaused) continue; // circuit-breaker: DeMark pausado, no abrir
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
      // descarte por earnings = RUIDO en Telegram → solo log interno (2026-07-06).
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

  // VERIFICADOR DE COHERENCIA (DeMark): número que no cuadra con la vela → fuera.
  const chkD = coherentTrade({ ticker: u.ticker, entry: +entryPx.toFixed(4), stop: +sl.toFixed(4), target: +(entryPx + 2 * risk).toFixed(4) }, bars[i]);
  if (!chkD.ok) { log(`DeMark ${u.ticker}: DESCARTADA por coherencia — ${chkD.reason}`); continue; }
  for (const [variant, mult] of [['TP2', 2], ['TP3', 3]]) {
    journal.push({
      id: `${key}:${variant}`, ticker: u.ticker, tv: u.tv, sector: u.sector, variant,
      status: 'open', signalT: bars[i].t, entryT: isCatchUp ? bars[i + 1].t : bars[i].t,
      entryPx: +entryPx.toFixed(4), sl: +sl.toFixed(4), tp: +(entryPx + mult * risk).toFixed(4),
      risk: +risk.toFixed(4), riskPct: +(risk / entryPx * 100).toFixed(2),
    });
  }
  logDecision({ system: 'DeMark9', action: 'ENTER', ticker: u.ticker, entry: +entryPx.toFixed(4), stop: +sl.toFixed(4), riskPct: +(risk / entryPx * 100).toFixed(2) });
  signals++;

  // CONTROL DE CALOR DE CARTERA (regla profesional): con 1% de riesgo/trade,
  // máx 4 posiciones abiertas (4% de cuenta en juego) y máx 2 por sector.
  // En paper se registra igual (queremos el dato), pero el aviso lo advierte.
  const openTP2 = journal.filter(p => p.status === 'open' && p.variant === 'TP2');
  const heatWarn = openTP2.length >= 4 ? `\n🔥 <b>CALOR: ya hay ${openTP2.length} posiciones abiertas (límite 4) — NO añadir riesgo real</b>`
    : openTP2.filter(p => p.sector === u.sector).length >= 2 ? `\n🔥 <b>CALOR: ya hay 2 abiertas en ${u.sector} — NO concentrar sector</b>` : '';

  // Aviso en el formato LIMPIO compartido (igual que los demás sistemas).
  const tp3 = +(entryPx + 3 * risk).toFixed(2);
  const heat = openTP2.length >= 4 ? ` · ⚠️ ya ${openTP2.length} abiertas, NO añadir riesgo`
    : openTP2.filter(p => p.sector === u.sector).length >= 2 ? ` · ⚠️ 2 abiertas en ${u.sector}, no concentrar` : '';
  const recup = isCatchUp ? '♻️ recuperada · ' : '';
  await notify(buildStockAlert({
    emoji: '🟢', ticker: u.ticker,
    entry: +entryPx.toFixed(2),
    target: +(entryPx + 2 * risk).toFixed(2), rr: 2,
    stop: +sl.toFixed(2),
    note: `${recup}compra en la apertura US (15:30) · 2º objetivo $${tp3} (+3R)${heat}`,
    tv: u.tv,
  }));
  } // fin bucle últimas 3 velas
}

// TRADES ZOMBI: posiciones abiertas cuyo ticker ya NO está en el universo
// (cayó del top-500 en un refresh). Sin esto quedarían sin desenlace y el
// forward dejaría de ser un backtest realista. Se gestionan siempre.
const scanned = new Set(universe.map(u => u.ticker));
const orphans = [...new Set(journal.filter(p => p.status === 'open' && !scanned.has(p.ticker)).map(p => p.ticker))];
for (const tk of orphans) {
  try {
    const bars = await getBars(tk); await sleep(200);
    const s5 = sma(bars.map(b => b.c), 5);
    manageOpen(journal, tk, bars);
    manageOpenRSI2(journal, tk, bars, s5);
    log(`huérfano ${tk}: posiciones abiertas gestionadas fuera de universo`);
  } catch (e) { log(`huérfano ${tk}: sin datos (${e.message}) — revisar a mano si persiste`); }
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
