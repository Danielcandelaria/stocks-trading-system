#!/usr/bin/env node
// backtest_ws_trail_demark.mjs — ¿Mejora WeeklySwing un TRAILING stop ratcheting low[i-4]?
//   Idea sección 14 del doc MPB D913 (Carlos Mantilla): stop = MAX(stop_previo, low[i-4]),
//   un trailing por mínimos de swing que SOLO SUBE. Nuestro WeeklySwing usa hoy stop FIJO=setupLow.
//   Isolación limpia: MISMAS señales (bullSetup==9), MISMA salida (cd13/52w y opp/52w), solo cambia el stop:
//     A) setupLow  FIJO           (VIVO actual)
//     B) -18% FIJO                (referencia)
//     C) setupLow + ratchet low[i-4]  (idea nueva: floor probado + trailing sección 14)
//     D) -18% + ratchet low[i-4]
//   Métricas escépticas: WR, PF, MEDIANA, PF-sin-top5%, %stop, WF 4/4 y 2 mitades OOS. 250 large-caps, 10y.
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup, computeTDCountdown } from '../scanner/demark_calc.mjs';
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,TIME_W=52;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=dirname(fileURLToPath(import.meta.url));
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i]});return b.length>120?b:null;}catch{return null;}}

// stopMode: 'setuplow'|'cat18'|'trail_sl'|'trail_18'   ·  exitMode: 'cd13'|'opp'
function trades(bars,stopMode,exitMode){
  const td=computeTDSetup(bars),cd=computeTDCountdown(bars,td),out=[];let i=0;
  const ratchet = stopMode.startsWith('trail');
  const wideInit = stopMode.endsWith('18');
  while(i<bars.length-1){
    if(td.bullSetup[i]!==9||!td.bullSetupBars[i]){i++;continue;}
    const ep=bars[i].c;
    const setupLow=Math.min(...td.bullSetupBars[i].map(k=>bars[k].l));
    let stop = wideInit ? ep*(1-CAT) : setupLow;
    if(stop>=ep){i++;continue;}   // stop inicial debe estar por debajo
    let ret=null,why='',exitJ=bars.length-1;
    for(let j=i+1;j<bars.length;j++){
      if(ratchet && j-4>=0){ const cand=bars[j-4].l; if(cand<ep && cand>stop) stop=cand; } // solo sube, nunca por encima de entrada
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
const st=a=>{const rs=a.map(x=>x.r),n=rs.length;if(!n)return{n:0,pf:0,m:0,wr:0,med:0,sum:0};const w=rs.filter(x=>x>0),l=rs.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return{n,pf:gl?Math.abs(gw/gl):99,m:rs.reduce((x,y)=>x+y,0)/n,wr:100*w.length/n,med:median(rs),sum:rs.reduce((x,y)=>x+y,0)};};
function trimTop(a,pct){const rs=[...a.map(x=>x.r)].sort((x,y)=>y-x);const cut=Math.floor(rs.length*pct);const kept=rs.slice(cut);if(!kept.length)return{pf:0};const w=kept.filter(x=>x>0),l=kept.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return{pf:gl?Math.abs(gw/gl):99};}
const wf=a=>{if(a.length<8)return'—';const t0=Math.min(...a.map(x=>x.t)),t1=Math.max(...a.map(x=>x.t)),sp=(t1-t0)/4;return[0,1,2,3].map(k=>st(a.filter(x=>Math.min(3,Math.floor((x.t-t0)/sp))===k))).filter(x=>x.n>=5&&x.m>0).length+'/4';};

(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8'));const tks=(uni.universe||uni).slice(0,250).map(u=>u.ticker);
  console.log('\n════ TRAILING low[i-4] (sección 14 MPB) vs stop FIJO en WeeklySwing ════');
  console.log('  Mismas señales (bullSetup==9), misma salida, SOLO cambia el stop · 250 large-caps · 10y semanal · coste 0.06%/lado\n');
  const modes=['setuplow','cat18','trail_sl','trail_18'];
  const acc={};for(const e of ['cd13','opp'])for(const s of modes)acc[e+'_'+s]=[];
  let done=0,ok=0;
  for(const t of tks){const b=await getW(t);done++;if(done%50===0)process.stdout.write(`  …${done}/${tks.length}\n`);await sleep(110);if(!b)continue;ok++;
    for(const e of ['cd13','opp'])for(const s of modes)acc[e+'_'+s].push(...trades(b,s,e));}
  console.log(`  ${ok} acciones\n`);
  const row=(lbl,a)=>{const s=st(a),t5=trimTop(a,0.05),stops=a.filter(x=>x.why==='stop').length;
    // 2 mitades OOS
    const ts=[...a].sort((x,y)=>x.t-y.t);const mid=ts.length?ts[ts.length>>1].t:0;
    const h1=st(a.filter(x=>x.t<mid)),h2=st(a.filter(x=>x.t>=mid));
    console.log(`  ${lbl.padEnd(30)} n ${String(s.n).padStart(4)} · WR ${s.wr.toFixed(0).padStart(2)}% · PF ${s.pf.toFixed(2)} · MED ${s.med>=0?'+':''}${s.med.toFixed(1)}% · media ${s.m>=0?'+':''}${s.m.toFixed(1)}% · sinTop5% ${t5.pf.toFixed(2)} · %stop ${(100*stops/s.n).toFixed(0)}% · WF ${wf(a)}`);
    console.log(`  ${''.padEnd(30)}   OOS  mit1 PF ${h1.pf.toFixed(2)}/med ${h1.med>=0?'+':''}${h1.med.toFixed(1)}%  ·  mit2 PF ${h2.pf.toFixed(2)}/med ${h2.med>=0?'+':''}${h2.med.toFixed(1)}%`);};
  console.log('── SALIDA = countdown-13 / 52w (la NATIVA del sistema en vivo) ──');
  row('A) setupLow FIJO (VIVO)', acc['cd13_setuplow']);
  row('B) -18% FIJO', acc['cd13_cat18']);
  row('C) setupLow + trail low[i-4]', acc['cd13_trail_sl']);
  row('D) -18% + trail low[i-4]', acc['cd13_trail_18']);
  console.log('\n── SALIDA = setup-9 opuesto / 52w ──');
  row('A) setupLow FIJO', acc['opp_setuplow']);
  row('C) setupLow + trail low[i-4]', acc['opp_trail_sl']);
  console.log('\n  Isolación: dentro de cada bloque, mismas señales y misma salida → SOLO cambia el stop.');
  console.log('  El trailing MEJORA si sube PF/mediana/sinTop5% o baja %stop SIN hundir Σ, en AMBAS mitades.\n');
})();
