// Refinamiento: ¿el cruce contrario EMA8<EMA21 es la salida óptima?
// Alternativas SOLO con componentes ya dentro del sistema.
import fs from 'fs';
import { computeTDSetup } from '../scanner/demark_calc.mjs';

const UA={'User-Agent':'Mozilla/5.0'};
const COST=0.0006, CAT=0.18, GAP=0.012, L200=200, CONF=8;
const SAMPLE=120, SLEEP=110;
const ema=(cl,p)=>{const k=2/(p+1);let e=null;return cl.map(c=>{e=e===null?c:c*k+e*(1-k);return e;});};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function getW(t){const y=t.replace('.','-');try{const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1wk`,{headers:UA});const d=(await r.json()).chart?.result?.[0];const q=d?.indicators?.quote?.[0];if(!d?.timestamp)return null;const b=[];for(let i=0;i<d.timestamp.length;i++)if(q.close[i]!=null&&q.high[i]!=null&&q.low[i]!=null)b.push({t:d.timestamp[i],h:q.high[i],l:q.low[i],c:q.close[i],o:q.open?.[i]??null});return b.length>220?b:null;}catch{return null;}}

function pct(a){a=[...a].sort((x,y)=>x-y);if(!a.length)return 0;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
function pf(rs){let g=0,l=0;for(const r of rs){if(r>0)g+=r;else l-=r;}return l>0?g/l:(g>0?Infinity:0);}
function pfNoTop(rs){const s=[...rs].sort((a,b)=>b-a);const cut=Math.max(1,Math.round(s.length*0.05));return pf(s.slice(cut));}
function stats(tr){
  const rs=tr.map(t=>t.ret);
  const wins=rs.filter(r=>r>0).length;
  return {n:rs.length,PF:pf(rs),med:pct(rs)*100,noTop:pfNoTop(rs),WR:rs.length?wins/rs.length*100:0,
    avg:rs.length?rs.reduce((a,b)=>a+b,0)/rs.length*100:0,
    hold:rs.length?tr.reduce((a,b)=>a+b.bars,0)/rs.length:0};
}
function wf(tr){ // 4 ventanas por tiempo de entrada
  if(!tr.length)return '0/4';
  const ts=tr.map(t=>t.t).sort((a,b)=>a-b);const min=ts[0],max=ts[ts.length-1];
  let ok=0;for(let w=0;w<4;w++){const lo=min+(max-min)*w/4,hi=min+(max-min)*(w+1)/4;
    const s=tr.filter(t=>t.t>=lo&&(w===3?t.t<=hi:t.t<hi)).map(t=>t.ret);
    if(s.length>=5&&s.reduce((a,b)=>a+b,0)/s.length>0)ok++;}
  return `${ok}/4`;
}

const uni=JSON.parse(fs.readFileSync(new URL('./universe.json',import.meta.url)));
const list=(uni.universe||uni).slice(0,SAMPLE).map(x=>x.ticker);

const MODES=['cross','demark9','ema200up','time52'];
const RES={}; for(const m of MODES) RES[m]={all:[],conf:[]};

let done=0;
for(const tk of list){
  const bars=await getW(tk); await sleep(SLEEP);
  done++;
  if(!bars){continue;}
  const cl=bars.map(b=>b.c);
  const ef=ema(cl,8), es=ema(cl,21), e200=ema(cl,L200);
  const td=computeTDSetup(bars);
  const n=bars.length;
  for(let i=L200;i<n-1;i++){
    const gap=(ef[i]-es[i])/cl[i], gp=(ef[i-1]-es[i-1])/cl[i-1];
    if(!(gap<0 && Math.abs(gap)<GAP && gap>gp)) continue;
    // confluencia: bullSetup==9 en las <=CONF velas previas (incl. i)
    let conf=false; for(let k=Math.max(0,i-CONF);k<=i;k++) if(td.bullSetup[k]===9){conf=true;break;}
    const entry=cl[i];
    for(const mode of MODES){
      let ret=null,bars_=0;
      for(let j=i+1;j<n;j++){
        bars_=j-i;
        if(bars[j].l<=entry*(1-CAT)){ret=-CAT-COST;break;}
        if(mode==='cross'){ if(ef[j-1]>=es[j-1]&&ef[j]<es[j]){ret=cl[j]/entry-1-COST;break;} }
        else if(mode==='demark9'){ if(td.bearSetup[j]===9){ret=cl[j]/entry-1-COST;break;} }
        else if(mode==='ema200up'){ if(cl[j-1]<=e200[j-1]&&cl[j]>e200[j]){ret=cl[j]/entry-1-COST;break;} }
        else if(mode==='time52'){ if(bars_>=52){ret=cl[j]/entry-1-COST;break;} }
      }
      if(ret===null){ret=cl[n-1]/entry-1-COST;bars_=n-1-i;} // abierto -> marcar a mercado
      const rec={ret,t:bars[i].t,bars:bars_,tk};
      RES[mode].all.push(rec); if(conf)RES[mode].conf.push(rec);
    }
  }
  if(done%20===0)process.stderr.write(`${done}/${list.length}\n`);
}

const NAMES={cross:'(a) cruce EMA8<EMA21 [ACTUAL]',demark9:'(b) DeMark Sell Setup-9',ema200up:'(c) cruce arriba EMA200',time52:'(d) time-stop 52 semanas'};
function tbl(key,title){
  console.log(`\n=== ${title} ===`);
  console.log('salida'.padEnd(32),'n'.padStart(5),'PF'.padStart(7),'med%'.padStart(8),'sinTop5%'.padStart(9),'WR%'.padStart(7),'avg%'.padStart(8),'holdW'.padStart(7),' WF');
  for(const m of MODES){const s=stats(RES[m][key]);
    console.log(NAMES[m].padEnd(32),String(s.n).padStart(5),s.PF.toFixed(2).padStart(7),s.med.toFixed(2).padStart(8),s.noTop.toFixed(2).padStart(9),s.WR.toFixed(1).padStart(7),s.avg.toFixed(2).padStart(8),s.hold.toFixed(1).padStart(7),' '+wf(RES[m][key]));}
}
tbl('all','EMA anticipado (baseline, sin confluencia)');
tbl('conf','CONFLUENCIA (EMA anticipado + DeMark Buy-9 <=8 velas)');
