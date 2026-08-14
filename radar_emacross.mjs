#!/usr/bin/env node
// radar_emacross.mjs — RADAR de cruces EMA 8/21 semanal INMINENTES.
//   No espera a que el cruce se confirme al cierre del viernes: detecta cuando las
//   EMAs están MUY cerca y CONVERGIENDO, para tener el ticker en el radar durante la
//   semana y poder entrar antes (capturar más movimiento). Ver backtest_ema_timing.mjs:
//   adelantar 1 semana mejora el 87% de las veces (PF 2.35→4.18 con previsión perfecta).
//
//   Manda UN digest a Telegram con los "a punto de cruzar". NO es una entrada: es un
//   aviso de vigilancia. La entrada real la sigue confirmando scanner_emacross.mjs al cierre.
//   Umbral: |EMA8-EMA21|/precio < GAP% y el hueco se ESTRECHA hacia el cruce.
//
//   Uso:  node radar_emacross.mjs [--dry] [gap%]     (gap% por defecto 0.8)

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tgSend } from './tg.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const F = n => join(ROOT, n);
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const FAST = 8, SLOW = 21;
const DRY = process.argv.includes('--dry');
const GAP = (+process.argv.find(a => /^[\d.]+$/.test(a)) || 0.8) / 100;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const load = (f, d) => existsSync(F(f)) ? JSON.parse(readFileSync(F(f), 'utf8')) : d;
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map((c, i) => { e = e === null ? c : c * k + e * (1 - k); return i >= p - 1 ? e : null; }); };
const NOW = Date.now() / 1000;

async function getWeekly(t) { const y = t.replace('.', '-');
  try { const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=2y&interval=1wk`, { headers: UA });
    if (!res.ok) return null; const r = (await res.json()).chart?.result?.[0]; const q = r?.indicators?.quote?.[0];
    if (!r?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < r.timestamp.length; i++) if (q.close[i] != null) b.push({ t: r.timestamp[i], c: q.close[i] });
    while (b.length && NOW - b[b.length - 1].t < 7 * 86400) b.pop();   // fuera la semana en curso
    return b.length > 30 ? b : null; } catch { return null; } }

(async () => {
  const uni = load('universe.json', { universe: [] }).universe;
  const hits = []; let done = 0;
  for (const u of uni) {
    let bars; try { bars = await getWeekly(u.ticker); await sleep(120); } catch { continue; }
    if (!bars || bars.length < SLOW + 3) continue;
    const cl = bars.map(b => b.c), ef = ema(cl, FAST), es = ema(cl, SLOW);
    const L = cl.length - 1; if (ef[L] == null || ef[L - 1] == null) continue;
    const px = cl[L];
    const gNow = (ef[L] - es[L]) / px;         // hueco actual (normalizado)
    const gPrev = (ef[L - 1] - es[L - 1]) / px;
    if (Math.abs(gNow) >= GAP) continue;       // aún lejos
    // convergiendo hacia el cruce (el hueco se estrecha):
    const longImm = gNow < 0 && gNow > gPrev;   // EMA8 debajo, subiendo hacia EMA21 → cruce alcista cerca
    const shortImm = gNow > 0 && gNow < gPrev;  // EMA8 encima, bajando hacia EMA21 → cruce bajista cerca
    if (!longImm && !shortImm) continue;
    hits.push({ ticker: u.ticker, tv: u.tv, dir: longImm ? 'LONG' : 'SHORT', px, gap: Math.abs(gNow) * 100 });
    if (++done % 60 === 0) process.stderr.write(`  …revisadas ${done}\n`);
  }

  hits.sort((a, b) => a.gap - b.gap);   // los más cerca del cruce, primero
  const L = hits.filter(h => h.dir === 'LONG'), S = hits.filter(h => h.dir === 'SHORT');
  const line = h => `  ${h.ticker.padEnd(6)} $${h.px.toFixed(2)}  (a ${h.gap.toFixed(2)}%)`;
  console.log(`RADAR: ${hits.length} inminentes · ${L.length} LONG · ${S.length} SHORT (gap<${(GAP*100).toFixed(1)}%)`);
  for (const h of hits) console.log(`  ${h.dir.padEnd(5)} ${h.ticker.padEnd(6)} gap ${h.gap.toFixed(2)}%  $${h.px.toFixed(2)}`);

  if (!DRY && hits.length) await tgSend(
    `📡 <b>RADAR EMA 8/21 — cruces inminentes</b>  <i>(vigilar, aún sin confirmar)</i>` +
    `\n\n🟢 <b>LONG a punto</b> (${L.length})\n<code>${L.map(line).join('\n') || '  —'}</code>` +
    `\n\n🔴 <b>SHORT a punto</b> (${S.length})\n<code>${S.map(line).join('\n') || '  —'}</code>` +
    `\n\n⏳ El cruce se confirma al CIERRE del viernes. Esto es solo para tenerlos en el radar.`
  );
})();
