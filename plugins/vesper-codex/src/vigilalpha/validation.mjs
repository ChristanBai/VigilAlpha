import { relativeStrengthIndex, simpleMovingAverage } from "../analysis/technical.mjs";

export const VALIDATION_VERSION = "vigilalpha.walk-forward.v3";
export const DEFAULT_COST_ASSUMPTIONS = Object.freeze({
  version: "vigilalpha.costs.2026-10-08",
  commissionBps: 0,
  spreadAndSlippageBps: 10,
  fxFeeBps: 15,
  taxesBps: 0,
  fxApplied: true,
  note: "Conservative hypothetical estimate includes FX by default. Known same-currency holdings override it. Actual broker wallet impact is authoritative for completed fills."
});

export function validatePattern(pattern, bars, { costs = DEFAULT_COST_ASSUMPTIONS, interval = null, asOf = new Date().toISOString() } = {}) {
  const input = Array.isArray(bars) ? bars : [];
  const instant = Date.parse(asOf);
  if (!Number.isFinite(instant)) return unavailable(pattern, input.length, "INVALID_AS_OF", costs);
  if (input.some((bar, index) => !Number.isFinite(Date.parse(bar?.time))
    || finite(bar?.close) === null || finite(bar.close) <= 0
    || (index > 0 && Date.parse(bar.time) <= Date.parse(input[index - 1].time))
    || ["open", "high", "low"].some((key) => bar?.[key] != null && (finite(bar[key]) === null || finite(bar[key]) <= 0))
    || (finite(bar?.high) !== null && finite(bar.high) < Math.max(finite(bar.open) ?? bar.close, bar.close))
    || (finite(bar?.low) !== null && finite(bar.low) > Math.min(finite(bar.open) ?? bar.close, bar.close))
    || (bar?.volume != null && (finite(bar.volume) === null || finite(bar.volume) < 0)))) {
    return unavailable(pattern, input.length, "INVALID_OR_UNORDERED_BARS", costs);
  }
  const costFields = ["commissionBps", "spreadAndSlippageBps", "fxFeeBps", "taxesBps"];
  if (costFields.some((key) => finite(costs?.[key]) === null || finite(costs[key]) < 0)
    || typeof costs?.fxApplied !== "boolean" || costRate(costs) >= 1) {
    return unavailable(pattern, input.length, "INVALID_COST_ASSUMPTIONS", costs);
  }
  const completedBefore = new Date(instant).toISOString().slice(0, 10);
  const normalized = normalizeBars(input.filter((bar) => new Date(bar.time).toISOString().slice(0, 10) < completedBefore));
  if (!["1D", "1d", "1day"].includes(interval)) {
    return unavailable(pattern, normalized.length, "DAILY_INTERVAL_REQUIRED", costs);
  }
  const lookback = Number(pattern?.lookback || 0);
  if (normalized.length < Math.max(lookback + 20, 60)) {
    return unavailable(pattern, normalized.length, "INSUFFICIENT_HISTORY", costs);
  }
  // Never substitute a later close for the prespecified next-open fill.
  if (normalized.some((bar) => bar.open === null)) {
    return unavailable(pattern, normalized.length, "OPEN_PRICE_UNAVAILABLE", costs);
  }
  if (pattern.id === "volume-breakout-20" && normalized.some((bar) => bar.high === null)) {
    return unavailable(pattern, normalized.length, "HIGH_PRICE_UNAVAILABLE", costs);
  }
  if (pattern.id === "volume-breakout-20" && normalized.some((bar) => bar.volume === null)) {
    return unavailable(pattern, normalized.length, "VOLUME_UNAVAILABLE", costs);
  }
  if (!["sma-trend-cross", "rsi-momentum", "volume-breakout-20"].includes(pattern.id)) {
    return unavailable(pattern, normalized.length, "NO_RETURN_RULE", costs);
  }

  const firstTest = Math.max(lookback + 1, Math.floor(normalized.length * 0.55));
  const boundaries = [firstTest, Math.floor(normalized.length * 0.7), Math.floor(normalized.length * 0.85), normalized.length - 1]
    .filter((value, index, values) => index === 0 || value > values[index - 1]);
  const inSample = simulate(pattern, normalized, lookback, firstTest, costs);
  const folds = boundaries.slice(0, -1).map((start, index) => ({
    fold: index + 1,
    trainStart: normalized[0]?.time || null,
    trainEnd: normalized[start]?.time || null,
    testStart: normalized[start + 1]?.time || null,
    testEnd: normalized[boundaries[index + 1]]?.time || null,
    interpretation: "Standalone fold diagnostic; resets cash, never stitched into headline risk.",
    result: simulate(pattern, normalized, start, boundaries[index + 1], costs)
  }));
  const outOfSample = simulate(pattern, normalized, firstTest, normalized.length - 1, costs);
  return {
    contractVersion: VALIDATION_VERSION,
    patternId: pattern.id,
    patternVersion: pattern.version,
    interval: "1D",
    status: outOfSample.evaluatedBars >= 20 ? "EVALUATED" : "INSUFFICIENT_OUT_OF_SAMPLE",
    maturityEffect: "NONE_WITHOUT_SHADOW_AND_HUMAN_APPROVAL",
    split: { method: "expanding-window-walk-forward", initialTrainEnd: normalized[firstTest]?.time || null, randomShuffle: false, foldCount: folds.length },
    execution: { timing: "next_bar_open", missingOpenPolicy: "BLOCK_DATASET", futureDataUsed: false },
    costs,
    inSample,
    folds,
    outOfSample,
    baseline: buyAndHold(normalized, firstTest, normalized.length - 1, costs),
    comparison: { netExcessReturn: outOfSample.netReturn - buyAndHold(normalized, firstTest, normalized.length - 1, costs).netReturn,
      convention: "Same entry-cost rate and final-close mark-to-market; neither path forces terminal liquidation." },
    dataCutoff: normalized.at(-1)?.time || null,
    excludedIncompleteBars: input.length - normalized.length,
    limitations: ["Single-instrument historical replay, not prospective evidence", "Fixed-rule walk-forward diagnostics; no fitted or optimized model", "Unverified adjustment/dividend treatment unless supplied with dataset provenance", "No tax-lot, cash-interest or market-impact model", "Passing this result does not promote the strategy"]
  };
}

function simulate(pattern, bars, start, end, costs) {
  let cash = 1;
  let units = 0;
  let desired = 0;
  let peak = 1;
  let maxDrawdown = 0;
  let tradeCount = 0;
  const returns = [];
  // Warm up stateful rules using past closes, without creating pre-test trades.
  for (let index = pattern.lookback; index < start; index += 1) desired = evaluatePatternSignal(pattern, bars, index, desired);
  for (let index = Math.max(start, pattern.lookback); index < end; index += 1) {
    desired = evaluatePatternSignal(pattern, bars, index, desired);
    const execution = bars[index + 1].open;
    if (desired === 1 && units === 0) {
      const rate = costRate(costs);
      // Fee is a proportion of executed notional, paid from the same cash.
      units = cash / (execution * (1 + rate));
      cash = 0;
      tradeCount += 1;
    } else if (desired === 0 && units > 0) {
      cash = units * execution * (1 - costRate(costs));
      units = 0;
      tradeCount += 1;
    }
    const value = cash + units * bars[index + 1].close;
    const previous = returns.length ? returns.at(-1).value : 1;
    returns.push({ time: bars[index + 1].time, value, return: previous ? value / previous - 1 : 0 });
    peak = Math.max(peak, value);
    maxDrawdown = Math.min(maxDrawdown, peak ? value / peak - 1 : 0);
  }
  const finalValue = returns.at(-1)?.value ?? 1;
  const positives = returns.filter((point) => point.return > 0).length;
  return {
    evaluatedBars: returns.length,
    netReturn: finalValue - 1,
    maxDrawdown,
    tradeCount,
    positiveSessionRate: returns.length ? positives / returns.length : null
  };
}

export function evaluatePatternSignal(pattern, bars, index, previous) {
  const closes = bars.slice(0, index + 1).map((bar) => bar.close);
  if (pattern.id === "sma-trend-cross") {
    const fast = simpleMovingAverage(closes, 20);
    const slow = simpleMovingAverage(closes, 50);
    return fast !== null && slow !== null ? (fast > slow ? 1 : 0) : previous;
  }
  if (pattern.id === "rsi-momentum") {
    const rsi = relativeStrengthIndex(closes, 14);
    if (rsi === null) return previous;
    if (rsi > 55) return 1;
    if (rsi < 45) return 0;
    return previous;
  }
  const prior = bars.slice(index - 20, index);
  const resistance = Math.max(...prior.map((bar) => bar.high ?? bar.close));
  const averageVolume = prior.reduce((sum, bar) => sum + bar.volume, 0) / prior.length;
  if (bars[index].close > resistance && bars[index].volume > averageVolume * 1.5) return 1;
  const sma20 = simpleMovingAverage(closes, 20);
  if (sma20 !== null && bars[index].close < sma20) return 0;
  return previous;
}

function buyAndHold(bars, start, end, costs) {
  const first = bars[Math.min(start + 1, bars.length - 1)]?.open;
  const last = bars[Math.min(end, bars.length - 1)]?.close;
  if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0) return { name: "buy_and_hold", return: null, netReturn: null };
  const grossReturn = last / first - 1;
  return { name: "buy_and_hold", return: grossReturn, grossReturn,
    netReturn: last / (first * (1 + costRate(costs))) - 1,
    costsIncluded: true, entryCostRate: costRate(costs), terminalLiquidation: false };
}

function unavailable(pattern, observations, reason, costs) {
  return { contractVersion: VALIDATION_VERSION, patternId: pattern?.id || null, patternVersion: pattern?.version || null, status: "NOT_EVALUATED", reason, observations, costs, maturityEffect: "NONE" };
}

function normalizeBars(bars) {
  return (Array.isArray(bars) ? bars : []).map((bar) => ({
    time: bar?.time || null,
    open: finite(bar?.open), high: finite(bar?.high), low: finite(bar?.low), close: finite(bar?.close), volume: finite(bar?.volume)
  })).filter((bar) => bar.time && bar.close !== null && bar.close > 0).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

function costRate(costs) {
  const bps = Number(costs.commissionBps || 0) + Number(costs.spreadAndSlippageBps || 0) + Number(costs.taxesBps || 0) + (costs.fxApplied ? Number(costs.fxFeeBps || 0) : 0);
  return Math.max(0, bps) / 10_000;
}

function finite(value) {
  const parsed = Number(value);
  return value !== null && value !== undefined && Number.isFinite(parsed) ? parsed : null;
}
