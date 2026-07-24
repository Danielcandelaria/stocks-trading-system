// alert_format.mjs — formato ÚNICO de las señales de acciones, en lenguaje llano.
//
// Objetivo (2026-07-24): que se opere leyendo el móvil, sin saber nada de la
// estrategia por dentro. Verbos imperativos (COMPRA / VENDE), los DOS tipos de
// venta etiquetados en claro —"ganancia" vs "pérdida"— y CERO jerga en las
// líneas de acción (nada de SMA5, BOS, EMA8, setup-9). El "por qué" va al final
// en una frase de andar por casa.
//
// Regla del proyecto: formato compartido en UN sitio, no duplicado por scanner.
//
// buildStockAlert({
//   emoji, ticker, sector?, theme?,
//   entry, entryWhen?,          // 🟢 COMPRA: precio + cuándo ("a mercado", "apertura US 15:30h")
//   target?, rr?,               // 🎯 VENDE con GANANCIA a un precio fijo
//   targetRule?,                // 🎯 VENDE con GANANCIA por REGLA (cuando no hay precio fijo)
//   stop?,                      // 🛑 VENDE por PÉRDIDA a este precio
//   noStop?, size?,             // sistemas sin stop → aviso de posición pequeña
//   timeLimit?,                 // ⏱ "Máximo 5 días: si no sube, vende igual"
//   horizon?, why?, tv?
// })  → string HTML para Telegram.

const money = n => `$${Number(n).toFixed(2)}`;
const pct = (a, b) => `${Math.abs((a - b) / b * 100).toFixed(1)}%`;

export function buildStockAlert(o) {
  const L = [];
  L.push(`${o.emoji} <b>COMPRA — ${o.ticker}</b>`);
  if (o.theme) L.push(`🔥 ${o.theme}`);
  L.push('━━━━━━━━━━━━━━━');

  // 🟢 Qué comprar y a cuánto
  L.push(`🟢 <b>COMPRA</b> a ${money(o.entry)}${o.entryWhen ? `  <i>(${o.entryWhen})</i>` : ''}`);

  // 🎯 Vender para GANAR — precio fijo o regla en claro
  if (o.target != null) {
    const g = `+${pct(o.target, o.entry)}${o.rr ? ` · +${o.rr}R` : ''}`;
    L.push(`🎯 <b>VENDE con ganancia</b> a ${money(o.target)}  <i>(${g})</i>`);
  } else if (o.targetRule) {
    L.push(`🎯 <b>VENDE con ganancia</b>: <i>${o.targetRule}</i>`);
  }

  // 🛑 Vender para CORTAR PÉRDIDA — o aviso de que no hay stop
  if (o.stop != null) {
    L.push(`🛑 <b>VENDE si baja</b> a ${money(o.stop)}  <i>(−${pct(o.entry, o.stop)}, corta la pérdida)</i>`);
  } else if (o.noStop) {
    L.push(`🛡 <b>Sin stop</b> — por eso, <b>poco dinero</b>${o.size ? ` (${o.size})` : ''}`);
  }

  // ⏱ Límite de tiempo (opcional)
  if (o.timeLimit) L.push(`⏱ ${o.timeLimit}`);
  // 📐 Tamaño (cuando SÍ hay stop)
  if (o.size && !o.noStop) L.push(`📐 Tamaño: ${o.size}`);
  // ⏳ Cuánto puede durar
  if (o.horizon) L.push(`⏳ ${o.horizon}`);

  L.push('━━━━━━━━━━━━━━━');
  if (o.why) L.push(`💡 <i>${o.why}</i>`);
  if (o.tv) L.push(`<i>TV: ${o.tv}</i>`);
  return L.join('\n');
}
