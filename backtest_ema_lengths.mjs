#!/usr/bin/env node
// backtest_ema_lengths.mjs — ¿es 8/21 la mejor pareja EMA? Sweep de longitudes, OOS por régimen.
//   El clásico botón de overfit. Se prueba varias parejas; solo vale si BATE a 8/21 en AMBAS mitades.
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,GAP=0.012,L200=200;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=dirname(fileURLToPath(import.meta.url));
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i]});return b.length>220?b:null;}catch{return null;}}
function trades(bars,F,S){const cl=bars.map(b=>b.c),ef=ema(cl,F),es=ema(cl,S),out=[];let i=L200+1;
  while(i<bars.length-1){const gap=(ef[i]-es[i])/cl[i],gp=(ef[i-1]-es[i-1])/cl[i-1];const li=gap<0&&Math.abs(gap)<GAP&&gap>gp;
    if(!li){i++;continue;}const ep=cl[i],stop=ep*(1-CAT);let ret=null,ej=bars.length-1;
    for(let j=i+1;j<bars.length;j++){const bear=ef[j-1]>=es[j-1]&&ef[j]<es[j];if(bars[j].l<=stop){ret=(stop/ep-1)*100-COST*200;ej=j;break;}if(bear){ret=(cl[j]/ep-1)*100-COST*200;ej=j;break;}}
    if(ret==null)ret=(cl[cl.length-1]/ep-1)*100-COST*200;out.push({r:ret,t:bars[i].t});i=ej+1;}
  return out;}
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const st=a=>{const rs=a.map(x=>x.r),n=rs.length;if(!n)return{n:0,pf:0,med:0};const w=rs.filter(x=>x>0),l=rs.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return{n,pf:gl?Math.abs(gw/gl):99,med:median(rs)};};
function trimTop(a,p){const rs=[...a.map(x=>x.r)].sort((x,y)=>y-x);const kept=rs.slice(Math.floor(rs.length*p));if(!kept.length)return 0;const w=kept.filter(x=>x>0),l=kept.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return gl?Math.abs(gw/gl):99;}

(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8'));const tks=(uni.universe||uni).slice(0,250).map(u=>u.ticker);
  console.log('\n════ Sweep longitudes EMA — OOS por régimen (10y, stop -18%) ════\n');
  const PAIRS=[[5,20],[8,21],[10,30],[12,26],[13,34],[9,26],[8,34]];const acc=PAIRS.map(()=>[]);let ok=0;
  for(const t of tks){const b=await getW(t);await sleep(110);if(!b)continue;ok++;PAIRS.forEach((p,k)=>acc[k].push(...trades(b,p[0],p[1])));}
  const allT=acc[1].map(x=>x.t).sort((a,b)=>a-b);const mid=allT[Math.floor(allT.length/2)];
  console.log(`  ${ok} acciones\n`);
  console.log('  pareja    FULL PF/med/sin5%     H1 2016-21 PF/med    H2 2021-26 PF/med');
  PAIRS.forEach((p,k)=>{const a=acc[k],T=st(a),t5=trimTop(a,0.05);const H1=st(a.filter(x=>x.t<mid)),H2=st(a.filter(x=>x.t>=mid));
    const cur=(p[0]===8&&p[1]===21)?' ← ACTUAL':'';
    console.log(`  ${(p[0]+'/'+p[1]).padEnd(8)} PF ${T.pf.toFixed(2)} med ${T.med>=0?'+':''}${T.med.toFixed(1)}% s5 ${t5.toFixed(2)} n${T.n} | ${H1.pf.toFixed(2)}/${H1.med>=0?'+':''}${H1.med.toFixed(1)}% | ${H2.pf.toFixed(2)}/${H2.med>=0?'+':''}${H2.med.toFixed(1)}%${cur}`);});
  console.log('\n  Solo cambiar si otra pareja bate a 8/21 en AMBAS mitades Y en robustez. Si no, 8/21 se queda.\n');
})();
