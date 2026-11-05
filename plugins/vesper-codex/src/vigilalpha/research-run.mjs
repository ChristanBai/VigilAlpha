import { createHash } from 'node:crypto';
import { validateMarketData } from './market-data-gate.mjs';
import { replaySignalLedger } from './signal-ledger.mjs';

export const RESEARCH_PATTERNS = Object.freeze(['sma-trend-cross', 'rsi-momentum', 'volume-breakout-20']);

// Retain every candidate, including abstentions and losses. No winner promotion.
export function runResearchValidation(dataset, { initialCash, costBps } = {}) {
  const admission = validateMarketData(dataset);
  const report = {
    version: 'vigilalpha.research-run.v1',
    datasetSha256: createHash('sha256').update(JSON.stringify(dataset ?? null)).digest('hex'),
    admission, assumptions: { initialCash, costBps },
    financialValidity: 'NOT_ESTABLISHED', executionAuthority: 'NONE', autoPromotion: false,
    results: [],
    limitations: [
      'Historical hypothetical research, not prospective validation or actual trading.',
      'Caller-supplied source and permission declarations are not independently verified.',
      'Each rule has its own warmup and matching benchmark; do not rank raw returns across different windows.',
      'Fees are assumed per-side basis points, not verified broker charges. Terminal positions remain marked, not sold.',
      'Corporate actions are unsupported. Cash earns zero interest. No market calendar or fill liquidity model.'
    ]
  };
  if (!Number.isFinite(initialCash) || initialCash <= 0 || !Number.isFinite(costBps) || costBps < 0 || costBps >= 10000) {
    return { ...report, status: 'BLOCKED', reason: 'Explicit positive initialCash and nonnegative costBps below 10000 are required.' };
  }
  if (!admission.ok) return { ...report, status: 'BLOCKED' };
  for (const patternId of RESEARCH_PATTERNS) {
    try {
      const result = replaySignalLedger({ patternId, instrumentId: admission.instrumentId,
        baseCurrency: dataset.baseCurrency, quoteCurrency: dataset.quoteCurrency, initialCash, costBps, bars: dataset.bars });
      report.results.push({ patternId, status: 'COMPUTED', ...result });
    } catch (error) {
      report.results.push({ patternId, status: 'ABSTAIN', reason: error.message });
    }
  }
  return { ...report, status: report.results.every(r => r.status === 'COMPUTED') ? 'COMPUTED' : 'INCOMPLETE' };
}
