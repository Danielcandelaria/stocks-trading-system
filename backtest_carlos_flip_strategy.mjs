#!/usr/bin/env node
// backtest_carlos_flip_strategy.mjs — REPLICA FIEL de la estrategia Pine de Carlos (MPB D913 S).
//   Reglas EXACTAS del Pine (capa de estrategia):
//     - LONG only. ENTRADA: sellSetup==1 (bullish price flip: close>close[4] & close[1]<close[5]).
//     - SALIDA: buySetup==1 (bearish price flip: close<close[4] & close[1]>close[5]).
//     - 100% equity COMPUESTO, pyramiding=0, exit-before-entry, sin reentry misma barra.
//     - process_orders_on_close=true  → entra/sale al CIERRE de la barra de señal.
//   Se replica calcSetup con requirePriceFlip=true, comparación estricta (defaults del Pine).
//   CLAVE: se compara CADA símbolo contra COMPRAR Y MANTENER el MISMO símbolo, para aislar
//          si el edge es real o es supervivencia + deriva alcista + compounding (por qué luce bien en TV).
//   Dos costes: 0% (idéntico a TV) y 0.06%/lado (realista). READ-ONLY (Yahoo). Uso: node ... [sample=250] [1wk|1d]
import { readFileSync } from 'fs'; import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const UA={'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'};
const SAMPLE=+(process.argv[2]||250), TF=process.argv[3]||'1wk', CONC=12;
const ROOT=dirname(fileURLToPath(import.meta.url));
async function getBars(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=${TF}`,{headers:UA});if(!r.ok)return null;const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp||!q)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i]});return b.length>60?b:null;}catch{return null;}}
async function mapLimit(items,n,fn){const out=[];let i=0;await Promise.all(Array.from({length:n},async()=>{while(i<items.length){const k=i++;out[k]=await fn(items[k]);}}));return out;}

// Replica EXACTA de calcSetup del Pine (requirePriceFlip=true, strict). Devuelve arrays sellSetup, buySetup.
function setups(bars){
  const c=bars.map(x=>x.c), n=c.length, sell=new Array(n).fill(0), buy=new Array(n).fill(0);
  let ps=0, pb=0;
  for(let i=0;i<n;i++){
    if(i<5){ sell[i]=0; buy[i]=0; ps=0; pb=0; continue; }
    const buyCond = c[i] < c[i-4];
    const sellCond = c[i] > c[i-4];
    const buyFlip  = c[i-1] > c[i-5] && buyCond;   // priceFlip(true)
    const sellFlip = c[i-1] < c[i-5] && sellCond;  // priceFlip(false)
    const nb = buyCond ? (pb>0 ? pb+1 : (buyFlip?1:0)) : 0;
    const nsl= sellCond? (ps>0 ? ps+1 : (sellFlip?1:0)) : 0;
    buy[i]=nb; sell[i]=nsl; pb=nb; ps=nsl;
  }
  return {sell,buy};
}
// Simula la estrategia con 100% equity compuesto sobre UN símbolo. cost = fracción por lado.
function runStrategy(bars, cost){
  const {sell,buy}=setups(bars), c=bars.map(x=>x.c), n=c.length;
  let pos=0, entryPx=0, E=1, nT=0, wins=0, barsIn=0, barsTot=0, openAtEnd=false;
  const rets=[]; let firstIdx=-1;
  for(let i=5;i<n;i++){
    if(firstIdx<0) firstIdx=i;
    barsTot++;
    if(pos>0 && buy[i]===1){ const ret=c[i]/entryPx-1-2*cost; E*=(1+ret); rets.push(ret); nT++; if(ret>0)wins++; pos=0; }
    else if(pos===0 && sell[i]===1){ pos=1; entryPx=c[i]; }
    if(pos>0) barsIn++;
  }
  if(pos>0){ const ret=c[n-1]/entryPx-1-2*cost; E*=(1+ret); rets.push(ret); nT++; if(ret>0)wins++; openAtEnd=true; } // OPEN_AT_END mark-to-market
  const bh = firstIdx>=0 ? c[n-1]/c[firstIdx] : 1;   // comprar y mantener MISMO símbolo, misma ventana
  return {mult:E, bh, nT, wr:nT?100*wins/nT:0, invPct:barsTot?100*barsIn/barsTot:0, rets, openAtEnd};
}
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const geomean=a=>{if(!a.length)return 0;let s=0;for(const x of a)s+=Math.log(Math.max(1e-9,x));return Math.exp(s/a.length);};

(async()=>{
  const uni=JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8')).universe.slice(0,SAMPLE).map(u=>u.ticker);
  console.log(`\n════ ESTRATEGIA PINE DE CARLOS (flip sellSetup1→buySetup1, 100% compuesto) — REPLICA FIEL ════`);
  console.log(`  ${uni.length} símbolos · 10y · ${TF} · entra/sale al cierre · SIN stop (igual que el Pine)\n`);
  const bars=await mapLimit(uni,CONC,getBars);
  for(const cost of [0, 0.0006]){
    const R=[]; const allRets=[];
    let stratBeatsBH=0, valid=0, stillOpen=0;
    for(const b of bars){ if(!b) continue; const r=runStrategy(b,cost); if(r.nT<2) continue; valid++; R.push(r); allRets.push(...r.rets); if(r.mult>r.bh)stratBeatsBH++; if(r.openAtEnd)stillOpen++; }
    const sMult=R.map(x=>x.mult), bMult=R.map(x=>x.bh);
    const w=allRets.filter(x=>x>0), l=allRets.filter(x=>x<=0), gw=w.reduce((a,b)=>a+b,0), gl=Math.abs(l.reduce((a,b)=>a+b,0));
    console.log(`── COSTE ${cost===0?'0% (idéntico a TradingView)':'0.06%/lado (realista)'} · ${valid} símbolos válidos ──`);
    console.log(`   ESTRATEGIA  multiplicador equity: mediana ${median(sMult).toFixed(2)}x · media geom ${geomean(sMult).toFixed(2)}x · media arit ${(sMult.reduce((a,b)=>a+b,0)/sMult.length).toFixed(2)}x`);
    console.log(`   BUY & HOLD  (mismo símbolo):        mediana ${median(bMult).toFixed(2)}x · media geom ${geomean(bMult).toFixed(2)}x · media arit ${(bMult.reduce((a,b)=>a+b,0)/bMult.length).toFixed(2)}x`);
    console.log(`   ⇒ la estrategia BATE a comprar-y-mantener en ${stratBeatsBH}/${valid} símbolos (${(100*stratBeatsBH/valid).toFixed(0)}%)`);
    console.log(`   Nivel trade: n ${allRets.length} · WR ${(100*w.length/allRets.length).toFixed(1)}% · PF ${(gl?gw/gl:0).toFixed(2)} · ret medio/trade ${(100*allRets.reduce((a,b)=>a+b,0)/allRets.length).toFixed(2)}% · mediana ${(100*median(allRets)).toFixed(2)}%`);
    console.log(`   %tiempo invertido medio ${(R.reduce((a,b)=>a+b.invPct,0)/R.length).toFixed(0)}% · trades/símbolo ${(allRets.length/valid).toFixed(1)} · abiertos al final ${stillOpen}\n`);
  }
  console.log(`  LECTURA: si la estrategia NO bate a comprar-y-mantener del mismo símbolo en la mayoría,`);
  console.log(`           el brillo en TV es supervivencia + deriva alcista + compounding, no edge del flip DeMark.\n`);
})();
