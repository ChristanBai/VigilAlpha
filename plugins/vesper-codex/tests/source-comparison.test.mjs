import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSourceBars } from '../src/vigilalpha/source-comparison.mjs';
import { assessMarketData } from '../src/vigilalpha/market-data-gate.mjs';

const row = { provider: 'fixture-a', source: 'fixture:a', instrumentId: 'SYNTHETIC', venue: 'XLON',
  quoteCurrency: 'GBP', priceBasis: 'RAW', sessionDate: '2026-11-04', sessionClosed: true,
  open: 100, high: 102, low: 99, close: 101 };
const pair = () => [{ ...row }, { ...row, provider: 'fixture-b', source: 'fixture:b' }];

test('consistent comparable sources match without authorizing trades or repairs', () => {
  const source = pair(); const before = structuredClone(source);
  const r = compareSourceBars(source, { priceTolerance: 0 });
  assert.equal(r.status, 'MATCHED_WITHIN_TOLERANCE');
  assert.equal(r.autoRepair, false); assert.equal(r.executionAuthority, 'NONE');
  assert.deepEqual(source, before);
});
test('identity, currency, adjustment and session mismatches block comparison', () => {
  for (const key of ['instrumentId', 'venue', 'quoteCurrency', 'priceBasis', 'sessionDate']) {
    const source = pair(); source[1][key] = 'different';
    assert.ok(compareSourceBars(source, { priceTolerance: 1 }).issues.includes('INCOMPARABLE_BASIS'));
  }
});
test('missing finality and incomplete prices cannot appear as a verified closing bar', () => {
  for (const change of [{ sessionClosed: false }, { sessionClosed: undefined }, { close: null }, { high: 98 }]) {
    const source = pair(); Object.assign(source[1], change);
    assert.equal(compareSourceBars(source, { priceTolerance: 0 }).status, 'BLOCKED');
  }
});
test('explicit tolerances compare the entire range and preserve real discrepancies', () => {
  const source = pair(); source.push({ ...row, provider: 'fixture-c' });
  source[1].close = 100.94; source[2].close = 101.06;
  assert.ok(compareSourceBars(source, { priceTolerance: 0.1 }).issues.includes('PRICE_CONFLICT'));
  assert.equal(compareSourceBars(source, { priceTolerance: 0.12 }).status, 'MATCHED_WITHIN_TOLERANCE');
  assert.equal(compareSourceBars(source).status, 'BLOCKED');
});
test('same provider and malformed evidence are not independent corroboration', () => {
  assert.equal(compareSourceBars([row, row], { priceTolerance: 0 }).status, 'BLOCKED');
  for (const source of [undefined, [], [null, row]]) assert.equal(compareSourceBars(source, { priceTolerance: 0 }).status, 'BLOCKED');
});
test('market admission recomputes conflicts even when the supplied status says passed', () => {
  const observations = pair(); observations[1].close = 100;
  const result = assessMarketData({ sourceComparison: { status: 'PASSED', observations, priceTolerance: 0.01 } });
  assert.ok(result.blockers.some(b => b.code === 'SOURCE_COMPARISON_UNRESOLVED'));
  assert.equal(result.executionAuthority, 'NONE');
});
