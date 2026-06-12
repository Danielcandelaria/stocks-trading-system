// stocks/draw_trade_chart.mjs
// Pinta un trade del sistema de acciones en el chart de TV (vía CDP, protocolo
// seguro: lock + símbolo verificado + restauración). Uso puntual/manual:
//   node draw_trade_chart.mjs TICKER ENTRY SL TP2 TP3 [FECHA_ISO]
// Sin args pinta el ejemplo ASTS del 2026-05-07 (DeMark-9, TP2 alcanzado).

import { acquireChartLock, releaseChartLock, getCurrentSymbol, getCurrentTimeframe, safeSetSymbol, safeSetTimeframe } from '../scanner/chart_safe.mjs';
import { drawShape, clearAll } from '../src/core/drawing.js';
import { scrollToDate } from '../src/core/chart.js';
import { captureScreenshot } from '../src/core/capture.js';
import { evaluate } from '../src/connection.js';

const [ticker = 'ASTS', entry = 66.75, sl = 63.43, tp2 = 73.40, tp3 = 76.72, date = '2026-05-07'] =
  process.argv.slice(2).map((v, i) => (i >= 1 && i <= 4 ? parseFloat(v) : v));

const OWNER = 'draw_stocks_trade';
const log = (...a) => console.log(new Date().toISOString(), ...a);

const got = await acquireChartLock(OWNER, 180000);
if (!got) { console.error('No pude adquirir el lock del chart (scanners ocupándolo) — reintenta en un momento'); process.exit(1); }

let prevSymbol = null, prevTf = null;
try {
  prevSymbol = await getCurrentSymbol();
  prevTf = await getCurrentTimeframe();
  log(`chart actual: ${prevSymbol} @${prevTf} — cambiando a ${ticker} D...`);

  if (!await safeSetSymbol(ticker, 3, 12000)) throw new Error(`TV no confirmó el símbolo ${ticker}`);
  // TV reporta el diario como "1D" — safeSetTimeframe compara estricto, así que
  // verificamos a mano aceptando D/1D
  await safeSetTimeframe(ticker, '1D', 1, 6000);
  const tf = String(await getCurrentTimeframe());
  if (tf !== 'D' && tf !== '1D') throw new Error(`TV no confirmó timeframe diario (está en ${tf})`);
  log('símbolo+TF verificados ✓');

  await scrollToDate({ date });
  await new Promise(r => setTimeout(r, 2000));

  const mkLine = (price, color, text, style = 0) => drawShape({
    shape: 'horizontal_line',
    point: { price },
    text,
    overrides: { linecolor: color, linewidth: 2, linestyle: style, showLabel: true, textcolor: color, fontsize: 12, horzLabelsAlign: 'right' },
  });

  await mkLine(entry, '#2962FF', `ENTRADA ${entry}`);
  await mkLine(sl, '#F23645', `STOP LOSS ${sl} (−1R)`);
  await mkLine(tp2, '#089981', `TP2 ${tp2} (+2R)`, 2);
  await mkLine(tp3, '#089981', `TP3 ${tp3} (+3R)`, 2);
  log('líneas dibujadas ✓');

  // encuadre vertical: que entren SL y TP3 con margen
  const lo = sl * 0.97, hi = tp3 * 1.03;
  await evaluate(`(function(){try{var cw=window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;var ps=cw.model().mainSeries().priceScale();if(ps.setPriceRangeInPrice)ps.setPriceRangeInPrice({from:${lo},to:${hi}});}catch(e){}})()`);
  await new Promise(r => setTimeout(r, 3000));

  const shot = await captureScreenshot({ region: 'chart', filename: `trade_${ticker}_${date}` });
  log('screenshot:', JSON.stringify(shot));
  console.log('\n✅ Trade pintado en TV. Las líneas quedan en el chart hasta que las borres');
  console.log('   (borrar: node -e "import(\'../src/core/drawing.js\').then(d=>d.clearAll())" desde stocks/, con el chart en ' + ticker + ')');
} catch (e) {
  console.error('ERROR:', e.message);
} finally {
  // restaurar el chart como estaba para no molestar a los scanners forex
  if (prevSymbol) {
    try {
      await safeSetSymbol(prevSymbol.replace(/^[A-Z]+:/, ''), 2, 10000);
      if (prevTf) await safeSetTimeframe(null, prevTf, 2, 6000);
      log(`chart restaurado a ${prevSymbol} @${prevTf}`);
    } catch { log('⚠ no pude restaurar el símbolo previo — los scanners lo re-fijarán en su próximo ciclo'); }
  }
  releaseChartLock(OWNER);
}
