#!/usr/bin/env node
// backtest_capital.mjs — ¿qué sistema aguanta mejor con CAPITAL LIMITADO?
//   Simula tu caso real: capital para N posiciones máx. Las señales se toman por ORDEN DE LLEGADA
//   (sin cherry-picking; cuando no hay hueco, se SALTA la señal). Modela N sleeves iguales, cada uno
//   invierte en una posición a la vez y compone. Compara EMACross solo, DeMark solo, y combinado.
//   Responde: ¿se rompe el edge con pocas posiciones? ¿cuál usar si solo puedo con uno?
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup, computeTDCountdown } from '../scanner/demark_calc.mjs';
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,GAP=0.012,TW=52;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=dirname(fileURLToPath(import.meta.url));
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i]});return b.length>120?b:null;}catch{return null;}}

// generadores: devuelven {entryT, exitT, r}
function emaTrades(bars){const cl=bars.map(b=>b.c),ef=ema(cl,8),es=ema(cl,21),out=[];let i=22;
  while(i<bars.length-1){const gap=(ef[i]-es[i])/cl[i],gp=(ef[i-1]-es[i-1])/cl[i-1];const li=gap<0&&Math.abs(gap)<GAP&&gap>gp;
    if(!li){i++;continue;}const ep=cl[i],stop=ep*(1-CAT);let ret=null,exitJ=bars.length-1;
    for(let j=i+1;j<bars.length;j++){const bear=ef[j-1]>=es[j-1]&&ef[j]<es[j];
      if(bars[j].l<=stop){ret=(stop/ep-1)*100-COST*200;exitJ=j;break;}if(bear){ret=(cl[j]/ep-1)*100-COST*200;exitJ=j;break;}}
    if(ret==null){ret=(cl[cl.length-1]/ep-1)*100-COST*200;exitJ=bars.length-1;}out.push({entryT:bars[i].t,exitT:bars[exitJ].t,r:ret});i=exitJ+1;}
  return out;}
function demTrades(bars){const td=computeTDSetup(bars),out=[];let i=0;
  while(i<bars.length-1){if(td.bullSetup[i]!==9){i++;continue;}const ep=bars[i].c,stop=ep*(1-CAT);let ret=null,exitJ=bars.length-1;
    for(let j=i+1;j<bars.length;j++){if(bars[j].l<=stop){ret=(stop/ep-1)*100-COST*200;exitJ=j;break;}
      if(td.bearSetup[j]===9){ret=(bars[j].c/ep-1)*100-COST*200;exitJ=j;break;}if(j-i>=TW){ret=(bars[j].c/ep-1)*100-COST*200;exitJ=j;break;}}
    if(ret==null){ret=(bars[bars.length-1].c/ep-1)*100-COST*200;exitJ=bars.length-1;}out.push({entryT:bars[i].t,exitT:bars[exitJ].t,r:ret});i=exitJ+1;}
  return out;}

// simula cartera de N sleeves (N posiciones máx), orden de llegada, cada sleeve compone
function sim(trades,N){
  const sorted=[...trades].sort((a,b)=>a.entryT-b.entryT);
  const slots=Array.from({length:N},()=>({freeAt:-Infinity,eq:1}));
  let taken=0,skipped=0;const taer=[];const events=[];
  for(const t of sorted){
    const slot=slots.find(s=>s.freeAt<=t.entryT);
    if(!slot){skipped++;continue;}
    slot.eq*=(1+t.r/100);slot.freeAt=t.exitT;taken++;taer.push({...t});
    events.push({at:t.exitT,eq:slots.reduce((a,s)=>a+s.eq,0)/N});
  }
  const finalEq=slots.reduce((a,s)=>a+s.eq,0)/N;
  // maxDD sobre la curva de equity (ordenada por evento de salida)
  events.sort((a,b)=>a.at-b.at);let peak=0,dd=0;for(const e of events){peak=Math.max(peak,e.eq);dd=Math.min(dd,(e.eq-peak)/peak*100);}
  const rs=taer.map(x=>x.r),med=rs.length?[...rs].sort((a,b)=>a-b)[rs.length>>1]:0;
  const wr=rs.length?100*rs.filter(x=>x>0).length/rs.length:0;
  return{taken,skipped,pct:100*taken/(taken+skipped),finalEq,cagr:(finalEq**(1/10)-1)*100,maxDD:dd,med,wr,taer};
}
const yOf=t=>new Date(t*1000).getUTCFullYear();

(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8'));const tks=(uni.universe||uni).slice(0,250).map(u=>u.ticker);
  console.log('\n════ CAPITAL LIMITADO — ¿se rompe el edge? ¿cuál usar solo? (10y semanal) ════\n');
  let E=[],D=[],ok=0;
  for(const t of tks){const b=await getW(t);await sleep(110);if(!b)continue;ok++;E.push(...emaTrades(b));D.push(...demTrades(b));}
  const C=[...E,...D];
  console.log(`  ${ok} acciones · EMA ${E.length} señales · DeMark ${D.length} · total ${C.length}\n`);
  for(const N of [3,5,8]){
    console.log(`──────── CON CAPITAL PARA ${N} POSICIONES MÁX ────────`);
    const r=(lbl,set)=>{const s=sim(set,N);console.log(`  ${lbl.padEnd(20)} tomadas ${s.taken}/${s.taken+s.skipped} (${s.pct.toFixed(0)}%) · x${s.finalEq.toFixed(1)} en 10y · CAGR ${s.cagr.toFixed(0)}% · maxDD ${s.maxDD.toFixed(0)}% · WR ${s.wr.toFixed(0)}% · mediana ${s.med>=0?'+':''}${s.med.toFixed(1)}%`);return s;};
    r('EMACross solo',E);r('DeMark solo',D);r('Combinado (ambos)',C);
    console.log('');
  }
  console.log('  x = multiplicador de capital en 10 años · orden de llegada, SIN cherry-picking.');
  console.log('  La pregunta: ¿la versión con N bajo sigue siendo rentable? ¿cuál cae menos?\n');
})();
