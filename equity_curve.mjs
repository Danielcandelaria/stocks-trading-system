// stocks/equity_curve.mjs
// Curva de capital PAPER: simula la cuenta de €ACCOUNT_EUR aplicando el sizing real
// a cada trade CERRADO de todos los sistemas. Muestra equity, retorno, por mes y
// drawdown máximo. Sizing FIJO desde el capital inicial (no compone) — honesto y
// simple con pocos trades. ⚠️ Es paper, edge no validado; orientativo.

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { sizeWithStop, sizeNoStop, ACCOUNT_EUR } from './sizing.mjs';
import { tgSend } from './tg.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const L = f => existsSync(join(ROOT, f)) ? JSON.parse(readFileSync(join(ROOT, f))) : [];

// recolectar todos los trades cerrados con su P&L en euros
const trades = [];
const add = (sys, t, retPct, posEUR) => { if (retPct != null && t) trades.push({ sys, exitT: t, pnl: posEUR * retPct / 100 }); };

for (const p of L('journal.json')) if (p.status === 'closed') {
  if (p.strategy === 'RSI2') add('RSI2', p.exitT, p.retPct, sizeNoStop().posEUR);
  // DeMark registra TP2 y TP3 (mismo trade, 2 variantes de análisis). En una cuenta
  // real tomas UNA posición → cuento solo TP2. P&L = riesgo€ × R (riesgo ya capado).
  else if (p.sl && p.variant === 'TP2' && p.r != null) {
    const { riskEUR } = sizeWithStop(p.entryPx, p.sl);
    trades.push({ sys: 'DeMark', exitT: p.exitT, pnl: riskEUR * p.r });
  }
}
for (const p of L('journal_breakout.json')) if (p.status === 'closed') add('Breakout', p.exitT, p.retPct, sizeWithStop(p.entryPx, p.stop).posEUR);
for (const p of L('journal_weekly.json')) if (p.status === 'closed') add('Swing', p.exitT, p.retPct, sizeWithStop(p.entryPx, p.stop).posEUR);

trades.sort((a, b) => a.exitT - b.exitT);

// curva de equity + drawdown
let eq = ACCOUNT_EUR, peak = ACCOUNT_EUR, maxDD = 0;
const byMonth = {};
for (const t of trades) {
  eq += t.pnl; peak = Math.max(peak, eq); maxDD = Math.min(maxDD, eq - peak);
  const m = new Date(t.exitT * 1000).toISOString().slice(0, 7);
  (byMonth[m] ??= { pnl: 0, n: 0 }); byMonth[m].pnl += t.pnl; byMonth[m].n++;
}

const ret = eq - ACCOUNT_EUR;
const wins = trades.filter(t => t.pnl > 0).length;
const fmt = n => (n >= 0 ? '+' : '') + n.toFixed(0);

const lines = [
  `📈 <b>CURVA DE CAPITAL (paper, €${ACCOUNT_EUR})</b> — ${new Date().toISOString().slice(0, 10)}`,
  ``,
  `<b>Capital ahora: €${eq.toFixed(0)}</b> (${fmt(ret)}€ / ${fmt(ret / ACCOUNT_EUR * 100)}%)`,
  `Trades cerrados: ${trades.length}/30 · aciertos ${trades.length ? (wins / trades.length * 100).toFixed(0) : 0}% · maxDD €${maxDD.toFixed(0)}`,
  ``,
  `<b>Por mes:</b>`,
  ...Object.entries(byMonth).map(([m, d]) => `  ${m}: ${fmt(d.pnl)}€ (${d.n} trades)`),
  ``,
  `<i>⚠️ Paper, edge no validado a 30 trades. Sizing fijo desde €${ACCOUNT_EUR} (no compone). Orientativo.</i>`,
];
export const equityText = lines.join('\n');

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(equityText.replace(/<[^>]+>/g, ''));
  if (process.argv.includes('--telegram')) await tgSend(equityText);
}
