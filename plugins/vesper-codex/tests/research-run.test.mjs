import test from 'node:test';
import assert from 'node:assert/strict';
import { runResearchValidation } from '../src/vigilalpha/research-run.mjs';
import { createToolRuntime } from '../src/mcp/tools.mjs';

function dataset(count = 80) {
  const bars = Array.from({ length: count }, (_, i) => {
    const day = new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10);
    return { openTime: `${day}T14:00:00Z`, closeTime: `${day}T21:00:00Z`, availableAt: `${day}T21:01:00Z`,
      openFxAvailableAt: `${day}T13:59:00Z`, closeFxAvailableAt: `${day}T20:59:00Z`,
      open: 100, high: 101, low: 99, close: 100, volume: 100, openFx: 1, closeFx: 1 };
  });
  return { instrument: { scheme: 'PERMANENT_VENDOR_ID', namespace: 'synthetic', id: 'test' },
    baseCurrency: 'GBP', quoteCurrency: 'GBP', asOf: bars.at(-1).availableAt, maxAgeMs: 86400000,
    provenance: { provider: 'SYNTHETIC', source: 'unit-test', retrievedAt: bars.at(-1).availableAt },
    rights: { researchAllowed: true, evidence: 'generated-fixture' },
    adjustment: { priceBasis: 'RAW', corporateActionsReviewed: true, hasCorporateActions: false }, bars };
}
test('retains all candidates and cost-bearing baseline without promoting any strategy', () => {
  const report = runResearchValidation(dataset(), { initialCash: 1000, costBps: 20 });
  assert.equal(report.status, 'COMPUTED');
  assert.equal(report.results.length, 3);
  assert.ok(report.results.every(r => r.benchmark.netPnl < 0));
  assert.equal(report.financialValidity, 'NOT_ESTABLISHED');
  assert.equal(report.autoPromotion, false);
  assert.equal(report.datasetSha256, runResearchValidation(dataset(), { initialCash: 1000, costBps: 20 }).datasetSha256);
});
test('missing rights blocks all replay; insufficient history retains abstentions', () => {
  const data = dataset(); delete data.rights;
  const blocked = runResearchValidation(data, { initialCash: 1000, costBps: 20 });
  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(blocked.results.length, 0);
  const partial = runResearchValidation(dataset(25), { initialCash: 1000, costBps: 20 });
  assert.equal(partial.status, 'INCOMPLETE');
  assert.equal(partial.results[0].status, 'ABSTAIN');
  assert.equal(partial.results.length, 3);
});
test('MCP entry performs offline checks without account configuration', async () => {
  const runtime = createToolRuntime({ env: {} });
  const report = await runtime.call('validate_research_dataset', { dataset: dataset(), initialCash: 1000, costBps: 20 });
  assert.equal(report.status, 'COMPUTED');
  assert.equal(report.executionAuthority, 'NONE');
  assert.equal(runResearchValidation(null).status, 'BLOCKED');
});
