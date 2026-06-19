// stocks/sizing.mjs
// Calculadora de tamaño de posición. Trabaja en EUROS (T212 compra fracciones por
// importe en €, así que el precio unitario de la acción da igual).
//
// Regla: arriesgas 1% de la cuenta por operación. La posición = riesgo / distancia
// al stop. Si te saltan el stop, pierdes exactamente el 1%.
//
// ⚙️ CAMBIA AQUÍ tu cuenta cuando crezca:
export const ACCOUNT_EUR = 3000;
export const RISK_PCT = 0.01;             // 1% por trade
export const MAX_POS_PCT = 0.30;          // tope: ningún trade ocupa >30% de la cuenta (anti-concentración con cuenta chica)
export const RSI2_POS_PCT = 0.02;         // RSI-2 no tiene stop → posición fija pequeña (2%)

const RISK_EUR = ACCOUNT_EUR * RISK_PCT;  // €30
const MAX_EUR = ACCOUNT_EUR * MAX_POS_PCT;

// con stop (breakout, demark, swing): posición = riesgo / stop%, con tope de concentración
export function sizeWithStop(entryPx, stop) {
  const stopPct = (entryPx - stop) / entryPx;
  let posEUR = RISK_EUR / stopPct;
  let riskEUR = RISK_EUR;
  let capped = false;
  if (posEUR > MAX_EUR) { posEUR = MAX_EUR; riskEUR = MAX_EUR * stopPct; capped = true; } // si el stop es muy ajustado, capamos y el riesgo baja del 1%
  return { posEUR: Math.round(posEUR), riskEUR: Math.round(riskEUR), stopPct: +(stopPct * 100).toFixed(1), capped };
}

// sin stop (RSI-2): posición fija pequeña (sales en 5 días, riesgo acotado por tiempo)
export function sizeNoStop() {
  const posEUR = Math.round(ACCOUNT_EUR * RSI2_POS_PCT);
  return { posEUR, riskEUR: posEUR, stopPct: null, capped: false };
}

// si se ejecuta directo: muestra el sizing de las señales activas ahora
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync, existsSync } = await import('fs');
  const L = f => existsSync(f) ? JSON.parse(readFileSync(f)) : [];
  console.log(`💰 SIZING para cuenta de €${ACCOUNT_EUR} (1% riesgo = €${RISK_EUR}/trade, tope ${MAX_POS_PCT * 100}% = €${MAX_EUR})\n`);
  let totalEUR = 0;
  const show = (sys, ticker, entry, stop, s) => {
    totalEUR += s.posEUR;
    console.log(`  ${sys} ${ticker.padEnd(6)} entrada ~$${entry} → invierte €${s.posEUR}` +
      (s.stopPct ? ` | stop $${stop} (−${s.stopPct}%) → riesgo €${s.riskEUR}${s.capped ? ' (capado)' : ''}` : ' | sin stop, salida 5 días'));
  };
  for (const p of L('journal_breakout.json')) if (p.status === 'pending' || p.status === 'open') show('🟠', p.ticker, p.entryPx, p.stop, sizeWithStop(p.entryPx, p.stop));
  for (const p of L('journal.json')) if (p.status === 'open') {
    if (p.strategy === 'RSI2') show('🔵', p.ticker, p.entryPx, null, sizeNoStop());
    else show('🟢', p.ticker, p.entryPx, p.sl, sizeWithStop(p.entryPx, p.sl));
  }
  for (const p of L('journal_weekly.json')) if (p.status === 'open') show('🟣', p.ticker, p.entryPx, p.stop, sizeWithStop(p.entryPx, p.stop));
  console.log(`\n  TOTAL desplegado si tomas todas: €${totalEUR} de €${ACCOUNT_EUR}` +
    (totalEUR > ACCOUNT_EUR ? ` ⚠️ EXCEDE — prioriza, no caben todas` : ` (queda €${ACCOUNT_EUR - totalEUR} libre)`));
}
