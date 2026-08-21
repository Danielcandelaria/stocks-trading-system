#!/usr/bin/env node
// backtest_volume.mjs — ¿AYUDA el VOLUMEN? Filtros de volumen en la señal, validados OOS por régimen.
//   Variantes sobre EMA anticipado (stop -18%, salida cruce): sin filtro · vol>media20 · vol>media10
//   · vol creciente · vol<media (contrarian). Se mide por mitad temporal para no fiarse del full-sample.
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,GAP=0.012,L200=200;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=dirname(fileURLToPath(import.meta.url));
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i],v:q.volume?.[i]??null});return b.length>220?b:null;}catch{return null;}}
const avg=(a,i,n)=>{let s=0,c=0;for(let k=Math.max(0,i-n+1);k<=i;k++){if(a[k]!=null){s+=a[k];c++;}}return c?s/c:null;};
// filt: 'none'|'v20'|'v10'|'vrise'|'vlow'
function trades(bars,filt){const cl=bars.map(b=>b.c),vol=bars.map(b=>b.v),ef=ema(cl,8),es=ema(cl,21),out=[];let i=L200+1;
  while(i<bars.length-1){const gap=(ef[i]-es[i])/cl[i],gp=(ef[i-1]-es[i-1])/cl[i-1];const li=gap<0&&Math.abs(gap)<GAP&&gap>gp;
    if(!li){i++;continue;}
    const v=vol[i],a20=avg(vol,i,20),a10=avg(vol,i,10);
    let pass=true;
    if(v==null||a20==null){pass=(filt==='none');}
    else if(filt==='v20')pass=v>a20; else if(filt==='v10')pass=v>a10;
    else if(filt==='vrise')pass=vol[i-1]!=null&&v>vol[i-1]; else if(filt==='vlow')pass=v<a20;
    if(!pass){i++;continue;}
    const ep=cl[i],stop=ep*(1-CAT);let ret=null,ej=bars.length-1;
    for(let j=i+1;j<bars.length;j++){const bear=ef[j-1]>=es[j-1]&&ef[j]<es[j];if(bars[j].l<=stop){ret=(stop/ep-1)*100-COST*200;ej=j;break;}if(bear){ret=(cl[j]/ep-1)*100-COST*200;ej=j;break;}}
    if(ret==null)ret=(cl[cl.length-1]/ep-1)*100-COST*200;out.push({r:ret,t:bars[i].t});i=ej+1;}
  return out;}
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const st=a=>{const rs=a.map(x=>x.r),n=rs.length;if(!n)return{n:0,pf:0,m:0,med:0};const w=rs.filter(x=>x>0),l=rs.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return{n,pf:gl?Math.abs(gw/gl):99,m:rs.reduce((x,y)=>x+y,0)/n,med:median(rs)};};
function trimTop(a,p){const rs=[...a.map(x=>x.r)].sort((x,y)=>y-x);const kept=rs.slice(Math.floor(rs.length*p));if(!kept.length)return 0;const w=kept.filter(x=>x>0),l=kept.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return gl?Math.abs(gw/gl):99;}

(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8'));const tks=(uni.universe||uni).slice(0,250).map(u=>u.ticker);
  console.log('\n════ ¿AYUDA EL VOLUMEN? — filtros en la señal, OOS por régimen (10y, stop -18%) ════\n');
  const F=['none','v20','v10','vrise','vlow'];const acc={};F.forEach(f=>acc[f]=[]);let ok=0;
  for(const t of tks){const b=await getW(t);await sleep(110);if(!b)continue;ok++;F.forEach(f=>acc[f].push(...trades(b,f)));}
  const allT=acc.none.map(x=>x.t).sort((a,b)=>a-b);const mid=allT[Math.floor(allT.length/2)];
  console.log(`  ${ok} acciones\n`);
  const lbl={none:'SIN filtro (base)',v20:'vol > media 20s',v10:'vol > media 10s',vrise:'vol creciente',vlow:'vol BAJO (contrarian)'};
  console.log('  filtro                 FULL PF/med/sin5%   H1 2016-21 PF/med   H2 2021-26 PF/med');
  for(const f of F){const T=st(acc[f]),t5=trimTop(acc[f],0.05);
    const H1=st(acc[f].filter(x=>x.t<mid)),H2=st(acc[f].filter(x=>x.t>=mid));
    console.log(`  ${lbl[f].padEnd(22)} PF ${T.pf.toFixed(2)} med ${T.med>=0?'+':''}${T.med.toFixed(1)}% s5 ${t5.toFixed(2)} n${T.n} | ${H1.pf.toFixed(2)}/${H1.med>=0?'+':''}${H1.med.toFixed(1)}% | ${H2.pf.toFixed(2)}/${H2.med>=0?'+':''}${H2.med.toFixed(1)}%`);}
  console.log('\n  Clave: ¿algún filtro BATE al "sin filtro" en AMBAS mitades? Si no, no aporta (solo recorta muestra).\n');
})();
