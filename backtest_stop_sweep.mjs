#!/usr/bin/env node
// backtest_stop_sweep.mjs — ¿está bien calibrado el stop de catástrofe −18%?
// Barrido de niveles de stop en EMACross (LONG, salida cruce contrario), 250 large-caps 10y.
// Mide PF, expectancy, % de trades que mueren por stop, peor trade y drawdown de la curva.
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const UA={'User-Agent':'Mozilla/5.0'}; const COST=0.0006, FAST=8, SLOW=21, SAMPLE=+(process.argv[2]||250);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=dirname(fileURLToPath(import.meta.url));
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');
  try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});
    if(!r.ok)return null;const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];
    if(!d?.timestamp||!q)return null;const b=[];
    for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],l:q.low[i],c:q.close[i]});
    return b.length>60?b:null;}catch{return null;}}
function trades(bars,CAT){const cl=bars.map(b=>b.c),ef=ema(cl,FAST),es=ema(cl,SLOW),out=[];
  let inPos=false,ei=0,stop=0;
  for(let i=SLOW+1;i<bars.length;i++){const bull=ef[i-1]<=es[i-1]&&ef[i]>es[i],bear=ef[i-1]>=es[i-1]&&ef[i]<es[i];
    if(!inPos&&bull){inPos=true;ei=i;stop=CAT?cl[i]*(1-CAT):-Infinity;continue;}
    if(inPos){ if(CAT&&bars[i].l<=stop){out.push({ret:(stop/cl[ei]-1)*100-COST*200,t:bars[ei].t,why:'stop'});inPos=false;}
      else if(bear){out.push({ret:(cl[i]/cl[ei]-1)*100-COST*200,t:bars[ei].t,why:'cruce'});inPos=false;} } }
  return out;}
function stat(a){const rs=a.map(x=>x.ret),n=rs.length;if(!n)return{n:0};
  const s=rs.reduce((x,y)=>x+y,0),w=rs.filter(x=>x>0),l=rs.filter(x=>x<=0),gl=l.reduce((x,y)=>x+y,0);
  const sorted=[...a].sort((x,y)=>x.t-y.t);let eq=0,peak=0,dd=0;
  for(const t of sorted){eq+=t.ret;peak=Math.max(peak,eq);dd=Math.min(dd,eq-peak);}
  return{n,sum:s,mean:s/n,wr:100*w.length/n,pf:gl?Math.abs(w.reduce((x,y)=>x+y,0)/gl):0,
    worst:Math.min(...rs),byStop:100*a.filter(x=>x.why==='stop').length/n,dd};}
(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8')).universe.slice(0,SAMPLE).map(u=>u.ticker);
  const LEVELS=[null,0.10,0.12,0.15,0.18,0.20,0.25,0.30];
  const data={};LEVELS.forEach(L=>data[String(L)]=[]);
  let done=0;
  for(const tk of uni){const b=await getW(tk);done++;if(done%50===0)process.stdout.write(`  …${done}\n`);await sleep(100);if(!b)continue;
    for(const L of LEVELS) for(const t of trades(b,L)) data[String(L)].push(t);}
  console.log(`\n══ CALIBRACIÓN DEL STOP — EMACross LONG · ${uni.length} large-caps 10y ══\n`);
  console.log('  '+'stop'.padEnd(12)+'n'.padStart(6)+'WR'.padStart(6)+'PF'.padStart(7)+'exp%'.padStart(8)+'Σret%'.padStart(10)+'peor'.padStart(8)+'%porStop'.padStart(10)+'maxDD'.padStart(9));
  console.log('  '+'─'.repeat(76));
  for(const L of LEVELS){const s=stat(data[String(L)]);
    console.log('  '+(L?`−${(L*100).toFixed(0)}%`:'SIN stop').padEnd(12)+String(s.n).padStart(6)+(s.wr.toFixed(0)+'%').padStart(6)+
      s.pf.toFixed(2).padStart(7)+(('+'+s.mean.toFixed(2))).padStart(8)+(('+'+s.sum.toFixed(0))).padStart(10)+
      (s.worst.toFixed(0)+'%').padStart(8)+(s.byStop.toFixed(0)+'%').padStart(10)+(s.dd.toFixed(0)+'%').padStart(9));}
  console.log('');
})();
