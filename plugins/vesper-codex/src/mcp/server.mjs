import { createToolRuntime } from "./tools.mjs";
import { listInlineResources, readInlineResource, readVisualizationResource } from "../vigilalpha/inline-ui.mjs";
import { PRODUCT_VERSION } from "../version.mjs";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_VERSION = PRODUCT_VERSION;

export async function runStdioServer({ env = process.env } = {}) {
  const toolRuntime = createToolRuntime({ env });
  let buffer = "";

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let boundary = buffer.indexOf("\n");
    while (boundary >= 0) {
      const line = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 1);
      if (line) handleMessage(line, toolRuntime).catch((error) => {
        send({ jsonrpc: "2.0", id: null, error: { code: -32603, message: error.message } });
      });
      boundary = buffer.indexOf("\n");
    }
  });

  await new Promise((resolve) => process.stdin.on("end", resolve));
}

async function handleMessage(raw, toolRuntime) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }

  const { id, method, params = {} } = message;
  if (id === undefined) return;

  try {
    let result;
    switch (method) {
      case "initialize":
        result = {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
            logging: {}
          },
          serverInfo: {
            name: "vigilalpha",
            version: SERVER_VERSION
          },
          instructions: "VigilAlpha is local-first and strictly read-only. It cannot place, modify or cancel orders. Use setup_status first, then portfolio_review before holding conclusions. Never ask for or expose API secrets in model-visible text. Keep risk vetoes separate from research consensus, label data cutoffs and state that signals are not orders or guarantees. Legacy Vesper tools are deprecated compatibility interfaces for one release."
        };
        break;
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = { tools: toolRuntime.definitions };
        break;
      case "tools/call": {
        const name = params.name;
        const definition = toolRuntime.definitions.find((item) => item.name === name);
        if (!definition) throw new RpcError(-32602, `Unknown tool: ${name}`);
        const data = await toolRuntime.call(name, params.arguments || {});
        result = {
          structuredContent: data,
          content: [{
            type: "text",
            text: summarize(name, data)
          }]
        };
        break;
      }
      case "resources/list":
        result = {
          resources: [
            ...listInlineResources(),
            {
              uri: "vigilalpha://status",
              name: "VigilAlpha status",
              description: "Local VigilAlpha MCP status and setup instructions.",
              mimeType: "application/json"
            }
          ]
        };
        break;
      case "resources/read": {
        const inline = readInlineResource(params.uri) || readVisualizationResource(params.uri);
        if (inline) {
          result = { contents: [inline] };
          break;
        }
        if (params.uri !== "vigilalpha://status") throw new RpcError(-32602, "Unknown resource");
        result = { contents: [{ uri: "vigilalpha://status", mimeType: "application/json", text: JSON.stringify(await toolRuntime.call("setup_status", {}), null, 2) }] };
        break;
      }
      case "logging/setLevel":
        result = {};
        break;
      default:
        throw new RpcError(-32601, `Method not found: ${method}`);
    }
    send({ jsonrpc: "2.0", id, result });
  } catch (error) {
    send({
      jsonrpc: "2.0",
      id,
      error: {
        code: error.rpcCode || -32000,
        message: error.message
      }
    });
  }
}

function summarize(name, data) {
  if (name === "replay_hypothetical_ledger") return `Hypothetical ledger only (${data.baseCurrency}): NAV ${data.netAssetValue}; P&L ${data.netPnl}; no broker reconciliation, orders or validated strategy.`;
  if (name === "hypothetical_trade_scenario") return `Hypothetical scenario only (${data.baseCurrency}): target P&L ${data.profitAtTarget}; stop P&L ${data.profitAtStop}; no order, forecast or guaranteed execution.`;
  if (name === "research_notebook") return `VigilAlpha research notebook: ${data.candidates.length} candidate sheets; learning PAUSED; runtime import disabled. ${data.exportCommand}`;
  if (name === "setup_status") return `VigilAlpha ${data.configured ? "ready" : "needs setup"}; mode ${data.mode}; saved snapshots ${data.localData?.snapshotCount || 0}.`;
  if (name === "portfolio_review") return `VigilAlpha portfolio review at ${data.sourceCutoff || "unknown cutoff"}: ${data.summary?.totalValue ?? "unknown"} ${data.summary?.currency || ""}; signal ${data.signal}; risk veto ${data.riskVeto?.active ? "active" : "clear"}.`;
  if (name === "holding_review") return `${data.holding?.symbol || "Holding"}: ${data.signal}; risk veto ${data.riskVeto?.active ? "active" : "clear"}; consensus ${data.strategies?.consensus?.direction || "unavailable"}.`;
  if (name === "strategy_review") return `${data.symbol}: ${data.consensus?.direction || "NO_CONSENSUS"}; ${data.strategies?.length || 0} strategy modules; experimental strategies have zero weight.`;
  if (name === "decision_review") return `${data.holding?.symbol || "Holding"}: shadow action ${data.decision?.action || "WAIT"}; quantity ${data.decision?.quantity ?? 0}; execution authority none.`;
  if (name === "learning_review") return `Shadow learning: ${data.shadowDecisionCount || 0} decisions, ${data.evaluableDecisionCount || 0} evaluable; automatic promotion disabled.`;
  if (name === "portfolio_changes" || name === "monitor_review") return `Portfolio changes: ${data.status}; material change ${Boolean(data.materialChange)}.`;
  if (name === "local_data") return `Local data ${data.action || "status"}: ${data.deleted ? "deleted" : data.exported ? "exported" : `${data.snapshotCount || 0} snapshots`}.`;
  if (name === "configure_credentials") return `VigilAlpha configuration ${data.configured ? "verified and saved" : "not saved"}; mode ${data.mode}.`;
  if (name === "configure_preferences") return `VigilAlpha preferences ${data.updated ? "saved" : "not changed"}; ${data.reset ? "official defaults restored" : `${data.differences?.length || 0} differences from official defaults`}.`;
  if (name === "report") return data.markdown;
  if (name === "daily_brief") return data.markdown;
  if (name === "start_vesper") return `Vesper ${data.ready ? "ready" : "needs setup"}: ${data.positionCount} positions, ${data.orderCount} orders, order history ${data.orderHistoryStatus}. Dashboard: ${data.localUrl || data.url || "unavailable"}.`;
  if (name === "history") return `${data.symbol || "Symbol"} ${data.range || ""}: ${data.bars?.length || 0} bars from ${data.source || "unknown source"}; ${data.markers?.length || 0} execution markers.`;
  if (name === "quote") return `${data.symbol}: ${data.price} ${data.currency || ""} from ${data.source}; delay ${data.delayedByMinutes ?? "unknown"} minutes.`;
  if (name === "holdings") return `${data.positions?.length || 0} positions; reconciliation ${data.reconciliation?.status || "unknown"}; sync ${data.status || "unknown"}.`;
  return JSON.stringify(data, null, 2).slice(0, 12_000);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.rpcCode = code;
  }
}
