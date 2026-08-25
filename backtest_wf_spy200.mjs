// Filtro: régimen SPY vs su propia EMA200 semanal. Solo se toman señales cuando SPY_close > SPY_EMA200 en esa misma semana.
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,GAP=0.012,L200=200;
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i],o:q.open?.[i]??null,v:q.volume?.[i]??null});return b.length>220?b:null;}catch{return null;}}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

function buildRegimeMap(spyBars){
  const cl=spyBars.map(b=>b.c);
  const e200=ema(cl,L200);
  const map=new Map(); // t -> bullish bool
  for(let i=0;i<spyBars.length;i++){
    if(i<L200) continue;
    map.set(spyBars[i].t, cl[i] > e200[i]);
  }
  return map;
}
function regimeAt(map, t, sortedTs){
  // find last regime timestamp <= t
  if(map.has(t)) return map.get(t);
  let lo=0,hi=sortedTs.length-1,ans=null;
  while(lo<=hi){const mid=(lo+hi)>>1; if(sortedTs[mid]<=t){ans=sortedTs[mid];lo=mid+1;}else hi=mid-1;}
  if(ans===null) return null;
  return map.get(ans);
}

function runSymbol(bars, regimeMap, sortedTs){
  const cl=bars.map(b=>b.c);
  const e8=ema(cl,8), e21=ema(cl,21);
  const trades=[];
  let pos=null;
  for(let i=1;i<bars.length;i++){
    if(i<22) continue;
    const gapPrev = Math.abs(e8[i-1]-e21[i-1])/e21[i-1];
    const convergingUp = e8[i-1] < e21[i-1] && gapPrev < GAP && e8[i]>e8[i-1];
    const crossUp = e8[i-1] < e21[i-1] && e8[i] >= e21[i];
    const anticipated = crossUp || convergingUp;
    const crossDown = e8[i-1] >= e21[i-1] && e8[i] < e21[i];

    if(pos===null){
      if(anticipated){
        const bull = regimeAt(regimeMap, bars[i].t, sortedTs);
        if(bull !== true) continue; // FILTRO: solo entrar si SPY régimen alcista
        pos={entryIdx:i, entryPrice:cl[i]};
      }
    } else {
      const chg = (cl[i]-pos.entryPrice)/pos.entryPrice;
      if(chg <= -CAT){
        const ret = -CAT - COST*2;
        trades.push({ret, t:bars[i].t});
        pos=null;
      } else if(crossDown){
        const ret = chg - COST*2;
        trades.push({ret, t:bars[i].t});
        pos=null;
      }
    }
  }
  return trades;
}

function pf(trades){
  const g=trades.filter(t=>t.ret>0).reduce((a,t)=>a+t.ret,0);
  const l=-trades.filter(t=>t.ret<0).reduce((a,t)=>a+t.ret,0);
  return l===0? (g>0?Infinity:0) : g/l;
}
function median(arr){
  const s=[...arr].sort((a,b)=>a-b);
  const n=s.length; if(n===0) return NaN;
  return n%2? s[(n-1)/2] : (s[n/2-1]+s[n/2])/2;
}

async function main(){
  const SAMPLE = parseInt(process.argv[2]||'100',10);
  const uniRaw = JSON.parse(await (await import('fs')).promises.readFile(new URL('./universe.json', import.meta.url)));
  const list = (uniRaw.universe || uniRaw).slice(0, SAMPLE);

  console.log(`Descargando SPY...`);
  const spyBars = await getW('SPY');
  if(!spyBars){ console.error('No se pudo descargar SPY'); process.exit(1); }
  const regimeMap = buildRegimeMap(spyBars);
  const sortedTs = [...regimeMap.keys()].sort((a,b)=>a-b);
  console.log(`SPY: ${spyBars.length} barras semanales, régimen calculado desde barra ${L200}`);

  let allTrades=[];
  let n=0;
  for(const item of list){
    const ticker = item.ticker || item.tv?.split(':')[1] || item;
    n++;
    const bars = await getW(ticker);
    if(bars){
      const trades = runSymbol(bars, regimeMap, sortedTs);
      allTrades.push(...trades);
    }
    if(n%20===0) console.log(`  ${n}/${list.length} procesados, trades acumulados=${allTrades.length}`);
    await sleep(110);
  }

  allTrades.sort((a,b)=>a.t-b.t);
  const N = allTrades.length;
  const PF = pf(allTrades);
  const MED = median(allTrades.map(t=>t.ret*100));

  // sin-top5%: quitar el 5% mejores trades por retorno
  const sorted = [...allTrades].sort((a,b)=>b.ret-a.ret);
  const cut = Math.floor(N*0.05);
  const trimmed = sorted.slice(cut);
  const PF_trim = pf(trimmed);

  // walk-forward: 4 ventanas temporales iguales
  const tmin = allTrades[0]?.t, tmax = allTrades[N-1]?.t;
  const span = tmax - tmin;
  const windows = [0,1,2,3].map(w=>{
    const lo = tmin + span*w/4, hi = tmin + span*(w+1)/4;
    const wt = allTrades.filter(t=>t.t>=lo && t.t<(w===3?hi+1:hi));
    const mean = wt.length? wt.reduce((a,t)=>a+t.ret,0)/wt.length : 0;
    return {n: wt.length, mean};
  });
  const wfPositive = windows.filter(w=>w.n>=5 && w.mean>0).length;

  console.log('\n=== RESULTADOS: EMA anticipado 8/21 + FILTRO SPY régimen (SPY>EMA200 semanal) ===');
  console.log(`n=${N}`);
  console.log(`PF=${PF}`);
  console.log(`mediana=${MED}%`);
  console.log(`sin-top5% PF=${PF_trim} (n_trimmed=${trimmed.length}, cut=${cut})`);
  console.log(`WF ventanas: ${windows.map(w=>`n=${w.n},mean=${(w.mean*100).toFixed(3)}%`).join(' | ')}`);
  console.log(`WF positivas (n>=5 & mean>0): ${wfPositive}/4`);
}
main();
