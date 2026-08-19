#!/usr/bin/env node
// backtest_synthesis.mjs — JUNTAR todo lo aprendido y ver qué combinación es la MEJOR.
//   Aprendizajes: (1) anticipado > confirmado (timing), (2) los cruces DEBAJO de la EMA200 rinden
//   4x (reversión temprana), (3) DeMark setup-9 = comprar el suelo (mediana +), (4) confluencia
//   EMA+9 sube la calidad. Hipótesis: todo apunta a lo mismo = reversión desde el suelo cazada pronto.
//   Se apilan los filtros sobre EMA anticipado (stop -18%, salida cruce contrario) y se comparan
//   con la lupa escéptica. + DeMark setup-9 solo como referencia. 250 large-caps, 10y.
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup } from '../scanner/demark_calc.mjs';
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,GAP=0.012,L200=200,CONF=13;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=dirname(fileURLToPath(import.meta.url));
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i]});return b.length>220?b:null;}catch{return null;}}

// EMA anticipado con flags de contexto; cond decide si se toma
function emaTrades(bars,cond){const cl=bars.map(b=>b.c),ef=ema(cl,8),es=ema(cl,21),el=ema(cl,L200),out=[];
  const td=computeTDSetup(bars);let i=L200+1;
  while(i<bars.length-1){const gap=(ef[i]-es[i])/cl[i],gp=(ef[i-1]-es[i-1])/cl[i-1];const li=gap<0&&Math.abs(gap)<GAP&&gap>gp;
    if(!li){i++;continue;}
    let has9=false;for(let j=Math.max(0,i-CONF);j<=i;j++){if(td.bullSetup[j]===9){has9=true;break;}}
    const below=cl[i]<el[i];
    if(!cond({has9,below})){i++;continue;}
    const ep=cl[i],stop=ep*(1-CAT);let ret=null,exitJ=bars.length-1;
    for(let j=i+1;j<bars.length;j++){const bear=ef[j-1]>=es[j-1]&&ef[j]<es[j];
      if(bars[j].l<=stop){ret=(stop/ep-1)*100-COST*200;exitJ=j;break;}if(bear){ret=(cl[j]/ep-1)*100-COST*200;exitJ=j;break;}}
    if(ret==null){ret=(cl[cl.length-1]/ep-1)*100-COST*200;exitJ=bars.length-1;}
    out.push({r:ret,t:bars[i].t});i=exitJ+1;}
  return out;}
// DeMark setup-9 solo (referencia)
function demTrades(bars){const cl=bars.map(b=>b.c),out=[];const td=computeTDSetup(bars);let i=0;
  while(i<bars.length-1){if(td.bullSetup[i]!==9){i++;continue;}const ep=cl[i],stop=ep*(1-CAT);let ret=null,exitJ=bars.length-1;
    for(let j=i+1;j<bars.length;j++){if(bars[j].l<=stop){ret=(stop/ep-1)*100-COST*200;exitJ=j;break;}if(td.bearSetup[j]===9){ret=(cl[j]/ep-1)*100-COST*200;exitJ=j;break;}if(j-i>=52){ret=(cl[j]/ep-1)*100-COST*200;exitJ=j;break;}}
    if(ret==null){ret=(cl[cl.length-1]/ep-1)*100-COST*200;exitJ=bars.length-1;}out.push({r:ret,t:bars[i].t});i=exitJ+1;}
  return out;}
const yOf=t=>new Date(t*1000).getUTCFullYear();
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const st=a=>{const rs=a.map(x=>x.r),n=rs.length;if(!n)return{n:0,pf:0,m:0,wr:0,med:0};const w=rs.filter(x=>x>0),l=rs.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return{n,pf:gl?Math.abs(gw/gl):99,m:rs.reduce((x,y)=>x+y,0)/n,wr:100*w.length/n,med:median(rs)};};
function trimTop(a,p){const rs=[...a.map(x=>x.r)].sort((x,y)=>y-x);const kept=rs.slice(Math.floor(rs.length*p));if(!kept.length)return 0;const w=kept.filter(x=>x>0),l=kept.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return gl?Math.abs(gw/gl):99;}
const wf=a=>{if(a.length<8)return'—';const t0=Math.min(...a.map(x=>x.t)),t1=Math.max(...a.map(x=>x.t)),sp=(t1-t0)/4;return[0,1,2,3].map(k=>st(a.filter(x=>Math.min(3,Math.floor((x.t-t0)/sp))===k))).filter(x=>x.n>=4&&x.m>0).length+'/4';};

(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8'));const tks=(uni.universe||uni).slice(0,250).map(u=>u.ticker);
  console.log('\n════ SÍNTESIS — apilar lo aprendido, ¿cuál es la MEJOR opción? (10y, stop -18%) ════\n');
  const C={base:[],conf:[],below:[],confBelow:[],confAbove:[],dem:[]};let ok=0;
  for(const t of tks){const b=await getW(t);await sleep(110);if(!b)continue;ok++;
    C.base.push(...emaTrades(b,()=>true));
    C.conf.push(...emaTrades(b,f=>f.has9));
    C.below.push(...emaTrades(b,f=>f.below));
    C.confBelow.push(...emaTrades(b,f=>f.has9&&f.below));
    C.confAbove.push(...emaTrades(b,f=>f.has9&&!f.below));
    C.dem.push(...demTrades(b));}
  console.log(`  ${ok} acciones\n`);
  const row=(lbl,a)=>{const s=st(a);console.log(`  ${lbl.padEnd(34)} n ${String(s.n).padStart(4)} · WR ${s.wr.toFixed(0).padStart(2)}% · PF ${s.pf.toFixed(2).padStart(5)} · exp +${s.m.toFixed(1)}% · MEDIANA ${s.med>=0?'+':''}${s.med.toFixed(1)}% · sin-top5% ${trimTop(a,0.05).toFixed(2)} · WF ${wf(a)}`);};
  row('EMA anticip SOLO (baseline)',C.base);
  row('EMA + confluencia 9',C.conf);
  row('EMA + debajo EMA200',C.below);
  row('EMA + 9 + DEBAJO 200 (stack)',C.confBelow);
  row('EMA + 9 + encima 200',C.confAbove);
  row('DeMark setup-9 solo (ref)',C.dem);
  console.log('\n── Año a año del stack (EMA+9+debajo200) vs baseline ──');
  const yrs=[...new Set(C.base.map(x=>yOf(x.t)))].sort();
  const line=(lbl,a)=>console.log('  '+lbl.padEnd(20)+yrs.map(y=>{const ss=st(a.filter(x=>yOf(x.t)===y));return `${String(y).slice(2)}:${ss.n?(ss.m>=0?'+':'')+ss.m.toFixed(0):'·'}`;}).join(' '));
  line('baseline',C.base);line('stack 9+debajo',C.confBelow);
  console.log('\n  Buscamos: mejor PF/expectancy/robustez SIN quedarnos con tan pocas señales que sea inoperable.');
})();
