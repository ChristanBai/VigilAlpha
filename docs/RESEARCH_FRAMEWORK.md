# Research framework / 投资研究框架

Checked / 核验日期: 2026-10-24. This is a candidate framework, not a validated investment model.
这是候选方法框架，不能将论文中的总体结果直接变成某只股票的盈利承诺。

## The decision process / 决策过程

Three technical rules describe price states; they do not determine valuation, suitability or position size.
三类技术规则只描述价格状态，不负责公司估值、客户适配或仓位预算。不同维度不可简单投票成为胜率。

| Layer / 层 | Inputs and decision / 输入与决策 | Current product / 当前状态 |
|---|---|---|
| Identity / 证券身份 | Exchange, currency, share class, corporate actions / 交易所、币种、类别、复权 | Input/provenance checks; cross-venue matching still needs acceptance / 部分实现 |
| Macro / 宏观 | Known schedule, expectations before release, actual surprise, sector channels / 排期、事前预期、公布意外、行业传导 | Dated official calendar implemented; surprise estimator absent / 日历已实现，意外模型未实现 |
| Business & value / 公司与估值 | Dated filings, cash flow, leverage, valuation scenarios / 财报、现金流、负债、估值情景 | Not a complete live fundamental model / 尚无完整实时基本面模型 |
| Long horizon / 长线 | 6–12 month relative or own returns, valuation and portfolio context / 中长期动量、估值、组合约束 | Candidate families; RSI is not academic momentum / 候选研究，不能与RSI等同 |
| Daily setup / 日线 | Completed daily trend, price/volume, invalidation / 已完成日线、价量、失效 | Three experimental shared-core rules; zero production weight / 三类已实现、生产权重零 |
| Implementation / 模拟执行 | Earliest next bar, gaps, spread, slippage, FX, costs / 下一根、跳空、价差、滑点、汇兑 | Existing historical simulation is limited; no broker execution / 模拟有限，不下单 |
| Portfolio / 仓位 | Liquidity, correlations, risk budget, current concentration / 流动性、相关性、预算、集中度 | Risk veto and conditional reduce plan; missing inputs abstain / 风险否决及条件减风险，缺失弃权 |
| Exit & review / 退出复核 | Thesis invalidation, rule exit, event change, time review / 逻辑失效、规则退出、事件变化、定期复核 | Candidate conditions visible; company thesis engine absent / 条件可见，公司逻辑引擎待建 |

Suggested cadence, not a fitted parameter / 建议工作频率，非优化参数：
company thesis after filings/material news; macro review before/after scheduled releases; daily rules
after completed sessions; monthly portfolio review. Intraday trading requires different data and validation.
财报与重大消息后复核公司，事件前后核对预期与事实，收盘后评价日线，每月复核组合。
周/月视图是上下文，不把同一价格序列的多个周期当成独立证据。

## Primary-source receipts / 原始来源记录

Six core sources below, plus one chronology extension. Reading depth is explicit; no full-text copies
are redistributed. 两篇 PDF 有限阅读摘要/方法，其余为出版机构摘要；不是全部精读或复现实验。

| Source / 来源 | Date and read depth / 日期与阅读深度 | Applicable lesson / 可用结论与限制 |
|---|---|---|
| [Lo, Mamaysky & Wang, Foundations of Technical Analysis](https://www.mit.edu/~wangj/pap/LoMamayskyWang00.pdf) | Journal of Finance, Aug 2000; abstract and opening methodology / 摘要与开篇方法 | Define patterns algorithmically and test conditional distributions; U.S. historical equities, not a net-return or single-stock timing guarantee / 算法化形态与条件分布，不是盈利保证 |
| [Moskowitz, Ooi & Pedersen, Time Series Momentum](https://www.aqr.com/Insights/Research/Journal-Article/Time-Series-Momentum) | May 2012; publisher summary / 出版摘要 | Own past returns across futures/forwards; not interchangeable with cross-sectional ranks or RSI14 / 跨资产期货证据不能直接迁移为单股RSI规则 |
| [Asness, Moskowitz & Pedersen, Value and Momentum Everywhere](https://www.aqr.com/insights/research/journal-article/value-and-momentum-everywhere) | Jun 2013; publisher summary / 出版摘要 | Valuation and momentum can provide distinct exposures; shared liquidity risks remain; not arbitrary equal voting / 估值与动量需分开，仍有共同风险 |
| [Daniel & Moskowitz, Momentum Crashes](https://www.nber.org/papers/w20439) | NBER 2014, JFE 2016; bibliographic/search abstract only, direct access 403 / 仅书目信息，正文未读 | Crash risk is a research question; this receipt does not establish a crash predictor / 不能据此声称已有崩盘预测。Corrects prior mistaken w20660 link / 更正错误编号 |
| [Bernanke & Kuttner, Stock Market Reaction to Fed Policy](https://www.newyorkfed.org/research/staff_reports/sr174.html) | Staff Report 174, 2003; official abstract / 官方摘要 | Study unexpected policy changes, not simply calendar dates or hike/cut labels / 关键是意外部分，不能把加息标签机械映射涨跌 |
| [Bailey et al., Probability of Backtest Overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf) | Revision Feb 27, 2015; abstract and introduction / 摘要及引言 | Track all attempted variants and selection risk; a good selected backtest is insufficient / 记录所有试验，避免挑赢家。PBO/CSCV is not currently implemented / 尚未实现 |
| [Hurst, Ooi & Pedersen, Century of Trend Following](https://www.aqr.com/Insights/Research/Journal-Article/A-Century-of-Evidence-on-Trend-Following-Investing) | Oct 31, 2017; publisher summary / 出版摘要 | Long historical cross-asset context; not direct validation of a Trading 212 stock / 长历史跨资产背景，不是本产品单股验证 |

## Promotion experiment / 下一步验证实验

1. Freeze a security universe, instrument identity and point-in-time data manifest, including delisted names.
   冻结证券池、身份与时点数据，保留退市样本；目前未完成。
2. Define one horizon and entry/exit protocol per rule before testing. Compare buy-and-hold, cash and
   simple trend baselines. Avoid substituting hypothetical short/futures implementation for a long-only account.
   先定义周期和进入退出，再与持有、现金和简单趋势比较；现货账户不照搬期货/做空结果。
3. Use time-ordered untouched windows and record every threshold attempt. Purge overlapping labels when
   needed; report turnover, drawdown, exposure, abstention, costs, FX and parameter sensitivity.
   时间顺序样本外验证，记录全部参数尝试及交易成本，不只报告命中率。
4. Model gaps and adverse fills; a stop level does not cap overnight loss. Keep volatility risk distinct
   from return prediction. 财报跳空与滑点可突破止损预算；低波动不等于上涨概率高。
5. Collect prospective shadow outcomes without rewriting old forecasts; retain human promotion and
   rollback. Existing minimum observation gates are necessary internal conditions, not proof of profit.
   前瞻影子观察不改历史预测，人工晋级与回滚仍保留。

No new numerical weights, production rules or trading permissions are activated by this document.
本文件不激活新权重、生产规则或交易权限。Current gaps: full fundamentals, valuation, volatility sizing,
cross-market licensing and real customer-host acceptance / 当前缺口：基本面、估值、波动预算、授权与真实宿主验收。


## Reproducible daily research / 可复核的每日研究

Documentation checked 2026-10-24: [Qlib](https://github.com/microsoft/qlib) documents a dataset/train/backtest/evaluate workflow and reports costs separately. [FinRL](https://github.com/AI4Finance-Foundation/FinRL) documents a train/test/trade pipeline and marks its tutorial as educational/research. These are workflow references, not replicated strategy evidence or installed integrations. Qlib text capture succeeded; FinRL raw/commit retrieval timed out, so only its official web-readable workflow was reviewed. Remote README images were not interpreted.

文档参考不等于收益复制。当前研究优先级是：日线趋势与突破的失败样本 → 震荡/均值回归候选 → 价量/波动状态 → 长线公司与估值 → 宏观事件的事前预期及实际意外。后面四层仍为研究候选，不是已部署买卖公式。多个相关指标不能当作独立证据票数。

Every experiment must freeze / 每次实验先冻结：

- ID/version, source/read depth, all variants attempted, universe/sector/liquidity coverage and exclusions.
- Data hash, available_at, venue/currency, corporate-action adjustment, daily interval and missing-data policy.
- Entry, exit, invalidation, abstention and earliest next executable bar; gap and adverse-fill treatment.
- Chronological train/validation/untouched test windows, overlap handling and preselected benchmarks.
- Spread, slippage, commission, FX and stated tax scope; uncertainty/sensitivity rather than zero-cost defaults.

拟采用指标，当前没有本产品实测基线或收益达标承诺：

| Metric / 指标 | Definition / 定义 | Guard / 限制 |
|---|---|---|
| Primary: net benchmark-relative return / 主指标：净超额收益 | Out-of-sample strategy net return minus matched benchmark net return / 同期间、币种、证券池与实施约束下净收益之差 | External cash flows handled separately; not hit rate / 外部入出金另处理，不以胜率代替收益 |
| Driver: evaluable coverage / 驱动：可评价覆盖 | Candidates with complete dated input/cost evidence divided by all eligible candidates / 完整时点及费用证据候选占比 | Keep abstentions and denominator; never hide missing cases / 保留弃权与分母 |
| Driver: prospective samples / 驱动：前瞻样本 | Eligible frozen shadow decisions with evaluable outcomes / 可评价的冻结影子决策数 | No rewriting forecasts or counting WAIT as successful prediction / 不改预测，不把WAIT当成功 |
| Guard: maximum drawdown / 护栏：最大回撤 | Largest peak-to-trough decline in after-cost equity / 成本后净值最大峰谷降幅 | Also report turnover, exposure and adverse cost scenarios / 同时报换手、暴露与不利成本情景 |
| Guard: evidence gaps / 护栏：证据缺失 | Missing point-in-time or cost inputs over required inputs / 必需时点或费用输入的缺失比例 | Missing evidence blocks promotion, not zero-valued inputs / 缺失阻止晋级，不填零 |

Refresh latency is a separate product metric: broker fill/publication to first successfully observed history result, measured only where those timestamps are available. Retrieval time alone cannot establish that latency. Current real post-fill latency is unmeasured.

研究角色可由有界子任务执行，数值计算复用本地代码；没有常驻多模型服务、自动训练或消耗剩余额度的循环。用户的 Blackstone 每日任务是本地可选流程，不是所有客户默认拥有的服务。候选金融规则仍需既有前瞻门禁与明确人工批准，软件测试不证明盈利。

## Physical learning channel / 实体学习渠道

As of 2026-10-25, `research_notebook` is an account-free entry point and
`node scripts/research-notebook.mjs export /absolute/path/to/new-notebook` creates four Markdown candidate sheets,
INDEX.md and a JSON snapshot. Existing directories are refused; there is no runtime import.
Use the sheets to freeze the hypothesis, data, trials, costs, baseline, counterevidence and decision.
NOT_RUN is not a failed or successful financial result. Source references are inherited candidates, not newly verified papers.

自动学习保持关闭；每次按需只研究一个问题、复用未变来源。Blackstone只按其流程收录脱敏来源和研究结果，
不直接把工作模板变成已验证知识或运行参数。公开版本不携带本机Vault、私有研究目录或账户记录。

## Reproducible evidence / 可复现证据

Use `node scripts/validate-research.mjs /absolute/public-history.json /absolute/new-report-directory`.
Input needs symbol, bars, retrievedAt and actual interval, with source URLs/currency provenance retained when supplied.
The command makes no network or account request and refuses an existing output directory. It records the input SHA-256,
all three fixed candidate results, cost assumptions, same-cost benchmark, continuous drawdown and abstentions.
Results are historical diagnostics, never automatic strategy approval. Plain summary files explicitly flag unknown dividends,
adjustment, point-in-time evidence, transaction costs and prospective validation.

首轮本地冻结研究保留9项日线结果与9项MAX周期不符弃权；不把月线改名为日线。历史回放不计入前瞻观察天数。

## Invest-only research candidate: monthly trend / 2026-11-02

Source checked: [Faber, author explanation](https://mebfaber.com/2016/09/14/episode-20-listener-qa/)
and [author's research update](https://mebfaber.com/2009/02/19/a-quantitative-approach-to-tactical-asset-allocation-updated/).
Read depth: author summaries; SSRN retrieval returned 403. No independent replication or licensed price data obtained.
The source describes monthly evaluation of a ten-month simple moving average. This is a new candidate,
not evidence for the existing daily SMA or RSI implementations.

Proposed adaptation (NOT_RUN, not activated): select a fixed eligible unlevered broad equity ETF by ISIN
before retrieving test results; use the latest ten completed monthly total-return observations;
above the ten-month mean -> hypothetical long, below or equal -> hypothetical cash. At least ten
completed months required. Evaluate only at month end; execute no earlier than the next regular-session
open after the signal data is available. Unchanged position -> no turnover. Equality-to-cash and
next-session execution are our explicit choices, not claims about exact paper replication.

Require unadjusted execution prices, dividends/corporate actions and point-in-time signal series; never
execute at a retrospectively adjusted price. The current action-free replay cannot validate this
multi-year design until dividend/action support exists. Do not rename monthly observations as daily.
Compare with the same ETF buy-and-hold over identical dates, initial cash, FX and fees. State cash-interest
assumptions separately; zero-interest cash and broker-interest cash are distinct variants. Freeze
chronological untouched test dates and instrument before evaluation; record all attempted variants.
Report net return, benchmark difference, drawdown, turnover, exposure, losing periods and cost sensitivity.
Sideways whipsaws, delayed re-entry and missing sharp rebounds are explicit counter-hypotheses.
No return threshold, risk tolerance or real allocation is inferred from this candidate.

## Broker evidence / checked 2026-11-02

- [Invest fees](https://helpcentre.trading212.com/hc/en-us/articles/11471996799517-What-are-the-fees-in-the-Invest-ISAs-and-SIPP): FX 0.15%, commission/custody zero; applicable taxes and other charges remain separate.
- [Currency selection](https://helpcentre.trading212.com/hc/en-us/articles/34159237080861-Can-I-choose-the-currency-in-which-to-buy-sell-assets-for-Invest-accounts): asset-currency direct trades avoid trade conversion; Pies use primary currency, so foreign-currency assets still convert. Initial conversion is not free.
- [UK Invest terms](https://www.trading212.com/legal-documentation/uk/invest/Invest-Terms_EN.pdf), clause 5.1: restricts Algorithmic Trading and specified commercial services. This is UK documentation, not confirmation of this user's contracting entity.
- [Official API documentation](https://docs.trading212.com/api/accounts) describes order endpoints and primary-currency execution. Technical endpoint availability does not resolve contractual permission. Keep execution disabled; entity/terms applicability and commercial distribution rights remain unverified.

## Recorded product preferences / 2026-11-02

Confirmed: prioritize Trading 212 Invest over CFD, investment research and after-cost verification;
retain the existing VigilAlpha code root; protect core source from public publication; report progress
in conversation without a separate project board; no real orders or account-setting changes.
Long-term investing is a recorded research orientation, not a numeric holding-period commitment.
Exact horizon, acceptable drawdown, capital budget and risk tolerance remain unspecified. Low-turnover
monthly trend is a proposed research choice, not a user-approved live strategy. Do not promise profits
or absolute security. GitHub publishing remains paused.
