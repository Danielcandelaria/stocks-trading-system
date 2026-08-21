#!/usr/bin/env node
// track_pnl.mjs — rentabilidad EN VIVO de las 2 estrategias FOCO (EMACross + WeeklySwing).
// Lee sus journals (posiciones abiertas), baja el precio actual y calcula el P&L desde el
// aviso. Escribe pnl_live.json que consume el dashboard. Solo LEE precios (Yahoo), no opera.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = dirname(fileURLToPath(import.meta.url));
const F = n => join(ROOT, n);
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const load = (f, d) => existsSync(F(f)) ? JSON.parse(readFileSync(F(f), 'utf8')) : d;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function price(t) { const y = t.replace('.', '-');
  try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=5d&interval=1d`, { headers: UA });
    if (!r.ok) return null; const d = (await r.json()).chart?.result?.[0]; const c = d?.indicators?.quote?.[0]?.close?.filter(x => x != null);
    return c?.length ? c[c.length - 1] : null; } catch { return null; } }

// posiciones abiertas de las dos estrategias foco
const positions = [
  ...load('journal_emacross.json', []).filter(p => p.status === 'open' && p.dir === 'LONG').map(p => ({ ...p, strategy: 'EMACross' })),
  ...load('journal_weekly.json', []).filter(p => p.status === 'open').map(p => ({ ...p, strategy: 'WeeklySwing' })),
  ...load('journal_emacross_mid.json', []).filter(p => p.status === 'open').map(p => ({ ...p, strategy: 'EMACrossMid' })),
];

// GARANTÍA: toda posición REAL (dinero real) tiene precio en vivo, esté o no en los journals de
// paper trading. Antes dependía de coincidencia casual de ticker (BR no estaba en ninguno → null).
const realCovered = new Set(positions.map(p => p.ticker));
for (const t of load('trades_real.json', { trades: [] }).trades.filter(t => t.status === 'open')) {
  if (realCovered.has(t.ticker)) continue;
  positions.push({ ticker: t.ticker, tv: t.tv, sector: t.sector, strategy: 'RealOnly', entryPx: t.entryPrice, stop: t.stop, signalT: null });
}

const out = [];
for (const p of positions) {
  const cur = await price(p.ticker); await sleep(90);
  const pnlPct = cur != null ? +(((cur / p.entryPx) - 1) * 100).toFixed(2) : null;
  const toStopPct = cur != null && p.stop ? +(((cur / p.stop) - 1) * 100).toFixed(1) : null;
  out.push({
    strategy: p.strategy, ticker: p.ticker, tv: p.tv || p.ticker, sector: p.sector || '',
    entry: +(+p.entryPx).toFixed(2), current: cur != null ? +cur.toFixed(2) : null,
    pnlPct, stop: p.stop ? +(+p.stop).toFixed(2) : null, toStopPct,
    signalT: p.signalT, days: p.signalT ? Math.round((Date.now() / 1000 - p.signalT) / 86400) : null,
  });
}
out.sort((a, b) => (a.strategy).localeCompare(b.strategy) || (b.pnlPct ?? -999) - (a.pnlPct ?? -999));

writeFileSync(F('pnl_live.json'), JSON.stringify({ updatedAt: new Date().toISOString(), positions: out }, null, 2));
const byS = s => out.filter(p => p.strategy === s);
for (const s of ['EMACross', 'WeeklySwing', 'EMACrossMid']) { const a = byS(s); const avg = a.filter(p => p.pnlPct != null);
  console.log(`${s}: ${a.length} abiertas · P&L medio ${avg.length ? (avg.reduce((x, p) => x + p.pnlPct, 0) / avg.length).toFixed(1) : '—'}%`); }
console.log('→ pnl_live.json actualizado');
