// stocks/watchlist_daily.mjs
// Calcula la watchlist diaria: las pocas acciones con señal activa en alguno de
// los 5 sistemas, + los niveles de alerta de los breakout pendientes.
// Corre en run_daily.sh tras los scanners.
//
// ⚠️ YA NO SE ENVÍA A TELEGRAM (2026-06-25): la watchlist vive en el DASHBOARD
// (lee los journals directamente). Telegram = solo señales accionables, no
// resúmenes. Aquí solo se imprime a consola (queda en el log del run diario).

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { sizeWithStop, sizeNoStop, ACCOUNT_EUR, RISK_PCT } from './sizing.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const L = f => existsSync(join(ROOT, f)) ? JSON.parse(readFileSync(join(ROOT, f))) : [];

const breakout = [], rsi2 = [], swing = [], ema200 = [], all = new Set();
for (const p of L('journal.json')) if (p.status === 'open') { all.add(p.tv); if (p.strategy === 'RSI2') rsi2.push(p.ticker); }
for (const p of L('journal_weekly.json')) if (p.status === 'open') { all.add(p.tv); swing.push(p.ticker); }
for (const p of L('journal_breakout.json')) if (p.status === 'pending' || p.status === 'open') {
  all.add(p.tv);
  const s = sizeWithStop(p.entryPx, p.stop);
  breakout.push(p.status === 'pending'
    ? `· ${p.ticker}: <b>alerta compra en $${p.entryPx}</b> (stop $${p.stop}) → invierte <b>€${s.posEUR}</b> (riesgo €${s.riskEUR})`
    : `· ${p.ticker}: ABIERTA @$${p.entryPx} → €${s.posEUR}`);
}
for (const p of L('journal_ema200.json')) if (p.status === 'open') {
  all.add(p.tv);
  const s = sizeWithStop(p.entryPx, p.stop);
  ema200.push(`· ${p.ticker}: ABIERTA @$${p.entryPx} (EMA200: $${p.ema200AtSignal?.toFixed(2)}) → €${s.posEUR}`);
}
const ms = existsSync(join(ROOT, 'momentum_state.json')) ? JSON.parse(readFileSync(join(ROOT, 'momentum_state.json'))) : { months: [] };
const mom = ms.months?.[ms.months.length - 1]?.portfolio?.map(p => p.ticker) ?? [];
mom.forEach((_, i) => all.add(ms.months[ms.months.length - 1].portfolio[i].tv));

if (all.size === 0) { console.log('sin acciones activas'); process.exit(0); }

const text = `📋 <b>WATCHLIST DEL DÍA</b> — ${new Date().toISOString().slice(0, 10)}\n` +
  `<i>Cuenta €${ACCOUNT_EUR} · riesgo ${RISK_PCT * 100}%/trade · sizing incluido</i>\n\n` +
  (breakout.length ? `🟠 <b>Breakout — pon alerta de precio en TV:</b>\n${breakout.join('\n')}\n\n` : '') +
  (ema200.length ? `🔵 <b>EMA200 Bounce abiertas:</b>\n${ema200.join('\n')}\n\n` : '') +
  (rsi2.length ? `🔵 <b>RSI2 abiertas:</b> ${rsi2.join(', ')}\n` : '') +
  (swing.length ? `🟣 <b>Swing abiertas:</b> ${swing.join(', ')}\n` : '') +
  (mom.length ? `📈 <b>Momentum (cartera):</b> ${mom.join(', ')}\n` : '') +
  `\n<b>Para importar a TV</b> (pega en una watchlist nueva):\n<code>${[...all].join(',')}</code>`;

console.log(text.replace(/<[^>]+>/g, ''));
// Telegram ELIMINADO (2026-06-25): la watchlist está en el dashboard, no aporta
// nada como mensaje de Telegram. Antes: await tgSend(text);
