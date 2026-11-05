import { createHash } from 'node:crypto';
import { validateMarketData } from './market-data-gate.mjs';
import { replayShadowLedger } from './shadow-ledger.mjs';

// A fixed, long-only research candidate, not a broker execution strategy.
export const INVEST_CANDIDATE = Object.freeze({
  id: 'invest-monthly-trend-10m-v1', lookbackMonths: 10,
  signal: 'Completed month-end close > mean of last 10 month-end closes: long; otherwise cash.',
  execution: 'Next regular-session open, after signal availability; no intramonth rebalance.',
  universe: 'One preselected, broker-verified, unleveraged broad equity ETF; identity fixed before evaluation.',
  allocation: '100% of an isolated virtual research sleeve or cash; no leverage or shorting.',
  benchmark: 'Same ETF, start, FX, costs and final mark; cash earns zero interest.',
  minEvaluationMonths: 36,
  reviewDrawdown: 0.20,
  thresholdMeaning: 'Research screening defaults, not statistical proof or a personal loss limit.',
  reference: 'https://mebfaber.com/wp-content/uploads/2016/05/SSRN-id962461.pdf',
  adaptation: 'Next-open execution instead of the paper\'s same-close assumption; not a replication claim.'
});

const digest = value => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const zonedTime = value => typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));

/** No I/O, credentials, orders, scheduling or implicit live data. */
export function runInvestCandidateResearch(dataset, options = {}) {
  const { initialCash, costBps, evaluationStart } = options;
  const admission = validateMarketData(dataset);
  const report = {
    version: 'vigilalpha.invest-candidate-report.v1', candidate: INVEST_CANDIDATE,
    datasetSha256: digest(dataset), configurationSha256: digest({ candidate: INVEST_CANDIDATE, initialCash, costBps, evaluationStart }),
    assumptions: { initialCash, costBps, evaluationStart, stressCostMultiplier: 2 }, admission,
    executionAuthority: 'NONE', autoPromotion: false, financialValidity: 'NOT_ESTABLISHED',
    limitations: [
      'Historical replay only. Source, rights, instrument eligibility and calendar assertions are not independently verified.',
      'No dividends, splits or other corporate actions: retain BLOCKED if any are present or not reviewed.',
      'No external cash flows, interest, tax lots, fill liquidity or order rounding. Costs are explicit assumptions.',
      'Final holdings are marked, not liquidated. Drawdown uses daily closing equity, not intraday lows.',
      'Screening thresholds are design choices. A historical screen never authorizes trading or proves alpha.'
    ]
  };
  const blockers = [...admission.blockers];
  const fail = (code, message) => blockers.push({ code, message });
  if (!Number.isFinite(initialCash) || initialCash <= 0 || !Number.isFinite(costBps) || costBps < 0 || costBps * 2 >= 10000) {
    fail('COSTS_REQUIRED', 'Explicit positive cash and per-side costs in [0,5000) bps are required; stress costs are doubled.');
  }
  if (!zonedTime(evaluationStart)) fail('EVALUATION_START_REQUIRED', 'Fix an evaluation start before inspecting results.');
  const eligibility = dataset?.eligibility;
  if (!eligibility || eligibility.accountType !== 'INVEST' || eligibility.instrumentType !== 'ETF'
    || eligibility.leveraged !== false || eligibility.broadEquity !== true
    || eligibility.trading212Available !== true || !nonempty(eligibility.source) || !zonedTime(eligibility.checkedAt)) {
    fail('ELIGIBILITY_REQUIRED', 'Require sourced Invest availability and an unleveraged broad equity ETF declaration.');
  } else if (Date.parse(eligibility.checkedAt) > Date.parse(dataset.asOf)) {
    fail('FUTURE_ELIGIBILITY', 'Eligibility check cannot be after report asOf.');
  }
  const calendar = dataset?.calendar;
  let monthKey;
  try {
    if (!nonempty(calendar?.source) || !nonempty(calendar?.timeZone) || calendar?.sessionsReviewed !== true
      || !Array.isArray(calendar?.monthEndCloses) || !calendar.monthEndCloses.length) throw new Error();
    const formatter = new Intl.DateTimeFormat('en', { timeZone: calendar.timeZone, year: 'numeric', month: '2-digit' });
    monthKey = time => {
      const parts = formatter.formatToParts(new Date(time));
      return Number(parts.find(p => p.type === 'year').value) * 12 + Number(parts.find(p => p.type === 'month').value) - 1;
    };
  } catch { fail('CALENDAR_REQUIRED', 'Require a sourced exchange timezone, reviewed sessions and complete month-end close timestamps.'); }
  if (blockers.length) return blocked(report, blockers);

  const bars = dataset.bars;
  const monthEnds = calendar.monthEndCloses;
  if (!monthEnds.every(zonedTime) || new Set(monthEnds.map(Date.parse)).size !== monthEnds.length
    || monthEnds.some((v, i) => i > 0 && Date.parse(v) <= Date.parse(monthEnds[i - 1]))) {
    return blocked(report, [{ code: 'INVALID_MONTH_ENDS', message: 'Month ends must be unique, ordered, timezone-qualified timestamps.' }]);
  }
  const closeIndices = new Map(bars.map((b, i) => [Date.parse(b.closeTime), i]));
  const indices = monthEnds.map(time => closeIndices.get(Date.parse(time)));
  if (indices.some(i => i === undefined)
    || indices.some(i => bars[i + 1] && monthKey(bars[i].closeTime) === monthKey(bars[i + 1].closeTime))
    || indices.some((i, n) => n > 0 && monthKey(bars[i].closeTime) !== monthKey(bars[indices[n - 1]].closeTime) + 1)
    || monthKey(bars[indices[0]].closeTime) !== monthKey(bars[0].closeTime)
    || monthKey(bars.at(-1).closeTime) - monthKey(bars[indices.at(-1)].closeTime) > 1
    || (monthKey(bars.at(-1).closeTime) > monthKey(bars[indices.at(-1)].closeTime)
      && monthKey(bars.at(-1).closeTime) < monthKey(dataset.asOf))) {
    return blocked(report, [{ code: 'INCOMPLETE_CALENDAR', message: 'Missing, non-month-end or nonconsecutive monthly observations; do not infer calendar completeness from a sparse price file.' }]);
  }
  const startIndex = bars.findIndex(b => Date.parse(b.openTime) === Date.parse(evaluationStart));
  const priorMonth = indices.indexOf(startIndex - 1);
  if (startIndex < 1 || priorMonth < INVEST_CANDIDATE.lookbackMonths - 1) {
    return blocked(report, [{ code: 'WARMUP_OR_START', message: 'Evaluation must start at the next session after a verified month end, following at least 10 complete monthly closes.' }]);
  }
  const decisions = indices.slice(9).map((index, offset) => {
    const sma = indices.slice(offset, offset + 10).reduce((sum, i) => sum + bars[i].close, 0) / 10;
    return { index, signalTime: bars[index].availableAt, close: bars[index].close, sma10: sma,
      desired: bars[index].close > sma ? 1 : 0, executionTime: bars[index + 1]?.openTime ?? null };
  }).filter(d => d.index >= startIndex - 1);
  const base = replay(bars, startIndex, decisions, admission.instrumentId, dataset.baseCurrency, initialCash, costBps);
  const stress = replay(bars, startIndex, decisions, admission.instrumentId, dataset.baseCurrency, initialCash, costBps * 2);
  const completedEvaluationMonths = indices.filter(i => i >= startIndex).length;
  const failures = [];
  if (base.strategy.netReturn <= 0) failures.push('NET_RETURN_NOT_POSITIVE');
  if (base.excessNetReturn <= 0) failures.push('NO_NET_ADVANTAGE_OVER_HOLD');
  if (base.strategy.maxDrawdown > INVEST_CANDIDATE.reviewDrawdown) failures.push('DRAWDOWN_ABOVE_RESEARCH_LIMIT');
  if (stress.strategy.netReturn <= 0 || stress.excessNetReturn <= 0) failures.push('FAILS_DOUBLE_COST_STRESS');
  const sufficient = completedEvaluationMonths >= INVEST_CANDIDATE.minEvaluationMonths;
  return { ...report, status: 'COMPUTED', signals: decisions, base, stress,
    screening: {
      status: sufficient ? (failures.length ? 'REJECT_FOR_CURRENT_OBJECTIVE' : 'HISTORICAL_SCREEN_PASS') : 'WAIT_FOR_EVIDENCE',
      completedEvaluationMonths, reasons: sufficient ? failures : ['LESS_THAN_36_EVALUATION_MONTHS', ...failures],
      meaning: 'Pass means eligible for independent review only. Reject is specific to this fixed rule, dataset and profit-plus-benchmark objective.',
      nextGate: 'Verify untouched test data, preselection and costs; then record prospective demo observations. Never auto-promote.'
    }
  };
}

function blocked(report, blockers) {
  return { ...report, status: 'BLOCKED', blockers, screening: { status: 'WAIT_FOR_EVIDENCE', reasons: blockers.map(b => b.code) } };
}

function replay(bars, startIndex, decisions, instrumentId, baseCurrency, initialCash, costBps) {
  const rate = costBps / 10000;
  const signals = new Map(decisions.map(d => [d.index + 1, d]));
  const strategy = path(false), benchmark = path(true);
  return { costBps, startTime: bars[startIndex].openTime, endTime: bars.at(-1).closeTime,
    strategy, benchmark, excessNetReturn: strategy.netReturn - benchmark.netReturn };

  function path(passive) {
    let cash = initialCash, held = 0, peak = initialCash, maxDrawdown = 0;
    const fills = [], equity = [];
    for (let i = startIndex; i < bars.length; i++) {
      const bar = bars[i];
      const signal = passive ? (i === startIndex ? { desired: 1, signalTime: bars[i - 1].availableAt } : null) : signals.get(i);
      if (signal && Boolean(signal.desired) !== (held > 0)) {
        const priceBase = bar.open * bar.openFx;
        const quantity = signal.desired ? cash / (priceBase * (1 + rate)) * (1 - 1e-12) : held;
        const feesBase = quantity * priceBase * rate;
        fills.push({ id: `${passive ? 'hold' : 'trend'}-${i}`, instrumentId, side: signal.desired ? 'BUY' : 'SELL',
          quantity, price: bar.open, basePerQuote: bar.openFx, feesBase, signalTime: signal.signalTime, fillTime: bar.openTime });
        cash += signal.desired ? -(quantity * priceBase + feesBase) : quantity * priceBase - feesBase;
        held = signal.desired ? quantity : 0;
      }
      const value = cash + held * bar.close * bar.closeFx;
      if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid or overflowed equity');
      peak = Math.max(peak, value);
      maxDrawdown = Math.max(maxDrawdown, 1 - value / peak);
      equity.push({ time: bar.closeTime, value });
    }
    const last = bars.at(-1);
    const ledger = replayShadowLedger({ baseCurrency, initialCash, fills,
      marks: held ? [{ instrumentId, price: last.close, basePerQuote: last.closeFx, time: last.closeTime }] : [] });
    return { ledger, equity, netReturn: ledger.netPnl / initialCash, maxDrawdown, tradeCount: fills.length };
  }
}
