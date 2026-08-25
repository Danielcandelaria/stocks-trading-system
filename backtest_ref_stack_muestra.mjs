#!/usr/bin/env node
// backtest_ref_stack_muestra.mjs — REFINAMIENTO: ampliar la MUESTRA del tier STACK.
//   STACK = CONFLUENCIA (cruce EMA8/21 anticipado + Buy Setup-9 en las <=8 velas previas)
//           + precio DEBAJO de su EMA200 semanal en la vela de entrada.
//   Es el tier de máxima convicción, pero con 250 acciones sólo tenía n=29 (frágil).
//   Pregunta: con 400+ acciones, ¿aguanta PF~8 y mediana positiva, o se diluye al baseline?
//   El usuario YA tiene 2 posiciones reales (BR, LYB) en este tier → es crítico.
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup } from '../scanner/demark_calc.mjs';
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,GAP=0.012,CONF=8;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=dirname(fileURLToPath(import.meta.url));
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i]});return b.length>120?b:null;}catch{return null;}}

// modo: 'base' EMA anticipado solo | 'conf' +setup9 en <=CONF | 'stack' conf + precio<EMA200
function trades(bars,mode){const cl=bars.map(b=>b.c),ef=ema(cl,8),es=ema(cl,21),e200=ema(cl,200),out=[];
  const td=mode!=='base'?computeTDSetup(bars):null;let i=22;
  while(i<bars.length-1){
    const gap=(ef[i]-es[i])/cl[i],gp=(ef[i-1]-es[i-1])/cl[i-1];const li=gap<0&&Math.abs(gap)<GAP&&gap>gp;
    if(!li){i++;continue;}
    if(mode!=='base'){ let has9=false; for(let j=Math.max(0,i-CONF);j<=i;j++){ if(td.bullSetup[j]===9){has9=true;break;} } if(!has9){i++;continue;} }
    if(mode==='stack'){ if(!(cl[i]<e200[i])){i++;continue;} }   // precio DEBAJO de su EMA200
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
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8'));const all=(uni.universe||uni).map(u=>u.ticker);
  const N=Math.min(all.length,450);const tks=all.slice(0,N);
  console.log(`\n════ STACK: ampliar muestra (${N} tickers pedidos, 10y semanal, stop -18%, CONF≤${CONF}) ════\n`);
  // Guardamos por-ticker para poder recortar a los primeros 250 (config actual) y comparar
  const perTk={base:[],conf:[],stack:[]};const first250={base:[],conf:[],stack:[]};let ok=0,idx=0;
  for(const t of tks){const b=await getW(t);await sleep(110);idx++;if(!b)continue;ok++;
    for(const m of ['base','conf','stack']){const tr=trades(b,m);perTk[m].push(...tr);if(idx<=250)first250[m].push(...tr);}
  }
  console.log(`  ${ok}/${N} acciones con datos válidos\n`);
  const row=(lbl,a)=>{const s=st(a),stops=a.filter(x=>x.why==='stop').length;
    console.log(`  ${lbl.padEnd(34)} n ${String(s.n).padStart(4)} · WR ${s.wr.toFixed(0)}% · PF ${s.pf.toFixed(2)} · exp +${s.m.toFixed(2)}% · MEDIANA ${s.med>=0?'+':''}${s.med.toFixed(1)}% · sin-top5% ${trimTop(a,0.05).toFixed(2)} · %stop ${s.n?(100*stops/s.n).toFixed(0):'0'}% · WF ${wf(a)}`);};
  console.log('── CONFIG ACTUAL (primeros 250 tickers) ──');
  row('  baseline EMA anticipado',first250.base);
  row('  CONFLUENCIA (+9 ≤8v)',first250.conf);
  row('  STACK (conf + <EMA200)',first250.stack);
  console.log(`\n── MUESTRA AMPLIADA (${ok} tickers) ──`);
  row('  baseline EMA anticipado',perTk.base);
  row('  CONFLUENCIA (+9 ≤8v)',perTk.conf);
  row('  STACK (conf + <EMA200)',perTk.stack);
  console.log('\n── STACK año a año (expectancy media / n) ──');
  const yrs=[...new Set(perTk.stack.map(x=>yOf(x.t)))].sort();
  console.log('  '+yrs.map(y=>{const ss=st(perTk.stack.filter(x=>yOf(x.t)===y));return `${String(y).slice(2)}:${ss.n?(ss.m>=0?'+':'')+ss.m.toFixed(0)+'/'+ss.n:'·'}`;}).join('  '));
  console.log('\n  ¿El STACK mantiene su edge al ampliar muestra, o converge al baseline?');
})();
