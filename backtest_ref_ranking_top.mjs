// Refinamiento: ranking por EXTENSIÓN sobre EMA21 -> ¿tomar solo TOP-N por semana mejora?
// NO toca el sistema vivo. Solo lectura de universe.json + Yahoo.
import fs from 'fs';
import { computeTDSetup } from '../scanner/demark_calc.mjs';

const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,GAP=0.012,L200=200,CONF=8;
const SAMPLE=120;
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i],o:q.open?.[i]??null});return b.length>220?b:null;}catch{return null;}}

function backtestTicker(tk,bars){
  const cl=bars.map(b=>b.c);
  const ef=ema(cl,8),es=ema(cl,21),e200=ema(cl,L200);
  const td=computeTDSetup(bars);
  const out=[];
  for(let i=L200;i<bars.length-1;i++){
    const gap=(ef[i]-es[i])/cl[i], gapPrev=(ef[i-1]-es[i-1])/cl[i-1];
    if(!(gap<0 && Math.abs(gap)<GAP && gap>gapPrev)) continue;
    // confluencia: DeMark bullSetup==9 en las <=CONF velas previas (incl. i)
    let conf=false;
    for(let k=i-CONF;k<=i;k++) if(k>=0 && td.bullSetup[k]===9){conf=true;break;}
    const entry=bars[i+1].o ?? cl[i];
    const ext=(cl[i]-es[i])/es[i];               // extensión sobre EMA21
    const below200=cl[i]<e200[i];
    let exitP=null,exitI=null,reason='open';
    for(let j=i+1;j<bars.length;j++){
      if(bars[j].l<=entry*(1-CAT)){exitP=entry*(1-CAT);exitI=j;reason='stop';break;}
      if(ef[j-1]>=es[j-1] && ef[j]<es[j]){exitP=bars[j].c;exitI=j;reason='cross';break;}
    }
    if(exitP===null){exitP=cl[cl.length-1];exitI=bars.length-1;reason='open';}
    const ret=(exitP/entry-1)-COST*2;
    out.push({tk,week:bars[i+1].t,ret,ext,conf,below200,reason,bars:exitI-i});
  }
  return out;
}

function metrics(tr){
  if(!tr.length) return {n:0};
  const r=tr.map(t=>t.ret);
  const pf=(a)=>{const g=a.filter(x=>x>0).reduce((s,x)=>s+x,0),l=-a.filter(x=>x<0).reduce((s,x)=>s+x,0);return l>0?g/l:Infinity;};
  const sorted=[...r].sort((a,b)=>a-b);
  const med=sorted[Math.floor(sorted.length/2)];
  const cut=Math.max(1,Math.round(r.length*0.05));
  const noTop=[...r].sort((a,b)=>b-a).slice(cut);
  const wr=r.filter(x=>x>0).length/r.length;
  return {n:r.length,pf:pf(r),med:med*100,noTop:pf(noTop),wr:wr*100,avg:r.reduce((s,x)=>s+x,0)/r.length*100};
}
function wf(tr){
  if(!tr.length) return '0/4';
  const ts=tr.map(t=>t.week).sort((a,b)=>a-b);
  const lo=ts[0],hi=ts[ts.length-1],step=(hi-lo)/4;
  let ok=0;
  for(let w=0;w<4;w++){
    const sub=tr.filter(t=>t.week>=lo+w*step&&t.week<lo+(w+1)*step+(w===3?1:0));
    if(sub.length>=5 && sub.reduce((s,t)=>s+t.ret,0)/sub.length>0) ok++;
  }
  return `${ok}/4`;
}
function topN(tr,N){
  const byWeek=new Map();
  for(const t of tr){if(!byWeek.has(t.week))byWeek.set(t.week,[]);byWeek.get(t.week).push(t);}
  const out=[];
  for(const [,arr] of byWeek){arr.sort((a,b)=>b.ext-a.ext);out.push(...arr.slice(0,N));}
  return out;
}
function row(label,tr){const m=metrics(tr);return `${label.padEnd(28)} n=${String(m.n).padStart(5)}  PF=${(m.pf).toFixed(2).padStart(6)}  med=${m.med.toFixed(2).padStart(6)}%  sinTop5=${m.noTop.toFixed(2).padStart(6)}  WR=${m.wr.toFixed(1)}%  avg=${m.avg.toFixed(2)}%  WF=${wf(tr)}`;}

(async()=>{
  const raw=JSON.parse(fs.readFileSync(new URL('./universe.json',import.meta.url)));
  const uni=(Array.isArray(raw)?raw:raw.universe).slice(0,SAMPLE);
  let all=[];
  for(const u of uni){
    const b=await getW(u.ticker);
    if(b) all=all.concat(backtestTicker(u.ticker,b));
    await sleep(110);
  }
  all.sort((a,b)=>a.week-b.week);
  const conf=all.filter(t=>t.conf);
  const stack=conf.filter(t=>t.below200);
  const Ns=[null,5,3,1];
  const blocks=[['EMA anticipado (todas)',all],['CONFLUENCIA',conf],['STACK',stack]];
  console.log('=== SEÑALES POR SEMANA (media) ===');
  for(const [lab,set] of blocks){const w=new Set(set.map(t=>t.week));console.log(`${lab}: ${set.length} trades / ${w.size} semanas = ${(set.length/(w.size||1)).toFixed(2)} sig/sem`);}
  for(const [lab,set] of blocks){
    console.log(`\n=== ${lab} ===`);
    for(const N of Ns) console.log(row(N===null?'todas':`TOP-${N}/semana`, N===null?set:topN(set,N)));
    // control: aleatorio-equivalente = peor-N (bottom by ext) para ver si es ranking o solo submuestreo
    const byWeek=new Map();for(const t of set){if(!byWeek.has(t.week))byWeek.set(t.week,[]);byWeek.get(t.week).push(t);}
    const bot=[];for(const[,a] of byWeek){a.sort((x,y)=>x.ext-y.ext);bot.push(...a.slice(0,3));}
    console.log(row('BOTTOM-3/semana (control)',bot));
  }

  // ===== OOS POR REGIMEN: dos mitades por fecha de entrada (mediana temporal) =====
  // Corta por la mediana de week; H1=mitad antigua, H2=mitad reciente.
  console.log('\n\n############ OOS POR REGIMEN (H1 antigua / H2 reciente) ############');
  const splitHalf=(tr)=>{
    const s=[...tr].sort((a,b)=>a.week-b.week);
    const mid=Math.floor(s.length/2);
    const cut=s[mid].week;
    return [s.filter(t=>t.week<cut), s.filter(t=>t.week>=cut)];
  };
  // Para cada bloque, comparamos la config CANDIDATA (TOP-N) vs CONTROL (todas) en cada mitad.
  const oosCfgs=[
    ['EMA anticipado', all, [['todas',null],['TOP-3',3],['TOP-1',1]]],
    ['CONFLUENCIA',    conf, [['todas',null],['TOP-3',3],['TOP-1',1]]],
    ['STACK',          stack,[['todas',null],['TOP-3',3]]],
  ];
  for(const [lab,set,cfgs] of oosCfgs){
    console.log(`\n=== ${lab} ===`);
    for(const [cl,N] of cfgs){
      const full = N===null?set:topN(set,N);
      const [h1,h2]=splitHalf(full);
      const m1=metrics(h1),m2=metrics(h2);
      const f=(m,h)=>`${h} n=${String(m.n||0).padStart(4)} PF=${(m.n?m.pf:0).toFixed(2).padStart(5)} sinTop5=${(m.n?m.noTop:0).toFixed(2).padStart(5)} med=${(m.n?m.med:0).toFixed(2).padStart(6)}% avg=${(m.n?m.avg:0).toFixed(2).padStart(6)}% WR=${(m.n?m.wr:0).toFixed(1)}%`;
      console.log(`  ${cl.padEnd(7)}  |  ${f(m1,'H1')}  |  ${f(m2,'H2')}`);
    }
  }
})();
