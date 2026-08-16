#!/usr/bin/env node
// backtest_weekly_filter.mjs — ¿mejora WeeklySwing si se filtra por TENDENCIA?
// Duda real: el Setup-9 semanal compra en plena caída (EMAs bajistas). ¿Conviene exigir
// que la tendencia de fondo siga siendo alcista, como hace el DeMark diario?
// Variantes: sin filtro (actual) · precio>EMA30w · precio>EMA50w · EMA10w>EMA30w · precio>SMA200w
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup, computeTDCountdown } from '../scanner/demark_calc.mjs';
import { getWeeklyBars, ema } from './weekly_bars.mjs';
const COST=0.0005, MIN_STOP=0.08, MAX_STOP=0.30, TIME_W=52, SAMPLE=+(process.argv[2]||250);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=dirname(fileURLToPath(import.meta.url));
const sma=(cl,p)=>cl.map((_,i)=>i<p-1?null:cl.slice(i-p+1,i+1).reduce((a,b)=>a+b,0)/p);

function run(bars, filterFn){
  const td=computeTDSetup(bars), cd=computeTDCountdown(bars,td);
  const cl=bars.map(b=>b.c);
  const ctx={ e10:ema(cl,10), e30:ema(cl,30), e50:ema(cl,50), s200:sma(cl,200), cl };
  const out=[];
  for(let i=0;i<bars.length-1;i++){
    if(td.bullSetup[i]!==9||!td.bullSetupBars[i])continue;
    if(!filterFn(ctx,i))continue;
    const stop=Math.min(...td.bullSetupBars[i].map(k=>bars[k].l));
    const entry=bars[i+1].o*(1+COST); const risk=entry-stop;
    if(risk<=0||risk/entry>MAX_STOP||risk/entry<MIN_STOP)continue;
    let ret=null;
    for(let j=i+1;j<bars.length;j++){
      if(bars[j].l<=stop){ret=(stop*(1-COST)/entry-1)*100;break;}
      if(cd.bearCountdown[j]===13){ret=(bars[j].c*(1-COST)/entry-1)*100;break;}
      if(j-(i+1)>=TIME_W){ret=(bars[j].c*(1-COST)/entry-1)*100;break;}
    }
    if(ret==null)ret=(cl[cl.length-1]*(1-COST)/entry-1)*100;
    out.push({ret,t:bars[i].t});
  }
  return out;
}
function stat(a){const rs=a.map(x=>x.ret),n=rs.length;if(!n)return{n:0,pf:0,mean:0,wr:0,sum:0};
  const s=rs.reduce((x,y)=>x+y,0),w=rs.filter(x=>x>0),l=rs.filter(x=>x<=0),gl=l.reduce((x,y)=>x+y,0);
  return{n,sum:s,mean:s/n,wr:100*w.length/n,pf:gl?Math.abs(w.reduce((x,y)=>x+y,0)/gl):0};}
(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8')).universe.slice(0,SAMPLE).map(u=>u.ticker);
  const FILTERS=[
    ['SIN filtro (actual)', ()=>true],
    ['precio > EMA30 sem',  (c,i)=>c.e30[i]!=null&&c.cl[i]>c.e30[i]],
    ['precio > EMA50 sem',  (c,i)=>c.e50[i]!=null&&c.cl[i]>c.e50[i]],
    ['EMA10 > EMA30 sem',   (c,i)=>c.e10[i]!=null&&c.e30[i]!=null&&c.e10[i]>c.e30[i]],
    ['precio > SMA200 sem', (c,i)=>c.s200[i]!=null&&c.cl[i]>c.s200[i]],
  ];
  const data=FILTERS.map(()=>[]); let done=0;
  for(const tk of uni){ const b=await getWeeklyBars(tk,{range:'10y',ohlc:true}); done++;
    if(done%50===0)process.stdout.write(`  …${done}\n`); await sleep(100); if(!b||b.length<80)continue;
    FILTERS.forEach(([,fn],k)=>{ for(const t of run(b,fn)) data[k].push(t); }); }
  const all=data.flat(); const tmin=Math.min(...all.map(t=>t.t)), span=(Math.max(...all.map(t=>t.t))-tmin)/4;
  const wf=a=>[0,1,2,3].map(w=>stat(a.filter(t=>Math.min(3,Math.floor((t.t-tmin)/span))===w))).filter(x=>x.n>=5&&x.mean>0).length;
  console.log(`\n══ WeeklySwing — ¿filtrar por TENDENCIA? · ${uni.length} large-caps 10y ══\n`);
  console.log('  '+'filtro'.padEnd(22)+'n'.padStart(6)+'WR'.padStart(6)+'PF'.padStart(7)+'exp%'.padStart(9)+'Σret%'.padStart(10)+'  WF');
  console.log('  '+'─'.repeat(64));
  FILTERS.forEach(([name],k)=>{ const s=stat(data[k]);
    console.log('  '+name.padEnd(22)+String(s.n).padStart(6)+(s.wr.toFixed(0)+'%').padStart(6)+s.pf.toFixed(2).padStart(7)+
      (('+'+s.mean.toFixed(2))).padStart(9)+(('+'+s.sum.toFixed(0))).padStart(10)+`   ${wf(data[k])}/4`); });
  console.log('');
})();
