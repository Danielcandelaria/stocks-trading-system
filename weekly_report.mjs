// stocks/weekly_report.mjs
// Reporte semanal de gestor (domingos 20:00 vía LaunchAgent com.stocks.report):
// estado del journal paper → Telegram. Métricas que mira un desk profesional:
// expectancy (R/trade), WR, ΣR por variante, drawdown de la curva de R,
// actividad de la semana y posiciones abiertas con su riesgo.

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { healthLines } from './monitor_health.mjs';
import { tgSend } from './tg.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const load = f => existsSync(join(ROOT, f)) ? JSON.parse(readFileSync(join(ROOT, f))) : null;

const journal = load('journal.json') ?? [];
const tg = load('telegram.json');
const now = Date.now() / 1000, weekAgo = now - 7 * 86400;

function variantStats(v) {
  const closed = journal.filter(p => p.variant === v && p.status === 'closed').sort((a, b) => a.exitT - b.exitT);
  if (!closed.length) return { n: 0, line: `${v}: sin trades cerrados aún` };
  const rs = closed.map(p => p.r);
  const sum = rs.reduce((s, r) => s + r, 0);
  const wr = rs.filter(r => r > 0).length / rs.length;
  // drawdown de la curva de R acumulada
  let peak = 0, dd = 0, eq = 0;
  for (const r of rs) { eq += r; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); }
  return {
    n: closed.length,
    line: `<b>${v}</b>: ${closed.length}tr | WR ${(wr * 100).toFixed(0)}% | ΣR ${sum >= 0 ? '+' : ''}${sum.toFixed(1)} | exp ${(sum / closed.length).toFixed(2)}R/tr | maxDD ${dd.toFixed(1)}R`,
  };
}

const open = journal.filter(p => p.status === 'open' && p.variant === 'TP2');
const newWeek = journal.filter(p => p.variant === 'TP2' && p.signalT >= weekAgo);
const closedWeek = journal.filter(p => p.status === 'closed' && p.exitT >= weekAgo && p.variant === 'TP2');

const lines = [
  `📊 <b>REPORTE SEMANAL STOCKS (paper)</b> — ${new Date().toISOString().slice(0, 10)}`,
  ``,
  `<b>Esta semana:</b> ${newWeek.length} señales nuevas, ${closedWeek.length} cierres` +
    (closedWeek.length ? ` (${closedWeek.map(p => `${p.ticker} ${p.r > 0 ? '+' : ''}${p.r}R`).join(', ')})` : ''),
  ``,
  variantStats('TP2').line,
  variantStats('TP3').line,
  (() => {
    const c = journal.filter(p => p.strategy === 'RSI2' && p.status === 'closed');
    if (!c.length) return '<b>RSI2</b>: sin trades cerrados aún';
    const sum = c.reduce((s, p) => s + p.retPct, 0);
    const wr = c.filter(p => p.retPct > 0).length / c.length;
    const open = journal.filter(p => p.strategy === 'RSI2' && p.status === 'open').length;
    return `<b>RSI2</b>: ${c.length}tr | WR ${(wr * 100).toFixed(0)}% | Σ ${sum >= 0 ? '+' : ''}${sum.toFixed(1)}% | ${open}/5 abiertas`;
  })(),
  (() => {
    const ms = load('momentum_state.json') ?? { months: [] };
    const last = ms.months?.[ms.months.length - 1];
    return last ? `<b>MOMENTUM</b>: portfolio ${last.month}: ${last.portfolio.map(p => p.ticker).join(', ')}` : '<b>MOMENTUM</b>: sin portfolio aún';
  })(),
  ``,
  open.length
    ? `<b>Abiertas (${open.length}/4):</b>\n` + open.map(p => `· ${p.ticker} @${p.entryPx} SL ${p.sl} (${p.riskPct}%) — ${p.sector}`).join('\n')
    : `<b>Abiertas:</b> ninguna`,
  ``,
  ...healthLines,
  ``,
  `Sistema: setup-9 perf + EMA50>200 + px>EMA200 | guardia ER 7d | calor máx 4 pos / 2 sector`,
];

const { equityText } = await import('./equity_curve.mjs');
const text = lines.join('\n') + '\n\n———\n' + equityText;
console.log(text.replace(/<[^>]+>/g, ''));
await tgSend(text);
