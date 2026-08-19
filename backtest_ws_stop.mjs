#!/usr/bin/env node
// backtest_ws_stop.mjs — AÍSLA el efecto del STOP en WeeklySwing (DeMark setup-9).
//   Mismo conjunto de señales (TODOS los bullSetup==9, SIN filtro de riesgo, para que ambos stops
//   vean las MISMAS entradas). Se fija la SALIDA y se varía SOLO el stop:
//     stop A) setupLow  (mínimo del setup = el que usa el sistema en VIVO)
//     stop B) -18% plano
//   x dos reglas de salida: (1) cd13/52w (nativa)  ·  (2) setup-9 opuesto/52w
//   → 4 combos. Isolación limpia: misma señal, misma salida, solo cambia el stop.
//   Métricas escépticas: WR, PF, MEDIANA, PF-sin-top5%, %stop, año, WF. 250 large-caps, 10y.
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup, computeTDCountdown } from '../scanner/demark_calc.mjs';
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,TIME_W=52;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=dirname(fileURLToPath(import.meta.url));
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i]});return b.length>120?b:null;}catch{return null;}}

// stopMode: 'setuplow'|'cat18'  ·  exitMode: 'cd13'|'opp'
function trades(bars,stopMode,exitMode){
  const td=computeTDSetup(bars),cd=computeTDCountdown(bars,td),out=[];let i=0;
  while(i<bars.length-1){
    if(td.bullSetup[i]!==9||!td.bullSetupBars[i]){i++;continue;}
    const ep=bars[i].c;
    const setupLow=Math.min(...td.bullSetupBars[i].map(k=>bars[k].l));
    const stop = stopMode==='cat18' ? ep*(1-CAT) : setupLow;
    if(stop>=ep){i++;continue;}   // stop debe estar por debajo (setupLow raramente por encima)
    let ret=null,why='',exitJ=bars.length-1;
    for(let j=i+1;j<bars.length;j++){
      if(bars[j].l<=stop){ret=(stop/ep-1)*100-COST*200;why='stop';exitJ=j;break;}
      if(exitMode==='cd13'&&cd.bearCountdown[j]===13){ret=(bars[j].c/ep-1)*100-COST*200;why='exit';exitJ=j;break;}
      if(exitMode==='opp'&&td.bearSetup[j]===9){ret=(bars[j].c/ep-1)*100-COST*200;why='exit';exitJ=j;break;}
      if(j-i>=TIME_W){ret=(bars[j].c/ep-1)*100-COST*200;why='time';exitJ=j;break;}
    }
    if(ret==null){ret=(bars[bars.length-1].c/ep-1)*100-COST*200;why='open';}
    out.push({r:ret,t:bars[i].t,why});i=exitJ+1;
  }
  return out;
}
const yOf=t=>new Date(t*1000).getUTCFullYear();
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const st=a=>{const rs=a.map(x=>x.r),n=rs.length;if(!n)return{n:0,pf:0,m:0,wr:0,med:0};const w=rs.filter(x=>x>0),l=rs.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return{n,pf:gl?Math.abs(gw/gl):99,m:rs.reduce((x,y)=>x+y,0)/n,wr:100*w.length/n,med:median(rs)};};
function trimTop(a,pct){const rs=[...a.map(x=>x.r)].sort((x,y)=>y-x);const cut=Math.floor(rs.length*pct);const kept=rs.slice(cut);if(!kept.length)return{pf:0};const w=kept.filter(x=>x>0),l=kept.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return{pf:gl?Math.abs(gw/gl):99};}
const wf=a=>{if(a.length<8)return'—';const t0=Math.min(...a.map(x=>x.t)),t1=Math.max(...a.map(x=>x.t)),sp=(t1-t0)/4;return[0,1,2,3].map(k=>st(a.filter(x=>Math.min(3,Math.floor((x.t-t0)/sp))===k))).filter(x=>x.n>=5&&x.m>0).length+'/4';};

(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8'));const tks=(uni.universe||uni).slice(0,250).map(u=>u.ticker);
  console.log('\n════ AISLAR EL STOP en WeeklySwing (mismas señales, misma salida, solo cambia stop) ════\n');
  const acc={};for(const e of ['cd13','opp'])for(const s of ['setuplow','cat18'])acc[e+'_'+s]=[];
  let done=0,ok=0;
  for(const t of tks){const b=await getW(t);done++;if(done%50===0)process.stdout.write(`  …${done}/${tks.length}\n`);await sleep(110);if(!b)continue;ok++;
    for(const e of ['cd13','opp'])for(const s of ['setuplow','cat18'])acc[e+'_'+s].push(...trades(b,s,e));}
  console.log(`  ${ok} acciones\n`);
  const row=(lbl,a)=>{const s=st(a),t5=trimTop(a,0.05),stops=a.filter(x=>x.why==='stop').length;
    console.log(`  ${lbl.padEnd(34)} n ${String(s.n).padStart(4)} · WR ${s.wr.toFixed(0).padStart(2)}% · PF ${s.pf.toFixed(2)} · MEDIANA ${s.med>=0?'+':''}${s.med.toFixed(1)}% · sin-top5% ${t5.pf.toFixed(2)} · %stop ${(100*stops/s.n).toFixed(0)}% · WF ${wf(a)}`);};
  console.log('── SALIDA = countdown-13 / 52w (la NATIVA del sistema en vivo) ──');
  row('stop setupLow (VIVO actual)', acc['cd13_setuplow']);
  row('stop -18%', acc['cd13_cat18']);
  console.log('\n── SALIDA = setup-9 opuesto / 52w ──');
  row('stop setupLow', acc['opp_setuplow']);
  row('stop -18%', acc['opp_cat18']);
  console.log('\n── Año a año (expectancy media), salida nativa cd13 ──');
  const yrs=[...new Set(acc['cd13_setuplow'].concat(acc['cd13_cat18']).map(x=>yOf(x.t)))].sort();
  const line=(lbl,a)=>console.log('  '+lbl.padEnd(14)+yrs.map(y=>{const ss=st(a.filter(x=>yOf(x.t)===y));return `${String(y).slice(2)}:${ss.m>=0?'+':''}${ss.m.toFixed(0)}`;}).join(' '));
  line('setupLow',acc['cd13_setuplow']);line('-18%',acc['cd13_cat18']);
  console.log('\n  Isolación: filas del MISMO bloque = mismas señales y misma salida, SOLO cambia el stop.');
})();
