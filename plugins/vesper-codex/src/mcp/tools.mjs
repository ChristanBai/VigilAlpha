import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { appendAudit, readAudit } from "../core/audit.mjs";
import { auditPath, cachePath, configPath, DEFAULT_STRATEGY_PARAMETERS, deleteCredential, ensurePrivateDirectory, publicConfig, readConfig, stateDirectory, storeCredential, updateConfig } from "../core/config.mjs";
import { mapSummary } from "../core/portfolio.mjs";
import { T212Client } from "../core/t212-client.mjs";
import { DashboardManager } from "../dashboard/server.mjs";
import { buildPortfolioBrief } from "../analysis/portfolio-brief.mjs";
import { calculateTradeReview, createRuntime, tradeMarkers } from "../runtime.mjs";
import { PRODUCT_VERSION } from "../version.mjs";
import { decisionReview, holdingReview, learningReview, marketReview, portfolioReview, strategyReview } from "../vigilalpha/reviews.mjs";
import { calculateHypotheticalProfit } from "../vigilalpha/decision-sheet.mjs";
import { freezeForwardProtocol, checkObservationAvailability } from "../vigilalpha/forward-protocol.mjs";
import { replayShadowLedger } from "../vigilalpha/shadow-ledger.mjs";
import { replaySignalLedger } from "../vigilalpha/signal-ledger.mjs";
import { runResearchValidation } from "../vigilalpha/research-run.mjs";
import { runInvestCandidateResearch } from "../vigilalpha/invest-candidate.mjs";
import { reviewSecCompanyFacts } from "../vigilalpha/company-evidence.mjs";
import { experimentalKronosForecast } from "../vigilalpha/kronos-adapter.mjs";
import { eventReview } from "../vigilalpha/events.mjs";
import { researchNotebook } from "../vigilalpha/research-notebook.mjs";
import { HOLDING_CHART_UI_URI, PORTFOLIO_FLOW_UI_URI, RISK_TIMELINE_UI_URI, SETUP_UI_URI } from "../vigilalpha/inline-ui.mjs";
import { DerivedSnapshotStore } from "../vigilalpha/snapshot-store.mjs";
import { ShadowLearningStore } from "../vigilalpha/learning-store.mjs";

export function createToolRuntime({ env = process.env } = {}) {
  let runtimePromise = null;
  let dashboard = null;
  const snapshotStore = new DerivedSnapshotStore({ env });
  const shadowStore = new ShadowLearningStore({ env });

  async function runtime() {
    runtimePromise ||= createRuntime(env);
    return runtimePromise;
  }

  async function dashboardManager() {
    if (!dashboard) dashboard = new DashboardManager(await runtime(), env);
    return dashboard;
  }

  return {
    definitions: TOOL_DEFINITIONS,
    async call(name, args = {}) {
      if (name === "company_quality_evidence") return reviewSecCompanyFacts(args);
      if (name === "experimental_kronos_forecast") return experimentalKronosForecast(args, { env });
      if (name === "validate_invest_candidate") return runInvestCandidateResearch(args.dataset, args);
      if (name === "validate_research_dataset") return runResearchValidation(args.dataset, args);
      if (name === "research_signal_ledger") return replaySignalLedger(args);
      if (name === "replay_hypothetical_ledger") return replayHypotheticalLedger(args);
      if (name === "prepare_forward_research_plan") return freezeForwardProtocol(args);
      if (name === "check_research_observation") return checkObservationAvailability(args);
      if (name === "hypothetical_trade_scenario") {
        const { baseCurrency, quoteCurrency, ...scenario } = args;
        if (![baseCurrency, quoteCurrency].every((currency) => typeof currency === "string" && /^[A-Z]{3}$/.test(currency))) throw new Error("Explicit three-letter base and quote currencies are required.");
        if (baseCurrency === quoteCurrency && (scenario.entryBasePerQuote !== 1 || scenario.exitBasePerQuote !== 1)) throw new Error("Same-currency FX rates must equal 1.");
        return { ...calculateHypotheticalProfit(scenario), baseCurrency, quoteCurrency };
      }
      if (name === "event_review") return eventReview(args);
      if (name === "research_notebook") return researchNotebook();
      if (name === "configure_credentials") {
        const result = await configureCredentialsTool(args, env);
        runtimePromise = null;
        return result;
      }
      if (name === "configure_preferences") {
        const result = await configurePreferencesTool(args, env);
        runtimePromise = null;
        return result;
      }
      const service = await runtime();
      switch (name) {
        case "setup_status":
          return setupStatusTool(service, snapshotStore);
        case "portfolio_review":
          return portfolioReview(service, snapshotStore, args);
        case "holding_review":
          return holdingReview(service, args.symbol, args);
        case "strategy_review":
          return strategyReview(service, args.symbol, args);
        case "market_review":
          return marketReview(service, args.symbol, args);
        case "decision_review":
          return decisionReview(service, shadowStore, args.symbol, args);
        case "learning_review":
          return learningReview(service, shadowStore);
        case "portfolio_changes":
          return snapshotStore.changes();
        case "monitor_review":
          return monitorReviewTool(service, snapshotStore, args);
        case "local_data":
          return localDataTool(snapshotStore, shadowStore, args, env);
        case "setup":
          return setupTool(service, args, env);
        case "start_vesper":
          return startVesperTool(service, args, env, dashboardManager);
        case "holdings":
          return holdingsTool(service, args);
        case "pies":
          return piesTool(service, args);
        case "trades":
          return tradesTool(service, args);
        case "quote":
          return quoteTool(service, args);
        case "history":
          return historyTool(service, args);
        case "dashboard":
          return dashboardTool(service, args, env, dashboardManager);
        case "news":
          return newsTool(service, args);
        case "analysis":
          return analysisTool(service, args);
        case "backtest":
          return backtestTool(service, args);
        case "report":
          return reportTool(service, args, env);
        case "daily_brief":
          return dailyBriefTool(service);
        case "order_history":
          return orderHistoryTool(service, args);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    }
  };
}

const LEGACY_TOOL_NAMES = new Set(["setup", "start_vesper", "holdings", "pies", "trades", "quote", "history", "dashboard", "news", "analysis", "backtest", "report", "daily_brief", "order_history"]);

function replayHypotheticalLedger(args) {
  const { baseCurrency, fills, marks } = args;
  if (!Array.isArray(fills) || !Array.isArray(marks)) throw new Error("Explicit fills and marks arrays are required.");
  if (fills.length > 1000 || marks.length > 1000) throw new Error("At most 1000 fills and 1000 marks may be supplied.");
  const currencyByInstrument = new Map();
  for (const record of [...fills, ...marks]) {
    if (!record || typeof record !== "object" || typeof record.quoteCurrency !== "string" || !/^[A-Z]{3}$/.test(record.quoteCurrency)) throw new Error("Explicit three-letter quote currency is required for each fill and mark.");
    if (record.quoteCurrency === baseCurrency && record.basePerQuote !== 1) throw new Error("Same-currency FX rates must equal 1.");
    if (currencyByInstrument.has(record.instrumentId) && currencyByInstrument.get(record.instrumentId) !== record.quoteCurrency) throw new Error("Inconsistent quote currency for instrument.");
    currencyByInstrument.set(record.instrumentId, record.quoteCurrency);
  }
  return { ...replayShadowLedger(args), executionAuthority: "NONE", verification: "UNVALIDATED_ASSUMPTIONS_ONLY" };
}

export const TOOL_DEFINITIONS = [
  tool("company_quality_evidence", "Calculate sourced annual company metrics", "Offline SEC CompanyFacts input: annual gross profit, free cash flow and margins. Preserves filing dates, concepts and sources; rejects future, mismatched or missing facts. Not a valuation or recommendation.", {
    type: "object", properties: { companyFacts: { type: "object", additionalProperties: true }, periodEnd: { type: "string" }, asOf: { type: "string" } }, required: ["companyFacts", "periodEnd", "asOf"], additionalProperties: false
  }, true),
  tool("experimental_kronos_forecast", "Run an optional local Kronos experiment", "Experimental local-only CPU forecast using preinstalled models. No downloads, broker connection or orders. Requires configured optional Python runtime/model paths. Output paths are not calibrated probabilities; this does not validate profitability.", {
    type: "object", properties: { instrumentId: { type: "string" }, bars: { type: "array", minItems: 32, maxItems: 512, items: { type: "object", additionalProperties: true } }, futureSessions: { type: "array", minItems: 1, maxItems: 20, items: { type: "string" } }, seed: { type: "integer", minimum: 0, maximum: 4294967295 }, sampleCount: { type: "integer", minimum: 1, maximum: 10 } }, required: ["instrumentId", "bars", "futureSessions"], additionalProperties: false
  }, true),
  tool("validate_invest_candidate", "Evaluate a fixed Invest monthly trend candidate", "Offline research only. Ten-month month-end trend, next-session open, long ETF or cash, same-window buy-and-hold and doubled-cost stress. Requires sourced data, reviewed calendar, ETF eligibility and explicit evaluation start. No orders or automatic promotion. Corporate actions block computation. A historical screen pass is not evidence of future profitability. See docs/INVEST_PRACTICE.md.", {
    type: "object", properties: { dataset: { type: "object", additionalProperties: true }, initialCash: { type: "number", exclusiveMinimum: 0 }, costBps: { type: "number", minimum: 0, exclusiveMaximum: 5000 }, evaluationStart: { type: "string" } }, required: ["dataset", "initialCash", "costBps", "evaluationStart"], additionalProperties: false
  }, true),
  tool("validate_research_dataset", "Validate sourced research data and all fixed rules", "Offline research: inspect caller-supplied identity, source, rights, timing and corporate-action declarations, then replay all three fixed rules with same-window cost-bearing benchmarks. Missing evidence blocks computation. Declarations are not independently verified; no orders, real-time data, profit validation or automatic promotion. See docs/RESEARCH_VALIDATION.md for dataset contract.", {
    type: "object", properties: { dataset: { type: "object", additionalProperties: true }, initialCash: { type: "number", exclusiveMinimum: 0 }, costBps: { type: "number", minimum: 0, exclusiveMaximum: 10000 } }, required: ["dataset", "initialCash", "costBps"], additionalProperties: false
  }, true),
  tool("research_signal_ledger", "Replay a hypothetical strategy to ledger", "Offline synthetic research only: generate fixed-rule close signals, next-bar open hypothetical fills and a base-currency ledger from explicitly supplied time-stamped OHLCV and FX data. No broker, real account data, execution, verified data, market calendar, dividends, prospective verification or profit guarantee. costBps is an explicit assumed per-side fee; avoid counting slippage twice.", {
    type: "object", properties: {
      patternId: { type: "string", enum: ["sma-trend-cross", "rsi-momentum", "volume-breakout-20"] }, instrumentId: { type: "string" }, baseCurrency: { type: "string", pattern: "^[A-Z]{3}$" }, quoteCurrency: { type: "string", pattern: "^[A-Z]{3}$" }, initialCash: { type: "number", exclusiveMinimum: 0 }, costBps: { type: "number", minimum: 0, exclusiveMaximum: 10000 },
      bars: { type: "array", maxItems: 3000, items: { type: "object", properties: { openTime: { type: "string" }, closeTime: { type: "string" }, availableAt: { type: "string" }, openFxAvailableAt: { type: "string" }, closeFxAvailableAt: { type: "string" }, open: { type: "number" }, close: { type: "number" }, high: { type: "number" }, volume: { type: "number" }, openFx: { type: "number" }, closeFx: { type: "number" } }, required: ["openTime", "closeTime", "availableAt", "openFxAvailableAt", "closeFxAvailableAt", "open", "close", "openFx", "closeFx"], additionalProperties: false } }
    }, required: ["patternId", "instrumentId", "baseCurrency", "quoteCurrency", "initialCash", "costBps", "bars"], additionalProperties: false
  }, true),
  tool("replay_hypothetical_ledger", "Replay hypothetical fills", "Offline research only: calculate cash, positions and P&L for explicit hypothetical fills and marks. No brokerage access, validated strategy, real ledger, price freshness check, trade execution or guarantee. Rates are base per quote, fees in base; prices include assumed slippage. No dividends, corporate actions or external cash flows; results use floating point and cannot reconcile real accounts.", {
    type: "object", properties: {
      baseCurrency: { type: "string", pattern: "^[A-Z]{3}$" }, initialCash: { type: "number", minimum: 0 },
      fills: { type: "array", maxItems: 1000, items: { type: "object", properties: {
        id: { type: "string" }, instrumentId: { type: "string" }, quoteCurrency: { type: "string", pattern: "^[A-Z]{3}$" }, side: { type: "string", enum: ["BUY", "SELL"] }, quantity: { type: "number", exclusiveMinimum: 0 }, price: { type: "number", exclusiveMinimum: 0 }, basePerQuote: { type: "number", exclusiveMinimum: 0 }, feesBase: { type: "number", minimum: 0 }, signalTime: { type: "string" }, fillTime: { type: "string" }
      }, required: ["id", "instrumentId", "quoteCurrency", "side", "quantity", "price", "basePerQuote", "feesBase", "signalTime", "fillTime"], additionalProperties: false } },
      marks: { type: "array", maxItems: 1000, items: { type: "object", properties: { instrumentId: { type: "string" }, quoteCurrency: { type: "string", pattern: "^[A-Z]{3}$" }, price: { type: "number", exclusiveMinimum: 0 }, basePerQuote: { type: "number", exclusiveMinimum: 0 }, time: { type: "string" } }, required: ["instrumentId", "quoteCurrency", "price", "basePerQuote", "time"], additionalProperties: false } }
    }, required: ["baseCurrency", "initialCash", "fills", "marks"], additionalProperties: false
  }, true),
  tool("prepare_forward_research_plan", "Prepare a prospective research plan", "Create an offline PLAN_ONLY protocol and digest from user-supplied assumptions. Does not store or independently timestamp the plan, start validation, authorize trading or establish profitability.", {
    type: "object", properties: {
      frozenAt: { type: "string" }, startsAt: { type: "string" }, instrumentId: { type: "string" }, quoteCurrency: { type: "string" }, baseCurrency: { type: "string" }, dataSource: { type: "string" }, adjustmentPolicy: { type: "string" },
      costs: { type: "object", properties: { commissionBps: { type: "number", minimum: 0 }, spreadAndSlippageBps: { type: "number", minimum: 0 }, fxFeeBps: { type: "number", minimum: 0 }, taxesBps: { type: "number", minimum: 0 }, fxApplied: { type: "boolean" } }, required: ["commissionBps", "spreadAndSlippageBps", "fxFeeBps", "taxesBps", "fxApplied"], additionalProperties: false }
    }, required: ["frozenAt", "startsAt", "instrumentId", "quoteCurrency", "baseCurrency", "dataSource", "adjustmentPolicy", "costs"], additionalProperties: false
  }, true),
  tool("check_research_observation", "Check information timing", "Check user-supplied observation, publication and signal times against a prospective plan. Does not verify the timestamps or establish strategy validity.", {
    type: "object", properties: { observationAt: { type: "string" }, availableAt: { type: "string" }, signalAt: { type: "string" }, frozenAt: { type: "string" }, startsAt: { type: "string" } }, required: ["observationAt", "availableAt", "signalAt", "frozenAt", "startsAt"], additionalProperties: false
  }, true),
  tool("hypothetical_trade_scenario", "Calculate a hypothetical trade outcome", "Calculate a hypothetical long-position target, stop and break-even from explicitly supplied assumptions. Offline only: no account lookup, orders, prediction, persisted learning or guarantee. Rates are units of base currency per unit of quote currency. Fees are base-currency amounts per side; include applicable taxes, and do not double-count spread or slippage already in prices. Exit FX is shared by both scenarios. Optional entryFeeBps and exitFeeBps apply proportionally to each scenario notional, in addition to fixed fees; do not duplicate charges.", {
    type: "object", properties: {
      baseCurrency: { type: "string", pattern: "^[A-Z]{3}$" }, quoteCurrency: { type: "string", pattern: "^[A-Z]{3}$" },
      quantity: { type: "number", exclusiveMinimum: 0 }, entryPrice: { type: "number", exclusiveMinimum: 0 }, targetPrice: { type: "number", exclusiveMinimum: 0 }, stopPrice: { type: "number", exclusiveMinimum: 0 },
      entryBasePerQuote: { type: "number", exclusiveMinimum: 0 }, exitBasePerQuote: { type: "number", exclusiveMinimum: 0 },
      entryFeesBase: { type: "number", minimum: 0 }, exitFeesBase: { type: "number", minimum: 0 },
      entryFeeBps: { type: "number", minimum: 0, exclusiveMaximum: 10000 }, exitFeeBps: { type: "number", minimum: 0, exclusiveMaximum: 10000 }
    }, required: ["baseCurrency", "quoteCurrency", "quantity", "entryPrice", "targetPrice", "stopPrice", "entryBasePerQuote", "exitBasePerQuote", "entryFeesBase", "exitFeesBase"], additionalProperties: false
  }, true),
  tool("research_notebook", "Open the VigilAlpha strategy research notebook", "Read the account-free candidate/source registry, validation gaps and local Markdown export command. No credentials, network, automatic learning or strategy promotion. Notebook edits never change runtime parameters.", {
    type: "object", properties: {}, additionalProperties: false
  }, true),
  tool("event_review", "Review upcoming official events", "Show a dated official-calendar snapshot, upcoming scheduled events, uncertainty and source freshness. It does not predict the Fed decision or stock returns.", {
    type: "object", properties: { asOf: { type: "string" }, days: { type: "integer", minimum: 1, maximum: 90 } }, additionalProperties: false
  }, true),
  tool("market_review", "Review a public stock symbol", "Use a user-supplied or authorized visible-page symbol for compact numerical entry/exit research. No account or browser access is inferred. Request includeChart only when OHLCV chart data is needed.", {
    type: "object", properties: { symbol: { type: "string" }, range: { type: "string", enum: ["6M", "1Y", "MAX"] }, includeChart: { type: "boolean" } }, required: ["symbol"], additionalProperties: false
  }, true, false, { ui: { resourceUri: HOLDING_CHART_UI_URI } }),
  tool("setup_status", "Check VigilAlpha setup", "Check local account connection, Keychain availability, optional market source and derived snapshot status. This tool never returns credentials.", {
    type: "object",
    properties: {},
    additionalProperties: false
  }, true, false, { ui: { resourceUri: SETUP_UI_URI } }),
  tool("portfolio_review", "Review portfolio risk", "Refresh the Trading 212 account and return a read-only portfolio risk review, risk vetoes, data quality and review queue.", {
    type: "object",
    properties: { refresh: { type: "boolean" }, saveSnapshot: { type: "boolean" } },
    additionalProperties: false
  }, true, false, { ui: { resourceUri: PORTFOLIO_FLOW_UI_URI } }),
  tool("holding_review", "Review one holding", "Review one current holding using account facts, market evidence, six strategies, risk vetoes and a five-level research signal. Signals are not orders.", {
    type: "object",
    properties: {
      symbol: { type: "string" },
      refresh: { type: "boolean" },
      range: { type: "string", enum: ["1M", "6M", "1Y", "MAX"] }
    },
    required: ["symbol"],
    additionalProperties: false
  }, true, false, { ui: { resourceUri: HOLDING_CHART_UI_URI } }),
  tool("strategy_review", "Review strategy evidence", "Run versioned strategy modules and disclose source-linked PatternSpecs, chronological cost-aware validation, maturity, data gaps and consensus eligibility.", {
    type: "object",
    properties: { symbol: { type: "string" }, range: { type: "string", enum: ["1M", "6M", "1Y", "MAX"] } },
    required: ["symbol"],
    additionalProperties: false
  }, true),
  tool("decision_review", "Build a conditional shadow decision", "Build a read-only conditional plan for one current holding. Returns exact risk-target quantity when supported, but never places an order and never bypasses evidence gates.", {
    type: "object",
    properties: {
      symbol: { type: "string" },
      refresh: { type: "boolean" },
      range: { type: "string", enum: ["6M", "1Y", "MAX"] },
      record: { type: "boolean" }
    },
    required: ["symbol"],
    additionalProperties: false
  }, false),
  tool("learning_review", "Review the shadow learning gate", "Evaluate eligible 20/60-session outcomes and show sanitized shadow-decision counts, failures and pending proposals. This tool cannot promote or modify a production strategy.", {
    type: "object",
    properties: {},
    additionalProperties: false
  }, false),
  tool("portfolio_changes", "Compare saved risk snapshots", "Compare the two latest VigilAlpha-derived snapshots. It never fabricates history from the current account.", {
    type: "object",
    properties: {},
    additionalProperties: false
  }, true, false, { ui: { resourceUri: RISK_TIMELINE_UI_URI } }),
  tool("monitor_review", "Run a quiet risk monitor", "Refresh the portfolio, save a derived snapshot and report whether a material risk change occurred. A scheduler should stay quiet when materialChange is false.", {
    type: "object",
    properties: { refresh: { type: "boolean" } },
    additionalProperties: false
  }, true, false, { ui: { resourceUri: RISK_TIMELINE_UI_URI } }),
  tool("local_data", "Manage local VigilAlpha data", "Show local data status, export derived snapshots or delete local snapshots, configuration and Keychain credentials. Delete requires an exact confirmation phrase.", {
    type: "object",
    properties: {
      action: { type: "string", enum: ["status", "export", "delete"] },
      destination: { type: "string" },
      confirmation: { type: "string" }
    },
    additionalProperties: false
  }, false, true),
  tool("configure_credentials", "Configure VigilAlpha credentials", "App-only credential setup. Validate Trading 212 read access before saving secrets to macOS Keychain. Never call this tool from model text.", {
    type: "object",
    properties: {
      apiKey: { type: "string", minLength: 1 },
      apiSecret: { type: "string", minLength: 1 },
      marketDataKey: { type: "string" },
      environment: { type: "string", enum: ["live", "demo"] },
      profile: { type: "string", enum: ["conservative", "balanced", "growth"] }
    },
    required: ["apiKey", "apiSecret"],
    additionalProperties: false
  }, false, false, { ui: { visibility: ["app"] } }),
  tool("configure_preferences", "Configure VigilAlpha strategy preferences", "App-only advanced settings. Validate and version user parameters or restore official defaults. Custom parameters remain unvalidated.", {
    type: "object",
    properties: {
      reset: { type: "boolean" },
      profile: { type: "string", enum: ["conservative", "balanced", "growth"] },
      maxPositionWeightPercent: { type: "number" },
      drawdownWarningPercent: { type: "number" },
      fastPeriod: { type: "integer" },
      slowPeriod: { type: "integer" },
      momentumPeriod: { type: "integer" },
      momentumPositiveThreshold: { type: "number" },
      momentumNegativeThreshold: { type: "number" },
      meanReversionPeriod: { type: "integer" },
      meanReversionDeviationPercent: { type: "number" },
      annualizedVolatilityPercent: { type: "number" }
    },
    additionalProperties: false
  }, false, false, { ui: { visibility: ["app"] } }),
  tool("setup", "Check or update Vesper setup", "Use this first to verify Trading 212 credentials, account environment and cloud dashboard configuration. Vesper is always read-only.", {
    type: "object",
    properties: {
      cloudUrl: { type: ["string", "null"] },
      cloudSyncEnabled: { type: "boolean" }
    },
    additionalProperties: false
  }, true),
  tool("start_vesper", "Start Vesper", "Use this as the single startup command. It verifies configuration, refreshes the Trading 212 account and order history, starts the local dashboard and returns the URL to open in Codex.", {
    type: "object",
    properties: {
      port: { type: "integer", minimum: 1024, maximum: 65535 }
    },
    additionalProperties: false
  }, true),
  tool("holdings", "Get holdings and reconciliation", "Use this to read account totals, positions, allocation and positions-versus-Pies verification.", {
    type: "object",
    properties: { refresh: { type: "boolean" }, full: { type: "boolean" } },
    additionalProperties: false
  }, true),
  tool("pies", "Get Pies", "Use this to inspect Pie composition and compare each Pie instrument with the brokerage position.", {
    type: "object",
    properties: { refresh: { type: "boolean" } },
    additionalProperties: false
  }, true),
  tool("trades", "Review trades", "Use this to calculate invested capital, recovered capital, realized and unrealized profit or loss, and execution markers.", {
    type: "object",
    properties: { symbol: { type: "string" }, refresh: { type: "boolean" } },
    additionalProperties: false
  }, true),
  tool("quote", "Get market quote", "Use this for a current quote with provider, update time and delay label. Trading 212 is not used as a quote source.", {
    type: "object",
    properties: { symbol: { type: "string" } },
    required: ["symbol"],
    additionalProperties: false
  }, true),
  tool("history", "Get market history", "Use this for OHLCV bars and real Trading 212 buy and sell markers over 1D, 1W, 1M, 6M, 1Y or MAX.", {
    type: "object",
    properties: {
      symbol: { type: "string" },
      range: { type: "string", enum: ["1D", "1W", "1M", "6M", "1Y", "MAX"] },
      interval: { type: "string", enum: ["auto", "10m", "15m", "30m", "1h", "1D", "1W"] },
      includeMarkers: { type: "boolean" }
    },
    required: ["symbol"],
    additionalProperties: false
  }, true),
  tool("dashboard", "Open the Vesper dashboard", "Use this to start or locate the Apple Stocks-style dashboard. Local mode binds only to 127.0.0.1 and never exposes credentials.", {
    type: "object",
    properties: {
      action: { type: "string", enum: ["open", "url", "status"] },
      port: { type: "integer", minimum: 1024, maximum: 65535 }
    },
    additionalProperties: false
  }, true),
  tool("news", "Get market news", "Use this for recent Yahoo News RSS headlines and a coarse headline sentiment label.", {
    type: "object",
    properties: { symbol: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 20 } },
    additionalProperties: false
  }, true),
  tool("analysis", "Analyze a symbol", "Use this to calculate trend, RSI, moving averages, volatility, drawdown and a confidence score without promising returns.", {
    type: "object",
    properties: {
      symbol: { type: "string" },
      range: { type: "string", enum: ["1D", "1W", "1M", "6M", "1Y", "MAX"] }
    },
    required: ["symbol"],
    additionalProperties: false
  }, true),
  tool("backtest", "Backtest a strategy", "Diagnostic only: this legacy SMA crossover uses same-close signals and fills and excludes all costs. It is not execution-realistic, evidence of profitability, or a trading decision.", {
    type: "object",
    properties: {
      symbol: { type: "string" },
      range: { type: "string", enum: ["1M", "6M", "1Y", "MAX"] },
      fast: { type: "integer", minimum: 2, maximum: 100 },
      slow: { type: "integer", minimum: 3, maximum: 250 },
      initialCapital: { type: "number", minimum: 1 }
    },
    required: ["symbol"],
    additionalProperties: false
  }, true),
  tool("report", "Generate a research report", "Use this to combine quote, history, technical analysis, backtest and headlines into a Markdown report and optionally save it locally.", {
    type: "object",
    properties: {
      symbol: { type: "string" },
      range: { type: "string", enum: ["1M", "6M", "1Y", "MAX"] },
      save: { type: "boolean" }
    },
    required: ["symbol"],
    additionalProperties: false
  }, true),
  tool("daily_brief", "Generate the read-only daily portfolio brief", "Use this for a daily portfolio review covering value, concentration, contribution, recent orders, data quality and threshold-based risks. It never places or changes orders.", {
    type: "object",
    properties: {},
    additionalProperties: false
  }, true),
  tool("order_history", "Get read-only order history", "Use this to review Trading 212 order history and local setup/audit events. Vesper does not place or cancel orders.", {
    type: "object",
    properties: { limit: { type: "integer", minimum: 1, maximum: 500 } },
    additionalProperties: false
  }, true)
].map(markLegacyTool);

function markLegacyTool(definition) {
  if (!LEGACY_TOOL_NAMES.has(definition.name)) return definition;
  return {
    ...definition,
    title: `[Deprecated compatibility] ${definition.title}`,
    description: `Deprecated Vesper compatibility tool; remove after the first VigilAlpha compatibility release. ${definition.description}`,
    _meta: { ...(definition._meta || {}), lifecycle: "deprecated" }
  };
}

function tool(name, title, description, inputSchema, readOnlyHint, destructiveHint = false, meta = undefined) {
  return {
    name,
    title,
    description,
    inputSchema,
    ...(meta ? { _meta: meta } : {}),
    annotations: {
      readOnlyHint,
      destructiveHint,
      idempotentHint: readOnlyHint,
      openWorldHint: name !== "setup"
    }
  };
}

async function setupStatusTool(service, snapshotStore) {
  const [status, localData] = await Promise.all([service.status(), snapshotStore.status()]);
  return {
    product: "VigilAlpha",
    version: PRODUCT_VERSION,
    configured: status.credentials.configured,
    credentialSource: status.credentials.source,
    accountVerifiedAt: status.config.accountVerifiedAt,
    mode: "read-only",
    keychain: { platformSupported: process.platform === "darwin", configured: status.credentials.source === "macos-keychain" },
    marketData: { optionalProviderConfigured: status.credentials.twelveDataConfigured },
    localData,
    riskProfile: status.config.riskProfile || "balanced",
    preferences: {
      configVersion: status.config.configVersion,
      parameterVersion: status.config.parameterVersion,
      parameterValidation: status.config.parameterValidation,
      riskLimits: status.config.riskLimits,
      strategyParameters: status.config.strategyParameters
    },
    setupUi: SETUP_UI_URI
  };
}

async function configureCredentialsTool(args, env) {
  const environment = args.environment || "live";
  const profile = args.profile || "balanced";
  const apiKey = String(args.apiKey || "").trim();
  const apiSecret = String(args.apiSecret || "").trim();
  const marketDataKey = String(args.marketDataKey || "").trim();
  if (!apiKey || !apiSecret) throw new Error("API Key and API Secret are both required.");
  const client = new T212Client({ apiKey, apiSecret, environment, minimumIntervalMs: 0 });
  let summary;
  try {
    summary = mapSummary(await client.accountSummary());
  } catch (error) {
    throw new Error(credentialVerificationMessage(error, environment));
  }
  try {
    await storeCredential("apiKey", apiKey, env);
    await storeCredential("apiSecret", apiSecret, env);
    if (marketDataKey) await storeCredential("twelveDataKey", marketDataKey, env);
  } catch (error) {
    await Promise.all([
      deleteCredential("apiKey", env, { includeLegacy: false }),
      deleteCredential("apiSecret", env, { includeLegacy: false }),
      deleteCredential("twelveDataKey", env, { includeLegacy: false })
    ]);
    throw new Error(`Credential verification succeeded but secure Keychain storage failed: ${error.message}`);
  }
  const verifiedAt = new Date().toISOString();
  await updateConfig({ environment, accountVerifiedAt: verifiedAt, riskProfile: profile, riskLimits: limitsForProfile(profile), readOnly: true, cloud: { url: null, syncEnabled: false } }, env);
  return {
    configured: true,
    verifiedAt,
    account: { currency: summary.currency || null },
    marketDataConfigured: Boolean(marketDataKey),
    mode: "read-only"
  };
}

export function credentialVerificationMessage(error, environment = "live") {
  const selected = environment === "demo" ? "Demo" : "Live";
  if (error?.status === 401) {
    return `Trading 212 returned 401. The Key/Secret pair is invalid for the selected ${selected} environment. Credentials were not saved.`;
  }
  if (error?.status === 403) {
    return `Trading 212 returned 403. Confirm this is an Invest or Stocks ISA account, the key permits account-summary reads, and any IP restriction allows this Mac. Credentials were not saved.`;
  }
  if (error?.status === 429) {
    return "Trading 212 rate limit was reached. Wait at least 5 seconds and retry. Credentials were not saved.";
  }
  if (error?.status === 408 || /timed out/i.test(error?.message || "")) {
    return "Trading 212 verification timed out. Check the network and retry; credentials were not saved.";
  }
  return "Trading 212 could not be reached for read-only verification. Check the selected Live/Demo environment and network, then retry. Credentials were not saved.";
}

async function configurePreferencesTool(args, env) {
  const current = await readConfig(env);
  if (args.reset) {
    const next = await updateConfig({
      riskProfile: "balanced",
      riskLimits: limitsForProfile("balanced"),
      strategyParameters: DEFAULT_STRATEGY_PARAMETERS,
      parameterVersion: "vigilalpha.defaults.2026-10-06",
      parameterValidation: "official_default"
    }, env);
    return { updated: true, reset: true, config: publicConfig(next), differences: [] };
  }
  const profile = args.profile || current.riskProfile || "balanced";
  const riskLimits = args.profile
    ? { ...current.riskLimits, ...limitsForProfile(profile) }
    : { ...current.riskLimits };
  if (args.maxPositionWeightPercent !== undefined) riskLimits.maxPositionWeightPercent = inRange(args.maxPositionWeightPercent, 1, 100, "maxPositionWeightPercent");
  if (args.drawdownWarningPercent !== undefined) riskLimits.drawdownWarningPercent = inRange(args.drawdownWarningPercent, 1, 95, "drawdownWarningPercent");
  const strategyParameters = {
    trend: {
      fastPeriod: integerInRange(args.fastPeriod ?? current.strategyParameters.trend.fastPeriod, 2, 100, "fastPeriod"),
      slowPeriod: integerInRange(args.slowPeriod ?? current.strategyParameters.trend.slowPeriod, 3, 250, "slowPeriod")
    },
    momentum: {
      period: integerInRange(args.momentumPeriod ?? current.strategyParameters.momentum.period, 2, 100, "momentumPeriod"),
      positiveThreshold: inRange(args.momentumPositiveThreshold ?? current.strategyParameters.momentum.positiveThreshold, 50, 99, "momentumPositiveThreshold"),
      negativeThreshold: inRange(args.momentumNegativeThreshold ?? current.strategyParameters.momentum.negativeThreshold, 1, 50, "momentumNegativeThreshold")
    },
    meanReversion: {
      period: integerInRange(args.meanReversionPeriod ?? current.strategyParameters.meanReversion.period, 2, 250, "meanReversionPeriod"),
      deviationPercent: inRange(args.meanReversionDeviationPercent ?? current.strategyParameters.meanReversion.deviationPercent, 0.1, 100, "meanReversionDeviationPercent")
    },
    volatilityDrawdown: {
      annualizedVolatilityPercent: inRange(args.annualizedVolatilityPercent ?? current.strategyParameters.volatilityDrawdown.annualizedVolatilityPercent, 1, 500, "annualizedVolatilityPercent")
    }
  };
  if (strategyParameters.trend.fastPeriod >= strategyParameters.trend.slowPeriod) throw new Error("fastPeriod must be lower than slowPeriod.");
  if (strategyParameters.momentum.negativeThreshold >= strategyParameters.momentum.positiveThreshold) throw new Error("momentumNegativeThreshold must be lower than momentumPositiveThreshold.");
  const parameterVersion = `vigilalpha.user.${new Date().toISOString()}`;
  const next = await updateConfig({ riskProfile: profile, riskLimits, strategyParameters, parameterVersion, parameterValidation: "user_modified_unvalidated" }, env);
  return {
    updated: true,
    reset: false,
    config: publicConfig(next),
    differences: parameterDifferences(next),
    warning: "Custom parameters are unvalidated and do not upgrade strategy maturity."
  };
}

function parameterDifferences(config) {
  const differences = [];
  for (const [group, values] of Object.entries(config.strategyParameters)) {
    for (const [key, value] of Object.entries(values)) {
      const official = DEFAULT_STRATEGY_PARAMETERS[group][key];
      if (value !== official) differences.push({ field: `${group}.${key}`, official, current: value });
    }
  }
  return differences;
}

function inRange(value, minimum, maximum, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  return parsed;
}

function integerInRange(value, minimum, maximum, name) {
  const parsed = inRange(value, minimum, maximum, name);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer.`);
  return parsed;
}

async function monitorReviewTool(service, snapshotStore, args) {
  const before = await snapshotStore.status();
  const review = await portfolioReview(service, snapshotStore, { refresh: args.refresh !== false, saveSnapshot: true });
  const changes = await snapshotStore.changes();
  if (before.snapshotCount === 0) {
    return { status: "BASELINE_CREATED", materialChange: false, notify: false, sourceCutoff: review.sourceCutoff, changes: [] };
  }
  return {
    status: changes.status,
    materialChange: changes.materialChange,
    notify: changes.materialChange,
    sourceCutoff: review.sourceCutoff,
    changes: changes.changes
  };
}

async function localDataTool(snapshotStore, shadowStore, args, env) {
  const action = args.action || "status";
  if (action === "status") return { action, ...(await snapshotStore.status()), shadowLearning: await shadowStore.review() };
  if (action === "export") {
    if (!args.destination) throw new Error("An absolute destination is required for export.");
    if (!path.isAbsolute(args.destination)) throw new Error("Export destination must be an absolute path.");
    const [snapshots, shadowLearningRecords] = await Promise.all([snapshotStore.readAll(), shadowStore.readAll()]);
    await mkdir(path.dirname(args.destination), { recursive: true, mode: 0o700 });
    try {
      await writeFile(args.destination, `${JSON.stringify({
        version: "vigilalpha.local-export.v2",
        exportedAt: new Date().toISOString(),
        derivedSnapshots: snapshots,
        shadowLearningRecords
      }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    } catch (error) {
      if (error?.code === "EEXIST") throw new Error("Export destination already exists; choose a new file path.");
      throw error;
    }
    return { action, exported: true, destination: args.destination, snapshotCount: snapshots.length, shadowRecordCount: shadowLearningRecords.length };
  }
  if (action === "delete") {
    if (args.confirmation !== "DELETE_LOCAL_DATA") throw new Error("Deletion requires confirmation: DELETE_LOCAL_DATA");
    const [snapshots, shadow] = await Promise.all([snapshotStore.deleteAll(), shadowStore.deleteAll()]);
    await Promise.all([deleteCredential("apiKey", env), deleteCredential("apiSecret", env), deleteCredential("twelveDataKey", env)]);
    await Promise.all([
      rm(configPath(env), { force: true }),
      rm(cachePath(env), { force: true }),
      rm(auditPath(env), { force: true }),
      rm(path.join(stateDirectory(env), "reports"), { recursive: true, force: true })
    ]);
    return { action, deleted: true, deletedScope: [...snapshots.deletedScope, ...shadow.deletedScope, "normalized current cache", "saved reports", "configuration", "local audit", "Keychain credentials"] };
  }
  throw new Error(`Unknown local data action: ${action}`);
}

function limitsForProfile(profile) {
  if (profile === "conservative") {
    return { maxPositionWeightPercent: 15, maxSectorWeightPercent: 30, drawdownWarningPercent: 10, defaultStopLossPercent: 8, minimumConfidence: 0.7 };
  }
  if (profile === "growth") {
    return { maxPositionWeightPercent: 25, maxSectorWeightPercent: 50, drawdownWarningPercent: 20, defaultStopLossPercent: 12, minimumConfidence: 0.55 };
  }
  return { maxPositionWeightPercent: 20, maxSectorWeightPercent: 40, drawdownWarningPercent: 15, defaultStopLossPercent: 10, minimumConfidence: 0.6 };
}

async function setupTool(service, args, env) {
  if (args.cloudUrl !== undefined || args.cloudSyncEnabled !== undefined) {
    throw new Error("Cloud sync is disabled in VigilAlpha. The deprecated Vesper setup tool cannot enable it.");
  }
  const patch = {};
  const config = Object.keys(patch).length ? await updateConfig(patch, env) : await readConfig(env);
  if (Object.keys(patch).length) {
    await appendAudit({ type: "setup_updated", patch: { ...patch, cloud: patch.cloud } }, env);
  }
  const status = await service.status();
  return {
    ...status,
    config: publicConfig(config),
    instructions: service.credentials.configured
      ? "Credentials are configured. Ask for holdings, a chart, analysis, a report or the daily brief."
      : `Credentials are missing. In Terminal run: node "${path.join(pluginRoot(env), "scripts", "setup.mjs")}"`
  };
}

async function startVesperTool(service, args, env, dashboardManager) {
  if (!service.credentials.configured) {
    return {
      ready: false,
      credentialSource: "missing",
      instructions: `Run "${path.join(pluginRoot(env), "scripts", "setup.mjs")}" once to save the Trading 212 API key in macOS Keychain, then run start_vesper again.`
    };
  }
  const manager = await dashboardManager();
  const info = await manager.start({ port: args.port || 8788 });
  const snapshot = await service.snapshot({ force: true });
  const brief = buildPortfolioBrief({ snapshot });
  const orderError = snapshot.errors?.find((error) => error.section === "orders");
  return {
    ready: service.credentials.configured,
    credentialSource: service.credentials.source,
    localUrl: info.localUrl,
    url: info.url,
    status: snapshot.status,
    syncedAt: snapshot.syncedAt,
    positionCount: snapshot.positions?.length || 0,
    orderCount: snapshot.orders?.length || 0,
    orderHistoryStatus: orderError ? "ERROR" : "READY",
    orderHistoryMessage: orderError?.userAction || orderError?.message || null,
    dataQualityErrors: snapshot.errors || [],
    summary: snapshot.summary,
    brief
  };
}

async function holdingsTool(service, args) {
  const snapshot = await service.snapshot({ force: Boolean(args.refresh), full: Boolean(args.full) });
  return {
    status: snapshot.status,
    syncedAt: snapshot.syncedAt,
    summary: snapshot.summary,
    positions: snapshot.positions,
    allocation: snapshot.allocation,
    reconciliation: snapshot.reconciliation,
    errors: snapshot.errors
  };
}

async function piesTool(service, args) {
  const snapshot = await service.snapshot({ force: Boolean(args.refresh) });
  return {
    status: snapshot.reconciliation?.status,
    pies: snapshot.pies,
    reconciliation: snapshot.reconciliation
  };
}

async function tradesTool(service, args) {
  const snapshot = await service.snapshot({ force: Boolean(args.refresh) });
  return calculateTradeReview(snapshot.orders, snapshot.positions, args.symbol || null);
}

async function quoteTool(service, args) {
  return service.quote(args.symbol);
}

async function historyTool(service, args) {
  const history = await service.history(args.symbol, args.range || "1Y", args.interval || "auto");
  let markers = [];
  if (args.includeMarkers !== false) {
    try {
      const snapshot = await service.snapshot();
      markers = tradeMarkers(snapshot.orders, args.symbol);
    } catch {
      markers = [];
    }
  }
  return { ...history, markers };
}

async function dashboardTool(service, args, env, dashboardManager) {
  const manager = await dashboardManager();
  const info = await manager.start({ port: args.port || 8788 });
  return {
    action: args.action || "open",
    ...info,
    note: info.cloudConfigured
      ? "The cloud URL is configured. Run `npm run sync` continuously on this Mac to push snapshots without uploading credentials."
      : "Local mode is active. The dashboard binds to 127.0.0.1 only."
  };
}

async function newsTool(service, args) {
  return { headlines: await service.news.search({ symbol: args.symbol || null, limit: args.limit || 8 }) };
}

async function analysisTool(service, args) {
  return service.analysis(args.symbol, args.range || "1Y");
}

async function backtestTool(service, args) {
  return service.backtest(args.symbol, args.range || "MAX", {
    fast: args.fast || 20,
    slow: args.slow || 50,
    initialCapital: args.initialCapital || 10_000
  });
}

async function reportTool(service, args, env) {
  const markdown = await service.report(args.symbol, args.range || "1Y");
  let file = null;
  if (args.save) {
    const directory = path.join(stateDirectory(env), "reports");
    await ensurePrivateDirectory(directory);
    file = path.join(directory, `${safeFilename(args.symbol)}-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
    await writeFile(file, markdown, { mode: 0o600 });
    await chmod(file, 0o600);
  }
  return { symbol: args.symbol, markdown, file };
}

async function dailyBriefTool(service) {
  return service.dailyBrief();
}

async function orderHistoryTool(service, args) {
  const orders = await service.orderHistory();
  const audit = await readAudit(process.env, args.limit || 100);
  return { orders: orders.slice(0, args.limit || 500), audit };
}

function pluginRoot() {
  return path.resolve(new URL("../../", import.meta.url).pathname);
}

function safeFilename(value) {
  return String(value).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
}
