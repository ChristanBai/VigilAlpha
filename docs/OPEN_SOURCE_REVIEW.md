# 开源与课程取舍记录

> 2026-11-03 更新：Ticker Research 的派生财务逻辑与 Kronos 固定版本模型核心已经接入本地 dev.18，并进行了真实输入实验。详见 [EXPERIMENT_INTEGRATION.md](EXPERIMENT_INTEGRATION.md)。以下 2026-11-02 记录保留为当时的取舍依据，不代表最新安装状态。

核查日期：2026-11-02。目标：保留 VigilAlpha 为产品根，复用成熟模块，保持闭源付费产品的分发选择。以下是本轮读取到的状态，不承诺后续版本许可不变。本轮没有安装这些项目、引入其代码或运行其模型；未证明速度提升。

| 对象 | 核查与判断 | 拟采用方式 | 当前决定 |
|---|---|---|---|
| [Ticker Research / ianlyoo](https://github.com/ianlyoo/ticker-research-mcp) | 找到的同名项目；README、MIT LICENSE、依赖清单与 SEC adapter 说明已读。只读 MCP，SEC 与非官方 yfinance 数据，财务/技术/情景工具 | 优先评估 SEC 财务适配、来源与时点字段、缺失值语义、紧凑输出；独立 Python 数据服务或移植适配器，保持主产品 Node 入口 | 优先评估，未安装。不能默认其分数/概率经过盈利校准；不把 yfinance 可下载当商业数据授权 |
| [Kronos](https://github.com/shiyu-coder/Kronos) | OHLCV 序列模型；仓库 MIT；已读论文与模型清单。论文投资模拟为 A 股 top-k/drop-n 组合，不是本账户验证；最大 large 模型未开放 | 独立实验适配器，固定 checkpoint、tokenizer、随机种子、采样参数、可用数据范围与训练截止；对比简单基准，并检查预测质量和扣费收益 | 实验候选，暂不作为产品默认交易依据；未下载权重、未运行。模型权重/数据/依赖另行核查授权 |
| [PageSift](https://github.com/YOLOW92/pagesift) | README 当前 0.81.5；Rust 抓取/正文提取，AGPL-3.0 与商业双许可；已读 LICENSE 与 COMMERCIAL.md | 仅内部独立评测可能有用；若嵌入闭源分发/客户服务，先明确许可路径。性能数字目前仅作者基准 | 暂不纳入依赖。当前主要阻塞是数据许可、账本行动与 Demo 接入；没有抓取性能瓶颈测量，安装不能解决这些问题 |
| [Microsoft Qlib](https://github.com/microsoft/qlib) | 量化研究框架，MIT；已读仓库介绍与 LICENSE | 后续独立对照回测和 ML 实验，检查数据时点、费用、交易约束与自有账本结果的一致性 | 作为对照框架候选，不更换产品根，不默认其示例数据可商业重分发 |
| [MITx 15.455x](https://learn.mit.edu/courses/course-v1%3AMITxT%2B15.455x) | 已读公开课程介绍/大纲：概率、统计、时间序列、优化、随机过程、Monte Carlo、R | 统计与计量→稳健性/样本外分析；优化→仓位约束；Monte Carlo→情景与压力测试；时间序列→模型比较 | 方法论学习资料。未登录、报名、完成课程或读取全部课件；不是现成盈利策略 |

## 可直接转成产品工作的部分

1. 财报适配：统一财报期、原始 filing accession、发布日期、获取时间、币种/单位，保留原始值与推导值；修订稿不能回填到当时未知的历史。
2. 公司关系证据：检索公司原始披露与供应商名单，提取直接/间接关系并链接上市实体；Ticker Research 的财务输出本身不是完整供应链数据库。
3. 研究接口：统一 `source / availableAt / unavailable reason`，减少重复数据和 token；网络请求留在适配层。
4. 模型对照：Kronos 的预测应先保存再揭晓结果，比较 naive/趋势模型，在训练截止之外做验证；不能拿漂亮的未来 K 线图当高置信价格路径。
5. 许可证与数据权利分开：MIT 代码可在保留所需声明条件下用于商业产品；数据、模型权重和第三方依赖并不因此自动获得相同权利。真正采用时固定提交、保留 NOTICE/LICENSE 并核查依赖。

## 采用前的具体验收

- Ticker Research：锁定提交；对其 SEC 财务选期、单位、修订、缺失值、超时与源时间做离线 fixture 对照；避免把整套 Python 服务和 OAuth 默默接入本地产品。当前尚未执行上游测试。
- Kronos：记录模型和训练数据范围，评估泄漏/幸存者偏差；使用未经选择的 Invest 可交易样本，计入 FX、滑点与费用，披露失败时期、资源和延迟。当前没有这些验证结果。
- PageSift：内部隔离对照同一份公开 HTML/PDF，检查正文遗漏、表格、时间、峰值内存和超时；不得访问私人券商页面或绕过网站限制。仅有代码许可并不授予被抓站点数据商业使用权。当前未运行此评测。
- Qlib：与自有确定性账本比较同一合成成交、同一费用、同一交易日和估值；不把回测引擎的默认成本套到 Trading 212。

## 原始证据

- [Ticker Research LICENSE](https://github.com/ianlyoo/ticker-research-mcp/blob/main/LICENSE)
- [Ticker Research SEC adapter 的实际覆盖与限制](https://github.com/ianlyoo/ticker-research-mcp/blob/main/ticker_engine/providers/sec/README.md)
- [Kronos 论文，尤其附录 D Investment Simulation](https://arxiv.org/html/2508.02739v1)
- [PageSift 商业授权说明](https://github.com/YOLOW92/pagesift/blob/main/docs/COMMERCIAL.md)
- [Qlib LICENSE](https://github.com/microsoft/qlib/blob/main/LICENSE)

本轮复用的是方法与接口设计，尚未复制任何上述项目的源代码。供应链模块、数据提供商与预测模型仍需分开落地和验收。
