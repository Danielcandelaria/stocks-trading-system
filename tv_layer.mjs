// tv_layer.mjs — Capa de TradingView (fuente de verdad) para el radar de acciones.
//   · cdpUp()            → ¿está TV/CDP arriba? (rápido, tolerante a fallo)
//   · confirmSymbol(tv)  → setea símbolo, lee OHLCV REAL de TV semanal, EMA8/21 → {crossed,gapPct,...}
//   · addToWatchlist(tv) → añade el símbolo a la watchlist activa de TV (botón nativo)
//   · getWatchlist()     → símbolos actuales de la watchlist
//   Todo tolerante a que TV esté apagado (el usuario gestiona el browser): si algo falla,
//   devuelve error controlado y el radar sigue en modo solo-Yahoo.

import { evaluate, getClient, disconnect } from '../src/connection.js';

// Fuerza una reconexión CDP fresca: la conexión se pone zombi tras muchas llamadas
// (timeouts 90s en Runtime.evaluate). Llamar cada N confirmaciones evita el atasco.
export async function reconnect() { try { await disconnect(); } catch {} }
import { setSymbol, setTimeframe } from '../src/core/chart.js';
import { getOhlcv } from '../src/core/data.js';

const FAST = 8, SLOW = 21;
const SLEEP = ms => new Promise(r => setTimeout(r, ms));
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map(c => { e = e === null ? c : c * k + e * (1 - k); return e; }); };

export async function cdpUp() {
  try { const r = await evaluate('1+1'); return r === 2; } catch { return false; }
}

async function getCurrentSymbol() {
  try { return await evaluate(`(function(){try{return window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().model().mainSeries().symbol()}catch(e){return null}})()`); }
  catch { return null; }
}

async function _confirmOne(tvSymbol) {
  const base = tvSymbol.split(':').pop().toUpperCase();
  await setSymbol({ symbol: tvSymbol });
  let ok = false;
  for (let i = 0; i < 30; i++) { await SLEEP(500); const cur = await getCurrentSymbol(); if (cur && cur.toUpperCase().includes(base)) { ok = true; break; } }
  if (!ok) return { error: 'no confirmó símbolo' };
  await setTimeframe({ timeframe: 'W' });
  await SLEEP(2500);
  const data = await getOhlcv({ count: 60 });
  const bars = data?.bars || [];
  if (bars.length < SLOW + 3) return { error: `pocas barras (${bars.length})` };
  const cl = bars.map(b => b.close), ef = ema(cl, FAST), es = ema(cl, SLOW), n = cl.length - 1;
  return { price: cl[n], ema8: ef[n], ema21: es[n], gapPct: (ef[n] - es[n]) / cl[n] * 100, crossed: ef[n] > es[n] };
}

// Timeout duro por confirmación: si CDP se pone zombi, una llamada puede colgarse 90s.
// La carrera contra 40s garantiza que ningún ticker bloquee el run entero.
export async function confirmSymbol(tvSymbol) {
  try {
    return await Promise.race([
      _confirmOne(tvSymbol),
      new Promise(r => setTimeout(() => r({ error: 'timeout', timedOut: true }), 40000)),
    ]);
  } catch (e) { return { error: e.message }; }
}

export async function getWatchlist() {
  try {
    const r = await evaluate(`(function(){var seen={},out=[];var c=document.querySelector("[class*=layout__area--right]");if(!c)return out;
      c.querySelectorAll("[data-symbol-full]").forEach(function(e){var s=e.getAttribute("data-symbol-full");if(s&&!seen[s]){seen[s]=1;out.push(s);}});return out;})()`);
    return Array.isArray(r) ? r : [];
  } catch { return []; }
}

export async function addToWatchlist(tvSymbol) {
  try {
    const c = await getClient();
    const clicked = await evaluate(`(function(){var b=document.querySelector("[data-name=add-symbol-button]");if(!b)return false;b.click();return true;})()`);
    if (!clicked) return false;
    await SLEEP(500);
    await c.Input.insertText({ text: tvSymbol });
    await SLEEP(800);
    for (const type of ['keyDown', 'keyUp']) await c.Input.dispatchKeyEvent({ type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await SLEEP(700);
    return true;
  } catch { return false; }
}

// Borra un símbolo de la watchlist: scrollIntoView → clic (selecciona) → tecla Suprimir.
// (TV no expone botón de borrar en la fila; la lista es virtualizada, por eso el scroll.)
export async function removeFromWatchlist(tvSymbol) {
  const short = tvSymbol.split(':').pop().toUpperCase();
  try {
    const c = await getClient();
    const found = await evaluate(`(function(){var c=document.querySelector("[class*=layout__area--right]");if(!c)return false;
      var el=Array.from(c.querySelectorAll("[data-symbol-full]")).find(function(e){return (e.getAttribute("data-symbol-full")||"").split(":").pop().toUpperCase()==="${short}";});
      if(!el)return false; el.scrollIntoView({block:"center"}); return true;})()`);
    if (!found) return false;
    await SLEEP(600);
    const p = await evaluate(`(function(){var c=document.querySelector("[class*=layout__area--right]");
      var el=Array.from(c.querySelectorAll("[data-symbol-full]")).find(function(e){return (e.getAttribute("data-symbol-full")||"").split(":").pop().toUpperCase()==="${short}";});
      if(!el)return null; var r=el.getBoundingClientRect();
      return (r.top>0&&r.top<window.innerHeight)?{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}:null;})()`);
    if (!p) return false;
    await c.Input.dispatchMouseEvent({ type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await c.Input.dispatchMouseEvent({ type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await SLEEP(500);
    await c.Input.dispatchKeyEvent({ type: 'rawKeyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 });
    await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 });
    await SLEEP(700);
    const still = (await getWatchlist()).some(s => s.split(':').pop().toUpperCase() === short);
    return !still;
  } catch { return false; }
}

// Sincroniza la watchlist con los símbolos objetivo (añade los que falten). No borra
// (borrar por DOM es frágil); la lista "Empresas para vigilar" acumula los del radar.
export async function syncWatchlist(tvSymbols) {
  const have = new Set((await getWatchlist()).map(s => s.toUpperCase()));
  let added = 0;
  for (const sym of tvSymbols) {
    if (have.has(sym.toUpperCase())) continue;
    if (await addToWatchlist(sym)) { added++; have.add(sym.toUpperCase()); }
  }
  return added;
}
