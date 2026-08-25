// Hipotesis: cercania al minimo de 52 semanas mejora la señal de entrada EMA 8/21 anticipada.
// Motor BASE sin cambios (entry/exit); se AÑADE un filtro: solo tomar la señal si precio <= low52w*1.20
// (dentro del 20% superior sobre el low52w). Aisla UNA variable.
import fs from 'fs';

const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,GAP=0.012,L200=200;
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i],o:q.open?.[i]??null,v:q.volume?.[i]??null});return b.length>220?b:null;}catch{return null;}}

const NEAR_LOW_PCT = 0.20; // filtro: precio dentro del 20% superior al low52w

function backtest(bars){
  const closes=bars.map(b=>b.c);
  const e8=ema(closes,8), e21=ema(closes,21);
  const trades=[];
  let inPos=false, entryIdx=-1, entryPrice=0, stopPrice=0;
  for(let i=1;i<bars.length;i++){
    if(!inPos){
      // entry base: EMA anticipado -> gap entre e8 y e21 < GAP y convergiendo (acercandose), con e8 aun por debajo pero cerrando distancia
      const gapPrev = (e8[i-1]-e21[i-1])/e21[i-1];
      const gapNow = (e8[i]-e21[i])/e21[i];
      const converging = Math.abs(gapNow) < GAP && gapNow > gapPrev; // acercandose desde abajo
      const anticipated = gapNow < 0 && converging;
      if(anticipated){
        // FILTRO low52w: usar las ultimas 52 semanas (bars) hasta i para low52w
        const win = bars.slice(Math.max(0,i-52), i+1);
        const low52w = Math.min(...win.map(b=>b.l));
        const price = bars[i].c;
        const nearLow = price <= low52w*(1+NEAR_LOW_PCT);
        if(!nearLow) continue; // filtro descarta la señal
        inPos=true; entryIdx=i; entryPrice=bars[i].c; stopPrice=entryPrice*(1-CAT);
      }
    } else {
      const crossDown = e8[i]<e21[i];
      const stopHit = bars[i].l <= stopPrice;
      if(crossDown || stopHit || i===bars.length-1){
        let exitPrice;
        if(stopHit) exitPrice = stopPrice;
        else exitPrice = bars[i].c;
        const retPct = (exitPrice/entryPrice - 1) - COST*2;
        trades.push({entryT:bars[entryIdx].t, exitT:bars[i].t, retPct});
        inPos=false;
      }
    }
  }
  return trades;
}

function pf(trades){
  const g=trades.filter(t=>t.retPct>0).reduce((s,t)=>s+t.retPct,0);
  const l=Math.abs(trades.filter(t=>t.retPct<0).reduce((s,t)=>s+t.retPct,0));
  return l===0?(g>0?Infinity:0):g/l;
}
function median(arr){
  const s=[...arr].sort((a,b)=>a-b);
  const n=s.length;
  if(n===0)return 0;
  return n%2? s[(n-1)/2] : (s[n/2-1]+s[n/2])/2;
}

async function main(){
  const SAMPLE = parseInt(process.argv[2]||'100',10);
  const raw = JSON.parse(fs.readFileSync('/Users/danielcandelaria/tradingview-mcp-jackson/stocks/universe.json','utf8'));
  const universe = raw.universe || raw;
  const sample = universe.slice(0, SAMPLE);

  let allTrades=[];
  let ok=0, fail=0;
  for(const u of sample){
    const ticker = u.ticker || u.tv?.split(':')?.[1] || u;
    const bars = await getW(ticker);
    if(!bars){ fail++; await new Promise(r=>setTimeout(r,110)); continue; }
    ok++;
    const trades = backtest(bars);
    for(const t of trades) t.ticker=ticker;
    allTrades.push(...trades);
    await new Promise(r=>setTimeout(r,110));
  }

  console.log(`fetched ok=${ok} fail=${fail}`);
  const n = allTrades.length;
  const PF = pf(allTrades);
  const rets = allTrades.map(t=>t.retPct*100);
  const med = median(rets);

  // sin-top5%: quitar el 5% mejores trades por retorno
  const sorted = [...allTrades].sort((a,b)=>a.retPct-b.retPct);
  const cutoff = Math.floor(n*0.95);
  const trimmed = sorted.slice(0, cutoff);
  const PFtrim = pf(trimmed);

  // walk-forward: 4 ventanas temporales iguales por entryT
  const times = allTrades.map(t=>t.entryT).sort((a,b)=>a-b);
  const tmin = times[0], tmax = times[times.length-1];
  const span = (tmax-tmin)/4;
  let wfPos=0;
  for(let w=0; w<4; w++){
    const lo = tmin + w*span, hi = tmin + (w+1)*span;
    const win = allTrades.filter(t=>t.entryT>=lo && t.entryT<(w===3?hi+1:hi));
    if(win.length>=5){
      const mean = win.reduce((s,t)=>s+t.retPct,0)/win.length;
      if(mean>0) wfPos++;
    }
  }

  console.log(JSON.stringify({n, PF, median: med, PFtrim, wf: `${wfPos}/4`}, null, 2));

  // OOS por regimen: dividir en H1/H2 por mediana temporal de entryT
  const byTime = [...allTrades].sort((a,b)=>a.entryT-b.entryT);
  const nAll = byTime.length;
  const mid = Math.floor(nAll/2);
  const H1 = byTime.slice(0, mid);
  const H2 = byTime.slice(mid);
  const medPct = arr => median(arr.map(t=>t.retPct*100));
  const out = {
    H1: { n: H1.length, PF: pf(H1), median: medPct(H1) },
    H2: { n: H2.length, PF: pf(H2), median: medPct(H2) },
  };
  console.log('OOS_SPLIT ' + JSON.stringify(out, null, 2));
}

main();
