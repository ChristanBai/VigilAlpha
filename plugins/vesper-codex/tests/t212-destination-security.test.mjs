import test from 'node:test';
import assert from 'node:assert/strict';
import { T212Client } from '../src/core/t212-client.mjs';

test('untrusted pagination destinations cannot receive credentials', async () => {
  let calls = 0;
  const client = new T212Client({ apiKey: 'fixture', apiSecret: 'fixture', minimumIntervalMs: 0, fetchImpl: async () => { calls++; return { ok: true, status: 200, json: async () => ({}) }; } });
  for (const cursor of ['https://untrusted.invalid/api/v0/equity/history/orders', 'http://live.trading212.com/api/v0/equity/history/orders', 'https://demo.trading212.com/api/v0/equity/history/orders', 'https://live.trading212.com/other', 'https://user:secret@live.trading212.com/api/v0/equity/history/orders', 'https://live.trading212.com/api/v0/../../other']) await assert.rejects(client.orders({ cursor }), /not an allowed/);
  assert.equal(calls, 0);
  await client.orders({ cursor: '/api/v0/equity/history/orders?cursor=next' });
  assert.equal(calls, 1);
});

test('allowed requests force redirect error and stay read-only', async () => {
  const client = new T212Client({ apiKey: 'fixture', apiSecret: 'fixture', environment: 'demo', minimumIntervalMs: 0, fetchImpl: async (url, options) => {
    assert.equal(url.origin, 'https://demo.trading212.com');
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'GET');
    return { ok: true, status: 200, json: async () => ({ safe: true }) };
  } });
  assert.deepEqual(await client.request(client.resolve('/equity/positions'), { redirect: 'follow' }), { safe: true });
  await assert.rejects(client.request(client.resolve('/equity/positions'), { method: 'POST' }), /read-only/);
});
