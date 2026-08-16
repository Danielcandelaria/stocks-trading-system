#!/usr/bin/env node
/**
 * dashboard.mjs — Panel de ACCIONES (nuevo, desde cero 2026-08-16).
 *
 * Solo acciones. Muestra los sistemas que operamos, sus REGLAS, qué mirar en
 * TradingView, y las posiciones con su rentabilidad desde el aviso.
 * Fuente: journals de stocks/ + pnl_live.json (track_pnl.mjs). Solo LEE.
 *
 *   node stocks/dashboard.mjs        → http://127.0.0.1:8080
 *   PORT=8081 node stocks/dashboard.mjs
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

// ── LOS SISTEMAS: qué son, sus reglas y QUÉ MIRAR EN TRADINGVIEW ──
const SYSTEMS = [
  {
    id: 'EMACross', name: 'EMACross', emoji: '🔵', tag: 'PRINCIPAL', tagCls: 'core',
    journal: 'journal_emacross.json',
    subtitle: 'Cruce EMA 8/21 semanal · large-caps · seguimiento de tendencia',
    que: 'Compra cuando la tendencia gira al alza (la media rápida cruza sobre la lenta) y aguanta mientras la tendencia dure. Pocas ganadoras enormes pagan muchas perdedoras pequeñas.',
    entrada: 'La EMA8 cruza SOBRE la EMA21 en vela SEMANAL cerrada',
    salida: 'La EMA8 cruza BAJO la EMA21 (sin toma de beneficios: dejar correr)',
    stop: '−18% desde la entrada (solo catástrofe, no táctico)',
    tv: { tf: 'Semanal (1W)', ind: 'EMA 8/21 · Entradas, Salidas y Anticipación', mira: 'la etiqueta verde COMPRA bajo la vela, y que la EMA8 (naranja) esté por encima de la EMA21 (azul)' },
    bt: 'PF 2.36 · 33% aciertos · gana +40% / pierde −8% · walk-forward 4/4 (10 años)',
  },
  {
    id: 'WeeklySwing', name: 'WeeklySwing', emoji: '🟣', tag: 'PRINCIPAL', tagCls: 'core',
    journal: 'journal_weekly.json',
    subtitle: 'DeMark Setup-9 semanal · large-caps · agotamiento vendedor',
    que: 'Compra el SUELO: cuando una caída lleva 9 semanas agotándose, DeMark marca el giro. Entra temprano, antes de que la tendencia sea obvia. Aguante largo (meses).',
    entrada: 'TD Setup-9 de COMPRA (el "9" en el suelo) en vela SEMANAL cerrada',
    salida: 'Countdown-13 (techo de agotamiento) · o 52 semanas · o stop',
    stop: 'Mínimo de las 9 velas del setup (estructural)',
    tv: { tf: 'Semanal (1W)', ind: 'DeMARK 9-13 (Mantilla PB)', mira: 'el número 9 pintado ABAJO (suelo de compra), no el 13 de arriba' },
    bt: 'PF 3.98 vs azar 2.31 · ganadoras medias +79% · walk-forward 4/4 (10 años)',
  },
  {
    id: 'EMACrossMid', name: 'EMACross MID', emoji: '🟪', tag: 'OBSERVACIÓN', tagCls: 'shadow',
    journal: 'journal_emacross_mid.json',
    subtitle: 'Mismo cruce EMA 8/21 pero en mid-caps ($2-8B)',
    que: 'Idéntico a EMACross en empresas medianas. Los ganadores son mayores (+56% medio) pero hay más ruido. En estudio: NO operar todavía, solo recoger datos.',
    entrada: 'La EMA8 cruza SOBRE la EMA21 en vela SEMANAL (universo mid-cap)',
    salida: 'La EMA8 cruza BAJO la EMA21',
    stop: '−18% desde la entrada',
    tv: { tf: 'Semanal (1W)', ind: 'EMA 8/21 · Entradas, Salidas y Anticipación', mira: 'lo mismo que EMACross — pero esto es SOLO seguimiento, no operar' },
    bt: 'PF 1.82 · walk-forward 4/4 — por debajo del principal (2.36)',
  },
];

function snapshot() {
  const pnl = rd('pnl_live.json') || { positions: [], updatedAt: null };
  const byTicker = {};
  for (const p of pnl.positions) byTicker[p.strategy + ':' + p.ticker] = p;

  const systems = SYSTEMS.map(s => {
    const j = rd(s.journal) || [];
    const open = j.filter(p => p.status === 'open' && (p.dir ? p.dir === 'LONG' : true));
    const closed = j.filter(p => p.status === 'closed');
    const positions = open.map(p => {
      const live = byTicker[s.id + ':' + p.ticker] || {};
      return {
        ticker: p.ticker, tv: p.tv || p.ticker, sector: p.sector || '',
        entry: +(+p.entryPx).toFixed(2), current: live.current ?? null, pnlPct: live.pnlPct ?? null,
        stop: p.stop != null ? +(+p.stop).toFixed(2) : null, toStopPct: live.toStopPct ?? null,
        days: p.signalT ? Math.round((Date.now() / 1000 - p.signalT) / 86400) : null,
        signalDate: p.signalT ? new Date(p.signalT * 1000).toISOString().slice(0, 10) : null,
      };
    }).sort((a, b) => (b.pnlPct ?? -999) - (a.pnlPct ?? -999));
    const withPnl = positions.filter(p => p.pnlPct != null);
    const closedRets = closed.map(p => p.retPct).filter(x => x != null);
    return {
      ...s, positions,
      openN: positions.length,
      avgPnl: withPnl.length ? +(withPnl.reduce((a, p) => a + p.pnlPct, 0) / withPnl.length).toFixed(1) : null,
      winners: withPnl.filter(p => p.pnlPct > 0).length,
      closedN: closed.length,
      closedSum: closedRets.length ? +closedRets.reduce((a, b) => a + b, 0).toFixed(1) : null,
    };
  });
  return { ts: new Date().toISOString(), pnlUpdatedAt: pnl.updatedAt, systems };
}

const PAGE = /* html */ `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>Acciones · panel</title>
<style>
:root{--bg:#0d1117;--card:#161b22;--card2:#1c2129;--bd:#30363d;--tx:#e6edf3;--mut:#8b949e;
--pos:#3fb950;--neg:#f85149;--core:#58a6ff;--shadow:#a371f7;--warn:#d29922}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:24px 18px 60px}
h1{font-size:24px;font-weight:600;margin:0 0 4px}
.sub{color:var(--mut);font-size:13px;margin-bottom:24px}
.top{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:22px}
.kpi{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:12px 16px;min-width:130px}
.kpi .l{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.5px}
.kpi .v{font-size:22px;font-weight:600;margin-top:2px}
.sys{background:var(--card);border:1px solid var(--bd);border-radius:14px;margin-bottom:22px;overflow:hidden}
.sys.core{border-left:4px solid var(--core)}
.sys.shadow{border-left:4px solid var(--shadow);opacity:.92}
.hd{padding:16px 20px;border-bottom:1px solid var(--bd)}
.hd h2{font-size:19px;font-weight:600;margin:0;display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.badge{font-size:10px;font-weight:600;padding:3px 9px;border-radius:20px;letter-spacing:.6px}
.badge.core{background:rgba(88,166,255,.15);color:var(--core)}
.badge.shadow{background:rgba(163,113,247,.15);color:var(--shadow)}
.hd .st{color:var(--mut);font-size:13px;margin-top:3px}
.que{padding:14px 20px;color:var(--tx);font-size:14px;background:var(--card2);border-bottom:1px solid var(--bd)}
.rules{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:1px;background:var(--bd)}
.rule{background:var(--card);padding:13px 20px}
.rule .l{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px}
.rule .v{font-size:13.5px}
.tv{margin:0;padding:14px 20px;background:rgba(88,166,255,.07);border-top:1px solid var(--bd);font-size:13.5px}
.tv b{color:var(--core)}
.tv .k{color:var(--mut)}
.stats{padding:12px 20px;display:flex;gap:20px;flex-wrap:wrap;font-size:13px;border-top:1px solid var(--bd);color:var(--mut)}
table{width:100%;border-collapse:collapse;font-size:14px}
thead th{text-align:left;color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.5px;
padding:10px 20px;border-top:1px solid var(--bd);border-bottom:1px solid var(--bd);font-weight:500;background:var(--card2)}
td{padding:10px 20px;border-bottom:1px solid rgba(48,54,61,.5)}
tbody tr:last-child td{border-bottom:none}
.r{text-align:right}
.tk{font-weight:600}.tk a{color:var(--tx);text-decoration:none}.tk a:hover{color:var(--core)}
.sec{color:var(--mut);font-size:12px;font-weight:400;margin-left:6px}
.pos{color:var(--pos)}.neg{color:var(--neg)}.mut{color:var(--mut)}
.big{font-weight:600;font-size:15px}
.empty{padding:22px 20px;color:var(--mut);text-align:center;font-size:14px}
.ft{color:var(--mut);font-size:12px;margin-top:26px;text-align:center}
@media(max-width:640px){td,thead th{padding:9px 12px}.wrap{padding:16px 10px 40px}.hd,.que,.rule,.tv,.stats{padding-left:14px;padding-right:14px}}
</style></head><body><div class="wrap">
<h1>📊 Sistema de acciones</h1>
<div class="sub" id="sub">cargando…</div>
<div class="top" id="kpis"></div>
<div id="systems"></div>
<div class="ft" id="ft"></div>
</div>
<script>
const f=n=>(n>=0?'+':'')+n.toFixed(n%1?2:0);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const tvUrl=t=>'https://www.tradingview.com/chart/?symbol='+encodeURIComponent(t);
async function load(){
  const d=await (await fetch('/api/data')).json();
  const tot=d.systems.reduce((a,s)=>a+s.openN,0);
  const core=d.systems.filter(s=>s.tagCls==='core');
  const coreP=core.flatMap(s=>s.positions).filter(p=>p.pnlPct!=null);
  const avg=coreP.length?coreP.reduce((a,p)=>a+p.pnlPct,0)/coreP.length:null;
  const win=coreP.filter(p=>p.pnlPct>0).length;
  document.getElementById('sub').textContent='Paper · '+d.systems.length+' sistemas · datos actualizados '+(d.pnlUpdatedAt||'').slice(0,16).replace('T',' ');
  document.getElementById('kpis').innerHTML=[
    ['Posiciones abiertas',tot,''],
    ['P&L medio (principales)',avg!=null?f(avg)+'%':'—',avg>=0?'pos':'neg'],
    ['En verde',coreP.length?win+' / '+coreP.length:'—',''],
  ].map(k=>'<div class="kpi"><div class="l">'+k[0]+'</div><div class="v '+k[2]+'">'+k[1]+'</div></div>').join('');

  document.getElementById('systems').innerHTML=d.systems.map(s=>{
    const rows=s.positions.length?s.positions.map(p=>
      '<tr><td class="tk"><a href="'+tvUrl(p.tv)+'" target="_blank">'+esc(p.ticker)+'</a>'+
        (p.sector?'<span class="sec">'+esc(p.sector)+'</span>':'')+'</td>'+
      '<td class="r">'+(p.entry!=null?p.entry:'—')+'</td>'+
      '<td class="r">'+(p.current!=null?p.current:'—')+'</td>'+
      '<td class="r big '+((p.pnlPct||0)>=0?'pos':'neg')+'">'+(p.pnlPct!=null?f(p.pnlPct)+'%':'—')+'</td>'+
      '<td class="r mut">'+(p.signalDate||'—')+'</td>'+
      '<td class="r mut">'+(p.days!=null?p.days+'d':'—')+'</td>'+
      '<td class="r mut">'+(p.stop!=null?p.stop:'—')+(p.toStopPct!=null?' <span style="font-size:12px">('+p.toStopPct+'%)</span>':'')+'</td></tr>'
    ).join(''):'';
    return '<div class="sys '+s.tagCls+'">'+
      '<div class="hd"><h2>'+s.emoji+' '+esc(s.name)+' <span class="badge '+s.tagCls+'">'+s.tag+'</span></h2>'+
        '<div class="st">'+esc(s.subtitle)+'</div></div>'+
      '<div class="que">'+esc(s.que)+'</div>'+
      '<div class="rules">'+
        '<div class="rule"><div class="l">📍 Entrada</div><div class="v">'+esc(s.entrada)+'</div></div>'+
        '<div class="rule"><div class="l">🚪 Salida</div><div class="v">'+esc(s.salida)+'</div></div>'+
        '<div class="rule"><div class="l">🛑 Stop</div><div class="v">'+esc(s.stop)+'</div></div>'+
      '</div>'+
      '<div class="tv">📈 <b>En TradingView:</b> abre el gráfico en <b>'+esc(s.tv.tf)+'</b> con el indicador <b>'+esc(s.tv.ind)+'</b> — <span class="k">mira '+esc(s.tv.mira)+'</span>.</div>'+
      '<div class="stats"><span>📊 Backtest: '+esc(s.bt)+'</span>'+
        '<span>Abiertas: <b style="color:var(--tx)">'+s.openN+'</b></span>'+
        (s.avgPnl!=null?'<span>P&L medio: <b class="'+(s.avgPnl>=0?'pos':'neg')+'">'+f(s.avgPnl)+'%</b></span>':'')+
        (s.closedN?'<span>Cerradas: '+s.closedN+' ('+f(s.closedSum||0)+'%)</span>':'')+'</div>'+
      (rows?'<table><thead><tr><th>Ticker</th><th class="r">Entrada</th><th class="r">Ahora</th>'+
        '<th class="r">P&L desde aviso</th><th class="r">Señal</th><th class="r">Días</th><th class="r">Stop</th></tr></thead>'+
        '<tbody>'+rows+'</tbody></table>'
        :'<div class="empty">Sin posiciones abiertas. El sistema avisará cuando haya señal.</div>')+
    '</div>';
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
