import test from 'node:test';
import assert from 'node:assert/strict';
import { replaySignalLedger } from '../src/vigilalpha/signal-ledger.mjs';
import { createToolRuntime } from '../src/mcp/tools.mjs';

const bars = Array.from({ length: 110 }, (_, i) => {
  const date = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
  const v = i < 65 ? 100 + i : 165 - (i - 65) * 2;
  return { openTime: `${date}T14:00:00Z`, closeTime: `${date}T21:00:00Z`, availableAt: `${date}T21:01:00Z`, openFxAvailableAt: `${date}T13:59:00Z`, closeFxAvailableAt: `${date}T20:59:00Z`, open: v, close: v, high: v + 1, volume: 100, openFx: 0.8, closeFx: 0.8 };
});
const input = { patternId: 'sma-trend-cross', instrumentId: 'EXAMPLE', baseCurrency: 'GBP', quoteCurrency: 'USD', initialCash: 1000, costBps: 15, bars };

test('connects frozen signal, next open fill and cost-bearing ledger', () => {
  const out = replaySignalLedger(input);
  assert.equal(out.mode, 'HYPOTHETICAL_RESEARCH_ONLY');
  assert.deepEqual(out.ledger.journal.map(x => x.side), ['BUY', 'SELL']);
  assert.equal(out.ledger.journal[0].fillTime, bars[51].openTime);
  assert.ok(out.ledger.explicitFees > 0);
  assert.ok(Math.abs(out.ledger.netPnl - out.ledger.realizedPnl) < 1e-8);
  assert.equal(out.ledger.holdings.length, 0);
});

test('refuses missing next open, future FX and delayed signal', () => {
  assert.throws(() => replaySignalLedger({ ...input, bars: bars.map((b,i) => i === 51 ? { ...b, open: null } : b) }), /price/);
  assert.throws(() => replaySignalLedger({ ...input, bars: bars.map((b,i) => i === 51 ? { ...b, openFxAvailableAt: b.closeTime } : b) }), /Unavailable/);
  assert.throws(() => replaySignalLedger({ ...input, bars: bars.map((b,i) => i === 50 ? { ...b, availableAt: bars[51].closeTime } : b) }), /Signal unavailable/);
});

test('flat series stays cash and same-currency FX must be unity', () => {
  const flat = bars.map(b => ({ ...b, open: 100, close: 100, openFx: 1, closeFx: 1 }));
  const out = replaySignalLedger({ ...input, quoteCurrency: 'GBP', bars: flat });
  assert.equal(out.ledger.netAssetValue, 1000);
  assert.equal(out.ledger.journal.length, 0);
  assert.throws(() => replaySignalLedger({ ...input, quoteCurrency: 'GBP' }), /currency FX/);
});

test('offline MCP tool exposes research result without brokerage authority', async () => {
  const runtime = createToolRuntime();
  assert.ok(runtime.definitions.some(tool => tool.name === 'research_signal_ledger'));
  const result = await runtime.call('research_signal_ledger', input);
  assert.equal(result.executionAuthority, 'NONE');
  assert.deepEqual(result.ledger.journal.map(row => row.side), ['BUY', 'SELL']);
});

test('buy-and-hold starts after warm-up and uses identical entry FX, fees and terminal mark', () => {
  const out = replaySignalLedger(input);
  const entry = bars[51];
  const last = bars.at(-1);
  const gross = input.initialCash / (1 + input.costBps / 10000) * (1 - 1e-12);
  const quantity = gross / (entry.open * entry.openFx);
  const fee = gross * input.costBps / 10000;
  const expectedCash = input.initialCash - gross - fee;
  const expectedPnl = expectedCash + quantity * last.close * last.closeFx - input.initialCash;
  assert.equal(out.benchmark.journal.length, 1);
  assert.equal(out.benchmark.journal[0].fillTime, entry.openTime);
  assert.equal(out.benchmark.journal[0].basePerQuote, entry.openFx);
  assert.ok(Math.abs(out.benchmark.explicitFees - fee) < 1e-9);
  assert.ok(Math.abs(out.benchmark.netPnl - expectedPnl) < 1e-9);
  assert.equal(out.comparison.excessNetPnl, out.ledger.netPnl - out.benchmark.netPnl);
  assert.equal(out.comparison.excessNetPnlVsCash, out.ledger.netPnl);
  assert.equal(out.comparison.cashBenchmarkNetPnl, 0);
});

test('flat series still buys passive benchmark and charges only entry cost', () => {
  const flat = bars.map(b => ({ ...b, open: 100, close: 100, openFx: 1, closeFx: 1 }));
  const out = replaySignalLedger({ ...input, quoteCurrency: 'GBP', bars: flat, costBps: 100 });
  assert.equal(out.ledger.journal.length, 0);
  assert.equal(out.ledger.netPnl, 0);
  assert.equal(out.benchmark.journal.length, 1);
  assert.ok(Math.abs(out.benchmark.netPnl + 1000 / 101) < 1e-8);
  assert.ok(out.comparison.excessNetPnl > 0);
  assert.equal(out.benchmark.realizedPnl, 0);
  assert.equal(out.benchmark.holdings.length, 1);
});

test('passive benchmark captures terminal FX change without inventing a liquidation', () => {
  const changedFx = bars.map((b, i) => ({ ...b, closeFx: i === bars.length - 1 ? 0.9 : b.closeFx }));
  const before = replaySignalLedger(input);
  const after = replaySignalLedger({ ...input, bars: changedFx });
  const expectedDelta = before.benchmark.holdings[0].quantity * bars.at(-1).close * 0.1;
  assert.ok(Math.abs(after.benchmark.netPnl - before.benchmark.netPnl - expectedDelta) < 1e-8);
  assert.equal(after.benchmark.explicitFees, before.benchmark.explicitFees);
  assert.equal(after.benchmark.journal.length, 1);
});
