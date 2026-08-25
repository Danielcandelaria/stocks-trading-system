#!/usr/bin/env node
// backtest_1030_revalidate.mjs — RE-VALIDACIÓN COMPLETA de EMA 10/30 vs 8/21 a través de toda la pila.
//   Para cada pareja: base anticipado · confluencia (EMA+9≤8) · stack (conf+debajo200).
//   Métricas: PF, MEDIANA, sin-top5%, y WALK-FORWARD de 4 ventanas (no 1 partición). + sweep de stop
//   en 10/30 para confirmar que -18% sigue bien. Solo se adopta 10/30 si BATE/IGUALA a 8/21 en toda
//   la pila Y aguanta el WF. 250 large-caps, 10y semanal.
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup } from '../scanner/demark_calc.mjs';
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,GAP=0.012,L200=200,CONF=8;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=dirname(fileURLToPath(import.meta.url));
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i]});return b.length>220?b:null;}catch{return null;}}
// layer: 'base'|'conf'|'stack' · cat: stop fraccion
function trades(bars,F,S,layer,cat){const cl=bars.map(b=>b.c),ef=ema(cl,F),es=ema(cl,S),el=ema(cl,L200),out=[];
  const need9=(layer!=='base');const td=need9?computeTDSetup(bars):null;let i=L200+1;
  while(i<bars.length-1){const gap=(ef[i]-es[i])/cl[i],gp=(ef[i-1]-es[i-1])/cl[i-1];const li=gap<0&&Math.abs(gap)<GAP&&gap>gp;
    if(!li){i++;continue;}
    if(need9){let h=false;for(let j=Math.max(0,i-CONF);j<=i;j++){if(td.bullSetup[j]===9){h=true;break;}}if(!h){i++;continue;}}
    if(layer==='stack'&&!(cl[i]<el[i])){i++;continue;}
    const ep=cl[i],stop=ep*(1-cat);let ret=null,ej=bars.length-1;
    for(let j=i+1;j<bars.length;j++){const bear=ef[j-1]>=es[j-1]&&ef[j]<es[j];if(bars[j].l<=stop){ret=(stop/ep-1)*100-COST*200;ej=j;break;}if(bear){ret=(cl[j]/ep-1)*100-COST*200;ej=j;break;}}
    if(ret==null)ret=(cl[cl.length-1]/ep-1)*100-COST*200;out.push({r:ret,t:bars[i].t});i=ej+1;}
  return out;}
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const st=a=>{const rs=a.map(x=>x.r),n=rs.length;if(!n)return{n:0,pf:0,m:0,med:0};const w=rs.filter(x=>x>0),l=rs.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return{n,pf:gl?Math.abs(gw/gl):99,m:rs.reduce((x,y)=>x+y,0)/n,med:median(rs)};};
function trimTop(a,p){const rs=[...a.map(x=>x.r)].sort((x,y)=>y-x);const kept=rs.slice(Math.floor(rs.length*p));if(!kept.length)return 0;const w=kept.filter(x=>x>0),l=kept.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return gl?Math.abs(gw/gl):99;}
const wf=a=>{if(a.length<8)return'—';const t0=Math.min(...a.map(x=>x.t)),t1=Math.max(...a.map(x=>x.t)),sp=(t1-t0)/4;return[0,1,2,3].map(k=>st(a.filter(x=>Math.min(3,Math.floor((x.t-t0)/sp))===k))).filter(x=>x.n>=4&&x.m>0).length;};

(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8'));const tks=(uni.universe||uni).slice(0,250).map(u=>u.ticker);
  console.log('\n════ RE-VALIDACIÓN COMPLETA — EMA 10/30 vs 8/21 en toda la pila (10y) ════\n');
  const bars={};let ok=0;
  for(const t of tks){const b=await getW(t);await sleep(108);if(!b)continue;ok++;bars[t]=b;}
  console.log(`  ${ok} acciones\n`);
  const gather=(F,S,layer,cat=0.18)=>{const a=[];for(const t in bars)a.push(...trades(bars[t],F,S,layer,cat));return a;};
  console.log('  pareja/capa            n     PF    MEDIANA  sin-top5%  WF(4)');
  for(const layer of ['base','conf','stack']){
    for(const [F,S] of [[8,21],[10,30]]){const a=gather(F,S,layer);const s=st(a);
      console.log(`  ${(F+'/'+S+' '+layer).padEnd(20)} ${String(s.n).padStart(5)}  ${s.pf.toFixed(2).padStart(5)}  ${(s.med>=0?'+':'')+s.med.toFixed(1)+'%'}   ${trimTop(a,0.05).toFixed(2).padStart(5)}      ${wf(a)}/4`);}
    console.log('');
  }
  console.log('── Sweep de STOP en 10/30 (base) — ¿sigue -18% razonable? ──');
  for(const cat of [0.12,0.15,0.18,0.22,0.25]){const a=gather(10,30,'base',cat);const s=st(a);
    console.log(`  stop -${(cat*100).toFixed(0)}%  PF ${s.pf.toFixed(2)} · MEDIANA ${s.med>=0?'+':''}${s.med.toFixed(1)}% · sin-top5% ${trimTop(a,0.05).toFixed(2)} · WF ${wf(a)}/4`);}
  console.log('\n  Adoptar 10/30 SOLO si iguala/bate a 8/21 en las 3 capas Y mantiene WF alto. Si empeora alguna, no.\n');
})();
