import test from 'node:test';
import assert from 'node:assert/strict';
import { DashboardManager } from '../src/dashboard/server.mjs';

test('cloud APIs require the configured bearer token and do not expose synced data', async () => {
  const runtime = { config: { cloud: {} }, snapshot: async () => ({}), status: async () => ({}) };
  const manager = new DashboardManager(runtime, { VESPER_MODE: 'cloud', VESPER_DASHBOARD_TOKEN: 'test-secret' });
  await manager.start({ port: 0 });
  const base = manager.info().localUrl;
  try {
    const payload = JSON.stringify({ snapshot: { privatePosition: 'secret position' } });
    const push = await fetch(`${base}api/push`, { method: 'POST', headers: { authorization: 'Bearer test-secret' }, body: payload });
    assert.equal(push.status, 200);
    for (const endpoint of ['status', 'snapshot', 'brief', 'history', 'quote', 'quotes', 'trades', 'events']) {
      const response = await fetch(`${base}api/${endpoint}`);
      assert.equal(response.status, 401, endpoint);
      assert.ok(!(await response.text()).includes('secret position'));
    }
    assert.equal((await fetch(`${base}api/snapshot`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
    const authorized = await fetch(`${base}api/snapshot`, { headers: { authorization: 'Bearer test-secret' } });
    assert.equal((await authorized.json()).privatePosition, 'secret position');
    assert.equal((await fetch(base)).status, 200);
  } finally { await manager.close(); }
});

test('cloud mode without a token fails closed', async () => {
  const runtime = { config: { cloud: {} }, snapshot: async () => ({}) };
  const manager = new DashboardManager(runtime, { VESPER_MODE: 'cloud' });
  await manager.start({ port: 0 });
  try { assert.equal((await fetch(`${manager.info().localUrl}api/snapshot`)).status, 401); }
  finally { await manager.close(); }
});
