#!/usr/bin/env node
// study_ma200.mjs — ¿La media de 200 actúa como SOPORTE y RESISTENCIA de verdad?
//
// Definiciones MEDIBLES (para no depender de la vista):
//   TEST DE SOPORTE   — el precio viene DE ARRIBA (cerró sobre la MA200) y una
//     vela BAJA a tocarla (low entra en la banda ±2% de la MA). ¿Rebota (soporte
//     aguanta) o la pierde (soporte roto)?
//   TEST DE RESISTENCIA — el precio viene DE ABAJO (cerró bajo la MA200) y una
//     vela SUBE a tocarla (high entra en la banda). ¿La rechaza (resistencia
//     aguanta) o la supera (resistencia rota)?
//
// Para cada test se mide el recorrido FORWARD (5/10/20 días) desde el cierre del
// toque, y si "aguantó" o "se rompió". Se compara contra una BASELINE (días al
// azar) para saber si el nivel es especial o es lo que haría cualquier día.
//
// Cooldown: tras un test se salta hasta que el precio se aleja >3% de la MA, para
// no contar 5 días pegados a la media como 5 tests. READ-ONLY (Yahoo).

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const SAMPLE = +(process.argv[2] || 250);
const RANGE  = process.argv[3] || '2y';
const BAND   = 0.02;   // ±2% = "toca" la media
const BREAK  = 0.03;   // cierre >3% al otro lado = nivel roto
const sleep = ms => new Promise(r => setTimeout(r, ms));

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const ROOT = dirname(fileURLToPath(import.meta.url));
const sma = (cl, p) => { const o = new Array(cl.length).fill(null); let s = 0; for (let i = 0; i < cl.length; i++) { s += cl[i]; if (i >= p) s -= cl[i - p]; if (i >= p - 1) o[i] = s / p; } return o; };

async function getBars(t) {
  const y = t.replace('.', '-');
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=${RANGE}&interval=1d`, { headers: UA });
    if (!res.ok) return null;
    const r = (await res.json()).chart?.result?.[0];
    const q = r?.indicators?.quote?.[0];
    if (!r?.timestamp || !q) return null;
    const b = [];
    for (let i = 0; i < r.timestamp.length; i++)
      if (q.close[i] != null && q.open[i] != null) b.push({ o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
    return b.length > 230 ? b : null;
  } catch { return null; }
}

const supp = [], resi = [], baseline = [];
const fwd = (bars, i, k) => (i + k < bars.length) ? (bars[i + k].c / bars[i].c - 1) * 100 : null;

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
  const tickers = (uni.universe || uni).slice(0, SAMPLE).map(u => u.ticker);
  console.log(`\n══ LA MEDIA DE 200 COMO SOPORTE / RESISTENCIA ══`);
  console.log(`  ${tickers.length} tickers · ${RANGE} · banda ±${BAND*100}% · rotura >${BREAK*100}%\n`);

  let done = 0, ok = 0;
  for (const t of tickers) {
    const bars = await getBars(t); done++;
    if (done % 50 === 0) process.stdout.write(`  …${done}/${tickers.length}\n`);
    await sleep(110); if (!bars) continue; ok++;
    const cl = bars.map(b => b.c), ma = sma(cl, 200);
    let cd = 0;
    for (let i = 205; i < bars.length - 1; i++) {
      if (ma[i] == null || ma[i - 1] == null) continue;
      const m = ma[i], b = bars[i], pb = bars[i - 1];
      // baseline: un día "normal" cualquiera (lejos de la media)
      if (Math.abs(b.c / m - 1) > 0.05 && i % 7 === 0) { const f = fwd(bars, i, 10); if (f != null) baseline.push(f); }
      if (cd > 0) { cd--; continue; }

      // TEST DE SOPORTE: venía de arriba y baja a tocar la media
      const desdeArriba = pb.c > m && pb.l > m * (1 + BAND);
      const tocaAbajo = b.l <= m * (1 + BAND) && b.l >= m * (1 - BAND * 2);
      if (desdeArriba && tocaAbajo) {
        // ¿se rompió? (cierra >3% bajo la media en los próximos 10 días)
        let broke = false;
        for (let k = 1; k <= 10 && i + k < bars.length; k++) if (bars[i + k].c < m * (1 - BREAK)) { broke = true; break; }
        supp.push({ f5: fwd(bars, i, 5), f10: fwd(bars, i, 10), f20: fwd(bars, i, 20), broke, slope: m > ma[i - 20] });
        cd = 5; continue;
      }
      // TEST DE RESISTENCIA: venía de abajo y sube a tocar la media
      const desdeAbajo = pb.c < m && pb.h < m * (1 - BAND);
      const tocaArriba = b.h >= m * (1 - BAND) && b.h <= m * (1 + BAND * 2);
      if (desdeAbajo && tocaArriba) {
        let broke = false;
        for (let k = 1; k <= 10 && i + k < bars.length; k++) if (bars[i + k].c > m * (1 + BREAK)) { broke = true; break; }
        resi.push({ f5: fwd(bars, i, 5), f10: fwd(bars, i, 10), f20: fwd(bars, i, 20), broke });
        cd = 5; continue;
      }
    }
  }

  const stat = (arr, key) => { const v = arr.map(x => x[key]).filter(x => x != null); const n = v.length;
    const m = v.reduce((a, b) => a + b, 0) / n; const up = v.filter(x => x > 0).length;
    return { n, m, up: 100 * up / n }; };
  const fmt = v => (v >= 0 ? '+' : '') + v.toFixed(2);

  console.log(`\n  ${ok} tickers · ${supp.length} tests de SOPORTE · ${resi.length} tests de RESISTENCIA\n`);

  console.log('  ═══ SOPORTE (precio baja a tocar la MA200 desde arriba) ═══');
  for (const k of ['f5', 'f10', 'f20']) { const s = stat(supp, k);
    console.log(`   ${k.padEnd(4)} → media ${fmt(s.m)}%  ·  ${s.up.toFixed(0)}% acaba arriba  (n=${s.n})`); }
  const brokeS = supp.filter(x => x.broke).length;
  console.log(`   AGUANTA el soporte: ${(100 * (1 - brokeS / supp.length)).toFixed(0)}%  ·  se ROMPE (<−3%): ${(100 * brokeS / supp.length).toFixed(0)}%`);
  // soporte con la MA subiendo (tendencia real) vs plana/bajando
  const up = supp.filter(x => x.slope), dn = supp.filter(x => !x.slope);
  console.log(`   con MA SUBIENDO (n=${up.length}): 10d media ${fmt(stat(up, 'f10').m)}%  ·  con MA plana/baja (n=${dn.length}): ${fmt(stat(dn, 'f10').m)}%`);

  console.log('\n  ═══ RESISTENCIA (precio sube a tocar la MA200 desde abajo) ═══');
  for (const k of ['f5', 'f10', 'f20']) { const s = stat(resi, k);
    console.log(`   ${k.padEnd(4)} → media ${fmt(s.m)}%  ·  ${s.up.toFixed(0)}% acaba arriba  (n=${s.n})`); }
  const brokeR = resi.filter(x => x.broke).length;
  console.log(`   AGUANTA la resistencia: ${(100 * (1 - brokeR / resi.length)).toFixed(0)}%  ·  se ROMPE (>+3%): ${(100 * brokeR / resi.length).toFixed(0)}%`);

  console.log('\n  ═══ BASELINE (día cualquiera lejos de la MA) ═══');
  const bl = { n: baseline.length, m: baseline.reduce((a, b) => a + b, 0) / baseline.length, up: 100 * baseline.filter(x => x > 0).length / baseline.length };
  console.log(`   10d → media ${fmt(bl.m)}%  ·  ${bl.up.toFixed(0)}% acaba arriba  (n=${bl.n})`);
  console.log(`\n  Lectura: si el SOPORTE tiene forward > baseline → la MA200 sí sujeta.`);
  console.log(`           si la RESISTENCIA tiene forward < baseline → la MA200 sí frena.\n`);
})();
