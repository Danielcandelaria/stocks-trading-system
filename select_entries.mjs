#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// SELECTOR MECÁNICO DE ENTRADAS + SIZING  (elimina la intuición de la entrada)
//
// Regla 100% mecánica, sin "feeling":
//   1. Candidatas = radar EMACross reorganizado por la escalera VALIDADA:
//      ⭐⭐ STACK  →  ⭐ CONFLUENCIA  →  🎯 P1 (anticipada <0.4%)  →  🎯 P2 (cruzada ext≥15%).
//      (P3/pegadas/vigilar NO son "entrar ahora" → fuera.)
//   2. Desempate dentro de cada nivel: por fuerza (ext sobre EMA21).
//   3. Excluir las que ya tienes (abiertas o cerradas en este ciclo).
//   4. GUARDARRAÍL DE SECTOR: máx 2 posiciones por sector (cuenta las reales abiertas).
//   5. LÍMITE DE CARTERA: máx 8 posiciones abiertas (rango del manual 6-8).
//   6. SIZING ¼ Kelly: cada posición = 2.5% de riesgo con stop 18%  → ~13.9% del capital.
//      Recorta al efectivo disponible y a no pasar del 100% invertido.
//   7. Apalancamiento SIEMPRE 1x. Stop catástrofe −18%.
//
// NO ejecuta órdenes: imprime QUÉ entrar, CUÁNTO y con qué stop. Tú lo pones en eToro a 1x.
// Uso:  node select_entries.mjs            (usa account.json)
//       node select_entries.mjs --json     (salida JSON para el dashboard/telegram)
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const rd = f => { try { return JSON.parse(readFileSync(join(ROOT, f), 'utf8')); } catch { return null; } };

// ── Parámetros del manual (NO son de edge; son las reglas de gestión validadas) ──
const SL_PCT      = 0.18;   // stop catástrofe −18%
const RISK_FRAC   = 0.025;  // 2.5% de riesgo por trade (¼ Kelly)
const POS_MIN     = 0.13;   // banda inferior de posición (13%)
const POS_MAX     = 0.16;   // banda superior (16%)
const MAX_OPEN    = 8;      // tope de posiciones abiertas (rango 6-8)
const SECT_CAP    = 2;      // máx posiciones por sector

const acc   = rd('account.json') || {};
const cap   = +acc.valorTotal || 0;
const cash  = +acc.disponible || 0;
const radar = rd('radar_live.json');
const uniRaw = rd('universe.json');
const uni   = Array.isArray(uniRaw) ? uniRaw : (uniRaw?.universe || []);
const SECT  = Object.fromEntries(uni.filter(u => u && u.ticker).map(u => [u.ticker.toUpperCase(), u.sector || null]));

if (!cap || !radar) { console.error('Faltan account.json o radar_live.json'); process.exit(1); }

// ── Posiciones reales: held (excluir) + conteo por sector + nº abiertas ──
const trades   = (rd('trades_real.json') || {}).trades || [];
const held     = new Set(trades.filter(t => ['open', 'closed'].includes(t.status)).map(t => t.ticker.toUpperCase()));
const openReal = trades.filter(t => t.status === 'open');
const nOpen    = openReal.length;
const sectCount = {};
for (const t of openReal) { const s = t.sector || SECT[t.ticker.toUpperCase()]; if (s) sectCount[s] = (sectCount[s] || 0) + 1; }

// ── Reconstruir la escalera EXACTA del dashboard ──
const lv = i => (radar?.levels?.[i]?.tickers || [])
  .filter(t => !held.has(t.ticker.toUpperCase()))
  .map(t => ({ ...t, sector: SECT[t.ticker.toUpperCase()] || null, stop: +(t.price * (1 - SL_PCT)).toFixed(2) }));
const cross0 = lv(0).filter(t => t.weeks === 0);
const confAll = [
  ...cross0.filter(t => t.conf9).sort((a, b) => b.extPct - a.extPct),
  ...lv(1).concat(lv(2)).filter(t => t.conf9).sort((a, b) => a.gapPct - b.gapPct),
];
const stack = confAll.filter(t => t.conf9 && t.below200 === true);
const conf  = confAll.filter(t => !(t.conf9 && t.below200 === true));
const inConf = new Set(confAll.map(t => t.ticker.toUpperCase()));
const noC = arr => arr.filter(t => !inConf.has(t.ticker.toUpperCase()));
const p1 = noC(lv(1)).sort((a, b) => a.gapPct - b.gapPct);
const p2 = noC(cross0.filter(t => (t.extPct ?? 0) >= 15)).sort((a, b) => b.extPct - a.extPct);

// Flujo de candidatas EN ORDEN DE PRIORIDAD (solo "entrar ahora").
const ladder = [
  ...stack.map(t => ({ ...t, tier: '⭐⭐ STACK' })),
  ...conf .map(t => ({ ...t, tier: '⭐ CONFLUENCIA' })),
  ...p1   .map(t => ({ ...t, tier: '🎯 P1 anticipada' })),
  ...p2   .map(t => ({ ...t, tier: '🎯 P2 cruzada fuerte' })),
];

// ── Sizing ¼ Kelly ──
const riskUsd  = +(cap * RISK_FRAC).toFixed(2);       // 2.5% del capital
const posByRisk = riskUsd / SL_PCT;                    // tamaño que arriesga eso con stop 18%
const posUsd   = +Math.min(Math.max(posByRisk, cap * POS_MIN), cap * POS_MAX).toFixed(2);

// ── Cupos disponibles ──
const slotsByCount = Math.max(0, MAX_OPEN - nOpen);    // no pasar de 8 abiertas
const slotsByCash  = Math.floor(cash / posUsd);        // lo que da la caja
const slots        = Math.min(slotsByCount, slotsByCash);

// ── Selección: baja la escalera saltando sector lleno, hasta llenar cupos ──
const picks = [];
const runSect = { ...sectCount };
const skipped = [];
for (const c of ladder) {
  if (picks.length >= slots) break;
  const s = c.sector;
  if (s && (runSect[s] || 0) >= SECT_CAP) { skipped.push({ ...c, reason: `sector lleno (${s}: ${runSect[s]})` }); continue; }
  const shares = +(posUsd / c.price).toFixed(4);
  picks.push({ ticker: c.ticker, tv: c.tv, tier: c.tier, sector: s, price: c.price, amountUsd: posUsd,
    shares, stop: c.stop, stopPct: -18, riskUsd, leverage: 1,
    extPct: c.extPct ?? null, gapPct: c.gapPct ?? null });
  if (s) runSect[s] = (runSect[s] || 0) + 1;
}

const out = {
  generatedAt: new Date().toISOString(),
  account: { valorTotal: cap, disponible: cash, invertido: +acc.invertido || null },
  sizing: { posUsd, riskUsd, pctCapital: +(posUsd / cap * 100).toFixed(1), leverage: 1, stopPct: -18 },
  limits: { maxOpen: MAX_OPEN, openNow: nOpen, slotsByCount, slotsByCash, slotsUsable: slots, sectorCap: SECT_CAP },
  picks, skipped,
};

if (process.argv.includes('--json')) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }

// ── Informe legible ──
const eur = n => '$' + (+n).toFixed(2);
console.log('\n═══ SELECTOR MECÁNICO DE ENTRADAS ═══');
console.log(`Capital ${eur(cap)} · disponible ${eur(cash)} · abiertas ${nOpen}/${MAX_OPEN}`);
console.log(`Sizing ¼ Kelly: ${eur(posUsd)} por posición (${out.sizing.pctCapital}% del capital) · riesgo ${eur(riskUsd)} (2.5%) · stop −18% · 1x`);
console.log(`Cupos: por conteo ${slotsByCount} · por caja ${slotsByCash} · USABLES ${slots}`);
if (!slots) {
  console.log('\n⛔ SIN CUPO para entradas nuevas ahora (' + (slotsByCount === 0 ? `ya tienes ${nOpen} abiertas = tope ${MAX_OPEN}` : 'caja insuficiente') + ').');
} else if (!picks.length) {
  console.log('\n⚠️ Hay cupo pero ninguna candidata pasa el filtro (todas en sector lleno o vacío el radar).');
} else {
  console.log(`\n✅ ENTRAR (${picks.length}) — en este orden, a 1x, stop −18%:`);
  for (const p of picks) {
    console.log(`  • ${p.ticker.padEnd(6)} ${p.tier.padEnd(20)} ${eur(p.amountUsd)}  ${p.shares} acc  @ ${eur(p.price)}  🛑 ${eur(p.stop)}  [${p.sector || '?'}]`);
  }
}
if (skipped.length) {
  console.log(`\n↳ Saltadas por guardarraíl (${skipped.length}):`);
  for (const s of skipped.slice(0, 8)) console.log(`  – ${s.ticker.padEnd(6)} ${s.tier.padEnd(20)} ${s.reason}`);
}
console.log('\nNo ejecuto órdenes: pon estas entradas en eToro a 1x. Verifica apalancamiento 1x antes de confirmar.\n');
