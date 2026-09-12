#!/usr/bin/env node
// backtest_carlos_upgrade_ladder.mjs — ¿Cómo mejoraría Carlos su estrategia con NUESTRAS piezas validadas?
//   Transforma la estrategia de Carlos paso a paso, midiendo el efecto de cada mejora (trade-level, 1 pos/vez,
//   así aislamos la CALIDAD de señal sin el espejismo del compounding 100%). 250 large-caps, 10y semanal, coste 0.06%/lado.
//     V0 CARLOS   : entrada flip (bearSetup==1)  · salida flip opuesto (bullSetup==1)   · SIN stop
//     V1 +stop    : =V0 + stop catástrofe -18% (nuestra regla de riesgo)
//     V2 +9-suelo : entrada 9-SUELO (bullSetup==9, comprar agotamiento) · salida setup opuesto (bearSetup==9) · stop -18% · time 52w
//     V3 WeeklySwing (lo nuestro en vivo): entrada bullSetup==9 · salida bearCountdown==13 · stop -18% · time 52w
//   Métricas escépticas: WR, PF, MEDIANA, PF-sin-top5%, ret medio (expectativa), %stop, WF 4/4, 2 mitades OOS.
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup, computeTDCountdown } from '../scanner/demark_calc.mjs';
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,TIME_W=52;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const ROOT=dirname(fileURLToPath(import.meta.url));
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i]});return b.length>120?b:null;}catch{return null;}}
async function mapLimit(items,n,fn){const out=[];let i=0;await Promise.all(Array.from({length:n},async()=>{while(i<items.length){const k=i++;out[k]=await fn(items[k]);}}));return out;}

// entryPred(sig,i)->bool ; exitPred(sig,j)->bool ; useStop ; useTime
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
  console.log(`\n════ MEJORAR LA ESTRATEGIA DE CARLOS con nuestras piezas validadas (trade-level, 1 pos/vez) ════`);
  console.log(`  250 large-caps · 10y semanal · coste 0.06%/lado · stop -18% donde aplica\n`);
  const bars=await mapLimit(uni,12,getW);
  const V={V0:[],V1:[],V2:[],V3:[]};
  for(const b of bars){ if(!b) continue;
    const td=computeTDSetup(b), cd=computeTDCountdown(b,td), sig={td,cd};
    const eFlip=(s,i)=>s.td.bearSetup[i]===1;      // Carlos: entrada flip (sellSetup==1)
    const xFlip=(s,j)=>s.td.bullSetup[j]===1;       // Carlos: salida flip opuesto (buySetup==1)
    const eSuelo=(s,i)=>s.td.bullSetup[i]===9;       // nuestro: comprar el 9-suelo (agotamiento)
    const xOpp=(s,j)=>s.td.bearSetup[j]===9;         // salida en setup opuesto (techo)
    const xCd13=(s,j)=>s.cd.bearCountdown[j]===13;   // salida WeeklySwing (agotamiento techo)
    V.V0.push(...runVariant(b,sig,eFlip,xFlip,false,false));
    V.V1.push(...runVariant(b,sig,eFlip,xFlip,true,false));
    V.V2.push(...runVariant(b,sig,eSuelo,xOpp,true,true));
    V.V3.push(...runVariant(b,sig,eSuelo,xCd13,true,true));
  }
  const row=(lbl,a)=>{const s=st(a);const ts=[...a].sort((x,y)=>x.t-y.t),mid=ts.length?ts[ts.length>>1].t:0;const h1=st(a.filter(x=>x.t<mid)),h2=st(a.filter(x=>x.t>=mid));const stops=a.filter(x=>x.why==='stop').length;
    console.log(`  ${lbl.padEnd(34)} n ${String(s.n).padStart(4)} · WR ${s.wr.toFixed(0).padStart(2)}% · PF ${s.pf.toFixed(2)} · MED ${s.med>=0?'+':''}${s.med.toFixed(1)}% · exp ${s.m>=0?'+':''}${s.m.toFixed(1)}% · sinTop5% ${trim5(a).toFixed(2)} · %stop ${(100*stops/s.n).toFixed(0)}% · WF ${wf(a)}`);
    console.log(`  ${''.padEnd(34)}   OOS mit1(${yr(ts[0]?.t)}-${yr(mid)}) PF ${h1.pf?.toFixed(2)}/exp ${h1.m>=0?'+':''}${h1.m?.toFixed(1)}%  ·  mit2 PF ${h2.pf?.toFixed(2)}/exp ${h2.m>=0?'+':''}${h2.m?.toFixed(1)}%`);};
  row('V0 CARLOS (flip→flip, sin stop)', V.V0);
  row('V1 +stop -18%', V.V1);
  row('V2 +entrada 9-SUELO (agotam.)', V.V2);
  row('V3 =WeeklySwing (salida cd13)', V.V3);
  console.log(`\n  Cada fila añade UNA pieza validada nuestra. Lo decisivo es el salto de entrada flip → 9-suelo.\n`);
})();
