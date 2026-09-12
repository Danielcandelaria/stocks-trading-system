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
const journal = load('journal.json', []);                 // sistemas diarios (DeMark-9 TP2, RSI-2)
const journalWeekly = load('journal_weekly.json', []);    // WeeklySwing (DeMark-9 semanal, paper)
const journalEma = load('journal_emacross.json', []);     // EMACross (forward paper del universo)

// EXPECTATIVAS (backtest + Monte Carlo documentados en BACKTEST_RESULTADOS / METODOLOGIA)
//   tailDependent=true  → sistema convexo de baja WR (momentum): una MEDIA negativa en la muestra
//                         NO es degradación (el edge vive en el top-5%, que puede no haber caído aún).
//                         Se informa, pero NO dispara 🔴; el control real es WR y racha.
//   mc.maxDD=null        → banda Monte Carlo en esa unidad aún NO computada (pendiente); control = racha+WR+exp.
const SPEC = {
  DeMark: {
    label: 'DeMark-9 (TP2)', unit: 'R',
    bt: { wr: 55, perTrade: 0.61 },            // backtest 3yr
    mc: { worstStreak: 6, maxDD: 7 },          // p95 a 30 trades (en R)
    tailDependent: false,
    closed: () => journal.filter(p => p.status === 'closed' && p.variant === 'TP2'),
    val: p => p.r,
  },
  RSI2: {
    label: 'RSI-2', unit: '%',
    bt: { wr: 65, perTrade: 0.41 },
    mc: { worstStreak: 6, maxDD: null },        // sin SL: el control es muestra+WR
    tailDependent: false,
    closed: () => journal.filter(p => p.status === 'closed' && p.strategy === 'RSI2'),
    val: p => p.retPct,
  },
  WeeklySwing: {
    label: 'WeeklySwing (DeMark-9 sem)', unit: '%',
    bt: { wr: 53, perTrade: null },            // WR 53% documentado; perTrade backtest = cota superior (superv.), solo referencia
    mc: { worstStreak: 6, maxDD: null },        // WR media→racha similar a DeMark; banda maxDD% pendiente de MC
    tailDependent: false,                       // reversión-suelo: mediana POSITIVA → media<0 SÍ es señal de degradación
    closed: () => journalWeekly.filter(p => p.status === 'closed'),
    val: p => p.retPct,
  },
  EMACross: {
    label: 'EMACross (forward paper)', unit: '%',
    bt: { wr: 34.8, perTrade: 5.2 },           // documentado (base 10y): PF 1.99, WR 34.8%, ret medio +5.2%, mediana −3.7%
    mc: { worstStreak: 12, maxDD: null },       // baja WR ⇒ rachas largas NORMALES (p95 ≈ 12); banda maxDD% pendiente de MC
    tailDependent: true,                        // convexo: la media puede ser negativa hasta que caiga un pelotazo del top-5%
    closed: () => journalEma.filter(p => p.status === 'closed'),
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

  const flags = [], infos = [];
  // banda 1: racha de pérdidas supera el p95 Monte Carlo (calibrada por WR de cada sistema)
  if (worst > s.mc.worstStreak) flags.push(`racha ${worst} pérdidas > p95 MC (${s.mc.worstStreak})`);
  // banda 2: drawdown supera el p95 (solo si hay banda MC computada en esa unidad)
  if (s.mc.maxDD != null && ddAbs > s.mc.maxDD) flags.push(`drawdown ${ddAbs.toFixed(1)}${s.unit} > p95 MC (${s.mc.maxDD}${s.unit})`);
  // banda 3: WR muy por debajo del backtest con muestra suficiente
  const wrGap = s.bt.wr - wr;
  if (n >= 15 && wrGap > 15) flags.push(`WR ${wr.toFixed(0)}% << backtest ${s.bt.wr}% (−${wrGap.toFixed(0)}pts)`);
  // banda 4: expectativa real negativa con muestra suficiente.
  //   En sistemas tail-dependent (convexos) una media negativa NO es alarma: el edge vive en el top-5%,
  //   que puede no haber caído aún → se INFORMA, y solo es 🔴 si ADEMÁS la WR se hunde bajo el backtest.
  if (n >= 15 && perTrade < 0) {
    if (s.tailDependent) {
      infos.push(`media ${perTrade.toFixed(2)}${s.unit} aún negativa — normal en convexo (tail del top-5% no materializada); vigila WR/racha`);
      if (wrGap > 8) flags.push(`media negativa Y WR ${wr.toFixed(0)}% bajo backtest ${s.bt.wr}% → el tail NO está compensando`);
    } else {
      flags.push(`expectativa real ${perTrade.toFixed(2)}${s.unit} NEGATIVA (sistema NO tail-dependent → señal real)`);
    }
  }

  let verdict, note;
  if (flags.length) { verdict = '🔴'; note = 'DEGRADÁNDOSE — revisar/pausar'; }
  else if (n < 10) { verdict = '🟡'; note = `muestra pequeña (${n}/30) — sin juicio aún`; }
  else { verdict = '🟢'; note = 'dentro de lo esperado'; }

  const btPer = s.bt.perTrade == null ? 'n/d' : `${s.bt.perTrade}${s.unit}`;
  return {
    label: s.label, n, verdict, flags,
    lines: [
      `${verdict} <b>${s.label}</b> — ${note}`,
      `   forward: ${n}tr | WR ${wr.toFixed(0)}% (bt ${s.bt.wr}%) | ${perTrade >= 0 ? '+' : ''}${perTrade.toFixed(2)}${s.unit}/tr (bt ${btPer}) | peor racha ${worst} | maxDD ${ddAbs.toFixed(1)}${s.unit}`,
      ...infos.map(f => `   ℹ️ ${f}`),
      ...flags.map(f => `   ⚠️ ${f}`),
    ],
  };
}

const results = Object.values(SPEC).map(analyze);
const header = `🩺 <b>SALUD FORWARD vs BACKTEST</b> — ${new Date().toISOString().slice(0, 10)}`;
const body = [header, '', ...results.flatMap(r => r.lines), '',
  `<i>Bandas p95 (racha): DeMark/RSI2/WeeklySwing=6, EMACross=12 (baja WR ⇒ rachas largas normales). maxDD MC: DeMark 7R; WeeklySwing/EMACross en % PENDIENTE de MC. 🔴 = cruzó banda → decisión humana.</i>`].join('\n');

console.log(body.replace(/<[^>]+>/g, ''));

// exporta para el reporte semanal
export const healthLines = results.flatMap(r => r.lines);
export const anyRed = results.some(r => r.verdict === '🔴');

// si se ejecuta directo y hay 🔴, alerta a Telegram
if (import.meta.url === `file://${process.argv[1]}`) {
  if (anyRed) { const { tgSend } = await import('./tg.mjs'); await tgSend(body); console.log('🔴 alerta enviada a Telegram'); }
}
