import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tradeMarkers, calculateTradeReview } from "../runtime.mjs";

const DASHBOARD_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dashboard");

export class DashboardManager {
  constructor(runtime, env = process.env) {
    this.runtime = runtime;
    this.env = env;
    this.server = null;
    this.clients = new Set();
    this.refreshTimer = null;
    this.historyCache = new Map();
    this.cloudState = {
      pushedAt: null,
      snapshot: null,
      brief: null,
      histories: {},
      trades: {},
      source: "local"
    };
  }

  async start({ host = "127.0.0.1", port = 8788 } = {}) {
    if (this.server) return this.info();
    this.server = createServer((request, response) => {
      this.handle(request, response).catch((error) => {
        sendJson(response, 500, { error: error.message });
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, host, resolve);
    });
    this.startRefreshLoop();
    this.refreshAndBroadcast();
    return this.info();
  }

  info() {
    const address = this.server?.address();
    const port = typeof address === "object" && address ? address.port : null;
    const host = port ? "127.0.0.1" : null;
    const cloudUrl = this.env.VESPER_CLOUD_URL || this.runtime.config.cloud.url;
    return {
      running: Boolean(this.server),
      localUrl: port ? `http://${host}:${port}/` : null,
      url: cloudUrl || (port ? `http://${host}:${port}/` : null),
      cloudConfigured: Boolean(cloudUrl)
    };
  }

  async close() {
    for (const response of this.clients) response.end();
    this.clients.clear();
    if (!this.server) return;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
  }

  startRefreshLoop() {
    if (this.refreshTimer) return;
    this.refreshTimer = setInterval(async () => {
      if (this.clients.size === 0) return;
      await this.refreshAndBroadcast();
    }, 60_000);
    this.refreshTimer.unref?.();
  }

  async refreshAndBroadcast() {
    try {
      await this.runtime.snapshot({ force: true });
      this.broadcast("snapshot", { at: new Date().toISOString() });
    } catch (error) {
      this.broadcast("snapshot", { at: new Date().toISOString(), warning: error.message });
    }
  }

  async handle(request, response) {
    const url = new URL(request.url, "http://localhost");
    // Cloud sync contains private account data. Static assets are public, but
    // every API endpoint, including event streams, must fail closed.
    if ((this.env.VESPER_MODE || "local") === "cloud" && url.pathname.startsWith("/api/") && !this.authorized(request)) {
      return sendJson(response, 401, { error: "Unauthorized" });
    }
    if (request.method === "GET" && url.pathname === "/") {
      return sendFile(response, "index.html", "text/html; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/styles.css") {
      return sendFile(response, "styles.css", "text/css; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/app.js") {
      return sendFile(response, "app.js", "text/javascript; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/analytics.js") {
      return sendFile(response, "analytics.js", "text/javascript; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/chart.js") {
      return sendFile(response, "chart.js", "text/javascript; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/api/status") {
      return sendJson(response, 200, {
        ...(await this.runtime.status()),
        dashboard: this.info(),
        mode: this.env.VESPER_MODE || "local"
      });
    }
    if (request.method === "GET" && url.pathname === "/api/snapshot") {
      return sendJson(response, 200, await this.getSnapshot({
        force: url.searchParams.get("refresh") === "1"
      }));
    }
    if (request.method === "GET" && url.pathname === "/api/brief") {
      return sendJson(response, 200, await this.getBrief());
    }
    if (request.method === "GET" && url.pathname === "/api/history") {
      const symbol = url.searchParams.get("symbol") || await this.firstHoldingSymbol();
      const range = url.searchParams.get("range") || "1Y";
      const interval = url.searchParams.get("interval") || "auto";
      if (!symbol) return sendJson(response, 200, { symbol: null, bars: [], markers: [] });
      return sendJson(response, 200, await this.getHistory(symbol, range, interval));
    }
    if (request.method === "GET" && url.pathname === "/api/quote") {
      const symbol = url.searchParams.get("symbol") || await this.firstHoldingSymbol();
      if (!symbol) return sendJson(response, 200, { symbol: null });
      return sendJson(response, 200, await this.runtime.quote(symbol));
    }
    if (request.method === "GET" && url.pathname === "/api/quotes") {
      const symbols = (url.searchParams.get("symbols") || "")
        .split(",")
        .map((symbol) => symbol.trim())
        .filter(Boolean);
      return sendJson(response, 200, await this.runtime.quotes(symbols));
    }
    if (request.method === "GET" && url.pathname === "/api/trades") {
      const symbol = url.searchParams.get("symbol") || await this.firstHoldingSymbol();
      return sendJson(response, 200, await this.getTrades(symbol));
    }
    if (request.method === "GET" && url.pathname === "/api/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
      response.write(`event: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
      this.clients.add(response);
      request.on("close", () => this.clients.delete(response));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/push") {
      if (!this.authorized(request)) return sendJson(response, 401, { error: "Unauthorized" });
      const body = await readJsonBody(request);
      this.cloudState = {
        pushedAt: new Date().toISOString(),
        snapshot: body.snapshot || null,
        brief: body.brief || null,
        histories: body.histories || {},
        trades: body.trades || {},
        source: body.source || "cloud-sync"
      };
      this.broadcast("snapshot", { pushedAt: this.cloudState.pushedAt });
      return sendJson(response, 200, { accepted: true, pushedAt: this.cloudState.pushedAt });
    }
    return sendJson(response, 404, { error: "Not found" });
  }

  authorized(request) {
    const token = this.env.VESPER_DASHBOARD_TOKEN;
    if (!token) return (this.env.VESPER_MODE || "local") !== "cloud";
    return request.headers.authorization === `Bearer ${token}`;
  }

  async getSnapshot(options = {}) {
    if ((this.env.VESPER_MODE || "local") === "cloud") {
      return this.cloudState.snapshot || { status: "WAITING_FOR_SYNC", positions: [], pies: [], orders: [], errors: [] };
    }
    try {
      return await this.runtime.snapshot(options);
    } catch (error) {
      return {
        status: "ERROR",
        error: error.message,
        positions: [],
        pies: [],
        orders: [],
        errors: [{ section: "connection", message: error.message }]
      };
    }
  }

  async getHistory(symbol, range, interval = "auto") {
    if ((this.env.VESPER_MODE || "local") === "cloud") {
      return this.cloudState.histories[`${symbol}:${range}:${interval}`]
        || this.cloudState.histories[`${symbol}:${range}`]
        || this.cloudState.histories[symbol]
        || { symbol, range, bars: [], markers: [] };
    }
    const key = `${symbol}:${range}:${interval}`;
    const ttlMs = range === "1D" ? 30_000 : 10 * 60_000;
    const cached = this.historyCache.get(key);
    let history;
    if (cached && Date.now() - cached.cachedAt <= ttlMs) {
      history = cached.value;
    } else {
      try {
        history = await this.runtime.history(symbol, range, interval);
        this.historyCache.set(key, { cachedAt: Date.now(), value: history });
      } catch {
        history = cached
          ? { ...cached.value, stale: true, source: `${cached.value.source || "Cache"} cache` }
          : { symbol, range, interval, bars: [], markers: [], stale: true, source: "Unavailable" };
      }
    }
    const snapshot = await this.getSnapshot();
    return {
      ...history,
      markers: tradeMarkers(snapshot.orders || [], symbol)
    };
  }

  async getBrief() {
    if ((this.env.VESPER_MODE || "local") === "cloud") {
      return this.cloudState.brief || {
        status: "WAITING_FOR_SYNC",
        markdown: "Waiting for a local Vesper sync.",
        riskSignals: []
      };
    }
    return this.runtime.dailyBrief();
  }

  async getTrades(symbol) {
    if ((this.env.VESPER_MODE || "local") === "cloud") {
      return this.cloudState.trades[symbol] || { symbol, markers: [] };
    }
    const snapshot = await this.getSnapshot();
    return calculateTradeReview(snapshot.orders || [], snapshot.positions || [], symbol);
  }

  async firstHoldingSymbol() {
    const snapshot = await this.getSnapshot();
    return snapshot.positions?.[0]?.symbol || snapshot.allocation?.[0]?.symbol || null;
  }

  broadcast(event, data) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const response of this.clients) response.write(message);
  }
}

async function sendFile(response, filename, contentType) {
  const content = await readFile(path.join(DASHBOARD_ROOT, filename));
  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'"
  });
  response.end(content);
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(`${JSON.stringify(body)}\n`);
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 2_000_000) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
