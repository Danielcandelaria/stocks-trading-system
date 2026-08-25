#!/usr/bin/env node
// backtest_ref_stack_oos.mjs — VERIFICACIÓN ADVERSARIAL del refinamiento STACK.
//   Reutiliza el motor de backtest_ref_stack_muestra.mjs pero añade una partición
//   OUT-OF-SAMPLE por RÉGIMEN: parte los trades en 2 mitades por FECHA DE ENTRADA
//   (mediana temporal). H1=mitad antigua, H2=mitad reciente. Recalcula métricas clave
//   por mitad, para CADA tier. Objetivo: ¿el edge del STACK vive en ambos regímenes
//   o solo en uno (falso positivo régimen-dependiente)?
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup } from '../scanner/demark_calc.mjs';
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,GAP=0.012,CONF=8;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=dirname(fileURLToPath(import.meta.url));
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i]});return b.length>120?b:null;}catch{return null;}}
function trades(bars,mode){const cl=bars.map(b=>b.c),ef=ema(cl,8),es=ema(cl,21),e200=ema(cl,200),out=[];
  const td=mode!=='base'?computeTDSetup(bars):null;let i=22;
  while(i<bars.length-1){
    const gap=(ef[i]-es[i])/cl[i],gp=(ef[i-1]-es[i-1])/cl[i-1];const li=gap<0&&Math.abs(gap)<GAP&&gap>gp;
    if(!li){i++;continue;}
    if(mode!=='base'){ let has9=false; for(let j=Math.max(0,i-CONF);j<=i;j++){ if(td.bullSetup[j]===9){has9=true;break;} } if(!has9){i++;continue;} }
    if(mode==='stack'){ if(!(cl[i]<e200[i])){i++;continue;} }
    const ep=cl[i],stop=ep*(1-CAT);let ret=null,exitJ=bars.length-1;
    for(let j=i+1;j<bars.length;j++){const bear=ef[j-1]>=es[j-1]&&ef[j]<es[j];
      if(bars[j].l<=stop){ret=(stop/ep-1)*100-COST*200;exitJ=j;break;}if(bear){ret=(cl[j]/ep-1)*100-COST*200;exitJ=j;break;}}
    if(ret==null){ret=(cl[cl.length-1]/ep-1)*100-COST*200;exitJ=bars.length-1;}
    out.push({r:ret,t:bars[i].t,why:ret<=(stop/ep-1)*100+0.01?'stop':'cruce'});i=exitJ+1;}
  return out;}
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const st=a=>{const rs=a.map(x=>x.r),n=rs.length;if(!n)return{n:0,pf:0,m:0,wr:0,med:0};const w=rs.filter(x=>x>0),l=rs.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return{n,pf:gl?Math.abs(gw/gl):99,m:rs.reduce((x,y)=>x+y,0)/n,wr:100*w.length/n,med:median(rs)};};
function trimTop(a,p){const rs=[...a.map(x=>x.r)].sort((x,y)=>y-x);const kept=rs.slice(Math.floor(rs.length*p));if(!kept.length)return 0;const w=kept.filter(x=>x>0),l=kept.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return gl?Math.abs(gw/gl):99;}
const dstr=t=>new Date(t*1000).toISOString().slice(0,10);

// Parte por MEDIANA TEMPORAL de las fechas de entrada. H1=antigua, H2=reciente.
function splitByRegime(a){const s=[...a].sort((x,y)=>x.t-y.t);const half=Math.floor(s.length/2);
  return {H1:s.slice(0,half),H2:s.slice(half),cut:s.length?s[half]?.t:null};}

(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8'));const all=(uni.universe||uni).map(u=>u.ticker);
  const N=Math.min(all.length,450);const tks=all.slice(0,N);
  console.log(`\n════ STACK OOS por RÉGIMEN (${N} tickers, 10y semanal, stop -18%, CONF≤${CONF}) ════\n`);
  const perTk={base:[],conf:[],stack:[]};let ok=0,idx=0;
  for(const t of tks){const b=await getW(t);await sleep(110);idx++;if(!b)continue;ok++;
    for(const m of ['base','conf','stack']){perTk[m].push(...trades(b,m));}
  }
  console.log(`  ${ok}/${N} acciones con datos válidos\n`);
  const line=(lbl,s,extra)=>console.log(`  ${lbl.padEnd(30)} n ${String(s.n).padStart(4)} · WR ${s.wr.toFixed(0)}% · PF ${s.pf.toFixed(2)} · exp +${s.m.toFixed(2)}% · MEDIANA ${s.med>=0?'+':''}${s.med.toFixed(1)}% · sin-top5% ${extra}`);
  for(const m of ['base','conf','stack']){
    const sp=splitByRegime(perTk[m]);
    console.log(`── ${m.toUpperCase()} — corte temporal @ ${sp.cut?dstr(sp.cut):'n/a'} ──`);
    console.log(`  rango H1: ${sp.H1.length?dstr(Math.min(...sp.H1.map(x=>x.t)))+' → '+dstr(Math.max(...sp.H1.map(x=>x.t))):'—'}`);
    console.log(`  rango H2: ${sp.H2.length?dstr(Math.min(...sp.H2.map(x=>x.t)))+' → '+dstr(Math.max(...sp.H2.map(x=>x.t))):'—'}`);
    line('  FULL',st(perTk[m]),trimTop(perTk[m],0.05).toFixed(2));
    line('  H1 (antigua)',st(sp.H1),trimTop(sp.H1,0.05).toFixed(2));
    line('  H2 (reciente)',st(sp.H2),trimTop(sp.H2,0.05).toFixed(2));
    console.log('');
  }
  // Comparación de ORDEN monotónico dentro de cada mitad (¿STACK>CONF>base en ambas?)
  const sB=splitByRegime(perTk.base),sC=splitByRegime(perTk.conf),sS=splitByRegime(perTk.stack);
  const j=(a)=>`PF ${st(a).pf.toFixed(2)} · sin5 ${trimTop(a,0.05).toFixed(2)} · exp ${st(a).m.toFixed(2)} · med ${st(a).med.toFixed(1)} · n${st(a).n}`;
  console.log('── ORDEN por mitad (¿STACK domina en AMBAS?) ──');
  console.log('  H1  base : '+j(sB.H1));
  console.log('  H1  conf : '+j(sC.H1));
  console.log('  H1  STACK: '+j(sS.H1));
  console.log('  H2  base : '+j(sB.H2));
  console.log('  H2  conf : '+j(sC.H2));
  console.log('  H2  STACK: '+j(sS.H2));
})();
