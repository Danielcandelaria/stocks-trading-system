#!/usr/bin/env node
// backtest_kelly.mjs — SIZING: Kelly empírico sobre la distribución REAL de retornos del sistema.
//   f* = argmax_f  E[ log(1 + f·r) ]  (r = retorno por trade en fracción). Es la fracción de capital
//   a poner en CADA posición para maximizar el crecimiento geométrico. Se reporta full/½/¼ Kelly,
//   el riesgo por trade implícito (f·stop) y el crecimiento. ⚠️ backtest con sesgo de supervivencia
//   → SIEMPRE fraccional (¼) por error de estimación + correlación + colas.
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup } from '../scanner/demark_calc.mjs';
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,GAP=0.012,L200=200,CONF=13;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=dirname(fileURLToPath(import.meta.url));
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i]});return b.length>220?b:null;}catch{return null;}}
function emaTr(bars,need9){const cl=bars.map(b=>b.c),ef=ema(cl,8),es=ema(cl,21),out=[];const td=need9?computeTDSetup(bars):null;let i=L200+1;
  while(i<bars.length-1){const gap=(ef[i]-es[i])/cl[i],gp=(ef[i-1]-es[i-1])/cl[i-1];const li=gap<0&&Math.abs(gap)<GAP&&gap>gp;
    if(!li){i++;continue;}if(need9){let h=false;for(let j=Math.max(0,i-CONF);j<=i;j++){if(td.bullSetup[j]===9){h=true;break;}}if(!h){i++;continue;}}
    const ep=cl[i],stop=ep*(1-CAT);let ret=null,ej=bars.length-1;
    for(let j=i+1;j<bars.length;j++){const bear=ef[j-1]>=es[j-1]&&ef[j]<es[j];if(bars[j].l<=stop){ret=(stop/ep-1)-COST*2;ej=j;break;}if(bear){ret=(cl[j]/ep-1)-COST*2;ej=j;break;}}
    if(ret==null)ret=(cl[cl.length-1]/ep-1)-COST*2;out.push(ret);i=ej+1;}return out;}
function demTr(bars){const cl=bars.map(b=>b.c),out=[];const td=computeTDSetup(bars);let i=0;
  while(i<bars.length-1){if(td.bullSetup[i]!==9){i++;continue;}const ep=cl[i],stop=ep*(1-CAT);let ret=null,ej=bars.length-1;
    for(let j=i+1;j<bars.length;j++){if(bars[j].l<=stop){ret=(stop/ep-1)-COST*2;ej=j;break;}if(td.bearSetup[j]===9){ret=(cl[j]/ep-1)-COST*2;ej=j;break;}if(j-i>=52){ret=(cl[j]/ep-1)-COST*2;ej=j;break;}}
    if(ret==null)ret=(cl[cl.length-1]/ep-1)-COST*2;out.push(ret);i=ej+1;}return out;}
// Kelly: f que maximiza media de log(1+f*r). Grid seguro (evita 1+f*r<=0).
function kelly(rs){const minr=Math.min(...rs);const fmax=minr<0?(-0.999/minr):5;let best=0,bg=-1e9;
  for(let f=0.01;f<=Math.min(fmax,5);f+=0.01){let g=0,ok=true;for(const r of rs){const x=1+f*r;if(x<=0){ok=false;break;}g+=Math.log(x);}if(!ok)break;g/=rs.length;if(g>bg){bg=g;best=f;}}
  return {f:best,g:bg};}
const stats=rs=>{const n=rs.length,w=rs.filter(x=>x>0),l=rs.filter(x=>x<=0);const aw=w.reduce((a,b)=>a+b,0)/(w.length||1),al=l.reduce((a,b)=>a+b,0)/(l.length||1);return{n,wr:w.length/n,aw,al,payoff:Math.abs(aw/al)};};

(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8'));const tks=(uni.universe||uni).slice(0,250).map(u=>u.ticker);
  console.log('\n════ SIZING — Kelly empírico sobre retornos reales del sistema (10y) ════\n');
  const A={ema:[],conf:[],dem:[]};let ok=0;
  for(const t of tks){const b=await getW(t);await sleep(110);if(!b)continue;ok++;A.ema.push(...emaTr(b,false));A.conf.push(...emaTr(b,true));A.dem.push(...demTr(b));}
  console.log(`  ${ok} acciones\n`);
  for(const [name,rs] of [['EMA anticipado',A.ema],['CONFLUENCIA (EMA+9)',A.conf],['DeMark setup-9',A.dem]]){
    const s=stats(rs),k=kelly(rs);
    const growth=f=>{let g=0;for(const r of rs){g+=Math.log(1+f*r);}return Math.exp(g/rs.length)-1;};
    console.log(`── ${name} (${s.n} trades) ──`);
    console.log(`  WR ${(s.wr*100).toFixed(0)}% · gana media +${(s.aw*100).toFixed(1)}% · pierde media ${(s.al*100).toFixed(1)}% · payoff ${s.payoff.toFixed(2)}x`);
    console.log(`  KELLY COMPLETO f* = ${k.f.toFixed(2)}  (crecim/trade ${(growth(k.f)*100).toFixed(2)}%)`);
    console.log(`  ½ Kelly f=${(k.f/2).toFixed(2)} (${(growth(k.f/2)*100).toFixed(2)}%) · ¼ Kelly f=${(k.f/4).toFixed(2)} (${(growth(k.f/4)*100).toFixed(2)}%)`);
    console.log(`  Riesgo por trade a ¼ Kelly = ${(k.f/4*CAT*100).toFixed(1)}% del capital (fracción × stop 18%)\n`);
  }
  console.log('  f* = fracción del capital por posición. Con posiciones simultáneas y CORRELADAS (todo acciones long),');
  console.log('  el Kelly efectivo baja mucho → usar ¼ Kelly y repartir. Sesgo de supervivencia infla f* → fraccional SIEMPRE.\n');
})();
