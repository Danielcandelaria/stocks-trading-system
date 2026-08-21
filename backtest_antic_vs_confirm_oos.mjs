#!/usr/bin/env node
// backtest_antic_vs_confirm_oos.mjs — RE-EXAMINAR anticipado vs confirmado POR RÉGIMEN (OOS).
//   El full-sample dio ~equivalentes. ¿Aguanta en las dos mitades temporales? ¿Uno es más robusto
//   en el régimen malo? Compara EMA sola y CONFLUENCIA (EMA+9≤8), anticipado vs confirmado, stop -18%.
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup } from '../scanner/demark_calc.mjs';
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,GAP=0.012,L200=200,CONF=8;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=dirname(fileURLToPath(import.meta.url));
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i]});return b.length>220?b:null;}catch{return null;}}
// mode:'antic'|'confirm' · need9:bool
function trades(bars,mode,need9){const cl=bars.map(b=>b.c),ef=ema(cl,8),es=ema(cl,21),out=[];const td=need9?computeTDSetup(bars):null;let i=L200+1;
  while(i<bars.length-1){const gap=(ef[i]-es[i])/cl[i],gp=(ef[i-1]-es[i-1])/cl[i-1];
    const bull=ef[i-1]<=es[i-1]&&ef[i]>es[i];const li=gap<0&&Math.abs(gap)<GAP&&gap>gp;
    const trig=mode==='antic'?li:bull;if(!trig){i++;continue;}
    if(need9){let h=false;for(let j=Math.max(0,i-CONF);j<=i;j++){if(td.bullSetup[j]===9){h=true;break;}}if(!h){i++;continue;}}
    const ep=cl[i],stop=ep*(1-CAT);let ret=null,ej=bars.length-1;
    for(let j=i+1;j<bars.length;j++){const bear=ef[j-1]>=es[j-1]&&ef[j]<es[j];if(bars[j].l<=stop){ret=(stop/ep-1)*100-COST*200;ej=j;break;}if(bear){ret=(cl[j]/ep-1)*100-COST*200;ej=j;break;}}
    if(ret==null)ret=(cl[cl.length-1]/ep-1)*100-COST*200;out.push({r:ret,t:bars[i].t});i=ej+1;}
  return out;}
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const st=a=>{const rs=a.map(x=>x.r),n=rs.length;if(!n)return{n:0,pf:0,m:0,wr:0,med:0};const w=rs.filter(x=>x>0),l=rs.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return{n,pf:gl?Math.abs(gw/gl):99,m:rs.reduce((x,y)=>x+y,0)/n,wr:100*w.length/n,med:median(rs)};};
function trimTop(a,p){const rs=[...a.map(x=>x.r)].sort((x,y)=>y-x);const kept=rs.slice(Math.floor(rs.length*p));if(!kept.length)return 0;const w=kept.filter(x=>x>0),l=kept.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return gl?Math.abs(gw/gl):99;}

(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8'));const tks=(uni.universe||uni).slice(0,250).map(u=>u.ticker);
  console.log('\n════ ANTICIPADO vs CONFIRMADO por RÉGIMEN (2 mitades, stop -18%) ════\n');
  const A={ea:[],ec:[],ca:[],cc:[]};let ok=0;
  for(const t of tks){const b=await getW(t);await sleep(110);if(!b)continue;ok++;
    A.ea.push(...trades(b,'antic',false));A.ec.push(...trades(b,'confirm',false));
    A.ca.push(...trades(b,'antic',true));A.cc.push(...trades(b,'confirm',true));}
  const allT=[...A.ea,...A.ec].map(x=>x.t).sort((a,b)=>a-b);const mid=allT[Math.floor(allT.length/2)];
  console.log(`  ${ok} acciones · corte temporal en la mitad\n`);
  const half=(a,which)=>which==='H1'?a.filter(x=>x.t<mid):a.filter(x=>x.t>=mid);
  const row=(lbl,a)=>{const H=['H1','H2'].map(h=>st(half(a,h)));const T=st(a);
    console.log(`  ${lbl.padEnd(22)} FULL PF ${T.pf.toFixed(2)} med ${T.med>=0?'+':''}${T.med.toFixed(1)}% | H1(2016-21) PF ${H[0].pf.toFixed(2)} med ${H[0].med>=0?'+':''}${H[0].med.toFixed(1)}% n${H[0].n} | H2(2021-26) PF ${H[1].pf.toFixed(2)} med ${H[1].med>=0?'+':''}${H[1].med.toFixed(1)}% n${H[1].n}`);};
  console.log('── EMA sola ──');
  row('ANTICIPADO',A.ea); row('CONFIRMADO',A.ec);
  console.log('\n── CONFLUENCIA (EMA + 9≤8) ──');
  row('ANTICIPADO',A.ca); row('CONFIRMADO',A.cc);
  console.log('\n  Clave: ¿cuál aguanta MEJOR en H1 (régimen malo)? Ahí se ve cuál es más robusto para dinero real.\n');
})();
