import test from 'node:test';
import assert from 'node:assert/strict';
import { runInvestCandidateResearch } from '../src/vigilalpha/invest-candidate.mjs';
import { createToolRuntime } from '../src/mcp/tools.mjs';

// Deliberately sparse synthetic bars; not an exchange calendar or profit evidence.
function fixture(count = 48, price = m => 100 + m) {
  const bars = [];
  for (let m = 0; m < count; m++) {
    for (const d of [1, 28]) {
      const date = new Date(Date.UTC(2020, m, d)).toISOString().slice(0, 10);
      const p = price(m);
      bars.push({ openTime: `${date}T14:00:00Z`, closeTime: `${date}T21:00:00Z`, availableAt: `${date}T21:01:00Z`,
        openFxAvailableAt: `${date}T13:59:00Z`, closeFxAvailableAt: `${date}T20:59:00Z`,
        open: p, close: p, low: p, high: p, volume: 100, openFx: 1, closeFx: 1 });
    }
  }
  return { instrument: { scheme: 'PERMANENT_VENDOR_ID', namespace: 'synthetic', id: 'ETF' },
    baseCurrency: 'GBP', quoteCurrency: 'GBP', asOf: bars.at(-1).availableAt, maxAgeMs: 86400000,
    provenance: { provider: 'SYNTHETIC', source: 'generated-fixture', retrievedAt: bars.at(-1).availableAt },
    rights: { researchAllowed: true, evidence: 'generated-in-test' },
    adjustment: { priceBasis: 'RAW', corporateActionsReviewed: true, hasCorporateActions: false },
    eligibility: { accountType: 'INVEST', instrumentType: 'ETF', leveraged: false, broadEquity: true,
      trading212Available: true, source: 'SYNTHETIC_NOT_BROKER_VERIFIED', checkedAt: bars.at(-1).availableAt },
    calendar: { source: 'SYNTHETIC_NOT_REAL_CALENDAR', timeZone: 'UTC', sessionsReviewed: true,
      monthEndCloses: bars.filter((_, i) => i % 2).map(b => b.closeTime) },
    initialCash: 1000, costBps: 20, evaluationStart: bars[20].openTime, bars };
}
const run = data => runInvestCandidateResearch(data, data);

test('next-open entry and passive benchmark match hand-calculated fees and FX', () => {
  const data = fixture();
  const report = run(data);
  assert.equal(report.status, 'COMPUTED');
  assert.equal(report.base.strategy.tradeCount, 1);
  const fill = report.base.strategy.ledger.journal[0];
  assert.equal(fill.signalTime, data.bars[19].availableAt);
  assert.equal(fill.fillTime, data.bars[20].openTime);
  assert.ok(Date.parse(fill.signalTime) < Date.parse(fill.fillTime));
  const expected = 1000 / (110 * 1.002) * 147;
  assert.ok(Math.abs(report.base.strategy.ledger.netAssetValue - expected) < 1e-8);
  assert.equal(report.base.strategy.ledger.netAssetValue, report.base.benchmark.ledger.netAssetValue);
  assert.ok(report.stress.strategy.ledger.netAssetValue < expected);
  assert.equal(report.screening.status, 'REJECT_FOR_CURRENT_OBJECTIVE');
  assert.ok(report.screening.reasons.includes('NO_NET_ADVANTAGE_OVER_HOLD'));
});

test('equal close and SMA stays in cash; no artificial terminal sale', () => {
  const report = run(fixture(48, () => 100));
  assert.equal(report.base.strategy.tradeCount, 0);
  assert.equal(report.base.strategy.ledger.netPnl, 0);
  assert.equal(report.base.benchmark.tradeCount, 1);
  assert.ok(report.base.benchmark.ledger.netPnl < 0);
  assert.ok(report.screening.reasons.includes('NET_RETURN_NOT_POSITIVE'));
});

test('insufficient evidence cannot pass even if returns look good', () => {
  const report = run(fixture(15));
  assert.equal(report.status, 'COMPUTED');
  assert.equal(report.screening.status, 'WAIT_FOR_EVIDENCE');
  assert.equal(report.screening.completedEvaluationMonths, 5);
  assert.equal(report.executionAuthority, 'NONE');
  assert.equal(report.autoPromotion, false);
  assert.equal(report.financialValidity, 'NOT_ESTABLISHED');
});

test('missing rights, actions and CFD/leveraged eligibility block computation', () => {
  for (const mutate of [d => delete d.rights, d => d.adjustment.hasCorporateActions = true,
    d => d.eligibility.accountType = 'CFD', d => d.eligibility.leveraged = true,
    d => delete d.eligibility.source, d => delete d.calendar]) {
    const data = fixture(); mutate(data);
    const report = run(data);
    assert.equal(report.status, 'BLOCKED');
    assert.equal(report.screening.status, 'WAIT_FOR_EVIDENCE');
    assert.equal(report.base, undefined);
  }
});

test('rejects missing, duplicate and false month-end observations', () => {
  for (const mutate of [d => d.calendar.monthEndCloses.splice(15, 1),
    d => d.calendar.monthEndCloses[1] = d.calendar.monthEndCloses[0],
    d => d.calendar.monthEndCloses[1] = d.bars[2].closeTime,
    d => d.calendar.timeZone = 'not-a-zone']) {
    const data = fixture(); mutate(data);
    assert.equal(run(data).status, 'BLOCKED');
  }
});

test('explicit test window needs ten completed months and starts at next open', () => {
  for (const index of [0, 18, 21]) {
    const data = fixture(); data.evaluationStart = data.bars[index].openTime;
    assert.equal(run(data).status, 'BLOCKED');
  }
});

test('late data and future FX are rejected rather than traded', () => {
  for (const mutate of [d => d.bars[19].availableAt = d.bars[20].openTime,
    d => d.bars[20].openFxAvailableAt = d.bars[20].closeTime]) {
    const data = fixture(); mutate(data);
    assert.equal(run(data).status, 'BLOCKED');
  }
});

test('changing future prices never rewrites past signals', () => {
  const data = fixture();
  const old = run(data).signals;
  for (const b of data.bars.slice(60)) for (const k of ['open', 'high', 'low', 'close']) b[k] *= 0.5;
  const current = run(data).signals;
  assert.deepEqual(current.filter(s => s.index < 60), old.filter(s => s.index < 60));
});

test('losses and cash after exits retained, drawdown includes entry costs', () => {
  const report = run(fixture(48, m => m < 15 ? 100 + m : 60));
  assert.equal(report.base.strategy.tradeCount, 2);
  assert.ok(report.base.strategy.ledger.netPnl < 0);
  assert.equal(report.base.strategy.ledger.holdings.length, 0);
  assert.ok(report.base.strategy.maxDrawdown > 0.45);
  assert.ok(report.screening.reasons.includes('DRAWDOWN_ABOVE_RESEARCH_LIMIT'));
});

test('configuration digest changes with costs; repeats are deterministic', () => {
  const data = fixture(); const one = run(data);
  assert.deepEqual(run(data), one);
  const two = runInvestCandidateResearch(data, { ...data, costBps: 25 });
  assert.equal(one.datasetSha256, two.datasetSha256);
  assert.notEqual(one.configurationSha256, two.configurationSha256);
  assert.equal(runInvestCandidateResearch(null).status, 'BLOCKED');
});

test('cross-currency mark uses supplied FX; mismatched same-currency FX blocks', () => {
  const data = fixture(); data.bars.at(-1).closeFx = 0.9;
  assert.equal(run(data).status, 'BLOCKED');
  data.quoteCurrency = 'USD';
  data.fxProvenance = { provider: 'SYNTHETIC', source: 'fixture', basePerQuote: true };
  const report = run(data);
  assert.equal(report.status, 'COMPUTED');
  const expected = 1000 / (110 * 1.002) * 147 * 0.9;
  assert.ok(Math.abs(report.base.strategy.ledger.netAssetValue - expected) < 1e-8);
});

test('offline MCP entry needs no broker configuration and cannot authorize orders', async () => {
  const data = fixture();
  const runtime = createToolRuntime({ env: {} });
  const report = await runtime.call('validate_invest_candidate', { dataset: data, initialCash: data.initialCash,
    costBps: data.costBps, evaluationStart: data.evaluationStart });
  assert.equal(report.status, 'COMPUTED');
  assert.equal(report.autoPromotion, false);
  const definition = runtime.definitions.find(d => d.name === 'validate_invest_candidate');
  assert.equal(definition.annotations.readOnlyHint, true);
});
