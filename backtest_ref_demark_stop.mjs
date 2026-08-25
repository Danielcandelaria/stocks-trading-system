#!/usr/bin/env node
// backtest_ref_demark_stop.mjs — REFINAMIENTO: ¿-18% es el stop óptimo del motor DeMark WeeklySwing?
//   Motor: entrada bullSetup==9, salida = bearSetup==9 opuesto o 52 semanas o stop -X% de precio. Long-only.
//   Barre stop en -12/-15/-18/-22/-25/-30%. Una posición a la vez por acción.
//   Métrica: n, PF, mediana(%), PF-sin-top5%, WF(4 ventanas). SAMPLE=120 large-caps, 10y semanal.
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
const st=a=>{const rs=a.map(x=>x.r),n=rs.length;if(!n)return{n:0,pf:0,med:0,m:0};const w=rs.filter(x=>x>0),l=rs.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return{n,pf:gl?Math.abs(gw/gl):99,med:median(rs),m:rs.reduce((x,y)=>x+y,0)/n,wr:100*w.length/n};};
function trimTop(a,pct){const rs=[...a.map(x=>x.r)].sort((x,y)=>y-x);const cut=Math.floor(rs.length*pct);const kept=rs.slice(cut);const w=kept.filter(x=>x>0),l=kept.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return kept.length&&gl?Math.abs(gw/gl):99;}
const wf=a=>{if(a.length<8)return'—';const t0=Math.min(...a.map(x=>x.t)),t1=Math.max(...a.map(x=>x.t)),sp=(t1-t0)/4;return[0,1,2,3].map(k=>st(a.filter(x=>Math.min(3,Math.floor((x.t-t0)/sp))===k))).filter(x=>x.n>=5&&x.m>0).length;};

(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8'));const tks=(uni.universe||uni).slice(0,SAMPLE).map(u=>u.ticker);
  const allBars=[];let done=0,ok=0;
  for(const t of tks){const b=await getW(t);done++;if(done%40===0)process.stdout.write(`  …${done}/${tks.length}\n`);await sleep(110);if(!b)continue;ok++;allBars.push(b);}
  console.log(`\n════ REFINAMIENTO STOP · DeMark WeeklySwing · ${ok} acciones · 10y semanal ════\n`);
  console.log(' stop │   n │  PF  │ mediana │ PF-sin5% │  WR  │  WF   ');
  console.log('──────┼─────┼──────┼─────────┼──────────┼──────┼───────');
  const rows=[];
  for(const cat of STOPS){
    const acc=[];for(const b of allBars) acc.push(...trades(b,cat));
    const s=st(acc),t5=trimTop(acc,0.05),w=wf(acc);
    rows.push({cat,s,t5,w});
    const mark=cat===0.18?' ◄ actual':'';
    console.log(` -${(cat*100).toFixed(0).padStart(2)}% │ ${String(s.n).padStart(3)} │ ${s.pf.toFixed(2)} │ ${(s.med>=0?'+':'')+s.med.toFixed(1)+'%'} │  ${t5.toFixed(2).padStart(5)}  │ ${s.wr.toFixed(0)}% │  ${w}/4${mark}`);
  }
  console.log('\nJSON:'+JSON.stringify(rows.map(r=>({stop:r.cat,n:r.s.n,pf:+r.s.pf.toFixed(2),med:+r.s.med.toFixed(1),pf5:+r.t5.toFixed(2),wr:+r.s.wr.toFixed(0),wf:r.w}))));
})();
