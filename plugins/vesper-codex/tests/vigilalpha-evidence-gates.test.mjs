import test from "node:test";
import assert from "node:assert/strict";
import { MarketService } from "../src/market/market-service.mjs";
import { buildShadowDecision } from "../src/vigilalpha/decision.mjs";
import { ShadowLearningStore, sanitizeShadowDecision } from "../src/vigilalpha/learning-store.mjs";
import { PATTERN_SPECS } from "../src/vigilalpha/research.mjs";
import { decisionReview, holdingReview, learningReview, strategyReview } from "../src/vigilalpha/reviews.mjs";
import { validatePattern } from "../src/vigilalpha/validation.mjs";

function bars(count = 180, stepDays = 1) {
  return Array.from({ length: count }, (_, index) => ({
    time: new Date(Date.UTC(2025, 0, 2 + index * stepDays)).toISOString(),
    open: 100, high: 101, low: 99, close: 100, volume: 1000
  }));
}

function decision(overrides = {}) {
  return {
    recordType: "decision", decisionId: "synthetic", recordedAt: "2025-01-01T00:00:00Z",
    symbol: "AAA", action: "REDUCE", dataGate: "PASSED", referencePrice: 100,
    referenceCurrency: "USD", sourceCutoff: "2025-01-01T00:00:00Z", ...overrides
  };
}

function memoryStore(records) {
  const store = new ShadowLearningStore({ env: {}, now: () => Date.parse("2026-01-01T00:00:00Z") });
  store.readAll = async () => records;
  store.appendEvent = async (record) => { records.push(record); return record; };
  return store;
}

test("explicit daily MAX preserves its long history range and provider currency evidence", async () => {
  let requested;
  const service = new MarketService({ env: {}, fetchImpl: async (url) => {
    requested = new URL(url);
    return new Response(JSON.stringify({ chart: { result: [{
      meta: { symbol: "AAA", currency: "USD" }, timestamp: [1735776000, 1735862400],
      indicators: { quote: [{ open: [100, 100], high: [101, 101], low: [99, 99], close: [100, 100], volume: [1000, 1000] }] }
    }] } }));
  } });
  const history = await service.history("AAA", "MAX", "1D");
  assert.equal(requested.searchParams.get("interval"), "1d");
  assert.equal(requested.searchParams.get("range"), "max");
  assert.equal(history.currencySource, "provider");
});

test("daily PatternSpecs refuse weekly and unknown intervals", () => {
  const pattern = PATTERN_SPECS[0];
  for (const interval of ["1wk", null]) {
    const result = validatePattern(pattern, bars(180, 7), { interval });
    assert.equal(result.status, "NOT_EVALUATED");
    assert.equal(result.reason, "DAILY_INTERVAL_REQUIRED");
  }
});

test("a provider's actual weekly interval cannot be relabelled as requested daily bars", async () => {
  const service = new MarketService({ env: {}, fetchImpl: async () => new Response(JSON.stringify({ chart: { result: [{
    meta: { symbol: "AAA", currency: "USD", dataGranularity: "1wk" }, timestamp: [1735776000, 1736380800],
    indicators: { quote: [{ close: [100, 100] }] }
  }] } })) });
  const history = await service.history("AAA", "MAX", "1D");
  assert.equal(history.interval, "1wk");
  const review = await strategyReview({ history: async () => history, config: {} }, "AAA");
  assert.equal(review.marketData.status, "UNAVAILABLE");
  assert.equal(review.validation.length, 0);
});

test("holding, strategy, decision and learning reviews explicitly request daily history", async () => {
  const requests = [];
  const service = {
    config: {},
    snapshot: async () => ({ summary: { totalValue: 1000 }, positions: [{ symbol: "AAA", quantity: 1, marketValue: 100 }], orders: [] }),
    history: async (symbol, range, interval) => {
      requests.push({ symbol, range, interval });
      return { bars: bars(), interval: "1D", currency: "USD", currencySource: "provider" };
    }
  };
  await holdingReview(service, "AAA", { range: "MAX" });
  await strategyReview(service, "AAA");
  const reviewed = await decisionReview(service, null, "AAA", { record: false });
  assert.equal(reviewed.decisionSheet.action, "WAIT");
  assert.equal(reviewed.decisionSheet.symbol, "AAA");
  assert.equal(reviewed.decisionSheet.executionAuthority, "NONE");
  await learningReview(service, {
    evaluatePending: async (load) => {
      const history = await load("AAA");
      assert.equal(history.interval, "1D");
      assert.equal(history.currency, "USD");
      return [];
    },
    review: async () => ({})
  });
  assert.deepEqual(requests.map((request) => request.interval), ["1D", "1D", "1D", "1D"]);
});

test("shadow evaluation refuses weekly bars and incompatible or unverified currencies", async () => {
  const invalidHistories = [
    { bars: bars(60, 7), interval: "1wk", currency: "USD", currencySource: "provider" },
    { bars: bars(), interval: "1D", currency: "GBP", currencySource: "provider" },
    { bars: bars(), interval: "1D", currency: "USD", currencySource: "inferred" },
    { bars: bars(), interval: "1D", currency: null, currencySource: null },
    bars()
  ];
  for (const history of invalidHistories) {
    const store = memoryStore([decision()]);
    assert.equal((await store.evaluatePending(async () => history)).length, 0);
  }
  const legacy = memoryStore([decision({ referenceCurrency: undefined })]);
  assert.equal((await legacy.evaluatePending(async () => ({ bars: bars(), interval: "1D", currency: "USD", currencySource: "provider" }))).length, 0);
});

test("account price currency is saved without conversion or guessing", () => {
  const plan = buildShadowDecision({
    symbol: "AAA", position: { quantity: 10, quantityAvailableForTrading: 10, marketValue: 800, instrumentCurrency: "USD", accountCurrency: "GBP" },
    totalValue: 2000, riskVeto: { reasons: [{ code: "SEVERE_CONCENTRATION", limitPercent: 20 }] },
    historyCompleteness: { complete: true }, sourceCutoff: "2025-01-01T00:00:00Z"
  });
  const saved = sanitizeShadowDecision(plan, "2025-01-01T00:00:00Z");
  assert.equal(saved.referencePrice, 80);
  assert.equal(saved.referenceCurrency, "GBP");
  assert.equal(sanitizeShadowDecision({ reference: { price: 100 } }, "2025-01-01").referenceCurrency, null);
});

test("same-currency daily observations remain evaluable and idempotent", async () => {
  const store = memoryStore([decision()]);
  const load = async () => ({ bars: bars(), interval: "1D", currency: "USD", currencySource: "provider" });
  const outcomes = await store.evaluatePending(load);
  assert.deepEqual(outcomes.map((outcome) => outcome.horizonSessions), [20, 60]);
  assert.ok(outcomes.every((outcome) => outcome.marketReturn === 0 && outcome.currency === "USD" && outcome.interval === "1D"));
  assert.equal((await store.evaluatePending(load)).length, 0);
  assert.equal((await store.review()).evaluableDecisionCount, 1);
});

test("WAIT, failed decisions and legacy unverified outcomes cannot satisfy promotion counts", async () => {
  const records = Array.from({ length: 30 }, (_, index) => [
    decision({ decisionId: String(index), action: index % 2 ? "WAIT" : "REDUCE", dataGate: "FAILED" }),
    { recordType: "outcome", decisionId: String(index), actionAlignedReturn: 0.1 }
  ]).flat();
  const review = await memoryStore(records).review();
  assert.equal(review.evaluableDecisionCount, 0);
  assert.equal(review.promotionGate.passed, false);
  const failed = memoryStore([decision({ dataGate: "FAILED" })]);
  assert.equal((await failed.evaluatePending(async () => ({ bars: bars(), interval: "1D", currency: "USD", currencySource: "provider" }))).length, 0);
  const legacy = memoryStore([decision(), { recordType: "outcome", decisionId: "synthetic", actionAlignedReturn: 0.1 }]);
  assert.equal((await legacy.review()).evaluableDecisionCount, 0);
});
