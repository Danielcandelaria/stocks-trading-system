// entry_engine.mjs — MOTOR DE SELECCIÓN DE ENTRADAS (única fuente de verdad).
//   Función PURA: recibe los datos, devuelve la recomendación mecánica. No lee ficheros,
//   no escribe, no imprime. La usan select_entries.mjs (CLI) y dashboard.mjs (tarjeta).
//
//   Reglas: escalera validada STACK→CONFLUENCIA→P1→P2, excluir held, cap 2/sector,
//   tope 8 posiciones, sizing ¼ Kelly (2.5% riesgo / stop 18% → ~13.9%), 1x,
//   freno de cartera por drawdown (-25% pausa / -15% reactiva, histéresis).

export const PARAMS = {
  SL_PCT: 0.18, RISK_FRAC: 0.025, POS_MIN: 0.13, POS_MAX: 0.16,
  MAX_OPEN: 8, SECT_CAP: 2, DD_PAUSE: -25, DD_RESUME: -15,
};

// Calcula el estado del freno (puro). Devuelve {peak, frenoActivo, ddPct}.
export function frenoState(account) {
  const { DD_PAUSE, DD_RESUME } = PARAMS;
  const cap = +account?.valorTotal || 0;
  const peak = Math.max(+account?.peakValue || 0, cap);
  let frenoActivo = !!account?.frenoActivo;
  const ddPct = peak > 0 ? +(((cap / peak) - 1) * 100).toFixed(2) : 0;
  if (cap >= peak) frenoActivo = false;
  else if (!frenoActivo && ddPct <= DD_PAUSE) frenoActivo = true;
  else if (frenoActivo && ddPct >= DD_RESUME) frenoActivo = false;
  return { peak, frenoActivo, ddPct };
}

// radar = radar_live.json · tradesArr = trades_real.json.trades · universeRaw = universe.json · account = account.json
export function selectEntries({ radar, trades: tradesArr = [], universe, account = {} }) {
  const P = PARAMS;
  const uni = Array.isArray(universe) ? universe : (universe?.universe || []);
  const SECT = Object.fromEntries(uni.filter(u => u && u.ticker).map(u => [u.ticker.toUpperCase(), u.sector || null]));
  const cap = +account.valorTotal || 0;
  const cash = +account.disponible || 0;
  const { peak, frenoActivo, ddPct } = frenoState(account);

  const held = new Set(tradesArr.filter(t => ['open', 'closed'].includes(t.status)).map(t => t.ticker.toUpperCase()));
  const openReal = tradesArr.filter(t => t.status === 'open');
  const nOpen = openReal.length;
  const sectCount = {};
  for (const t of openReal) { const s = t.sector || SECT[t.ticker.toUpperCase()]; if (s) sectCount[s] = (sectCount[s] || 0) + 1; }

  const lv = i => (radar?.levels?.[i]?.tickers || [])
    .filter(t => !held.has(t.ticker.toUpperCase()))
    .map(t => ({ ...t, sector: SECT[t.ticker.toUpperCase()] || null, stop: +(t.price * (1 - P.SL_PCT)).toFixed(2) }));
  const cross0 = lv(0).filter(t => t.weeks === 0);
  const confAll = [
    ...cross0.filter(t => t.conf9).sort((a, b) => b.extPct - a.extPct),
    ...lv(1).concat(lv(2)).filter(t => t.conf9).sort((a, b) => a.gapPct - b.gapPct),
  ];
  const stack = confAll.filter(t => t.conf9 && t.below200 === true);
  const conf = confAll.filter(t => !(t.conf9 && t.below200 === true));
  const inConf = new Set(confAll.map(t => t.ticker.toUpperCase()));
  const noC = arr => arr.filter(t => !inConf.has(t.ticker.toUpperCase()));
  const p1 = noC(lv(1)).sort((a, b) => a.gapPct - b.gapPct);
  const p2 = noC(cross0.filter(t => (t.extPct ?? 0) >= 15)).sort((a, b) => b.extPct - a.extPct);
  const ladder = [
    ...stack.map(t => ({ ...t, tier: '⭐⭐ STACK' })),
    ...conf.map(t => ({ ...t, tier: '⭐ CONFLUENCIA' })),
    ...p1.map(t => ({ ...t, tier: '🎯 P1 anticipada' })),
    ...p2.map(t => ({ ...t, tier: '🎯 P2 cruzada fuerte' })),
  ];

  const riskUsd = +(cap * P.RISK_FRAC).toFixed(2);
  const posUsd = +Math.min(Math.max(riskUsd / P.SL_PCT, cap * P.POS_MIN), cap * P.POS_MAX).toFixed(2);
  const slotsByCount = Math.max(0, P.MAX_OPEN - nOpen);
  const slotsByCash = posUsd > 0 ? Math.floor(cash / posUsd) : 0;
  const slots = frenoActivo ? 0 : Math.min(slotsByCount, slotsByCash);

  const picks = [], skipped = [], runSect = { ...sectCount };
  for (const c of ladder) {
    if (picks.length >= slots) break;
    const s = c.sector;
    if (s && (runSect[s] || 0) >= P.SECT_CAP) { skipped.push({ ticker: c.ticker, tier: c.tier, sector: s, reason: `sector lleno (${s}: ${runSect[s]})` }); continue; }
    picks.push({ ticker: c.ticker, tv: c.tv, tier: c.tier, sector: s, price: c.price, amountUsd: posUsd,
      shares: posUsd > 0 && c.price ? +(posUsd / c.price).toFixed(4) : 0, stop: c.stop, stopPct: -18, riskUsd, leverage: 1,
      extPct: c.extPct ?? null, gapPct: c.gapPct ?? null });
    if (s) runSect[s] = (runSect[s] || 0) + 1;
  }

  return {
    account: { valorTotal: cap, disponible: cash, invertido: +account.invertido || null },
    sizing: { posUsd, riskUsd, pctCapital: cap ? +(posUsd / cap * 100).toFixed(1) : 0, leverage: 1, stopPct: -18 },
    limits: { maxOpen: P.MAX_OPEN, openNow: nOpen, slotsByCount, slotsByCash, slotsUsable: slots, sectorCap: P.SECT_CAP },
    freno: { activo: frenoActivo, peak, ddPct, pausaEn: P.DD_PAUSE, reactivaEn: P.DD_RESUME },
    picks, skipped,
  };
}
