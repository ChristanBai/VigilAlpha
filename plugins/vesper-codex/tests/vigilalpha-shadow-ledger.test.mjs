import test from 'node:test';
import assert from 'node:assert/strict';
import { replayShadowLedger } from '../src/vigilalpha/shadow-ledger.mjs';

const fill = (overrides = {}) => ({ id: 'one', instrumentId: 'XYZ:US', side: 'BUY', quantity: 1, price: 100, basePerQuote: 0.8, feesBase: 0.12, signalTime: '2026-01-01T16:00:00Z', fillTime: '2026-01-02T14:30:00Z', ...overrides });
const base = { baseCurrency: 'GBP', initialCash: 100, fills: [], marks: [] };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('FX movement and fees can reverse a gain in the asset currency', () => {
  const result = replayShadowLedger({ ...base, fills: [fill(), fill({ id: 'two', side: 'SELL', price: 110, basePerQuote: 1 / 1.375, feesBase: 0.12, signalTime: '2026-01-03T16:00:00Z', fillTime: '2026-01-04T14:30:00Z' })] });
  near(result.cash, 99.76); near(result.netPnl, -0.24); near(result.realizedPnl, -0.24);
  assert.equal(result.mode, 'SIMULATION_ONLY');
});

test('marks holdings in base currency and splits realized from unrealized P&L', () => {
  const result = replayShadowLedger({ ...base, initialCash: 200, fills: [fill({ quantity: 2 }), fill({ id: 'two', side: 'SELL', quantity: 1, price: 110, feesBase: 0.1, signalTime: '2026-01-03', fillTime: '2026-01-04' })], marks: [{ instrumentId: 'XYZ:US', price: 120, basePerQuote: 0.75, time: '2026-01-05' }] });
  near(result.cash + result.holdingsValue, result.netAssetValue);
  near(result.realizedPnl + result.holdings[0].unrealizedPnl, result.netPnl);
  assert.equal(result.holdings[0].quantity, 1);
});

test('rejects duplicate fills, future information, missing marks, overspending and overselling', () => {
  assert.throws(() => replayShadowLedger({ ...base, fills: [fill(), fill()] }), /duplicate/);
  assert.throws(() => replayShadowLedger({ ...base, fills: [fill({ signalTime: '2026-01-03' })] }), /time/);
  assert.throws(() => replayShadowLedger({ ...base, fills: [fill()] }), /Missing mark/);
  assert.throws(() => replayShadowLedger({ ...base, initialCash: 1, fills: [fill()] }), /cash/);
  assert.throws(() => replayShadowLedger({ ...base, fills: [fill({ side: 'SELL' })] }), /position/);
});

test('rejects marks before latest fill and absent or invalid FX rates', () => {
  const mark = { instrumentId: 'XYZ:US', price: 100, basePerQuote: 0.8, time: '2026-01-01' };
  assert.throws(() => replayShadowLedger({ ...base, fills: [fill()], marks: [mark] }), /precedes/);
  assert.throws(() => replayShadowLedger({ ...base, fills: [fill({ basePerQuote: undefined })] }), /FX/);
});
