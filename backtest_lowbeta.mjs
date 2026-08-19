#!/usr/bin/env node
// backtest_lowbeta.mjs — PILAR 3 (parte testeable): ¿tiltar a BAJA BETA mejora nuestras señales?
//   BAB / Buffett's Alpha: acciones de baja beta rinden MEJOR ajustado a riesgo (aversión al
//   apalancamiento). La beta se calcula del PRECIO (no necesita fundamentales) → sí backtesteable.
//   Se etiqueta cada trade con la beta del valor (trailing 104 sem vs SPY) y se parte en terciles.
//   Sobre EMA anticipado y Confluencia. 250 large-caps, 10y semanal, stop -18%.
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup } from '../scanner/demark_calc.mjs';
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,GAP=0.012,L200=200,CONF=13,BW=104;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=dirname(fileURLToPath(import.meta.url));
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i]});return b.length>220?b:null;}catch{return null;}}

// beta al bar i: cov(retornos stock, retornos mercado)/var(mercado) en trailing BW semanas
function betaAt(bars,i,mktRetByT){const sr=[],mr=[];for(let k=Math.max(1,i-BW+1);k<=i;k++){const m=mktRetByT.get(bars[k].t);if(m==null)continue;sr.push(bars[k].c/bars[k-1].c-1);mr.push(m);}
  if(sr.length<30)return null;const ms=sr.reduce((a,b)=>a+b,0)/sr.length,mm=mr.reduce((a,b)=>a+b,0)/mr.length;
  let cov=0,vm=0;for(let j=0;j<sr.length;j++){cov+=(sr[j]-ms)*(mr[j]-mm);vm+=(mr[j]-mm)**2;}return vm?cov/vm:null;}

function gen(bars,need9,mktRetByT){const cl=bars.map(b=>b.c),ef=ema(cl,8),es=ema(cl,21),out=[];const td=need9?computeTDSetup(bars):null;let i=L200+1;
  while(i<bars.length-1){const gap=(ef[i]-es[i])/cl[i],gp=(ef[i-1]-es[i-1])/cl[i-1];const li=gap<0&&Math.abs(gap)<GAP&&gap>gp;
    if(!li){i++;continue;}if(need9){let h=false;for(let j=Math.max(0,i-CONF);j<=i;j++){if(td.bullSetup[j]===9){h=true;break;}}if(!h){i++;continue;}}
    const beta=betaAt(bars,i,mktRetByT);
    const ep=cl[i],stop=ep*(1-CAT);let ret=null,ej=bars.length-1;
    for(let j=i+1;j<bars.length;j++){const bear=ef[j-1]>=es[j-1]&&ef[j]<es[j];if(bars[j].l<=stop){ret=(stop/ep-1)-COST*2;ej=j;break;}if(bear){ret=(cl[j]/ep-1)-COST*2;ej=j;break;}}
    if(ret==null)ret=(cl[cl.length-1]/ep-1)-COST*2;out.push({t:bars[i].t,r:ret,beta});i=ej+1;}
  return out;}

const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const st=a=>{const rs=a.map(x=>x.r),n=rs.length;if(!n)return{n:0,pf:0,m:0,wr:0,med:0};const w=rs.filter(x=>x>0),l=rs.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return{n,pf:gl?Math.abs(gw/gl):99,m:rs.reduce((x,y)=>x+y,0)/n,wr:100*w.length/n,med:median(rs)};};
function trimTop(a,p){const rs=[...a.map(x=>x.r)].sort((x,y)=>y-x);const kept=rs.slice(Math.floor(rs.length*p));if(!kept.length)return 0;const w=kept.filter(x=>x>0),l=kept.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return gl?Math.abs(gw/gl):99;}
const sharpe=a=>{const rs=a.map(x=>x.r),m=rs.reduce((x,y)=>x+y,0)/rs.length,sd=Math.sqrt(rs.reduce((x,y)=>x+(y-m)**2,0)/rs.length);return sd?m/sd:0;};

(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8'));const tks=(uni.universe||uni).slice(0,250).map(u=>u.ticker);
  console.log('\n════ PILAR 3 — tilt de BAJA BETA sobre las señales (10y semanal) ════\n');
  // mercado = SPY
  const spy=await getW('SPY');const mktRetByT=new Map();for(let i=1;i<spy.length;i++)mktRetByT.set(spy[i].t,spy[i].c/spy[i-1].c-1);
  const A={ema:[],conf:[]};let ok=0;
  for(const t of tks){if(t==='SPY')continue;const b=await getW(t);await sleep(110);if(!b)continue;ok++;A.ema.push(...gen(b,false,mktRetByT));A.conf.push(...gen(b,true,mktRetByT));}
  console.log(`  ${ok} acciones\n`);
  for(const [name,arr] of [['EMA anticipado',A.ema],['CONFLUENCIA',A.conf]]){
    const withB=arr.filter(x=>x.beta!=null);const betas=withB.map(x=>x.beta).sort((a,b)=>a-b);
    const q1=betas[Math.floor(betas.length/3)],q2=betas[Math.floor(2*betas.length/3)];
    const low=withB.filter(x=>x.beta<=q1),mid=withB.filter(x=>x.beta>q1&&x.beta<=q2),high=withB.filter(x=>x.beta>q2);
    const row=(lbl,a,bavg)=>{const s=st(a);console.log(`  ${lbl.padEnd(22)} n ${String(s.n).padStart(4)} · β~${bavg} · WR ${s.wr.toFixed(0)}% · PF ${s.pf.toFixed(2)} · exp +${(s.m*100).toFixed(1)}% · MEDIANA ${s.med>=0?'+':''}${(s.med*100).toFixed(1)}% · sin-top5% ${trimTop(a,0.05).toFixed(2)} · Sharpe ${sharpe(a).toFixed(3)}`);};
    const bavg=a=>(a.reduce((x,y)=>x+y.beta,0)/a.length).toFixed(2);
    console.log(`── ${name} ──`);
    row('BAJA beta (T1)',low,bavg(low));
    row('MEDIA beta (T2)',mid,bavg(mid));
    row('ALTA beta (T3)',high,bavg(high));
    console.log('');
  }
  console.log('  BAB dice: baja beta = mejor Sharpe / menos riesgo (no necesariamente más retorno bruto).');
  console.log('  Buscamos: ¿la baja beta mejora robustez/Sharpe/drawdown de nuestras señales? = diversificador.\n');
})();
