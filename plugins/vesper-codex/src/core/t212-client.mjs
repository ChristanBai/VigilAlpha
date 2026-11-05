const BASE_URLS = {
  live: "https://live.trading212.com/api/v0",
  demo: "https://demo.trading212.com/api/v0"
};

const THROTTLE_RULES = [
  [/^\/equity\/account\//, 5_100],
  [/^\/equity\/positions$/, 1_100],
  [/^\/equity\/pies(?:\/|$)/, 1_100],
  [/^\/equity\/history\/(?:orders|transactions|dividends)$/, 1_300],
  [/^\/equity\/metadata\//, 1_100]
];

export class T212Error extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "T212Error";
    this.status = details.status;
    this.code = details.code;
    this.retryAfterMs = details.retryAfterMs;
  }
}

export class T212Client {
  constructor({ apiKey, apiSecret, environment = "live", fetchImpl = fetch, minimumIntervalMs = null }) {
    if (!apiKey || !apiSecret) throw new T212Error("Trading 212 API credentials are missing.");
    this.auth = `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`;
    this.environment = environment === "demo" ? "demo" : "live";
    this.fetchImpl = fetchImpl;
    this.minimumIntervalMs = minimumIntervalMs;
    this.timeoutMs = 10_000;
    this.lastRequestAt = new Map();
  }

  async accountSummary() {
    return this.get("/equity/account/summary");
  }

  async cash() {
    return this.get("/equity/account/cash");
  }

  async positions() {
    return this.get("/equity/positions");
  }

  async pies() {
    return this.get("/equity/pies");
  }

  async pie(id) {
    return this.get(`/equity/pies/${encodeURIComponent(id)}`);
  }

  async orders({ limit = 50, cursor = null } = {}) {
    const query = new URLSearchParams({ limit: String(Math.min(Math.max(limit, 1), 50)) });
    if (cursor) {
      const url = this.resolve(cursor);
      url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 50)));
      const response = await this.request(url);
      return response;
    }
    return this.get(`/equity/history/orders?${query}`);
  }

  async transactions({ limit = 50, cursor = null } = {}) {
    if (cursor) {
      const url = this.resolve(cursor);
      url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 50)));
      return this.request(url);
    }
    return this.get(`/equity/history/transactions?${new URLSearchParams({
      limit: String(Math.min(Math.max(limit, 1), 50))
    })}`);
  }

  async get(pathname) {
    return this.request(this.resolve(pathname));
  }

  resolve(pathname) {
    const value = String(pathname);
    if (value.startsWith("http://") || value.startsWith("https://")) return new URL(value);
    if (value.startsWith("/api/")) return new URL(value, new URL(BASE_URLS[this.environment]).origin);
    return new URL(value.replace(/^\//, ""), `${BASE_URLS[this.environment]}/`);
  }

  async request(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    if (method !== "GET") {
      throw new T212Error("Vesper is read-only; Trading 212 write requests are disabled.");
    }
    url = new URL(url);
    const allowed = new URL(BASE_URLS[this.environment]);
    if (url.origin !== allowed.origin || url.username || url.password ||
        !url.pathname.startsWith(`${allowed.pathname}/`)) {
      throw new T212Error("Trading 212 request destination is not an allowed API endpoint.");
    }
    const now = Date.now();
    const throttleKey = `${method}:${url.origin}${url.pathname}`;
    const minimumIntervalMs = Number.isFinite(this.minimumIntervalMs)
      ? this.minimumIntervalMs
      : throttleIntervalMs(url.pathname);
    const previousRequestAt = this.lastRequestAt.get(throttleKey) || 0;
    const waitMs = Math.max(0, minimumIntervalMs - (now - previousRequestAt));
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.lastRequestAt.set(throttleKey, Date.now());

    let response;
    try {
      response = await this.fetchImpl(url, {
        ...options,
        method,
        redirect: "error",
        signal: options.signal || AbortSignal.timeout(this.timeoutMs),
        headers: {
          Authorization: this.auth,
          Accept: "application/json",
          ...(options.headers || {})
        }
      });
    } catch (error) {
      if (error?.name === "AbortError" || error?.name === "TimeoutError") {
        throw new T212Error(`Trading 212 API timed out after ${this.timeoutMs}ms.`);
      }
      throw error;
    }

    if (!response.ok) {
      const retryAfter = Number(response.headers.get("retry-after") || 0) * 1000;
      await response.body?.cancel().catch(() => {});
      throw new T212Error(`Trading 212 API returned HTTP ${response.status}.`, {
        status: response.status,
        retryAfterMs: retryAfter || undefined
      });
    }

    if (response.status === 204) return null;
    return response.json();
  }
}

export function throttleIntervalMs(pathname) {
  for (const [pattern, intervalMs] of THROTTLE_RULES) {
    if (pattern.test(pathname)) return intervalMs;
  }
  return 1_100;
}

export function normalizeOrderPage(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return {
    items: items.map((item) => item?.order ? { ...item.order, fill: item.fill } : item).filter(Boolean),
    nextPagePath: payload?.nextPagePath || null
  };
}

export function normalizeTransactionPage(payload) {
  return {
    items: Array.isArray(payload?.items) ? payload.items : [],
    nextPagePath: payload?.nextPagePath || null
  };
}
