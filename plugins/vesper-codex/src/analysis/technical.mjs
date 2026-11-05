export function calculateIndicators(bars) {
  const closes = bars.map((bar) => Number(bar.close)).filter(Number.isFinite);
  if (closes.length < 2) throw new Error("At least two closing prices are required.");
  const returns = [];
  for (let index = 1; index < closes.length; index += 1) {
    returns.push((closes[index] - closes[index - 1]) / closes[index - 1]);
  }
  const sma20 = simpleMovingAverage(closes, 20);
  const sma50 = simpleMovingAverage(closes, 50);
  const rsi14 = relativeStrengthIndex(closes, 14);
  const volatility = standardDeviation(returns.slice(-60)) * Math.sqrt(252);
  const latest = closes.at(-1);
  const drawdown = maxDrawdown(closes);
  const trend = sma20 && sma50
    ? latest > sma20 && sma20 > sma50
      ? "BULLISH"
      : latest < sma20 && sma20 < sma50
        ? "BEARISH"
        : "NEUTRAL"
    : "INSUFFICIENT_DATA";

  return {
    latest,
    sma20,
    sma50,
    rsi14,
    annualizedVolatility: volatility,
    maxDrawdown: drawdown,
    trend,
    observations: closes.length
  };
}

export function analyzeBars(bars) {
  const indicators = calculateIndicators(bars);
  const signals = [];
  if (indicators.rsi14 !== null) {
    if (indicators.rsi14 >= 70) signals.push({ level: "warning", text: "RSI indicates an overbought condition." });
    if (indicators.rsi14 <= 30) signals.push({ level: "attention", text: "RSI indicates an oversold condition." });
  }
  if (indicators.trend === "BULLISH") signals.push({ level: "positive", text: "Price and moving averages are in a bullish alignment." });
  if (indicators.trend === "BEARISH") signals.push({ level: "warning", text: "Price and moving averages are in a bearish alignment." });
  if (indicators.annualizedVolatility > 0.5) signals.push({ level: "warning", text: "Annualized volatility is above 50%." });
  if (indicators.maxDrawdown < -0.2) signals.push({ level: "warning", text: "Historical maximum drawdown is deeper than 20%." });

  const confidence = confidenceFromSignals(indicators);
  return {
    indicators,
    signals,
    confidence,
    disclaimer: "For research only. This is not investment advice and does not guarantee returns."
  };
}

export function movingAverageBacktest(bars, { fast = 20, slow = 50, initialCapital = 10_000 } = {}) {
  if (!Number.isInteger(fast) || !Number.isInteger(slow) || fast < 2 || slow <= fast) {
    throw new Error("fast must be at least 2 and slow must be greater than fast.");
  }
  if (bars.length <= slow) throw new Error(`At least ${slow + 1} bars are required.`);

  let cash = Number(initialCapital);
  let units = 0;
  let entryPrice = null;
  const trades = [];
  const equityCurve = [];

  for (let index = slow; index < bars.length; index += 1) {
    const close = Number(bars[index].close);
    const window = bars.slice(0, index + 1);
    const fastAverage = simpleMovingAverage(window.map((bar) => Number(bar.close)), fast);
    const slowAverage = simpleMovingAverage(window.map((bar) => Number(bar.close)), slow);
    const previousWindow = bars.slice(0, index);
    const previousFast = simpleMovingAverage(previousWindow.map((bar) => Number(bar.close)), fast);
    const previousSlow = simpleMovingAverage(previousWindow.map((bar) => Number(bar.close)), slow);

    if (!units && previousFast <= previousSlow && fastAverage > slowAverage) {
      units = cash / close;
      cash = 0;
      entryPrice = close;
      trades.push({ side: "BUY", at: bars[index].time, price: close });
    } else if (units && previousFast >= previousSlow && fastAverage < slowAverage) {
      cash = units * close;
      trades.push({
        side: "SELL",
        at: bars[index].time,
        price: close,
        pnlPercent: (close - entryPrice) / entryPrice
      });
      units = 0;
      entryPrice = null;
    }
    equityCurve.push({
      time: bars[index].time,
      value: cash + units * close
    });
  }

  const finalValue = cash + units * Number(bars.at(-1).close);
  const totalReturn = (finalValue - initialCapital) / initialCapital;
  const chronologicalDrawdown = maxDrawdown([initialCapital, ...equityCurve.map((point) => point.value)]);
  const completed = trades.filter((trade) => trade.side === "SELL");
  const wins = completed.filter((trade) => trade.pnlPercent > 0).length;

  return {
    strategy: `SMA ${fast}/${slow} crossover`,
    initialCapital,
    finalValue,
    totalReturn,
    maxDrawdown: chronologicalDrawdown,
    tradeCount: completed.length,
    winRate: completed.length ? wins / completed.length : null,
    trades,
    equityCurve,
    diagnosticOnly: true,
    executionAssumption: "Signals and fills use the same close; not a realistic or independently validated execution model.",
    disclaimer: "DIAGNOSTIC ONLY hypothetical backtest: same-close signal and fill can be unrealistic; excludes all fees, FX, taxes, spreads and execution uncertainty. Not evidence of profitability or a trading decision."
  };
}

export function simpleMovingAverage(values, period) {
  if (!Array.isArray(values) || values.length < period || period < 1) return null;
  const window = values.slice(-period);
  return window.reduce((sum, value) => sum + value, 0) / period;
}

export function relativeStrengthIndex(values, period = 14) {
  if (!Array.isArray(values) || values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let index = values.length - period; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }
  // With no movement either way, use a neutral reading instead of positive momentum.
  if (gains === 0 && losses === 0) return 50;
  if (losses === 0) return 100;
  const relativeStrength = (gains / period) / (losses / period);
  return 100 - 100 / (1 + relativeStrength);
}

export function maxDrawdown(values) {
  let peak = values[0];
  let worst = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    worst = Math.min(worst, (value - peak) / peak);
  }
  return worst;
}

export function standardDeviation(values) {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function confidenceFromSignals(indicators) {
  let score = 0.5;
  if (indicators.trend !== "INSUFFICIENT_DATA" && indicators.trend !== "NEUTRAL") score += 0.1;
  if (indicators.observations >= 120) score += 0.15;
  if (indicators.annualizedVolatility > 0.45) score -= 0.1;
  if (indicators.maxDrawdown < -0.25) score -= 0.1;
  return Math.max(0, Math.min(1, score));
}
