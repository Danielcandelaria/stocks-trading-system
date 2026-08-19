#!/usr/bin/env node
// backtest_demark.mjs — ¿qué edge da NUESTRO DeMark (el que ya está verificado vs TV) en acciones?
//   Usa scanner/demark_calc.mjs (computeTDSetup/computeTDCountdown = réplica fiel del Pine Mantilla).
//   Entradas LONG probadas:
//     A) BUY SETUP-9  (suelo de agotamiento)
//     B) BUY COUNTDOWN-13 (agotamiento profundo)
//   Salidas: 'native' (bearCountdown-13 / 52 sem / stop = mínimo del setup, con filtro de riesgo 8-30%)
//            'cat18'  (stop -18% plano, para comparar manzana-a-manzana con EMACross)
//   MISMA lupa escéptica que EMACross: WR, PF, MEDIANA, PF-sin-top5%, expectancy por año, %stop, WF.
//   250 large-caps, 10y semanal, coste 0.06%/lado. Universo = supervivientes de HOY (sesgo, como EMACross).
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup, computeTDCountdown, getTDST } from '../scanner/demark_calc.mjs';
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,TIME_W=52,MINR=0.08,MAXR=0.30;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=dirname(fileURLToPath(import.meta.url));
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null&&q.open[i]!=null)b.push({t:d.timestamp[i],o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i]});return b.length>120?b:null;}catch{return null;}}

// entry: 'setup9' | 'cd13'  ·  exitMode: 'native' | 'cat18'
// UNA posición a la vez por acción (igual que EMACross): tras entrar, se salta a la barra de salida.
function trades(bars,entry,exitMode){
  const td=computeTDSetup(bars), cd=computeTDCountdown(bars,td), out=[];
  const trig = entry==='setup9' ? td.bullSetup : cd.bullCountdown;
  const trigVal = entry==='setup9' ? 9 : 13;
  let i=0;
  while(i<bars.length-1){
    if(trig[i]!==trigVal){ i++; continue; }
    let stop, entryPx=bars[i].c;
    if(exitMode==='cat18'){ stop=entryPx*(1-CAT); }
    else {
      let lo=Infinity;
      if(entry==='setup9'&&td.bullSetupBars[i]){ for(const k of td.bullSetupBars[i]) lo=Math.min(lo,bars[k].l); }
      else { for(let k=Math.max(0,i-13);k<=i;k++) lo=Math.min(lo,bars[k].l); }
      stop=lo;
      const risk=(entryPx-stop)/entryPx;
      if(!(risk>MINR&&risk<MAXR)){ i++; continue; }   // filtro de riesgo (native)
    }
    let ret=null, why='', exitJ=bars.length-1;
    for(let j=i+1;j<bars.length;j++){
      if(bars[j].l<=stop){ ret=(stop/entryPx-1)*100-COST*200; why='stop'; exitJ=j; break; }
      if(exitMode==='native' && cd.bearCountdown[j]===13){ ret=(bars[j].c/entryPx-1)*100-COST*200; why='cd13'; exitJ=j; break; }
      if(exitMode==='cat18' && td.bearSetup[j]===9){ ret=(bars[j].c/entryPx-1)*100-COST*200; why='opp'; exitJ=j; break; }
      if(j-i>=TIME_W){ ret=(bars[j].c/entryPx-1)*100-COST*200; why='time'; exitJ=j; break; }
    }
    if(ret==null){ ret=(bars[bars.length-1].c/entryPx-1)*100-COST*200; why='open'; }
    out.push({r:ret,t:bars[i].t,why});
    i = exitJ + 1;   // no reentrar hasta después de cerrar (una posición a la vez)
  }
  return out;
}
const yearOf=t=>new Date(t*1000).getUTCFullYear();
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const st=a=>{const rs=a.map(x=>x.r),n=rs.length;if(!n)return{n:0,pf:0,m:0,wr:0,sum:0,med:0};const w=rs.filter(x=>x>0),l=rs.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return{n,pf:gl?Math.abs(gw/gl):99,m:rs.reduce((x,y)=>x+y,0)/n,wr:100*w.length/n,sum:rs.reduce((x,y)=>x+y,0),med:median(rs)};};
function trimTop(a,pct){const rs=[...a.map(x=>x.r)].sort((x,y)=>y-x);const cut=Math.floor(rs.length*pct);const kept=rs.slice(cut);const w=kept.filter(x=>x>0),l=kept.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return kept.length?{pf:gl?Math.abs(gw/gl):99,m:kept.reduce((x,y)=>x+y,0)/kept.length}:{pf:0,m:0};}
const wf=a=>{if(a.length<8)return'—';const t0=Math.min(...a.map(x=>x.t)),t1=Math.max(...a.map(x=>x.t)),sp=(t1-t0)/4;return[0,1,2,3].map(k=>st(a.filter(x=>Math.min(3,Math.floor((x.t-t0)/sp))===k))).filter(x=>x.n>=5&&x.m>0).length+'/4';};

(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8'));const tks=(uni.universe||uni).slice(0,250).map(u=>u.ticker);
  console.log('\n════ NUESTRO DeMark (setup-9 / countdown-13) en ACCIONES — 10y semanal ════\n');
  const acc={s9n:[],s9c:[],c13n:[]};let done=0,ok=0;
  for(const t of tks){const b=await getW(t);done++;if(done%50===0)process.stdout.write(`  …${done}/${tks.length}\n`);await sleep(110);if(!b)continue;ok++;
    acc.s9n.push(...trades(b,'setup9','native'));
    acc.s9c.push(...trades(b,'setup9','cat18'));
    acc.c13n.push(...trades(b,'cd13','native'));}
  console.log(`  ${ok} acciones con datos\n`);
  const row=(lbl,a)=>{const s=st(a);const t5=trimTop(a,0.05);const stops=a.filter(x=>x.why==='stop').length;
    console.log(`── ${lbl} ──`);
    console.log(`  trades ${s.n} · WR ${s.wr.toFixed(0)}% · PF ${s.pf.toFixed(2)} · exp +${s.m.toFixed(2)}% · MEDIANA ${s.med>=0?'+':''}${s.med.toFixed(2)}% · Σ ${s.sum>=0?'+':''}${s.sum.toFixed(0)}%`);
    console.log(`  PF sin top5% ${t5.pf.toFixed(2)} · exp sin top5% ${t5.m>=0?'+':''}${t5.m.toFixed(1)}% · %stop ${(100*stops/s.n).toFixed(0)}% · WF ${wf(a)}`);
    const yrs=[...new Set(a.map(x=>yearOf(x.t)))].sort();
    console.log(`  por año: `+yrs.map(y=>{const ss=st(a.filter(x=>yearOf(x.t)===y));return `${y}:${ss.m>=0?'+':''}${ss.m.toFixed(0)}%(${ss.n})`;}).join(' ')+'\n');};
  row('SETUP-9 · salida nativa (cd13/52w/stop=setupLow)', acc.s9n);
  row('SETUP-9 · stop -18% (comparable a EMACross)', acc.s9c);
  row('COUNTDOWN-13 · salida nativa', acc.c13n);
  console.log('  Compara vs EMACross: PF 2.35 / MEDIANA -3.0% / PF-sin-top5% 1.08 / pierde 2022.');
  console.log('  Recordatorio: mismo sesgo de supervivencia que EMACross.\n');
})();
