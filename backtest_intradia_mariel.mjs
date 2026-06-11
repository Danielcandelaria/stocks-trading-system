// stocks/backtest_intradia_mariel.mjs
// Test de la estrategia intradía de Mariel (vídeo 2, "motion/liquidaciones"):
// 5m, NASDAQ/NYSE, entradas tras las 10:00 ET, todo cerrado al final de sesión.
//
// FORMALIZACIÓN MECÁNICA DECLARADA (la original tiene lectura discrecional de
// niveles; esto es la aproximación testeable):
//  Setup A (reversal-rechazo, su entrada principal):
//   - A las 10:00 ET: rango del día (high-low)/open ≥ umbral (filtro) y ≤15%.
//   - Tendencia intradía = precio@10:00 vs open de sesión.
//   - Tras nuevo extremo del día en la dirección de la tendencia, esperar rebote
//     ≥0.3%; el extremo del rebote = "daily hold". Si el precio vuelve al hold
//     (±0.1%) y la vela RECHAZA (cierra en contra del rebote), entrada con la
//     tendencia. Ventana de validación: 10-60 min (2 a 12 velas).
//  Setup B (ruptura del extremo diario):
//   - Tras las 10:00: vela que CIERRA más allá del high/low del día con volumen
//     >1.5× la media de 20 velas → entrada en la apertura siguiente.
//  Salidas (ambos): SL fijo %, TP fijo %, o cierre forzoso 15:55 ET.
//  1 trade por ticker/día (el primero). Costes 0.05%/lado.
//
// ⚠️ Datos: Yahoo 5m solo da ~60 días → esto testea el RÉGIMEN RECIENTE,
//    no es una validación de 2 años. WF = 4 ventanas de ~15 días.

import { readFileSync, readdirSync } from 'fs';

const COST = 0.0005;
const DIR = '/tmp/intraday5m';
const fmtET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
function et(t) {
  const p = Object.fromEntries(fmtET.formatToParts(new Date(t * 1000)).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, min: (+p.hour) * 60 + (+p.minute) };
}

// agrupa por día de mercado
function byDay(bars) {
  const days = new Map();
  for (const b of bars) {
    const { day, min } = et(b.t);
    if (min < 570 || min >= 960) continue; // 9:30-16:00 ET
    if (!days.has(day)) days.set(day, []);
    days.get(day).push({ ...b, min });
  }
  return [...days.values()].filter(d => d.length >= 60);
}

function simExit(dayBars, i, dir, entry, slPct, tpPct) {
  const sl = dir === 'L' ? entry * (1 - slPct) : entry * (1 + slPct);
  const tp = dir === 'L' ? entry * (1 + tpPct) : entry * (1 - tpPct);
  for (let j = i; j < dayBars.length; j++) {
    const b = dayBars[j];
    if (b.min >= 955) { const px = b.c; return dir === 'L' ? px / entry - 1 : entry / px - 1; }
    if (dir === 'L') {
      if (b.l <= sl) return Math.min(b.o, sl) / entry - 1;
      if (b.h >= tp) return Math.max(b.o, tp) / entry - 1;
    } else {
      if (b.h >= sl) return entry / Math.max(b.o, sl) - 1;
      if (b.l <= tp) return entry / Math.min(b.o, tp) - 1;
    }
  }
  const last = dayBars[dayBars.length - 1].c;
  return dir === 'L' ? last / entry - 1 : entry / last - 1;
}

function run(setup, slPct, tpPct, rangeMin) {
  const trades = [];
  for (const f of readdirSync(DIR)) {
    const { bars } = JSON.parse(readFileSync(`${DIR}/${f}`));
    for (const day of byDay(bars)) {
      const open = day[0].o;
      const i10 = day.findIndex(b => b.min >= 600); // 10:00
      if (i10 < 3) continue;
      let hi = Math.max(...day.slice(0, i10).map(b => b.h));
      let lo = Math.min(...day.slice(0, i10).map(b => b.l));
      const range = (hi - lo) / open;
      if (range < rangeMin || range > 0.15) continue;
      const trendDown = day[i10].c < open;
      let done = false;

      if (setup === 'A') {
        // reversal-rechazo con la tendencia intradía
        let ext = trendDown ? lo : hi, extIdx = i10, hold = null, holdIdx = -1;
        for (let i = i10; i < day.length - 1 && !done; i++) {
          const b = day[i];
          if (b.min >= 900) break; // no entrar después de las 15:00
          if (trendDown) {
            if (b.l < ext) { ext = b.l; extIdx = i; hold = null; continue; }
            if (hold === null && b.h > ext * 1.003) { hold = b.h; holdIdx = i; continue; }
            if (hold !== null) {
              if (b.h > hold) { hold = b.h; holdIdx = i; continue; } // rebote sigue
              const since = i - holdIdx;
              if (since >= 2 && since <= 12 && b.h >= hold * 0.999 && b.c < b.o) {
                trades.push({ t: b.t, ret: simExit(day, i + 1, 'S', day[i + 1].o * (1 - COST), slPct, tpPct) - COST });
                done = true;
              }
            }
          } else {
            if (b.h > ext) { ext = b.h; extIdx = i; hold = null; continue; }
            if (hold === null && b.l < ext * 0.997) { hold = b.l; holdIdx = i; continue; }
            if (hold !== null) {
              if (b.l < hold) { hold = b.l; holdIdx = i; continue; }
              const since = i - holdIdx;
              if (since >= 2 && since <= 12 && b.l <= hold * 1.001 && b.c > b.o) {
                trades.push({ t: b.t, ret: simExit(day, i + 1, 'L', day[i + 1].o * (1 + COST), slPct, tpPct) - COST });
                done = true;
              }
            }
          }
        }
      } else {
        // B: ruptura del extremo del día con volumen
        for (let i = i10; i < day.length - 1 && !done; i++) {
          const b = day[i];
          if (b.min >= 900) break;
          const vAvg = day.slice(Math.max(0, i - 20), i).reduce((s, x) => s + x.v, 0) / Math.min(i, 20);
          if (b.c > hi && b.v > 1.5 * vAvg) {
            trades.push({ t: b.t, ret: simExit(day, i + 1, 'L', day[i + 1].o * (1 + COST), slPct, tpPct) - COST });
            done = true;
          } else if (b.c < lo && b.v > 1.5 * vAvg) {
            trades.push({ t: b.t, ret: simExit(day, i + 1, 'S', day[i + 1].o * (1 - COST), slPct, tpPct) - COST });
            done = true;
          }
          if (b.h > hi) hi = b.h;
          if (b.l < lo) lo = b.l;
        }
      }
    }
  }
  if (trades.length < 50) return null;
  const ts = trades.map(t => t.t), lo2 = Math.min(...ts), span = (Math.max(...ts) - lo2) / 4;
  let pass = 0; const wf = [];
  for (let w = 0; w < 4; w++) {
    const sub = trades.filter(t => t.t >= lo2 + w * span && t.t < lo2 + (w + 1) * span);
    const s = sub.reduce((a, t) => a + t.ret, 0);
    wf.push(sub.length ? (s / sub.length * 100).toFixed(2) : '-');
    if (sub.length && s > 0) pass++;
  }
  const wins = trades.filter(t => t.ret > 0);
  const gp = wins.reduce((s, t) => s + t.ret, 0), gl = trades.filter(t => t.ret <= 0).reduce((s, t) => s - t.ret, 0);
  const sum = trades.reduce((s, t) => s + t.ret, 0);
  return {
    n: trades.length, wr: +(wins.length / trades.length * 100).toFixed(1),
    pf: +(gp / gl).toFixed(2), avg: +(sum / trades.length * 100).toFixed(3),
    rPerTrade: +(sum / trades.length / slPct).toFixed(2), wfPass: pass, wf,
  };
}

console.log('setup | SL% | TP% | rangoMín | n | WR% | PF | avg% | R/tr | WF | avg% por ventana');
for (const setup of ['A', 'B'])
  for (const sl of [0.003, 0.005])
    for (const tp of [0.01, 0.02, 0.03])
      for (const rmin of [0.015, 0.0]) {
        const s = run(setup, sl, tp, rmin);
        if (s) console.log(`${setup} | ${sl * 100} | ${tp * 100} | ${rmin * 100}% | ${s.n} | ${s.wr} | ${s.pf} | ${s.avg} | ${s.rPerTrade} | ${s.wfPass}/4 | [${s.wf.join(', ')}]`);
      }
