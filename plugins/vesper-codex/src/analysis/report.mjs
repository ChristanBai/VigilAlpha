export function buildResearchReport({
  symbol,
  quote,
  history,
  analysis,
  news = [],
  backtest = null,
  generatedAt = new Date().toISOString()
}) {
  const lines = [
    `# Vesper Research Report: ${symbol}`,
    "",
    `Generated: ${generatedAt}`,
    "",
    "## Market Snapshot",
    "",
    `- Price: ${formatNumber(quote?.price)} ${quote?.currency || ""}`,
    `- Change: ${formatPercent(quote?.changePercent)}`,
    `- Data source: ${quote?.source || "Unavailable"}`,
    `- Update time: ${quote?.updatedAt || "Unavailable"}`,
    `- Reported delay: ${quote?.delayedByMinutes === 0 ? "streaming" : `${quote?.delayedByMinutes ?? "unknown"} minutes`}`,
    "",
    "## Technical Read",
    "",
    `- Trend: ${analysis?.indicators?.trend || "Unavailable"}`,
    `- RSI(14): ${formatNumber(analysis?.indicators?.rsi14)}`,
    `- SMA(20): ${formatNumber(analysis?.indicators?.sma20)}`,
    `- SMA(50): ${formatNumber(analysis?.indicators?.sma50)}`,
    `- Annualized volatility: ${formatPercent(analysis?.indicators?.annualizedVolatility)}`,
    `- Maximum drawdown: ${formatPercent(analysis?.indicators?.maxDrawdown)}`,
    `- Confidence: ${formatPercent(analysis?.confidence)}`,
    ""
  ];

  if (analysis?.signals?.length) {
    lines.push("### Signals", "");
    for (const signal of analysis.signals) lines.push(`- ${signal.level.toUpperCase()}: ${signal.text}`);
    lines.push("");
  }

  if (backtest) {
    lines.push(
      "## Backtest",
      "",
      `- ${backtest.disclaimer}`,
      `- Strategy: ${backtest.strategy}`,
      `- Total return: ${formatPercent(backtest.totalReturn)}`,
      `- Maximum drawdown: ${formatPercent(backtest.maxDrawdown)}`,
      `- Trades: ${backtest.tradeCount}`,
      `- Win rate: ${formatPercent(backtest.winRate)}`,
      ""
    );
  }

  if (news.length) {
    lines.push("## Headlines", "");
    for (const item of news) {
      lines.push(`- [${item.title}](${item.link}) — ${item.sentiment.label} (${item.publishedAt || "date unavailable"})`);
    }
    lines.push("");
  }

  lines.push(
    "## Data Notes",
    "",
    `- History source: ${history?.source || "Unavailable"}`,
    `- Bars: ${history?.bars?.length || 0}`,
    "",
    "## Disclaimer",
    "",
    "This report is for information and research only. It is not investment advice, does not guarantee returns, and does not replace a licensed advisor or independent judgement."
  );
  return lines.join("\n");
}

function formatNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "n/a";
}

function formatPercent(value) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(2)}%` : "n/a";
}
