import test from "node:test";
import assert from "node:assert/strict";
import { buildDecisionSheet, calculateHypotheticalProfit } from "../src/vigilalpha/decision-sheet.mjs";

test("missing evidence produces WAIT and exposes the concrete gaps", () => {
  const sheet = buildDecisionSheet({ symbol: "AAA", marketEvidence: { status: "UNAVAILABLE" }, decision: { action: "WAIT" } });
  assert.equal(sheet.action, "WAIT");
  assert.equal(sheet.executionAuthority, "NONE");
  assert.ok(sheet.missingOrUnverified.some((item) => item.includes("execution history")));
  assert.ok(sheet.missingOrUnverified.some((item) => item.includes("market data")));
  assert.equal(sheet.costs.actualBrokerCharges, null);
});

test("hypothetical target and stop include explicit FX and fees without authorizing orders", () => {
  const input = { quantity: 1, entryPrice: 100, targetPrice: 110, stopPrice: 90, entryBasePerQuote: 0.8, exitBasePerQuote: 1 / 1.375, entryFeesBase: 0.12, exitFeesBase: 0.12 };
  const sheet = buildDecisionSheet({ symbol: "AAA", hypotheticalScenario: input });
  assert.ok(Math.abs(sheet.hypotheticalProfit.profitAtTarget + 0.24) < 1e-9);
  assert.ok(sheet.hypotheticalProfit.profitAtStop < sheet.hypotheticalProfit.profitAtTarget);
  assert.equal(sheet.hypotheticalProfit.executionAuthority, "NONE");
  assert.equal(sheet.action, "WAIT");
  const breakEven = sheet.hypotheticalProfit.breakEvenPrice;
  assert.ok(Math.abs(calculateHypotheticalProfit({ ...input, targetPrice: breakEven }).profitAtTarget) < 1e-9);
});

test("scenario rejects missing, invalid and nonsensical values instead of inventing prices or fees", () => {
  assert.throws(() => calculateHypotheticalProfit({ quantity: 1 }), /requires/);
  const input = { quantity: 1, entryPrice: 100, targetPrice: 110, stopPrice: 90, entryBasePerQuote: 0.8, exitBasePerQuote: 0.8, entryFeesBase: 0, exitFeesBase: 0 };
  assert.throws(() => calculateHypotheticalProfit({ ...input, exitBasePerQuote: 0 }), /requires/);
  assert.throws(() => calculateHypotheticalProfit({ ...input, exitFeesBase: 1000 }), /totals/);
  assert.equal(buildDecisionSheet({ symbol: "AAA" }).hypotheticalProfit, null);
});

test("a risk-reduction scenario is visible but cannot become an executable recommendation", () => {
  const riskOnlyCalculation = { estimatedEconomics: { estimatedCosts: 1, actualCharge: false } };
  const sheet = buildDecisionSheet({ symbol: "AAA", historyCompleteness: { complete: true }, marketEvidence: { status: "AVAILABLE", cutoff: "2026-01-01" }, strategyConsensus: { eligibleStrategies: 1 }, decision: { action: "REDUCE", quantity: 2, reference: { currency: "GBP" }, riskOnlyCalculation } });
  assert.equal(sheet.action, "WAIT");
  assert.equal(sheet.status, "RESEARCH_ONLY_INCOMPLETE");
  assert.equal(sheet.researchScenario.action, "REDUCE");
  assert.equal(sheet.costs.estimate.actualCharge, false);
  assert.equal(sheet.executionAuthority, "NONE");
  assert.ok(sheet.missingOrUnverified.some((item) => item.includes("strategy eligibility does not imply approval")));
});

test("proportional exit fees and break-even depend on exit notional", () => {
  const input = { quantity: 1, entryPrice: 1000, targetPrice: 1100, stopPrice: 900, entryBasePerQuote: 1, exitBasePerQuote: 1, entryFeesBase: 0, exitFeesBase: 0, entryFeeBps: 15, exitFeeBps: 15 };
  const result = calculateHypotheticalProfit(input);
  assert.deepEqual(result.fees, { entry: 1.5, target: 1.65, stop: 1.35 });
  assert.ok(Math.abs(result.profitAtTarget - 96.85) < 1e-9);
  assert.ok(Math.abs(result.profitAtStop + 102.85) < 1e-9);
  assert.ok(Math.abs(result.breakEvenPrice - 1003.00450676014) < 1e-9);
  assert.ok(Math.abs(calculateHypotheticalProfit({ ...input, targetPrice: result.breakEvenPrice }).profitAtTarget) < 1e-9);
  assert.ok(Math.abs(calculateHypotheticalProfit({ ...input, entryFeesBase: 2, exitFeesBase: 3 }).profitAtTarget - 91.85) < 1e-9);
  for (const invalid of [-1, 10000, Infinity, NaN, null]) assert.throws(() => calculateHypotheticalProfit({ ...input, exitFeeBps: invalid }), /requires/);
});
