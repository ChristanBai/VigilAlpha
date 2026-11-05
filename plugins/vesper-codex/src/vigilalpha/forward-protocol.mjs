import { createHash } from 'node:crypto';

// This contract records a prospective research plan. It does not run signals,
// simulate fills, prove when a record was made, or authorize live trading.
const patterns = Object.freeze(['sma-trend-cross', 'rsi-momentum', 'volume-breakout-20']);
const bpsFields = ['commissionBps', 'spreadAndSlippageBps', 'fxFeeBps', 'taxesBps'];

export function freezeForwardProtocol({ frozenAt, startsAt, instrumentId, quoteCurrency, baseCurrency, dataSource, adjustmentPolicy, costs }) {
  const freeze = timestamp(frozenAt, 'frozenAt');
  const start = timestamp(startsAt, 'startsAt');
  if (start <= freeze) throw new Error('startsAt must be later than frozenAt');
  for (const [label, value] of Object.entries({ instrumentId, dataSource, adjustmentPolicy })) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  }
  for (const currency of [baseCurrency, quoteCurrency]) {
    if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid currency');
  }
  if (!costs || bpsFields.some((key) => typeof costs[key] !== 'number' || !Number.isFinite(costs[key]) || costs[key] < 0) || typeof costs.fxApplied !== 'boolean') throw new Error('Invalid explicit costs');
  if (baseCurrency === quoteCurrency && costs.fxApplied) throw new Error('Same-currency trade cannot incur FX fee');
  if (bpsFields.reduce((sum, key) => sum + (key === 'fxFeeBps' && !costs.fxApplied ? 0 : costs[key]), 0) >= 10000) throw new Error('Cost rate invalid');
  const spec = {
    version: 'vigilalpha.forward-protocol.v1', frozenAt: new Date(freeze).toISOString(), startsAt: new Date(start).toISOString(),
    instrumentId: instrumentId.trim(), baseCurrency, quoteCurrency, dataSource: dataSource.trim(), adjustmentPolicy: adjustmentPolicy.trim(),
    strategies: patterns.map((id) => ({ id, parameters: id === patterns[0] ? 'SMA20>SMA50; otherwise cash' : id === patterns[1] ? 'RSI14 >55 enter, <45 exit, else hold' : 'close > prior 20 highs and volume > 1.5x prior 20 mean; exit close < SMA20' })),
    execution: 'close signal; next session open; missing open => abstain',
    benchmark: 'same instrument, currency, start, end and entry cost; final mark without forced sale',
    costs: { commissionBps: costs.commissionBps, spreadAndSlippageBps: costs.spreadAndSlippageBps, fxFeeBps: costs.fxFeeBps, taxesBps: costs.taxesBps, fxApplied: costs.fxApplied },
    evaluation: ['net return', 'same-cost benchmark', 'max drawdown', 'trade count', 'cost drag', 'abstentions'],
    status: 'PLAN_ONLY', liveTradingAuthorized: false,
    limitations: ['No verified clock, append-only storage or independent timestamp', 'No price/FX data, fills, cash ledger or corporate action implementation', 'Does not establish profitability or automatically promote a strategy']
  };
  return { spec, sha256: createHash('sha256').update(JSON.stringify(spec)).digest('hex') };
}

// A caller must preserve source timestamps; historical bar date alone is not
// evidence that the value was known by a signal. ISO timestamps require zones.
export function checkObservationAvailability({ observationAt, availableAt, signalAt, frozenAt, startsAt }) {
  const observation = timestamp(observationAt, 'observationAt');
  const available = timestamp(availableAt, 'availableAt');
  const signal = timestamp(signalAt, 'signalAt');
  const freeze = timestamp(frozenAt, 'frozenAt');
  const start = timestamp(startsAt, 'startsAt');
  if (start <= freeze) throw new Error('startsAt must be later than frozenAt');
  if (observation > available || available > signal || signal < start) return { allowed: false, reason: 'FUTURE_OR_UNAVAILABLE_DATA' };
  return { allowed: true, reason: null };
}

function timestamp(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) throw new Error(`${name} must be an ISO timestamp with timezone`);
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${name} invalid`);
  return time;
}
