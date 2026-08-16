#!/usr/bin/env node
/**
 * dashboard.mjs — Panel de ACCIONES.
 *
 * VISTA PRINCIPAL = "qué vigilar ahora" (radar_live.json): las acciones que están
 * cruzando o a punto de cruzar, por nivel de urgencia — lo mismo que llega a Telegram
 * y a la watchlist de TradingView. Debajo: los sistemas con sus reglas y qué mirar en
 * TV, y el seguimiento paper (registro automático, NO son compras del usuario).
 * Solo LEE. →  node stocks/dashboard.mjs   (http://127.0.0.1:8080)
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

const SYSTEMS = [
  {
    id: 'EMACross', name: 'EMACross', emoji: '🔵', tag: 'PRINCIPAL', tagCls: 'core',
    journal: 'journal_emacross.json', radar: true,
    subtitle: 'Cruce EMA 8/21 semanal · large-caps · seguimiento de tendencia',
    que: 'Compra cuando la tendencia gira al alza (media rápida cruza sobre la lenta) y aguanta mientras dure. Pocas ganadoras enormes pagan muchas perdedoras pequeñas.',
    entrada: 'La EMA8 cruza SOBRE la EMA21 en vela SEMANAL cerrada',
    salida: 'La EMA8 cruza BAJO la EMA21 (sin toma de beneficios: dejar correr)',
    stop: '−18% desde la entrada (solo catástrofe, no táctico)',
    tv: { tf: 'Semanal (1W)', ind: 'EMA 8/21 · Entradas, Salidas y Anticipación', mira: 'la etiqueta verde COMPRA bajo la vela, con la EMA8 (naranja) por encima de la EMA21 (azul)' },
    bt: 'PF 2.36 · 33% aciertos · gana +40% / pierde −8% · walk-forward 4/4 (10 años)',
  },
  {
    id: 'WeeklySwing', name: 'WeeklySwing', emoji: '🟣', tag: 'PRINCIPAL', tagCls: 'core',
    journal: 'journal_weekly.json',
    subtitle: 'DeMark Setup-9 semanal · large-caps · agotamiento vendedor',
    que: 'Compra el SUELO: cuando una caída lleva 9 semanas agotándose, DeMark marca el giro. Entra temprano, antes de que la tendencia sea obvia. Aguante de meses.',
    entrada: 'TD Setup-9 de COMPRA (el "9" en el suelo) en vela SEMANAL cerrada',
    salida: 'Countdown-13 (techo de agotamiento) · o 52 semanas · o stop',
    stop: 'Mínimo de las 9 velas del setup (estructural)',
    tv: { tf: 'Semanal (1W)', ind: 'DeMARK 9-13 (Mantilla PB)', mira: 'el número 9 pintado ABAJO (suelo de compra), NO el 13 de arriba' },
    bt: 'PF 3.98 vs azar 2.31 · ganadoras medias +79% · walk-forward 4/4 (10 años)',
  },
  {
    id: 'EMACrossMid', name: 'EMACross MID', emoji: '🟪', tag: 'OBSERVACIÓN', tagCls: 'shadow',
    journal: 'journal_emacross_mid.json',
    subtitle: 'Mismo cruce EMA 8/21 pero en mid-caps ($2-8B)',
    que: 'Idéntico a EMACross en empresas medianas. Ganadores mayores (+56% medio) pero más ruido. En estudio: NO operar, solo recoger datos.',
    entrada: 'La EMA8 cruza SOBRE la EMA21 en vela SEMANAL (universo mid-cap)',
    salida: 'La EMA8 cruza BAJO la EMA21',
    stop: '−18% desde la entrada',
    tv: { tf: 'Semanal (1W)', ind: 'EMA 8/21 · Entradas, Salidas y Anticipación', mira: 'lo mismo que EMACross — pero esto es SOLO seguimiento, no operar' },
    bt: 'PF 1.82 · walk-forward 4/4 — por debajo del principal (2.36)',
  },
];

function snapshot() {
  const pnl = rd('pnl_live.json') || { positions: [], updatedAt: null };
  const byKey = {}; for (const p of pnl.positions) byKey[p.strategy + ':' + p.ticker] = p;
  const radar = rd('radar_live.json');

  const systems = SYSTEMS.map(s => {
    const j = rd(s.journal) || [];
    const open = j.filter(p => p.status === 'open' && (p.dir ? p.dir === 'LONG' : true));
    const closed = j.filter(p => p.status === 'closed');
    const positions = open.map(p => {
      const live = byKey[s.id + ':' + p.ticker] || {};
      return {
        ticker: p.ticker, tv: p.tv || p.ticker, sector: p.sector || '',
        entry: +(+p.entryPx).toFixed(2), current: live.current ?? null, pnlPct: live.pnlPct ?? null,
        stop: p.stop != null ? +(+p.stop).toFixed(2) : null, toStopPct: live.toStopPct ?? null,
        days: p.signalT ? Math.round((Date.now() / 1000 - p.signalT) / 86400) : null,
        signalDate: p.signalT ? new Date(p.signalT * 1000).toISOString().slice(0, 10) : null,
      };
    }).sort((a, b) => (b.pnlPct ?? -999) - (a.pnlPct ?? -999));
    const wp = positions.filter(p => p.pnlPct != null);
    const cr = closed.map(p => p.retPct).filter(x => x != null);
    return { ...s, positions, openN: positions.length,
      avgPnl: wp.length ? +(wp.reduce((a, p) => a + p.pnlPct, 0) / wp.length).toFixed(1) : null,
      closedN: closed.length, closedSum: cr.length ? +cr.reduce((a, b) => a + b, 0).toFixed(1) : null };
  });
  return { ts: new Date().toISOString(), pnlUpdatedAt: pnl.updatedAt, radar, systems };
}

const PAGE = /* html */ `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>Acciones · panel</title>
<style>
:root{--bg:#0d1117;--card:#161b22;--card2:#1c2129;--bd:#30363d;--tx:#e6edf3;--mut:#8b949e;
--pos:#3fb950;--neg:#f85149;--core:#58a6ff;--shadow:#a371f7;--fire:#f0883e;--warn:#d29922}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:24px 18px 60px}
h1{font-size:24px;font-weight:600;margin:0 0 4px}
.sub{color:var(--mut);font-size:13px;margin-bottom:22px}
.sech{font-size:17px;font-weight:600;margin:30px 0 4px;display:flex;align-items:center;gap:8px}
.sechs{color:var(--mut);font-size:13px;margin-bottom:12px}
/* RADAR */
.lvl{background:var(--card);border:1px solid var(--bd);border-radius:12px;margin-bottom:12px;overflow:hidden}
.lvl.l0{border-left:4px solid var(--fire)}.lvl.l1{border-left:4px solid var(--warn)}.lvl.l2{border-left:4px solid var(--mut)}
.lvlh{padding:12px 18px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;border-bottom:1px solid var(--bd);background:var(--card2)}
.lvlh .t{font-weight:600;font-size:15px}.lvlh .n{color:var(--mut);font-size:13px}
.lvlh .hint{color:var(--mut);font-size:12.5px;margin-left:auto}
.chips{display:flex;flex-wrap:wrap;gap:8px;padding:14px 18px}
.chip{background:var(--card2);border:1px solid var(--bd);border-radius:8px;padding:7px 11px;font-size:13.5px;display:flex;align-items:center;gap:7px}
.chip a{color:var(--tx);text-decoration:none;font-weight:600}
.chip a:hover{color:var(--core)}
.chip .px{color:var(--mut);font-size:12.5px}
.chip .ok{color:var(--pos);font-size:11px;font-weight:600}
.chip .no{color:var(--warn);font-size:11px}
/* SISTEMAS */
.sys{background:var(--card);border:1px solid var(--bd);border-radius:14px;margin-bottom:18px;overflow:hidden}
.sys.core{border-left:4px solid var(--core)}.sys.shadow{border-left:4px solid var(--shadow);opacity:.92}
.hd{padding:15px 20px;border-bottom:1px solid var(--bd)}
.hd h2{font-size:18px;font-weight:600;margin:0;display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.badge{font-size:10px;font-weight:600;padding:3px 9px;border-radius:20px;letter-spacing:.6px}
.badge.core{background:rgba(88,166,255,.15);color:var(--core)}
.badge.shadow{background:rgba(163,113,247,.15);color:var(--shadow)}
.hd .st{color:var(--mut);font-size:13px;margin-top:3px}
.que{padding:13px 20px;font-size:14px;background:var(--card2);border-bottom:1px solid var(--bd)}
.rules{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:1px;background:var(--bd)}
.rule{background:var(--card);padding:12px 20px}
.rule .l{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px}
.rule .v{font-size:13.5px}
.tvbox{padding:13px 20px;background:rgba(88,166,255,.07);border-top:1px solid var(--bd);font-size:13.5px}
.tvbox b{color:var(--core)}.tvbox .k{color:var(--mut)}
.stats{padding:11px 20px;display:flex;gap:18px;flex-wrap:wrap;font-size:12.5px;border-top:1px solid var(--bd);color:var(--mut)}
details{border-top:1px solid var(--bd)}
summary{padding:11px 20px;cursor:pointer;font-size:13.5px;color:var(--mut);user-select:none}
summary:hover{color:var(--tx)}
table{width:100%;border-collapse:collapse;font-size:14px}
thead th{text-align:left;color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.5px;
padding:9px 20px;border-top:1px solid var(--bd);border-bottom:1px solid var(--bd);font-weight:500;background:var(--card2)}
td{padding:9px 20px;border-bottom:1px solid rgba(48,54,61,.5)}
tbody tr:last-child td{border-bottom:none}
.r{text-align:right}
.tk{font-weight:600}.tk a{color:var(--tx);text-decoration:none}.tk a:hover{color:var(--core)}
.sec{color:var(--mut);font-size:12px;font-weight:400;margin-left:6px}
.pos{color:var(--pos)}.neg{color:var(--neg)}.mut{color:var(--mut)}
.big{font-weight:600;font-size:15px}
.empty{padding:20px;color:var(--mut);text-align:center;font-size:14px}
.ft{color:var(--mut);font-size:12px;margin-top:26px;text-align:center}
@media(max-width:640px){td,thead th{padding:8px 12px}.wrap{padding:16px 10px 40px}.hd,.que,.rule,.tvbox,.stats,.chips,.lvlh{padding-left:14px;padding-right:14px}}
</style></head><body><div class="wrap">
<h1>📊 Sistema de acciones</h1>
<div class="sub" id="sub">cargando…</div>
<div id="radar"></div>
<div class="sech">⚙️ Los sistemas</div>
<div class="sechs">Qué hace cada uno, sus reglas y qué mirar en TradingView.</div>
<div id="systems"></div>
<div class="ft" id="ft"></div>
</div>
<script>
const f=n=>(n>=0?'+':'')+n.toFixed(n%1?2:0);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const tvUrl=t=>'https://www.tradingview.com/chart/?symbol='+encodeURIComponent(t);
const LV=[{e:'🟢',t:'YA CRUZADO · entrada válida',h:'el cruce YA ocurrió y sigue fresco → confirmar en TV y entrar'},
          {e:'⚡',t:'A PUNTO DE CRUZAR',h:'a un pelo del cruce, puede confirmarse esta semana'},
          {e:'⏳',t:'ACERCÁNDOSE',h:'convergiendo — solo vigilar, aún no'}];
async function load(){
  const d=await (await fetch('/api/data')).json();
  document.getElementById('sub').textContent='Paper · datos '+(d.pnlUpdatedAt||'').slice(0,16).replace('T',' ');

  // ── RADAR: qué vigilar ahora ──
  const rd=d.radar;
  let rh='<div class="sech">🎯 Qué vigilar ahora <span style="font-size:12px;font-weight:400;color:var(--mut)">· EMACross</span></div>';
  if(!rd){ rh+='<div class="sechs">Sin datos del radar todavía (corre el radar para generarlos).</div>'; }
  else{
    rh+='<div class="sechs">Lo mismo que llega a Telegram y a la watchlist de TradingView. Radar del '+(rd.updatedAt||'').slice(0,16).replace('T',' ')+(rd.definitive?' · DEFINITIVO (cierre semanal)':' · provisional (semana en curso)')+'</div>';
    rh+=rd.levels.map(l=>{
      const L=LV[l.level];
      const chips=l.tickers.map(t=>'<div class="chip"><a href="'+tvUrl(t.tv)+'" target="_blank">'+esc(t.ticker)+'</a>'+
        '<span class="px">$'+t.price+'</span>'+
        (t.weeks!=null?'<span class="px">'+(t.weeks===0?'esta sem':'hace '+t.weeks+' sem')+'</span>':'')+
        (t.tvCrossed===true?'<span class="ok">✓TV</span>':t.tvCrossed===false?'<span class="no">TV aún no</span>':'')+
        '</div>').join('');
      return '<div class="lvl l'+l.level+'"><div class="lvlh"><span class="t">'+L.e+' '+L.t+'</span>'+
        '<span class="n">'+l.tickers.length+' acciones</span><span class="hint">'+L.h+'</span></div>'+
        (chips?'<div class="chips">'+chips+'</div>':'<div class="empty">Ninguna ahora mismo.</div>')+'</div>';
    }).join('');
  }
  document.getElementById('radar').innerHTML=rh;

  // ── SISTEMAS ──
  document.getElementById('systems').innerHTML=d.systems.map(s=>{
    const rows=s.positions.map(p=>
      '<tr><td class="tk"><a href="'+tvUrl(p.tv)+'" target="_blank">'+esc(p.ticker)+'</a>'+
        (p.sector?'<span class="sec">'+esc(p.sector)+'</span>':'')+'</td>'+
      '<td class="r">'+(p.entry!=null?p.entry:'—')+'</td><td class="r">'+(p.current!=null?p.current:'—')+'</td>'+
      '<td class="r big '+((p.pnlPct||0)>=0?'pos':'neg')+'">'+(p.pnlPct!=null?f(p.pnlPct)+'%':'—')+'</td>'+
      '<td class="r mut">'+(p.signalDate||'—')+'</td><td class="r mut">'+(p.days!=null?p.days+'d':'—')+'</td>'+
      '<td class="r mut">'+(p.stop!=null?p.stop:'—')+'</td></tr>').join('');
    return '<div class="sys '+s.tagCls+'">'+
      '<div class="hd"><h2>'+s.emoji+' '+esc(s.name)+' <span class="badge '+s.tagCls+'">'+s.tag+'</span></h2>'+
        '<div class="st">'+esc(s.subtitle)+'</div></div>'+
      '<div class="que">'+esc(s.que)+'</div>'+
      '<div class="rules">'+
        '<div class="rule"><div class="l">📍 Entrada</div><div class="v">'+esc(s.entrada)+'</div></div>'+
        '<div class="rule"><div class="l">🚪 Salida</div><div class="v">'+esc(s.salida)+'</div></div>'+
        '<div class="rule"><div class="l">🛑 Stop</div><div class="v">'+esc(s.stop)+'</div></div>'+
      '</div>'+
      '<div class="tvbox">📈 <b>En TradingView:</b> gráfico <b>'+esc(s.tv.tf)+'</b> con el indicador <b>'+esc(s.tv.ind)+'</b> — <span class="k">mira '+esc(s.tv.mira)+'</span>.</div>'+
      '<div class="stats"><span>📊 '+esc(s.bt)+'</span></div>'+
      '<details><summary>📋 Seguimiento paper — '+s.openN+' posiciones registradas'+
        (s.avgPnl!=null?' · P&L medio <span class="'+(s.avgPnl>=0?'pos':'neg')+'">'+f(s.avgPnl)+'%</span>':'')+
        (s.closedN?' · '+s.closedN+' cerradas':'')+'  <span style="opacity:.7">(registro automático del sistema, NO son tus compras)</span></summary>'+
        (rows?'<table><thead><tr><th>Ticker</th><th class="r">Entrada</th><th class="r">Ahora</th>'+
          '<th class="r">P&L desde señal</th><th class="r">Señal</th><th class="r">Días</th><th class="r">Stop</th></tr></thead><tbody>'+rows+'</tbody></table>'
          :'<div class="empty">Sin posiciones registradas.</div>')+
      '</details></div>';
  }).join('');
  document.getElementById('ft').textContent='Actualizado '+new Date(d.ts).toLocaleTimeString('es-ES')+' · se refresca solo cada 30s';
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
