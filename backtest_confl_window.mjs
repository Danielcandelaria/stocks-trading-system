#!/usr/bin/env node
// backtest_confl_window.mjs — BARRIDO de la ventana de confluencia: ¿cuántas velas atrás debe
//   haber un Buy Setup-9 para respaldar el cruce EMA? Ahora usamos 13. Probamos 2..52 velas,
//   en Confluencia (EMA antic + 9) y en STACK (+ debajo EMA200). Lupa: n, WR, PF, MEDIANA, sin-top5%, WF.
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup } from '../scanner/demark_calc.mjs';
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,GAP=0.012,L200=200;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=dirname(fileURLToPath(import.meta.url));
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i]});return b.length>220?b:null;}catch{return null;}}

// devuelve, por cada trade de confluencia, el retorno + la DISTANCIA al 9 (velas) + si debajo200.
// Así con UNA pasada evaluamos todas las ventanas (filtrando por dist<=K).
function trades(bars){const cl=bars.map(b=>b.c),ef=ema(cl,8),es=ema(cl,21),el=ema(cl,L200),out=[];const td=computeTDSetup(bars);let i=L200+1;
  while(i<bars.length-1){const gap=(ef[i]-es[i])/cl[i],gp=(ef[i-1]-es[i-1])/cl[i-1];const li=gap<0&&Math.abs(gap)<GAP&&gap>gp;
    if(!li){i++;continue;}
    // distancia al 9 más reciente hacia atrás (hasta 60 velas)
    let dist=null;for(let j=i;j>=Math.max(0,i-60);j--){if(td.bullSetup[j]===9){dist=i-j;break;}}
    if(dist==null){i++;continue;}
    const below=cl[i]<el[i];const ep=cl[i],stop=ep*(1-CAT);let ret=null,ej=bars.length-1;
    for(let j=i+1;j<bars.length;j++){const bear=ef[j-1]>=es[j-1]&&ef[j]<es[j];if(bars[j].l<=stop){ret=(stop/ep-1)*100-COST*200;ej=j;break;}if(bear){ret=(cl[j]/ep-1)*100-COST*200;ej=j;break;}}
    if(ret==null)ret=(cl[cl.length-1]/ep-1)*100-COST*200;out.push({r:ret,t:bars[i].t,dist,below});i=ej+1;}
  return out;}
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const st=a=>{const rs=a.map(x=>x.r),n=rs.length;if(!n)return{n:0,pf:0,m:0,wr:0,med:0};const w=rs.filter(x=>x>0),l=rs.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return{n,pf:gl?Math.abs(gw/gl):99,m:rs.reduce((x,y)=>x+y,0)/n,wr:100*w.length/n,med:median(rs)};};
function trimTop(a,p){const rs=[...a.map(x=>x.r)].sort((x,y)=>y-x);const kept=rs.slice(Math.floor(rs.length*p));if(!kept.length)return 0;const w=kept.filter(x=>x>0),l=kept.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return gl?Math.abs(gw/gl):99;}
const wf=a=>{if(a.length<8)return'—';const t0=Math.min(...a.map(x=>x.t)),t1=Math.max(...a.map(x=>x.t)),sp=(t1-t0)/4;return[0,1,2,3].map(k=>st(a.filter(x=>Math.min(3,Math.floor((x.t-t0)/sp))===k))).filter(x=>x.n>=4&&x.m>0).length+'/4';};

(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8'));const tks=(uni.universe||uni).slice(0,250).map(u=>u.ticker);
  console.log('\n════ BARRIDO ventana de confluencia (velas con un 9 detrás) — 10y, stop -18% ════\n');
  const all=[];let ok=0;
  for(const t of tks){const b=await getW(t);await sleep(110);if(!b)continue;ok++;all.push(...trades(b));}
  console.log(`  ${ok} acciones · ${all.length} trades con un 9 en ≤60 velas\n`);
  const WINS=[2,4,6,8,10,13,16,20,26,39,52];
  const row=(lbl,pool)=>{console.log(`── ${lbl} ──`);
    for(const K of WINS){const a=pool.filter(x=>x.dist<=K);const s=st(a);
      console.log(`  ≤${String(K).padStart(2)}v  n ${String(s.n).padStart(4)} · WR ${s.wr.toFixed(0)}% · PF ${s.pf.toFixed(2)} · exp +${s.m.toFixed(1)}% · MEDIANA ${s.med>=0?'+':''}${s.med.toFixed(1)}% · sin-top5% ${trimTop(a,0.05).toFixed(2)} · WF ${wf(a)}`);}
    console.log('');};
  row('CONFLUENCIA (todas)', all);
  row('STACK (solo debajo EMA200)', all.filter(x=>x.below));
  console.log('  Actual = 13 velas. Buscamos el K con mejor PF/robustez SIN quedarnos sin muestra.\n');
})();
