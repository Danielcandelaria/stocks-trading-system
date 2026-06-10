// stocks/fetch_universe.mjs
// Universo de acciones US líquidas vía screener REST de TradingView.
// NO toca el chart ni el CDP — sistema paralelo al motor forex.
// ⚠️ Sesgo de supervivencia: el universo es el de HOY aplicado al pasado.
//    Declarado como aproximación; la validación que manda es la forward.

import { writeFileSync } from 'fs';

const BODY = {
  filter: [
    { left: 'market_cap_basic', operation: 'greater', right: 2_000_000_000 },
    { left: 'average_volume_90d_calc', operation: 'greater', right: 1_000_000 },
    { left: 'close', operation: 'greater', right: 10 },
    { left: 'type', operation: 'equal', right: 'stock' },
    { left: 'is_primary', operation: 'equal', right: true },
  ],
  columns: ['name', 'close', 'average_volume_90d_calc', 'market_cap_basic', 'sector'],
  sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
  range: [0, 500],
};

const res = await fetch('https://scanner.tradingview.com/america/scan', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(BODY),
});
if (!res.ok) { console.error('HTTP', res.status); process.exit(1); }
const json = await res.json();

const universe = json.data.map(r => ({
  tv: r.s,                      // p.ej. NASDAQ:AAPL
  ticker: r.d[0],
  close: r.d[1],
  avgVol90d: r.d[2],
  mcap: r.d[3],
  sector: r.d[4],
}));

writeFileSync(new URL('./universe.json', import.meta.url),
  JSON.stringify({ generatedAt: new Date().toISOString(), totalCount: json.totalCount, universe }, null, 2));
console.log(`Universo: ${universe.length} tickers (de ${json.totalCount} que pasan el filtro)`);
console.log('Top 10:', universe.slice(0, 10).map(u => u.ticker).join(', '));
