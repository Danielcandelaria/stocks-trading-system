// Hipotesis: filtro de baja volatilidad relativa (ATR14/precio semanal vs mediana del universo en ese momento)
// Motor BASE sin cambios (EMA anticipado 8/21, stop -18%, salida cruce contrario). SOLO se anade el filtro de vol.
const UA={'User-Agent':'Mozilla/5.0'};const COST=0.0006,CAT=0.18,GAP=0.012,L200=200;
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i],o:q.open?.[i]??null,v:q.volume?.[i]??null});return b.length>220?b:null;}catch{return null;}}

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

// ATR14 semanal (Wilder simple average, suficiente para un filtro relativo) / precio
function computeAtrPct(bars){
  const tr=[];
  for(let i=0;i<bars.length;i++){
    if(i===0){tr.push(bars[i].h-bars[i].l);continue;}
    const prevC=bars[i-1].c;
    tr.push(Math.max(bars[i].h-bars[i].l, Math.abs(bars[i].h-prevC), Math.abs(bars[i].l-prevC)));
  }
  const atrPct=new Array(bars.length).fill(null);
  for(let i=13;i<bars.length;i++){
    let sum=0;for(let j=i-13;j<=i;j++)sum+=tr[j];
    const atr=sum/14;
    atrPct[i]=atr/bars[i].c;
  }
  return atrPct;
}

function simulate(bars, atrPct){
  const cl=bars.map(b=>b.c);
  const e8=ema(cl,8), e21=ema(cl,21);
  const trades=[];
  let inPos=false, entryPrice=null, entryIdx=null, stopPrice=null;
  for(let i=L200;i<bars.length;i++){
    if(e8[i]==null||e21[i]==null)continue;
    if(!inPos){
      // entry base: EMA anticipado (gap<1.2% convergiendo)
      const gap=(e8[i]-e21[i])/e21[i];
      const gapPrev=(e8[i-1]-e21[i-1])/e21[i-1];
      const converging = e8[i]<e21[i] && gap>-GAP && gap>gapPrev; // acercandose desde abajo
      if(converging){
        // FILTRO: baja volatilidad relativa - solo entra si atrPct[i] <= mediana del universo EN ESE MOMENTO
        // (la mediana del universo se aplica fuera, aqui solo devolvemos el atrPct de la senal para filtrar despues)
        trades.push({type:'candidate', idx:i, price:bars[i].c, atrPct: atrPct[i]});
        inPos=true; entryPrice=bars[i].c; entryIdx=i; stopPrice=entryPrice*(1-CAT);
      }
    } else {
      const crossDown = e8[i]<e21[i] && e8[i-1]>=e21[i-1];
      const stopHit = bars[i].l <= stopPrice;
      if(crossDown || stopHit || i===bars.length-1){
        const exitPrice = stopHit ? stopPrice : bars[i].c;
        const last=trades[trades.length-1];
        last.exitIdx=i; last.exitPrice=exitPrice; last.exitT=bars[i].t;
        last.entryT=bars[entryIdx].t;
        last.ret = (exitPrice*(1-COST) - entryPrice*(1+COST)) / (entryPrice*(1+COST));
        inPos=false;
      }
    }
  }
  return trades.filter(t=>t.exitIdx!=null);
}

function pf(trades){
  let gain=0, loss=0;
  for(const t of trades){ if(t.ret>0) gain+=t.ret; else loss+=-t.ret; }
  return loss===0? (gain>0?Infinity:0) : gain/loss;
}
function median(arr){
  const s=[...arr].sort((a,b)=>a-b);
  const n=s.length; if(n===0)return NaN;
  return n%2? s[(n-1)/2] : (s[n/2-1]+s[n/2])/2;
}

async function main(){
  const SAMPLE = parseInt(process.argv[2]||'100',10);
  const raw = JSON.parse(await (await import('fs/promises')).readFile(new URL('./universe.json', import.meta.url)));
  const uni = (raw.universe || raw).slice(0, SAMPLE);
  console.log(`Universo: ${uni.length} tickers`);

  const allBars = {};
  let ok=0, fail=0;
  for(const item of uni){
    const t = item.ticker;
    const b = await getW(t);
    if(b){ allBars[t]=b; ok++; } else fail++;
    await sleep(110);
  }
  console.log(`Descargados OK: ${ok}, fail: ${fail}`);

  // simular candidatos por ticker (sin filtro aun) para poder calcular mediana global de vol por fecha
  const perTickerTrades = {};
  for(const [t,bars] of Object.entries(allBars)){
    const atrPct = computeAtrPct(bars);
    perTickerTrades[t] = { bars, trades: simulate(bars, atrPct) };
  }

  // construir, para cada semana (timestamp) presente en cualquier serie, la mediana de atrPct del universo en esa fecha
  // aproximacion: usamos el atrPct de cada entrada individual y comparamos contra la mediana de TODAS las entradas (candidatas) de ESE MISMO timestamp exacto en el universo
  const byTs = {};
  for(const [t,{trades}] of Object.entries(perTickerTrades)){
    for(const tr of trades){
      const ts = tr.entryT;
      if(!byTs[ts]) byTs[ts]=[];
      byTs[ts].push(tr.atrPct);
    }
  }
  const medianByTs = {};
  for(const ts of Object.keys(byTs)) medianByTs[ts]=median(byTs[ts]);

  // BASELINE (todas las señales, sin filtro) y FILTRADO (lowvol: atrPct <= mediana del universo en esa fecha)
  const baseTrades=[], lowVolTrades=[];
  for(const [t,{trades}] of Object.entries(perTickerTrades)){
    for(const tr of trades){
      baseTrades.push(tr);
      const med = medianByTs[tr.entryT];
      if(med!=null && tr.atrPct<=med) lowVolTrades.push(tr);
    }
  }

  function report(label, trades){
    const n = trades.length;
    const rets = trades.map(t=>t.ret*100);
    const PF = pf(trades);
    const med = median(rets);
    const sorted = [...trades].sort((a,b)=>a.ret-b.ret);
    const cut = Math.floor(n*0.95);
    const noTop5 = sorted.slice(0,cut);
    const pfNoTop5 = pf(noTop5);

    // walk-forward: 4 ventanas por fecha de entrada
    const allTs = trades.map(t=>t.entryT).sort((a,b)=>a-b);
    const minT=allTs[0], maxT=allTs[allTs.length-1];
    const span=(maxT-minT)/4;
    let wfPos=0;
    for(let w=0;w<4;w++){
      const lo=minT+w*span, hi= w===3? maxT+1 : minT+(w+1)*span;
      const wtr = trades.filter(t=>t.entryT>=lo && t.entryT<hi);
      const wn=wtr.length;
      const wmean = wn? wtr.reduce((s,t)=>s+t.ret,0)/wn : 0;
      const pass = wn>=5 && wmean>0;
      if(pass) wfPos++;
      console.log(`  [${label}] ventana ${w+1}: n=${wn}, media=${(wmean*100).toFixed(3)}%, pass=${pass}`);
    }

    console.log(`\n=== ${label} ===`);
    console.log(`n=${n}, PF=${PF.toFixed(4)}, mediana=${med.toFixed(4)}%, sinTop5%=${pfNoTop5.toFixed(4)}, WF=${wfPos}/4`);
    return {n, PF, med, pfNoTop5, wfPos};
  }

  const rBase = report('BASELINE (sin filtro vol)', baseTrades);
  const rLow = report('LOWVOL (atrPct <= mediana universo)', lowVolTrades);

  console.log('\n--- COMPARACION FINAL ---');
  console.log('BASELINE local:', JSON.stringify(rBase));
  console.log('LOWVOL       :', JSON.stringify(rLow));
}
main();
