import { buildPortfolioBrief } from "../analysis/portfolio-brief.mjs";
import { calculateIndicators } from "../analysis/technical.mjs";
import { calculateTradeReview, tradeMarkers } from "../runtime.mjs";
import { evaluateStrategies } from "./strategies.mjs";
import { buildShadowDecision } from "./decision.mjs";
import { buildDecisionSheet } from "./decision-sheet.mjs";
import { PATTERN_SPECS, patternRegistry } from "./research.mjs";
import { validatePattern } from "./validation.mjs";
import { conditionalPatterns } from "./conditional-patterns.mjs";
import { eventReview } from "./events.mjs";

function scheduleContext() {
  const review = eventReview();
  return { status: review.status, checkedAt: review.checkedAt, requiresRefresh: review.requiresRefresh,
    isLive: false, predictsResults: false, coverageComplete: false,
    events: review.events.slice(0, 3).map(event => ({ title: event.title,
      date: event.localSchedule.startDate || event.localSchedule.date, sourceUrl: event.source.url })) };
}

export async function portfolioReview(service, store, { refresh = true, saveSnapshot = true } = {}) {
  const snapshot = await service.snapshot({ force: Boolean(refresh) });
  const brief = buildPortfolioBrief({ snapshot });
  const riskVeto = portfolioRiskVeto(brief, service.config?.riskLimits);
  const saved = saveSnapshot ? await store.append(snapshot) : null;
  const totalValue = finiteOrNull(snapshot.summary?.totalValue);
  const positions = (snapshot.positions || []).map((position) => publicPosition({
    ...position,
    weightPercent: positionWeight(position, totalValue)
  }));
  const etfCount = positions.filter((position) => /ETF|FUND/i.test(position.instrumentType || "")).length;
  const signal = riskVeto.reasons.some((reason) => ["POSITION_WEIGHT", "TOP_ONE_CONCENTRATION"].includes(reason.code))
    ? "REDUCE_RISK"
    : "WATCH";
  return {
    product: "VigilAlpha",
    reviewVersion: "vigilalpha.portfolio-review.v1",
    generatedAt: new Date().toISOString(),
    sourceCutoff: snapshot.syncedAt || null,
    accountFreshness: accountFreshness(snapshot),
    status: snapshot.status || "UNKNOWN",
    summary: publicSummary(snapshot.summary),
    concentration: brief.concentration,
    positions,
    topPositions: brief.topPositions.map(publicPosition),
    lookthrough: {
      status: etfCount ? "UNAVAILABLE_WITHOUT_DATED_COMPONENT_EVIDENCE" : "NOT_APPLICABLE",
      unknownNodeCount: etfCount
    },
    riskVeto,
    reviewQueue: brief.riskSignals,
    dataQuality: brief.dataQuality,
    snapshotSavedAt: saved?.savedAt || null,
    signal,
    signalLabel: signal === "REDUCE_RISK" ? "降低风险" : "观察",
    disclaimer: "Risk review only. This is not an order or a guarantee of profit."
  };
}

export async function holdingReview(service, symbol, { refresh = false, range = "1Y" } = {}) {
  const normalized = normalizeSymbol(symbol);
  const snapshot = await service.snapshot({ force: Boolean(refresh) });
  const position = snapshot.positions?.find((item) => String(item.symbol || "").trim().toUpperCase() === normalized);
  if (!position) throw new Error(`Holding not found in the current account: ${normalized}`);
  const totalValue = finiteOrNull(snapshot.summary?.totalValue);
  const weightPercent = positionWeight(position, totalValue);
  let history = null;
  let marketError = null;
  try {
    history = await loadDailyHistory(service, normalized, range);
  } catch (error) {
    marketError = safeMessage(error);
  }
  const tradeReview = calculateTradeReview(snapshot.orders || [], snapshot.positions || [], normalized);
  const strategy = evaluateStrategies({
    bars: history?.bars || [],
    position: { ...position, weightPercent },
    portfolio: { maxPositionWeightPercent: service.config?.riskLimits?.maxPositionWeightPercent },
    cutoff: history?.bars?.at(-1)?.time || null,
    parameters: service.config?.strategyParameters,
    parameterVersion: service.config?.parameterVersion
  });
  const riskVeto = holdingRiskVeto({
    weightPercent,
    snapshot,
    history,
    marketError,
    positionLimit: service.config?.riskLimits?.maxPositionWeightPercent,
    drawdownLimit: service.config?.riskLimits?.drawdownWarningPercent
  });
  const conditionalResearch = conditionalPatterns(history);
  return {
    product: "VigilAlpha",
    reviewVersion: "vigilalpha.holding-review.v1",
    generatedAt: new Date().toISOString(),
    sourceCutoff: snapshot.syncedAt || null,
    accountFreshness: accountFreshness(snapshot),
    holding: publicPosition({ ...position, weightPercent }),
    evidence: {
      account: "Trading 212 normalized current snapshot",
      market: history ? { source: history.source || "unknown", range, cutoff: history.bars?.at(-1)?.time || null } : { status: "UNAVAILABLE", reason: marketError },
      fundamentals: { status: "UNAVAILABLE", reason: "No approved point-in-time fundamentals source configured." }
    },
    strategies: strategy,
    conditionalResearch,
    eventContext: scheduleContext(),
    riskVeto,
    signal: selectSignal(riskVeto, strategy.consensus),
    chart: {
      status: history?.bars?.length ? "AVAILABLE" : "UNAVAILABLE",
      currency: history?.currency || null,
      bars: history?.bars || [],
      averageCost: finiteOrNull(position.averagePricePaid),
      executionMarkers: tradeMarkers(snapshot.orders || [], normalized),
      strategyMarkers: conditionalResearch.markers
    },
    tradeReview: publicTradeReview(tradeReview, snapshot.historyCompleteness?.orders),
    disclaimer: "Research signal only. It is not an order or a guarantee of profit."
  };
}

function accountFreshness(snapshot) {
  const sections = snapshot.sectionSyncedAt || {};
  return {
    mode: "ON_DEMAND_CACHE",
    isRealtime: false,
    positionsAsOf: sections.positions || null,
    summaryAsOf: sections.summary || null,
    ordersAsOf: sections.orders || null,
    piesAsOf: sections.pies || null,
    transactionsAsOf: sections.transactions || null,
    lastAttemptAt: snapshot.lastAttemptAt || null,
    failedSections: (snapshot.errors || []).map(error => error.section),
    note: "Manual refresh attempts all sections, subject to broker limits and publication delay. Section timestamps are successful retrieval times, not execution or broker publication times."
  };
}

export async function strategyReview(service, symbol, { range = "MAX" } = {}) {
  const normalized = normalizeSymbol(symbol);
  let history;
  try {
    history = await loadDailyHistory(service, normalized, range);
  } catch (error) {
    return {
      product: "VigilAlpha",
      symbol: normalized,
      range,
      marketData: { status: "UNAVAILABLE", reason: safeMessage(error) },
      research: patternRegistry(),
      validation: [],
      ...evaluateStrategies({ bars: [], parameters: service.config?.strategyParameters, parameterVersion: service.config?.parameterVersion })
    };
  }
  return {
    product: "VigilAlpha",
    symbol: normalized,
    range,
    marketData: { status: "AVAILABLE", source: history.source || "unknown", cutoff: history.bars?.at(-1)?.time || null },
    research: patternRegistry(),
    validation: PATTERN_SPECS.map((pattern) => validatePattern(pattern, history.bars || [], { interval: history.interval })),
    conditionalResearch: conditionalPatterns(history),
    ...evaluateStrategies({ bars: history.bars || [], cutoff: history.bars?.at(-1)?.time || null, parameters: service.config?.strategyParameters, parameterVersion: service.config?.parameterVersion })
  };
}

export async function decisionReview(service, shadowStore, symbol, { refresh = true, range = "MAX", record = true } = {}) {
  const normalized = normalizeSymbol(symbol);
  const snapshot = await service.snapshot({ force: Boolean(refresh), full: true });
  const position = snapshot.positions?.find((item) => String(item.symbol || "").toUpperCase() === normalized);
  if (!position) throw new Error(`Holding not found in the current account: ${normalized}`);
  const totalValue = finiteOrNull(snapshot.summary?.totalValue);
  const weightPercent = positionWeight(position, totalValue);
  let history = null;
  let marketError = null;
  try {
    history = await loadDailyHistory(service, normalized, range);
  } catch (error) {
    marketError = safeMessage(error);
  }
  const strategy = evaluateStrategies({
    bars: history?.bars || [], position: { ...position, weightPercent },
    portfolio: { maxPositionWeightPercent: service.config?.riskLimits?.maxPositionWeightPercent },
    cutoff: history?.bars?.at(-1)?.time || null,
    parameters: service.config?.strategyParameters, parameterVersion: service.config?.parameterVersion
  });
  const riskVeto = holdingRiskVeto({
    weightPercent, snapshot, history, marketError,
    positionLimit: service.config?.riskLimits?.maxPositionWeightPercent,
    drawdownLimit: service.config?.riskLimits?.drawdownWarningPercent
  });
  const decision = buildShadowDecision({
    symbol: normalized,
    position,
    totalValue,
    riskVeto,
    consensus: strategy.consensus,
    historyCompleteness: snapshot.historyCompleteness?.orders || { status: "UNKNOWN", complete: false },
    parametersVersion: service.config?.parameterVersion,
    sourceCutoff: snapshot.syncedAt || null
  });
  const recorded = record ? await shadowStore.append(decision) : null;
  const holding = publicPosition({ ...position, weightPercent });
  const marketEvidence = history ? { status: "AVAILABLE", source: history.source || "unknown", cutoff: history.bars?.at(-1)?.time || null } : { status: "UNAVAILABLE", reason: marketError };
  const historyCompleteness = snapshot.historyCompleteness?.orders || { status: "UNKNOWN", complete: false };
  return {
    product: "VigilAlpha",
    reviewVersion: "vigilalpha.decision-review.v1",
    holding,
    marketEvidence,
    riskVeto,
    strategyConsensus: strategy.consensus,
    historyCompleteness,
    decision,
    decisionSheet: buildDecisionSheet({ symbol: normalized, holding, marketEvidence, riskVeto, strategyConsensus: strategy.consensus, historyCompleteness, decision }),
    recordedAt: recorded?.recordedAt || null
  };
}

export async function learningReview(service, shadowStore) {
  const outcomesAdded = await shadowStore.evaluatePending(async (symbol) => loadDailyHistory(service, symbol, "MAX"));
  return { product: "VigilAlpha", ...(await shadowStore.review()), outcomesAdded: outcomesAdded.length, blackstonePolicy: "Sanitized summaries only; human approval never mutates runtime automatically." };
}

export async function marketReview(service, symbol, { range = "1Y", includeChart = false } = {}) {
  const normalized = normalizeSymbol(symbol);
  const history = await loadDailyHistory(service, normalized, range);
  const conditionalResearch = conditionalPatterns(history);
  return {
    product: "VigilAlpha", reviewVersion: "vigilalpha.market-review.v1", symbol: normalized,
    sourceScope: "PUBLIC_SYMBOL_ONLY", accountContext: "NOT_PROVIDED",
    browserAccess: "Symbol supplied by user or an authorized host; this tool does not read browser tabs.",
    holding: { symbol: normalized }, riskVeto: { active: null, reasons: [] }, signal: "RESEARCH_ONLY",
    evidence: { market: { source: history.source || "unknown", range, cutoff: history.bars?.at(-1)?.time || null } },
    marketData: { source: history.source || "unknown", currency: history.currency || null,
      interval: history.interval, sourceCutoff: history.bars?.at(-1)?.time || null },
    conditionalResearch, eventContext: scheduleContext(), researchSources: patternRegistry().sources,
    chart: { status: includeChart ? (history.bars?.length ? "AVAILABLE" : "UNAVAILABLE") : "NOT_REQUESTED",
      currency: history.currency || null, bars: includeChart ? (history.bars || []).slice(-120) : [],
      strategyMarkers: includeChart ? conditionalResearch.markers : [], executionMarkers: [], averageCost: null },
    executionAuthority: "NONE",
    disclaimer: "No account facts, position sizing or production signal is inferred from a browser symbol."
  };
}

async function loadDailyHistory(service, symbol, range) {
  const history = await service.history(symbol, range, "1D");
  if (!["1D", "1d", "1day"].includes(history?.interval)) {
    throw new Error("Verified daily history is required for daily strategies and session outcomes.");
  }
  return history;
}

export function portfolioRiskVeto(brief, riskLimits = {}) {
  const reasons = [];
  const positionLimit = Number(riskLimits.maxPositionWeightPercent || 20);
  for (const position of brief.topPositions || []) {
    if (Number(position.weightPercent) > positionLimit) {
      reasons.push({ code: "POSITION_WEIGHT", severity: "high", message: `${position.symbol} weight is ${Number(position.weightPercent).toFixed(2)}%, above the ${positionLimit}% configured review threshold.` });
    }
  }
  for (const signal of brief.riskSignals || []) {
    if (["TOP_ONE_CONCENTRATION", "DATA_QUALITY"].includes(signal.code)) {
      reasons.push({ code: signal.code, severity: signal.severity, message: signal.message });
    }
  }
  if (!brief.syncedAt) reasons.push({ code: "MISSING_CUTOFF", severity: "high", message: "The account snapshot has no verified data cutoff." });
  return { active: reasons.length > 0, reasons, cannotHide: true };
}

function holdingRiskVeto({ weightPercent, snapshot, history, marketError, positionLimit = 20, drawdownLimit = 15 }) {
  const reasons = [];
  if (Number.isFinite(weightPercent) && weightPercent > positionLimit) {
    reasons.push({ code: "SEVERE_CONCENTRATION", severity: "high", limitPercent: Number(positionLimit), message: `Holding weight ${weightPercent.toFixed(2)}% is above the ${positionLimit}% configured review threshold.` });
  }
  if (!history) reasons.push({ code: "MARKET_DATA_UNAVAILABLE", severity: "medium", message: marketError || "Historical market data is unavailable." });
  if (history?.bars?.length >= 2) {
    try {
      const indicators = calculateIndicators(history.bars);
      if (indicators.maxDrawdown * 100 <= -Math.abs(drawdownLimit)) {
        reasons.push({ code: "EXTREME_DRAWDOWN", severity: "high", message: `Observed maximum drawdown ${Number(indicators.maxDrawdown * 100).toFixed(2)}% is beyond the configured ${drawdownLimit}% review threshold.` });
      }
    } catch {
      reasons.push({ code: "INVALID_MARKET_DATA", severity: "high", message: "Historical bars are not finite or complete enough for a drawdown review." });
    }
  }
  if (snapshot.errors?.length) reasons.push({ code: "SOURCE_DEGRADED", severity: "medium", message: "One or more account sections are degraded." });
  return { active: reasons.length > 0, reasons, cannotHide: true };
}

function selectSignal(riskVeto, consensus) {
  if (riskVeto.reasons.some((reason) => ["SEVERE_CONCENTRATION", "EXTREME_DRAWDOWN"].includes(reason.code))) return "REDUCE_RISK";
  if (riskVeto.active) return "WATCH";
  if (consensus.direction === "POSITIVE") return "CONSIDER_ENTRY";
  if (consensus.direction === "NEGATIVE") return "REVIEW_EXIT";
  if (consensus.direction === "MIXED") return "HOLD";
  return "WATCH";
}

function publicPosition(position) {
  return {
    symbol: position.symbol || null,
    name: position.name || null,
    quantity: finiteOrNull(position.quantity),
    averagePricePaid: finiteOrNull(position.averagePricePaid),
    currentPrice: finiteOrNull(position.currentPrice),
    marketValue: finiteOrNull(position.marketValue),
    weightPercent: finiteOrNull(position.weightPercent),
    unrealizedPnL: finiteOrNull(position.unrealizedPnL),
    currency: position.accountCurrency || position.instrumentCurrency || null,
    instrumentType: position.instrumentType || null,
    quantityAvailableForTrading: finiteOrNull(position.quantityAvailableForTrading)
  };
}

function publicSummary(summary = {}) {
  return {
    currency: summary.currency || null,
    totalValue: finiteOrNull(summary.totalValue),
    availableCash: finiteOrNull(summary.availableCash),
    investedValue: finiteOrNull(summary.investedValue),
    unrealizedPnL: finiteOrNull(summary.unrealizedPnL),
    realizedPnL: finiteOrNull(summary.realizedPnL)
  };
}

function publicTradeReview(review, historyCompleteness) {
  return {
    totalInvested: review.totalInvested,
    totalRecovered: review.totalRecovered,
    totalInvestedNet: review.totalInvestedNet,
    totalRecoveredNet: review.totalRecoveredNet,
    totalExplicitCosts: review.totalExplicitCosts,
    realizedPnL: review.realizedPnL,
    realizedPnLSource: review.realizedPnLSource,
    unrealizedPnL: review.unrealizedPnL,
    tradeCount: review.tradeCount,
    firstTradeAt: review.firstTradeAt,
    latestTradeAt: review.latestTradeAt,
    historyCompleteness: historyCompleteness || { status: "UNVERIFIED", complete: false }
  };
}

function normalizeSymbol(value) {
  const symbol = String(value || "").trim().toUpperCase();
  if (!symbol || symbol.length > 32 || !/^[A-Z0-9._-]+$/.test(symbol)) throw new Error("A valid holding symbol is required.");
  return symbol;
}

function positionWeight(position, totalValue) {
  const value = finiteOrNull(position.marketValue);
  return totalValue > 0 && value !== null ? value / totalValue * 100 : null;
}

function finiteOrNull(value) {
  const parsed = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(parsed) ? parsed : null;
}

function safeMessage(error) {
  const message = String(error?.message || "Market-data request failed.");
  return message.replace(/(api[_ -]?key|secret|authorization)\s*[:=]\s*\S+/gi, "$1=[REDACTED]").slice(0, 300);
}
