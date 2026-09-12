#!/usr/bin/env node
// mc_health_bands.mjs — Bandas Monte Carlo (p95) para el monitor de salud.
//   Genera la distribución REAL de retornos por trade de cada sistema (backtest 250 large-caps, 10y semanal)
//   y hace bootstrap para estimar, en el MISMO espacio que usa monitor_health (SUMA de retPct, no compuesto):
//     - maxDD p95/p99 a varios horizontes N → ajusta coef a en  maxDD_p95 ≈ a·√N  (banda escalable con n).
//     - peor racha perdedora p95 a varios N.
//   Sistemas: EMACross (cruce anticipado, salida cruce↓, stop -18%) · WeeklySwing (bullSetup9→cd13/52w, stop -18%).
//   READ-ONLY (Yahoo). Uso: node mc_health_bands.mjs [sample=250] [iters=5000]
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup, computeTDCountdown } from '../scanner/demark_calc.mjs';
const UA={'User-Agent':'Mozilla/5.0'};const FAST=8,SLOW=21,CAT=0.18,GAPTH=0.012,COST=0.0006,TIME_W=52;
const SAMPLE=+(process.argv[2]||250), ITERS=+(process.argv[3]||5000), CONC=12;
const ROOT=dirname(fileURLToPath(import.meta.url));
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i]});return b.length>120?b:null;}catch{return null;}}
async function mapLimit(items,n,fn){const out=[];let i=0;await Promise.all(Array.from({length:n},async()=>{while(i<items.length){const k=i++;out[k]=await fn(items[k]);}}));return out;}

// EMACross anticipado: entrada gap converge <1.2%, salida cruce↓, stop -18%
function emaRets(bars){const cl=bars.map(x=>x.c),ef=ema(cl,FAST),es=ema(cl,SLOW),out=[];let inPos=false,ei=0,stop=0;
  for(let i=SLOW+1;i<bars.length;i++){const gap=(ef[i]-es[i])/cl[i],gp=(ef[i-1]-es[i-1])/cl[i-1];
    if(!inPos&&gap<0&&Math.abs(gap)<GAPTH&&gap>gp){inPos=true;ei=i;stop=cl[i]*(1-CAT);continue;}
    if(inPos){const bear=gp>=0&&gap<0;
      if(bars[i].l<=stop){out.push((stop/cl[ei]-1)*100-COST*200);inPos=false;}
      else if(bear){out.push((cl[i]/cl[ei]-1)*100-COST*200);inPos=false;}}}
  return out;}
// WeeklySwing: entrada bullSetup==9, salida bearCountdown==13/52w, stop -18%
function wsRets(bars){const td=computeTDSetup(bars),cd=computeTDCountdown(bars,td),c=bars.map(x=>x.c),out=[];let i=0;
  while(i<bars.length-1){if(td.bullSetup[i]!==9){i++;continue;}const ep=c[i],stop=ep*(1-CAT);let ret=null,ej=bars.length-1;
    for(let j=i+1;j<bars.length;j++){if(bars[j].l<=stop){ret=(stop/ep-1)*100-COST*200;ej=j;break;}
      if(cd.bearCountdown[j]===13){ret=(c[j]/ep-1)*100-COST*200;ej=j;break;}
      if(j-i>=TIME_W){ret=(c[j]/ep-1)*100-COST*200;ej=j;break;}}
    if(ret==null)ret=(c[bars.length-1]/ep-1)*100-COST*200;out.push(ret);i=ej+1;}
  return out;}

const pct=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(p*s.length))];};
function mcStats(dist,N,iters){const md=[],st=[];
  for(let k=0;k<iters;k++){let eq=0,peak=0,dd=0,streak=0,worst=0;
    for(let j=0;j<N;j++){const v=dist[(Math.random()*dist.length)|0];eq+=v;peak=Math.max(peak,eq);dd=Math.min(dd,eq-peak);if(v<=0){streak++;worst=Math.max(worst,streak);}else streak=0;}
    md.push(-dd);st.push(worst);}
  return {ddP95:pct(md,0.95),ddP99:pct(md,0.99),stP95:pct(st,0.95)};}

(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8')).universe.slice(0,SAMPLE).map(u=>u.ticker);
  console.log(`\n════ BANDAS MONTE CARLO para monitor_health (${uni.length} tickers · ${ITERS} iters/bootstrap) ════\n`);
  const bars=await mapLimit(uni,CONC,getW);
  const DIST={EMACross:[],WeeklySwing:[]};
  for(const b of bars){if(!b)continue;DIST.EMACross.push(...emaRets(b));DIST.WeeklySwing.push(...wsRets(b));}
  const Ns=[20,30,50,75,100,150];
  for(const [sys,dist] of Object.entries(DIST)){
    const w=dist.filter(x=>x>0).length;
    console.log(`── ${sys} · ${dist.length} trades · WR ${(100*w/dist.length).toFixed(1)}% · media ${(dist.reduce((a,b)=>a+b,0)/dist.length).toFixed(2)}% · mediana ${pct(dist,0.5).toFixed(2)}% ──`);
    let sxy=0,sxx=0; const rows=[];
    for(const N of Ns){const s=mcStats(dist,N,ITERS);rows.push([N,s]);const sq=Math.sqrt(N);sxy+=s.ddP95*sq;sxx+=N;
      console.log(`   N=${String(N).padStart(3)} → maxDD p95 ${s.ddP95.toFixed(0)}%  p99 ${s.ddP99.toFixed(0)}%  · racha p95 ${s.stP95}`);}
    const coef=sxy/sxx;  // ajuste por origen: maxDD_p95 ≈ coef·√N
    // racha p95 al horizonte cercano de cada sistema (EMACross~60, WeeklySwing~30)
    console.log(`   ⇒ COEF maxDD (banda = coef·√n): ${coef.toFixed(1)}   [ej n=57 → ${(coef*Math.sqrt(57)).toFixed(0)}% · n=30 → ${(coef*Math.sqrt(30)).toFixed(0)}%]`);
    console.log(`   ⇒ racha p95 sugerida: ${sys==='EMACross'?rows.find(r=>r[0]===75)[1].stP95:rows.find(r=>r[0]===30)[1].stP95} (al horizonte cercano)\n`);
  }
  console.log('  NOTA: en EMACross (tail-dependent) la maxDD será NOTA informativa, no 🔴; la racha SÍ es alarma dura.');
})();
