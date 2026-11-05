# VigilAlpha Invest 模拟验证方案

初始核查日期：2026-11-02（Asia/Shanghai）；dev.18 发布前复核：2026-11-06。当前插件仍为只读，Practice 页面核验与插件安装、算法历史验证分别记录。

## 用户入口与本轮状态

Trading 212：☰ / More → Switch to practice → 选择 Invest，并核对页面显示 Practice。首次保存虚拟资金、持仓、币种与时间；测试开始后不要重置账户掩盖损失。无需先投入真钱。

官方提供 Invest / Stocks ISA Demo API；本产品当前券商客户端仍只读。本轮没有新增券商写接口、设置 API Key、创建模拟订单或启动定时任务。Demo API 存在不代表所有算法或商业用途均获准；UK Invest 条款 5.1 仍有相关限制，应核实实际开户实体和适用条款后再启用程序化下单。

模拟账户不处理现金分红、配股、分拆、收购等全部公司行动，不能直接当作真实总回报账本。将来需要两份记录：券商模拟成交记录，以及含费用、分红与公司行动的研究账本；二者差异必须解释。

## 候选 A：月度趋势过滤 v1

| 项目 | 冻结规则 |
|---|---|
| 目的 | 检验扣费后盈利且优于同一资产买入持有；同时查看回撤 |
| 标的 | 预先确定一只可在该账户 Invest 买入的非杠杆宽基股票 ETF；记录 ISIN、交易所、报价币种与 212 instrument ID。初期优先核查累积型产品，但不预设其没有拆股等行动 |
| 账户与资金 | 独立虚拟研究份额；买入或持有现金，不做空、不融资。不代表用户真实账户应满仓一只产品 |
| 信号 | 交易所日历确认的每月最后一个交易日收盘后，计算最近 10 个完整月末收盘价的简单平均，包括当前月 |
| 买入/持有 | 月末收盘价严格大于该均值 |
| 退出/现金 | 月末收盘价小于或等于该均值 |
| 执行 | 信号已经可用后的下一正常交易日开盘；缺价格、汇率或日历则阻断；不假设同一收盘价既产生信号又成交 |
| 调整 | 每月一次；已经处于目标状态不重复交易；不根据本轮盈亏修改参数 |
| 成本 | 显式填写每边综合成本，覆盖适用佣金、换汇、价差、滑点和税费；不得把已在成交价格或金额内的成本重复扣除 |
| 基准 | 同一 ETF、同起止时间、同币种与汇率、同费用、同现金流；当前无额外资金流，现金利息取零 |
| 期末 | 按市值估值，不强行卖出；策略与基准都不虚构期末卖出费用 |
| 敏感性 | 将每边成本翻倍重新计算；保留两份完整结果 |

来源思路：Faber 的 10 个月趋势规则。原文包含信号日收盘成交假设，本项目改用下一交易日开盘，且不复制论文收益数字。此规则是一个可解释的比较对象，不是已证明最优的策略。

候选 B（尚未实现）：固定可交易股票池上的低换手 12–1 月相对动量，加入行业/单股集中度上限。需要历史成分、退市、分红、财务披露时间和组合账本，不能用今天的幸存股票倒推过去。公司质量与估值的门槛将在取得可靠财报后冻结。原 RSI 与放量突破继续留在实验区。

## 通过、淘汰、等待是什么意思

这是研究筛选流程，不是胜率保证。先定目标和门槛，再看结果。

| 状态 | 含义与动作 |
|---|---|
| 等待证据 | 来源、许可、行情、完整日历、公司行动或费用不足；或不足 36 个完整评估月。保留原因，不把未知记成 0，不判盈利 |
| 当前目标下淘汰 | 足够长度的该次历史检验中，净收益不为正、未优于同口径买入持有、日终最大回撤超过研究阈值 20%，或费用翻倍后失去净收益/基准优势之一。保留失败结果 |
| 历史初筛通过 | 通过上述数值门槛，只获得独立复核资格；还需确认测试数据未参与选标的/调参、市场阶段覆盖和结果稳健性，再做前瞻模拟 |
| 前瞻继续观察 | 信号与规则预先记录，之后才记录行情和成交；允许因样本太少继续等待。几笔盈利、几个月上涨不构成稳定盈利证据 |

36 个月、20% 为本轮预先设定的工程筛选默认值，不是统计显著性保证，也不是用户认可的真钱风险预算。20% 是研究复核门槛，不是保证能在 20% 以内成交的止损指令。先运行 20 个交易日可检查连接与对账，但月度规则可能一笔也不交易；无交易不等于故障，不人为提高频率制造样本。

## 已实现的可复现入口

从 `plugins/vesper-codex` 执行：

```bash
node scripts/invest-research.mjs /absolute/path/dataset.json
node --test tests/invest-candidate.test.mjs
npm test
npm run check
```

MCP 工具：`validate_invest_candidate({dataset, initialCash, costBps, evaluationStart})`。本地纯计算，无账户配置和网络请求。CLI 从 dataset 顶层取同名参数；JSON 输出不自动写入私人账户数据。

数据保留 [RESEARCH_VALIDATION.md](RESEARCH_VALIDATION.md) 的完整 OHLCV、FX、身份、来源、许可、时间戳和公司行动要求，另需：

```json
{
  "initialCash": 1000,
  "costBps": 25,
  "evaluationStart": "<预先固定的下一正常交易日开盘 ISO 时间>",
  "eligibility": {
    "accountType": "INVEST",
    "instrumentType": "ETF",
    "leveraged": false,
    "broadEquity": true,
    "trading212Available": true,
    "source": "<真实核验记录>",
    "checkedAt": "<ISO 时间>"
  },
  "calendar": {
    "source": "<交易所日历来源>",
    "timeZone": "Europe/London",
    "sessionsReviewed": true,
    "monthEndCloses": ["<按顺序列出所有完整月末收盘 ISO 时间>"]
  }
}
```

这只是附加字段示意，不是可以执行的真实数据。25 bps 不是券商报价。每边 FX 15 bps 只适用于发生换汇的交易；同币种交易不应无条件加上换汇费。API 当前仅支持账户主币种执行，这与 app 的多币种手动交易不同。

`evaluationStart` 必须是第 10 个或更晚的已核验月末之后的第一条正常交易时段开盘记录。历史数据检验当前可交易性，不等于证明过去也可交易。历史测试的标的选择偏差、数据来源与日历完整性仍需人工/外部证据复核。

输出包含数据和配置 SHA-256、信号、逐笔假设成交、净值、费用、回撤、基准、双倍成本情景与筛选理由。哈希能识别内容变更，不能证明第三方时间戳或记录未被重写。

**现阶段最大阻塞：** 账本还不支持分红与其他公司行动。存在行动或没有核验行动的窗口必须阻断，不能缩短历史、删除分红日或写一个 false 来绕过。尚无合格真实数据输入，真实收益报告状态仍为 `WAIT_FOR_EVIDENCE`。

## 供应链研究：Apple / SpaceX 等自然语言问题

这是另一条有价值的产品入口：公司/主题 → 有证据的上下游 → 上市主体 → 212 可交易性 → 财务暴露与估值 → 候选观察单。

每条关系保存：目标公司、供应商或客户法律名称、上市母公司、关系类型（直接/间接/分销/传闻）、产品/工厂、原始公告或供应商名单、发布日期、实际可用时间、最后核验日期、收入依赖比例（未披露则未知）、交易所/ISIN/报价币种、212 instrument ID、Demo/Live 与地区可用性、核验时间、反证。

不能把“参与同一行业”写成供应关系；不能把母公司上市当作工厂独立上市；不能把普通网页出现 ticker 当作账户内可买。关系图回答谁与谁有关，投资判断还需收入重要性、利润、估值和风险。本轮没有对 Apple / SpaceX 具体公司清单作出事实断言，功能尚待接入官方披露和 broker instrument catalogue。

## 下一步的依赖顺序

1. 保存 Invest Practice 初始快照，识别实际账户实体、币种与 Demo 支持；不重置已有历史。
2. 取得有研究使用权的连续行情、汇率、交易日历与公司行动；补完账本行动处理。此项优先于复杂预测模型。
3. 冻结精确证券身份、候选规则、起点、费用和比较目标，保留未参与调参的测试区间；运行内部报告。
4. 接入 Demo 只读同步和可持久化的前瞻记录，对账成交、费用、现金及公司行动差异；程序化提交订单另行核验券商适用条款。
5. 先验收端到端流程，再积累跨市场状态的前瞻证据。当前本地实现不等于上述环节已经运行。

## 原始资料

- [Trading 212 Practice 入口](https://helpcentre.trading212.com/hc/en-us/articles/360007380937-What-is-the-difference-between-practice-and-real-money-accounts)
- [Practice 公司行动限制](https://helpcentre.trading212.com/hc/en-us/articles/360012626297-Are-corporate-actions-performed-on-practice-accounts)
- [官方 API：Demo、Invest/ISA 与主币种限制](https://docs.trading212.com/api)
- [UK Invest 条款，5.1](https://www.trading212.com/legal-documentation/uk/invest/Invest-Terms_EN.pdf)
- [FX 费用及 Pies](https://helpcentre.trading212.com/hc/en-us/articles/360018909758-What-is-the-FX-fee-Invest-Stocks-ISA)
- [Faber：A Quantitative Approach to Tactical Asset Allocation](https://mebfaber.com/wp-content/uploads/2016/05/SSRN-id962461.pdf)


## 长期偏好与运行边界（2026-11-03）

用户要求记录长期投资偏好：优先服务长期投资，比较扣费后收益与回撤。具体持有年限、可承受损失和资金配置尚未确认，不得将工程默认参数当作个人风险承诺。保持冻结规则，不因少量样本或零成交而提高交易频率。

本任务只进行研究与离线验证，不真实下单、不修改账户设置。进展、证据、阻塞与下一批任务通过对话汇报，不维护独立推进看板。不能保证盈利或数据绝对安全。本轮无券商操作。

## 验证口径修订（2026-11-03）

旧 walk-forward.v2 在缺开盘价时用收盘价替代，并按现金的 (1-feeRate) 分配买入金额。v3 改为缺开盘价阻断整个数据集；突破策略缺最高价也阻断。买入单位数为 cash/(open*(1+feeRate))；卖出扣费为 units*price*(1-feeRate)，基准同口径。不得混用 v2/v3 结果。Kronos 独立试验脚本未在此次变更中重跑或修改，四窗口结果未重新验证。

官方规则本日复核：Invest 佣金和托管费为零，发生换汇时通常收取 0.15% FX 费。App 同资产币种钱包交易可不发生订单换汇；API 只支持账户主币种执行，不能复制该免换汇假设。LSE ETF 不收股票印花税；其余税费仍须按证券、市场、金额、开户实体核实。成本页为预估，成交成本可能不同。

- https://helpcentre.trading212.com/hc/en-us/articles/11471996799517-What-are-the-fees-in-the-Invest-ISAs-and-SIPP
- https://helpcentre.trading212.com/hc/en-us/articles/34159237080861-Can-I-choose-the-currency-in-which-to-buy-sell-assets-for-Invest-accounts
- https://docs.trading212.com/api/section/general-information/api-limitations
- https://helpcentre.trading212.com/hc/en-us/articles/37664081239709-How-can-I-see-the-cost-of-a-trade-before-I-place-it

VWRP 研究决策仍为 WAIT / executionAuthority NONE：缺合格连续行情、实际账户证券资格与成本核验。四个历史窗口零交易不能验证成交费用。旧价格不作为今日报价生成交易建议。


费用算例（纯计算、非行情）：买入价100、数量1、汇率不变、固定费用0、不另计价差滑点税费。每边比例费0/15/30 bps时，价格不变的往返损益分别为0/-0.30/-0.60；回本价格涨幅分别为0%/0.300450676%/0.601805416%。30 bps仅为双倍换汇费压力假设，不是券商收费标准。实际费用可能更多，不能把此表当作完整账户报价。

本次代码验收：npm test 为163通过、0失败；npm run check 为86个JavaScript文件通过。包含请求目的地、只读、云接口保护和决策单WAIT回归测试。仅验证测试覆盖范围，不代表外部部署已验证或绝对安全。未访问账户，未重跑模型权重预测，未部署Mac，未发布GitHub。研究决策单纯函数核验返回 RESEARCH_ONLY_INCOMPLETE / WAIT / NONE。
