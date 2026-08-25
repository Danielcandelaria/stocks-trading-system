#!/usr/bin/env node
/**
 * check_dashboard.mjs — AUDITOR de invariantes del radar + dashboard (dinero real).
 *
 * Revisa SISTEMÁTICAMENTE los bugs que ya nos han mordido, para que no vuelvan en silencio.
 * Corre a diario (launchd). Escribe el resultado a:
 *   - check_dashboard.log   (histórico legible)
 *   - dashboard_health.json  (estado que el panel puede mostrar: OK / N fallos)
 * Sale con código !=0 si hay algún fallo (para que launchd lo marque).
 *
 * NO usa Telegram (política: Telegram = solo señales de trade). Los bugs van al panel/log.
 *
 * Uso:  node check_dashboard.mjs            (audita el /api/data en vivo + los ficheros)
 *       node check_dashboard.mjs --files    (solo ficheros, sin depender del server)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const F = n => join(ROOT, n);
const rd = f => { try { return JSON.parse(readFileSync(F(f), 'utf8')); } catch { return null; } };
const PORT = +(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const FILES_ONLY = process.argv.includes('--files');
const U = s => String(s || '').toUpperCase();

const fails = [];   // { check, detail }
const fail = (check, detail) => fails.push({ check, detail });

// ── FUENTE DE VERDAD ──
const real = (rd('trades_real.json') || {}).trades || [];
const realBook = new Set(real.map(t => U(t.ticker)));                 // todo el libro real (abierto+cerrado)
const realClosed = new Set(real.filter(t => t.status === 'closed').map(t => U(t.ticker)));
const radar = rd('radar_live.json');
const pnl = rd('pnl_live.json') || { positions: [] };

// ── 1) FRESCURA: el radar y el pnl no pueden estar rancios ──
const ageDays = iso => iso ? (Date.now() - new Date(iso)) / 86400000 : Infinity;
if (!radar) fail('radar.missing', 'radar_live.json no existe o no parsea');
else if (ageDays(radar.updatedAt) > 8) fail('radar.stale', `radar_live.json tiene ${ageDays(radar.updatedAt).toFixed(1)} días (>8)`);

// ── 2) RADAR crudo: no debe haber duplicados dentro de un mismo nivel ──
if (radar?.levels) for (const lv of radar.levels) {
  const seen = new Map();
  for (const t of lv.tickers || []) { const k = U(t.ticker); seen.set(k, (seen.get(k) || 0) + 1); }
  for (const [k, n] of seen) if (n > 1) fail('radar.dupInLevel', `${k} aparece ${n}× en nivel ${lv.level}`);
}

// ── 3) API EN VIVO: contrato que ve el usuario ──
async function auditApi() {
  let data;
  try {
    const r = await fetch(`http://${HOST}:${PORT}/api/data`, { signal: AbortSignal.timeout(8000) });
    data = await r.json();
  } catch (e) { fail('api.unreachable', `no se pudo leer /api/data: ${e.message}`); return; }

  const emacross = (data.systems || []).find(s => s.id === 'EMACross');
  if (!emacross) { fail('api.noEmacross', 'no hay sistema EMACross en /api/data'); return; }

  // Recolectar todos los items de los grupos del radar, anotando su grupo.
  const byGroup = {};
  const allItems = [];
  for (const g of emacross.groups || []) {
    byGroup[g.key] = g.items || [];
    for (const it of g.items || []) allItems.push({ ...it, _group: g.key });
  }

  // 3a) Ningún ticker del libro real (abierto o cerrado) puede salir como ENTRADA en el radar.
  for (const it of allItems) if (realBook.has(U(it.ticker)))
    fail('radar.realInEntry', `${it.ticker} está en tu libro real pero sale en grupo "${it._group}" del radar`);

  // 3b) Cada ticker en UN SOLO grupo (sin duplicados entre grupos).
  const groupOf = new Map();
  for (const it of allItems) {
    const k = U(it.ticker);
    if (groupOf.has(k)) fail('radar.dupAcrossGroups', `${it.ticker} sale en "${groupOf.get(k)}" y en "${it._group}"`);
    else groupOf.set(k, it._group);
  }

  // 3c) Coherencia de tier/estrella: STACK = conf9 && below200 · CONF = conf9 && !below200 ·
  //     P1/P2/P3/VIGILAR = SIN conf9 (los de confluencia se sacan a su grupo).
  for (const it of byGroup.stack || []) if (!(it.conf9 && it.below200 === true))
    fail('tier.stackBad', `${it.ticker} en STACK pero conf9=${it.conf9} below200=${it.below200} (debe ser ambas)`);
  for (const it of byGroup.conf || []) if (!(it.conf9 && it.below200 !== true))
    fail('tier.confBad', `${it.ticker} en CONFLUENCIA pero conf9=${it.conf9} below200=${it.below200}`);
  for (const key of ['p1', 'p2', 'p3', 'vigilar']) for (const it of byGroup[key] || []) if (it.conf9)
    fail('tier.confLeak', `${it.ticker} tiene conf9 pero sale en "${key}" (debería estar en confluencia)`);

  // 3d) "EN CURSO (paper)" no debe incluir tickers de tu libro real (SYK, etc.).
  for (const s of data.systems || []) for (const o of s.open || []) if (realBook.has(U(o.ticker)))
    fail('paper.realInOpen', `${o.ticker} (libro real) sale como paper "EN CURSO" en ${s.id}`);

  // 3e) Las posiciones REALES cerradas deben mostrar su resultado fijo, no P&L recalculado.
  for (const t of data.real || []) if (t.status === 'closed' && t.pnlPct !== t.retPct)
    fail('real.closedPnl', `${t.ticker} cerrada: pnlPct(${t.pnlPct}) != retPct(${t.retPct})`);

  // 3f) Toda posición real cerrada debe llevar status='closed' (para que el panel la separe
  //     de las abiertas y no se lea como "operación abierta", p.ej. SYK).
  for (const t of data.real || []) if (t.exitDate && t.status !== 'closed')
    fail('real.closedNoStatus', `${t.ticker} tiene exitDate ${t.exitDate} pero status='${t.status}' (debería ser closed)`);
}

if (!FILES_ONLY) await auditApi();

// ── RESULTADO ──
const ok = fails.length === 0;
const stamp = new Date().toISOString();
const health = { at: stamp, ok, failCount: fails.length, fails };
try { writeFileSync(F('dashboard_health.json'), JSON.stringify(health, null, 2)); } catch {}

const line = ok
  ? `[${stamp}] ✅ OK — 0 fallos`
  : `[${stamp}] ❌ ${fails.length} FALLO(S):\n` + fails.map(f => `   · ${f.check}: ${f.detail}`).join('\n');
try {
  const prev = existsSync(F('check_dashboard.log')) ? readFileSync(F('check_dashboard.log'), 'utf8') : '';
  writeFileSync(F('check_dashboard.log'), (prev + line + '\n').split('\n').slice(-500).join('\n'));
} catch {}
console.log(line);
process.exit(ok ? 0 : 1);
