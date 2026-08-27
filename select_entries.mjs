#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// SELECTOR MECÁNICO DE ENTRADAS + SIZING  (CLI). Lógica en entry_engine.mjs (compartida
// con el dashboard). Aquí: lee ficheros, persiste el estado del freno, imprime el informe.
//
// NO ejecuta órdenes: imprime QUÉ entrar, CUÁNTO y con qué stop. Tú lo pones en eToro a 1x.
// Uso:  node select_entries.mjs         ·  node select_entries.mjs --json
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { selectEntries, frenoState } from './entry_engine.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const rd = f => { try { return JSON.parse(readFileSync(join(ROOT, f), 'utf8')); } catch { return null; } };

const acc = rd('account.json') || {};
const radar = rd('radar_live.json');
if (!acc.valorTotal || !radar) { console.error('Faltan account.json o radar_live.json'); process.exit(1); }

// Persistir el estado del freno (pico + on/off) sin tocar el resto del fichero. Solo el CLI escribe.
const fr = frenoState(acc);
if (acc.peakValue !== fr.peak || acc.frenoActivo !== fr.frenoActivo) {
  try { writeFileSync(join(ROOT, 'account.json'), JSON.stringify({ ...acc, peakValue: fr.peak, frenoActivo: fr.frenoActivo }, null, 2) + '\n'); } catch {}
}

const out = selectEntries({ radar, trades: (rd('trades_real.json') || {}).trades || [], universe: rd('universe.json'), account: acc, weeklyJournal: rd('journal_weekly.json') || [], nowMs: Date.now() });
out.generatedAt = new Date().toISOString();

if (process.argv.includes('--json')) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }

const eur = n => '$' + (+n).toFixed(2);
const { picks, skipped, freno, limits, sizing, account } = out;
console.log('\n═══ SELECTOR MECÁNICO DE ENTRADAS ═══');
console.log(`Capital ${eur(account.valorTotal)} · disponible ${eur(account.disponible)} · abiertas ${limits.openNow}/${limits.maxOpen}`);
console.log(`Freno de cartera: pico ${eur(freno.peak)} · drawdown ${freno.ddPct}% · ` + (freno.activo ? `🚨 ACTIVO (pausa <${freno.pausaEn}%, reactiva ≥${freno.reactivaEn}%)` : `✅ inactivo (pausa en ${freno.pausaEn}%)`));
console.log(`Sizing ¼ Kelly: ${eur(sizing.posUsd)} por posición (${sizing.pctCapital}% del capital) · riesgo ${eur(sizing.riskUsd)} (2.5%) · stop −18% · 1x`);
console.log(`Cupos: por conteo ${limits.slotsByCount} · por caja ${limits.slotsByCash} · USABLES ${limits.slotsUsable}`);
if (freno.activo) {
  console.log(`\n🚨 FRENO DE CARTERA ACTIVO — drawdown ${freno.ddPct}% desde el pico ${eur(freno.peak)}. CERO entradas nuevas hasta recuperar por encima de ${freno.reactivaEn}%. Sigue gestionando las abiertas con su cruce/stop normal.`);
} else if (!limits.slotsUsable) {
  console.log('\n⛔ SIN CUPO para entradas nuevas ahora (' + (limits.slotsByCount === 0 ? `ya tienes ${limits.openNow} abiertas = tope ${limits.maxOpen}` : 'caja insuficiente') + ').');
} else if (!picks.length) {
  console.log('\n⚠️ Hay cupo pero ninguna candidata pasa el filtro (todas en sector lleno o vacío el radar).');
} else {
  console.log(`\n✅ ENTRAR (${picks.length}) — en este orden, a 1x:`);
  for (const p of picks) console.log(`  • ${p.ticker.padEnd(6)} ${(p.tier||'').padEnd(28)} ${eur(p.amountUsd)}  ${p.shares} acc  @ ${eur(p.price)}  🛑 ${eur(p.stop)}  [${p.sector || '?'}]`);
}
if (skipped.length) {
  console.log(`\n↳ Saltadas por guardarraíl (${skipped.length}):`);
  for (const s of skipped.slice(0, 8)) console.log(`  – ${s.ticker.padEnd(6)} ${s.tier.padEnd(20)} ${s.reason}`);
}
console.log('\nNo ejecuto órdenes: pon estas entradas en eToro a 1x. Verifica apalancamiento 1x antes de confirmar.\n');
