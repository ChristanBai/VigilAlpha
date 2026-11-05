import test from 'node:test';
import assert from 'node:assert/strict';
import { assessMarketData, prepareSignalLedgerInput } from '../src/vigilalpha/market-data-gate.mjs';
const policy = { asOf: '2025-01-03T00:00:00Z', maxAgeMs: 86400000 };
function fixture() {
  return { instrument: { scheme: 'PERMANENT_VENDOR_ID', namespace: 'synthetic', id: 'fixture-1' }, baseCurrency: 'GBP', quoteCurrency: 'USD', provenance: { provider: 'SYNTHETIC', source: 'test-fixture', retrievedAt: policy.asOf }, rights: { researchAllowed: true, evidence: 'test-generated' }, adjustment: { priceBasis: 'RAW', corporateActionsReviewed: true, hasCorporateActions: false }, fxProvenance: { provider: 'SYNTHETIC', source: 'test-fixture', basePerQuote: true }, bars: [1, 2].map(day => ({ openTime: `2025-01-0${day}T14:00:00Z`, closeTime: `2025-01-0${day}T21:00:00Z`, availableAt: `2025-01-0${day}T21:01:00Z`, openFxAvailableAt: `2025-01-0${day}T13:59:00Z`, closeFxAvailableAt: `2025-01-0${day}T20:59:00Z`, open: 100, high: 102, low: 99, close: 101, volume: 100, openFx: .8, closeFx: .8 })) };
}
const codes = (bundle, options = policy) => assessMarketData(bundle, options).blockers.map(b => b.code);
test('admits fully declared synthetic metadata only for offline research and adapts without mutating', () => {
  const bundle = fixture();
  const result = prepareSignalLedgerInput(bundle, { patternId: 'sma-trend-cross', initialCash: 100, costBps: 10 }, policy);
  assert.equal(result.admission.status, 'ADMITTED_FOR_OFFLINE_RESEARCH');
  assert.equal(result.admission.executionAuthority, 'NONE');
  assert.equal(result.input.instrumentId, 'PERMANENT_VENDOR_ID:synthetic:fixture-1');
  result.input.bars[0].open = 5;
  assert.equal(bundle.bars[0].open, 100);
});
test('blocks missing metadata, permissions, stable identity and adjustment ambiguity', () => {
  for (const [key, code] of [['instrument','STABLE_ID_REQUIRED'], ['provenance','PROVENANCE_REQUIRED'], ['rights','USE_RIGHTS_REQUIRED'], ['adjustment','CORPORATE_ACTIONS_UNSUPPORTED'], ['fxProvenance','FX_PROVENANCE_REQUIRED']]) {
    const bundle = fixture(); delete bundle[key]; assert.ok(codes(bundle).includes(code));
    assert.equal(prepareSignalLedgerInput(bundle, {}, policy).input, null);
  }
  assert.ok(codes({ ...fixture(), instrument: { scheme: 'TICKER', id: 'ABC' } }).includes('STABLE_ID_REQUIRED'));
});
test('blocks lookahead, delayed signals, future FX, duplicates and stale bars', () => {
  const cases = [
    [b => b.bars[0].availableAt = b.bars[0].openTime, 'EARLY_AVAILABILITY'],
    [b => b.bars[0].availableAt = b.bars[1].openTime, 'LATE_SIGNAL_DATA'],
    [b => b.bars[1].availableAt = '2025-01-04T00:00:00Z', 'FUTURE_DATA'],
    [b => b.bars[0].openFxAvailableAt = b.bars[0].closeTime, 'FUTURE_FX'],
    [b => b.bars[1] = { ...b.bars[0] }, 'UNORDERED_BARS'],
  ];
  for (const [mutate, code] of cases) { const b = fixture(); mutate(b); assert.ok(codes(b).includes(code), code); }
  assert.ok(codes(fixture(), { ...policy, maxAgeMs: 1 }).includes('STALE_DATA'));
});
test('rejects invalid OHLCV, nonfinite values and incorrect same-currency FX', () => {
  for (const [key, value] of [['low', 101], ['high', 99], ['open', 0], ['close', Infinity], ['volume', -1]]) {
    const b = fixture(); b.bars[0][key] = value; assert.ok(codes(b).includes('INVALID_OHLCV'));
  }
  const b = fixture(); b.baseCurrency = 'USD'; assert.ok(codes(b).includes('INVALID_FX'));
});
test('malformed inputs return structured blockers instead of claiming admission', () => {
  for (const b of [null, [], {}, { bars: [null, {}] }]) assert.equal(assessMarketData(b).status, 'BLOCKED');
  assert.ok(codes(fixture(), {}).includes('AS_OF_REQUIRED'));
  assert.ok(codes(fixture(), {}).includes('FRESHNESS_POLICY_REQUIRED'));
});

test('CLI gate exposes canonical identity and rejects mismatched supplied identity', async () => {
  const { validateMarketData } = await import('../src/vigilalpha/market-data-gate.mjs');
  const dataset = { ...fixture(), ...policy };
  const good = validateMarketData(dataset);
  assert.equal(good.ok, true);
  assert.equal(good.instrumentId, 'PERMANENT_VENDOR_ID:synthetic:fixture-1');
  assert.equal(validateMarketData({ ...dataset, instrumentId: 'wrong' }).ok, false);
  assert.equal(validateMarketData(null).ok, false);
});

test('rejects impossible calendar dates and retrieval before data availability', () => {
  const b = fixture();
  b.provenance.retrievedAt = '2025-01-01T00:00:00Z';
  assert.ok(codes(b).includes('RETRIEVAL_BEFORE_AVAILABILITY'));
  assert.ok(codes(fixture(), { ...policy, asOf: '2025-02-30T00:00:00Z' }).includes('AS_OF_REQUIRED'));
});

test('limits bars before potentially expensive research processing', () => {
  const b = fixture(); b.bars = Array(3001).fill(b.bars[0]);
  assert.deepEqual(codes(b).filter(c => c === 'BAR_LIMIT_EXCEEDED'), ['BAR_LIMIT_EXCEEDED']);
  assert.ok(!codes(b).includes('UNORDERED_BARS'));
});
