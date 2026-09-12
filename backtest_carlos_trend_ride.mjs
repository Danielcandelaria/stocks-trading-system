#!/usr/bin/env node
// backtest_carlos_trend_ride.mjs — Mejorar la estrategia de Carlos EN SUS PROPIOS TÉRMINOS.
//   PREMISA CORRECTA (DeMark): un SELL Setup cuenta una TENDENCIA ALCISTA en marcha (precio subiendo);
//   el "sell" es la sugerencia al AGOTARSE la subida (Sell Countdown 13 = techo). Por tanto Carlos,
//   entrando LONG en el Sell Setup, es un TREND-FOLLOWER que cabalga la subida (no compra un techo).
//   Su fallo no es la dirección: es SALIR al primer flip contrario (whipsaw). Test: dejar correr hasta el techo.
//   demark_calc: bearSetup = SELL Setup (close>close[4], sube) · bullSetup = BUY Setup (close<close[4], baja)
//                bearCountdown = SELL Countdown (techo/agotamiento alcista) · bullSetup==9 = suelo (ref WeeklySwing)
//   250 large-caps, 10y semanal, coste 0.06%/lado, stop -18% donde aplica, time 52w. 1 pos/vez, trade-level.
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup, computeTDCountdown } from '../scanner/demark_calc.mjs';
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,TIME_W=52;
const ROOT=dirname(fileURLToPath(import.meta.url));
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i]});return b.length>120?b:null;}catch{return null;}}
async function mapLimit(items,n,fn){const out=[];let i=0;await Promise.all(Array.from({length:n},async()=>{while(i<items.length){const k=i++;out[k]=await fn(items[k]);}}));return out;}

function runVariant(bars, sig, entryPred, exitPred, useStop, useTime){
  const c=bars.map(x=>x.c), out=[]; let i=0;
  while(i<bars.length-1){
    if(!entryPred(sig,i)){ i++; continue; }
    const ep=c[i], stop=ep*(1-CAT);
    let ret=null,why='',exitJ=bars.length-1;
    for(let j=i+1;j<bars.length;j++){
      if(useStop && bars[j].l<=stop){ ret=(stop/ep-1)*100-COST*200; why='stop'; exitJ=j; break; }
      if(exitPred(sig,j)){ ret=(c[j]/ep-1)*100-COST*200; why='exit'; exitJ=j; break; }
      if(useTime && j-i>=TIME_W){ ret=(c[j]/ep-1)*100-COST*200; why='time'; exitJ=j; break; }
    }
    if(ret==null){ ret=(c[bars.length-1]/ep-1)*100-COST*200; why='open'; }
    out.push({r:ret,t:bars[i].t,why}); i=exitJ+1;
  }
  return out;
}
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const st=a=>{const rs=a.map(x=>x.r),n=rs.length;if(!n)return{n:0};const w=rs.filter(x=>x>0),l=rs.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return{n,pf:gl?Math.abs(gw/gl):99,m:rs.reduce((x,y)=>x+y,0)/n,wr:100*w.length/n,med:median(rs)};};
const trim5=a=>{const rs=[...a.map(x=>x.r)].sort((x,y)=>y-x),cut=Math.floor(rs.length*0.05),k=rs.slice(cut);if(!k.length)return 0;const w=k.filter(x=>x>0).reduce((x,y)=>x+y,0),l=Math.abs(k.filter(x=>x<=0).reduce((x,y)=>x+y,0));return l?w/l:99;};
const wf=a=>{if(a.length<8)return'—';const t0=Math.min(...a.map(x=>x.t)),t1=Math.max(...a.map(x=>x.t)),sp=(t1-t0)/4;return[0,1,2,3].map(k=>st(a.filter(x=>Math.min(3,Math.floor((x.t-t0)/sp))===k))).filter(x=>x.n>=5&&x.m>0).length+'/4';};
const yr=t=>new Date(t*1000).getUTCFullYear();

(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8')).universe.slice(0,250).map(u=>u.ticker);
  console.log(`\n════ MEJORAR A CARLOS EN SUS TÉRMINOS: trend-long en el Sell Setup, dejando correr hasta el techo ════`);
  console.log(`  250 large-caps · 10y semanal · coste 0.06%/lado · SELL Setup = tramo alcista (Carlos cabalga la subida)\n`);
  const bars=await mapLimit(uni,12,getW);
  const V={K0:[],K1:[],K2:[],K3:[],REF:[]};
  for(const b of bars){ if(!b) continue;
    const td=computeTDSetup(b), cd=computeTDCountdown(b,td), sig={td,cd};
    const eSellFlip=(s,i)=>s.td.bearSetup[i]===1;    // Carlos: LONG al iniciar el tramo alcista (Sell Setup 1)
    const xBuyFlip =(s,j)=>s.td.bullSetup[j]===1;    // Carlos: salir al primer flip bajista (whipsaw)
    const xTop     =(s,j)=>s.cd.bearCountdown[j]===13;// dejar correr: salir en el AGOTAMIENTO del techo (Sell CD 13)
    const xTrendBreak=(s,j)=>s.td.bullSetup[j]===9;   // o cuando se confirma un tramo bajista completo (Buy Setup 9)
    const xRide=(s,j)=>xTop(s,j)||xTrendBreak(s,j);   // ride: techo O ruptura de tendencia
    const eSuelo=(s,i)=>s.td.bullSetup[i]===9;         // REF WeeklySwing: comprar el SUELO del tramo bajista
    V.K0.push(...runVariant(b,sig,eSellFlip,xBuyFlip,false,false));  // Carlos base
    V.K1.push(...runVariant(b,sig,eSellFlip,xBuyFlip,true,false));   // + stop
    V.K2.push(...runVariant(b,sig,eSellFlip,xRide,true,true));       // + dejar correr hasta techo/ruptura
    V.K3.push(...runVariant(b,sig,eSellFlip,xTop,true,true));        // ride SOLO hasta el techo (Sell CD13)
    V.REF.push(...runVariant(b,sig,eSuelo,xTop,true,true));          // WeeklySwing (reversión, referencia)
  }
  const row=(lbl,a)=>{const s=st(a);const ts=[...a].sort((x,y)=>x.t-y.t),mid=ts.length?ts[ts.length>>1].t:0;const h1=st(a.filter(x=>x.t<mid)),h2=st(a.filter(x=>x.t>=mid));const stops=a.filter(x=>x.why==='stop').length;
    console.log(`  ${lbl.padEnd(36)} n ${String(s.n).padStart(5)} · WR ${s.wr.toFixed(0).padStart(2)}% · PF ${s.pf.toFixed(2)} · MED ${s.med>=0?'+':''}${s.med.toFixed(1)}% · exp ${s.m>=0?'+':''}${s.m.toFixed(1)}% · sinTop5% ${trim5(a).toFixed(2)} · %stop ${(100*stops/s.n).toFixed(0)}% · WF ${wf(a)}`);
    console.log(`  ${''.padEnd(36)}   OOS mit1(${yr(ts[0]?.t)}-${yr(mid)}) PF ${h1.pf?.toFixed(2)}/exp ${h1.m>=0?'+':''}${h1.m?.toFixed(1)}%  ·  mit2 PF ${h2.pf?.toFixed(2)}/exp ${h2.m>=0?'+':''}${h2.m?.toFixed(1)}%`);};
  console.log('  ── La estrategia de Carlos (entrada Sell Setup = cabalgar la subida), arreglando la SALIDA ──');
  row('K0 Carlos base (flip→flip)', V.K0);
  row('K1 +stop -18%', V.K1);
  row('K2 +dejar correr (techo o ruptura)', V.K2);
  row('K3 +correr solo hasta techo (SellCD13)', V.K3);
  console.log('\n  ── Referencia: nuestra reversión (comprar el SUELO), filosofía opuesta ──');
  row('REF WeeklySwing (Buy Setup 9 → techo)', V.REF);
  console.log('\n  Pregunta: manteniendo la entrada trend de Carlos, ¿dejar correr hasta el techo la salva?\n');
})();
