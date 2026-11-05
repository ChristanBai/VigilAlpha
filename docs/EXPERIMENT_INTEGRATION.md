# dev.18 本地实验接入记录

完成日期：2026-11-03，Asia/Shanghai。VigilAlpha 仍是唯一产品根；未推送 GitHub，未更新用户 Mac。仅有本地候选包。当前会话没有本机 Chrome 控制工具，无法查看用户已打开的 Invest Practice；实际券商模拟订单为 0。用户的模拟买卖授权不需要重复请求，恢复连接后先核对账户为 Practice / Invest。

## 真实接入的代码

| 模块 | 实际改动 | 产品入口 |
|---|---|---|
| 财报证据 | 从 Ticker Research 的毛利、自由现金流逻辑移植到 JS；补充同会计期间/币种、来源、披露日期、缺失值和冲突检查 | `company_quality_evidence`：输入 SEC CompanyFacts、会计期末、asOf |
| Kronos | 引入固定提交的 tokenizer、Transformer 和预测核心；将全局 import 改为包内相对 import；保留许可证 | `experimental_kronos_forecast`：可选本地 CPU 推理，不自动下载、不接触券商 |
| 实验流程 | 固定 128 根历史 K 线、5 个交易日预测、随机种子和采样参数；保存模型与输入哈希；保留所有失败 | `scripts/kronos-pilot.py` |

源代码与许可证在插件 `vendor/` 下。没有引入上游 web UI、OAuth、账户登录或自动下单功能。PageSift、Qlib 尚未集成。

Ticker Research 固定提交：`0d5d553a06e2a7f7106cbe34708ef12cdaf780de`。
原始文件：`ticker_engine/providers/sec/sec_derived.py`；该文件注明源自 K-invest，两个项目的 MIT 许可均保留。JS 移植文件：`src/vigilalpha/company-evidence.mjs`。

Kronos 固定提交：`67b630e67f6a18c9e9be918d9b4337c960db1e9a`。
引入 `model/__init__.py`、`model/kronos.py`、`model/module.py`；唯一上游行为外的源文件修改是去除 `sys.path` 修改并使用相对 import。上游 stdout 加载提示由适配器转到 stderr，保证 MCP 收到单个 JSON。

模型：`NeoQuasar/Kronos-small`，revision `901c26c1332695a2a8f243eb2f37243a37bea320`。
Tokenizer：`NeoQuasar/Kronos-Tokenizer-base`，revision `0e0117387f39004a9016484a186a908917e22426`。
只加载本地 safetensors；本次下载约 111 MB 的模型文件，不包含在插件 zip 中。模型卡标示 MIT；没有独立证明训练数据范围与历史污染不存在。

## 第一轮真实输入实验

### 1. 公司财务

使用 SEC CIK 320193 的 Apple CompanyFacts，选取会计年度期末 `2025-09-27`，完成毛利、自由现金流、相应利润率计算。输出保留采用的概念、会计期间、filed 日期、accession 和来源；不把获取时间当披露时间。这个动作验证数据通路和计算，不构成 Apple 估值或买入建议。

### 2. 长历史数据质量

VWRP.L 原始公开价格快照：2021-11-01 至 2026-10-30，共 1262 条。与 XLON 日历对照后发现 22 条 OHLC 关系冲突、2 条 OHLCV 缺失（2025-10-24、2026-03-06）。**五年月度策略回测被阻断**，没有补造数据、删除失败段后声称完整回测或绕过正式数据准入。

VWRP 是 GBP 报价的累积型全球股票 ETF，公开 Invest 页面可以查到 ISIN IE00BK5BQT80；用户的实际账户内可交易性尚未核实。公开上架不等于历史可交易性、个人资格或数据商业使用许可。

### 3. Kronos 历史小样本

在完整且通过逐条 OHLCV 检查的近期窗口内，以最后 20 个已完成交易日划分 4 个不重叠的五日试验。每个试验只给模型前 128 根 K 线，未来日期来自交易日历，未来价格不传给模型。所有试验保留；不搜索参数、不挑盈利窗口。模型训练期是否包含这些历史资料未独立证实，不能称为独立样本外结果。

固定映射：预测第五日收盘相对信号日收盘上涨超过 0.2%，则下一开盘假设买入、第五日收盘假设卖出；否则现金。全程只做多；初始虚拟资金 £1000；每边费用 10 bps，再以 20 bps 重算。终点强制平仓口径对策略与基准一致；这与月度规则的期末按市值估值口径不同，不混合排名。

| 指标 | 实验结果 |
|---|---:|
| 评估期间 | 2026-10-05 至 2026-10-30 |
| 五日试验数 | 4 |
| 模型触发买入次数 | 0 |
| 策略净收益 | 0.0000% |
| 同期买入持有净收益（每边 10 bps） | -3.8495% |
| 策略相对收益 | +3.8495 个百分点 |
| 每边 20 bps 的买入持有净收益 | -4.0416% |
| 模型五日末收盘价 MAE | 1.0222 GBP |
| 不变价格预测的 MAE | 1.5450 GBP |

结论：在这段下跌期间，持现避开了损失；模型没有赚取正收益，也没有验证成交质量。仅四个样本不能证明稳定预测优势。状态保持 `EXPLORATORY_NOT_VALIDATED`，不自动提升策略成熟度，不触发订单。不得用这组数字对客户宣传预期收益。

### 4. 预测推理与产品调用

同一份截止 2026-10-30 的输入完成直接 Python 推理和 MCP 入口实际调用，固定 seed 后预测值一致。模型输出五个目标交易日到 2026-11-06；这些是本地研究预测，不是已成交订单。记录的早期运行与后续复跑分开保留；未建立独立可信时间戳和自动后验数据采集，因此不把复跑记录算作已验证前瞻实绩。历史与未揭晓目标的记录不混用。

## 可复现操作

Node 端无需 Python 即可使用其余功能。实验模块需要 Python 3.12（本环境已测）和单独虚拟环境。

1. 在独立环境安装 `torch==2.5.1`（Linux 使用官方 CPU wheel，macOS 使用原生 wheel）以及 `scripts/requirements-experiments.txt`。
2. 从上述固定 revision 获取模型与 tokenizer 的 `config.json` 和 `model.safetensors`，保留下载哈希。不要使用漂移的 main 作为已冻结试验依赖。
3. 在 Codex 启动环境配置三个变量：`VIGILALPHA_EXPERIMENT_PYTHON`、`VIGILALPHA_KRONOS_MODEL_DIR`、`VIGILALPHA_KRONOS_TOKENIZER_DIR`。插件已经声明这三个可传递变量。缺配置返回 UNAVAILABLE，不影响其他只读工具。
4. 从插件目录运行：

```bash
node --test tests/company-evidence.test.mjs
npm test
npm run check
python scripts/kronos-forecast.py --model-dir /absolute/model --tokenizer-dir /absolute/tokenizer < forecast-input.json
python scripts/kronos-pilot.py /absolute/yahoo-snapshot.json /absolute/new-output-directory --model-dir /absolute/model --tokenizer-dir /absolute/tokenizer
```

`kronos-pilot.py` 仅消费本地文件，不自动联网获取行情；输出目录必须无同名试验文件，避免覆盖结果。快照、SEC 原始输入、预测和运行记录不放入公开仓库或安装包。已有快照商业使用权、历史可用时间与公司行动完整性仍需独立核查。

## 剩余优先项

- 恢复本机 Chrome 连接，确认 Practice / Invest 与初始余额，才可核实模拟成交。
- 修复或替换被拒的历史数据，完成分红/拆股/外部现金流账本；正式回测准入继续保持严格。
- 建立可持久化的前瞻运行与后验价格核对，保留亏损、未成交和模型不触发情况；本轮没有启动自动定时任务。
- 扩展财报、供应链原始披露和估值分析，区分公司关系证据与投资收益证据。
- 在用户 Mac 安装验收；当前只完成 Linux/CPU 与本地 Node MCP 验证，不能宣称 Mac 已升级。

## 原始来源

- https://github.com/ianlyoo/ticker-research-mcp
- https://github.com/ianlyoo/K-invest
- https://github.com/shiyu-coder/Kronos
- https://huggingface.co/NeoQuasar/Kronos-small
- https://huggingface.co/NeoQuasar/Kronos-Tokenizer-base
- https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json
- https://www.trading212.com/trading-instruments/invest/VWRP.GB
- https://www.vanguardinvestor.co.uk/investments/9679


## 2026-11-04 复核：收益口径与实际价格检查

保持原四窗口规则和原报告不变，新增无网络、无模型推理、无账户访问的 `scripts/reprice-pilot.py`，读取原 report.json 和全部四个 fold 文件。逐一校验价格、日期、预测与信号一致性，记录输入哈希，再分别计算期末卖出和期末市值两种口径。后者仅是估值敏感性，不是修改已冻结的五日退出策略，也不构成新的前瞻实验。

| 每边假设成本 | 模型收益／成交数 | 基准期末卖出 | 基准期末市值 |
|---|---|---|---|
| 10 bps | 0%／0 | -3.849535% | -3.753288% |
| 20 bps | 0%／0 | -4.041644% | -3.849342% |

零交易时加倍费用不改变模型收益，不能据此声称抗交易成本或成交质量已验证。当前代码统一按成交金额收费；保留早期窗口的既定卖出，市值敏感性只省略最后窗口的期末退出。不同测试期间、信号、样本或股票池仍不直接排名。

原报告 SHA-256：`9f259264ea1d8e619d468769573cad4deb3fba5ae22e52223114fd1bb359979b`。原价格快照 SHA-256：`b34f1df52543532a8f1171d60718b8f0c5b26b9f1c8e26917c91fc9dc861c12f`。本次重新扫描1262条源记录，再次得到22条OHLC关系异常、2条OHLCV缺失；来源未报告公司行动不等于确无行动。原实验虚拟环境的Python入口已不可用，本次使用标准库完成价格检查和重计价，未重新运行交易所日历或模型推理。

新 `pilot_accounting.py` 将收费与期末计算抽出供实验脚本共用；`kronos-pilot.py` 升级报告契约到v2，增加对未来实际结果五根OHLCV的检查。此前只检查模型输入，未来结果可能缺失或价格自相矛盾；现在阻断该窗口并保留失败状态，不跳过坏窗口生成完整收益。原v1实验记录不会覆盖。

复现（从插件目录）：

```bash
python3 scripts/reprice-pilot.py /absolute/original-pilot-directory
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

2026-11-04 官方复核：Practice 不执行分红、配股、分拆、收购等公司行动，仅反映拆股/合股等事件引起的价格变化。因此模拟盘收益不能直接用作完整总回报账本；当前决策仍 WAIT / NONE，不进行订单或账户配置操作。来源：https://helpcentre.trading212.com/hc/en-us/articles/360012626297-Are-corporate-actions-performed-on-practice-accounts

长期偏好沿用 INVEST_PRACTICE.md：服务长期投资，持有年限和损失预算仍未确认，不把研究默认值当作用户授权。

本轮验收：11项Python测试通过（含模型输入契约、买卖费用手算、期末市值、坏数据阻断、原始文件不变和摘要篡改检查）；9项Node定向测试通过（券商只读/目的地限制、云接口认证、决策单WAIT）；3个修改/新增Python运行文件编译通过。本轮没有重跑完整Node套件或模型推理，不以旧163项结果充作本次全量验收。


## 2026-11-05 环境恢复与来源冲突检查

实验环境原有Python启动入口缺失；确认宿主与pyvenv.cfg均为Python 3.12.14后恢复该符号链接，没有重装依赖或改账户设置。已实际导入pandas 2.2.3、exchange_calendars 4.11.2、torch 2.5.1+cpu、safetensors 0.6.2、huggingface_hub 0.33.1。此结果证明解释器与这些依赖可加载，不代表模型已重新推理或Mac部署成功。

重新运行prepare-market-pilot.py完成XLON日历核对：原快照1262行、1238行有效、24个缺少有效价格的交易日（其中22条价格冲突、2条缺失），2021-11-01至2026-10-30，仍为BLOCKED_DATA_QUALITY。没有把被拒日期删除后宣传为完整历史。

第二来源检索仍未取得2025-10-24和2026-03-06两日可核验的完整OHLCV及全历史公司行动证据。另观察到11月4日网页价格冲突：Twelve Data历史表收盘139.92 GBP、页面顶部最新价141.46001（标注16:29 GMT）；EODData日终表141.6；Vanguard产品页Market value在11月4日收盘为141.58 GBP。这些字段可能涉及更新、精度和价格定义差异，未确认前不相互替换。尤其不能用USD NAV替代GBP交易所成交价。

本日查看的来源：
- https://twelvedata.com/markets/392935/etf/lse/vwrp/historical-data
- https://eoddata.com/stockquote/LSE/VWRP.htm
- https://www.vanguard.co.uk/uk-fund-directory/product/etf/equity/9679/ftse-all-world-ucits

新增source-comparison.mjs：显式比较证券身份、市场、币种、价格口径、交易日和日线是否完成；需要至少两个不同名称的来源及明确价格容差，比较OHLC全范围，发生冲突不自动修补。市场数据准入接到sourceComparison时重新计算，不能仅凭调用者写PASSED放行。未提供该字段仍保留原准入行为，因此这不是强制双来源验证，也不能证明供应商相互独立。成交量未纳入该比较器。实际网页对照因最终日线状态未核实返回FINALITY_UNVERIFIED，没有纳入回测。

验收：169项Node测试通过，88个JavaScript文件语法检查通过，恢复环境下11项Python测试通过。GitHub Main仍为0ff4d205，新增修复仅在本地分支。决策保持WAIT/NONE；长期偏好及未确认的风险预算不变。未新增交易、未改账户设置、未重新预测或建立新看板。
