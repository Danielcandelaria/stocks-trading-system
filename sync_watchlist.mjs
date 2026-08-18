#!/usr/bin/env node
// sync_watchlist.mjs — pone en la watchlist de TradingView lo ACCIONABLE de hoy:
//   · EMACross: cruzaron esta semana + a punto (nivel 1) + en previsión/anticipación (nivel 2, banda 2%)
//   · WeeklySwing con señal viva (Setup-9 de esta semana o la pasada)
// Solo AÑADE (borrar por DOM es frágil; el usuario limpia a mano). Informa de las obsoletas.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cdpUp, getWatchlist, addToWatchlist, removeFromWatchlist } from './tv_layer.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const F = n => join(ROOT, n);
const rd = f => { try { return existsSync(F(f)) ? JSON.parse(readFileSync(F(f), 'utf8')) : null; } catch { return null; } };
const now = Date.now() / 1000;

(async () => {
  if (!await cdpUp()) { console.log('⚠️  TV/CDP caído — arráncalo y repite.'); process.exit(0); }

  const radar = rd('radar_live.json');
  const lv = i => (radar?.levels?.[i]?.tickers || []);
  const want = [];
  // EMACross: cruzaron esta semana (nivel 0, weeks 0) + a punto (nivel 1)
  for (const t of lv(0)) if (t.weeks === 0) want.push({ tv: t.tv, ticker: t.ticker, why: 'EMACross · cruzó esta semana' });
  for (const t of lv(1)) want.push({ tv: t.tv, ticker: t.ticker, why: 'EMACross · a punto de cruzar' });
  for (const t of lv(2)) want.push({ tv: t.tv, ticker: t.ticker, why: 'EMACross · en previsión (anticipación)' });   // banda 2% = la del indicador
  // WeeklySwing: señal viva (≤1 semana)
  for (const p of (rd('journal_weekly.json') || []).filter(p => p.status === 'open')) {
    const w = Math.floor((now - p.signalT) / (7 * 86400));
    if (w <= 1) want.push({ tv: p.tv || p.ticker, ticker: p.ticker, why: 'WeeklySwing · Setup-9' });
  }
  // dedupe
  const seen = new Set(), list = [];
  for (const w of want) { const k = w.tv.toUpperCase(); if (!seen.has(k)) { seen.add(k); list.push(w); } }

  const have = (await getWatchlist()).map(s => s.toUpperCase());
  const missing = list.filter(w => !have.includes(w.tv.toUpperCase()));
  const stale = have.filter(h => !seen.has(h));

  console.log(`Watchlist TV: ${have.length} símbolos · accionables hoy: ${list.length} · faltan: ${missing.length}`);
  let added = 0;
  for (const w of missing) {
    if (await addToWatchlist(w.tv)) { added++; console.log(`  + ${w.ticker.padEnd(6)} (${w.why})`); }
    else console.log(`  ! no se pudo añadir ${w.ticker}`);
  }
  console.log(`\n✅ añadidos ${added}`);
  // limpiar los que ya no hay que mirar
  if (stale.length) {
    console.log(`\n🧹 Borrando ${stale.length} que ya no hay que mirar…`);
    let removed = 0;
    for (const s of stale) {
      const ok = await removeFromWatchlist(s);
      console.log(`  ${ok ? '−' : '!'} ${s.split(':').pop()}${ok ? '' : ' (no se pudo)'}`);
      if (ok) removed++;
    }
    console.log(`\n✅ borrados ${removed}/${stale.length}`);
  }
  const fin = await getWatchlist();
  console.log(`\n📋 Watchlist final: ${fin.length} símbolos`);
  console.log('   ' + fin.map(s => s.split(':').pop()).join(', '));
  process.exit(0);
})();
