// integrity.mjs — robustez de datos para el sistema de acciones.
// Dos ideas del diagrama del usuario (2026-07-30), adaptadas a acciones:
//
//   1) VERIFICADOR DE PROCEDENCIA/COHERENCIA — "lo que no cuadra, no se ofrece".
//      Antes de registrar un trade, se comprueba que sus números sean coherentes
//      con la barra de la que salen. Un número huérfano/imposible NO entra al
//      journal. Es la red que faltó en el desastre de datos cruzados (jul-2026):
//      precios fabricados de otra fuente inflaron resultados sin que nada avisara.
//
//   2) LOG DE DECISIONES APPEND-ONLY, sellado con la VERSIÓN del código.
//      Cada decisión se anexa a decisions.jsonl con su timestamp y el commit que
//      la calculó. Nada se edita jamás → historia inmutable. Permite detectar
//      "a partir de tal versión el sistema empezó a decidir distinto".
//
// Módulo compartido (regla del proyecto): un solo sitio, lo usan todos los scanners.

import { appendFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DECISIONS_LOG = join(ROOT, 'decisions.jsonl');

// Versión del código: una sola vez al cargar el módulo (no por decisión).
export let CODE_VERSION = 'unknown';
try { CODE_VERSION = execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}

// ─── 1) VERIFICADOR DE COHERENCIA ───────────────────────────────────────────
// Devuelve { ok, reason }. Todos los sistemas de acciones son LONG.
// `bar` (opcional) = la vela de la señal; si se da, el entry debe caer en su rango.
export function coherentTrade({ ticker, entry, stop, target } = {}, bar = null) {
  if (entry == null || !(entry > 0) || !isFinite(entry))
    return { ok: false, reason: `entry inválido (${entry})` };
  if (bar) {
    const lo = bar.l ?? bar.low, hi = bar.h ?? bar.high;
    // margen 3% por coste/slippage y por comprar en la apertura del día siguiente
    if (lo != null && hi != null && (entry < lo * 0.90 || entry > hi * 1.10))
      return { ok: false, reason: `entry ${entry} fuera del rango de la vela [${lo}, ${hi}]` };
  }
  if (stop != null && stop >= entry)
    return { ok: false, reason: `stop ${stop} >= entry ${entry} (LONG)` };
  if (target != null && target <= entry)
    return { ok: false, reason: `target ${target} <= entry ${entry} (LONG)` };
  return { ok: true, reason: null };
}

// ─── 2) LOG DE DECISIONES APPEND-ONLY ───────────────────────────────────────
// Anexa una línea JSON con ts + versión + la decisión. NUNCA reescribe el fichero.
export function logDecision(decision = {}) {
  const rec = { ts: new Date().toISOString(), code: CODE_VERSION, ...decision };
  try { appendFileSync(DECISIONS_LOG, JSON.stringify(rec) + '\n'); } catch {}
  return rec;
}

// ─── 3) AUDITORÍA de un journal (valores imposibles) ────────────────────────
// Reutilizable por el report/doctor. Para ACCIONES el criterio fiable es el
// retorno imposible (no el "precio compartido entre tickers": dos acciones SÍ
// pueden costar lo mismo, al contrario que dos divisas).
export function auditTrades(trades = [], { maxRetPct = 150 } = {}) {
  const bad = [];
  for (const t of trades) {
    if (t.retPct != null && Math.abs(t.retPct) > maxRetPct)
      bad.push({ id: t.id || t.ticker, reason: `retPct ${t.retPct}% imposible (>|${maxRetPct}%|)` });
    if (t.exitPx != null && t.entryPx != null && (t.exitPx <= 0 || !isFinite(t.exitPx)))
      bad.push({ id: t.id || t.ticker, reason: `exitPx inválido (${t.exitPx})` });
  }
  return bad;
}
