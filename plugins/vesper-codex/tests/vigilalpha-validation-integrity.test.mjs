import test from "node:test";
import assert from "node:assert/strict";
import { validatePattern, DEFAULT_COST_ASSUMPTIONS } from "../src/vigilalpha/validation.mjs";
import { PATTERN_SPECS } from "../src/vigilalpha/research.mjs";

const pattern = PATTERN_SPECS[0];
const costs = { ...DEFAULT_COST_ASSUMPTIONS, spreadAndSlippageBps: 100, fxApplied: false };
function bars(count = 180) {
  return Array.from({ length: count }, (_, i) => ({ time: new Date(Date.UTC(2025, 0, i + 1)).toISOString(),
    open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1000 }));
}

test("continuous out-of-sample has one entry and a cost-comparable buy-and-hold benchmark", () => {
  const data = bars();
  const result = validatePattern(pattern, data, { interval: "1D", costs, asOf: "2026-01-01" });
  const expected = data.at(-1).close / (1.01 * data[100].open) - 1;
  assert.ok(Math.abs(result.outOfSample.netReturn - expected) < 1e-12);
  assert.ok(Math.abs(result.baseline.netReturn - expected) < 1e-12);
  assert.equal(result.outOfSample.tradeCount, 1);
  assert.ok(Math.abs(result.comparison.netExcessReturn) < 1e-12);
  assert.equal(result.baseline.terminalLiquidation, false);
  assert.ok(result.folds.reduce((sum, fold) => sum + fold.result.tradeCount, 0) > 1);
});

test("incomplete/future dates cannot change historical validation results", () => {
  const data = bars();
  const normal = validatePattern(pattern, data, { interval: "1D", asOf: "2025-06-30" });
  const extended = [...data, { ...data.at(-1), time: "2025-06-30", close: 10000, high: 10000 },
    { ...data.at(-1), time: "2027-01-01", close: 20000, high: 20000 }];
  const result = validatePattern(pattern, extended, { interval: "1D", asOf: "2025-06-30" });
  assert.deepEqual(result.outOfSample, normal.outOfSample);
  assert.equal(result.excludedIncompleteBars, 2);
});

test("headline drawdown retains a peak from the preceding fold", () => {
  const data = bars().map((bar, i) => {
    const close = i <= 125 ? 100 + i : 225 - (i - 125);
    return { ...bar, open: close, high: close, low: close, close };
  });
  const result = validatePattern(pattern, data, { interval: "1D",
    costs: { ...DEFAULT_COST_ASSUMPTIONS, spreadAndSlippageBps: 0, fxApplied: false } });
  // Peak 225 is reached before the fold boundary; the subsequent exit is at 201.
  assert.ok(Math.abs(result.outOfSample.maxDrawdown - (201 / 225 - 1)) < 1e-12);
  assert.ok(result.outOfSample.maxDrawdown < Math.min(...result.folds.map((fold) => fold.result.maxDrawdown)));
});

test("invalid chronology, OHLC and costs abstain rather than produce performance", () => {
  const data = bars();
  for (const invalid of [[...data, data.at(-1)], [{ ...data[0], close: NaN }, ...data.slice(1)],
    [{ ...data[0], high: 1 }, ...data.slice(1)]]) {
    assert.equal(validatePattern(pattern, invalid, { interval: "1D" }).reason, "INVALID_OR_UNORDERED_BARS");
  }
  for (const invalid of [{ ...costs, taxesBps: -1 }, { ...costs, fxFeeBps: NaN }, { ...costs, commissionBps: 10000 }]) {
    assert.equal(validatePattern(pattern, data, { interval: "1D", costs: invalid }).reason, "INVALID_COST_ASSUMPTIONS");
  }
});


test("missing open blocks evaluation instead of silently filling at close", () => {
  for (const missing of [null, undefined]) {
    const data = bars();
    data[100].open = missing;
    const result = validatePattern(pattern, data, { interval: "1D", costs, asOf: "2026-01-01" });
    assert.equal(result.reason, "OPEN_PRICE_UNAVAILABLE");
    assert.equal(result.outOfSample, undefined);
    assert.equal(result.baseline, undefined);
  }
});

test("breakout requires actual highs instead of substituting closes", () => {
  const data = bars();
  delete data[80].high;
  const result = validatePattern(PATTERN_SPECS.find(p => p.id === "volume-breakout-20"), data,
    { interval: "1D", costs, asOf: "2026-01-01" });
  assert.equal(result.reason, "HIGH_PRICE_UNAVAILABLE");
});

test("entry cost is paid on executed notional, with no hidden cash deficit", () => {
  const data = bars().map(bar => ({ ...bar, open: 100, high: 100, low: 100, close: 100 }));
  const result = validatePattern(pattern, data, { interval: "1D", costs, asOf: "2026-01-01" });
  // Cash 1 buys 1/101 units at price 100; fee = units * 100 * 1%.
  assert.ok(Math.abs(result.baseline.netReturn - (100 / 101 - 1)) < 1e-12);
  assert.equal(result.outOfSample.tradeCount, 0);
  assert.equal(result.outOfSample.netReturn, 0);
  assert.equal(result.execution.timing, "next_bar_open");
});
