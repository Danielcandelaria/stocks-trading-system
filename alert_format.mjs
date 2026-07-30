// alert_format.mjs — formato ÚNICO y MÍNIMO de las señales de acciones.
//
// Objetivo (2026-07-28): que se lea de un vistazo en el móvil. Solo lo que se
// necesita para operar: qué comprar y TRES precios (entra / vende / stop). Sin
// explicaciones entre paréntesis, sin líneas de "por qué", sin separadores.
// La teoría se consulta en el dashboard; el aviso es para ACTUAR.
//
// Regla del proyecto: formato compartido en UN sitio, no duplicado por scanner.
//
// buildStockAlert({
//   emoji, ticker, theme?,
//   entry,                       // 🟢 precio de compra
//   target?, rr?, targetRule?,   // 🎯 precio de venta con ganancia (o regla corta)
//   stop?, stopKind?, noStop?,   // 🛑 precio de stop (o "posición pequeña" si no hay)
//   note?,                       // ⏱ una nota corta opcional (p.ej. "o a los 5 días")
//   tv?
// })  → string HTML corto para Telegram.

const money = n => `$${Number(n).toFixed(2)}`;
const pct = (a, b) => `${Math.abs((a - b) / b * 100).toFixed(0)}%`;   // entero, más limpio

export function buildStockAlert(o) {
  const L = [];

  // Cabecera: acción + acción, en una línea. Tema fuerte, si lo hay, al lado.
  L.push(`${o.emoji} <b>COMPRA ${o.ticker}</b>${o.theme ? `  🔥${o.theme}` : ''}`);

  // 🟢 Entra
  L.push(`🟢 Entra  <b>${money(o.entry)}</b>`);

  // 🎯 Vende (precio fijo → número; si no, regla corta)
  if (o.target != null) {
    L.push(`🎯 Vende  <b>${money(o.target)}</b>  <i>+${pct(o.target, o.entry)}</i>`);
  } else if (o.targetRule) {
    L.push(`🎯 Vende  <i>${o.targetRule}</i>`);
  }

  // 🛑 Stop (precio → número; si no lleva, recuerda la posición pequeña)
  if (o.stop != null) {
    L.push(`🛑 Stop   <b>${money(o.stop)}</b>  <i>−${pct(o.stop, o.entry)}</i>`);
  } else if (o.noStop) {
    L.push(`🛑 Stop   <i>sin stop — posición pequeña (2-3%)</i>`);
  }

  // Nota corta opcional (una sola línea, sin adornos)
  if (o.note) L.push(`⏱ <i>${o.note}</i>`);
  if (o.tv) L.push(`📊 ${o.tv}`);

  return L.join('\n');
}
