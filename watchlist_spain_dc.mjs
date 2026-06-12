// stocks/watchlist_spain_dc.mjs
// Watchlist de la tesis "data centers España / escasez de RED" (2026-06-12).
// CUBO DE INVERSIÓN (discrecional, horizonte años) — NO es un sistema validado,
// no genera señales de trading. Solo seguimiento trimestral con métricas TV.
// Corre vía com.stocks.watchlist (feb/may/ago/nov día 15) o a mano:
//   node watchlist_spain_dc.mjs

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const F = n => join(ROOT, n);
const load = (f, d) => existsSync(F(f)) ? JSON.parse(readFileSync(F(f))) : d;

// La tesis por capas (ver conversación 2026-06-12 / vídeo All-In Talen Energy):
// escaso en España = conexión a red + suelo con potencia, no la generación.
const WATCH = [
  { t: 'BME:RED', capa: '1·Red (monopolio transporte)', tesis: 'CNMC sube retribución → re-rating' },
  { t: 'BME:MRL', capa: '2·Casi pure-play (REIT DC)', tesis: 'pre-alquileres MW a hyperscalers + permisos Extremadura' },
  { t: 'BME:ACS', capa: '3·Constructor (1.7GW + Turner US)', tesis: 'cartera de pedidos DC trimestral' },
  { t: 'BME:IBE', capa: '4·Distribución+generación', tesis: 'retribución redes + PPAs' },
  { t: 'BME:ELE', capa: '4·Distribución+generación', tesis: 'retribución redes + PPAs' },
  { t: 'BME:ANE', capa: '4·Renovable (PPAs)', tesis: 'PPAs con hyperscalers; ojo precios captura' },
  { t: 'BME:SLR', capa: '4·Renovable (PPAs)', tesis: 'PPAs con hyperscalers; ojo precios captura' },
];

const res = await fetch('https://scanner.tradingview.com/spain/scan', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    symbols: { tickers: WATCH.map(w => w.t) },
    columns: ['name', 'close', 'market_cap_basic', 'price_earnings_ttm', 'dividend_yield_recent', 'price_book_fq', 'Perf.YTD', 'Perf.Y'],
  }),
});
const { data } = await res.json();
const now = Object.fromEntries(data.map(r => [r.s, {
  px: r.d[1], mcap: r.d[2], pe: r.d[3], divy: r.d[4], pb: r.d[5], ytd: r.d[6], y1: r.d[7],
}]));

const state = load('watchlist_spain_dc_state.json', { snapshots: [] });
const prev = state.snapshots[state.snapshots.length - 1];
state.snapshots.push({ date: new Date().toISOString().slice(0, 10), data: now });
writeFileSync(F('watchlist_spain_dc_state.json'), JSON.stringify(state, null, 2));

const fmt = (v, d = 1) => v == null ? '—' : v.toFixed(d);
const lines = WATCH.map(w => {
  const m = now[w.t]; if (!m) return `· ${w.t}: sin datos`;
  const delta = prev?.data?.[w.t] ? ` | ${((m.px / prev.data[w.t].px - 1) * 100).toFixed(1)}% desde último repaso` : '';
  return `<b>${w.t.replace('BME:', '')}</b> [${w.capa}] ${fmt(m.px, 2)}€ | PER ${fmt(m.pe)} | div ${fmt(m.divy)}% | YTD ${fmt(m.ytd)}%${delta}\n  └ vigilar: ${w.tesis}`;
});

const text = `🇪🇸 <b>WATCHLIST DATA CENTERS ESPAÑA</b> — repaso ${new Date().toISOString().slice(0, 10)}\n` +
  `<i>Cubo de inversión (tesis escasez de red, no sistema de trading)</i>\n\n` +
  lines.join('\n') +
  `\n\n<b>Catalizadores a revisar este trimestre:</b>\n` +
  `1. ¿CNMC movió la tasa de retribución de redes?\n` +
  `2. ¿Merlin anunció pre-alquileres/permisos nuevos?\n` +
  `3. ¿Cartera de pedidos DC de ACS creció?\n` +
  `4. ¿Avances del plan Redeia 2026-29 / refuerzos post-apagón?`;

console.log(text.replace(/<[^>]+>/g, ''));
const tg = load('telegram.json', null);
if (tg?.token && tg?.chatId) {
  const r = await fetch(`https://api.telegram.org/bot${tg.token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: tg.chatId, text, parse_mode: 'HTML' }),
  });
  console.log('telegram:', (await r.json()).ok ? 'OK' : 'ERROR');
}
