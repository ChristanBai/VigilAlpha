import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeForwardProtocol, checkObservationAvailability } from '../src/vigilalpha/forward-protocol.mjs';

const assumptions = { frozenAt: '2026-11-01T12:00:00Z', startsAt: '2026-11-02T00:00:00Z', instrumentId: 'example:US', baseCurrency: 'GBP', quoteCurrency: 'USD', dataSource: 'licensed-example', adjustmentPolicy: 'splits and dividends: verify before use', costs: { commissionBps: 0, spreadAndSlippageBps: 10, fxFeeBps: 15, taxesBps: 0, fxApplied: true } };

test('fixed prospective plan freezes all three rules and explicit costs with stable digest', () => {
  const one = freezeForwardProtocol(assumptions);
  assert.equal(one.spec.strategies.length, 3);
  assert.equal(one.spec.liveTradingAuthorized, false);
  assert.equal(one.sha256, freezeForwardProtocol(assumptions).sha256);
  assert.notEqual(one.sha256, freezeForwardProtocol({ ...assumptions, costs: { ...assumptions.costs, spreadAndSlippageBps: 20 } }).sha256);
  assert.match(one.spec.execution, /missing open => abstain/);
});

test('rejects backdating, undeclared costs and nonsensical FX assumptions', () => {
  assert.throws(() => freezeForwardProtocol({ ...assumptions, startsAt: assumptions.frozenAt }), /later/);
  assert.throws(() => freezeForwardProtocol({ ...assumptions, costs: { ...assumptions.costs, taxesBps: undefined } }), /costs/);
  assert.throws(() => freezeForwardProtocol({ ...assumptions, baseCurrency: 'USD' }), /Same-currency/);
  assert.throws(() => freezeForwardProtocol({ ...assumptions, frozenAt: '2026-11-01' }), /timezone/);
});

test('rejects unpublished inputs and signals before the prospective start', () => {
  const point = { observationAt: '2026-11-02T12:00:00Z', availableAt: '2026-11-02T12:01:00Z', signalAt: '2026-11-02T16:00:00Z', frozenAt: assumptions.frozenAt, startsAt: assumptions.startsAt };
  assert.equal(checkObservationAvailability(point).allowed, true);
  assert.equal(checkObservationAvailability({ ...point, availableAt: '2026-11-09T16:15:00Z' }).allowed, false);
  assert.equal(checkObservationAvailability({ ...point, observationAt: '2026-11-03T12:00:00Z' }).allowed, false);
  assert.equal(checkObservationAvailability({ ...point, signalAt: '2026-11-01T23:00:00Z' }).allowed, false);
  assert.throws(() => checkObservationAvailability({ ...point, availableAt: undefined }), /availableAt/);
});
