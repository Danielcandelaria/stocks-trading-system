#!/usr/bin/env node
// backtest_confluence.mjs — CONFLUENCIA: entrar LONG en el cruce EMA8/21 SOLO si hay un
//   Buy Setup-9 reciente DEBAJO (dentro de K velas antes) que respalde el giro.
//   Idea del usuario: el 9 marca el suelo de agotamiento; si además las EMA cruzan al alza,
//   es un giro confirmado con momentum → más convicción. Menos señales, ¿más calidad?
//   Compara: EMA anticipado SOLO (baseline) vs EMA+confluencia9 (K=13, 26, 52), stop -18%.
//   Lupa escéptica: WR, PF, MEDIANA, sin-top5%, %stop, año, WF. 250 large-caps, 10y.
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup } from '../scanner/demark_calc.mjs';
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,GAP=0.012;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=dirname(fileURLToPath(import.meta.url));
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i]});return b.length>120?b:null;}catch{return null;}}

// K = ventana de confluencia (velas hacia atrás donde debe haber un setup-9). K=0 → sin confluencia (baseline).
function trades(bars,K){const cl=bars.map(b=>b.c),ef=ema(cl,8),es=ema(cl,21),out=[];
  const td=K>0?computeTDSetup(bars):null;let i=22;
  while(i<bars.length-1){
    const gap=(ef[i]-es[i])/cl[i],gp=(ef[i-1]-es[i-1])/cl[i-1];const li=gap<0&&Math.abs(gap)<GAP&&gap>gp;   // anticipación alcista
    if(!li){i++;continue;}
    if(K>0){ let has9=false; for(let j=Math.max(0,i-K);j<=i;j++){ if(td.bullSetup[j]===9){has9=true;break;} } if(!has9){i++;continue;} }
    const ep=cl[i],stop=ep*(1-CAT);let ret=null,exitJ=bars.length-1;
    for(let j=i+1;j<bars.length;j++){const bear=ef[j-1]>=es[j-1]&&ef[j]<es[j];
      if(bars[j].l<=stop){ret=(stop/ep-1)*100-COST*200;exitJ=j;break;}if(bear){ret=(cl[j]/ep-1)*100-COST*200;exitJ=j;break;}}
    if(ret==null){ret=(cl[cl.length-1]/ep-1)*100-COST*200;exitJ=bars.length-1;}
    out.push({r:ret,t:bars[i].t,why:ret<=(stop/ep-1)*100+0.01?'stop':'cruce'});i=exitJ+1;}
  return out;}
const yOf=t=>new Date(t*1000).getUTCFullYear();
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const st=a=>{const rs=a.map(x=>x.r),n=rs.length;if(!n)return{n:0,pf:0,m:0,wr:0,med:0};const w=rs.filter(x=>x>0),l=rs.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return{n,pf:gl?Math.abs(gw/gl):99,m:rs.reduce((x,y)=>x+y,0)/n,wr:100*w.length/n,med:median(rs)};};
function trimTop(a,p){const rs=[...a.map(x=>x.r)].sort((x,y)=>y-x);const kept=rs.slice(Math.floor(rs.length*p));if(!kept.length)return 0;const w=kept.filter(x=>x>0),l=kept.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return gl?Math.abs(gw/gl):99;}
const wf=a=>{if(a.length<8)return'—';const t0=Math.min(...a.map(x=>x.t)),t1=Math.max(...a.map(x=>x.t)),sp=(t1-t0)/4;return[0,1,2,3].map(k=>st(a.filter(x=>Math.min(3,Math.floor((x.t-t0)/sp))===k))).filter(x=>x.n>=4&&x.m>0).length+'/4';};

(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8'));const tks=(uni.universe||uni).slice(0,250).map(u=>u.ticker);
  console.log('\n════ CONFLUENCIA: cruce EMA + setup-9 reciente debajo (10y semanal, stop -18%) ════\n');
  const acc={0:[],13:[],26:[],52:[]};let ok=0;
  for(const t of tks){const b=await getW(t);await sleep(110);if(!b)continue;ok++;for(const K of [0,13,26,52])acc[K].push(...trades(b,K));}
  console.log(`  ${ok} acciones\n`);
  const row=(lbl,a)=>{const s=st(a),stops=a.filter(x=>x.why==='stop').length;
    console.log(`  ${lbl.padEnd(30)} n ${String(s.n).padStart(4)} · WR ${s.wr.toFixed(0)}% · PF ${s.pf.toFixed(2)} · exp +${s.m.toFixed(2)}% · MEDIANA ${s.med>=0?'+':''}${s.med.toFixed(1)}% · sin-top5% ${trimTop(a,0.05).toFixed(2)} · %stop ${(100*stops/s.n).toFixed(0)}% · WF ${wf(a)}`);};
  row('EMA anticipado SOLO (baseline)',acc[0]);
  row('EMA + 9 en ≤13 velas',acc[13]);
  row('EMA + 9 en ≤26 velas',acc[26]);
  row('EMA + 9 en ≤52 velas',acc[52]);
  console.log('\n── Año a año (expectancy media) ──');
  const yrs=[...new Set(acc[0].map(x=>yOf(x.t)))].sort();
  const line=(lbl,a)=>console.log('  '+lbl.padEnd(16)+yrs.map(y=>{const ss=st(a.filter(x=>yOf(x.t)===y));return `${String(y).slice(2)}:${ss.n?(ss.m>=0?'+':'')+ss.m.toFixed(0):'·'}`;}).join(' '));
  line('baseline',acc[0]);line('+9 ≤26v',acc[26]);
  console.log('\n  Pregunta: ¿la confluencia sube WR/mediana/robustez lo suficiente para justificar tener MENOS señales?');
})();
