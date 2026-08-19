#!/usr/bin/env node
// backtest_combo.mjs — CARTERA combinada EMACross + DeMark: ¿diversifica y tapa 2022?
//   Corre los dos sistemas (ambos LONG, stop -18%, una posición a la vez), agrupa retornos por
//   TRIMESTRE, y mide: correlación entre ambos, drawdown de cada uno vs 50/50, y año a año.
//   Correlación baja/negativa = la combinación suaviza la curva. 250 large-caps, 10y semanal.
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup, computeTDCountdown } from '../scanner/demark_calc.mjs';
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,GAP=0.012,TIME_W=52;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=dirname(fileURLToPath(import.meta.url));
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null&&q.open[i]!=null)b.push({t:d.timestamp[i],o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i]});return b.length>120?b:null;}catch{return null;}}

// EMACross anticipado, stop -18%, salida cruce contrario
function emaTrades(bars){const cl=bars.map(b=>b.c),ef=ema(cl,8),es=ema(cl,21),out=[];let i=22;
  while(i<bars.length-1){const gap=(ef[i]-es[i])/cl[i],gp=(ef[i-1]-es[i-1])/cl[i-1];const li=gap<0&&Math.abs(gap)<GAP&&gap>gp;
    if(!li){i++;continue;}const ep=cl[i],stop=ep*(1-CAT);let ret=null,exitJ=bars.length-1;
    for(let j=i+1;j<bars.length;j++){const bear=ef[j-1]>=es[j-1]&&ef[j]<es[j];
      if(bars[j].l<=stop){ret=(stop/ep-1)*100-COST*200;exitJ=j;break;}
      if(bear){ret=(cl[j]/ep-1)*100-COST*200;exitJ=j;break;}}
    if(ret==null)ret=(cl[cl.length-1]/ep-1)*100-COST*200;out.push({t:bars[i].t,r:ret});i=exitJ+1;}
  return out;}
// DeMark setup-9, stop -18%, salida en setup-9 opuesto / 52w
function demTrades(bars){const td=computeTDSetup(bars),cd=computeTDCountdown(bars,td),out=[];let i=0;
  while(i<bars.length-1){if(td.bullSetup[i]!==9){i++;continue;}const ep=bars[i].c,stop=ep*(1-CAT);let ret=null,exitJ=bars.length-1;
    for(let j=i+1;j<bars.length;j++){if(bars[j].l<=stop){ret=(stop/ep-1)*100-COST*200;exitJ=j;break;}
      if(td.bearSetup[j]===9){ret=(bars[j].c/ep-1)*100-COST*200;exitJ=j;break;}
      if(j-i>=TIME_W){ret=(bars[j].c/ep-1)*100-COST*200;exitJ=j;break;}}
    if(ret==null)ret=(bars[bars.length-1].c/ep-1)*100-COST*200;out.push({t:bars[i].t,r:ret});i=exitJ+1;}
  return out;}

const qOf=t=>{const d=new Date(t*1000);return d.getUTCFullYear()+'-Q'+(Math.floor(d.getUTCMonth()/3)+1);};
const yOf=t=>new Date(t*1000).getUTCFullYear();
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
function maxDD(series){let eq=0,peak=0,dd=0;for(const v of series){eq+=v;peak=Math.max(peak,eq);dd=Math.min(dd,eq-peak);}return dd;}
function corr(a,b){const n=a.length;if(n<3)return 0;const ma=mean(a),mb=mean(b);let num=0,da=0,db=0;for(let i=0;i<n;i++){num+=(a[i]-ma)*(b[i]-mb);da+=(a[i]-ma)**2;db+=(b[i]-mb)**2;}return da&&db?num/Math.sqrt(da*db):0;}

(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8'));const tks=(uni.universe||uni).slice(0,250).map(u=>u.ticker);
  console.log('\n════ CARTERA COMBINADA EMACross + DeMark (50/50) — 10y semanal ════\n');
  let E=[],D=[],done=0,ok=0;
  for(const t of tks){const b=await getW(t);done++;if(done%50===0)process.stdout.write(`  …${done}/${tks.length}\n`);await sleep(110);if(!b)continue;ok++;E.push(...emaTrades(b));D.push(...demTrades(b));}
  console.log(`  ${ok} acciones · EMA ${E.length}tr · DeMark ${D.length}tr\n`);

  // series por trimestre (media de trades ENTRADOS ese trimestre)
  const quarters=[...new Set([...E,...D].map(x=>qOf(x.t)))].sort();
  const eq=quarters.map(q=>mean(E.filter(x=>qOf(x.t)===q).map(x=>x.r)));
  const dq=quarters.map(q=>mean(D.filter(x=>qOf(x.t)===q).map(x=>x.r)));
  const cq=quarters.map((_,i)=>0.5*eq[i]+0.5*dq[i]);
  // correlación solo en trimestres donde AMBOS tienen trades
  const pairs=quarters.map((q,i)=>({e:eq[i],d:dq[i],hasE:E.some(x=>qOf(x.t)===q),hasD:D.some(x=>qOf(x.t)===q)})).filter(p=>p.hasE&&p.hasD);
  const rho=corr(pairs.map(p=>p.e),pairs.map(p=>p.d));

  console.log('── Correlación trimestral EMA ↔ DeMark ──');
  console.log(`  ρ = ${rho.toFixed(2)}  ${rho<0.3?'(BAJA/negativa → diversifica bien)':rho<0.6?'(media)':'(alta → poca diversificación)'}\n`);

  console.log('── Drawdown de la curva trimestral (suma de medias, %) ──');
  console.log(`  Solo EMACross : maxDD ${maxDD(eq).toFixed(0)}%`);
  console.log(`  Solo DeMark   : maxDD ${maxDD(dq).toFixed(0)}%`);
  console.log(`  COMBINADO 50/50: maxDD ${maxDD(cq).toFixed(0)}%  ← si es menor que ambos, suaviza\n`);

  console.log('── Peor trimestre de cada uno ──');
  console.log(`  EMA ${Math.min(...eq).toFixed(1)}% · DeMark ${Math.min(...dq).toFixed(1)}% · COMBINADO ${Math.min(...cq).toFixed(1)}%\n`);

  console.log('── Año a año (expectancy media por trade) ──');
  const years=[...new Set([...E,...D].map(x=>yOf(x.t)))].sort();
  console.log('  año   EMA     DeMark  COMBO');
  for(const y of years){const e=mean(E.filter(x=>yOf(x.t)===y).map(x=>x.r)),d=mean(D.filter(x=>yOf(x.t)===y).map(x=>x.r));const c=0.5*e+0.5*d;
    const f=v=>(v>=0?'+':'')+v.toFixed(0)+'%';console.log(`  ${y}  ${f(e).padStart(6)}  ${f(d).padStart(6)}  ${f(c).padStart(6)}  ${c>=0?'✅':'❌'}`);}
  console.log('\n  Nota: curva por media trimestral (no compón. ni límite de capital). Mismo sesgo supervivencia.');
})();
