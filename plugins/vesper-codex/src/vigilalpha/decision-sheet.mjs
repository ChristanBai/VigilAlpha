// A read-only presentation of existing research, not an order or a trade recommendation.
export function buildDecisionSheet({ symbol, holding, marketEvidence, riskVeto, strategyConsensus, historyCompleteness, decision, hypotheticalScenario }) {
  const issues = [];
  if (historyCompleteness?.complete !== true) issues.push("Complete execution history is unverified.");
  if (marketEvidence?.status !== "AVAILABLE") issues.push("Daily market data is unavailable.");
  if (!marketEvidence?.cutoff) issues.push("Market-data cutoff is missing; freshness is not verified.");
  if (!decision?.reference?.currency) issues.push("Account-currency reference price is missing.");
  issues.push("Directional trading effectiveness is not established; strategy eligibility does not imply approval or proven profitability.");
  issues.push("Quote freshness, actual broker costs, FX, spread, tax and current order details must be verified independently.");
  issues.push("The account-level net-return ledger and prospective validation are not complete.");
  const estimate = decision?.estimatedEconomics || decision?.riskOnlyCalculation?.estimatedEconomics || null;
  return {
    version: "vigilalpha.decision-sheet.v1",
    status: "RESEARCH_ONLY_INCOMPLETE",
    action: "WAIT",
    symbol,
    reason: "The current implementation does not establish a reliable after-cost trade recommendation.",
    holding,
    evidence: { market: marketEvidence, strategy: strategyConsensus, orderHistory: historyCompleteness },
    risks: riskVeto?.reasons || [],
    researchScenario: { action: decision?.action || "WAIT", quantity: decision?.quantity ?? 0,
      conditions: decision?.triggerConditions || [], invalidation: decision?.invalidationConditions || [], rationale: decision?.rationale || [],
      riskOnlyCalculation: decision?.riskOnlyCalculation || null },
    costs: { status: "ESTIMATES_ONLY", estimate, actualBrokerCharges: null,
      limitations: "Indicative one-way costs only if available; future return, FX changes and actual order charges are unknown." },
    hypotheticalProfit: hypotheticalScenario == null ? null : calculateHypotheticalProfit(hypotheticalScenario),
    missingOrUnverified: issues,
    executionAuthority: "NONE",
    disclaimer: "No order is placed. Estimates and historical results cannot guarantee profit."
  };
}

// Explicit inputs only. Rates express account-currency units per one quote-currency unit.
// Prices are assumed execution prices: spread/slippage, if modeled, must already be in them.
export function calculateHypotheticalProfit({ quantity, entryPrice, targetPrice, stopPrice, entryBasePerQuote, exitBasePerQuote, entryFeesBase, exitFeesBase, entryFeeBps = 0, exitFeeBps = 0 }) {
  const positive = [quantity, entryPrice, targetPrice, stopPrice, entryBasePerQuote, exitBasePerQuote];
  if (!positive.every((value) => Number.isFinite(value) && value > 0) ||
      ![entryFeesBase, exitFeesBase].every((value) => Number.isFinite(value) && value >= 0) ||
      ![entryFeeBps, exitFeeBps].every((value) => Number.isFinite(value) && value >= 0 && value < 10000)) {
    throw new Error("Scenario requires positive quantities, prices and FX rates and explicit nonnegative fees.");
  }
  const entryGross = quantity * entryPrice * entryBasePerQuote;
  const entryTotalFees = entryFeesBase + entryGross * entryFeeBps / 10000;
  const targetTotalFees = exitFeesBase + quantity * targetPrice * exitBasePerQuote * exitFeeBps / 10000;
  const stopTotalFees = exitFeesBase + quantity * stopPrice * exitBasePerQuote * exitFeeBps / 10000;
  const entryCost = entryGross + entryTotalFees;
  const targetProceeds = quantity * targetPrice * exitBasePerQuote - targetTotalFees;
  const stopProceeds = quantity * stopPrice * exitBasePerQuote - stopTotalFees;
  const breakEvenPrice = (entryCost + exitFeesBase) / (quantity * exitBasePerQuote * (1 - exitFeeBps / 10000));
  if (![entryCost, targetProceeds, stopProceeds, breakEvenPrice].every(Number.isFinite) || targetProceeds < 0 || stopProceeds < 0) {
    throw new Error("Invalid scenario totals.");
  }
  return {
    status: "HYPOTHETICAL_NOT_A_FORECAST", executionAuthority: "NONE",
    entryCost, targetProceeds, stopProceeds, fees: { entry: entryTotalFees, target: targetTotalFees, stop: stopTotalFees }, profitAtTarget: targetProceeds - entryCost,
    profitAtStop: stopProceeds - entryCost, breakEvenPrice,
    assumptions: { quantity, entryPrice, targetPrice, stopPrice, entryBasePerQuote, exitBasePerQuote, entryFeesBase, exitFeesBase, entryFeeBps, exitFeeBps },
    limitations: "Assumed prices, FX and costs only. Fixed fees and proportional bps are additive; never include the same charge in both. Exit FX is shared by target and stop. Rates are assumptions, not verified broker charges. No guarantee of execution or profit; stop orders can fill at other prices. Spread and slippage must be included in assumed execution prices; exclude double counting. Dividends and taxes beyond supplied fees are excluded."
  };
}
