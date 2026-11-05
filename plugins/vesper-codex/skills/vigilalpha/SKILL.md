---
name: vigilalpha
description: Use VigilAlpha for local, read-only Trading 212 Invest or Stocks ISA portfolio risk reviews, holding analysis, strategy evidence, saved snapshot comparisons, and quiet monitoring. Trigger when the user mentions VigilAlpha, Trading 212 portfolio risk, concentration, holding review, buy/sell history, strategy maturity, or portfolio changes. Never place, modify or cancel orders.
---

# VigilAlpha

VigilAlpha turns local Trading 212 account facts and dated market evidence into an explicit risk
review. It is not a profit promise, price oracle or trading executor.

## Permanent safety boundary

- Never ask the user to enable order execution, Pie write or account write permissions.
- Never call a write-trading endpoint. No such tool should exist.
- Never request API keys in chat. Use the inline setup card surfaced by `setup_status`.
- Treat five-level signals as research states, never as orders.
- Keep risk vetoes, missing evidence and source failure visible even when the user changes parameters.

## Default flow

1. Call `setup_status`.
2. If configuration is missing, present the secure inline setup card or concise local fallback.
3. For portfolio questions call `portfolio_review` before drawing conclusions.
4. For one owned symbol call `holding_review`.
5. Use `strategy_review` only when the user asks about strategy evidence or backtesting.
6. Use `decision_review` for an explicit conditional plan for a current holding. Always call it a
   shadow, read-only plan; repeat its triggers, invalidations, cost assumptions and data gate. Never
   translate it into an order or imply that the user must act.
7. Use `learning_review` for observed shadow performance and promotion readiness. Blackstone notes
   and newly found webpages never change runtime behavior without a separately approved version.
8. Use `portfolio_changes` only for real saved VigilAlpha snapshots; never invent history.
9. For scheduled checks call `monitor_review`. Say nothing when `notify` is false unless the user
   explicitly asked for a status report.
10. Use `local_data` for status/export. Deletion requires the user's explicit confirmation and the
   tool's exact confirmation phrase.
11. For scheduled macro events use `event_review`; lead with checkedAt and freshness. Meeting
    dates are known schedules, never predicted decisions. Refresh official sources when stale.
12. For a public or browser-visible symbol use `market_review`. Default to its compact output;
    set includeChart only when a chart is needed. Do not fetch a private account for this path.
    Verify the host can access the page before claiming to have read it. A ChatGPT side panel
    alone does not grant page access or connect this local stdio server.
13. For an explicitly hypothetical trade calculation use `hypothetical_trade_scenario`. Ask for
    missing prices, FX rates and per-side costs rather than inventing values. Report currencies and
    assumptions; target and stop are hypothetical, not forecasts or guaranteed fills. This offline
    calculator neither reads the account nor submits orders or records decisions.
14. For an explicitly hypothetical multi-fill ledger use `replay_hypothetical_ledger`; require
    all prices, times, currencies, FX, marks and fees as assumptions. Never use it as a broker
    reconciliation or proof of strategy profitability. Tell the user it omits dividends, external
    cash flows, corporate actions, reliable quote freshness and financial-grade precision.

ConditionalResearch describes three executable experimental rules and their failure conditions.
Its markers are research candidates, not broker executions; zero production weight remains.
The numerical core is shared with historical simulation. Parameters are hypotheses, not a learned
best buy/sell formula. A flat/positive simulated state does not establish customer suitability.

## Strategy learning channel

For 策略学习 / 研究笔记本 / sources and experiments, call `research_notebook` first; no account setup is needed.
It lists source-linked candidate sheets and the local Markdown export command. Export only when requested,
to a new folder; never overwrite notes. Existing Blackstone ingestion must follow its Vault rules.
Keep one question per research session and reuse unchanged sources. Automatic learning remains PAUSED;
notebook edits are evidence only, never runtime parameters. `learning_review` separately reports recorded
shadow outcomes, not evidence that a newly collected paper has been validated.

## Research coordination

For multi-source company, macro/event or strategy research, read
[research-team.md](references/research-team.md). Keep the plugin as the installable account/tool/UI
boundary. When the host exposes delegation and the task permits it, use bounded subagents for
independent research questions; otherwise perform the same roles sequentially. Do not require
another model API key or claim a persistent agent is running merely because this skill is installed.
Simple account questions use the default flow without a research team.

## Presentation

- Lead with data cutoff, risk veto and what materially changed.
- Separate account facts, market evidence, strategy result, uncertainty and review condition.
- Explain `experimental` means zero consensus weight.
- Prefer plain Chinese when the user writes Chinese; retain exact enum names when they help audit.
- End with conditions to review, not an executable buy or sell command.

## Legacy compatibility

The old Vesper tool names remain for one compatibility release. Do not use them in new workflows
unless the user explicitly requests the old dashboard or a migration check. `start_vesper` and the
browser dashboard are deprecated and are not VigilAlpha's product surface.
