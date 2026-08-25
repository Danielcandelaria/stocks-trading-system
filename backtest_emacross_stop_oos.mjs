#!/usr/bin/env node
// backtest_emacross_stop_oos.mjs — Barrido de stop para EMACross + verificación OOS por régimen.
//   Motor: EMA 8/21 semanal, entrada ANTICIPADA (gap<1.2% convergiendo), salida cruce contrario.
//   Barre stop -10/-12/-15/-18/-22/-25/-30%. Full-sample + OOS (2 mitades temporales).
//   Capas: base, confluencia (EMA+setup9≤8v), stack (conf+debajo EMA200).
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup } from '../scanner/demark_calc.mjs';
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,GAP=0.012,L200=200,CONF=8;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=dirname(fileURLToPath(import.meta.url));
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i]});return b.length>220?b:null;}catch{return null;}}

function trades(bars,layer,cat){
  const cl=bars.map(b=>b.c),ef=ema(cl,8),es=ema(cl,21),el=ema(cl,L200),out=[];
  const need9=(layer!=='base');const td=need9?computeTDSetup(bars):null;let i=L200+1;
  while(i<bars.length-1){
    const gap=(ef[i]-es[i])/cl[i],gp=(ef[i-1]-es[i-1])/cl[i-1];
    const li=gap<0&&Math.abs(gap)<GAP&&gap>gp;
    if(!li){i++;continue;}
    if(need9){let h=false;for(let j=Math.max(0,i-CONF);j<=i;j++){if(td.bullSetup[j]===9){h=true;break;}}if(!h){i++;continue;}}
    if(layer==='stack'&&!(cl[i]<el[i])){i++;continue;}
    const ep=cl[i],stop=ep*(1-cat);let ret=null,ej=bars.length-1;
    for(let j=i+1;j<bars.length;j++){
      const bear=ef[j-1]>=es[j-1]&&ef[j]<es[j];
      if(bars[j].l<=stop){ret=(stop/ep-1)*100-COST*200;ej=j;break;}
      if(bear){ret=(cl[j]/ep-1)*100-COST*200;ej=j;break;}
    }
    if(ret==null)ret=(cl[cl.length-1]/ep-1)*100-COST*200;
    out.push({r:ret,t:bars[i].t});i=ej+1;
  }
  return out;
}
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const st=a=>{const rs=a.map(x=>x.r),n=rs.length;if(!n)return{n:0,pf:0,med:0,wr:0};const w=rs.filter(x=>x>0),l=rs.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return{n,pf:gl?Math.abs(gw/gl):99,med:median(rs),wr:100*w.length/n};};
function trimTop(a,p){const rs=[...a.map(x=>x.r)].sort((x,y)=>y-x);const kept=rs.slice(Math.floor(rs.length*p));if(!kept.length)return 0;const w=kept.filter(x=>x>0),l=kept.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return gl?Math.abs(gw/gl):99;}
const pctStop=a=>{if(!a.length)return 0;return 100*a.filter(x=>x.r<=-9).length/a.length;};

(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8'));
  const tks=(uni.universe||uni).slice(0,250).map(u=>u.ticker);
  console.log('\n════ BARRIDO STOP EMACross — OOS por régimen (10y, EMA 8/21 anticipada) ════\n');
  const STOPS=[0.10,0.12,0.15,0.18,0.22,0.25,0.30];
  const data={};for(const layer of ['base','conf','stack'])data[layer]={};
  for(const layer of ['base','conf','stack'])for(const cat of STOPS)data[layer][cat]=[];
  let ok=0;
  for(const t of tks){const b=await getW(t);await sleep(108);if(!b)continue;ok++;
    for(const layer of ['base','conf','stack'])for(const cat of STOPS)data[layer][cat].push(...trades(b,layer,cat));}
  console.log(`  ${ok} acciones\n`);

  for(const layer of ['base','conf','stack']){
    const allT=data[layer][0.18].map(x=>x.t).sort((a,b)=>a-b);
    const mid=allT.length?allT[Math.floor(allT.length/2)]:0;
    console.log(`── ${layer.toUpperCase()} ──`);
    console.log('  stop    FULL: n    PF    med%   sin5%  WR%  %stop | H1: PF    med%   sin5%  n   | H2: PF    med%   sin5%  n');
    for(const cat of STOPS){
      const a=data[layer][cat],T=st(a),t5=trimTop(a,0.05);
      const h1=a.filter(x=>x.t<mid),h2=a.filter(x=>x.t>=mid);
      const S1=st(h1),S2=st(h2),t51=trimTop(h1,0.05),t52=trimTop(h2,0.05);
      const mark=cat===0.18?' ◄':'';
      console.log(`  -${(cat*100).toFixed(0).padStart(2)}%   ${String(T.n).padStart(5)} ${T.pf.toFixed(2).padStart(5)} ${(T.med>=0?'+':'')+T.med.toFixed(1).padStart(5)}% ${t5.toFixed(2).padStart(5)} ${T.wr.toFixed(0).padStart(4)}% ${pctStop(a).toFixed(0).padStart(4)}%  | ${S1.pf.toFixed(2).padStart(5)} ${(S1.med>=0?'+':'')+S1.med.toFixed(1).padStart(5)}% ${t51.toFixed(2).padStart(5)} ${String(S1.n).padStart(4)} | ${S2.pf.toFixed(2).padStart(5)} ${(S2.med>=0?'+':'')+S2.med.toFixed(1).padStart(5)}% ${t52.toFixed(2).padStart(5)} ${String(S2.n).padStart(4)}${mark}`);
    }
    console.log('');
  }
  console.log('  ◄ = config actual (-18%). Buscar: meseta estable en AMBAS mitades, no pico aislado.');
  console.log('  %stop = % de trades que salen por stop (proxy de "te barren").\n');
})();
