import { evaluatePatternSignal } from './validation.mjs';
import { replayShadowLedger } from './shadow-ledger.mjs';

// Offline proof of integration, not live trading or a validated forward test.
// Every bar has explicit open/close and availability times. FX is base per quote.
export function replaySignalLedger({ patternId, instrumentId, baseCurrency, quoteCurrency, initialCash, costBps, bars }) {
  const lookbacks = { 'sma-trend-cross': 50, 'rsi-momentum': 15, 'volume-breakout-20': 20 };
  const lookback = lookbacks[patternId];
  if (!lookback || typeof instrumentId !== 'string' || !instrumentId.trim()) throw new Error('Invalid strategy or instrument');
  if (![baseCurrency, quoteCurrency].every(c => typeof c === 'string' && /^[A-Z]{3}$/.test(c))) throw new Error('Invalid currency');
  if (!Number.isFinite(initialCash) || initialCash <= 0 || !Number.isFinite(costBps) || costBps < 0 || costBps >= 10000) throw new Error('Invalid cash or costs');
  if (!Array.isArray(bars) || bars.length < lookback + 2) throw new Error('Insufficient bars');
  let prevClose = -Infinity;
  for (const b of bars) {
    const timeFields = ['openTime', 'closeTime', 'availableAt', 'openFxAvailableAt', 'closeFxAvailableAt'];
    if (timeFields.some(k => typeof b[k] !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(b[k]) || !Number.isFinite(Date.parse(b[k])))) throw new Error('Invalid timestamps');
    const open = Date.parse(b.openTime), close = Date.parse(b.closeTime), available = Date.parse(b.availableAt);
    if (open <= prevClose || close <= open || available < close || Date.parse(b.openFxAvailableAt) > open || Date.parse(b.closeFxAvailableAt) > close) throw new Error('Unavailable or unordered data');
    if (![b.open, b.close, b.openFx, b.closeFx].every(v => Number.isFinite(v) && v > 0)) throw new Error('Missing price or FX');
    if (baseCurrency === quoteCurrency && (b.openFx !== 1 || b.closeFx !== 1)) throw new Error('Same currency FX must equal 1');
    if (patternId === 'volume-breakout-20' && (!Number.isFinite(b.high) || b.high < Math.max(b.open, b.close) || !Number.isFinite(b.volume) || b.volume < 0)) throw new Error('Missing breakout data');
    prevClose = close;
  }
  for (let i = 0; i < bars.length - 1; i++) {
    if (Date.parse(bars[i].availableAt) >= Date.parse(bars[i + 1].openTime)) throw new Error('Signal unavailable before next open');
  }
  const pattern = { id: patternId, lookback };
  let desired = 0, held = 0, cash = initialCash;
  const fills = [], signals = [];
  for (let i = lookback; i < bars.length - 1; i++) {
    const current = bars[i], next = bars[i + 1];
    const signalTime = current.availableAt;
    if (Date.parse(signalTime) >= Date.parse(next.openTime)) throw new Error('Signal unavailable before next open');
    desired = evaluatePatternSignal(pattern, bars, i, desired);
    signals.push({ signalTime, desired, executionTime: next.openTime });
    if (Boolean(desired) === (held > 0)) continue;
    const priceBase = next.open * next.openFx;
    const rate = costBps / 10000;
    const quantity = desired ? (cash / (priceBase * (1 + rate))) * (1 - 1e-12) : held;
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Invalid hypothetical quantity');
    const feesBase = quantity * priceBase * rate;
    fills.push({ id: `fill-${i}`, instrumentId, side: desired ? 'BUY' : 'SELL', quantity, price: next.open, basePerQuote: next.openFx, feesBase, signalTime, fillTime: next.openTime });
    cash += desired ? -(quantity * priceBase + feesBase) : quantity * priceBase - feesBase;
    held = desired ? quantity : 0;
  }
  const last = bars.at(-1);
  const ledger = replayShadowLedger({ baseCurrency, initialCash, fills, marks: held ? [{ instrumentId, price: last.close, basePerQuote: last.closeFx, time: last.closeTime }] : [] });
  // Start the passive benchmark at the first eligible execution open, not at
  // the beginning of the indicator warm-up period or the first actual buy.
  const entry = bars[lookback + 1];
  const benchmarkQuantity = initialCash / (entry.open * entry.openFx * (1 + costBps / 10000)) * (1 - 1e-12);
  const benchmark = replayShadowLedger({
    baseCurrency, initialCash,
    fills: [{ id: 'benchmark-buy', instrumentId, side: 'BUY', quantity: benchmarkQuantity,
      price: entry.open, basePerQuote: entry.openFx,
      feesBase: benchmarkQuantity * entry.open * entry.openFx * costBps / 10000,
      signalTime: bars[lookback].availableAt, fillTime: entry.openTime }],
    marks: [{ instrumentId, price: last.close, basePerQuote: last.closeFx, time: last.closeTime }]
  });
  const comparison = {
    baseCurrency, startTime: entry.openTime, endTime: last.closeTime,
    valuation: 'MARK_TO_MARKET_NO_TERMINAL_LIQUIDATION',
    benchmark: 'BUY_AND_HOLD_SAME_INSTRUMENT',
    excessNetPnl: ledger.netPnl - benchmark.netPnl,
    cashBenchmarkNetPnl: 0,
    excessNetPnlVsCash: ledger.netPnl,
    cashAssumption: 'No interest, inflation or custody charges modeled'
  };
  return { mode: 'HYPOTHETICAL_RESEARCH_ONLY', executionAuthority: 'NONE', patternId, signals, ledger, benchmark, comparison, limitations: ['Not a broker or an order', 'Not a prospective or validated strategy', 'Explicit costBps is an assumed one-way fee; price must reflect any spread and slippage not separately counted', 'No dividends, splits, market calendar, stale data checks, tax lots, cash flows, real data verification or reliable clock', 'Strategy and buy-and-hold terminal values are marked, not liquidated; no terminal sale costs are charged; cash benchmark assumes zero interest'] };
}
