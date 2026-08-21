#!/usr/bin/env node
// backtest_tp_projection.mjs — (1) ¿ayuda un TP fijo? (2) proyección honesta de $100×N a 1-5 años.
//   Cartera N=6 slots, señales por orden de llegada, cada slot compone. Variantes de salida:
//   sin-TP (cruce contrario, el validado) vs TP +25/+50/+100%. Stop -18%. Por régimen (2 mitades).
//   Fuente de señal: EMACross anticipado + DeMark setup-9 (los 2 motores). 250 large-caps, 10y.
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup } from '../scanner/demark_calc.mjs';
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,GAP=0.012,TW=52;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=dirname(fileURLToPath(import.meta.url));
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i]});return b.length>60?b:null;}catch{return null;}}

// genera trades {entryT,exitT,r} con TP opcional (tp=0 → sin TP). src:'ema'|'dem'
function gen(bars,src,tp){const cl=bars.map(b=>b.c),ef=ema(cl,8),es=ema(cl,21),out=[];const td=src==='dem'?computeTDSetup(bars):null;let i=src==='dem'?0:22;
  while(i<bars.length-1){let trig;
    if(src==='dem')trig=td.bullSetup[i]===9;
    else{const gap=(ef[i]-es[i])/cl[i],gp=(ef[i-1]-es[i-1])/cl[i-1];trig=gap<0&&Math.abs(gap)<GAP&&gap>gp;}
    if(!trig){i++;continue;}
    const ep=cl[i],stop=ep*(1-CAT),tgt=tp>0?ep*(1+tp):null;let ret=null,ej=bars.length-1;
    for(let j=i+1;j<bars.length;j++){
      if(bars[j].l<=stop){ret=(stop/ep-1)-COST*2;ej=j;break;}
      if(tgt&&bars[j].h>=tgt){ret=(tgt/ep-1)-COST*2;ej=j;break;}   // TP alcanzado (fill en el objetivo)
      const bear=ef[j-1]>=es[j-1]&&ef[j]<es[j];
      if(src==='dem'){if(td.bearSetup[j]===9||j-i>=TW){ret=(cl[j]/ep-1)-COST*2;ej=j;break;}}
      else if(bear){ret=(cl[j]/ep-1)-COST*2;ej=j;break;}}
    if(ret==null)ret=(cl[cl.length-1]/ep-1)-COST*2;out.push({entryT:bars[i].t,exitT:bars[ej].t,r:ret});i=ej+1;}
  return out;}
// cartera N slots, orden de llegada, compone
function sim(trades,N){const s=[...trades].sort((a,b)=>a.entryT-b.entryT);const slots=Array.from({length:N},()=>({free:-1e18,eq:1}));
  for(const t of s){const sl=slots.find(x=>x.free<=t.entryT);if(!sl)continue;sl.eq*=(1+t.r);sl.free=t.exitT;}
  return slots.reduce((a,x)=>a+x.eq,0)/N;}
const yrs=(a)=>{const t=a.map(x=>x.entryT);return (Math.max(...t)-Math.min(...t))/(365.25*86400);};

(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8'));const tks=(uni.universe||uni).slice(0,250).map(u=>u.ticker);
  console.log('\n════ (1) ¿AYUDA UN TP FIJO? — cartera 6 posiciones, 10y ════\n');
  const TPS=[0,0.25,0.50,1.00];const src={};for(const tp of TPS)src[tp]=[];let ok=0;
  for(const t of tks){const b=await getW(t);await sleep(105);if(!b)continue;ok++;for(const tp of TPS){src[tp].push(...gen(b,'ema',tp));src[tp].push(...gen(b,'dem',tp));}}
  const yEma=yrs(src[0]);
  console.log(`  ${ok} acciones · ~${yEma.toFixed(1)} años\n`);
  // corte temporal para OOS
  const allT=src[0].map(x=>x.entryT).sort((a,b)=>a-b);const mid=allT[Math.floor(allT.length/2)];
  const cagrOf=(a,years)=>{const m=sim(a,6);return years>0?(m**(1/years)-1)*100:0;};
  console.log('  salida            CAGR FULL   H1(2016-21)   H2(2021-26)   ¿estable?');
  const res={};
  for(const tp of TPS){const full=cagrOf(src[tp],yEma);
    const h1=src[tp].filter(x=>x.entryT<mid),h2=src[tp].filter(x=>x.entryT>=mid);
    const y1=yrs(h1)||1,y2=yrs(h2)||1;const c1=cagrOf(h1,y1),c2=cagrOf(h2,y2);
    res[tp]={cagr:full,c1,c2};
    const stable=Math.min(c1,c2)>0&&Math.abs(c1-c2)<Math.max(20,Math.max(c1,c2)*0.6);
    console.log(`  ${(tp===0?'sin TP (cruce)':'TP +'+(tp*100)+'%').padEnd(16)}  ${full.toFixed(1).padStart(5)}%      ${c1.toFixed(1).padStart(6)}%       ${c2.toFixed(1).padStart(6)}%      ${stable?'✅':'❌ inestable'}`);}
  console.log('\n════ (2) PROYECCIÓN $100 × N a 1-5 años (escenarios) ════\n');
  const cagrBase=res[0].cagr;
  console.log(`  CAGR histórico (sin TP, 6 pos): ${cagrBase.toFixed(1)}% — pero INFLADO por supervivencia.`);
  console.log(`  Escenarios (haircut supervivencia + rango de régimen):`);
  const scen={ 'Malo (regimen adverso)':Math.max(0,cagrBase*0.25), 'Base (haircut 50%)':cagrBase*0.5, 'Bueno (regimen favorable)':cagrBase*0.85 };
  for(const N of [6]){const cap=100*N;
    console.log(`\n  Con $${cap} (${N} posiciones de $100):`);
    console.log('  escenario                 CAGR    1año     2años    3años    5años');
    for(const[k,c] of Object.entries(scen)){const f=y=>(cap*Math.pow(1+c/100,y)).toFixed(0);
      console.log('  '+k.padEnd(26)+(c.toFixed(1)+'%').padEnd(8)+'$'+f(1).padEnd(8)+'$'+f(2).padEnd(8)+'$'+f(3).padEnd(8)+'$'+f(5));}}
  console.log('\n  ⚠️ NO es predicción. Alta varianza: un año concreto puede ir de -30% a +60%. El haircut por');
  console.log('  supervivencia es una asunción (validado que forex/commodities sin sesgo daban ~mitad del PF).');
})();
