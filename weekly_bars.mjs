// weekly_bars.mjs — FUENTE ÚNICA de barras semanales (Yahoo). Fix bugs 2026-08-16.
//
// Dos problemas reales de los datos de Yahoo que causaban CRUCES FALSOS:
//   1) SEMANA DUPLICADA: cuando la semana ya cerró, Yahoo devuelve la barra semanal
//      anclada al lunes Y ADEMÁS una barra parcial del viernes con el MISMO cierre.
//      Contar las dos mete una semana de más en la EMA → cruces que no existen
//      (visto 2026-08-16: DIS/CRM/PTC salían "cruzados" y TV decía que no).
//   2) SEMANA EN CURSO: durante la semana viva la última barra está incompleta;
//      para detectar cruces CONFIRMADOS hay que descartarla, salvo que la semana
//      bursátil ya haya terminado (finde o viernes tras el cierre US).
//
// getWeeklyBars() devuelve SOLO velas semanales cerradas y sin duplicados → es lo que
// debe usar cualquier scanner. Coincide con lo que pinta TradingView.

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };

/** ¿La semana bursátil ya terminó? (sáb/dom, o viernes tras el cierre US ~20:00 UTC) */
export function weekIsOver(d = new Date()) {
  const dow = d.getUTCDay(), h = d.getUTCHours();
  return dow === 0 || dow === 6 || (dow === 5 && h >= 20);
}

/**
 * Barras semanales CERRADAS y deduplicadas.
 * @param {string} ticker
 * @param {{range?:string, ohlc?:boolean}} opts  ohlc:true → incluye o/h/l/v
 * @returns {Promise<Array|null>} [{t, c, ...}] o null si no hay datos suficientes
 */
export async function getWeeklyBars(ticker, { range = '2y', ohlc = false, keepForming = false } = {}) {
  const y = ticker.replace('.', '-');
  let json;
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=${range}&interval=1wk`, { headers: UA });
    if (!res.ok) return null;
    json = await res.json();
  } catch { return null; }
  const r = json?.chart?.result?.[0], q = r?.indicators?.quote?.[0];
  if (!r?.timestamp || !q) return null;

  const bars = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    if (q.close[i] == null) continue;
    const b = { t: r.timestamp[i], c: q.close[i] };
    if (ohlc) { b.o = q.open[i]; b.h = q.high[i]; b.l = q.low[i]; b.v = q.volume?.[i] ?? 0; }
    bars.push(b);
  }
  if (!bars.length) return null;

  // (1) quitar barras PARCIALES duplicadas: separadas <7 días de la anterior = misma semana
  const dedup = [];
  for (const b of bars) {
    const prev = dedup[dedup.length - 1];
    if (prev && (b.t - prev.t) < 6.5 * 86400) { dedup[dedup.length - 1] = prev; continue; }  // conserva la barra ANCLADA (lunes)
    dedup.push(b);
  }

  // (2) quitar la semana EN CURSO si aún no ha terminado
  const NOW = Date.now() / 1000;
  if (!keepForming && !weekIsOver() && dedup.length && NOW - dedup[dedup.length - 1].t < 7 * 86400) dedup.pop();

  return dedup.length ? dedup : null;
}

/** EMA clásica sobre un array de cierres. */
export const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map(c => { e = e === null ? c : c * k + e * (1 - k); return e; }); };
