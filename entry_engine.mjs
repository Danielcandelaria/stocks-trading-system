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

// Frescura de una señal WeeklySwing (semanas desde el cierre de la vela). Igual que el dashboard.
export function weeklyWk(signalT, nowMs) {
  const dt = new Date(nowMs); const dow = dt.getUTCDay();
  const monday = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate() - ((dow + 6) % 7)) / 1000;
  const weekClosed = dow === 0 || dow === 6 || (dow === 5 && dt.getUTCHours() >= 20);
  const anchor = monday - (weekClosed ? 0 : 7 * 86400);
  return Math.max(0, Math.round((anchor - signalT) / (7 * 86400)));
}

// radar = radar_live.json · tradesArr = trades_real.json.trades · universeRaw = universe.json
// account = account.json · weeklyJournal = journal_weekly.json (array) · nowMs = Date.now()
export function selectEntries({ radar, trades: tradesArr = [], universe, account = {}, weeklyJournal = [], nowMs = 0 }) {
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

  // ── WeeklySwing (reversión DeMark-9): señales frescas (wk≤1), no en cartera. Complementa EMACross (ρ 0.47). ──
  const ws = (weeklyJournal || [])
    .filter(p => p.status === 'open' && p.ticker && !held.has(p.ticker.toUpperCase()))
    .map(p => ({ ticker: p.ticker, tv: p.tv || p.ticker, sector: p.sector || SECT[p.ticker.toUpperCase()] || null,
      price: +(+p.entryPx).toFixed(2), stop: p.stop != null ? +(+p.stop).toFixed(2) : null,
      weeks: nowMs ? weeklyWk(p.signalT, nowMs) : 0, system: 'WeeklySwing', tier: '🟣 WeeklySwing (suelo DeMark)' }))
    .filter(p => p.weeks <= 1)
    .sort((a, b) => a.weeks - b.weeks);
  const wsFresh = ws.filter(p => p.weeks === 0), wsValid = ws.filter(p => p.weeks >= 1);

  // Escalera COMBINada. La confluencia EMACross (cruce+setup9) manda; luego WeeklySwing fresco
  // (PF 3.98 > P1/P2 de EMACross); luego los tramos anticipados de EMACross. Diversifica momentum+reversión.
  const tag = (arr, system, tier) => arr.map(t => ({ ...t, system: t.system || system, tier: t.tier || tier }));
  const ladder = [
    ...tag(stack, 'EMACross', '⭐⭐ STACK'),
    ...tag(conf, 'EMACross', '⭐ CONFLUENCIA'),
    ...wsFresh,
    ...tag(p1, 'EMACross', '🎯 P1 anticipada'),
    ...tag(p2, 'EMACross', '🎯 P2 cruzada fuerte'),
    ...wsValid,
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
    if (s && (runSect[s] || 0) >= P.SECT_CAP) { skipped.push({ ticker: c.ticker, tier: c.tier, system: c.system || 'EMACross', sector: s, reason: `sector lleno (${s}: ${runSect[s]})` }); continue; }
    picks.push({ ticker: c.ticker, tv: c.tv, system: c.system || 'EMACross', tier: c.tier, sector: s, price: c.price, amountUsd: posUsd,
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
