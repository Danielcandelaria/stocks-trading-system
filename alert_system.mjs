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

/** Aviso del RADAR: cuántas hay por nivel y qué mirar. */
export function buildRadarAlert({ yaCruzado = 0, aPunto = 0, acercandose = 0 } = {}) {
  const s = SYS.EMACross;
  return `🎯 <b>RADAR ${s.name}</b> — ${ahora()}` +
    `\n\n🟢 <b>${yaCruzado}</b> YA CRUZADO (entrada válida)` +
    `\n⚡ <b>${aPunto}</b> a punto de cruzar` +
    `\n⏳ <b>${acercandose}</b> acercándose` +
    `\n\n📈 <b>En TradingView:</b>\n   ${s.tv}` +
    `\n\n👉 <b>Lista completa y rentabilidad:</b> ${DASH_URL}`;
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
