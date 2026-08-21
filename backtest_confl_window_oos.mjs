#!/usr/bin/env node
// backtest_confl_window_oos.mjs — CONFIRMACIÓN OUT-OF-SAMPLE de la ventana de confluencia.
//   El barrido in-sample dio óptimo en 8. ¿Es real o overfit? Se parte el histórico en DOS mitades
//   temporales independientes y se barre la ventana en CADA una. Si el óptimo es ESTABLE (mismo K
//   gana en las dos mitades), se confirma. Si salta, era ruido/overfit → no cambiar el sistema.
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup } from '../scanner/demark_calc.mjs';
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,GAP=0.012,L200=200;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=dirname(fileURLToPath(import.meta.url));
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i]});return b.length>220?b:null;}catch{return null;}}
function trades(bars){const cl=bars.map(b=>b.c),ef=ema(cl,8),es=ema(cl,21),out=[];const td=computeTDSetup(bars);let i=L200+1;
  while(i<bars.length-1){const gap=(ef[i]-es[i])/cl[i],gp=(ef[i-1]-es[i-1])/cl[i-1];const li=gap<0&&Math.abs(gap)<GAP&&gap>gp;
    if(!li){i++;continue;}let dist=null;for(let j=i;j>=Math.max(0,i-60);j--){if(td.bullSetup[j]===9){dist=i-j;break;}}
    if(dist==null){i++;continue;}const ep=cl[i],stop=ep*(1-CAT);let ret=null,ej=bars.length-1;
    for(let j=i+1;j<bars.length;j++){const bear=ef[j-1]>=es[j-1]&&ef[j]<es[j];if(bars[j].l<=stop){ret=(stop/ep-1)*100-COST*200;ej=j;break;}if(bear){ret=(cl[j]/ep-1)*100-COST*200;ej=j;break;}}
    if(ret==null)ret=(cl[cl.length-1]/ep-1)*100-COST*200;out.push({r:ret,t:bars[i].t,dist});i=ej+1;}
  return out;}
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const st=a=>{const rs=a.map(x=>x.r),n=rs.length;if(!n)return{n:0,pf:0,m:0,med:0};const w=rs.filter(x=>x>0),l=rs.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return{n,pf:gl?Math.abs(gw/gl):99,m:rs.reduce((x,y)=>x+y,0)/n,med:median(rs)};};
function trimTop(a,p){const rs=[...a.map(x=>x.r)].sort((x,y)=>y-x);const kept=rs.slice(Math.floor(rs.length*p));if(!kept.length)return 0;const w=kept.filter(x=>x>0),l=kept.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return gl?Math.abs(gw/gl):99;}

(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8'));const tks=(uni.universe||uni).slice(0,250).map(u=>u.ticker);
  console.log('\n════ CONFIRMACIÓN OUT-OF-SAMPLE — ventana de confluencia (2 mitades) ════\n');
  const all=[];let ok=0;
  for(const t of tks){const b=await getW(t);await sleep(110);if(!b)continue;ok++;all.push(...trades(b));}
  const ts=all.map(x=>x.t).sort((a,b)=>a-b);const mid=ts[Math.floor(ts.length/2)];
  const H1=all.filter(x=>x.t<mid),H2=all.filter(x=>x.t>=mid);
  console.log(`  ${ok} acciones · ${all.length} trades · corte temporal en la mitad\n`);
  const WINS=[4,6,8,10,13,16,20,26];
  const sweep=(name,pool)=>{console.log(`── ${name} (n=${pool.length}) ──`);let best=null,bp=-1;
    for(const K of WINS){const a=pool.filter(x=>x.dist<=K);const s=st(a);if(s.pf>bp&&s.n>=20){bp=s.pf;best=K;}
      console.log(`  ≤${String(K).padStart(2)}v  n ${String(s.n).padStart(4)} · PF ${s.pf.toFixed(2)} · exp +${s.m.toFixed(1)}% · MEDIANA ${s.med>=0?'+':''}${s.med.toFixed(1)}% · sin-top5% ${trimTop(a,0.05).toFixed(2)}`);}
    console.log(`  → mejor K (PF, n≥20): ${best}\n`);return best;};
  const b1=sweep('MITAD 1 (más antigua)',H1);
  const b2=sweep('MITAD 2 (más reciente)',H2);
  console.log('════ VEREDICTO ════');
  console.log(`  Óptimo mitad-1: ${b1}v · óptimo mitad-2: ${b2}v`);
  const stable=Math.abs((b1||0)-(b2||0))<=4;
  console.log(`  ${stable?'✅ ESTABLE (óptimos cercanos) → el efecto tight parece real':'❌ INESTABLE (óptimos dispares) → probable overfit, NO cambiar el sistema'}`);
  console.log('  Además compara: ¿8 y 13 rinden parecido en AMBAS mitades? Si sí, el cambio es marginal/no-necesario.\n');
})();
