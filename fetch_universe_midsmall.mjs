// stocks/fetch_universe_midsmall.mjs
// Universo MID + SMALL cap US ($300M–$8B) vía screener REST de TradingView.
// Para BACKTESTEAR EMA cross fuera de las large-caps. NO toca CDP.
// ⚠️ Sesgo de supervivencia MUCHO peor que en large-caps (small-caps quebradas/deslistadas
//    no aparecen) → los números serán OPTIMISTAS. Tratar como cota superior, validar forward.

import { writeFileSync } from 'fs';

const BODY = {
  filter: [
    { left: 'market_cap_basic', operation: 'in_range', right: [300_000_000, 8_000_000_000] },
    { left: 'average_volume_90d_calc', operation: 'greater', right: 500_000 },
    { left: 'close', operation: 'greater', right: 5 },
    { left: 'type', operation: 'equal', right: 'stock' },
    { left: 'is_primary', operation: 'equal', right: true },
  ],
  columns: ['name', 'close', 'average_volume_90d_calc', 'market_cap_basic', 'sector', 'description'],
  sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
  range: [0, 1000],
};

const res = await fetch('https://scanner.tradingview.com/america/scan', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(BODY),
});
if (!res.ok) { console.error('HTTP', res.status); process.exit(1); }
const json = await res.json();

const isMLP = name => /L\.?\s*P\.?$| LP$/.test(name || '');
const universe = json.data.filter(r => !isMLP(r.d[5])).map(r => ({
  tv: r.s, ticker: r.d[0], close: r.d[1], avgVol90d: r.d[2], mcap: r.d[3], sector: r.d[4],
}));

writeFileSync(new URL('./universe_midsmall.json', import.meta.url),
  JSON.stringify({ generatedAt: new Date().toISOString(), totalCount: json.totalCount, universe }, null, 2));
console.log(`Universo mid/small: ${universe.length} tickers (de ${json.totalCount} en la banda $300M-$8B)`);
console.log('mcap rango:', (universe[0]?.mcap / 1e9).toFixed(1) + 'B →', (universe[universe.length - 1]?.mcap / 1e6).toFixed(0) + 'M');
console.log('ejemplos:', universe.slice(0, 6).map(u => u.ticker).join(', '), '…', universe.slice(-4).map(u => u.ticker).join(', '));
