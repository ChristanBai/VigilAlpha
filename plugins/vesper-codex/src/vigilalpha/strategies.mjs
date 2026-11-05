import { calculateIndicators, movingAverageBacktest, relativeStrengthIndex, simpleMovingAverage } from "../analysis/technical.mjs";
import { DEFAULT_STRATEGY_PARAMETERS } from "../core/config.mjs";

export const STRATEGY_CONTRACT_VERSION = "vigilalpha.strategy-result.v1";
export const PARAMETER_VERSION = "vigilalpha.defaults.2026-10-06";

const MATURITY_WEIGHT = Object.freeze({
  experimental: 0,
  historically_validated: 1,
  observed: 1
});

export function evaluateStrategies({ bars = [], position = null, portfolio = null, cutoff = null, parameters = DEFAULT_STRATEGY_PARAMETERS, parameterVersion = PARAMETER_VERSION } = {}) {
  const safeBars = normalizeBars(bars);
  const data = dataEnvelope(safeBars, cutoff);
  const active = mergeParameters(parameters);
  const results = [
    trendStrategy(safeBars, data, active.trend, parameterVersion),
    momentumStrategy(safeBars, data, active.momentum, parameterVersion),
    meanReversionStrategy(safeBars, data, active.meanReversion, parameterVersion),
    volatilityStrategy(safeBars, data, active.volatilityDrawdown, parameterVersion),
    concentrationStrategy(position, portfolio, data, parameterVersion),
    qualityValuationStrategy(data, parameterVersion)
  ];
  return {
    contractVersion: STRATEGY_CONTRACT_VERSION,
    parameterVersion,
    parameters: active,
    strategies: results,
    consensus: buildConsensus(results),
    disclaimer: "Research signals only. They are not orders and do not guarantee returns."
  };
}

export function buildConsensus(results) {
  const eligible = results.filter((result) => MATURITY_WEIGHT[result.maturity] > 0 && result.direction !== "INSUFFICIENT_DATA");
  if (!eligible.length) {
    return {
      direction: "NO_CONSENSUS",
      strength: 0,
      eligibleStrategies: 0,
      excludedExperimental: results.filter((result) => result.maturity === "experimental").map((result) => result.name),
      reason: "No strategy has the required validation maturity for consensus."
    };
  }
  const values = { POSITIVE: 1, NEUTRAL: 0, NEGATIVE: -1 };
  const score = eligible.reduce((total, item) => total + (values[item.direction] || 0), 0) / eligible.length;
  return {
    direction: score > 0.25 ? "POSITIVE" : score < -0.25 ? "NEGATIVE" : "MIXED",
    strength: Math.abs(score),
    eligibleStrategies: eligible.length,
    excludedExperimental: results.filter((result) => result.maturity === "experimental").map((result) => result.name),
    reason: "Consensus includes only strategies at or above the minimum validation maturity."
  };
}

function trendStrategy(bars, data, parameters, parameterVersion) {
  if (bars.length <= parameters.slowPeriod) return insufficient("trend", "1.0.0", data, `At least ${parameters.slowPeriod + 1} OHLC observations are required.`, "experimental", parameters, parameterVersion);
  const closes = bars.map((bar) => bar.close);
  const latest = closes.at(-1);
  const fastAverage = simpleMovingAverage(closes, parameters.fastPeriod);
  const slowAverage = simpleMovingAverage(closes, parameters.slowPeriod);
  const trend = latest > fastAverage && fastAverage > slowAverage
    ? "BULLISH"
    : latest < fastAverage && fastAverage < slowAverage
      ? "BEARISH"
      : "NEUTRAL";
  let backtest = null;
  try {
    backtest = movingAverageBacktest(bars, { fast: parameters.fastPeriod, slow: parameters.slowPeriod, initialCapital: 10_000 });
  } catch {
    backtest = null;
  }
  return result({
    name: "trend",
    version: "1.0.0",
    maturity: "experimental",
    direction: trend === "BULLISH" ? "POSITIVE" : trend === "BEARISH" ? "NEGATIVE" : "NEUTRAL",
    strength: fastAverage && slowAverage ? clamp(Math.abs(fastAverage - slowAverage) / latest * 5) : 0,
    drivers: [`Trend alignment: ${trend}`, `Fast SMA (${parameters.fastPeriod}): ${number(fastAverage)}`, `Slow SMA (${parameters.slowPeriod}): ${number(slowAverage)}`],
    risks: ["Moving-average trends lag price and can whipsaw in range-bound markets."],
    invalidation: ["Fewer than 51 usable observations", "Price-source failure or stale cutoff"],
    data,
    parameters,
    parameterVersion,
    backtest: summarizeBacktest(backtest)
  });
}

function momentumStrategy(bars, data, parameters, parameterVersion) {
  if (bars.length <= parameters.period) return insufficient("momentum", "1.0.0", data, `At least ${parameters.period + 1} OHLC observations are required.`, "experimental", parameters, parameterVersion);
  const rsi = relativeStrengthIndex(bars.map((bar) => bar.close), parameters.period);
  const direction = rsi > parameters.positiveThreshold ? "POSITIVE" : rsi < parameters.negativeThreshold ? "NEGATIVE" : "NEUTRAL";
  return result({
    name: "momentum",
    version: "1.0.0",
    maturity: "experimental",
    direction,
    strength: rsi === null ? 0 : clamp(Math.abs(rsi - 50) / 50),
    drivers: [`RSI (${parameters.period}): ${number(rsi)}`],
    risks: ["Momentum can reverse abruptly and RSI is not a timing guarantee."],
    invalidation: ["Fewer than 15 usable observations"],
    data,
    parameters,
    parameterVersion
  });
}

function meanReversionStrategy(bars, data, parameters, parameterVersion) {
  if (bars.length < parameters.period) return insufficient("mean_reversion", "1.0.0", data, `At least ${parameters.period} OHLC observations are required.`, "experimental", parameters, parameterVersion);
  const closes = bars.map((bar) => bar.close);
  const mean = simpleMovingAverage(closes, parameters.period);
  const latest = closes.at(-1);
  const distance = mean ? (latest - mean) / mean : 0;
  return result({
    name: "mean_reversion",
    version: "1.0.0",
    maturity: "experimental",
    direction: distance < -parameters.deviationPercent / 100 ? "POSITIVE" : distance > parameters.deviationPercent / 100 ? "NEGATIVE" : "NEUTRAL",
    strength: clamp(Math.abs(distance) * 4),
    drivers: [`Distance from SMA${parameters.period}: ${number(distance * 100)}%`],
    risks: ["A large deviation can represent a regime change rather than mean reversion."],
    invalidation: [`Fewer than ${parameters.period} usable observations`],
    data,
    parameters,
    parameterVersion
  });
}

function volatilityStrategy(bars, data, parameters, parameterVersion) {
  if (bars.length < 20) return insufficient("volatility_drawdown", "1.0.0", data, "At least 20 OHLC observations are required.", "experimental", parameters, parameterVersion);
  const indicators = calculateIndicators(bars);
  const highRisk = indicators.maxDrawdown <= -0.2 || indicators.annualizedVolatility >= parameters.annualizedVolatilityPercent / 100;
  return result({
    name: "volatility_drawdown",
    version: "1.0.0",
    maturity: "experimental",
    direction: highRisk ? "NEGATIVE" : "NEUTRAL",
    strength: clamp(Math.max(Math.abs(indicators.maxDrawdown), indicators.annualizedVolatility / 2)),
    drivers: [`Max drawdown: ${number(indicators.maxDrawdown * 100)}%`, `Annualized volatility: ${number(indicators.annualizedVolatility * 100)}%`],
    risks: ["Historical volatility and drawdown do not bound future losses."],
    invalidation: ["Short or discontinuous price history"],
    data,
    parameters,
    parameterVersion
  });
}

function concentrationStrategy(position, portfolio, data, parameterVersion) {
  const weight = finite(position?.weightPercent);
  const parameters = { maxPositionWeightPercent: finite(portfolio?.maxPositionWeightPercent) ?? 20 };
  if (weight === null) return insufficient("concentration_position", "1.0.0", data, "Current portfolio weight is unavailable.", "observed", parameters, parameterVersion);
  const configuredLimit = parameters.maxPositionWeightPercent;
  const breached = weight > configuredLimit;
  return result({
    name: "concentration_position",
    version: "1.0.0",
    maturity: "observed",
    direction: breached ? "NEGATIVE" : "NEUTRAL",
    strength: breached ? clamp((weight - configuredLimit) / Math.max(configuredLimit, 1)) : 0,
    drivers: [`Portfolio weight: ${number(weight)}%`, `Review threshold: ${number(configuredLimit)}%`],
    risks: ["Concentration increases the effect of a single holding on portfolio loss."],
    invalidation: ["Account total or position market value is unavailable"],
    data: { ...data, source: "Trading 212 normalized current snapshot" },
    parameters,
    parameterVersion
  });
}

function qualityValuationStrategy(data, parameterVersion) {
  return insufficient(
    "quality_valuation",
    "1.0.0",
    { ...data, source: "No approved point-in-time fundamentals source configured" },
    "Point-in-time quality and valuation evidence is unavailable.",
    "experimental",
    {},
    parameterVersion
  );
}

function result({ name, version, maturity, direction, strength, drivers, risks, invalidation, data, parameters = {}, parameterVersion = PARAMETER_VERSION, backtest = null }) {
  return {
    contractVersion: STRATEGY_CONTRACT_VERSION,
    name,
    version,
    parametersVersion: parameterVersion,
    parameters,
    maturity,
    consensusWeight: MATURITY_WEIGHT[maturity] || 0,
    direction,
    strength: clamp(strength),
    evidenceLevel: evidenceLevel(maturity, data.observations),
    drivers,
    risks,
    invalidation,
    dataGaps: direction === "INSUFFICIENT_DATA" ? drivers : [],
    data,
    backtest: backtest || {
      status: "NOT_RUN",
      costsIncluded: false,
      outOfSample: "NOT_AVAILABLE"
    }
  };
}

function insufficient(name, version, data, reason, maturity = "experimental", parameters = {}, parameterVersion = PARAMETER_VERSION) {
  return result({
    name,
    version,
    maturity,
    direction: "INSUFFICIENT_DATA",
    strength: 0,
    drivers: [reason],
    risks: ["No directional conclusion is produced from missing evidence."],
    invalidation: ["Re-evaluate after the named evidence becomes available."],
    data,
    parameters,
    parameterVersion
  });
}

function summarizeBacktest(backtest) {
  if (!backtest) return { status: "NOT_RUN", costsIncluded: false, outOfSample: "NOT_AVAILABLE" };
  return {
    status: "DIAGNOSTIC_ONLY_SAME_CLOSE_NO_COSTS",
    diagnosticOnly: true,
    limitations: backtest.disclaimer,
    range: null,
    totalReturn: backtest.totalReturn,
    maxDrawdown: backtest.maxDrawdown,
    tradeCount: backtest.tradeCount,
    costsIncluded: false,
    outOfSample: "NOT_AVAILABLE"
  };
}

function normalizeBars(bars) {
  return (Array.isArray(bars) ? bars : [])
    .map((bar) => ({ ...bar, close: Number(bar?.close) }))
    .filter((bar) => Number.isFinite(bar.close));
}

function dataEnvelope(bars, cutoff) {
  return {
    source: "configured market-data service",
    cutoff: cutoff || bars.at(-1)?.time || null,
    freshness: cutoff || bars.at(-1)?.time ? "DATED" : "UNKNOWN",
    observations: bars.length
  };
}

function evidenceLevel(maturity, observations) {
  if (!observations) return "NONE";
  if (maturity === "observed") return "ACCOUNT_FACT";
  return observations >= 120 ? "HISTORICAL_SAMPLE" : "LIMITED_SAMPLE";
}

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value) {
  return Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));
}

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "unavailable";
}

function mergeParameters(parameters = {}) {
  return {
    trend: { ...DEFAULT_STRATEGY_PARAMETERS.trend, ...(parameters.trend || {}) },
    momentum: { ...DEFAULT_STRATEGY_PARAMETERS.momentum, ...(parameters.momentum || {}) },
    meanReversion: { ...DEFAULT_STRATEGY_PARAMETERS.meanReversion, ...(parameters.meanReversion || {}) },
    volatilityDrawdown: { ...DEFAULT_STRATEGY_PARAMETERS.volatilityDrawdown, ...(parameters.volatilityDrawdown || {}) }
  };
}
