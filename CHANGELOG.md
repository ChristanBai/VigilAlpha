# Changelog

## 0.1.0-dev.18 — 2026-11-06

- Port sourced annual gross-profit/free-cash-flow calculations with filing-time and period checks.
- Add optional pinned local Kronos model inference through MCP; no broker writes or automatic downloads.
- Preserve exploratory four-window historical results and data-quality blockers; no profitability claim.
- Include experiment instructions and third-party licenses; model weights and private research inputs remain outside the package.
- Align package, plugin, MCP server and setup-status versions through one checked runtime constant.
- Add a checksum-verifying macOS installer and publish the complete research components in the release archive.
- Make the installer replace an older local `vigilalpha` marketplace source and restore it if the remaining update fails.

## 0.1.0-dev.17 — 2026-11-02 (local candidate)

- Add read-only Trading 212 CSV reconstruction using decimal arithmetic, separate currencies, ISIN holdings, dividend shares and explicit reconciliation gaps.
- Gate research datasets on declared stable identity, provenance, rights, OHLCV/FX timing and corporate-action policy; declarations are not independently verified.
- Run all three fixed strategies through the signal ledger with per-rule same-window, same-cost buy-and-hold and cash comparisons; preserve abstentions and losses.
- Expose the gated runner through MCP and local CLI. No execution or automatic strategy promotion; profitability remains unestablished.
- Includes prior local candidate work on hypothetical scenarios, frozen research plans, cloud authentication and HTTPS-only synchronization defaults.
- Local candidate only: Mac installation, continuous licensed data and prospective validation remain outstanding. GitHub publication is paused.

## 0.1.0-dev.16 — 2026-10-25

### 中文

- 修复历史验证的分段现金重置与整体回撤口径，主结果使用连续测试路径；分段仅作独立诊断。
- 基准采用同费用与期末估值口径；拒绝无效/重复/乱序价格和费用，排除当前及未来日期。
- 新增离线研究报告命令，固定输入哈希、来源与时间、全部候选正负结果和弃权，不自动晋级。
- 金融有效性尚未建立，实验权重保持零，自动学习继续关闭。

### English

- Measure headline historical validation continuously instead of stitching reset folds; keep folds diagnostic.
- Compare against a same-cost, same-mark-to-market baseline and reject invalid chronology, OHLC or costs; exclude incomplete/future dates.
- Add an offline evidence report command retaining dataset hashes, provenance, all candidate outcomes and abstentions. No automatic financial promotion.
- Financial validity remains unestablished and idle learning remains paused.


## 0.1.0-dev.15 — 2026-10-25

### 中文

- GitHub名称统一为VigilAlpha，旧名技能转向当前入口，不再默认启动旧仪表盘。
- 新增无账户研究笔记本及本地Markdown导出：4张候选单、来源、实验/反证/费用/基准和人工决定。结果未运行，不自动金融晋级。
- 自动学习保持PAUSED，只读和凭据边界不变。

### English

- Unify GitHub branding as VigilAlpha; route legacy names through the current skill.
- Add an account-free research notebook and non-overwriting Markdown export with four candidate sheets and explicit evidence gaps. No runtime import or automatic promotion.
- Automatic learning remains PAUSED; existing read-only and credential boundaries remain.


## 0.1.0-dev.14 — 2026-10-24

### 中文

- 单股 K 线／折线与账户暴露桑基图同页共存，保留组合配置总览；支持手动系统／浅色／深色主题及本地偏好。
- 修复 force/full 刷新被缓存TTL和较弱请求吞掉的问题；成交历史限流仍遵守，分别披露持仓与历史读取时间。新增只读刷新按钮，失败不改写旧图或时间。
- 未知成本与市值保持缺失；不将未知权重画成零。桑基图表示账户暴露，不推断公司营收或资金流。
- 研究文档补充 Qlib/FinRL 工作流参考、冻结实验清单、净成本后基准超额收益与回撤/覆盖定义；未激活新策略，未安装外部研究框架。
- 当前仍为按需快照，不是自动实时成交订阅；真实券商成交后和新宿主路径仍待验收。

### English

- Keep candle/line charts and holding account-exposure ribbons together, retain portfolio allocation, and add explicit System/Light/Dark preferences.
- Make force/full refresh bypass section TTLs and escalate weaker in-flight requests while honoring history backoff. Disclose successful retrieval times separately; read-only App refresh preserves old facts on failure.
- Preserve missing cost/value evidence rather than turning it into zero. Ribbons represent exposure, not inferred company revenues or cash flows.
- Document Qlib/FinRL workflow references, frozen experiment manifests and after-cost benchmark/drawdown/coverage definitions. No new strategy or external framework is activated.
- On-demand snapshots remain distinct from automatic trade subscriptions; real post-fill and new-host acceptance are open.

## 0.1.0-dev.13 — 2026-10-24

### 中文

- 图表优先工作台：浅深系统主题、K线/折线切换、日线窗口、成交/成本/实验候选独立开关，证据按需展开。
- 桑基式配置暴露图，明确不是现金流；真实成交按同一 UTC 日期匹配，不移动到下一根 K 线。
- 单股研究联动有核验日期的官方事件背景；结果未知、过期需刷新，不生成预测。
- 中英文产品说明、实际合成界面截图、学术/商业原始来源框架与可独立启动的合成预览。
- 更正 Momentum Crashes 原始论文编号；三类规则仍属实验，未激活新生产策略。
- 完整 Chrome/ChatGPT 侧栏、新版本真实宿主挂载及账户网页对账仍未验收；不是成熟正式版。

### English

- Replace stacked visual cards with a chart-first workspace, adaptive light/dark appearance,
  candle/line and daily-window controls, independent fill/cost/research toggles and disclosure sections.
- Show allocation exposure as ribbons, never cash flow; match intraday fills to the same UTC date.
- Join dated official event context to holding/public-symbol research without predicting outcomes.
- Add Chinese/English introductions, actual synthetic UI imagery, primary-source research framework
  and account-free local preview. Correct the Momentum Crashes paper reference.
- Experimental rules retain zero production weight. Full browser/sidebar integration, current-host
  mounting and broker reconciliation remain open, separate from downloadable software publication.

## 0.1.0-dev.12 — 2026-10-24

- Add an official-schedule snapshot tool with future-event windows, time zones, source dates,
  freshness limits and conditional transmission scenarios; it does not forecast event results.
- Show explicit experimental entry, exit and invalidation conditions from the same numerical
  rules used in historical simulation, with an original synthetic explanatory chart.
- Add compact public-symbol research without an account refresh; opt into chart bars when needed.
- Preserve missing tradable quantities and expose field-specific abstention instead of guessing
  that all owned shares are available to trade.
- Browser symbols require an authorized host or user input. Chrome-to-ChatGPT-side-panel access,
  broker-page reconciliation and production strategy effectiveness remain unaccepted.

## 0.1.0-dev.11 — 2026-10-23

- Require identified daily bars for VigilAlpha strategy, holding, decision and learning reviews;
  preserve MAX daily history and reject a provider's non-daily interval.
- Record reference-price currency and require matching provider-confirmed currencies for shadow
  outcomes. Missing, inferred or cross-currency evidence abstains without estimating FX.
- Exclude WAIT, failed decisions and legacy unverified outcomes from promotion counts while
  preserving historical records. Automatic strategy promotion remains disabled.
- Add focused regression coverage and prepare a local development candidate; no GitHub Release,
  production directional strategy promotion or new account execution capability is included.

## 0.1.0-dev.10 — 2026-10-09

- Hardened Trading 212 failures so upstream response bodies cannot enter user-visible errors or
  local cache diagnostics.
- Enforced owner-only permissions on existing VigilAlpha state directories.
- Corrected CI naming and trigger paths and added installable ZIP/checksum generation.
- Replaced the mixed Vesper/VigilAlpha public README, security policy and release checklist with a
  single truthful development-release boundary.

## 0.1.0-dev.9 — 2026-10-09

- Added the inline Keychain-backed setup card and post-save setup-status refresh.
- Added VigilAlpha review, decision, learning and local-data interfaces while retaining legacy
  Vesper tools for one compatibility release.
