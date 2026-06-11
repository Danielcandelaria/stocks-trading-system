// stocks/momentum_monthly.mjs
// Rotación momentum mensual — SOLO FORWARD/PAPER.
// ⚠️ El backtest con universo actual NO es fiable (sesgo de supervivencia brutal
// para momentum: rankea a los ganadores de hoy). La validación es 100% forward.
// Spec: rank por retorno 6 meses saltando el último mes (126d→21d), top-10
// equal-weight del universo top-500, foto mensual a Telegram + journal propio.
// Se invoca a diario desde run_daily.sh; solo actúa si cambió el mes.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const F = n => join(ROOT, n);
const load = (f, d) => existsSync(F(f)) ? JSON.parse(readFileSync(F(f))) : d;
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), '[MOM]', ...a);

const month = new Date().toISOString().slice(0, 7);
const state = load('momentum_state.json', { months: [] });
if (state.months.some(m => m.month === month)) { log(`mes ${month} ya registrado — nada que hacer`); process.exit(0); }

const { universe } = load('universe.json', { universe: [] });
if (!universe.length) { log('sin universe.json'); process.exit(1); }

log(`rebalanceo de ${month}: rankeando ${universe.length} tickers...`);
const ranked = [];
for (const u of universe) {
  try {
    const y = u.ticker.replace('.', '-');
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=1y&interval=1d`, { headers: UA });
    if (!res.ok) throw new Error(res.status);
    const r = (await res.json()).chart?.result?.[0];
    const closes = (r?.indicators?.quote?.[0]?.close ?? []).filter(c => c != null);
    if (closes.length < 150) throw new Error('pocas barras');
    const pNow = closes[closes.length - 1 - 21], pPast = closes[closes.length - 1 - 126];
    if (pNow && pPast) ranked.push({ ticker: u.ticker, tv: u.tv, sector: u.sector, mom: pNow / pPast - 1, last: closes[closes.length - 1] });
    await sleep(150);
  } catch { await sleep(300); }
}
ranked.sort((a, b) => b.mom - a.mom);
const top = ranked.slice(0, 10);
const prev = state.months.length ? new Set(state.months[state.months.length - 1].portfolio.map(p => p.ticker)) : new Set();

state.months.push({ month, date: new Date().toISOString().slice(0, 10), ranked: ranked.length, portfolio: top });
writeFileSync(F('momentum_state.json'), JSON.stringify(state, null, 2));

const lines = top.map((p, i) => {
  const tag = prev.size === 0 ? '' : prev.has(p.ticker) ? ' =' : ' 🆕';
  return `${i + 1}. <b>${p.ticker}</b> +${(p.mom * 100).toFixed(0)}% (6m) @${p.last.toFixed(2)}${tag}`;
});
const out = [...prev].filter(t => !top.some(p => p.ticker === t));
const tg = load('telegram.json', null);
const text = `📈 <b>MOMENTUM mensual ${month} (paper)</b>\nTop-10 por retorno 6m (rebalanceo equal-weight):\n\n${lines.join('\n')}` +
  (out.length ? `\n\nSalen: ${out.join(', ')}` : '') +
  `\n\n⚠️ Forward-only: el backtest de momentum no es fiable (sesgo supervivencia). Validación: comparar vs SPY mes a mes.`;
console.log(text.replace(/<[^>]+>/g, ''));
if (tg?.token && tg?.chatId) {
  await fetch(`https://api.telegram.org/bot${tg.token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: tg.chatId, text, parse_mode: 'HTML' }),
  });
}
log(`portfolio ${month} registrado (${top.map(p => p.ticker).join(', ')})`);
