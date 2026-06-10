// stocks/download_history.mjs
// Descarga ~3 años de OHLCV diario por ticker (Yahoo Finance chart API).
// Fuente EXTERNA = aproximación declarada para backtest. La forward leerá de TV.
// Guarda stocks/data/<TICKER>.json. Reanudable: salta los ya descargados.

import { readFileSync, writeFileSync, existsSync } from 'fs';

const { universe } = JSON.parse(readFileSync(new URL('./universe.json', import.meta.url)));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };

let ok = 0, skip = 0, fail = [];

for (const u of universe) {
  const out = new URL(`./data/${u.ticker}.json`, import.meta.url);
  if (existsSync(out)) { skip++; continue; }
  const yTicker = u.ticker.replace('.', '-'); // BRK.B → BRK-B
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yTicker}?range=3y&interval=1d&events=div%2Csplit`;
  try {
    const res = await fetch(url, { headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const r = j.chart?.result?.[0];
    const q = r?.indicators?.quote?.[0];
    if (!r?.timestamp || !q) throw new Error('sin datos');
    const bars = [];
    for (let i = 0; i < r.timestamp.length; i++) {
      if (q.open[i] == null || q.close[i] == null) continue; // huecos
      bars.push({
        t: r.timestamp[i],
        o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i],
        v: q.volume[i] ?? 0,
      });
    }
    if (bars.length < 300) throw new Error(`solo ${bars.length} barras`);
    writeFileSync(out, JSON.stringify({ ticker: u.ticker, tv: u.tv, sector: u.sector, bars }));
    ok++;
    if (ok % 50 === 0) console.log(`${ok} descargados...`);
    await sleep(250); // cadencia amable
  } catch (e) {
    fail.push(`${u.ticker}: ${e.message}`);
    await sleep(500);
  }
}

console.log(`OK: ${ok}, ya existían: ${skip}, fallos: ${fail.length}`);
if (fail.length) console.log(fail.slice(0, 20).join('\n'));
