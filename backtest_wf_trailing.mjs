#!/usr/bin/env node
// backtest_wf_trailing.mjs — HIPOTESIS: trailing stop por ATR(14) semanal (3x desde el maximo
// alcanzado tras la entrada) en vez de/ademas del stop fijo -18%. Motor base SIN TOCAR
// (EMA anticipado 8/21, entry, salida cruce contrario). Se anade SOLO la logica de trailing
// como alternativa de stop-loss, aislando esa unica variable frente al baseline.
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,GAP=0.012,L200=200;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=dirname(fileURLToPath(import.meta.url));
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i],o:q.open?.[i]??null,v:q.volume?.[i]??null});return b.length>220?b:null;}catch{return null;}}

// ATR(14) semanal, estilo Wilder (simple rolling average, coherente con lo demás en el repo).
function atr14(bars){
  const tr=bars.map((b,i)=>{
    if(i===0)return b.h-b.l;
    const pc=bars[i-1].c;
    return Math.max(b.h-b.l, Math.abs(b.h-pc), Math.abs(b.l-pc));
  });
  const out=new Array(bars.length).fill(null);
  for(let i=0;i<bars.length;i++){
    if(i<13){continue;}
    let s=0;for(let j=i-13;j<=i;j++)s+=tr[j];
    out[i]=s/14;
  }
  return out;
}

// mode: 'fixed18' (baseline, cruce contrario o -18%), 'trailingAtr' (cruce contrario o trailing 3xATR desde maximo),
// 'trailingOnly' (SOLO trailing, sin cruce contrario), 'trailingPlusFixed' (el que salte primero: trailing, -18%, o cruce)
function trades(bars,mode,mult=3){
  const cl=bars.map(b=>b.c),ef=ema(cl,8),es=ema(cl,21),atr=atr14(bars),out=[];
  let i=L200+1;
  while(i<bars.length-1){
    const gap=(ef[i]-es[i])/cl[i],gp=(ef[i-1]-es[i-1])/cl[i-1];
    const li=gap<0&&Math.abs(gap)<GAP&&gap>gp;
    if(!li){i++;continue;}
    const ep=cl[i];
    let ret=null,ej=bars.length-1;
    let maxHigh=bars[i].h; // pico desde la entrada (incluye la propia barra de entrada)
    const fixedStop=ep*(1-CAT);
    for(let j=i+1;j<bars.length;j++){
      if(bars[j].h>maxHigh)maxHigh=bars[j].h;
      const a=atr[j-1]; // ATR conocido al cierre de la vela anterior (evita look-ahead)
      const trailStop=(a!=null)?maxHigh-mult*a:-Infinity;
      const bear=ef[j-1]>=es[j-1]&&ef[j]<es[j];

      if(mode==='fixed18'){
        if(bars[j].l<=fixedStop){ret=(fixedStop/ep-1)*100-COST*200;ej=j;break;}
        if(bear){ret=(cl[j]/ep-1)*100-COST*200;ej=j;break;}
      } else if(mode==='trailingAtr'){
        if(bars[j].l<=trailStop){ret=(Math.max(trailStop,bars[j].l)/ep-1)*100-COST*200;ret=(trailStop/ep-1)*100-COST*200;ej=j;break;}
        if(bear){ret=(cl[j]/ep-1)*100-COST*200;ej=j;break;}
      } else if(mode==='trailingOnly'){
        if(bars[j].l<=trailStop){ret=(trailStop/ep-1)*100-COST*200;ej=j;break;}
      } else if(mode==='trailingPlusFixed'){
        // el stop mas cercano al precio manda (el que salte antes en la práctica es el mas ajustado)
        const stop=Math.max(trailStop,fixedStop);
        if(bars[j].l<=stop){ret=(stop/ep-1)*100-COST*200;ej=j;break;}
        if(bear){ret=(cl[j]/ep-1)*100-COST*200;ej=j;break;}
      }
    }
    if(ret==null)ret=(cl[cl.length-1]/ep-1)*100-COST*200;
    out.push({r:ret,t:bars[i].t});
    i=ej+1;
  }
  return out;
}

const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const st=a=>{const rs=a.map(x=>x.r),n=rs.length;if(!n)return{n:0,pf:0,m:0,med:0};const w=rs.filter(x=>x>0),l=rs.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return{n,pf:gl?Math.abs(gw/gl):99,m:rs.reduce((x,y)=>x+y,0)/n,med:median(rs)};};
function trimTop(a,p){const rs=[...a.map(x=>x.r)].sort((x,y)=>y-x);const kept=rs.slice(Math.floor(rs.length*p));if(!kept.length)return 0;const w=kept.filter(x=>x>0),l=kept.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return gl?Math.abs(gw/gl):99;}
const wf=a=>{if(a.length<8)return'—';const t0=Math.min(...a.map(x=>x.t)),t1=Math.max(...a.map(x=>x.t)),sp=(t1-t0)/4;const parts=[0,1,2,3].map(k=>st(a.filter(x=>Math.min(3,Math.floor((x.t-t0)/sp))===k)));return{count:parts.filter(x=>x.n>=5&&x.m>0).length,parts};};

(async()=>{
  const SAMPLE=parseInt(process.argv[2]||'100',10);
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8'));
  const tks=(uni.universe||uni).slice(0,SAMPLE).map(u=>u.ticker);
  console.log(`\n════ Trailing ATR(14)x3 vs stop fijo -18% — SAMPLE=${SAMPLE} ════\n`);
  const bars={};let ok=0;
  for(const t of tks){const b=await getW(t);await sleep(110);if(!b)continue;ok++;bars[t]=b;}
  console.log(`  ${ok}/${tks.length} tickers con datos validos\n`);

  const gather=(mode,mult)=>{const a=[];for(const t in bars)a.push(...trades(bars[t],mode,mult));return a;};

  const scenarios=[
    ['BASELINE fixed -18% (cruce o stop)','fixed18',null],
    ['trailing 3xATR (cruce o trailing)','trailingAtr',3],
    ['trailing SOLO (sin cruce contrario)','trailingOnly',3],
    ['trailing 3xATR + fixed -18% (el mas ajustado)','trailingPlusFixed',3],
    ['trailing 2xATR (cruce o trailing)','trailingAtr',2],
    ['trailing 4xATR (cruce o trailing)','trailingAtr',4],
  ];

  console.log('  escenario                                        n     PF    MEDIANA   sin-top5%   WF(4)');
  for(const [label,mode,mult] of scenarios){
    const a=gather(mode,mult);
    const s=st(a);
    const w=wf(a);
    const wfStr=typeof w==='string'?w:`${w.count}/4`;
    console.log(`  ${label.padEnd(48)} ${String(s.n).padStart(5)}  ${s.pf.toFixed(4).padStart(7)}  ${(s.med>=0?'+':'')+s.med.toFixed(4)}%   ${trimTop(a,0.05).toFixed(4).padStart(7)}     ${wfStr}`);
  }
  console.log('\n  Baseline referencia (10y, 250 large-caps, full-sample validado): PF 3.59, mediana -2.2%, sin-top5% 1.53, n=1572.\n');

  // ---- PARTICION OUT-OF-SAMPLE POR REGIMEN: H1 (mitad antigua) vs H2 (mitad reciente) ----
  console.log('\n════ PARTICION H1/H2 por fecha de entrada (mediana temporal) ════\n');
  console.log('  escenario                                        H1: n     PF    MEDIANA   |  H2: n     PF    MEDIANA');
  for(const [label,mode,mult] of scenarios){
    const a=gather(mode,mult);
    const sorted=[...a].sort((x,y)=>x.t-y.t);
    const mid=Math.floor(sorted.length/2);
    const h1=sorted.slice(0,mid), h2=sorted.slice(mid);
    const s1=st(h1), s2=st(h2);
    console.log(`  ${label.padEnd(48)} ${String(s1.n).padStart(5)}  ${s1.pf.toFixed(4).padStart(7)}  ${(s1.med>=0?'+':'')+s1.med.toFixed(4)}%   |  ${String(s2.n).padStart(5)}  ${s2.pf.toFixed(4).padStart(7)}  ${(s2.med>=0?'+':'')+s2.med.toFixed(4)}%`);
  }
  console.log('');
})();
