// stocks/scanner_banks_swing.mjs
// RÉPLICA FIEL de la estrategia de Justin Banks (@RealJGBanks) — "Best Swing Setup".
// Distinta del BreakoutRetest simplificado: aquí se implementan los 5 PASOS COMPLETOS.
//
// LOS 5 PASOS (semanal):
//   1. BIAS      : cruce alcista EMA8/EMA21 (la tendencia se gira arriba).
//   2. EXPANSIÓN : tras el cruce, el precio hace máximos más altos (expande hacia supply).
//   3. PULLBACK  : retrocede hasta tocar la EMA8 (no se compra extendido), con 8>21 intacto.
//   4. BOS       : ENTRADA cuando una vela cierra por ENCIMA del máximo del swing de pullback
//                  (Break of Structure = la reversión al alza se confirma) y sobre la EMA8.
//   5. SALIDA    : en la SIGUIENTE zona de supply (resistencia previa por encima) · o trailing
//                  por cierre semanal < EMA8 (Banks aguanta mientras esté sobre la 8) · o time-stop.
//   STOP: mínimo del pullback (queda por DEBAJO de la EMA8) — estructural, como pide Banks.
//
// ⚠️ Operacionalización DECLARADA: "BOS" y "siguiente supply" son cualitativos en Banks;
//    aquí se fijan reglas concretas (ver código). Shadow/paper → la forward decide vs el
//    BreakoutRetest simplificado (que en backtest batía a una versión profunda anterior).
// Telegram = SOLO compras. Paralelo total: HTTP Yahoo semanal, sin chart/CDP. Journal propio.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tgSend } from './tg.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const F = n => join(ROOT, n);
const COST = 0.0005, CROSS_LB = 26, PB_TOL = 0.01, SUPPLY_LB = 60, PIVOT = 2, TIME_W = 52, CAP = 5;
const UA = { 'User-Agent': 'Mozilla/5.0' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const load = (f, d) => existsSync(F(f)) ? JSON.parse(readFileSync(F(f))) : d;
const save = (f, v) => writeFileSync(F(f), JSON.stringify(v, null, 2));
const log = (...a) => console.log(new Date().toISOString(), '[BANKS]', ...a);
const NOW = Date.now() / 1000;
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map((c, i) => { e = e === null ? c : c * k + e * (1 - k); return i >= p - 1 ? e : null; }); };
const isPivotHigh = (W, i, L) => { if (i < L || i + L >= W.length) return false; for (let j = i - L; j <= i + L; j++) if (W[j].h > W[i].h) return false; return true; };

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

// ── LA MÁQUINA DE ESTADOS DE BANKS: ¿la vela cerrada `i` dispara una entrada BOS? ──
function detectEntry(W, e8, e21, i) {
  if (i < 35 || e8[i] == null || e21[i] == null) return null;
  if (!(e8[i] > e21[i])) return null;                          // tendencia alcista intacta (8>21)
  // 1) BIAS: cruce alcista 8/21 más reciente en [i-CROSS_LB, i-2]
  let cross = -1;
  for (let k = i - 2; k >= Math.max(30, i - CROSS_LB); k--)
    if (e8[k - 1] != null && e8[k - 1] <= e21[k - 1] && e8[k] > e21[k]) { cross = k; break; }
  if (cross < 0) return null;
  // 3) PULLBACK: vela más reciente en (cross, i) cuyo low toca la EMA8 y sigue sobre la 21
  let pb = -1;
  for (let j = i - 1; j > cross; j--)
    if (e8[j] != null && W[j].l <= e8[j] * (1 + PB_TOL) && W[j].c > e21[j]) { pb = j; break; }
  if (pb < 0) return null;
  // 2) EXPANSIÓN: entre el cruce y el pullback hubo un máximo más alto que el del cruce
  const expHigh = Math.max(...W.slice(cross, pb + 1).map(b => b.h));
  if (!(expHigh > W[cross].h)) return null;
  const pbHigh = Math.max(...W.slice(pb, i).map(b => b.h));     // máximo del swing de pullback
  const pbLow = Math.min(...W.slice(pb, i).map(b => b.l));      // mínimo del pullback → stop (bajo la 8)
  // 4) BOS: la vela i CIERRA sobre el máximo del pullback y sobre la EMA8
  if (!(W[i].c > pbHigh && W[i].c > e8[i])) return null;
  const entry = W[i].c;
  const stop = pbLow;
  const risk = entry - stop;
  if (risk <= 0 || risk / entry > 0.30 || risk / entry < 0.03) return null;  // stop sano 3-30%
  // 5) TARGET = siguiente supply = pivot-high previo (antes del cruce) MÁS CERCANO por encima de la entrada
  let target = null;
  for (let k = cross - PIVOT - 1; k >= Math.max(PIVOT, cross - SUPPLY_LB); k--)
    if (isPivotHigh(W, k, PIVOT) && W[k].h > entry * 1.01)
      target = target == null ? W[k].h : Math.min(target, W[k].h);
  if (target == null) target = entry + 3 * risk;               // sin supply clara → 3R (la 8 EMA trailea)
  return { entry: +entry.toFixed(4), stop: +stop.toFixed(4), target: +target.toFixed(4),
           riskPct: +(risk / entry * 100).toFixed(1), crossT: W[cross].t, pbT: W[pb].t };
}

// ── gestión de abiertas: target (supply) / cierre < EMA8 (trailing) / time / stop ──
function manageOpen(journal, ticker, W, e8) {
  for (const pos of journal.filter(p => p.ticker === ticker && p.status === 'open')) {
    const start = W.findIndex(b => b.t > pos.entryT);
    if (start < 0) continue;
    for (let i = start; i < W.length; i++) {
      const b = W[i]; let exit = null, reason = null;
      if (b.l <= pos.stop) { exit = Math.min(b.o, pos.stop); reason = 'STOP (bajo pullback/8EMA)'; }
      else if (b.h >= pos.target) { exit = Math.max(b.o, pos.target); reason = 'siguiente SUPPLY (target)'; }
      else if (e8[i] != null && b.c < e8[i]) { exit = b.c; reason = 'cierre < EMA8 (trailing)'; }
      else if (i - start >= TIME_W) { exit = b.c; reason = 'TIME 52sem'; }
      if (exit != null) {
        const px = exit * (1 - COST);
        pos.status = 'closed'; pos.exitT = b.t; pos.exitPx = +px.toFixed(4); pos.exitReason = reason;
        pos.retPct = +((px / pos.entryPx - 1) * 100).toFixed(2);
        pos.r = +((px - pos.entryPx) / (pos.entryPx - pos.stop)).toFixed(2);
        pos.weeksHeld = i - start;
        // CIERRE: interno (journal → dashboard), NO a Telegram (solo compras).
        log(`CIERRE ${ticker}: ${pos.retPct > 0 ? '+' : ''}${pos.retPct}% (${pos.r}R, ${reason}) en ${pos.weeksHeld}sem`);
        break;
      }
    }
  }
}

// ---------- main ----------
const universe = load('universe.json', { universe: [] }).universe;
const journal = load('journal_banks.json', []);
const seen = load('seen_banks.json', {});
// overlay temático (mismos temas que el BreakoutRetest): añade small-caps + tag
const themesRaw = load('themes.json', { themes: {} });
const themeOf = {}; const curated = [];
for (const [name, t] of Object.entries(themesRaw.themes || {})) for (const it of (t.tickers || [])) { themeOf[it.ticker] = { theme: name, strength: t.strength }; curated.push({ tv: it.tv, ticker: it.ticker, sector: it.sector }); }
const haveU = new Set(universe.map(u => u.ticker));
const scanList = [...universe, ...curated.filter(c => !haveU.has(c.ticker))];

let signals = 0, errors = 0;
for (const u of scanList) {
  let bars;
  try { bars = await getWeekly(u.ticker); await sleep(150); }
  catch { errors++; await sleep(300); continue; }
  if (bars.length < 60) continue;
  const cl = bars.map(b => b.c);
  const e8 = ema(cl, 8), e21 = ema(cl, 21);
  manageOpen(journal, u.ticker, bars, e8);

  // detectar entrada en las últimas 3 velas cerradas (catch-up de semanas perdidas)
  for (let i = Math.max(35, bars.length - 3); i < bars.length; i++) {
    const sig = detectEntry(bars, e8, e21, i);
    if (!sig) continue;
    const key = `BK:${u.ticker}:${bars[i].t}`;
    if (seen[key]) continue;
    seen[key] = true;
    const active = journal.filter(p => p.status === 'open');
    if (active.length >= CAP) { log(`${u.ticker}: BOS válido pero ya hay ${CAP} abiertas — descartado`); continue; }
    const th = themeOf[u.ticker] || null;
    const rr = ((sig.target - sig.entry) / (sig.entry - sig.stop)).toFixed(1);
    journal.push({ id: key, ticker: u.ticker, tv: u.tv, sector: u.sector, strategy: 'BanksSwing',
      status: 'open', signalT: bars[i].t, entryT: bars[i].t, entryPx: sig.entry, stop: sig.stop,
      target: sig.target, riskPct: sig.riskPct, theme: th?.theme || null });
    signals++;
    // Telegram SOLO si está en un TEMA FUERTE (regla de Banks "solo operar temas fuertes"
    // + evita spam: dispara ~24/sem en el universo entero). El journal registra TODO
    // para el dashboard/forward; a Telegram solo las accionables por tema.
    if (th && th.strength === 'strong') {
      await tgSend(`🟩 <b>SEÑAL BANKS SWING — COMPRA (LONG)</b>\n<b>${u.ticker}</b> — ${u.sector}` +
        `\n🔥 <b>TEMA: ${th.theme}</b>` +
        `\n` +
        `\n📍 <b>ENTRADA</b>: a mercado ~$${sig.entry.toFixed(2)} (BOS confirmado: cierre semanal sobre el máximo del pullback)` +
        `\n🛑 <b>STOP</b>: $${sig.stop.toFixed(2)} (−${sig.riskPct}%) — bajo el pullback / la EMA8` +
        `\n🎯 <b>TARGET</b>: $${sig.target.toFixed(2)} (siguiente supply, +${rr}R) · o salir si cierra bajo la EMA8` +
        `\n📐 <b>Tamaño</b>: 1% riesgo / distancia al stop` +
        `\n\nMétodo Banks (5 pasos): cruce 8/21 → expansión → pullback a la 8 → BOS → siguiente supply. TV (semanal): ${u.tv}`);
    } else {
      log(`entrada BOS ${u.ticker} (sin tema fuerte) — solo journal/dashboard, no Telegram`);
    }
  }
}

save('journal_banks.json', journal);
save('seen_banks.json', seen);
try {
  const { execSync } = await import('child_process');
  execSync('git add journal_banks.json seen_banks.json 2>/dev/null; git diff --cached --quiet || git commit -q -m "journal banks: scan ' + new Date().toISOString().slice(0, 10) + '"; git push -q origin main 2>/dev/null || true', { cwd: ROOT, shell: '/bin/zsh' });
} catch {}

const open = journal.filter(p => p.status === 'open').length;
log(`scan: ${scanList.length} tickers, ${signals} entradas BOS nuevas, ${errors} errores | abiertas ${open} (cap ${CAP})`);
