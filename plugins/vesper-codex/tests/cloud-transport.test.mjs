import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { cloudPushUrl, pushCloudSnapshot } from '../src/core/cloud-transport.mjs';

test('requires HTTPS and allows HTTP only for explicitly enabled exact loopback', () => {
  assert.equal(cloudPushUrl('https://example.com').href, 'https://example.com/api/push');
  for (const url of ['http://example.com', 'http://127.0.0.1.evil.example', 'file:///tmp/a', 'https://user:pass@example.com']) {
    assert.throws(() => cloudPushUrl(url, { allowInsecureLoopback: true }));
  }
  assert.throws(() => cloudPushUrl('http://127.0.0.1:1234'));
  assert.equal(cloudPushUrl('http://127.0.0.1:1234', { allowInsecureLoopback: true }).href, 'http://127.0.0.1:1234/api/push');
});

test('redirects do not send the token or snapshot to another endpoint', async (t) => {
  let targetCalls = 0;
  const target = http.createServer((_req, res) => { targetCalls++; res.end('unexpected'); });
  await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
  t.after(() => target.close());
  const redirect = http.createServer((_req, res) => { res.writeHead(307, { Location: `http://127.0.0.1:${target.address().port}/capture` }); res.end(); });
  await new Promise((resolve) => redirect.listen(0, '127.0.0.1', resolve));
  t.after(() => redirect.close());
  const url = cloudPushUrl(`http://127.0.0.1:${redirect.address().port}`, { allowInsecureLoopback: true });
  await assert.rejects(pushCloudSnapshot(url, 'secret-token', { privateSnapshot: true }));
  assert.equal(targetCalls, 0);
});
