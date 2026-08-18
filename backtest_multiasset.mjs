#!/usr/bin/env node
// backtest_multiasset.mjs — ¿el sistema EMA8/21 sirve para MATERIAS PRIMAS y FOREX?
//   Motor idéntico al de acciones (cruce 8/21 semanal, stop catástrofe 18%, salida cruce contrario),
//   pero prueba LONG-ONLY vs LONG+SHORT y modos Confirmado vs Anticipado (gap<2%).
//   Sin sesgo de supervivencia (los instrumentos no desaparecen). 10 años semanal, coste 0.06%/lado.
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const COST = 0.0006, CAT = 0.18, GAP = 0.02;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ema = (cl, p) => { const k = 2 / (p + 1); let e = null; return cl.map(c => { e = e === null ? c : c * k + e * (1 - k); return e; }); };

async function getW(t) {
  try { const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?range=10y&interval=1wk`, { headers: UA });
    if (!r.ok) return null; const d = (await r.json()).chart?.result?.[0]; const q = d?.indicators?.quote?.[0];
    if (!d?.timestamp || !q) return null; const b = [];
    for (let i = 0; i < d.timestamp.length; i++) if (q.close[i] != null && q.high[i] != null && q.low[i] != null)
      b.push({ t: d.timestamp[i], h: q.high[i], l: q.low[i], c: q.close[i] });
    return b.length > 60 ? b : null; } catch { return null; } }

// pos: 1 long, -1 short, 0 flat. mode: 'con'|'ant'. allowShort: bool
function trades(bars, mode, allowShort) {
  const cl = bars.map(b => b.c), ef = ema(cl, 8), es = ema(cl, 21), out = [];
  let pos = 0, ei = 0, stop = 0;
  for (let i = 22; i < bars.length; i++) {
    const gap = (ef[i] - es[i]) / cl[i], gp = (ef[i - 1] - es[i - 1]) / cl[i - 1];
    const bull = ef[i - 1] <= es[i - 1] && ef[i] > es[i], bear = ef[i - 1] >= es[i - 1] && ef[i] < es[i];
    const li = gap < 0 && Math.abs(gap) < GAP && gap > gp;   // long anticip
    const si = gap > 0 && gap < GAP && gap < gp;             // short anticip
    const longSig = mode === 'ant' ? li : bull;
    const shortSig = mode === 'ant' ? si : bear;
    if (pos === 1) {
      if (bars[i].l <= stop) { out.push({ r: (stop / cl[ei] - 1) * 100 - COST * 200, t: bars[ei].t }); pos = 0; }
      else if (bear) { out.push({ r: (cl[i] / cl[ei] - 1) * 100 - COST * 200, t: bars[ei].t }); pos = 0; }
    } else if (pos === -1) {
      if (bars[i].h >= stop) { out.push({ r: (1 - stop / cl[ei]) * 100 - COST * 200, t: bars[ei].t }); pos = 0; }
      else if (bull) { out.push({ r: (1 - cl[i] / cl[ei]) * 100 - COST * 200, t: bars[ei].t }); pos = 0; }
    }
    if (pos === 0) {
      if (longSig) { pos = 1; ei = i; stop = cl[i] * (1 - CAT); }
      else if (allowShort && shortSig) { pos = -1; ei = i; stop = cl[i] * (1 + CAT); }
    }
  }
  return out;
}

const st = a => { const rs = a.map(x => x.r), n = rs.length; if (!n) return { n: 0, pf: 0, m: 0, wr: 0 };
  const w = rs.filter(x => x > 0), l = rs.filter(x => x <= 0), gw = w.reduce((x, y) => x + y, 0), gl = l.reduce((x, y) => x + y, 0);
  return { n, pf: gl ? Math.abs(gw / gl) : (gw > 0 ? 99 : 0), m: rs.reduce((x, y) => x + y, 0) / n, wr: 100 * w.length / n }; };
function wf(a) { if (a.length < 8) return '—'; const t0 = Math.min(...a.map(x => x.t)), t1 = Math.max(...a.map(x => x.t)), sp = (t1 - t0) / 4;
  const p = [0, 1, 2, 3].map(k => st(a.filter(x => Math.min(3, Math.floor((x.t - t0) / sp)) === k))); return p.filter(x => x.n >= 3 && x.m > 0).length + '/4'; }

const CLASSES = {
  'MATERIAS PRIMAS': ['GC=F','SI=F','HG=F','PL=F','PA=F','CL=F','BZ=F','NG=F','RB=F','HO=F','ZC=F','ZW=F','ZS=F','ZM=F','ZL=F','KC=F','SB=F','CT=F','CC=F','LE=F','HE=F','GF=F'],
  'FOREX': ['EURUSD=X','GBPUSD=X','USDJPY=X','AUDUSD=X','USDCAD=X','USDCHF=X','NZDUSD=X','EURGBP=X','EURJPY=X','GBPJPY=X','AUDJPY=X','EURCHF=X','CADJPY=X','CHFJPY=X','NZDJPY=X','EURAUD=X','GBPAUD=X','AUDNZD=X','EURCAD=X','GBPCAD=X'],
};

(async () => {
  console.log('\n════ EMA 8/21 semanal en OTRAS CLASES (10 años, sin sesgo supervivencia, coste 0.06%/lado) ════\n');
  for (const [name, tks] of Object.entries(CLASSES)) {
    const acc = { LC: [], LA: [], SC: [], SA: [] }; let ok = 0;   // L=long-only, S=long+short ; C=confirm, A=anticip
    for (const t of tks) { const b = await getW(t); await sleep(120); if (!b) continue; ok++;
      acc.LC.push(...trades(b, 'con', false)); acc.LA.push(...trades(b, 'ant', false));
      acc.SC.push(...trades(b, 'con', true));  acc.SA.push(...trades(b, 'ant', true)); }
    console.log(`── ${name} (${ok}/${tks.length} con datos) ──`);
    const row = (lbl, a) => { const s = st(a); console.log(`  ${lbl.padEnd(26)} PF ${s.pf.toFixed(2).padStart(5)} · WR ${s.wr.toFixed(0).padStart(2)}% · exp ${s.m >= 0 ? '+' : ''}${s.m.toFixed(2)}%/tr · ${String(s.n).padStart(4)}tr · WF ${wf(a)}`); };
    row('LONG-only · Confirmado', acc.LC);
    row('LONG-only · Anticipado', acc.LA);
    row('LONG+SHORT · Confirmado', acc.SC);
    row('LONG+SHORT · Anticipado', acc.SA);
    console.log('');
  }
  console.log('  PF≥1.3 + WF 3-4/4 = candidato real. PF~1 = breakeven. Muestra por clase, no por instrumento.');
  console.log('  Recordatorio: forex es el OTRO sistema en vivo; esto es solo validación de investigación.\n');
})();
