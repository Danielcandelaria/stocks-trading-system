#!/usr/bin/env node
/**
 * dashboard.mjs — Panel de ACCIONES (dinero real). CLARIDAD ante todo.
 *
 * Muestra SOLO lo accionable AHORA: por sistema, los tickers con señal viva, cuándo
 * ocurrió, y qué mirar en TradingView. Sin rentabilidades ni backtests (ya validados).
 * Cabecera: cuándo revisó cada escáner (para saber que el sistema está vivo).
 *   node stocks/dashboard.mjs   →  http://127.0.0.1:8080
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const F = n => join(ROOT, n);
const PORT = +(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const rd = f => { try { return JSON.parse(readFileSync(F(f), 'utf8')); } catch { return null; } };

// Cuántas semanas sigue siendo "señal viva" (operable) desde que ocurrió
const FRESH_WEEKS = 1;

function snapshot() {
  const radar = rd('radar_live.json');
  const beats = rd('heartbeat.json') || {};
  const now = Date.now() / 1000;

  // ── EMACross: del radar (ya cruzado / a punto / acercándose) ──
  const lv = i => (radar?.levels?.[i]?.tickers || []);
  const emacross = {
    id: 'EMACross', emoji: '🔵', name: 'EMACROSS',
    subtitle: 'Cruce EMA 8/21 · gráfico SEMANAL · large-caps',
    tv: { tf: 'Semanal (1W)', ind: 'EMA 8/21 · Entradas, Salidas y Anticipación', mira: 'la etiqueta verde COMPRA (EMA8 naranja cruzando SOBRE la EMA21 azul)' },
    entrada: 'Cruce EMA8 sobre EMA21', salida: 'Cruce contrario (dejar correr)', stop: '−18%',
    groups: [
      { key: 'ahora', label: 'ENTRAR AHORA', hint: 'cruzaron esta semana — confirma en TV y entra', items: lv(0).filter(t => t.weeks === 0) },
      { key: 'reciente', label: 'AÚN VÁLIDAS', hint: 'cruzaron la semana pasada, siguen frescas', items: lv(0).filter(t => t.weeks === 1) },
      { key: 'punto', label: 'A PUNTO DE CRUZAR', hint: 'muy cerca — tu indicador (modo anticipado) marca la COMPRA aquí', items: lv(1) },
      { key: 'cerca', label: 'EN PREVISIÓN · anticipación', hint: 'convergiendo hacia el cruce (banda 2%) — ordenadas por cercanía', items: lv(2) },
    ],
    lastRun: beats.radar?.at || null,
  };

  // ── WeeklySwing: del journal, solo señales RECIENTES (vivas) ──
  const wj = (rd('journal_weekly.json') || []).filter(p => p.status === 'open');
  // Semanas ANCLADAS a la vela: la señal de la última semana CERRADA es "0" (la más fresca).
  // Contar por días daba 1 semana de más el lunes siguiente (QCOM/CCI salían como viejas).
  const d = new Date(); const dow = d.getUTCDay();
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((dow + 6) % 7)));
  const weekClosed = dow === 0 || dow === 6 || (dow === 5 && d.getUTCHours() >= 20);
  const anchor = monday.getTime() / 1000 - (weekClosed ? 0 : 7 * 86400);   // lunes de la última semana cerrada
  const wk = p => Math.max(0, Math.round((anchor - p.signalT) / (7 * 86400)));
  const wmap = p => ({ ticker: p.ticker, tv: p.tv || p.ticker, price: +(+p.entryPx).toFixed(2), weeks: wk(p), stop: p.stop != null ? +(+p.stop).toFixed(2) : null });
  const weekly = {
    id: 'WeeklySwing', emoji: '🟣', name: 'WEEKLYSWING',
    subtitle: 'DeMark Setup-9 · gráfico SEMANAL · large-caps',
    tv: { tf: 'Semanal (1W)', ind: 'DeMARK 9-13', mira: 'el número 9 pintado ABAJO (suelo de compra), NO el 13 de arriba' },
    entrada: 'Setup-9 de compra (suelo)', salida: 'Countdown-13 / 52 semanas', stop: 'Mínimo del setup',
    groups: [
      { key: 'ahora', label: 'ENTRAR AHORA', hint: 'señal de esta semana', items: wj.filter(p => wk(p) === 0).map(wmap) },
      { key: 'reciente', label: 'AÚN VÁLIDAS', hint: 'señal de la semana pasada', items: wj.filter(p => wk(p) === 1).map(wmap) },
    ],
    lastRun: beats.weekly?.at || null,
    older: wj.filter(p => wk(p) > FRESH_WEEKS).length,
  };

  // ── MIS POSICIONES REALES (dinero real) ──
  const pnl = rd('pnl_live.json') || { positions: [] };
  const px = t => (pnl.positions.find(p => p.ticker === t) || {}).current ?? null;
  const real = ((rd('trades_real.json') || {}).trades || []).map(t => {
    const cur = px(t.ticker);
    const base = t.entryPrice ?? t.signalPrice;
    return { ...t, current: cur,
      pnlPct: (cur != null && base) ? +(((cur / base) - 1) * 100).toFixed(2) : null,
      toStopPct: (cur != null && t.stop) ? +(((cur / t.stop) - 1) * 100).toFixed(1) : null,
      pendiente: t.entryPrice == null };
  });

  return {
    ts: new Date().toISOString(),
    real,
    radarAt: radar?.updatedAt || null,
    definitive: radar?.definitive ?? null,
    beats,
    systems: [emacross, weekly],
  };
}

const PAGE = /* html */ `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>Acciones</title>
<style>
:root{--bg:#0d1117;--card:#161b22;--card2:#1c2129;--bd:#30363d;--tx:#e6edf3;--mut:#8b949e;
--go:#3fb950;--warn:#d29922;--core:#58a6ff;--pur:#a371f7}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1000px;margin:0 auto;padding:22px 16px 60px}
h1{font-size:23px;font-weight:600;margin:0 0 6px}
.live{display:flex;gap:14px;flex-wrap:wrap;color:var(--mut);font-size:12.5px;margin-bottom:24px}
.live b{color:var(--tx);font-weight:500}
.dot{color:var(--go)}
.real{background:rgba(63,185,80,.07);border:1px solid rgba(63,185,80,.35);border-radius:14px;margin-bottom:22px;overflow:hidden}
.real .rh{padding:14px 20px;font-weight:600;font-size:16px;border-bottom:1px solid rgba(63,185,80,.25);display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.real table{width:100%;border-collapse:collapse;font-size:14px}
.real th{text-align:left;color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.5px;padding:9px 20px;font-weight:500}
.real td{padding:10px 20px;border-top:1px solid rgba(63,185,80,.15)}
.real .r{text-align:right}
.pos{color:var(--go)}.neg{color:#f85149}
.warn{color:var(--warn);font-size:12px}
.sys{background:var(--card);border:1px solid var(--bd);border-radius:14px;margin-bottom:20px;overflow:hidden}
.sys.s0{border-left:4px solid var(--core)}.sys.s1{border-left:4px solid var(--pur)}
.hd{padding:16px 20px 14px}
.hd h2{font-size:19px;font-weight:600;margin:0}
.hd .st{color:var(--mut);font-size:13px;margin-top:2px}
.tvline{margin:12px 0 0;padding:11px 14px;background:rgba(88,166,255,.09);border-radius:9px;font-size:13.5px}
.tvline b{color:var(--core)}.tvline .k{color:var(--mut)}
.rl{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:12.5px;color:var(--mut)}
.rl b{color:var(--tx);font-weight:500}
.grp{border-top:1px solid var(--bd)}
.gh{padding:11px 20px;display:flex;align-items:center;gap:9px;flex-wrap:wrap;background:var(--card2)}
.gh .t{font-weight:600;font-size:14px}
.gh.g-ahora .t{color:var(--go)}.gh.g-reciente .t{color:var(--tx)}.gh.g-punto .t{color:var(--warn)}.gh.g-cerca .t{color:var(--mut)}
.gh .n{color:var(--mut);font-size:12.5px}
.gh .hint{color:var(--mut);font-size:12px;margin-left:auto}
.chips{display:flex;flex-wrap:wrap;gap:8px;padding:13px 20px}
.chip{background:var(--card2);border:1px solid var(--bd);border-radius:8px;padding:8px 12px;display:flex;align-items:center;gap:8px;font-size:14px}
.chip.big{border-color:rgba(63,185,80,.45);background:rgba(63,185,80,.08)}
.chip a{color:var(--tx);text-decoration:none;font-weight:600}
.chip a:hover{color:var(--core)}
.chip .px{color:var(--mut);font-size:12.5px}
.empty{padding:16px 20px;color:var(--mut);font-size:13.5px}
.foot{padding:10px 20px;border-top:1px solid var(--bd);color:var(--mut);font-size:12px}
.ft{color:var(--mut);font-size:12px;margin-top:24px;text-align:center}
@media(max-width:640px){.wrap{padding:14px 10px 40px}.hd,.chips,.gh,.foot{padding-left:14px;padding-right:14px}}
</style></head><body><div class="wrap">
<h1>📊 Acciones</h1>
<div class="live" id="live">cargando…</div>
<div id="real"></div>
<div id="systems"></div>
<div class="ft" id="ft"></div>
</div>
<script>
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const tvUrl=t=>'https://www.tradingview.com/chart/?symbol='+encodeURIComponent(t);
function hace(iso){ if(!iso) return 'nunca';
  const m=Math.round((Date.now()-new Date(iso))/60000);
  if(m<2)return 'ahora mismo'; if(m<60)return 'hace '+m+' min';
  const h=Math.round(m/60); if(h<24)return 'hace '+h+'h';
  return 'hace '+Math.round(h/24)+'d'; }
async function load(){
  const d=await (await fetch('/api/data')).json();
  const b=d.beats||{};
  document.getElementById('live').innerHTML=
    '<span><span class="dot">●</span> Radar EMACross: <b>'+hace(b.radar?.at||d.radarAt)+'</b></span>'+
    '<span><span class="dot">●</span> Escáner semanal: <b>'+hace(b.weekly?.at)+'</b></span>'+
    '<span><span class="dot">●</span> Escáner cruces: <b>'+hace(b.emacross?.at)+'</b></span>'+
    (d.definitive===false?'<span style="color:var(--warn)">semana en curso (provisional)</span>':
     d.definitive===true?'<span style="color:var(--go)">cierre semanal confirmado</span>':'');

  // ── MIS POSICIONES REALES ──
  const R=d.real||[];
  document.getElementById('real').innerHTML = R.length ? '<div class="real">'+
    '<div class="rh">💰 Mis posiciones REALES <span style="font-weight:400;font-size:12.5px;color:var(--mut)">dinero real · '+R.length+'</span></div>'+
    '<table><thead><tr><th>Ticker</th><th>Sistema</th><th class="r">Entrada</th><th class="r">Ahora</th><th class="r">P&L</th><th class="r">Stop</th><th class="r">Entré</th></tr></thead><tbody>'+
    R.map(t=>'<tr><td><b><a href="'+tvUrl(t.tv)+'" target="_blank" style="color:var(--tx);text-decoration:none">'+esc(t.ticker)+'</a></b></td>'+
      '<td style="color:var(--mut);font-size:13px">'+esc(t.system)+'</td>'+
      '<td class="r">'+(t.entryPrice!=null?t.entryPrice:'<span class="warn">falta ('+t.signalPrice+'?)</span>')+'</td>'+
      '<td class="r">'+(t.current!=null?t.current:'—')+'</td>'+
      '<td class="r '+((t.pnlPct||0)>=0?'pos':'neg')+'" style="font-weight:600">'+(t.pnlPct!=null?(t.pnlPct>=0?'+':'')+t.pnlPct+'%':'—')+'</td>'+
      '<td class="r" style="color:var(--mut)">'+(t.stop!=null?t.stop:'—')+(t.toStopPct!=null?' <span style="font-size:12px">('+t.toStopPct+'%)</span>':'')+'</td>'+
      '<td class="r" style="color:var(--mut);font-size:13px">'+esc(t.entryDate||'—')+'</td></tr>').join('')+
    '</tbody></table>'+
    '<div style="padding:10px 20px;color:var(--mut);font-size:12px;border-top:1px solid rgba(63,185,80,.15)">Salida: cruce contrario · el stop es de catástrofe (−18%), no táctico</div>'+
    '</div>' : '';

  document.getElementById('systems').innerHTML=d.systems.map((s,i)=>{
    const grupos=s.groups.map(g=>{
      const antic=(g.key==='punto'||g.key==='cerca');   // niveles de anticipación → mostrar cuánto falta
      const chips=g.items.map(t=>'<div class="chip'+(g.key==='ahora'?' big':'')+'">'+
        '<a href="'+tvUrl(t.tv)+'" target="_blank">'+esc(t.ticker)+'</a>'+
        '<span class="px">$'+t.price+'</span>'+
        (antic&&t.gapPct!=null?'<span class="px" style="color:var(--warn)">falta '+t.gapPct+'%</span>':'')+
        (!antic&&t.stop!=null?'<span class="px">stop '+t.stop+'</span>':'')+'</div>').join('');
      if(!g.items.length && (g.key==='cerca'||g.key==='reciente')) return '';
      return '<div class="grp"><div class="gh g-'+g.key+'"><span class="t">'+esc(g.label)+'</span>'+
        '<span class="n">'+g.items.length+'</span><span class="hint">'+esc(g.hint)+'</span></div>'+
        (chips?'<div class="chips">'+chips+'</div>':'<div class="empty">Ninguna ahora mismo.</div>')+'</div>';
    }).join('');
    return '<div class="sys s'+i+'">'+
      '<div class="hd"><h2>'+s.emoji+' '+esc(s.name)+'</h2><div class="st">'+esc(s.subtitle)+'</div>'+
      '<div class="tvline">📈 <b>En TradingView:</b> gráfico <b>'+esc(s.tv.tf)+'</b> + indicador <b>'+esc(s.tv.ind)+'</b><br><span class="k">→ mira '+esc(s.tv.mira)+'</span></div>'+
      '<div class="rl"><span>📍 Entra: <b>'+esc(s.entrada)+'</b></span><span>🚪 Sale: <b>'+esc(s.salida)+'</b></span><span>🛑 Stop: <b>'+esc(s.stop)+'</b></span></div>'+
      '</div>'+grupos+
      '<div class="foot">Última revisión: '+hace(s.lastRun)+(s.older?' · '+s.older+' señales antiguas ocultas (ya no operables)':'')+'</div>'+
    '</div>';
  }).join('');
  document.getElementById('ft').textContent='Se refresca solo cada 30s · '+new Date(d.ts).toLocaleTimeString('es-ES');
}
load();setInterval(load,30000);
</script></body></html>`;

createServer((req, res) => {
  if (new URL(req.url, 'http://x').pathname === '/api/data') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(snapshot()));
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
}).listen(PORT, HOST, () => console.log(`Panel de acciones en http://${HOST}:${PORT}`));
