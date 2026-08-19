#!/usr/bin/env node
// backtest_daily.mjs — ¿el sistema (semanal) transfiere a DIARIO?
//   Mismos motores en velas DIARIAS: EMA8/21 (anticip/confirm), DeMark setup-9, confluencia, stack.
//   Stop -18% (mismo que semanal, para comparar; ⚠️ en diario la vol es menor → probablemente ancho).
//   Salida = cruce contrario. Confluencia: setup-9 en las últimas CONFD velas diarias.
//   Lupa: n, WR, PF, MEDIANA, exp, sin-top5%, duración media (días), WF. 5 años diario, 200 large-caps.
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup } from '../scanner/demark_calc.mjs';
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,GAP=0.012,L200=200,CONFD=20;
const SAMPLE=+(process.argv[2]||200);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=dirname(fileURLToPath(import.meta.url));
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getD(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=5y&interval=1d`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i]});return b.length>260?b:null;}catch{return null;}}

// mode: 'antic'|'confirm'|'dem'  · needs9: exigir setup-9 reciente · needBelow: exigir debajo EMA200
function trades(bars,mode,{need9=false,needBelow=false}={}){const cl=bars.map(b=>b.c),ef=ema(cl,8),es=ema(cl,21),el=ema(cl,L200),out=[];
  const td=(need9||mode==='dem')?computeTDSetup(bars):null;let i=L200+1;
  while(i<bars.length-1){
    let trig;
    if(mode==='dem') trig=td.bullSetup[i]===9;
    else{const gap=(ef[i]-es[i])/cl[i],gp=(ef[i-1]-es[i-1])/cl[i-1];
      trig = mode==='antic' ? (gap<0&&Math.abs(gap)<GAP&&gap>gp) : (ef[i-1]<=es[i-1]&&ef[i]>es[i]);}
    if(!trig){i++;continue;}
    if(need9){let h=false;for(let j=Math.max(0,i-CONFD);j<=i;j++){if(td.bullSetup[j]===9){h=true;break;}}if(!h){i++;continue;}}
    if(needBelow && !(cl[i]<el[i])){i++;continue;}
    const ep=cl[i],stop=ep*(1-CAT);let ret=null,exitJ=bars.length-1;
    for(let j=i+1;j<bars.length;j++){
      const bear=ef[j-1]>=es[j-1]&&ef[j]<es[j];
      if(bars[j].l<=stop){ret=(stop/ep-1)*100-COST*200;exitJ=j;break;}
      if(mode==='dem'){if(td.bearSetup[j]===9){ret=(cl[j]/ep-1)*100-COST*200;exitJ=j;break;}if(j-i>=252){ret=(cl[j]/ep-1)*100-COST*200;exitJ=j;break;}}
      else if(bear){ret=(cl[j]/ep-1)*100-COST*200;exitJ=j;break;}}
    if(ret==null){ret=(cl[cl.length-1]/ep-1)*100-COST*200;exitJ=bars.length-1;}
    out.push({r:ret,t:bars[i].t,hold:exitJ-i});i=exitJ+1;}
  return out;}
const yOf=t=>new Date(t*1000).getUTCFullYear();
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const st=a=>{const rs=a.map(x=>x.r),n=rs.length;if(!n)return{n:0,pf:0,m:0,wr:0,med:0,hold:0};const w=rs.filter(x=>x>0),l=rs.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return{n,pf:gl?Math.abs(gw/gl):99,m:rs.reduce((x,y)=>x+y,0)/n,wr:100*w.length/n,med:median(rs),hold:median(a.map(x=>x.hold))};};
function trimTop(a,p){const rs=[...a.map(x=>x.r)].sort((x,y)=>y-x);const kept=rs.slice(Math.floor(rs.length*p));if(!kept.length)return 0;const w=kept.filter(x=>x>0),l=kept.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return gl?Math.abs(gw/gl):99;}
const wf=a=>{if(a.length<8)return'—';const t0=Math.min(...a.map(x=>x.t)),t1=Math.max(...a.map(x=>x.t)),sp=(t1-t0)/4;return[0,1,2,3].map(k=>st(a.filter(x=>Math.min(3,Math.floor((x.t-t0)/sp))===k))).filter(x=>x.n>=5&&x.m>0).length+'/4';};

(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8'));const tks=(uni.universe||uni).slice(0,SAMPLE).map(u=>u.ticker);
  console.log('\n════ MISMO SISTEMA en DIARIO (5 años, stop -18%, salida cruce) ════\n');
  const C={antic:[],confirm:[],dem:[],conf:[],stack:[]};let ok=0;
  for(const t of tks){const b=await getD(t);await sleep(110);if(!b)continue;ok++;
    C.antic.push(...trades(b,'antic'));
    C.confirm.push(...trades(b,'confirm'));
    C.dem.push(...trades(b,'dem'));
    C.conf.push(...trades(b,'antic',{need9:true}));
    C.stack.push(...trades(b,'antic',{need9:true,needBelow:true}));}
  console.log(`  ${ok} acciones\n`);
  const row=(lbl,a)=>{const s=st(a);console.log(`  ${lbl.padEnd(28)} n ${String(s.n).padStart(5)} · WR ${s.wr.toFixed(0).padStart(2)}% · PF ${s.pf.toFixed(2)} · exp ${s.m>=0?'+':''}${s.m.toFixed(2)}% · MEDIANA ${s.med>=0?'+':''}${s.med.toFixed(1)}% · dur ${s.hold}d · sin-top5% ${trimTop(a,0.05).toFixed(2)} · WF ${wf(a)}`);};
  row('EMA anticipado',C.antic);
  row('EMA confirmado',C.confirm);
  row('DeMark setup-9',C.dem);
  row('Confluencia (EMA+9)',C.conf);
  row('⭐⭐ STACK (conf+debajo200)',C.stack);
  console.log('\n  Recordatorio: en diario hay MUCHAS más señales y ruido; el stop -18% probablemente sea ancho.');
  console.log('  Comparar contra SEMANAL: EMA 2.35/mediana -3% · DeMark 2.81/+9.4% · conf 4.28 · stack sin-top5% 3.64.\n');
})();
