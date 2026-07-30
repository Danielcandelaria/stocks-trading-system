#!/usr/bin/env node
// backtest_rsi2_gapguard.mjs — ¿Mejora RSI2 saltarse las señales que ABREN con
// hueco al alza? (idea "fill_engine revalida" — no perseguir un precio que se fue)
//
// RSI2 detecta la señal con el CIERRE de ayer (RSI2<10, precio>EMA200) y compra
// en la APERTURA de hoy. Si la acción abrió muy por encima del cierre de señal,
// el rebote ya ocurrió de noche → se compraría DESPUÉS del edge. Hipótesis: filtrar
// esas entradas (gap al alza > X%) mejora la expectativa sin perder mucha muestra.
//
// Replica la spec EXACTA + el stop de catástrofe −20% ya en producción. Compara
// BASE (sin filtro) vs GAP≤2/3/5% (entra solo si el open no se disparó). READ-ONLY.

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const COST = 0.0005, DISASTER = 0.20, SAMPLE = +(process.argv[2] || 200);
const sleep = ms => new Promise(r => setTimeout(r, ms));

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const ROOT = dirname(fileURLToPath(import.meta.url));

const ema = (cl, p) => { const k = 2/(p+1); let e=null; return cl.map((c,i)=>{e=e===null?c:c*k+e*(1-k);return i>=p-1?e:null;}); };
const sma = (cl, p) => { const o=new Array(cl.length).fill(null); let s=0; for(let i=0;i<cl.length;i++){s+=cl[i];if(i>=p)s-=cl[i-p];if(i>=p-1)o[i]=s/p;}return o; };
function rsi(cl, p){ const o=new Array(cl.length).fill(null); let ag=0,al=0;
  for(let i=1;i<cl.length;i++){const ch=cl[i]-cl[i-1],g=Math.max(ch,0),l=Math.max(-ch,0);
    if(i<=p){ag+=g/p;al+=l/p;if(i===p)o[i]=al===0?100:100-100/(1+ag/al);}
    else{ag=(ag*(p-1)+g)/p;al=(al*(p-1)+l)/p;o[i]=al===0?100:100-100/(1+ag/al);}} return o; }

async function getBars(t){ const y=t.replace('.','-');
  try{ const res=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=2y&interval=1d`,{headers:UA});
    if(!res.ok)return null; const r=(await res.json()).chart?.result?.[0]; const q=r?.indicators?.quote?.[0];
    if(!r?.timestamp||!q)return null; const b=[];
    for(let i=0;i<r.timestamp.length;i++) if(q.close[i]!=null&&q.open[i]!=null) b.push({o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i]});
    return b.length>220?b:null; }catch{return null;} }

// Simula un trade RSI2. `entry` es el OPEN real del día siguiente a la señal
// (así el gap se mide de verdad). Devuelve R en % o null.
function simulate(bars, s5, i) {
  const sigClose = bars[i].c;
  const j0 = i + 1; if (j0 >= bars.length) return null;
  const entry = bars[j0].o * (1 + COST);           // COMPRA en la apertura real
  const gapPct = (bars[j0].o / sigClose - 1) * 100; // hueco de apertura vs cierre de señal
  const disaster = entry * (1 - DISASTER);
  for (let k = 0; k < 5; k++) {
    const j = j0 + k; if (j >= bars.length) return { ret: (bars[bars.length-1].c*(1-COST)/entry-1)*100, gapPct };
    const b = bars[j];
    if (b.l <= disaster) return { ret: (Math.min(b.o,disaster)*(1-COST)/entry-1)*100, gapPct };
    if (s5[j] != null && b.c > s5[j]) return { ret: (b.c*(1-COST)/entry-1)*100, gapPct };
    if (k === 4) return { ret: (b.c*(1-COST)/entry-1)*100, gapPct };
  }
  return null;
}

(async () => {
  const uni = JSON.parse(readFileSync(join(ROOT,'universe.json'),'utf8'));
  const tickers = (uni.universe||uni).slice(0,SAMPLE).map(u=>u.ticker);
  console.log(`\n══ RSI2 — ¿GUARDIA DE GAP AL ALZA MEJORA EL EDGE? ══`);
  console.log(`  ${tickers.length} tickers · 2 años · entrada en la APERTURA real\n`);

  const trades = []; let done=0, ok=0;
  for (const t of tickers) {
    const bars = await getBars(t); done++;
    if (done%40===0) process.stdout.write(`  …${done}/${tickers.length}\n`);
    await sleep(120); if (!bars) continue; ok++;
    const cl = bars.map(b=>b.c);
    const e200=ema(cl,200), s5=sma(cl,5), r2=rsi(cl,2);
    for (let i=200;i<bars.length-1;i++)
      if (r2[i]!=null && e200[i]!=null && r2[i]<10 && bars[i].c>e200[i]) {
        const r = simulate(bars, s5, i);
        if (r) trades.push(r);
      }
  }
  console.log(`\n  ${ok} tickers · ${trades.length} señales\n`);

  const fmt = v => (v>=0?'+':'')+v.toFixed(1);
  const stat = arr => { const n=arr.length, s=arr.reduce((a,b)=>a+b,0);
    const w=arr.filter(x=>x>0), l=arr.filter(x=>x<=0);
    const pf = l.length&&l.reduce((a,b)=>a+b,0)!==0 ? Math.abs(w.reduce((a,b)=>a+b,0)/l.reduce((a,b)=>a+b,0)) : null;
    return { n, s, m:s/n, wr:100*w.length/n, pf }; };

  console.log('  ' + 'filtro'.padEnd(14)+'n'.padStart(6)+'Σret%'.padStart(9)+'media%'.padStart(8)+'WR'.padStart(6)+'PF'.padStart(7));
  console.log('  '+'─'.repeat(52));
  const base = stat(trades.map(t=>t.ret));
  const row = (name, arr) => { const s=stat(arr);
    console.log('  '+name.padEnd(14)+String(s.n).padStart(6)+fmt(s.s).padStart(9)+(s.m>=0?'+':'')+s.m.toFixed(2).padStart(7)+(s.wr.toFixed(0)+'%').padStart(6)+(s.pf?s.pf.toFixed(2):'—').padStart(7)); };
  row('BASE (todo)', trades.map(t=>t.ret));
  for (const g of [5,3,2,1,0]) {
    const kept = trades.filter(t=>t.gapPct<=g).map(t=>t.ret);
    const drop = trades.length-kept.length;
    console.log('  '+`gap ≤ ${g}%`.padEnd(14)+String(kept.length).padStart(6)+fmt(kept.reduce((a,b)=>a+b,0)).padStart(9)
      +(kept.reduce((a,b)=>a+b,0)/kept.length>=0?'+':'')+(kept.reduce((a,b)=>a+b,0)/kept.length).toFixed(2).padStart(7)
      +((100*kept.filter(x=>x>0).length/kept.length).toFixed(0)+'%').padStart(6)
      +(()=>{const l=kept.filter(x=>x<=0),w=kept.filter(x=>x>0);return l.length?(w.reduce((a,b)=>a+b,0)/Math.abs(l.reduce((a,b)=>a+b,0))).toFixed(2):'—';})().padStart(7)
      +`   (−${drop} señales)`);
  }
  // ¿las señales con gap grande son las que pierden?
  console.log('\n  === expectativa por tramo de gap de apertura ===');
  for (const [lo,hi,lbl] of [[-99,0,'gap ≤0% (abrió igual/abajo)'],[0,2,'gap 0-2%'],[2,5,'gap 2-5%'],[5,99,'gap >5%']]) {
    const arr = trades.filter(t=>t.gapPct>lo&&t.gapPct<=hi).map(t=>t.ret);
    if (arr.length) { const s=stat(arr);
      console.log('  '+lbl.padEnd(28)+'n='+String(s.n).padStart(4)+'  media '+(s.m>=0?'+':'')+s.m.toFixed(2)+'%  WR '+s.wr.toFixed(0)+'%'); }
  }
  console.log('');
})();
