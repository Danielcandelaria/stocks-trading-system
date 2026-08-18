#!/usr/bin/env node
// backtest_ranking.mjs — con capital limitado, ¿QUÉ señales elegir? ¿Hay una métrica que
// prediga las ganadoras? Ranquea TODAS las entradas EMACross por varias métricas, las parte
// en TERCIOS (bajo/medio/alto) y compara PF/expectancy. Si un tercio bate claramente, esa es
// la regla de selección. Long-only, stop -18%, salida cruce. 250 large-caps 10y.
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const UA={'User-Agent':'Mozilla/5.0'}; const COST=0.0006, FAST=8, SLOW=21, CAT=0.18, SAMPLE=+(process.argv[2]||250);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=dirname(fileURLToPath(import.meta.url));
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');
  try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});
    if(!r.ok)return null;const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];
    if(!d?.timestamp||!q)return null;const b=[];
    for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],l:q.low[i],c:q.close[i]});
    return b.length>60?b:null;}catch{return null;}}
function trades(bars){
  const cl=bars.map(b=>b.c),ef=ema(cl,FAST),es=ema(cl,SLOW),out=[];
  let inPos=false,ei=0,stop=0;
  for(let i=SLOW+1;i<bars.length;i++){
    const bull=ef[i-1]<=es[i-1]&&ef[i]>es[i], bear=ef[i-1]>=es[i-1]&&ef[i]<es[i];
    if(!inPos&&bull){inPos=true;ei=i;stop=cl[i]*(1-CAT);
      // métricas EN LA ENTRADA
      out.push({ret:null,t:bars[ei].t,
        mom12:i>=12?(cl[i]/cl[i-12]-1)*100:null,
        mom26:i>=26?(cl[i]/cl[i-26]-1)*100:null,
        ext:(cl[i]/es[i]-1)*100,
        _open:out.length});
      continue;}
    if(inPos){let ret=null;
      if(bars[i].l<=stop)ret=(stop/cl[ei]-1)*100-COST*200;
      else if(bear)ret=(cl[i]/cl[ei]-1)*100-COST*200;
      if(ret!=null){out[out.length-1].ret=ret;inPos=false;}}
  }
  return out.filter(t=>t.ret!=null);
}
function stat(a){const rs=a.map(x=>x.ret),n=rs.length;if(!n)return{n:0,pf:0,mean:0,wr:0};
  const w=rs.filter(x=>x>0),l=rs.filter(x=>x<=0),gl=l.reduce((x,y)=>x+y,0);
  return{n,mean:rs.reduce((x,y)=>x+y,0)/n,wr:100*w.length/n,pf:gl?Math.abs(w.reduce((x,y)=>x+y,0)/gl):0};}
(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8')).universe.slice(0,SAMPLE).map(u=>u.ticker);
  const all=[]; let done=0;
  for(const tk of uni){const b=await getW(tk);done++;if(done%50===0)process.stdout.write(`  …${done}\n`);await sleep(100);if(!b)continue;
    for(const t of trades(b))all.push(t);}
  console.log(`\n══ SELECCIÓN CON CAPITAL LIMITADO — ¿qué predice las ganadoras? · ${all.length} entradas ══\n`);
  const terciles=(metric,name)=>{
    const v=all.filter(t=>t[metric]!=null).sort((a,b)=>a[metric]-b[metric]);
    const n=v.length,a=v.slice(0,Math.floor(n/3)),m=v.slice(Math.floor(n/3),Math.floor(2*n/3)),h=v.slice(Math.floor(2*n/3));
    console.log(`  ── ranquear por ${name} ──`);
    [['TERCIO BAJO',a],['TERCIO MEDIO',m],['TERCIO ALTO',h]].forEach(([lab,g])=>{const s=stat(g);
      console.log('    '+lab.padEnd(14)+'n '+String(s.n).padStart(4)+' · PF '+s.pf.toFixed(2)+' · exp '+(s.mean>=0?'+':'')+s.mean.toFixed(2)+'% · WR '+s.wr.toFixed(0)+'%');});
    console.log('');
  };
  terciles('mom12','MOMENTUM 12 semanas (subida 3 meses)');
  terciles('mom26','MOMENTUM 26 semanas (subida 6 meses)');
  terciles('ext','EXTENSIÓN sobre EMA21 (recorrido ya hecho)');
})();
