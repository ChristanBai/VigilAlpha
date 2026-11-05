#!/usr/bin/env node
import { setTimeout as sleep } from "node:timers/promises";
import { calculateTradeReview } from "../src/runtime.mjs";
import { createRuntime } from "../src/runtime.mjs";
import { cloudPushUrl, pushCloudSnapshot } from "../src/core/cloud-transport.mjs";

const runtime = await createRuntime();
const cloudUrl = process.env.VESPER_CLOUD_URL || runtime.config.cloud.url;
const token = process.env.VESPER_DASHBOARD_TOKEN;
const intervalMs = Number(process.env.VESPER_SYNC_INTERVAL_MS || 60_000);
const once = process.argv.includes("--once");

if (runtime.config.cloud.syncEnabled === false && !process.env.VESPER_CLOUD_URL) {
  fail("Cloud sync is disabled. Enable it with the setup tool or VESPER_CLOUD_URL.");
}
if (!cloudUrl) fail("VESPER_CLOUD_URL is required.");
if (!token) fail("VESPER_DASHBOARD_TOKEN is required.");
let destination;
try {
  destination = cloudPushUrl(cloudUrl, { allowInsecureLoopback: process.env.VESPER_ALLOW_HTTP_LOOPBACK === "1" });
} catch (error) { fail(error.message); }

do {
  try {
    const snapshot = await runtime.snapshot({ force: true });
    const brief = await runtime.dailyBrief();
    const symbols = snapshot.positions.map((position) => position.symbol).slice(0, 12);
    const histories = {};
    const trades = {};
    for (const symbol of symbols) {
      try {
        const history = await runtime.history(symbol, "1Y");
        histories[`${symbol}:1Y`] = history;
        histories[symbol] = history;
      } catch (error) {
        histories[`${symbol}:1Y`] = { symbol, range: "1Y", bars: [], error: error.message };
      }
      trades[symbol] = calculateTradeReview(snapshot.orders, snapshot.positions, symbol);
    }

    const result = await pushCloudSnapshot(destination, token, {
        source: "local-keychain-proxy",
        snapshot,
        brief,
        histories,
        trades
    });
    console.log(`[${new Date().toISOString()}] pushed snapshot: ${result.pushedAt}`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] sync failed: ${error.message}`);
    if (once) process.exitCode = 1;
  }
  if (!once) await sleep(Math.max(15_000, intervalMs));
} while (!once);

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}
