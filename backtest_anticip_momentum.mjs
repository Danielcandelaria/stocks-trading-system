#!/usr/bin/env node
// backtest_anticip_momentum.mjs — ¿un filtro de MOMENTUM mejora la anticipación (y quita el
// factor humano)? La anticipación falla cuando el cruce no llega y el precio sigue cayendo.
// Hipótesis: exigir que el precio ya empuje al alza descarta esas falsas.
// Entrada anticipada = gap EMA8-EMA21 < 2% convergiendo. Long-only, stop -18%, salida cruce.
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const UA={'User-Agent':'Mozilla/5.0'}; const COST=0.0006, FAST=8, SLOW=21, CAT=0.18, TH=0.02, SAMPLE=+(process.argv[2]||250);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=dirname(fileURLToPath(import.meta.url));
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');
  try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});
    if(!r.ok)return null;const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];
    if(!d?.timestamp||!q)return null;const b=[];
    for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],l:q.low[i],c:q.close[i]});
    return b.length>60?b:null;}catch{return null;}}
// filtro recibe (ctx,i) y decide si la anticipación es válida
function trades(bars,filterFn){
  const cl=bars.map(b=>b.c),ef=ema(cl,FAST),es=ema(cl,SLOW),e5=ema(cl,5),out=[];
  const ctx={cl,ef,es,e5};
  let inPos=false,ei=0,stop=0;
  for(let i=SLOW+1;i<bars.length;i++){
    const gap=(ef[i]-es[i])/cl[i],gapPrev=(ef[i-1]-es[i-1])/cl[i-1];
    const bull=ef[i-1]<=es[i-1]&&ef[i]>es[i], bear=ef[i-1]>=es[i-1]&&ef[i]<es[i];
    const longImm=gap<0&&Math.abs(gap)<TH&&gap>gapPrev;
    if(!inPos&&longImm&&filterFn(ctx,i)){inPos=true;ei=i;stop=cl[i]*(1-CAT);continue;}
    if(inPos){
      let ret=null,exitI=null;
      if(bars[i].l<=stop){ret=(stop/cl[ei]-1)*100-COST*200;exitI=i;}
      else if(bear){ret=(cl[i]/cl[ei]-1)*100-COST*200;exitI=i;}
      if(ret!=null){let conf=false;for(let k=ei+1;k<=exitI;k++)if(ef[k-1]<=es[k-1]&&ef[k]>es[k]){conf=true;break;}
        out.push({ret,t:bars[ei].t,conf});inPos=false;}
    }
  }
  return out;
}
function stat(a){const rs=a.map(x=>x.ret),n=rs.length;if(!n)return{n:0,pf:0,mean:0,wr:0,sum:0,falsePct:0};
  const s=rs.reduce((x,y)=>x+y,0),w=rs.filter(x=>x>0),l=rs.filter(x=>x<=0),gl=l.reduce((x,y)=>x+y,0);
  return{n,sum:s,mean:s/n,wr:100*w.length/n,pf:gl?Math.abs(w.reduce((x,y)=>x+y,0)/gl):0,
    falsePct:100*a.filter(x=>!x.conf).length/n};}
(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8')).universe.slice(0,SAMPLE).map(u=>u.ticker);
  const FILTERS=[
    ['SIN filtro (actual)',       ()=>true],
    ['precio sube 2 sem',         (c,i)=>c.cl[i]>c.cl[i-2]],
    ['precio sube 4 sem',         (c,i)=>c.cl[i]>c.cl[i-4]],
    ['precio > EMA5',             (c,i)=>c.cl[i]>c.e5[i]],
    ['EMA8 sube 2 sem',           (c,i)=>c.ef[i]>c.ef[i-2]],
    ['sube 4s Y precio>EMA5',     (c,i)=>c.cl[i]>c.cl[i-4]&&c.cl[i]>c.e5[i]],
  ];
  const data=FILTERS.map(()=>[]); let done=0;
  for(const tk of uni){const b=await getW(tk);done++;if(done%50===0)process.stdout.write(`  …${done}\n`);await sleep(100);if(!b)continue;
    FILTERS.forEach(([,fn],k)=>{for(const t of trades(b,fn))data[k].push(t);});}
  const all=data.flat();const tmin=Math.min(...all.map(t=>t.t)),span=(Math.max(...all.map(t=>t.t))-tmin)/4;
  const wf=a=>[0,1,2,3].map(w=>stat(a.filter(t=>Math.min(3,Math.floor((t.t-tmin)/span))===w))).filter(x=>x.n>=5&&x.mean>0).length;
  console.log(`\n══ ANTICIPACIÓN + FILTRO DE MOMENTUM · ${uni.length} large-caps 10y ══\n`);
  console.log('  '+'filtro'.padEnd(24)+'n'.padStart(6)+'WR'.padStart(6)+'PF'.padStart(7)+'exp%'.padStart(8)+'%falsas'.padStart(9)+'  WF');
  console.log('  '+'─'.repeat(66));
  FILTERS.forEach(([name],k)=>{const s=stat(data[k]);
    console.log('  '+name.padEnd(24)+String(s.n).padStart(6)+(s.wr.toFixed(0)+'%').padStart(6)+s.pf.toFixed(2).padStart(7)+
      (('+'+s.mean.toFixed(2))).padStart(8)+(s.falsePct.toFixed(0)+'%').padStart(9)+`   ${wf(data[k])}/4`);});
  console.log('\n  Confirmado (referencia): PF 2.36. Un buen filtro sube PF Y baja %falsas SIN gutear la muestra.\n');
})();
