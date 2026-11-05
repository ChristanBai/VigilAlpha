import { compareSourceBars } from './source-comparison.mjs';
// Admission checks are local assertions, not independent verification of a vendor/license.
const timestamp = value => {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && hour < 24 && minute < 60 && second < 60;
};
export const MAX_RESEARCH_BARS = 3000;
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const currency = value => typeof value === 'string' && /^[A-Z]{3}$/.test(value);
const positive = value => Number.isFinite(value) && value > 0;

/** Validate an explicitly sourced single-security bundle for offline next-open research. */
export function assessMarketData(bundle = {}, { asOf, maxAgeMs } = {}) {
  const blockers = [];
  const fail = (code, path, message) => blockers.push({ code, path, message });
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) bundle = {};
  if (!timestamp(asOf)) fail('AS_OF_REQUIRED', 'asOf', 'Explicit timezone-qualified evaluation time is required.');
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) fail('FRESHNESS_POLICY_REQUIRED', 'maxAgeMs', 'Explicit maximum final-bar age is required.');
  const { instrument, provenance, rights, adjustment, bars, baseCurrency, quoteCurrency } = bundle;
  // When supplied, recompute the comparison; never trust a caller's "passed" flag.
  if (bundle.sourceComparison !== undefined) {
    const comparison = compareSourceBars(bundle.sourceComparison?.observations, { priceTolerance: bundle.sourceComparison?.priceTolerance });
    if (comparison.status === 'BLOCKED') fail('SOURCE_COMPARISON_UNRESOLVED', 'sourceComparison', comparison.issues.join(', '));
  }
  if (!instrument || !['ISIN', 'FIGI', 'PERMANENT_VENDOR_ID'].includes(instrument.scheme) || !nonempty(instrument.id)) {
    fail('STABLE_ID_REQUIRED', 'instrument', 'Ticker alone is not a stable security identity.');
  } else {
    if (instrument.scheme === 'ISIN' && !/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(instrument.id)) fail('INVALID_ID', 'instrument.id', 'ISIN format is invalid.');
    if (instrument.scheme === 'FIGI' && !/^[A-Z0-9]{12}$/.test(instrument.id)) fail('INVALID_ID', 'instrument.id', 'FIGI format is invalid.');
    if (instrument.scheme === 'PERMANENT_VENDOR_ID' && !nonempty(instrument.namespace)) fail('ID_NAMESPACE_REQUIRED', 'instrument.namespace', 'Vendor identity requires a namespace.');
  }
  if (!currency(baseCurrency) || !currency(quoteCurrency)) fail('CURRENCY_REQUIRED', 'currency', 'Explicit ISO-style base and quote currency codes are required.');
  if (!provenance || !nonempty(provenance.provider) || !nonempty(provenance.source) || !timestamp(provenance.retrievedAt)) fail('PROVENANCE_REQUIRED', 'provenance', 'Provider, source and retrieval time are required.');
  else if (timestamp(asOf) && Date.parse(provenance.retrievedAt) > Date.parse(asOf)) fail('FUTURE_RETRIEVAL', 'provenance.retrievedAt', 'Retrieval is after evaluation time.');
  if (!rights || rights.researchAllowed !== true || !nonempty(rights.evidence)) fail('USE_RIGHTS_REQUIRED', 'rights', 'Research use must have an explicit permission assertion and evidence reference.');
  if (!adjustment || adjustment.priceBasis !== 'RAW' || adjustment.corporateActionsReviewed !== true || adjustment.hasCorporateActions !== false) fail('CORPORATE_ACTIONS_UNSUPPORTED', 'adjustment', 'Current ledger requires raw prices and an explicit review confirming no splits/dividends/actions in the window.');
  if (baseCurrency !== quoteCurrency && (!nonempty(bundle.fxProvenance?.provider) || !nonempty(bundle.fxProvenance?.source) || bundle.fxProvenance?.basePerQuote !== true)) fail('FX_PROVENANCE_REQUIRED', 'fxProvenance', 'Cross-currency prices require sourced base-per-quote FX.');
  if (!Array.isArray(bars) || !bars.length) fail('BARS_REQUIRED', 'bars', 'At least one bar is required.');
  if (Array.isArray(bars) && bars.length > MAX_RESEARCH_BARS) fail('BAR_LIMIT_EXCEEDED', 'bars', `At most ${MAX_RESEARCH_BARS} bars are supported per offline run.`);
  let previousClose = -Infinity;
  (Array.isArray(bars) && bars.length <= MAX_RESEARCH_BARS ? bars : []).forEach((bar, i) => {
    const path = `bars[${i}]`;
    if (!bar || typeof bar !== 'object') { fail('INVALID_BAR', path, 'Bar must be an object.'); return; }
    const fields = ['openTime', 'closeTime', 'availableAt', 'openFxAvailableAt', 'closeFxAvailableAt'];
    if (!fields.every(key => timestamp(bar[key]))) fail('TIMESTAMP_REQUIRED', path, 'All market and FX timestamps must include timezone.');
    else {
      const open = Date.parse(bar.openTime), close = Date.parse(bar.closeTime), available = Date.parse(bar.availableAt);
      if (open <= previousClose || close <= open) fail('UNORDERED_BARS', path, 'Bars must be non-overlapping and chronological; duplicates are rejected.');
      if (timestamp(provenance?.retrievedAt) && available > Date.parse(provenance.retrievedAt)) fail('RETRIEVAL_BEFORE_AVAILABILITY', `${path}.availableAt`, 'Dataset retrieval cannot precede candle availability.');
      if (available < close) fail('EARLY_AVAILABILITY', `${path}.availableAt`, 'Full candle cannot be available before close.');
      if (timestamp(asOf) && Math.max(close, available) > Date.parse(asOf)) fail('FUTURE_DATA', path, 'Candle is not available at evaluation time.');
      if (Date.parse(bar.openFxAvailableAt) > open || Date.parse(bar.closeFxAvailableAt) > close) fail('FUTURE_FX', path, 'FX must be available at its valuation time.');
      if (i > 0 && timestamp(bars[i - 1]?.availableAt) && Date.parse(bars[i - 1].availableAt) >= open) fail('LATE_SIGNAL_DATA', path, 'Prior candle must be available strictly before next open.');
      previousClose = close;
    }
    if (![bar.open, bar.high, bar.low, bar.close].every(positive) || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.low > bar.high || !Number.isFinite(bar.volume) || bar.volume < 0) fail('INVALID_OHLCV', path, 'Require positive coherent OHLC and nonnegative finite volume.');
    if (![bar.openFx, bar.closeFx].every(positive) || (baseCurrency === quoteCurrency && (bar.openFx !== 1 || bar.closeFx !== 1))) fail('INVALID_FX', path, 'FX must be positive; same-currency FX must equal one.');
  });
  const finalBar = Array.isArray(bars) ? bars.at(-1) : null;
  if (timestamp(asOf) && timestamp(finalBar?.closeTime) && Number.isFinite(maxAgeMs) && Date.parse(asOf) - Date.parse(finalBar.closeTime) > maxAgeMs) fail('STALE_DATA', 'bars', 'Final candle exceeds the explicit age policy.');
  return { status: blockers.length ? 'BLOCKED' : 'ADMITTED_FOR_OFFLINE_RESEARCH', executionAuthority: 'NONE', blockers, barCount: Array.isArray(bars) ? bars.length : 0, limitations: ['Metadata and permission assertions are caller supplied, not independently verified.', 'Admission is not evidence of profitability, market-calendar completeness, or live execution readiness.', 'No corporate actions supported by the current signal ledger.'] };
}

export function prepareSignalLedgerInput(bundle, parameters, policy) {
  const admission = assessMarketData(bundle, policy);
  if (admission.status === 'BLOCKED') return { admission, input: null };
  const { patternId, initialCash, costBps } = parameters ?? {};
  return { admission, input: { patternId, initialCash, costBps, instrumentId: `${bundle.instrument.scheme}:${bundle.instrument.namespace ? `${bundle.instrument.namespace}:` : ''}${bundle.instrument.id}`, baseCurrency: bundle.baseCurrency, quoteCurrency: bundle.quoteCurrency, bars: bundle.bars.map(bar => ({ ...bar })) } };
}

/** CLI-friendly gate; policy is explicit in the dataset and identity is canonical. */
export function validateMarketData(dataset) {
  const report = assessMarketData(dataset, { asOf: dataset?.asOf, maxAgeMs: dataset?.maxAgeMs });
  const instrument = dataset?.instrument;
  const instrumentId = instrument && nonempty(instrument.id)
    ? `${instrument.scheme}:${instrument.namespace ? `${instrument.namespace}:` : ''}${instrument.id}` : null;
  if (dataset?.instrumentId !== undefined && dataset.instrumentId !== instrumentId) {
    report.blockers.push({ code: 'IDENTITY_MISMATCH', path: 'instrumentId', message: 'instrumentId must match the canonical scheme:namespace:id identity.' });
    report.status = 'BLOCKED';
  }
  return { ...report, ok: report.blockers.length === 0, instrumentId };
}
