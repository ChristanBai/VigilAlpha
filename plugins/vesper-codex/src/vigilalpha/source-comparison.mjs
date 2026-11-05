// Local comparison of caller-supplied observations, not vendor verification.
export function compareSourceBars(observations, { priceTolerance } = {}) {
  const issues = [];
  const fail = (code) => { if (!issues.includes(code)) issues.push(code); };
  const text = v => typeof v === 'string' && v.trim().length > 0;
  if (!Number.isFinite(priceTolerance) || priceTolerance < 0) fail('TOLERANCE_REQUIRED');
  if (!Array.isArray(observations) || observations.length < 2 || observations.length > 10) {
    fail('TWO_TO_TEN_SOURCES_REQUIRED');
    observations = [];
  }
  const fields = ['instrumentId', 'venue', 'quoteCurrency', 'priceBasis', 'sessionDate'];
  const first = observations[0];
  for (const observation of observations) {
    if (!observation || typeof observation !== 'object') { fail('INVALID_OBSERVATION'); continue; }
    if (!text(observation.provider) || !text(observation.source)) fail('PROVENANCE_REQUIRED');
    if (!fields.every(key => text(observation[key]))) fail('COMPARISON_IDENTITY_REQUIRED');
    if (fields.some(key => observation[key] !== first?.[key])) fail('INCOMPARABLE_BASIS');
    if (observation.sessionClosed !== true) fail('FINALITY_UNVERIFIED');
    if (!['open', 'high', 'low', 'close'].every(key => Number.isFinite(observation[key]) && observation[key] > 0)
        || observation.high < Math.max(observation.open, observation.close)
        || observation.low > Math.min(observation.open, observation.close)) fail('INVALID_OHLC');
  }
  if (new Set(observations.map(o => text(o?.provider) ? o.provider.trim().toLowerCase() : null)).size < 2) fail('DISTINCT_PROVIDERS_REQUIRED');
  const differences = [];
  if (!issues.length) {
    // Full range catches pairwise differences that comparing only to a middle quote misses.
    for (const field of ['open', 'high', 'low', 'close']) {
      const values = observations.map(o => o[field]);
      const delta = Math.max(...values) - Math.min(...values);
      differences.push({ field, delta });
      if (delta > priceTolerance + Number.EPSILON * Math.max(...values) * 4) fail('PRICE_CONFLICT');
    }
  }
  return { version: 'vigilalpha.source-comparison.v1', status: issues.length ? 'BLOCKED' : 'MATCHED_WITHIN_TOLERANCE',
    issues, differences, priceTolerance: Number.isFinite(priceTolerance) ? priceTolerance : null,
    executionAuthority: 'NONE', autoRepair: false,
    limitations: ['Provider identity, finality and price basis are caller assertions.',
      'Agreement does not prove independent sources, research rights, corporate-action completeness or correct prices.',
      'Tolerance is explicit in quote-currency units, not an automatic permission to replace original bars. Volume is not reconciled.'] };
}
