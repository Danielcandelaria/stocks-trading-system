#!/usr/bin/env node
// ¿Filtrar por FRESCURA (extensión sobre EMA21 en la entrada) mejora EMACross?
// Sistema: LONG, cruce confirmado, stop -18%, salida cruce contrario. Compara umbrales de extensión.
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,FAST=8,SLOW=21,CAT=0.18,SAMPLE=+(process.argv[2]||250);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
import {readFileSync} from 'fs';import {fileURLToPath} from 'url';import {dirname,join} from 'path';
const ROOT=dirname(fileURLToPath(import.meta.url));
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});
  if(!r.ok)return null;const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp||!q)return null;const b=[];
  for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i]});
  return b.length>60?b:null;}catch{return null;}}
function trades(bars){const cl=bars.map(b=>b.c),ef=ema(cl,FAST),es=ema(cl,SLOW),out=[];let inPos=false,ei=0,stop=0,extEntry=0;
  for(let i=SLOW+1;i<bars.length;i++){const bull=ef[i-1]<=es[i-1]&&ef[i]>es[i],bear=ef[i-1]>=es[i-1]&&ef[i]<es[i];
    if(!inPos&&bull){inPos=true;ei=i;stop=cl[i]*(1-CAT);extEntry=(cl[i]/es[i]-1)*100;continue;}
    if(inPos){if(bars[i].l<=stop){out.push({ret:(stop/cl[ei]-1)*100-COST*200,t:bars[ei].t,ext:extEntry});inPos=false;}
      else if(bear){out.push({ret:(cl[i]/cl[ei]-1)*100-COST*200,t:bars[ei].t,ext:extEntry});inPos=false;}}}
  return out;}
function stat(rs){const n=rs.length;if(!n)return{n:0};const s=rs.reduce((a,b)=>a+b,0),w=rs.filter(x=>x>0),l=rs.filter(x=>x<=0),gl=l.reduce((a,b)=>a+b,0);
  return{n,sum:s,mean:s/n,wr:100*w.length/n,pf:gl?Math.abs(w.reduce((a,b)=>a+b,0)/gl):0};}
(async()=>{const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8'));const tickers=(uni.universe||uni).slice(0,SAMPLE).map(u=>u.ticker);
  console.log(`\n══ EMACross — filtro de FRESCURA (extensión sobre EMA21 en la entrada) · ${tickers.length}t 10y ══\n`);
  const all=[];let done=0;for(const tk of tickers){const b=await getW(tk);done++;if(done%50===0)process.stdout.write(`  …${done}\n`);await sleep(110);if(!b)continue;for(const t of trades(b))all.push(t);}
  const tmin=Math.min(...all.map(t=>t.t)),tmax=Math.max(...all.map(t=>t.t)),span=(tmax-tmin)/4;
  const wfOf=T=>{const wf=[0,1,2,3].map(wi=>stat(T.filter(t=>Math.min(3,Math.floor((t.t-tmin)/span))===wi).map(t=>t.ret)));return wf.filter(w=>w.n>=5&&w.mean>0).length;};
  console.log('  '+'filtro'.padEnd(18)+'n'.padStart(6)+'WR'.padStart(6)+'PF'.padStart(7)+'exp%/tr'.padStart(9)+'Σret%'.padStart(10)+'  WF');
  console.log('  '+'─'.repeat(60));
  for(const [name,fn] of [['TODOS',()=>true],['ext < 8%',t=>t.ext<8],['ext < 5%',t=>t.ext<5],['ext < 3%',t=>t.ext<3],['ext < 2%',t=>t.ext<2]]){
    const T=all.filter(fn);const s=stat(T.map(t=>t.ret));
    console.log('  '+name.padEnd(18)+String(s.n).padStart(6)+(s.wr.toFixed(0)+'%').padStart(6)+s.pf.toFixed(2).padStart(7)+((s.mean>=0?'+':'')+s.mean.toFixed(2)).padStart(9)+((s.sum>=0?'+':'')+s.sum.toFixed(0)).padStart(10)+`   ${wfOf(T)}/4`);}
  console.log('');})();
