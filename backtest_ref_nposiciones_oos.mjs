/**
 * OOS ADVERSARIAL: parte los trades en DOS mitades por fecha de entrada (mediana temporal)
 * y recalcula la simulacion de cartera por N slots en CADA mitad.
 * Reusa el motor de backtest_ref_nposiciones.mjs.
 */
import fs from 'fs';
import { computeTDSetup } from '../scanner/demark_calc.mjs';

const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,GAP=0.012,L200=200,CONF=8;
const SAMPLE=120;
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i]});return b.length>220?b:null;}catch{return null;}}

function trades(tk,bars){
  const cl=bars.map(b=>b.c);const ef=ema(cl,8),es=ema(cl,21),e200=ema(cl,L200);
  const td=computeTDSetup(bars);const bull=td.bullSetup||td.bull||[];
  const out=[];let lastExit=-1;
  for(let i=Math.max(21,1);i<bars.length-1;i++){
    if(i<=lastExit)continue;
    const gap=(ef[i]-es[i])/cl[i], gp=(ef[i-1]-es[i-1])/cl[i-1];
    if(!(gap<0&&Math.abs(gap)<GAP&&gap>gp))continue;
    const entryIdx=i+1, entry=bars[entryIdx].c;
    let conf=false;for(let k=Math.max(0,i-CONF+1);k<=i;k++)if(bull[k]===9)conf=true;
    const below200=e200[i]!=null&&cl[i]<e200[i];
    let exitIdx=bars.length-1,exit=bars[exitIdx].c,reason='eod';
    for(let j=entryIdx+1;j<bars.length;j++){
      if(bars[j].l<=entry*(1-CAT)){exitIdx=j;exit=entry*(1-CAT);reason='stop';break;}
      if(ef[j-1]>=es[j-1]&&ef[j]<es[j]){exitIdx=j;exit=bars[j].c;reason='cross';break;}
    }
    const ret=(exit/entry-1)-2*COST;
    out.push({tk,entryIdx,exitIdx,tEntry:bars[entryIdx].t,tExit:bars[exitIdx].t,ret,conf,stack:conf&&below200,ext:(cl[i]-es[i])/es[i],reason});
    lastExit=exitIdx;
  }
  return out;
}

// Simulacion de cartera con N slots, restringida a un rango temporal [wLo,wHi]
function simulate(all, priceMap, weeks, N, filter){
  const sigs=all.filter(filter).sort((a,b)=>a.tEntry-b.tEntry||(a.tk<b.tk?-1:1));
  const byWeek=new Map();for(const s of sigs){if(!byWeek.has(s.tEntry))byWeek.set(s.tEntry,[]);byWeek.get(s.tEntry).push(s);}
  let cash=100000;const open=[];const curve=[];let taken=0,skipped=0;
  for(const w of weeks){
    for(let i=open.length-1;i>=0;i--){const p=open[i];if(p.tExit<=w){cash+=p.shares*p.exitPx;open.splice(i,1);}}
    let mtm=cash;for(const p of open){const px=priceMap.get(p.tk)?.get(w);mtm+=p.shares*(px??p.entryPx);}
    const cand=byWeek.get(w)||[];
    for(const s of cand){
      if(open.length>=N){skipped++;continue;}
      const size=Math.min(cash, mtm/N);
      if(size<mtm/N*0.5){skipped++;continue;}
      open.push({tk:s.tk,shares:size/s.entryPx,entryPx:s.entryPx,exitPx:s.exitPxEff,tExit:s.tExit});
      cash-=size;taken++;
    }
    let eq=cash;for(const p of open){const px=priceMap.get(p.tk)?.get(w);eq+=p.shares*(px??p.entryPx);}
    curve.push(eq);
  }
  let peak=0,dd=0;for(const v of curve){if(v>peak)peak=v;dd=Math.max(dd,(peak-v)/peak);}
  const fin=curve[curve.length-1];
  const yrs=(weeks[weeks.length-1]-weeks[0])/(365.25*24*3600);
  return {N,mult:fin/100000,cagr:(Math.pow(fin/100000,1/yrs)-1)*100,mdd:dd*100,taken,skipped,yrs};
}

(async()=>{
  const raw=JSON.parse(fs.readFileSync('/Users/danielcandelaria/tradingview-mcp-jackson/stocks/universe.json','utf8'));
  const uni=(Array.isArray(raw)?raw:raw.universe).map(x=>x.ticker||x).slice(0,SAMPLE);
  const all=[];const priceMap=new Map();const weekSet=new Set();
  for(const tk of uni){
    const b=await getW(tk);await sleep(110);
    if(!b)continue;
    const m=new Map();for(const bar of b){m.set(bar.t,bar.c);weekSet.add(bar.t);}
    priceMap.set(tk,m);
    for(const t of trades(tk,b)){
      t.entryPx=b[t.entryIdx].c;
      t.exitPxEff=t.entryPx*(1+t.ret);
      all.push(t);
    }
  }
  const weeks=[...weekSet].sort((a,b)=>a-b);

  // Particion OOS: mediana temporal de las fechas de entrada del tier BASE
  const tiers={base:t=>true, confluencia:t=>t.conf, stack:t=>t.stack};
  const Ns=[3,5,6,8,10,15,25];

  for(const [name,f] of Object.entries(tiers)){
    const sel=all.filter(f).slice().sort((a,b)=>a.tEntry-b.tEntry);
    const nAll=sel.length;
    const medT=sel[Math.floor(nAll/2)].tEntry;
    const h1=sel.filter(t=>t.tEntry<medT), h2=sel.filter(t=>t.tEntry>=medT);
    // ventanas de semanas por mitad (para el mark-to-market de cada sim)
    const wksH1=weeks.filter(w=>w<medT);
    const wksH2=weeks.filter(w=>w>=medT);
    const dISO=ts=>new Date(ts*1000).toISOString().slice(0,10);
    console.log(`\n########## ${name.toUpperCase()} ##########`);
    console.log(`n total=${nAll} | corte mediana=${dISO(medT)} | H1 n=${h1.length} (${wksH1.length}wk) | H2 n=${h2.length} (${wksH2.length}wk)`);
    for(const [lbl,hh,wk] of [['H1(antigua)',h1,wksH1],['H2(reciente)',h2,wksH2]]){
      console.log(`\n--- ${name} ${lbl}  n=${hh.length} ---`);
      console.log('N\tmult\tCAGR%\tmaxDD%\ttomados\tperdidos');
      for(const N of Ns){
        const r=simulate(hh,priceMap,wk,N,()=>true);
        console.log(`${N}\t${r.mult.toFixed(2)}x\t${r.cagr.toFixed(1)}\t${r.mdd.toFixed(1)}\t${r.taken}\t${r.skipped}`);
      }
    }
  }
})();
