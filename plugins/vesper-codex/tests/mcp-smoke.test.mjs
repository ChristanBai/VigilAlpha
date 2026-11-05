import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCT_VERSION } from "../src/version.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("MCP stdio server initializes and advertises VigilAlpha plus legacy tools", async (t) => {
  const state = await mkdtemp(path.join(os.tmpdir(), "vesper-mcp-"));
  const child = spawn(process.execPath, ["scripts/vesper-mcp.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      VESPER_STATE_DIR: state,
      T212_API_KEY: "",
      T212_API_SECRET: "",
      FINNHUB_API_KEY: "",
      VESPER_DISABLE_KEYCHAIN: "1"
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  t.after(() => {
    if (!child.killed) child.kill("SIGKILL");
  });
  const responses = new Map();
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let boundary = buffer.indexOf("\n");
    while (boundary >= 0) {
      const line = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 1);
      if (line) {
        const message = JSON.parse(line);
        if (message.id !== undefined) responses.set(message.id, message);
      }
      boundary = buffer.indexOf("\n");
    }
  });

  write(child, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } }
  });
  const initialized = await waitFor(responses, 1);
  assert.equal(initialized.result.serverInfo.name, "vigilalpha");
  assert.equal(initialized.result.serverInfo.version, PRODUCT_VERSION);
  assert.match(initialized.result.instructions, /read-only/i);
  assert.match(initialized.result.instructions, /cannot place/i);

  write(child, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const tools = await waitFor(responses, 2);
  const names = tools.result.tools.map((tool) => tool.name);
  assert.ok(names.includes("replay_hypothetical_ledger"));
  const buy = { id: "buy", instrumentId: "XYZ", quoteCurrency: "USD", side: "BUY", quantity: 1, price: 100, basePerQuote: 0.8, feesBase: 0.12, signalTime: "2026-01-01T16:00:00Z", fillTime: "2026-01-02T14:30:00Z" };
  const sale = { ...buy, id: "sale", side: "SELL", price: 110, basePerQuote: 1 / 1.375, signalTime: "2026-01-03T16:00:00Z", fillTime: "2026-01-04T14:30:00Z" };
  write(child, { jsonrpc: "2.0", id: 33, method: "tools/call", params: { name: "replay_hypothetical_ledger", arguments: { baseCurrency: "GBP", initialCash: 100, fills: [buy, sale], marks: [] } } });
  const ledger = (await waitFor(responses, 33)).result.structuredContent;
  assert.ok(Math.abs(ledger.netPnl + 0.24) < 1e-9);
  assert.equal(ledger.executionAuthority, "NONE");
  assert.equal(ledger.verification, "UNVALIDATED_ASSUMPTIONS_ONLY");
  write(child, { jsonrpc: "2.0", id: 34, method: "tools/call", params: { name: "replay_hypothetical_ledger", arguments: { baseCurrency: "GBP", initialCash: 100, fills: [buy, { ...sale, quoteCurrency: "GBP" }], marks: [] } } });
  assert.match((await waitFor(responses, 34)).error.message, /Same-currency|Inconsistent/);
  assert.ok(names.includes("prepare_forward_research_plan"));
  assert.ok(names.includes("check_research_observation"));
  const plan = { frozenAt: "2026-11-01T12:00:00Z", startsAt: "2026-11-02T00:00:00Z", instrumentId: "EXAMPLE:US", quoteCurrency: "USD", baseCurrency: "GBP", dataSource: "example", adjustmentPolicy: "unverified", costs: { commissionBps: 0, spreadAndSlippageBps: 10, fxFeeBps: 15, taxesBps: 0, fxApplied: true } };
  write(child, { jsonrpc: "2.0", id: 31, method: "tools/call", params: { name: "prepare_forward_research_plan", arguments: plan } });
  const planned = (await waitFor(responses, 31)).result.structuredContent;
  assert.equal(planned.spec.status, "PLAN_ONLY");
  assert.equal(planned.spec.liveTradingAuthorized, false);
  assert.match(planned.sha256, /^[0-9a-f]{64}$/);
  write(child, { jsonrpc: "2.0", id: 32, method: "tools/call", params: { name: "check_research_observation", arguments: { frozenAt: plan.frozenAt, startsAt: plan.startsAt, observationAt: "2026-11-02T12:00:00Z", availableAt: "2026-11-03T12:00:00Z", signalAt: "2026-11-02T16:00:00Z" } } });
  assert.equal((await waitFor(responses, 32)).result.structuredContent.allowed, false);
  assert.ok(names.includes("hypothetical_trade_scenario"));
  const scenario = { baseCurrency: "GBP", quoteCurrency: "USD", quantity: 1, entryPrice: 100, targetPrice: 110, stopPrice: 90, entryBasePerQuote: 0.8, exitBasePerQuote: 0.8, entryFeesBase: 0.12, exitFeesBase: 0.132 };
  write(child, { jsonrpc: "2.0", id: 28, method: "tools/call", params: { name: "hypothetical_trade_scenario", arguments: scenario } });
  const result = await waitFor(responses, 28);
  assert.ok(Math.abs(result.result.structuredContent.profitAtTarget - 7.748) < 1e-9);
  assert.equal(result.result.structuredContent.executionAuthority, "NONE");
  assert.equal(result.result.structuredContent.status, "HYPOTHETICAL_NOT_A_FORECAST");
  assert.equal(result.result.structuredContent.baseCurrency, "GBP");
  write(child, { jsonrpc: "2.0", id: 29, method: "tools/call", params: { name: "hypothetical_trade_scenario", arguments: { ...scenario, exitBasePerQuote: null } } });
  assert.match((await waitFor(responses, 29)).error.message, /requires/);
  write(child, { jsonrpc: "2.0", id: 30, method: "tools/call", params: { name: "hypothetical_trade_scenario", arguments: { ...scenario, quoteCurrency: "GBP" } } });
  assert.match((await waitFor(responses, 30)).error.message, /Same-currency/);
  assert.ok(names.includes("research_notebook"));
  write(child, { jsonrpc: "2.0", id: 27, method: "tools/call", params: { name: "research_notebook", arguments: {} } });
  const notebook = await waitFor(responses, 27);
  assert.equal(notebook.result.structuredContent.runtimeImport, false);
  assert.equal(notebook.result.structuredContent.automaticLearning, "PAUSED");
  assert.equal(notebook.result.structuredContent.candidates.length, 4);
  for (const required of ["setup_status", "portfolio_review", "holding_review", "strategy_review", "decision_review", "learning_review", "portfolio_changes", "monitor_review", "local_data", "configure_credentials", "configure_preferences"]) {
    assert.ok(names.includes(required), `missing ${required}`);
  }
  for (const required of ["setup", "start_vesper", "holdings", "pies", "trades", "quote", "history", "dashboard", "news", "analysis", "backtest", "report", "daily_brief", "order_history"]) {
    assert.ok(names.includes(required), `missing ${required}`);
  }
  const credentialTool = tools.result.tools.find((tool) => tool.name === "configure_credentials");
  assert.deepEqual(credentialTool._meta.ui.visibility, ["app"]);
  const preferencesTool = tools.result.tools.find((tool) => tool.name === "configure_preferences");
  assert.deepEqual(preferencesTool._meta.ui.visibility, ["app"]);

  write(child, { jsonrpc: "2.0", id: 21, method: "resources/list", params: {} });
  const resources = await waitFor(responses, 21);
  const resourceUris = resources.result.resources.map((resource) => resource.uri);
  for (const uri of ["ui://vigilalpha/setup.html", "ui://vigilalpha/portfolio-flow.html", "ui://vigilalpha/holding-chart.html", "ui://vigilalpha/risk-timeline.html"]) {
    assert.ok(resourceUris.includes(uri), `missing resource ${uri}`);
  }
  write(child, { jsonrpc: "2.0", id: 22, method: "resources/read", params: { uri: "ui://vigilalpha/setup.html" } });
  const setupUi = await waitFor(responses, 22);
  assert.match(setupUi.result.contents[0].mimeType, /mcp-app/);
  assert.match(setupUi.result.contents[0].text, /configure_credentials/);
  assert.match(setupUi.result.contents[0].text, /configure_preferences/);
  assert.match(setupUi.result.contents[0].text, /恢复官方默认值/);
  for (const [id, uri] of [[24, "ui://vigilalpha/portfolio-flow.html"], [25, "ui://vigilalpha/holding-chart.html"], [26, "ui://vigilalpha/risk-timeline.html"]]) {
    write(child, { jsonrpc: "2.0", id, method: "resources/read", params: { uri } });
    const visual = await waitFor(responses, id);
    assert.match(visual.result.contents[0].text, /<table|risk-timeline|chart-shell/);
    assert.doesNotMatch(visual.result.contents[0].text, /(?:src|href)=["']https?:|fetch\(["']https?:/);
  }

  write(child, { jsonrpc: "2.0", id: 23, method: "tools/call", params: { name: "setup_status", arguments: {} } });
  const setupStatus = await waitFor(responses, 23);
  assert.equal(setupStatus.result.structuredContent.product, "VigilAlpha");
  assert.equal(setupStatus.result.structuredContent.version, PRODUCT_VERSION);
  assert.equal(setupStatus.result.structuredContent.configured, false);
  assert.equal(setupStatus.result.structuredContent.mode, "read-only");
  assert.equal(setupStatus.result.structuredContent.preferences.parameterValidation, "official_default");
  for (const forbidden of ["order_preview", "order_place", "order_cancel"]) {
    assert.ok(!names.includes(forbidden), `unexpected write tool ${forbidden}`);
  }

  write(child, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "setup", arguments: {} } });
  const setup = await waitFor(responses, 3);
  assert.equal(setup.result.structuredContent.credentials.configured, false);
  assert.match(setup.result.structuredContent.instructions, /setup.mjs/);

  write(child, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "start_vesper", arguments: { port: 18989 } } });
  const started = await waitFor(responses, 4);
  assert.equal(started.result.structuredContent.ready, false);
  assert.equal(started.result.structuredContent.credentialSource, "missing");
  assert.match(started.result.structuredContent.instructions, /macOS Keychain/);

  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
});

function write(child, message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

async function waitFor(responses, id, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (responses.has(id)) return responses.get(id);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for MCP response ${id}`);
}
