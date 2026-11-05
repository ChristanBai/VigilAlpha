# Offline validation — dev.18

The new Invest-specific monthly trend candidate and demo limitations are documented in
[INVEST_PRACTICE.md](INVEST_PRACTICE.md). Open-source and MITx research decisions are in
[OPEN_SOURCE_REVIEW.md](OPEN_SOURCE_REVIEW.md). These additions remain research components, not proof of investment effectiveness.

This prerelease provides account-export reconciliation and gated historical research. It does not place trades, establish profitability, or certify data licensing. Real forward validation remains outstanding.

From `plugins/vesper-codex`, run:

```bash
node scripts/reconcile-account.mjs /absolute/account-export.csv
node scripts/research-run.mjs /absolute/research-dataset.json
```

Both commands print JSON without persisting private inputs or reports. Keep account exports and outputs outside the repository. Monetary amounts in reconciliation are exact decimal strings with up to 12 decimal places. Optional opening balances are a second JSON file containing `openingCash` by currency and `openingHoldings` by ISIN. Absent opening balances mean period movements, not proven account balances. Compare against a broker snapshot at the same cutoff; transfers between account types are not automatically classified as external capital.

The research dataset requires:

| Field | Required meaning |
|---|---|
| `instrument` | `{scheme, id, namespace?}`; scheme is ISIN, FIGI or PERMANENT_VENDOR_ID; vendor ID needs namespace |
| `baseCurrency`, `quoteCurrency` | Explicit three-letter currency codes |
| `asOf`, `maxAgeMs` | Evaluation timestamp with timezone; explicit permitted final-bar age |
| `provenance` | `{provider, source, retrievedAt}` |
| `rights` | `{researchAllowed:true, evidence}`; evidence reference to actual permission, not an invented declaration |
| `adjustment` | `{priceBasis:"RAW", corporateActionsReviewed:true, hasCorporateActions:false}` |
| `fxProvenance` | For different currencies: `{provider, source, basePerQuote:true}` |
| `initialCash`, `costBps` | Positive starting cash and explicit per-side cost assumption, 0–9999.999 bps |
| `bars` | Chronological OHLCV and FX observations, described below |

Each bar has positive `open`, `high`, `low`, `close`, nonnegative `volume`, positive `openFx`, `closeFx`, and timezone-bearing `openTime`, `closeTime`, `availableAt`, `openFxAvailableAt`, `closeFxAvailableAt`. FX is base currency per unit of quote currency; same-currency rates must be one. A candle's availability must precede the next opening, and FX cannot become available after its valuation. Ticker alone is insufficient identity.

The current ledger cannot process corporate actions. Do not simply declare an actions-free window to bypass this limitation: verify it, or retain a BLOCKED result until corporate-action support is implemented. Source and rights assertions are not independently verified by the code.

`validate_research_dataset` exposes the same pipeline through MCP with `{dataset, initialCash, costBps}`. All three fixed rules are retained: SMA trend, RSI momentum and volume breakout. Insufficient history produces an abstention, missing metadata blocks all replay. Per-rule buy-and-hold starts at the same first eligible opening and uses the same fees, FX and terminal valuation. Different rules have different warmup periods, so their raw returns must not be ranked across windows. Cash assumes zero interest. Fees/spread/slippage must not be double counted; explicit cost assumptions are not verified brokerage charges.

Outputs include dataset hash, source checks, all results, benchmarks and limitations. Terminal holdings are marked, not liquidated; no sale costs are invented. A computed result remains `financialValidity: NOT_ESTABLISHED`, `executionAuthority: NONE`, `autoPromotion: false`.

Run `npm test` and `npm run check` before packaging. The archive is a development prerelease; it is not proof of licensed continuous data, prospective performance or broker execution readiness.

## Scenario cost extension / 2026-11-02

`hypothetical_trade_scenario` now accepts optional `entryFeeBps` and `exitFeeBps` (default 0,
nonnegative and below 10000). Rates apply to each side's base-currency gross value; fixed
`entryFeesBase` and `exitFeesBase` remain required and are additive. If a supplied fixed amount
already includes FX, do not also include it in bps. These are explicit assumptions, not a broker
fee lookup. Target and stop use different exit notionals but the same assumed exit FX.
The result exposes entry/target/stop fees and solves break-even including proportional sale fees.

Illustration only: entry notional 1000, target 1100, stop 900, unchanged FX of 1,
15 bps each side, no fixed charges -> target profit 96.85, stop loss 102.85,
break-even price 1003.00450676 for quantity 1. This excludes spread, slippage and other taxes.

The read-only broker client now restricts destinations to the selected live/demo HTTPS API
origin and `/api/v0/` path, rejects embedded credentials, and refuses redirects. Mock tests
cover hostile pagination URLs, cross-environment URLs, allowed pagination and write rejection.
This is a bounded security fix, not a complete security audit or evidence of an actual leak.
