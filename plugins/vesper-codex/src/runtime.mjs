import { analyzeBars, movingAverageBacktest } from "./analysis/technical.mjs";
import { buildPortfolioBrief } from "./analysis/portfolio-brief.mjs";
import { buildResearchReport } from "./analysis/report.mjs";
import { NewsService } from "./analysis/news.mjs";
import {
  credentialStatus,
  publicConfig,
  readConfig,
  readCredential
} from "./core/config.mjs";
import { PortfolioSyncService } from "./core/sync-service.mjs";
import { T212Client } from "./core/t212-client.mjs";
import { MarketService } from "./market/market-service.mjs";
import { PRODUCT_VERSION } from "./version.mjs";

export async function createRuntime(env = process.env) {
  const config = await readConfig(env);
  const credentials = await credentialStatus(env);
  const market = new MarketService({ env });
  const news = new NewsService();
  let client = null;
  let sync = null;

  if (credentials.configured) {
    const [apiKey, apiSecret, twelveDataKey] = await Promise.all([
      readCredential("apiKey", env),
      readCredential("apiSecret", env),
      readCredential("twelveDataKey", env)
    ]);
    client = new T212Client({ apiKey, apiSecret, environment: config.environment });
    sync = new PortfolioSyncService({ client, env });
    market.twelveDataKey = twelveDataKey;
  }

  return {
    config,
    credentials,
    market,
    news,
    client,
    sync,

    async status() {
      return {
        plugin: "vigilalpha-codex",
        version: PRODUCT_VERSION,
        credentials,
        config: publicConfig(config),
        dataSources: {
          trading212: credentials.configured,
          finnhub: Boolean(env.FINNHUB_API_KEY),
          twelveData: Boolean(market.twelveDataKey),
          yahoo: true,
          nasdaq: true,
          tradingView: true,
          longbridge: false
        },
        node: process.version,
        platform: process.platform
      };
    },

    async snapshot(options) {
      return requireSync(sync).getSnapshot(options);
    },

    async quote(symbol) {
      return market.quote(symbol);
    },

    async quotes(symbols) {
      return market.quotes(symbols);
    },

    async history(symbol, range, interval = "auto") {
      return market.history(symbol, range, interval);
    },

    async analysis(symbol, range = "1Y") {
      const history = await market.history(symbol, range);
      return {
        symbol,
        range,
        source: history.source,
        ...analyzeBars(history.bars)
      };
    },

    async backtest(symbol, range = "MAX", options = {}) {
      const history = await market.history(symbol, range);
      return movingAverageBacktest(history.bars, options);
    },

    async report(symbol, range = "1Y") {
      const [quote, history, headlines] = await Promise.all([
        market.quote(symbol),
        market.history(symbol, range),
        news.search({ symbol, limit: 5 })
      ]);
      const analysis = analyzeBars(history.bars);
      const backtest = history.bars.length > 51
        ? movingAverageBacktest(history.bars, { fast: 20, slow: 50 })
        : null;
      return buildResearchReport({ symbol, quote, history, analysis, news: headlines, backtest });
    },

    async dailyBrief() {
      const snapshot = await requireSync(sync).getSnapshot();
      return buildPortfolioBrief({ snapshot });
    },

    async orderHistory() {
      const snapshot = await requireSync(sync).getSnapshot();
      return snapshot.orders;
    }
  };
}

export function requireSync(sync) {
  if (!sync) {
    throw new Error("Trading 212 is not configured. Run `npm run setup` from the plugin directory.");
  }
  return sync;
}

export function tradeMarkers(orders, symbol) {
  const normalized = String(symbol || "").toUpperCase();
  let runningPosition = 0;
  return orders
    .filter((order) => order.isTrade !== false && (!normalized || order.symbol === normalized))
    .slice()
    .sort((left, right) => dateValue(left.filledAt || left.orderedAt) - dateValue(right.filledAt || right.orderedAt))
    .map((order) => {
      const quantity = Number(order.filledQuantity || 0);
      const positionBefore = runningPosition;
      runningPosition += order.side === "BUY" ? quantity : order.side === "SELL" ? -quantity : 0;
      const timestamp = order.filledAt || order.orderedAt;
      return {
        id: String(order.id || `${order.symbol}-${timestamp}`),
        symbol: order.symbol,
        timestamp,
        time: timestamp,
        side: order.side,
        quantity,
        executionPrice: Number(order.price || 0),
        price: Number(order.price || 0),
        grossValue: Number(order.filledValue || 0),
        value: Number(order.filledValue || 0),
        fees: order.fees ?? null,
        taxes: order.taxes ?? null,
        fxRate: order.fxRate ?? null,
        netValue: order.netValue ?? null,
        realisedProfitLoss: order.realisedProfitLoss ?? null,
        currency: order.currency || null,
        orderId: order.orderId || order.id || null,
        tradeId: order.tradeId || null,
        positionBefore,
        positionAfter: runningPosition,
        source: order.source || "trading212"
      };
    });
}

export function calculateTradeReview(orders, positions, symbol = null) {
  const normalized = String(symbol || "").toUpperCase();
  const relevant = normalized ? orders.filter((order) => order.symbol === normalized) : orders;
  const markers = tradeMarkers(relevant);
  const buys = markers.filter((order) => order.side === "BUY");
  const sells = markers.filter((order) => order.side === "SELL");
  const totalInvested = sum(buys, "grossValue");
  const totalRecovered = sum(sells, "grossValue");
  const totalInvestedNet = buys.reduce((total, item) => total + cashAmount(item, "BUY"), 0);
  const totalRecoveredNet = sells.reduce((total, item) => total + cashAmount(item, "SELL"), 0);
  const brokerRealized = sells.map((item) => finiteOrNull(item.realisedProfitLoss));
  const brokerComplete = sells.length > 0 && brokerRealized.every((value) => value !== null);
  const realizedPnL = brokerComplete ? brokerRealized.reduce((sum, value) => sum + value, 0) : calculateRealizedPnL(markers);
  const position = normalized ? positions.find((item) => item.symbol === normalized) : null;
  const firstTradeAt = markers[0]?.timestamp || null;
  const latestTradeAt = markers.at(-1)?.timestamp || null;
  const unrealizedPnL = position?.unrealizedPnL || positions.reduce((total, item) => total + item.unrealizedPnL, 0);
  const totalPnL = realizedPnL + unrealizedPnL;
  return {
    symbol: normalized || null,
    totalInvested,
    totalRecovered,
    totalInvestedNet,
    totalRecoveredNet,
    totalExplicitCosts: markers.reduce((total, item) => total + Number(item.fees || 0) + Number(item.taxes || 0), 0),
    netInvested: totalInvested - totalRecovered,
    realizedPnL,
    realizedPnLSource: brokerComplete ? "TRADING212_WALLET_IMPACT" : "LOCAL_FIFO_ESTIMATE",
    unrealizedPnL,
    totalPnL,
    totalReturn: totalInvested ? totalPnL / totalInvested : null,
    tradeCount: markers.length,
    buyCount: buys.length,
    sellCount: sells.length,
    averageBuyPrice: weightedAverage(buys),
    averageSellPrice: weightedAverage(sells),
    firstTradeAt,
    latestTradeAt,
    holdingPeriodDays: firstTradeAt ? Math.max(0, Math.round((Date.now() - dateValue(firstTradeAt)) / 86_400_000)) : null,
    markers
  };
}

function weightedAverage(orders) {
  const quantity = orders.reduce((sum, order) => sum + order.quantity, 0);
  return quantity ? sum(orders, "value") / quantity : null;
}

function sum(orders, field) {
  return orders.reduce((total, order) => total + Number(order[field] || 0), 0);
}

function calculateRealizedPnL(markers) {
  const lots = [];
  let realized = 0;
  for (const marker of markers) {
    if (marker.side === "BUY") {
      lots.push({ quantity: marker.quantity, price: marker.executionPrice, feesPerShare: (Number(marker.fees || 0) + Number(marker.taxes || 0)) / Math.max(marker.quantity, 1) });
      continue;
    }
    if (marker.side !== "SELL") continue;
    let remaining = marker.quantity;
    let cost = 0;
    while (remaining > 0 && lots.length > 0) {
      const lot = lots[0];
      const matched = Math.min(remaining, lot.quantity);
      cost += matched * (lot.price + lot.feesPerShare);
      lot.quantity -= matched;
      remaining -= matched;
      if (lot.quantity <= 0.00000001) lots.shift();
    }
    if (remaining > 0) cost += remaining * marker.executionPrice;
    realized += marker.quantity * marker.executionPrice - cost - Number(marker.fees || 0) - Number(marker.taxes || 0);
  }
  return realized;
}

function cashAmount(marker, side) {
  const net = finiteOrNull(marker.netValue);
  if (net !== null) return Math.abs(net);
  const costs = Number(marker.fees || 0) + Number(marker.taxes || 0);
  return side === "BUY" ? Number(marker.grossValue || 0) + costs : Math.max(0, Number(marker.grossValue || 0) - costs);
}

function finiteOrNull(value) {
  const parsed = Number(value);
  return value !== null && value !== undefined && Number.isFinite(parsed) ? parsed : null;
}

function dateValue(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}
