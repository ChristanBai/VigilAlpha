/** Validate the destination before reading account data or sending credentials. */
export function cloudPushUrl(value, { allowInsecureLoopback = false } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid cloud dashboard URL'); }
  if (url.username || url.password) throw new Error('Cloud dashboard URL must not contain credentials');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(allowInsecureLoopback && url.protocol === 'http:' && loopback)) {
    throw new Error('Cloud dashboard requires HTTPS; HTTP is allowed only for explicitly enabled loopback testing');
  }
  return new URL('/api/push', url);
}

/** Never follow redirects: an account snapshot and bearer token are sensitive. */
export async function pushCloudSnapshot(url, token, body, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    method: 'POST', redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Cloud dashboard returned HTTP ${response.status}`);
  return response.json();
}
