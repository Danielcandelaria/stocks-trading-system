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
//   1. RUPTURA detectada (cierre semanal > máx 8sem RECIENTES + cruce 8>21) → 'pending' +
//      (fix 2026-06-18: 8sem no 20 — el máx de 20sem captura resistencias OBSOLETAS
//       cuando la acción cayó meses y luego explotó; SNOW daba $236 de hace 5 meses en
//       vez del nivel real de ruptura $177. Detectado por el usuario. 8sem valida igual:
//       PF 1.84 vs azar 1.37, WF 4/4, y da el nivel correcto y operable.)
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
const COST = 0.0005, RES_LB = 8, BREAK_MIN = 1.03, BREAK_MAX = 1.15, RETEST_W = 6, RETEST_BAND = 0.02, STOP_BUF = 0.08, TP_R = 2, TIME_W = 52, CAP = 5;
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

async function getDaily(ticker) {
  const y = ticker.replace('.', '-');
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=3mo&interval=1d`, { headers: UA });
  const r = (await res.json()).chart?.result?.[0];
  const q = r?.indicators?.quote?.[0];
  if (!r?.timestamp || !q) return [];
  const bars = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    if (q.close[i] == null) continue;
    bars.push({ t: r.timestamp[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
  }
  return bars;
}

// Gestión de posiciones a resolución DIARIA (para avisar del retest A TIEMPO):
//   pending → vigila en diario; el día que el precio TOCA el nivel → 🟠 ENTRA AHORA
//   open    → vigila stop/target en diario; cruce 8<21 y time en semanal
async function managePositions(journal, ticker, weekly, e8, e21) {
  const active = journal.filter(p => p.ticker === ticker && (p.status === 'pending' || p.status === 'open'));
  if (!active.length) return;
  let daily; try { daily = await getDaily(ticker); await sleep(120); } catch { daily = []; }

  for (const pos of active) {
    if (pos.status === 'pending') {
      // el retest se busca DESPUÉS de cerrar la semana de ruptura (signalT = lunes
      // de esa semana → +7 días = lunes siguiente). Si no, la propia vela de ruptura
      // cuenta como retest (bug: su rango intra-semana baja del nivel antes de romper).
      const ds = daily.filter(b => b.t >= pos.signalT + 7 * 86400);
      // RETEST = el precio entra en la ZONA (dentro del 2% del nivel), no el toque
      // exacto. El edge está aquí: el backtest exacto da PF 1.42, la zona 2.11.
      const level = pos.level ?? pos.entryPx;
      const hit = ds.find(b => b.l <= level * (1 + RETEST_BAND));
      if (hit) {
        pos.status = 'open'; pos.entryT = hit.t;
        // entrada a MERCADO al entrar en la zona (no el nivel idealizado más barato)
        pos.entryPx = +Math.min(hit.c, level * (1 + RETEST_BAND)).toFixed(4);
        pos.tp = +(pos.entryPx + TP_R * (pos.entryPx - pos.stop)).toFixed(4);
        pos.riskPct = +((pos.entryPx - pos.stop) / pos.entryPx * 100).toFixed(1);
        if (NOW - hit.t < 4 * 86400) {
          await tgSend(`🟢🟠 <b>RETEST AHORA — ENTRA</b> — ${ticker}\n` +
            `El precio entró en la zona de retest: <b>COMPRA a mercado ~$${pos.entryPx}</b>\n` +
            `🛑 Stop $${pos.stop} (−${pos.riskPct}%) · 🎯 Target $${pos.tp} (+2R)\n` +
            `Aguante: semanas a meses. Esta es tu entrada — tomas el movimiento completo desde aquí.`);
        } else {
          log(`${ticker}: retest histórico ${new Date(hit.t * 1000).toISOString().slice(0, 10)} — registrado sin alerta`);
        }
      } else if (NOW - pos.signalT > RETEST_W * 7 * 86400) {
        pos.status = 'cancelled'; pos.exitT = NOW;
        log(`${ticker}: ruptura caducada sin retest (${RETEST_W} sem)`);
      }
    }
    if (pos.status === 'open') {
      // stop/target en diario
      const ds = daily.filter(b => b.t >= pos.entryT);
      let exit = null, reason = null;
      for (const b of ds) {
        if (b.l <= pos.stop) { exit = Math.min(b.o, pos.stop); reason = 'STOP'; break; }
        if (b.h >= pos.tp) { exit = Math.max(b.o, pos.tp); reason = 'TARGET 2R'; break; }
      }
      // salida por giro de tendencia (cruce 8<21) o time-stop, en semanal
      if (!exit) {
        const wi = weekly.length - 1;
        const wksHeld = weekly.filter(b => b.t >= pos.entryT).length;
        if (e8[wi] != null && e8[wi] < e21[wi]) { exit = weekly[wi].c; reason = 'cruce 8<21 (tendencia gira)'; }
        else if (wksHeld >= TIME_W) { exit = weekly[wi].c; reason = 'TIME 52sem'; }
      }
      if (exit != null) {
        const px = exit * (1 - COST);
        pos.status = 'closed'; pos.exitT = NOW; pos.exitPx = +px.toFixed(4);
        pos.exitReason = reason; pos.retPct = +((px / pos.entryPx - 1) * 100).toFixed(2);
        pos.r = +((px - pos.entryPx) / (pos.entryPx - pos.stop)).toFixed(2);
        await tgSend(`🟠 <b>CIERRE BREAKOUT RETEST</b> — ${ticker}\n${reason} → <b>${pos.retPct > 0 ? '+' : ''}${pos.retPct}% (${pos.r > 0 ? '+' : ''}${pos.r}R)</b>\nEntrada $${pos.entryPx} → salida $${pos.exitPx}`);
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
  await managePositions(journal, u.ticker, bars, e8, e21);

  // ¿RUPTURA en la última vela semanal cerrada (+ catch-up de 2 semanas)?
  for (let i = Math.max(RES_LB, bars.length - 3); i < bars.length; i++) {
    if (e8[i] == null || e21[i] == null) continue;
    const cross = e8[i - 1] != null && e8[i - 1] <= e21[i - 1] && e8[i] > e21[i];
    const resist = Math.max(...bars.slice(i - RES_LB, i).map(b => b.h));
    // ruptura DECISIVA pero no FUGITIVA: cierre entre +3% y +15% sobre la resistencia.
    //  - mínimo 3%: filtra blips marginales en bajista (AMT +2.93% que falló).
    //  - máximo 15%: filtra gaps explosivos (SNOW +44%: el "retest" al nivel queda
    //    24% por debajo del precio actual = entrada irreal. Detectado por el usuario.)
    //  Backtest: PF 2.01→2.04, WF 4/4.
    const dist = bars[i].c / resist;
    if (!(cross && dist > BREAK_MIN && dist < BREAK_MAX)) continue;

    const key = `B:${u.ticker}:${bars[i].t}`;
    if (seen[key]) continue;
    seen[key] = true;

    const entryPx = +resist.toFixed(4);           // límite = nivel de ruptura
    const stop = +(resist * (1 - STOP_BUF)).toFixed(4);
    const risk = entryPx - stop;
    const tp = +(entryPx + TP_R * risk).toFixed(4);

    const active = journal.filter(p => p.status === 'pending' || p.status === 'open');
    if (active.length >= CAP) { log(`${u.ticker}: ruptura válida pero ya hay ${CAP} activas — descartada`); continue; }

    const zoneTop = +(resist * (1 + RETEST_BAND)).toFixed(2); // borde superior de la zona
    journal.push({
      id: key, ticker: u.ticker, tv: u.tv, sector: u.sector, strategy: 'BreakoutRetest',
      status: 'pending', signalT: bars[i].t, level: entryPx, entryPx, stop, tp,
      breakClose: +bars[i].c.toFixed(4), riskPct: +(risk / entryPx * 100).toFixed(1),
    });
    signals++;
    await tgSend(`🔭 <b>PREAVISO — VIGILAR RETEST</b>\n<b>${u.ticker}</b> — ${u.sector}` +
      `\n` +
      `\n⚡ Rompió resistencia (cierre semanal $${bars[i].c.toFixed(2)}, cruce 8/21 EMA). Setup armado.` +
      `\n👀 <b>Espera a que el precio RETROCEDA a la zona $${resist.toFixed(2)}–$${zoneTop}</b> — te avisaré 🟢 ENTRA AHORA el día que entre en ella (compra a mercado).` +
      `\n🛑 Stop previsto $${stop.toFixed(2)} (~−8%) · 🎯 Target ~$${tp.toFixed(2)} (+2R)` +
      `\n⏳ Si no retrocede en ~6 semanas, se descarta. NO entres aún — espera la señal de entrada.` +
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
