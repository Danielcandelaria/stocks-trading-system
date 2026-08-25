// Hipotesis: estacionalidad (mes calendario de ENTRADA) sobre el motor base EMA anticipado 8/21.
// Motor BASE sin cambios (entry/exit/stop). Solo se AGRUPA por mes de entrada para el analisis.
import fs from 'fs';

const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,GAP=0.012,L200=200;
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i],o:q.open?.[i]??null,v:q.volume?.[i]??null});return b.length>220?b:null;}catch{return null;}}

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function backtestOne(bars){
  const closes=bars.map(b=>b.c);
  const e8=ema(closes,8), e21=ema(closes,21);
  const trades=[];
  let inPos=false, entryPrice=null, entryIdx=null, stopPrice=null;
  for(let i=L200;i<bars.length;i++){
    if(!inPos){
      // entry base: EMA anticipado -> gap entre e8 y e21 < GAP (convergiendo) y e8>e21 (tendencia alcista incipiente)
      const gap=Math.abs(e8[i]-e21[i])/e21[i];
      const wasBelow=e8[i-1]<=e21[i-1];
      const crossingUp = e8[i]>e21[i];
      if(crossingUp && wasBelow && gap<GAP){
        inPos=true; entryIdx=i; entryPrice=bars[i].c; stopPrice=entryPrice*(1-CAT);
      }
    } else {
      const lowHit = bars[i].l<=stopPrice;
      const crossDown = e8[i]<e21[i];
      if(lowHit){
        const exitPrice=stopPrice;
        const ret=(exitPrice/entryPrice-1)-COST*2;
        trades.push({entryT:bars[entryIdx].t, exitT:bars[i].t, ret});
        inPos=false;
      } else if(crossDown){
        const exitPrice=bars[i].c;
        const ret=(exitPrice/entryPrice-1)-COST*2;
        trades.push({entryT:bars[entryIdx].t, exitT:bars[i].t, ret});
        inPos=false;
      }
    }
  }
  return trades;
}

function pf(trades){
  const gains=trades.filter(t=>t.ret>0).reduce((s,t)=>s+t.ret,0);
  const losses=Math.abs(trades.filter(t=>t.ret<0).reduce((s,t)=>s+t.ret,0));
  if(losses===0) return gains>0?Infinity:0;
  return gains/losses;
}
function median(arr){
  if(!arr.length) return NaN;
  const s=[...arr].sort((a,b)=>a-b);
  const mid=Math.floor(s.length/2);
  return s.length%2? s[mid] : (s[mid-1]+s[mid])/2;
}
function sinTop5(trades){
  const n=trades.length;
  if(n<20) return pf(trades); // muestra pequena, no recortar
  const sorted=[...trades].sort((a,b)=>b.ret-a.ret);
  const cut=Math.ceil(n*0.05);
  const rest=sorted.slice(cut);
  return pf(rest);
}

async function main(){
  const SAMPLE=parseInt(process.argv[2]||'100',10);
  const uniRaw=JSON.parse(fs.readFileSync('/Users/danielcandelaria/tradingview-mcp-jackson/stocks/universe.json','utf8'));
  const universe = Array.isArray(uniRaw) ? uniRaw : uniRaw.universe;
  const tickers = universe.slice(0,SAMPLE).map(u=>u.ticker || u.tv || u);

  let allTrades=[];
  let fetched=0;
  for(const t of tickers){
    const bars = await getW(t);
    fetched++;
    if(bars){
      const trades = backtestOne(bars);
      trades.forEach(tr=>tr.ticker=t);
      allTrades.push(...trades);
    }
    await sleep(110);
  }

  console.log(`\nFetched ${fetched} tickers, got trades from usable ones. Total trades: ${allTrades.length}\n`);
  fs.writeFileSync('/private/tmp/claude-501/-Users-danielcandelaria-tradingview-mcp-jackson/055077f4-eed6-48c3-9aeb-fbe9c4779404/scratchpad/all_trades.json', JSON.stringify(allTrades));

  // Metricas globales (full-sample)
  const globalPF = pf(allTrades);
  const globalMedian = median(allTrades.map(t=>t.ret*100));
  const globalSinTop5 = sinTop5(allTrades);
  console.log('=== FULL SAMPLE (baseline check) ===');
  console.log(`n=${allTrades.length} PF=${globalPF.toFixed(4)} mediana=${globalMedian.toFixed(4)}% sinTop5=${globalSinTop5.toFixed(4)}`);

  // Walk-forward: 4 ventanas iguales por fecha de ENTRADA
  const sortedByEntry=[...allTrades].sort((a,b)=>a.entryT-b.entryT);
  const minT=sortedByEntry[0].entryT, maxT=sortedByEntry[sortedByEntry.length-1].entryT;
  const span=maxT-minT;
  const windows=[[],[],[],[]];
  for(const tr of sortedByEntry){
    let idx=Math.floor((tr.entryT-minT)/span*4);
    if(idx>3) idx=3;
    windows[idx].push(tr);
  }
  let wfPos=0;
  console.log('\n=== WALK-FORWARD (4 ventanas) ===');
  windows.forEach((w,i)=>{
    const n=w.length;
    const mean = n? w.reduce((s,t)=>s+t.ret,0)/n : 0;
    const ok = n>=5 && mean>0;
    if(ok) wfPos++;
    console.log(`Ventana ${i+1}: n=${n} mean=${(mean*100).toFixed(4)}% ${ok?'POSITIVA':'no'}`);
  });
  console.log(`WF: ${wfPos}/4`);

  // ESTACIONALIDAD: desglose por mes calendario de ENTRADA
  console.log('\n=== ESTACIONALIDAD POR MES DE ENTRADA ===');
  const monthNames=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const byMonth=Array.from({length:12},()=>[]);
  for(const tr of allTrades){
    const m = new Date(tr.entryT*1000).getUTCMonth();
    byMonth[m].push(tr);
  }
  const monthStats=[];
  for(let m=0;m<12;m++){
    const trs=byMonth[m];
    const n=trs.length;
    const mpf=pf(trs);
    const mmed=median(trs.map(t=>t.ret*100));
    const mean=n?trs.reduce((s,t)=>s+t.ret,0)/n*100:0;
    monthStats.push({month:monthNames[m], n, pf:mpf, mediana:mmed, mean});
    console.log(`${monthNames[m]}: n=${n} PF=${isFinite(mpf)?mpf.toFixed(3):'Inf'} mediana=${isFinite(mmed)?mmed.toFixed(3):'NaN'}% mean=${mean.toFixed(3)}%`);
  }

  // Resaltar mejores/peores meses con n>=20
  const usable=monthStats.filter(m=>m.n>=20);
  usable.sort((a,b)=>b.pf-a.pf);
  console.log('\n=== TOP/BOTTOM meses (n>=20) por PF ===');
  usable.forEach(m=>console.log(`${m.month}: n=${m.n} PF=${isFinite(m.pf)?m.pf.toFixed(3):'Inf'} mediana=${m.mediana.toFixed(3)}%`));

  console.log('\n=== COMPARACION vs baseline (full PF 3.59, mediana -2.2%, sinTop5 1.53, n=1572) ===');
  console.log(`Este run (mismo motor, sin filtro estacional aplicado): n=${allTrades.length} PF=${globalPF.toFixed(4)} mediana=${globalMedian.toFixed(4)}% sinTop5=${globalSinTop5.toFixed(4)} WF=${wfPos}/4`);

  // ================= OOS POR REGIMEN: split H1/H2 por fecha de ENTRADA (mediana temporal) =================
  console.log('\n\n=== OOS REGIMEN: SPLIT H1 (antigua) / H2 (reciente) por mediana temporal de entrada ===');
  const sortedAll=[...allTrades].sort((a,b)=>a.entryT-b.entryT);
  const midIdx=Math.floor(sortedAll.length/2);
  const H1=sortedAll.slice(0,midIdx);
  const H2=sortedAll.slice(midIdx);
  const fmtDate=ts=>new Date(ts*1000).toISOString().slice(0,10);
  console.log(`H1: ${fmtDate(H1[0].entryT)} -> ${fmtDate(H1[H1.length-1].entryT)}  (n=${H1.length})`);
  console.log(`H2: ${fmtDate(H2[0].entryT)} -> ${fmtDate(H2[H2.length-1].entryT)}  (n=${H2.length})`);

  function reportHalf(label, trs){
    const n=trs.length;
    const p=pf(trs);
    const med=median(trs.map(t=>t.ret*100));
    const st5=sinTop5(trs);
    console.log(`${label}: n=${n} PF=${isFinite(p)?p.toFixed(4):'Inf'} mediana=${isFinite(med)?med.toFixed(4):'NaN'}% sinTop5=${isFinite(st5)?st5.toFixed(4):'Inf'}`);
    return {n,pf:p,mediana:med,sinTop5:st5};
  }

  console.log('\n--- Full-sample (ambas mitades) ---');
  const h1Stats = reportHalf('H1 (antigua)', H1);
  const h2Stats = reportHalf('H2 (reciente)', H2);

  console.log('\n--- Por mes calendario de entrada, dentro de cada mitad (n>=15 marcado) ---');
  const monthOOS=[];
  for(let m=0;m<12;m++){
    const h1m = H1.filter(t=>new Date(t.entryT*1000).getUTCMonth()===m);
    const h2m = H2.filter(t=>new Date(t.entryT*1000).getUTCMonth()===m);
    const p1=pf(h1m), p2=pf(h2m);
    const md1=median(h1m.map(t=>t.ret*100)), md2=median(h2m.map(t=>t.ret*100));
    const flag = (h1m.length>=15 && h2m.length>=15) ? '' : ' [n<15 -> INCONCLUSO]';
    console.log(`${monthNames[m]}: H1 n=${h1m.length} PF=${isFinite(p1)?p1.toFixed(3):'Inf'} med=${isFinite(md1)?md1.toFixed(2):'NaN'}%  ||  H2 n=${h2m.length} PF=${isFinite(p2)?p2.toFixed(3):'Inf'} med=${isFinite(md2)?md2.toFixed(2):'NaN'}%${flag}`);
    monthOOS.push({month:monthNames[m], h1n:h1m.length, h1pf:p1, h1med:md1, h2n:h2m.length, h2pf:p2, h2med:md2});
  }

  console.log('\n=== VEREDICTO OOS ===');
  const BASE_PF=3.59, BASE_MED=-2.2;
  const okH1 = h1Stats.n>=15 && h1Stats.pf>=BASE_PF && h1Stats.mediana>=BASE_MED;
  const okH2 = h2Stats.n>=15 && h2Stats.pf>=BASE_PF && h2Stats.mediana>=BASE_MED;
  console.log(`H1 bate baseline? ${okH1}  |  H2 bate baseline? ${okH2}`);
  if(h1Stats.n<15||h2Stats.n<15) console.log('INCONCLUSO: n<15 en alguna mitad');
  else if(okH1&&okH2) console.log('CONFIRMADO: bate baseline en ambas mitades');
  else console.log('REFUTADO: no bate baseline en al menos una mitad (regimen-dependiente o inferior al motor base)');

  fs.writeFileSync('/private/tmp/claude-501/-Users-danielcandelaria-tradingview-mcp-jackson/055077f4-eed6-48c3-9aeb-fbe9c4779404/scratchpad/oos_result.json', JSON.stringify({h1Stats,h2Stats,monthOOS},null,2));
}

main().catch(e=>{console.error(e);process.exit(1);});
