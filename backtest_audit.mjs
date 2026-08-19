#!/usr/bin/env node
// backtest_audit.mjs — ATAQUE ESCÉPTICO a los hallazgos de EMACross antes de dinero real.
//   Cuestiona: (1) dependencia de OUTLIERS (¿el edge son 4 pelotazos?), (2) MEDIANA vs media,
//   (3) RÉGIMEN (expectancy por año, incl. bajistas 2018/2020/2022), (4) realismo de ENTRADA
//   (cierre de la vela señal vs apertura de la SIGUIENTE), (5) tasa de golpe de stop.
//   Todo en modo Anticipado (el que operamos). 250 large-caps, 10y semanal.
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,GAP=0.012,L200=200;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const ROOT=dirname(fileURLToPath(import.meta.url));
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null&&q.open[i]!=null)b.push({t:d.timestamp[i],o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i]});return b.length>220?b:null;}catch{return null;}}

// entryAt: 'close' (cierre vela señal) | 'nextopen' (apertura semana siguiente = realista)
function trades(bars,entryAt){const cl=bars.map(b=>b.c),ef=ema(cl,8),es=ema(cl,21),el=ema(cl,L200),out=[];let inP=false,ei=0,ep=0,stop=0,above=false,why='';
  for(let i=L200+1;i<bars.length;i++){const gap=(ef[i]-es[i])/cl[i],gp=(ef[i-1]-es[i-1])/cl[i-1];
    const bear=ef[i-1]>=es[i-1]&&ef[i]<es[i];const li=gap<0&&Math.abs(gap)<GAP&&gap>gp;
    if(!inP&&li){ // entrada
      if(entryAt==='nextopen'){ if(i+1>=bars.length)continue; ei=i;ep=bars[i+1].o;stop=ep*(1-CAT); }
      else { ei=i;ep=cl[i];stop=ep*(1-CAT); }
      inP=true;above=cl[i]>el[i];continue; }
    if(inP){const startCheck=entryAt==='nextopen'?i:i; // exits a partir de la barra de entrada
      if(bars[i].l<=stop){out.push({r:(stop/ep-1)*100-COST*200,t:bars[ei].t,above,why:'stop'});inP=false;}
      else if(bear){out.push({r:(cl[i]/ep-1)*100-COST*200,t:bars[ei].t,above,why:'cruce'});inP=false;}}}
  return out;}

const yearOf=t=>new Date(t*1000).getUTCFullYear();
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const st=a=>{const rs=a.map(x=>x.r),n=rs.length;if(!n)return{n:0,pf:0,m:0,wr:0,sum:0,med:0};const w=rs.filter(x=>x>0),l=rs.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return{n,pf:gl?Math.abs(gw/gl):99,m:rs.reduce((x,y)=>x+y,0)/n,wr:100*w.length/n,sum:rs.reduce((x,y)=>x+y,0),med:median(rs)};};
// PF y expectancy tras QUITAR el top-X% de ganadoras (test de fragilidad)
function trimTop(a,pct){const rs=[...a.map(x=>x.r)].sort((x,y)=>y-x);const cut=Math.floor(rs.length*pct);const kept=rs.slice(cut);const w=kept.filter(x=>x>0),l=kept.filter(x=>x<=0),gw=w.reduce((x,y)=>x+y,0),gl=l.reduce((x,y)=>x+y,0);return{pf:gl?Math.abs(gw/gl):99,m:kept.reduce((x,y)=>x+y,0)/kept.length};}

(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8'));const tks=(uni.universe||uni).slice(0,250).map(u=>u.ticker);
  let close=[],nopen=[],done=0,ok=0;
  for(const t of tks){const b=await getW(t);done++;if(done%50===0)process.stdout.write(`  …${done}/${tks.length}\n`);await sleep(110);if(!b)continue;ok++;close.push(...trades(b,'close'));nopen.push(...trades(b,'nextopen'));}
  console.log(`\n${ok} acciones · ${close.length} trades\n`);

  console.log('═══ 1) DEPENDENCIA DE OUTLIERS (¿el edge son pocos pelotazos?) ═══');
  for(const [lbl,a] of [['TODAS',close],['ENCIMA EMA200',close.filter(x=>x.above)],['DEBAJO EMA200',close.filter(x=>!x.above)]]){
    const s=st(a);const rs=[...a.map(x=>x.r)].sort((x,y)=>y-x);const top10=rs.slice(0,10).reduce((x,y)=>x+y,0);
    const posSum=rs.filter(x=>x>0).reduce((x,y)=>x+y,0);
    const t5=trimTop(a,0.05),t1=trimTop(a,0.01);
    console.log(`  ${lbl.padEnd(15)} media +${s.m.toFixed(2)}% · MEDIANA ${s.med>=0?'+':''}${s.med.toFixed(2)}% · top10 trades = ${(100*top10/posSum).toFixed(0)}% de todo el beneficio`);
    console.log(`  ${''.padEnd(15)} PF ${s.pf.toFixed(2)} → sin top1% ${t1.pf.toFixed(2)} → sin top5% ${t5.pf.toFixed(2)}  |  exp +${s.m.toFixed(1)}% → sin top5% ${t5.m>=0?'+':''}${t5.m.toFixed(1)}%`);
  }

  console.log('\n═══ 2) RÉGIMEN — expectancy por AÑO de entrada (¿solo en alcistas?) ═══');
  const years=[...new Set(close.map(x=>yearOf(x.t)))].sort();
  console.log('  '+years.map(y=>{const s=st(close.filter(x=>yearOf(x.t)===y));return `${y}:${s.m>=0?'+':''}${s.m.toFixed(0)}%(${s.n})`;}).join(' '));
  console.log('  (2018 corrección, 2020 COVID, 2022 bajista = las pruebas de fuego)');

  console.log('\n═══ 3) REALISMO DE ENTRADA (cierre señal vs apertura siguiente semana) ═══');
  const sc=st(close),sn=st(nopen);
  console.log(`  Entrada al CIERRE de la vela señal : PF ${sc.pf.toFixed(2)} · exp +${sc.m.toFixed(2)}% · ${sc.n}tr`);
  console.log(`  Entrada a la APERTURA siguiente     : PF ${sn.pf.toFixed(2)} · exp +${sn.m.toFixed(2)}% · ${sn.n}tr`);
  console.log(`  → diferencia expectancy: ${(sn.m-sc.m>=0?'+':'')}${(sn.m-sc.m).toFixed(2)}% (si se hunde, el edge dependía de entrar al cierre exacto)`);

  console.log('\n═══ 4) TASA DE GOLPE DE STOP -18% (riesgo de cola realizado) ═══');
  for(const [lbl,a] of [['TODAS',close],['DEBAJO EMA200',close.filter(x=>!x.above)]]){
    const s=st(a);const stops=a.filter(x=>x.why==='stop').length;
    console.log(`  ${lbl.padEnd(15)} ${(100*stops/s.n).toFixed(0)}% salieron por stop -18% · peor racha implícita`);
  }
  console.log('\n  Nota: universo = supervivientes de HOY. El sesgo INFLA long-only, y MÁS el cubo debajo-200.');
  process.exit(0);
})();
