#!/usr/bin/env node
// OOS por régimen: parte trades por mediana temporal de fecha de entrada (H1 antigua / H2 reciente)
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup } from '../scanner/demark_calc.mjs';
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,TIME_W=52,SAMPLE=120;
const STOPS=[0.12,0.15,0.18,0.22,0.25,0.30];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=dirname(fileURLToPath(import.meta.url));
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i]});return b.length>120?b:null;}catch{return null;}}
function trades(bars,cat){
  const td=computeTDSetup(bars), out=[];
  let i=0;
  while(i<bars.length-1){
    if(td.bullSetup[i]!==9){ i++; continue; }
    const entryPx=bars[i].c, stop=entryPx*(1-cat);
    let ret=null, exitJ=bars.length-1;
    for(let j=i+1;j<bars.length;j++){
      if(bars[j].l<=stop){ ret=(stop/entryPx-1)*100-COST*200; exitJ=j; break; }
      if(td.bearSetup[j]===9){ ret=(bars[j].c/entryPx-1)*100-COST*200; exitJ=j; break; }
      if(j-i>=TIME_W){ ret=(bars[j].c/entryPx-1)*100-COST*200; exitJ=j; break; }
    }
    if(ret==null) ret=(bars[bars.length-1].c/entryPx-1)*100-COST*200;
    out.push({r:ret,t:bars[i].t});
    i=exitJ+1;
  }
  return out;
}
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const st=a=>{const rs=a.map(x=>x.r),n=rs.length;if(!n)return{n:0,pf:0,med:0,m:0,wr:0};const w=rs.filter(x=>x>0),l=rs.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return{n,pf:gl?Math.abs(gw/gl):99,med:median(rs),m:rs.reduce((x,y)=>x+y,0)/n,wr:100*w.length/n};};
function trimTop(a,pct){const rs=[...a.map(x=>x.r)].sort((x,y)=>y-x);const cut=Math.floor(rs.length*pct);const kept=rs.slice(cut);const w=kept.filter(x=>x>0),l=kept.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return kept.length&&gl?Math.abs(gw/gl):99;}

(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8'));const tks=(uni.universe||uni).slice(0,SAMPLE).map(u=>u.ticker);
  const allBars=[];let done=0,ok=0;
  for(const t of tks){const b=await getW(t);done++;if(done%40===0)process.stdout.write(`  …${done}/${tks.length}\n`);await sleep(110);if(!b)continue;ok++;allBars.push(b);}
  console.log(`\n════ OOS POR RÉGIMEN · ${ok} acciones · corte por mediana temporal de entrada ════\n`);
  // build all trades per stop, then split by global median timestamp of that stop's trades
  const rows=[];
  for(const cat of STOPS){
    const acc=[];for(const b of allBars) acc.push(...trades(b,cat));
    const times=acc.map(x=>x.t).sort((a,b)=>a-b);
    const cut=median(times);
    const H1=acc.filter(x=>x.t<cut), H2=acc.filter(x=>x.t>=cut);
    const s1=st(H1),s2=st(H2),t51=trimTop(H1,0.05),t52=trimTop(H2,0.05);
    rows.push({cat,cut,s1,s2,t51,t52});
    const mark=cat===0.18?' ◄ actual':'';
    const cutD=new Date(cut*1000).toISOString().slice(0,10);
    console.log(`── STOP -${(cat*100).toFixed(0)}%${mark}  (corte ${cutD}) ──`);
    console.log(`   H1 antigua : n=${s1.n} PF=${s1.pf.toFixed(2)} med=${(s1.med>=0?'+':'')+s1.med.toFixed(1)}% PF5=${t51.toFixed(2)} WR=${s1.wr.toFixed(0)}%`);
    console.log(`   H2 reciente: n=${s2.n} PF=${s2.pf.toFixed(2)} med=${(s2.med>=0?'+':'')+s2.med.toFixed(1)}% PF5=${t52.toFixed(2)} WR=${s2.wr.toFixed(0)}%\n`);
  }
  console.log('JSON:'+JSON.stringify(rows.map(r=>({stop:r.cat,H1:{n:r.s1.n,pf:+r.s1.pf.toFixed(2),med:+r.s1.med.toFixed(1),pf5:+r.t51.toFixed(2),wr:+r.s1.wr.toFixed(0)},H2:{n:r.s2.n,pf:+r.s2.pf.toFixed(2),med:+r.s2.med.toFixed(1),pf5:+r.t52.toFixed(2),wr:+r.s2.wr.toFixed(0)}}))));
})();
