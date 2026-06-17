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

async function lastClose(ticker) {
  const y = ticker.replace('.', '-');
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=5d&interval=1d`, { headers: UA });
  const r = (await res.json()).chart?.result?.[0];
  const cl = (r?.indicators?.quote?.[0]?.close ?? []).filter(c => c != null);
  return cl[cl.length - 1];
}

// DESENLACE del mes anterior (la validación real del momentum es esta):
// rendimiento equal-weight del portfolio registrado vs SPY en el mismo periodo.
let closePrevText = '';
const prevMonth = state.months[state.months.length - 1];
if (prevMonth && !prevMonth.result) {
  try {
    const rets = [];
    for (const p of prevMonth.portfolio) {
      const px = await lastClose(p.ticker); await sleep(150);
      if (px) rets.push(px / p.last - 1);
    }
    const portRet = rets.reduce((s, r) => s + r, 0) / rets.length * 100;
    const spyNow = await lastClose('SPY');
    const spyRet = prevMonth.spyRef ? (spyNow / prevMonth.spyRef - 1) * 100 : null;
    prevMonth.result = { portRetPct: +portRet.toFixed(2), spyRetPct: spyRet != null ? +spyRet.toFixed(2) : null, closedAt: new Date().toISOString().slice(0, 10) };
    closePrevText = `\n\n📕 <b>Desenlace ${prevMonth.month}</b>: portfolio ${portRet >= 0 ? '+' : ''}${portRet.toFixed(1)}%` +
      (spyRet != null ? ` vs SPY ${spyRet >= 0 ? '+' : ''}${spyRet.toFixed(1)}% → ${portRet > spyRet ? '✅ BATE' : '❌ no bate'}` : '');
    log(`desenlace ${prevMonth.month}: port ${portRet.toFixed(1)}% vs SPY ${spyRet?.toFixed(1)}%`);
  } catch (e) { log('no pude cerrar el mes anterior:', e.message); }
}

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

const spyRef = await lastClose('SPY').catch(() => null);
state.months.push({ month, date: new Date().toISOString().slice(0, 10), ranked: ranked.length, portfolio: top, spyRef });
writeFileSync(F('momentum_state.json'), JSON.stringify(state, null, 2));

const lines = top.map((p, i) => {
  const tag = prev.size === 0 ? '' : prev.has(p.ticker) ? ' =' : ' 🆕';
  return `${i + 1}. <b>${p.ticker}</b> +${(p.mom * 100).toFixed(0)}% (6m) @${p.last.toFixed(2)}${tag}`;
});
const out = [...prev].filter(t => !top.some(p => p.ticker === t));
const text = `📈 <b>MOMENTUM mensual ${month} (paper)</b>\nTop-10 por retorno 6m (rebalanceo equal-weight):\n\n${lines.join('\n')}` +
  (out.length ? `\n\nSalen: ${out.join(', ')}` : '') + closePrevText +
  `\n\n⚠️ Forward-only: el backtest de momentum no es fiable (sesgo supervivencia). Validación: comparar vs SPY mes a mes.`;
console.log(text.replace(/<[^>]+>/g, ''));
const { tgSend } = await import('./tg.mjs');
await tgSend(text);
log(`portfolio ${month} registrado (${top.map(p => p.ticker).join(', ')})`);
