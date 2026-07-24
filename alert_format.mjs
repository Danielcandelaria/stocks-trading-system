// alert_format.mjs — formato ÚNICO y CONCISO de las señales de acciones.
//
// Motivación (2026-07-24): los avisos eran largos y cada scanner tenía el suyo,
// mezclando explicación con niveles → confusos para operar. Este helper es la
// ÚNICA fuente del formato: 3 líneas de niveles OPERABLES arriba (entra / sal /
// stop, con precios exactos), y el "por qué" reducido a una línea al final.
//
// Regla del proyecto: formato compartido en UN sitio, no duplicado por scanner.
//
// buildStockAlert({
//   emoji, system, ticker, sector, theme?,     // cabecera
//   entry, entryNote?,                          // 🟢 a qué precio se ENTRA
//   target?, rr?, targetNote?,                  // 🎯 a qué precio se SALE con beneficio
//   stop?, stopNote?,                           // 🛑 a qué precio se corta la pérdida
//   noStopReason?,                              // si la estrategia NO lleva stop (RSI2): por qué
//   horizon?, size?, why?, tv?                  // pie
// })  → string HTML listo para Telegram.

const money = n => `$${Number(n).toFixed(2)}`;
const pct = (a, b) => `${((a - b) / b * 100).toFixed(1)}%`;   // variación de a respecto a b

export function buildStockAlert(o) {
  const L = [];

  // ── Cabecera: acción + sistema, sin ruido ──
  L.push(`${o.emoji} <b>COMPRA ${o.ticker}</b> · ${o.system}`);
  if (o.theme) L.push(`🔥 ${o.theme}`);
  L.push('━━━━━━━━━━━━━━━');

  // ── Los 3 niveles OPERABLES, en el orden en que se usan ──
  L.push(`🟢 <b>ENTRA</b>   ${money(o.entry)}${o.entryNote ? `  <i>${o.entryNote}</i>` : ''}`);

  if (o.target != null) {
    const gain = `+${pct(o.target, o.entry)}${o.rr ? ` · +${o.rr}R` : ''}`;
    L.push(`🎯 <b>SAL</b>     ${money(o.target)}  <i>${gain}${o.targetNote ? ` · ${o.targetNote}` : ''}</i>`);
  } else if (o.targetNote) {
    // Sistemas sin precio fijo de salida (RSI2, Weekly): la regla, en una línea.
    L.push(`🎯 <b>SAL</b>     <i>${o.targetNote}</i>`);
  }

  if (o.stop != null) {
    L.push(`🛑 <b>STOP</b>    ${money(o.stop)}  <i>−${pct(o.entry, o.stop).replace('-', '')}${o.stopNote ? ` · ${o.stopNote}` : ''}</i>`);
  } else {
    // Honestidad: si la spec NO lleva stop, se dice — no se inventa un nivel.
    L.push(`🛑 <b>STOP</b>    <i>sin stop — ${o.noStopReason || 'salida por tiempo'}</i>`);
  }

  // ── Pie compacto: tamaño, horizonte, contexto ──
  L.push('━━━━━━━━━━━━━━━');
  const pie = [];
  if (o.size) pie.push(`📐 ${o.size}`);
  if (o.horizon) pie.push(`⏳ ${o.horizon}`);
  if (pie.length) L.push(pie.join('  ·  '));
  if (o.why) L.push(`<i>${o.why}</i>`);
  if (o.tv) L.push(`TV: ${o.tv}`);

  return L.join('\n');
}
