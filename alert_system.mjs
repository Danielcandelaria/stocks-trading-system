// alert_system.mjs — aviso de Telegram ÚNICO y claro por sistema.
// No lista tickers (el detalle está en el dashboard): dice QUÉ SISTEMA es, QUÉ MIRAR
// en TradingView (timeframe + indicador + qué buscar) y enlaza al panel.

const DASH_URL = process.env.DASH_URL || 'http://localhost:8080';
const ahora = () => new Date().toLocaleString('es-ES', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

const SYS = {
  EMACross: {
    emoji: '🔵', name: 'EMACROSS',
    que: 'Cruce EMA 8/21 SEMANAL · seguimiento de tendencia (large-caps)',
    tv: 'Gráfico <b>SEMANAL (1W)</b> + indicador <b>«EMA 8/21 · Entradas, Salidas y Anticipación»</b>\n   → busca la etiqueta verde <b>COMPRA</b> (EMA8 naranja cruzando SOBRE la EMA21 azul)',
    reglas: 'Salida: cruce contrario (dejar correr, sin TP) · Stop: −18%',
  },
  WeeklySwing: {
    emoji: '🟣', name: 'WEEKLYSWING',
    que: 'DeMark Setup-9 SEMANAL · compra el suelo de agotamiento (large-caps)',
    tv: 'Gráfico <b>SEMANAL (1W)</b> + indicador <b>«DeMARK 9-13»</b>\n   → busca el <b>9 pintado ABAJO</b> (suelo de compra), NO el 13 de arriba',
    reglas: 'Salida: countdown-13 / 52 semanas / stop · Stop: mínimo del setup',
  },
  EMACrossMid: {
    emoji: '🟪', name: 'EMACROSS MID',
    que: 'Mismo cruce EMA 8/21 pero en mid-caps ($2-8B) — ⚠️ SOLO OBSERVACIÓN, no operar',
    tv: 'Gráfico <b>SEMANAL (1W)</b> + indicador <b>«EMA 8/21»</b> (informativo)',
    reglas: 'En estudio: recogiendo datos, aún sin validar en real',
  },
};

/** Aviso del RADAR enfocado a los 2 cubos accionables (sin ruido).
 *  p1 = anticipadas inminentes (ENTRAR AHORA, entra barato antes del cruce)
 *  p2 = cruzadas FUERTES (ext≥15%, merecen la pena aunque ya cruzaron)
 *  Cada item: { ticker, price, stop }. `vigilar` = nº en anticipación temprana (solo cuenta). */
export function buildRadarAlert({ conf = [], p1 = [], p2 = [], vigilar = 0 } = {}) {
  const s = SYS.EMACross;
  const fmt = t => `   • <b>${t.ticker}</b>  $${t.price}  🛑 SL $${t.stop}`;
  const fmtC = t => `   ⭐ <b>${t.ticker}</b>  $${t.price}  🛑 SL $${t.stop}  <i>(${t.detail})</i>`;
  if (!conf.length && !p1.length && !p2.length) {
    return `🎯 <b>RADAR ${s.name}</b> — ${ahora()}` +
      `\n\nSin señales accionables ahora mismo.` +
      (vigilar ? `\n⏳ ${vigilar} en anticipación temprana (vigilando).` : '') +
      `\n\n👉 ${DASH_URL}`;
  }
  let m = `🎯 <b>RADAR ${s.name} — ENTRAR AHORA</b>  <i>${ahora()}</i>`;
  if (conf.length) m += `\n\n⭐ <b>CONFLUENCIA (MÁXIMA PRIORIDAD)</b> — cruce + setup-9 debajo:\n` + conf.map(fmtC).join('\n');
  if (p1.length) m += `\n\n🟢 <b>ANTICIPADAS</b> (entra ANTES del cruce = más barato):\n` + p1.map(fmt).join('\n');
  if (p2.length) m += `\n\n💪 <b>CRUZADAS FUERTES</b> (ext≥15%, siguen valiendo):\n` + p2.map(fmt).join('\n');
  m += `\n\n📈 <b>En TradingView:</b>\n   ${s.tv}`;
  m += `\n⚙️ ${s.reglas}`;
  if (vigilar) m += `\n\n⏳ ${vigilar} más en anticipación temprana (aún no accionables).`;
  m += `\n\n👉 <b>Detalle y SL en el panel:</b> ${DASH_URL}`;
  return m;
}

/** Aviso ⭐ CONFLUENCIA — máxima prioridad (cruce EMA + setup-9 reciente debajo).
 *  list: [{ ticker, price, stop, detail, bars9 }]. isNew=true → ping urgente de señales nuevas. */
export function buildConfluenceAlert(list = [], { isNew = false } = {}) {
  if (!list.length) return null;
  const s = SYS.EMACross;
  const fmt = t => `   ⭐ <b>${t.ticker}</b>  $${t.price}  🛑 SL $${t.stop}  <i>(${t.detail}, 9 hace ${t.bars9}v)</i>`;
  const head = isNew
    ? `⭐⭐ <b>NUEVA CONFLUENCIA — MÁXIMA PRIORIDAD</b> ⭐⭐  <i>${ahora()}</i>`
    : `⭐ <b>CONFLUENCIA ${s.name} — MÁXIMA PRIORIDAD</b>  <i>${ahora()}</i>`;
  return `${head}` +
    `\n<i>Cruce EMA8/21 + Setup-9 reciente debajo = la mejor calidad (backtest PF 4.28 vs 3.24).</i>` +
    `\n\n${list.map(fmt).join('\n')}` +
    `\n\n📈 Gráfico <b>SEMANAL</b> · entra en el cruce/anticipación · stop −18% · deja correr hasta el cruce contrario.` +
    `\n👉 <b>Panel:</b> ${DASH_URL}`;
}

/** Aviso de OPORTUNIDADES nuevas de un sistema. */
export function buildSystemAlert(systemId, n, { kind = 'entrada' } = {}) {
  const s = SYS[systemId]; if (!s) return null;
  const plural = n > 1;
  const titulo = kind === 'salida'
    ? `⚠️ <b>${s.emoji} ${s.name} — ${n} posición${plural ? 'es' : ''} A CERRAR</b>`
    : `${s.emoji} <b>${s.name} — ${n} señal${plural ? 'es' : ''} NUEVA${plural ? 'S'  : ''}</b>  <i>${ahora()}</i>`;
  const cuerpo = kind === 'salida'
    ? `\n\n🔻 La tendencia se ha roto (cruce contrario) → toca cerrar y tomar el resultado.`
    : `\n\n📊 <b>Sistema:</b> ${s.que}` +
      `\n\n📈 <b>Qué mirar en TradingView:</b>\n   ${s.tv}` +
      `\n\n⚙️ ${s.reglas}`;
  return `${titulo}${cuerpo}\n\n👉 <b>Tickers y rentabilidad:</b> ${DASH_URL}`;
}
