// Filtro RSI(14) semanal < 50 sobre EMA anticipado 8/21
import fs from 'fs';
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,GAP=0.012,L200=200;
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i],o:q.open?.[i]??null,v:q.volume?.[i]??null});return b.length>220?b:null;}catch{return null;}}

function rsi14(closes){
  // Wilder RSI(14)
  const n=closes.length;
  const rsi=new Array(n).fill(null);
  if(n<15) return rsi;
  let gains=0,losses=0;
  for(let i=1;i<=14;i++){
    const diff=closes[i]-closes[i-1];
    if(diff>0) gains+=diff; else losses+=-diff;
  }
  let avgGain=gains/14, avgLoss=losses/14;
  rsi[14]= avgLoss===0?100:100-100/(1+avgGain/avgLoss);
  for(let i=15;i<n;i++){
    const diff=closes[i]-closes[i-1];
    const g=diff>0?diff:0, l=diff<0?-diff:0;
    avgGain=(avgGain*13+g)/14;
    avgLoss=(avgLoss*13+l)/14;
    rsi[i]= avgLoss===0?100:100-100/(1+avgGain/avgLoss);
  }
  return rsi;
}

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

async function backtestOne(bars){
  const closes=bars.map(b=>b.c);
  const e8=ema(closes,8), e21=ema(closes,21);
  const rsi=rsi14(closes);
  const trades=[];
  let inPos=false, entryPrice=null, entryIdx=null;
  for(let i=L200;i<bars.length;i++){
    if(e8[i]==null||e21[i]==null) continue;
    if(!inPos){
      // entry base: EMA anticipado - gap<1.2% convergiendo, e8 approaching e21 from below
      const gap=(e8[i]-e21[i])/e21[i];
      const prevGap=(e8[i-1]-e21[i-1])/e21[i-1];
      const converging = gap<0 && gap> -GAP && gap>prevGap; // approaching crossover from below
      if(converging){
        // FILTRO: RSI14 semanal < 50
        if(rsi[i]!=null && rsi[i]<50){
          inPos=true; entryPrice=closes[i]; entryIdx=i;
        }
      }
    } else {
      const ret=(closes[i]-entryPrice)/entryPrice;
      const crossDown = e8[i]<e21[i] && e8[i-1]>=e21[i-1];
      const stopHit = ret<=-CAT;
      if(crossDown||stopHit||i===bars.length-1){
        const exitPrice=stopHit? entryPrice*(1-CAT): closes[i];
        const netRet=(exitPrice-entryPrice)/entryPrice - COST*2;
        trades.push({entryT:bars[entryIdx].t, exitT:bars[i].t, ret:netRet});
        inPos=false;
      }
    }
  }
  return trades;
}

async function main(){
  const SAMPLE=parseInt(process.argv[2]||'100',10);
  const uniRaw=JSON.parse(fs.readFileSync('/Users/danielcandelaria/tradingview-mcp-jackson/stocks/universe.json','utf8'));
  const universe = Array.isArray(uniRaw)?uniRaw:uniRaw.universe;
  const sample=universe.slice(0,SAMPLE);
  let allTrades=[];
  let ok=0,fail=0;
  for(const u of sample){
    const ticker=u.ticker||u.tv?.split(':')?.[1]||u.tv;
    const bars=await getW(ticker);
    if(!bars){fail++; await sleep(110); continue;}
    ok++;
    const trades=await backtestOne(bars);
    for(const tr of trades) tr.ticker=ticker;
    allTrades=allTrades.concat(trades);
    await sleep(110);
  }
  console.log(`fetched ok=${ok} fail=${fail}`);

  // metrics
  const n=allTrades.length;
  const rets=allTrades.map(t=>t.ret);
  const gains=rets.filter(r=>r>0).reduce((a,b)=>a+b,0);
  const losses=rets.filter(r=>r<0).reduce((a,b)=>a+Math.abs(b),0);
  const pf= losses===0? Infinity : gains/losses;
  const sorted=[...rets].sort((a,b)=>a-b);
  const mediana = sorted.length? (sorted.length%2? sorted[(sorted.length-1)/2] : (sorted[sorted.length/2-1]+sorted[sorted.length/2])/2) : NaN;

  // sin top5%
  const sortedDesc=[...rets].sort((a,b)=>b-a);
  const cutCount=Math.floor(n*0.05);
  const trimmed = cutCount>0 ? sortedDesc.slice(cutCount) : sortedDesc;
  const tg=trimmed.filter(r=>r>0).reduce((a,b)=>a+b,0);
  const tl=trimmed.filter(r=>r<0).reduce((a,b)=>a+Math.abs(b),0);
  const pfTrimmed= tl===0?Infinity: tg/tl;

  // walk-forward: 4 equal time windows by entryT
  const withT=allTrades.filter(t=>t.entryT!=null);
  const times=withT.map(t=>t.entryT).sort((a,b)=>a-b);
  let wfPos=0;
  if(times.length){
    const tmin=times[0], tmax=times[times.length-1];
    const span=(tmax-tmin)/4;
    for(let w=0; w<4; w++){
      const lo=tmin+w*span, hi=tmin+(w+1)*span;
      const windowTrades=withT.filter(t=>t.entryT>=lo && (w===3? t.entryT<=hi : t.entryT<hi));
      const wn=windowTrades.length;
      const wmean= wn? windowTrades.reduce((a,b)=>a+b.ret,0)/wn : 0;
      if(wn>=5 && wmean>0) wfPos++;
    }
  }

  // OOS por régimen: partir en dos mitades por fecha de entrada (mediana temporal)
  function metricsFor(arr){
    const rr=arr.map(t=>t.ret);
    const g=rr.filter(r=>r>0).reduce((a,b)=>a+b,0);
    const l=rr.filter(r=>r<0).reduce((a,b)=>a+Math.abs(b),0);
    const pfv= l===0? Infinity : g/l;
    const s=[...rr].sort((a,b)=>a-b);
    const med= s.length? (s.length%2? s[(s.length-1)/2] : (s[s.length/2-1]+s[s.length/2])/2) : NaN;
    return {n:arr.length, PF:pfv, mediana:med*100};
  }
  const sortedByEntry=[...withT].sort((a,b)=>a.entryT-b.entryT);
  const mid=Math.floor(sortedByEntry.length/2);
  const H1=sortedByEntry.slice(0,mid);
  const H2=sortedByEntry.slice(mid);
  console.log('H1 (mitad antigua):', JSON.stringify(metricsFor(H1)));
  console.log('H2 (mitad reciente):', JSON.stringify(metricsFor(H2)));

  console.log(JSON.stringify({n, PF:pf, mediana:mediana*100, sinTop5:pfTrimmed, WF:`${wfPos}/4`},null,2));
}
main();
