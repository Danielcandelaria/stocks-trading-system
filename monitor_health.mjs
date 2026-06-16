// stocks/monitor_health.mjs
// Panel de salud FORWARD vs BACKTEST (metodología paso 8 + Citadel #10):
// compara los trades paper reales contra las expectativas del backtest y las
// bandas Monte Carlo ya fijadas, y emite un veredicto por estrategia.
// Detecta DEGRADACIÓN del edge antes de que queme la decisión paper→real.
//
// Lo llama el reporte semanal; también corre solo: node monitor_health.mjs
// Alerta 🔴 a Telegram solo si una estrategia cruza una banda de alarma.

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const load = (f, d) => existsSync(join(ROOT, f)) ? JSON.parse(readFileSync(join(ROOT, f))) : d;
const journal = load('journal.json', []);

// EXPECTATIVAS (backtest + Monte Carlo documentados en BACKTEST_RESULTADOS / METODOLOGIA)
const SPEC = {
  DeMark: {
    label: 'DeMark-9 (TP2)', unit: 'R',
    bt: { wr: 55, perTrade: 0.61 },            // backtest 3yr
    mc: { worstStreak: 6, maxDD: 7 },          // p95 a 30 trades (en R)
    closed: () => journal.filter(p => p.status === 'closed' && p.variant === 'TP2'),
    val: p => p.r,
  },
  RSI2: {
    label: 'RSI-2', unit: '%',
    bt: { wr: 65, perTrade: 0.41 },
    mc: { worstStreak: 6, maxDD: null },        // sin SL: el control es muestra+WR
    closed: () => journal.filter(p => p.status === 'closed' && p.strategy === 'RSI2'),
    val: p => p.retPct,
  },
};

function analyze(s) {
  const trades = s.closed().sort((a, b) => a.exitT - b.exitT);
  const n = trades.length;
  if (n === 0) return { label: s.label, n: 0, verdict: '⚪', lines: [`${s.label}: sin trades cerrados aún`] };
  const vals = trades.map(s.val);
  const wins = vals.filter(v => v > 0).length;
  const wr = wins / n * 100;
  const sum = vals.reduce((a, v) => a + v, 0);
  const perTrade = sum / n;
  // racha perdedora actual + máxima, y drawdown de la curva acumulada
  let streak = 0, worst = 0, eq = 0, peak = 0, dd = 0;
  for (const v of vals) { eq += v; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); if (v <= 0) { streak++; worst = Math.max(worst, streak); } else streak = 0; }
  const ddAbs = -dd;

  const flags = [];
  // banda 1: racha de pérdidas supera el p95 Monte Carlo
  if (worst > s.mc.worstStreak) flags.push(`racha ${worst} pérdidas > p95 MC (${s.mc.worstStreak})`);
  // banda 2: drawdown en R supera el p95 (solo DeMark, que tiene R)
  if (s.mc.maxDD != null && ddAbs > s.mc.maxDD) flags.push(`drawdown ${ddAbs.toFixed(1)}R > p95 MC (${s.mc.maxDD}R)`);
  // banda 3: WR muy por debajo del backtest con muestra suficiente
  const wrGap = s.bt.wr - wr;
  if (n >= 15 && wrGap > 15) flags.push(`WR ${wr.toFixed(0)}% << backtest ${s.bt.wr}% (−${wrGap.toFixed(0)}pts)`);
  // banda 4: expectativa real negativa con muestra suficiente
  if (n >= 15 && perTrade < 0) flags.push(`expectativa real ${perTrade.toFixed(2)}${s.unit} NEGATIVA`);

  let verdict, note;
  if (flags.length) { verdict = '🔴'; note = 'DEGRADÁNDOSE — revisar/pausar'; }
  else if (n < 10) { verdict = '🟡'; note = `muestra pequeña (${n}/30) — sin juicio aún`; }
  else { verdict = '🟢'; note = 'dentro de lo esperado'; }

  return {
    label: s.label, n, verdict, flags,
    lines: [
      `${verdict} <b>${s.label}</b> — ${note}`,
      `   forward: ${n}tr | WR ${wr.toFixed(0)}% (bt ${s.bt.wr}%) | ${perTrade >= 0 ? '+' : ''}${perTrade.toFixed(2)}${s.unit}/tr (bt ${s.bt.perTrade}${s.unit}) | peor racha ${worst} | maxDD ${ddAbs.toFixed(1)}${s.unit}`,
      ...flags.map(f => `   ⚠️ ${f}`),
    ],
  };
}

const results = Object.values(SPEC).map(analyze);
const header = `🩺 <b>SALUD FORWARD vs BACKTEST</b> — ${new Date().toISOString().slice(0, 10)}`;
const body = [header, '', ...results.flatMap(r => r.lines), '',
  `<i>Bandas: racha p95=6, DeMark maxDD p95=7R. 🔴 = cruzó banda → decisión humana.</i>`].join('\n');

console.log(body.replace(/<[^>]+>/g, ''));

// exporta para el reporte semanal
export const healthLines = results.flatMap(r => r.lines);
export const anyRed = results.some(r => r.verdict === '🔴');

// si se ejecuta directo y hay 🔴, alerta a Telegram
if (import.meta.url === `file://${process.argv[1]}`) {
  const tg = load('telegram.json', null);
  if (anyRed && tg?.token && tg?.chatId) {
    await fetch(`https://api.telegram.org/bot${tg.token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: tg.chatId, text: body, parse_mode: 'HTML' }),
    });
    console.log('🔴 alerta enviada a Telegram');
  }
}
