#!/usr/bin/env node
/**
 * theme_correlation.mjs — ¿Cuántas apuestas INDEPENDIENTES hay en themes.json?
 *
 * Motivación (2026-07-20): el aviso de drawdown de Banks (-30/-50/-84% en el AI)
 * es inofensivo si los temas son apuestas distintas, y letal si son la misma.
 * Medición previa: 6 de 7 temas son AI-adyacentes (86% de los tickers).
 *
 * Es el equivalente en acciones de `scripts/mc_corr_forex.py`, que ya destapó
 * que la familia dvacont* correlacionaba +0.77..1.00 = UNA sola apuesta.
 *
 * Método: retornos DIARIOS (no precios — los precios correlacionan por tendencia
 * común y engañan), 1 año, correlación de Pearson por pares. Luego:
 *   · correlación media intra-tema y entre temas
 *   · "apuestas efectivas" ≈ n / (1 + (n-1)·ρ̄)   [diversificación efectiva]
 *   · beta de cada tema contra QQQ (proxy tech) → riesgo sistémico
 *   · drawdown simulado del cesto si el AI cae -30% (según betas reales)
 *
 * READ-ONLY: solo lee Yahoo (misma fuente que los scanners) y escribe un informe.
 * No toca universe.json, ni themes.json, ni ningún journal.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const DAYS = 365;
const BENCH = 'QQQ';        // proxy tech/AI
const SPY   = 'SPY';        // proxy mercado

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchDaily(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`
            + `?range=1y&interval=1d`;
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const r = j?.chart?.result?.[0];
      const closes = r?.indicators?.quote?.[0]?.close;
      const stamps = r?.timestamp;
      if (!closes || !stamps) throw new Error('sin datos');
      const out = new Map();
      for (let i = 0; i < stamps.length; i++) {
        if (closes[i] != null) out.set(stamps[i], closes[i]);   // fecha → cierre
      }
      return out;
    } catch (e) {
      if (intento === 3) { console.log(`    ✗ ${ticker}: ${e.message}`); return null; }
      await sleep(600 * intento);
    }
  }
}

// Convierte un mapa de PRECIOS (fecha→precio) en uno de RETORNOS (fecha→retorno).
function toReturns(mapPrecios) {
  const dias = [...mapPrecios.keys()].sort((a, b) => a - b);
  const out = new Map();
  for (let i = 1; i < dias.length; i++) {
    const p0 = mapPrecios.get(dias[i - 1]), p1 = mapPrecios.get(dias[i]);
    if (p0 > 0) out.set(dias[i], p1 / p0 - 1);
  }
  return out;
}

// Alinea por FECHA dos mapas que YA contienen retornos (los tickers tienen huecos distintos).
// ⚠️ BUG 2026-07-20: antes esto recalculaba a1/a0-1 sobre series que ya eran retornos
// ("retorno de un retorno") → betas absurdas (NVDA 0.03 en vez de 1.33) y correlaciones
// aplastadas a ~0. Las entradas deben ser SIEMPRE retornos ya calculados.
function alignReturns(mapA, mapB) {
  const dias = [...mapA.keys()].filter(d => mapB.has(d)).sort((a, b) => a - b);
  return [dias.map(d => mapA.get(d)), dias.map(d => mapB.get(d))];
}

const mean = x => x.reduce((a, b) => a + b, 0) / x.length;
function pearson(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 30) return null;                       // muestra insuficiente → no inventar
  const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n));
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx, b = y[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return (dx && dy) ? num / Math.sqrt(dx * dy) : null;
}
function beta(activo, bench) {                   // sensibilidad al índice
  const n = Math.min(activo.length, bench.length);
  if (n < 30) return null;
  const ma = mean(activo.slice(0, n)), mb = mean(bench.slice(0, n));
  let cov = 0, varb = 0;
  for (let i = 0; i < n; i++) { cov += (activo[i] - ma) * (bench[i] - mb); varb += (bench[i] - mb) ** 2; }
  return varb ? cov / varb : null;
}

(async () => {
  const themes = JSON.parse(readFileSync(join(DIR, 'themes.json'), 'utf8')).themes;
  const nombres = Object.keys(themes);
  const tickersDe = {};
  for (const [n, v] of Object.entries(themes)) {
    tickersDe[n] = (v.tickers || v.symbols || []).map(x => typeof x === 'string' ? x : (x.ticker || x.symbol || x.t)).filter(Boolean);
  }
  const todos = [...new Set([...Object.values(tickersDe).flat(), BENCH, SPY])];

  console.log(`\n══ CORRELACIÓN DE TEMAS — ¿cuántas apuestas hay de verdad? ══`);
  console.log(`  ${nombres.length} temas · ${todos.length} tickers · retornos diarios 1 año\n`);
  console.log('① Descargando precios (Yahoo, misma fuente que los scanners):');

  const precios = {};
  for (const t of todos) {
    const d = await fetchDaily(t);
    if (d && d.size > 60) { precios[t] = d; process.stdout.write(`  ✓${t}`); }
    else process.stdout.write(`  ✗${t}`);
    await sleep(220);                            // cortesía con Yahoo
  }
  console.log('\n');

  // ── Serie sintética de cada tema: media equiponderada de los retornos de sus tickers ──
  const serieTema = {};
  for (const n of nombres) {
    const disp = tickersDe[n].filter(t => precios[t]);
    if (!disp.length) continue;
    // Fechas comunes a todos los tickers del tema
    let dias = [...precios[disp[0]].keys()];
    for (const t of disp.slice(1)) dias = dias.filter(d => precios[t].has(d));
    dias.sort((a, b) => a - b);
    const serie = new Map();
    for (let i = 1; i < dias.length; i++) {
      let acc = 0, k = 0;
      for (const t of disp) {
        const p0 = precios[t].get(dias[i - 1]), p1 = precios[t].get(dias[i]);
        if (p0 > 0) { acc += p1 / p0 - 1; k++; }
      }
      if (k) serie.set(dias[i], acc / k);
    }
    serieTema[n] = { serie, tickers: disp };
  }
  const activos = Object.keys(serieTema);

  // ── ② Matriz de correlación entre temas ──
  console.log('② CORRELACIÓN ENTRE TEMAS (retornos diarios · 1 = misma apuesta):\n');
  const corte = s => s.length > 13 ? s.slice(0, 13) : s;
  process.stdout.write('  ' + ' '.repeat(15));
  for (const n of activos) process.stdout.write(corte(n).slice(0, 6).padStart(7));
  console.log();
  const pares = [];
  for (const a of activos) {
    process.stdout.write('  ' + corte(a).padEnd(15));
    for (const b of activos) {
      if (a === b) { process.stdout.write('      —'); continue; }
      const [ra, rb] = alignReturns(serieTema[a].serie, serieTema[b].serie);
      const c = pearson(ra, rb);
      if (c != null && activos.indexOf(a) < activos.indexOf(b)) pares.push({ a, b, c });
      process.stdout.write((c == null ? 'n/d' : c.toFixed(2)).padStart(7));
    }
    console.log();
  }

  // ── ③ Diversificación efectiva ──
  const cs = pares.map(p => p.c).filter(x => x != null);
  const rho = cs.length ? mean(cs) : 0;
  const n = activos.length;
  const efectivas = n / (1 + (n - 1) * Math.max(rho, 0));
  console.log(`\n③ ¿CUÁNTAS APUESTAS INDEPENDIENTES?`);
  console.log(`   correlación media entre temas: ${rho.toFixed(2)}`);
  console.log(`   temas nominales: ${n}  →  apuestas EFECTIVAS: ${efectivas.toFixed(1)}`);
  console.log(`   ${efectivas < 2 ? '🔴 Es prácticamente UNA sola apuesta.'
              : efectivas < n / 2 ? '🟠 Mucha menos diversificación de la aparente.'
              : '🟢 Diversificación razonable.'}`);

  const ord = [...pares].sort((x, y) => y.c - x.c);
  console.log(`\n   pares MÁS correlacionados (redundantes):`);
  for (const p of ord.slice(0, 4)) console.log(`     ${p.c.toFixed(2)}  ${p.a} ↔ ${p.b}`);
  console.log(`   pares MENOS correlacionados (diversifican de verdad):`);
  for (const p of ord.slice(-3).reverse()) console.log(`     ${p.c.toFixed(2)}  ${p.a} ↔ ${p.b}`);

  // ── ④ Beta vs QQQ y caída simulada ──
  console.log(`\n④ SENSIBILIDAD AL TECH (beta vs ${BENCH}) y CAÍDA SIMULADA:`);
  let betaCesto = 0, cuenta = 0;
  const filas = [];
  if (precios[BENCH]) {
    const benchRet = toReturns(precios[BENCH]);
    for (const t of activos) {
      const [rt, rq] = alignReturns(serieTema[t].serie, benchRet);
      const b = beta(rt, rq);
      if (b != null) { filas.push([t, b]); betaCesto += b; cuenta++; }
    }
    filas.sort((x, y) => y[1] - x[1]);
    for (const [t, b] of filas) {
      console.log(`   ${t.padEnd(24)} beta ${b.toFixed(2).padStart(5)}   si ${BENCH} -30% → ${(b * -30).toFixed(0)}%`);
    }
    const bm = cuenta ? betaCesto / cuenta : 0;
    console.log(`\n   beta media del cesto: ${bm.toFixed(2)}`);
    console.log(`   ⚠️ Escenario Banks (${BENCH} -30%): el cesto caería ≈ ${(bm * -30).toFixed(0)}%`);
    console.log(`      (-50% → ${(bm * -50).toFixed(0)}%)`);
  }

  // ── Informe ──
  const rep = {
    generado: new Date().toISOString().slice(0, 10),
    temas: n, apuestas_efectivas: +efectivas.toFixed(2), corr_media: +rho.toFixed(3),
    beta_media_vs_QQQ: cuenta ? +(betaCesto / cuenta).toFixed(2) : null,
    caida_si_QQQ_menos30: cuenta ? +((betaCesto / cuenta) * -30).toFixed(1) : null,
    pares: ord.map(p => ({ a: p.a, b: p.b, corr: +p.c.toFixed(3) })),
    betas: Object.fromEntries(filas.map(([t, b]) => [t, +b.toFixed(2)])),
    nota: 'Retornos diarios 1 año. READ-ONLY: no modifica themes.json ni el universo validado.'
  };
  writeFileSync(join(DIR, 'theme_correlation_report.json'), JSON.stringify(rep, null, 2));
  console.log(`\n📄 informe → stocks/theme_correlation_report.json\n`);
})();
