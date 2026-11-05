import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBars, movingAverageBacktest } from "../src/analysis/technical.mjs";

test("calculates trend indicators with deterministic bars", () => {
  const bars = Array.from({ length: 80 }, (_, index) => ({
    time: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100 + index,
    volume: 1000
  }));
  const analysis = analyzeBars(bars);

  assert.equal(analysis.indicators.trend, "BULLISH");
  assert.equal(analysis.indicators.latest, 179);
  assert.ok(analysis.confidence >= 0.6);
});

test("runs a moving average backtest without hidden execution assumptions", () => {
  const values = [
    ...Array.from({ length: 70 }, (_, index) => 100 - index * 0.2),
    ...Array.from({ length: 80 }, (_, index) => 86 + index)
  ];
  const bars = values.map((close, index) => ({
    time: new Date(Date.UTC(2025, 0, index + 1)).toISOString(),
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1000
  }));
  const result = movingAverageBacktest(bars, { fast: 5, slow: 15, initialCapital: 10_000 });

  assert.equal(result.strategy, "SMA 5/15 crossover");
  assert.ok(Number.isFinite(result.totalReturn));
  assert.ok(result.equityCurve.length > 0);
  assert.match(result.disclaimer, /hypothetical/i);
  assert.match(result.disclaimer, /same-close/i);
  assert.equal(result.diagnosticOnly, true);
  let high = result.initialCapital;
  let worst = 0;
  for (const point of result.equityCurve) { high = Math.max(high, point.value); worst = Math.min(worst, (point.value - high) / high); }
  assert.equal(result.maxDrawdown, worst);
});
