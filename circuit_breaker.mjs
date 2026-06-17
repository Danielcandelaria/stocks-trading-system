// stocks/circuit_breaker.mjs
// Circuit-breaker de drawdown (Two Sigma #3): cuando una estrategia cruza su
// banda p95 de Monte Carlo, PAUSA automáticamente sus ENTRADAS nuevas y alerta.
// Cierra el bucle: monitor_health DETECTA degradación, el breaker ACTÚA.
//
// - NO cierra posiciones abiertas (eso fijaría pérdidas): solo frena riesgo NUEVO.
// - Estado persistente en circuit_breaker.json (sobrevive reinicios).
// - Reset manual cuando el humano decide reanudar: node circuit_breaker.mjs --reset
//
// Bandas (de REPORTE Monte Carlo / METODOLOGIA, p95 a 30 trades):
//   DeMark TP2: drawdown corriente > 7R  ó  racha perdedora > 6
//   RSI-2:      racha perdedora > 6 (sin SL ⇒ no hay banda en R)

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tgSend } from './tg.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const F = n => join(ROOT, n);
const load = (f, d) => existsSync(F(f)) ? JSON.parse(readFileSync(F(f))) : d;
const save = (f, v) => writeFileSync(F(f), JSON.stringify(v, null, 2));

const BANDS = {
  DeMark: { maxDD: 7, streak: 6, sel: p => p.status === 'closed' && p.variant === 'TP2', val: p => p.r, unit: 'R' },
  RSI2: { maxDD: null, streak: 6, sel: p => p.status === 'closed' && p.strategy === 'RSI2', val: p => p.retPct, unit: '%' },
};

// drawdown corriente (desde el último pico) y racha perdedora en curso
function liveState(trades, valFn) {
  const vals = trades.sort((a, b) => a.exitT - b.exitT).map(valFn);
  let eq = 0, peak = 0, streak = 0;
  for (const v of vals) { eq += v; peak = Math.max(peak, eq); if (v <= 0) streak++; else streak = 0; }
  return { curDD: peak - eq, streak, n: vals.length };
}

export function evaluateBreaker(journal, { alert = true } = {}) {
  const state = load('circuit_breaker.json', { DeMark: {}, RSI2: {} });
  const messages = [];
  for (const [name, b] of Object.entries(BANDS)) {
    const ls = liveState(journal.filter(b.sel), b.val);
    const ddTrip = b.maxDD != null && ls.curDD > b.maxDD;
    const stTrip = ls.streak > b.streak;
    const trip = ddTrip || stTrip;
    const prev = state[name] || {};
    if (trip && !prev.paused) {
      const reason = [ddTrip ? `drawdown ${ls.curDD.toFixed(1)}${b.unit} > ${b.maxDD}${b.unit}` : null,
                      stTrip ? `racha ${ls.streak} pérdidas > ${b.streak}` : null].filter(Boolean).join(' + ');
      state[name] = { paused: true, reason, trippedAt: new Date().toISOString(), n: ls.n };
      messages.push(`🔴🛑 <b>CIRCUIT-BREAKER: ${name} PAUSADO</b>\n${reason}\nNo se abren entradas nuevas hasta reset manual. Las posiciones abiertas siguen gestionándose.`);
    } else if (!trip && !prev.paused) {
      state[name] = { paused: false };
    } // si ya estaba pausado, se queda pausado hasta reset manual
  }
  save('circuit_breaker.json', state);
  if (alert && messages.length) tgSend(messages.join('\n\n')); // fire-and-forget
  return state;
}

export function isPaused(strategy) {
  const state = load('circuit_breaker.json', {});
  return !!state[strategy]?.paused;
}

// CLI: --reset reanuda todo; sin args muestra estado
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--reset')) {
    save('circuit_breaker.json', { DeMark: { paused: false }, RSI2: { paused: false } });
    console.log('✅ Circuit-breaker reseteado — todas las estrategias reanudadas.');
  } else {
    console.log(JSON.stringify(load('circuit_breaker.json', { DeMark: {}, RSI2: {} }), null, 2));
  }
}
