/**
 * A deterministic research-only ledger for already simulated fills.
 * It has no broker connection and must not be used as an execution engine.
 * Values and FX rates are explicit assumptions: basePerQuote is the amount
 * of base currency per one unit of the instrument's quote currency.
 */
export function replayShadowLedger({ baseCurrency, initialCash, fills, marks }) {
  if (typeof baseCurrency !== 'string' || !/^[A-Z]{3}$/.test(baseCurrency)) throw new Error('Invalid base currency');
  if (!Number.isFinite(initialCash) || initialCash < 0) throw new Error('Invalid initial cash');
  if (!Array.isArray(fills) || !Array.isArray(marks)) throw new Error('Fills and marks must be arrays');
  const positions = new Map();
  const seen = new Set();
  const journal = [];
  let cash = initialCash;
  let realizedPnl = 0;
  let explicitFees = 0;
  let previousTime = -Infinity;
  for (const fill of fills) {
    const { id, instrumentId, side, quantity, price, basePerQuote, feesBase, signalTime, fillTime } = fill;
    if (typeof id !== 'string' || !id.trim() || seen.has(id)) throw new Error('Missing or duplicate fill id');
    if (typeof instrumentId !== 'string' || !instrumentId.trim()) throw new Error('Missing instrument id');
    if (!['BUY', 'SELL'].includes(side)) throw new Error('Invalid side');
    if (![quantity, price, basePerQuote].every((x) => Number.isFinite(x) && x > 0)) throw new Error('Invalid quantity, price or FX rate');
    if (!Number.isFinite(feesBase) || feesBase < 0) throw new Error('Invalid fees');
    const t = Date.parse(fillTime);
    const signal = Date.parse(signalTime);
    if (!Number.isFinite(t) || !Number.isFinite(signal) || signal >= t || t < previousTime) throw new Error('Invalid or unordered signal/fill time');
    const existing = positions.get(instrumentId) ?? { quantity: 0, costBase: 0 };
    const grossBase = quantity * price * basePerQuote;
    if (!Number.isFinite(grossBase)) throw new Error('Invalid fill value');
    let realized = 0;
    if (side === 'BUY') {
      const total = grossBase + feesBase;
      if (!Number.isFinite(total) || total > cash) throw new Error('Insufficient cash');
      cash -= total;
      existing.quantity += quantity;
      existing.costBase += total;
    } else {
      if (quantity > existing.quantity || existing.quantity <= 0) throw new Error('Insufficient position');
      const allocatedCost = existing.costBase * quantity / existing.quantity;
      const proceeds = grossBase - feesBase;
      if (proceeds < 0) throw new Error('Fees exceed proceeds');
      cash += proceeds;
      existing.quantity -= quantity;
      existing.costBase -= allocatedCost;
      if (existing.quantity === 0) existing.costBase = 0;
      realized = proceeds - allocatedCost;
      realizedPnl += realized;
    }
    positions.set(instrumentId, existing);
    explicitFees += feesBase;
    journal.push({ id, instrumentId, side, signalTime, fillTime, quantity, price, basePerQuote, grossBase, feesBase, cashAfter: cash, quantityAfter: existing.quantity, realizedPnl: realized });
    seen.add(id);
    previousTime = t;
  }
  const markMap = new Map();
  for (const mark of marks) {
    if (typeof mark.instrumentId !== 'string' || !mark.instrumentId.trim() || markMap.has(mark.instrumentId)) throw new Error('Missing or duplicate mark');
    if (![mark.price, mark.basePerQuote].every((x) => Number.isFinite(x) && x > 0)) throw new Error('Invalid mark');
    const markTime = Date.parse(mark.time);
    if (!Number.isFinite(markTime) || markTime < previousTime) throw new Error('Mark precedes fills');
    markMap.set(mark.instrumentId, mark);
  }
  const holdings = [];
  for (const [instrumentId, position] of positions) {
    if (!position.quantity) continue;
    const mark = markMap.get(instrumentId);
    if (!mark) throw new Error(`Missing mark for ${instrumentId}`);
    const valueBase = position.quantity * mark.price * mark.basePerQuote;
    if (!Number.isFinite(valueBase)) throw new Error('Invalid marked value');
    holdings.push({ instrumentId, quantity: position.quantity, costBase: position.costBase, markTime: mark.time, valueBase, unrealizedPnl: valueBase - position.costBase });
  }
  const holdingsValue = holdings.reduce((sum, position) => sum + position.valueBase, 0);
  return {
    version: 'vigilalpha.shadow-ledger.v1', mode: 'SIMULATION_ONLY', baseCurrency,
    initialCash, cash, holdings, holdingsValue, netAssetValue: cash + holdingsValue,
    netPnl: cash + holdingsValue - initialCash, realizedPnl, explicitFees, journal,
    limitations: ['Synthetic fills only; no broker execution or reconciliation', 'No dividends, corporate actions, deposits or withdrawals', 'Moving-average cost basis is not tax advice', 'Fill prices must already incorporate any modeled spread and slippage; do not count them twice', 'FX and fees must be supplied; no estimation or currency conversion is performed', 'Mark timestamps may differ across holdings; no stale-price, synchronized valuation or market-calendar checks', 'Floating-point arithmetic is not suitable for authoritative broker or tax accounting', 'Instrument quote currencies are not verified; same-currency FX must be supplied as 1 by the caller']
  };
}
