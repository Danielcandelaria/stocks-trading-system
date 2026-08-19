#!/usr/bin/env node
// backtest_validation.mjs — VALIDACIÓN formal (Pilar 2): ¿el edge sobrevive el multiple-testing?
//   1) Deflated Sharpe Ratio (Bailey & López de Prado): ajusta el Sharpe del elegido por Nº de trials,
//      no-normalidad (skew/kurtosis) y tamaño de muestra. DSR = P(Sharpe verdadero > 0).
//   2) Probability of Backtest Overfitting (CSCV): ¿el mejor IN-SAMPLE sigue arriba OUT-OF-SAMPLE?
//   Tratamos las ~12 variantes probadas como los trials. Series mensuales de retorno por variante.
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
import { computeTDSetup } from '../scanner/demark_calc.mjs';
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,GAP=0.012,L200=200,CONF=13;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=dirname(fileURLToPath(import.meta.url));
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i]});return b.length>220?b:null;}catch{return null;}}

// motor genérico. cfg: {mode:'antic'|'confirm'|'dem', gap, need9, below:'below'|'above'|null, cd13}
function gen(bars,cfg){const cl=bars.map(b=>b.c),ef=ema(cl,8),es=ema(cl,21),el=ema(cl,L200),out=[];
  const td=(cfg.need9||cfg.mode==='dem')?computeTDSetup(bars):null;let i=L200+1;
  while(i<bars.length-1){let trig;
    if(cfg.mode==='dem') trig=td.bullSetup[i]===9;
    else{const gap=(ef[i]-es[i])/cl[i],gp=(ef[i-1]-es[i-1])/cl[i-1];
      trig=cfg.mode==='antic'?(gap<0&&Math.abs(gap)<(cfg.gap||GAP)&&gap>gp):(ef[i-1]<=es[i-1]&&ef[i]>es[i]);}
    if(!trig){i++;continue;}
    if(cfg.need9){let h=false;for(let j=Math.max(0,i-CONF);j<=i;j++){if(td.bullSetup[j]===9){h=true;break;}}if(!h){i++;continue;}}
    if(cfg.below==='below'&&!(cl[i]<el[i])){i++;continue;}
    if(cfg.below==='above'&&!(cl[i]>=el[i])){i++;continue;}
    const ep=cl[i],stop=ep*(1-CAT);let ret=null,ej=bars.length-1;
    for(let j=i+1;j<bars.length;j++){const bear=ef[j-1]>=es[j-1]&&ef[j]<es[j];
      if(bars[j].l<=stop){ret=(stop/ep-1)-COST*2;ej=j;break;}
      if(cfg.mode==='dem'){if(td.bearSetup[j]===9){ret=(cl[j]/ep-1)-COST*2;ej=j;break;}if(j-i>=52){ret=(cl[j]/ep-1)-COST*2;ej=j;break;}}
      else if(bear){ret=(cl[j]/ep-1)-COST*2;ej=j;break;}}
    if(ret==null)ret=(cl[cl.length-1]/ep-1)-COST*2;out.push({t:bars[i].t,r:ret});i=ej+1;}
  return out;}

const VARIANTS=[
  ['EMA confirmado',{mode:'confirm'}],
  ['EMA anticipado',{mode:'antic'}],
  ['EMA antic gap0.6%',{mode:'antic',gap:0.006}],
  ['EMA antic gap2%',{mode:'antic',gap:0.02}],
  ['EMA antic DEBAJO200',{mode:'antic',below:'below'}],
  ['EMA antic ENCIMA200',{mode:'antic',below:'above'}],
  ['Confluencia antic',{mode:'antic',need9:true}],
  ['Confluencia confirm',{mode:'confirm',need9:true}],
  ['STACK (conf+debajo)',{mode:'antic',need9:true,below:'below'}],
  ['Conf ENCIMA200',{mode:'antic',need9:true,below:'above'}],
  ['DeMark setup-9',{mode:'dem'}],
  ['EMA confirm DEBAJO200',{mode:'confirm',below:'below'}],
];

// ── estadística ──
const erf=x=>{const t=1/(1+0.3275911*Math.abs(x));const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x);return x>=0?y:-y;};
const Phi=x=>0.5*(1+erf(x/Math.SQRT2));
function PhiInv(p){ // Acklam
  const a=[-3.969683028665376e+01,2.209460984245205e+02,-2.759285104469687e+02,1.383577518672690e+02,-3.066479806614716e+01,2.506628277459239e+00];
  const b=[-5.447609879822406e+01,1.615858368580409e+02,-1.556989798598866e+02,6.680131188771972e+01,-1.328068155288572e+01];
  const c=[-7.784894002430293e-03,-3.223964580411365e-01,-2.400758277161838e+00,-2.549732539343734e+00,4.374664141464968e+00,2.938163982698783e+00];
  const d=[7.784695709041462e-03,3.224671290700398e-01,2.445134137142996e+00,3.754408661907416e+00];
  const pl=0.02425,ph=1-pl;let q,r;
  if(p<pl){q=Math.sqrt(-2*Math.log(p));return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}
  if(p<=ph){q=p-0.5;r=q*q;return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);}
  q=Math.sqrt(-2*Math.log(1-p));return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
const std=a=>{const m=mean(a);return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/a.length);};
const skew=a=>{const m=mean(a),s=std(a);return s?mean(a.map(x=>((x-m)/s)**3)):0;};
const kurt=a=>{const m=mean(a),s=std(a);return s?mean(a.map(x=>((x-m)/s)**4)):3;};
const sharpe=a=>{const s=std(a);return s?mean(a)/s:0;};
function combos(n,k){const res=[],c=[];(function bt(start){if(c.length===k){res.push([...c]);return;}for(let i=start;i<n;i++){c.push(i);bt(i+1);c.pop();}})(0);return res;}

(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8'));const tks=(uni.universe||uni).slice(0,250).map(u=>u.ticker);
  console.log('\n════ VALIDACIÓN — Deflated Sharpe + Prob. Backtest Overfitting (12 variantes) ════\n');
  const all=VARIANTS.map(()=>[]);let ok=0;
  for(const t of tks){const b=await getW(t);await sleep(110);if(!b)continue;ok++;VARIANTS.forEach((v,k)=>all[k].push(...gen(b,v[1])));}
  console.log(`  ${ok} acciones\n`);
  // rejilla mensual
  const allT=all.flat().map(x=>x.t),t0=Math.min(...allT),t1=Math.max(...allT);
  const mkey=t=>{const d=new Date(t*1000);return d.getUTCFullYear()*12+d.getUTCMonth();};
  const m0=mkey(t0),m1=mkey(t1),T=m1-m0+1;
  const series=all.map(trades=>{const s=new Array(T).fill(null).map(()=>[]);for(const x of trades)s[mkey(x.t)-m0].push(x.r);return s.map(a=>a.length?mean(a):0);});
  const SR=series.map(sharpe);
  const order=SR.map((s,i)=>[i,s]).sort((a,b)=>b[1]-a[1]);
  console.log('── Sharpe mensual (no anualizado) por variante ──');
  order.forEach(([i,s])=>console.log(`  ${VARIANTS[i][0].padEnd(22)} SR ${s.toFixed(3)}${i===order[0][0]?'  ← MEJOR (elegida)':''}`));

  // ── Deflated Sharpe del mejor ──
  const best=order[0][0];const rb=series[best];
  const N=VARIANTS.length, Vsr=std(SR)**2;
  const g=0.5772156649;
  const SR0=Math.sqrt(Vsr)*((1-g)*PhiInv(1-1/N)+g*PhiInv(1-1/(N*Math.E)));
  const sk=skew(rb),ku=kurt(rb),SRb=SR[best];
  const denom=Math.sqrt(1-sk*SRb+((ku-1)/4)*SRb*SRb);
  const DSR=Phi((SRb-SR0)*Math.sqrt(T-1)/denom);
  console.log(`\n── DEFLATED SHARPE (elegida: ${VARIANTS[best][0]}) ──`);
  console.log(`  SR ${SRb.toFixed(3)} · SR0 esperado por azar (${N} trials) ${SR0.toFixed(3)} · T ${T} meses · skew ${sk.toFixed(2)} · kurt ${ku.toFixed(2)}`);
  console.log(`  DSR = ${(DSR*100).toFixed(1)}%  → ${DSR>0.95?'✅ edge REAL (supera multiple-testing)':DSR>0.90?'🟡 probable pero no certero':'❌ NO supera el ajuste (posible overfit)'}`);

  // ── PBO vía CSCV ──
  const S=8, blk=Math.floor(T/S);const blocks=[];for(let s=0;s<S;s++)blocks.push([s*blk,s===S-1?T:(s+1)*blk]);
  const isCombos=combos(S,S/2);let overfit=0;const lambdas=[];
  for(const combo of isCombos){const isSet=new Set(combo);
    const isRows=[],oosRows=[];for(let s=0;s<S;s++){const[a,b]=blocks[s];for(let r=a;r<b;r++)(isSet.has(s)?isRows:oosRows).push(r);}
    const perfIS=series.map(se=>sharpe(isRows.map(r=>se[r])));
    const perfOOS=series.map(se=>sharpe(oosRows.map(r=>se[r])));
    const nStar=perfIS.map((v,i)=>[i,v]).sort((a,b)=>b[1]-a[1])[0][0];
    const sorted=[...perfOOS].sort((a,b)=>a-b);const rank=sorted.indexOf(perfOOS[nStar])+1;
    const w=rank/(N+1);const lam=Math.log(w/(1-w));lambdas.push(lam);if(lam<=0)overfit++;
  }
  const PBO=overfit/isCombos.length;
  console.log(`\n── PROBABILITY OF BACKTEST OVERFITTING (CSCV, S=${S}, ${isCombos.length} splits) ──`);
  console.log(`  PBO = ${(PBO*100).toFixed(1)}%  → ${PBO<0.2?'✅ robusto (el mejor IS sigue arriba OOS)':PBO<0.5?'🟡 moderado':'❌ overfit (el mejor IS se cae OOS)'}`);
  console.log(`\n  Recordatorio: esto NO corrige el sesgo de supervivencia (universo = vivos de hoy). Es el ajuste por multiple-testing.\n`);
})();
