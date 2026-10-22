# 终末传奇 · 架构与模拟细节

> 本文是「模拟如何运转」的**唯一权威说明（single source of truth）**。README 只做门面与入口，
> 机制口径以本文件为准；术语以 `GLOSSARY.md` 为准；GM 面向的机制参考见 `docs/gm-handbook.md`；
> 决策背景与取舍见 `docs/adr/`；路线与工作包见 `docs/plans/`。
>
> 当前世界版本 **v13**（**19 类建筑**、建筑配方与利用率/利润驱动投资、四税基、铁矿石/钢铁拆分、
> 统一基础设施（铁路/港口/电报合并为单一「基础设施」、运河删除，plan 0014/ADR 0029）、建筑 `unlock` 前向字段、
> **4 时代 / 16 节点科技树**（plan 0005 K0–K1，替代 1–10 级线性科技，派生 `techTier` 代理））。数值口径以 `v3_inspect` 分区输出为准，本文只解释**为什么**。

## 目录

1. [世界模型](#1-世界模型)
2. [支出法经济循环（C+I+G+NX）](#2-支出法经济循环cignx)
3. [建筑配方、逐建筑利润与利用率](#3-建筑配方逐建筑利润与利用率)
4. [建造能力与队列](#4-建造能力与队列)
5. [贸易：到岸价、双关税与持久航线](#5-贸易到岸价双关税与持久航线)
6. [财政：国库=净资产、债务压力、赔款](#6-财政国库净资产债务压力赔款)
7. [四税基](#7-四税基)
8. [修正叠算（modifiers / config blocks）](#8-修正叠算modifiers--config-blocks)
9. [界面层](#9-界面层)
10. [与 claude-hud 共存](#10-与-claude-hud-共存)
11. [文件结构](#11-文件结构)

---

## 1. 世界模型

- **规模**：10 个国家、14 种商品、19 种建筑、6 类支出、**4 时代 / 16 节点科技树**（通用时代线 4 + 工业/行政/军事各 4）。
- **月度结算流水线**：商品供需与价格 → GDP/财政 → 建造队列 → 人口增长与城市化 →
  生活水平/激进/合法性 → 官僚效能与权威 → 科技 → 军力与人力 → 外交关系漂移（受恶名拖累）→
  战争 → 随机事件 →（E1）实时事件扫描。
- **战争**：以双方陆军质量、士气、科技计算的战争分数推进，**75 分或 60 个月**结束；
  战争目标决定胜利条款（赔款/开放市场/势力范围/威望羞辱）。
- **事件**：随机事件有多个选项，效果覆盖国库、激进、合法性、威望、军队、人口、科技点与
  双边关系；另有 E1 逐回合实时事件（ADR 0025，题材扫描 → LLM 生成 0–2 个 → 效果信封 → 持久化）。
- **蒙地卡洛之外的确定性**：全部模拟是 seeded RNG 的纯 TypeScript 函数，同一个种子
  得到同一个世界；60/120 月基线是确定性的。
- **存档与版本**：存档是项目目录下的 `.terminal-legend/save.json`（纯 JSON），命名存档为
  `.terminal-legend/<名字>.json`。早期开发**不做存档兼容**：世界结构变化时提升
  `WorldState.version`，旧存档直接拒绝载入（ADR 0005）。当前 v12。
- **AI 决策**：非玩家国家每月用 `$.model.complete`（默认 haiku）批量做一次领袖决策，
  提示里带领袖人格、特质、议程、GDP 构成、资源与私人资本；模型失败时自动退回确定性政策，
  世界不会停摆。

- **科技（plan 0005 K0–K1）**：`Country.tech` 是 4 时代 / 16 节点树的 `TechState`
  （`era`、`unlocked` 节点 id、`researching`、`points`）；旧 1–10 级线性科技已删除。所有旧公式改读派生代理
  `techTier = 1 + era×1.5 + unlocked.length×0.05`（范围约 2.5–7.8），仍走不变的 `1 + tier×0.07` 生产/建造门控。
  `v3_action research` 按节点 id 选择（校验**前置 + 时代门槛**）；节点成本来自 `TECH_NODES` 表（时代 1/2/3/4 = 80/180/360/640），
  完成后加入 `unlocked`，通用线节点推进 `era`。节点**效果**（修正/一次性）K1 只存储、K2 接入；建筑
  `unlock.techLevel` 现按 `techTier` 判定（当前无建筑设阈值）。旧 v12 存档按 ADR 0005 拒绝。

来源：`engine/world.ts`、`engine/ai.ts`、`engine/save.ts`、`types/index.d.ts`、`engine/data/tech.ts`、ADR 0005、plan 0005 K0–K1。

## 2. 支出法经济循环（C+I+G+NX）

- **GDP = C + I + G + NX**（消费 + 投资 + 政府 + 净出口），**按基期价**估值（实际 GDP，
  避免产能扩张压低价格时名义 GDP 倒退）。NX 为净出口（基期价），已接入双边贸易，**可以为负**。
- 每个最终用途块按「需求对有效供给」的满足比例填充，未满足的订单**压低** GDP 而不是吹高。
  `C + I + G + NX === GDP` 是不变量。
- **消费（Stone-Geary）**：每种消费品有每 `popFactor` 的**生存底线**，超出部分按**收入弹性**
  分配（弹性和为 1）；实际只花掉超额收入的 **0.75**（`CONSUMPTION_PROPENSITY`）。消费品：
  粮食、成衣、家具、酒类、服务、奢侈品。
- **劳动份额**：`laborShare = clamp(基准 − (失业 − 5) × 0.01, 0.35, 0.70)`；
  `wages = realGdp × laborShare`，`profits = realGdp × (1 − laborShare)`。各国基准不同
  （英国 0.52、大清 0.62 等）。全国工资再按 `WAGE_ALLOCATION` 摊到各建筑类型的经营利润。
- **私人资本**：利润中储蓄下来、专门给私人建造出资的资金池；**不进国库、玩家不能直接征用**。
  可以为负：负值即**私人外债**（`max(0, −privateCapital)`），记在私人资产负债表上；
  私人进口逆差由私人资本/私人外债承担，**不扣减国家净资产**（ADR 0008）。
- **投资信心**：影响储蓄率与私人投资意愿的百分比偏移；AI 每月可在基准上下 10 点内调整，
  单月变动 ±3；政策与天命也可修正。
- **货币单位**：所有金钱与产出价值统一用抽象单位「金」，显示为「金」「金/月」；GDP 是月度流量。

来源：`docs/plans/0003-economic-loop.md`、`engine/economy.ts`、`engine/data/goods.ts`、
GLOSSARY「支出法 GDP」「私人资本/私人外债/投资信心」。

## 3. 建筑配方、逐建筑利润与利用率

### 建筑配方（单一真源，ADR 0021）

`engine/data/buildings.ts` 的 `BUILDING_RECIPES` 逐类声明每座每月的**产出与中间投入**（含副产品）
与**用工**，是产出与投入的**唯一来源**；`computeProduction` 只读该表，中间投入按
`Σ 建筑数 × 配方投入` 汇总。中间投入**进入需求**（用于定价与贸易）但**不计入 GDP**。

除逐建筑配方外，还有**国家级**项留在引擎里（手工业者产出 `ARTISAN_OUTPUT`、总人口服务项、
鸦片国家 `outputFactor`、工业城镇的煤/铁矿石/钢铁/布/木消费，按 `popFactor`）；它们是历史口径，
不随配方变动。逐类配方表见 `docs/gm-handbook.md` §4.3。

**门控乘数**：tech `1 + 等级 × 0.07`；access `0.55 + 市场接入 × 0.9`；industrial 为煤铁禀赋因子
（0.7~1.3）。旧的逐配方 infrastructure 门控（`0.6 + 交通 / 160`）**已退役**，由 F5 的统一基础设施
短缺乘数取代（见 §4 末）。

### 逐建筑经营利润 `buildingProfits`（ADR 0021/0022）

- 每月按类计算快照：**利润 = 产出价值 − 中间投入价值 − 分摊工资**；
  单位 `profitPerBuilding`（金/座）、毛利率 `profit / revenue`。
- **工资分摊可配置（plan 0008 B5）**：全国工资如何摊到各建筑类型由 `engine/data/buildings.ts` 的
  `WAGE_ALLOCATION = { basis, weights? }` 决定。`basis` 取：
  - `'labor'`：按 `用工 × 座数`（旧口径）；
  - `'valueAdded'`：按 `max(0, 产出价值 − 中间投入)`（**当前值**）；
  - `'capitalPlusLabor'`：按 `用工 + 建造成本 × 0.25`。

  `weights?` 可按类型再乘系数（当前未用）。三种 basis 都**精确**满足
  `Σ buildingProfits.wages === 全国 wages`。（plan 0009 D1 只抽了 `engine/*.ts` 的散落字面量，
  **未**搬 data 侧业务系数，故此常量仍在 `engine/data/buildings.ts`。）
- **利用率门控产能（ADR 0022）**：产出按**上月**存储的 `utilization` 门控——亏损类目闲置，
  下界 0.5，一阶平滑 0.25；深度亏损的类目每月额外萎缩（上限 0.02/月，计数永不为负）；
  私人投资**只建 `profitPerBuilding > 0`** 的类型。
- 该口径按**市场价、毛产出**估值，与宏观 `realGdp × (1 − laborShare)`（基期价、增值口径）
  **不是同一个量**；通常更大，仅供判断「这类建筑按现价赚不赚钱」。查看：`v3_inspect buildings`。
- **F7 校准带**（7 大国产量加权，24/48/84 月）：农业 48–62%、采掘 42–62%、轻工 4–25%、
  重工 0–36%、服务 38–58%、军事 45–65%；**每类产货建筑均为正毛利**。带宽被
  `WAGE_ALLOCATION='valueAdded'` 的「无投入部门天然高毛利」结构决定。

### 消费品真双向（B5-r2，plan 0008 §5）

成衣、酒类、家具**在世界上双向交易**（真实 bid 与 offer）：纺织厂转做布料、成衣交由各国
**手工匠**（`ARTISAN_OUTPUT`）供给，家具厂/酿酒厂配方按 0.45 缩放并**同比例下调投入**，
同时上抬消费品生存需求与成衣收入弹性。实测（seed 9100，84 月）成衣 81/84 月双侧、酒类 84/84、
家具 81/84。**军械**仍是单侧（生产恒 > 需求，无 bid）——唯一按设计非双向的商品，有生产下限断言。
鸦片危机门保持（QING 鸦片进口最小 2.251 ≥ 2）。

来源：ADR 0021、ADR 0022、`engine/data/buildings.ts`、`engine/economy.ts`、
`docs/plans/0008-economy-remake.md` §5、`tests/economy-recipe-calibration.test.ts`。

### 劳动需求与失业（利用率为权，0007 E8）

- **劳动需求 = `Σ(labor × count × utilization)`**（`engine/data/derivations.ts` 的 `deriveLabor`）：
  逐类建筑按 `用工 × 座数 × 上月开工率` 求和，`utilization` 取**上月存储值**
  （`country.econ.buildingProfits[id].utilization`）——与产出门控**同一字段、同一滞后**（ADR 0022）。
  全行业 `utilization = 1` 时**逐值退化**为旧的 `Σ(labor × count)`（不变量）。
- **失业的行业来源**：亏损/闲置的部门按开工率**释放劳力**，劳动需求随之下降、原始利用率缺口扩大；
  于是**利润经由开工率传导到就业**（0007 E8，`d346b12`）。开工率下界 0.5、一阶平滑 0.25（ADR 0022），
  故重农经济不会把海量农民读成 95% 闲置。
- **失业率仍是结构性指标**（`deriveUnemployment`）：由工业建筑吸纳能力、识字率与激进共同决定，
  **不等于** `1 − 劳动需求/劳动力`；`v3_inspect labor` 的「原始利用率」只反映需求缺口。
- **`v3_inspect labor` 的「部门来源」行**：`满座需求 − 当月实际劳动需求 = 闲置部门释放的劳力`，
  并列出开工率最低的几个闲置部门；全部满负荷时显示「无闲置释放」。
- 纯派生口径，**不提升 World 版本、不改存档形状**（World 仍 v12）。测试：`tests/labor-utilization.test.ts`。

来源：ADR 0022、plan 0007 §E8（`d346b12`）、`engine/data/derivations.ts`、`engine/inspect/labor.ts`。

## 4. 建造能力与队列

- **营造所产出建造点**：每座每月 **4 点**，受科技、交通、市场接入与**原料可得性**约束
  （木、粮、铁不够则打折）。
- **工程量**：`工程量 = 单座月度点数 × 30`（`WORKLOAD_MULTIPLIER`）。单座营造所 = `1.5 × 30 = 45` 点；
  5 座 = 225 点。
- **队列顺位（ADR 0013）**：国有队列**严格按条目顺序**分配建造力，每个 entry 每月可拿
  `take = min(队列剩余建造力, 本项目剩余工程量)`，**没有每槽月度上限**——小工程在空闲期可以
  一次做完。**工期 = 剩余工程量 ÷ 每月实际投入**，不再与槽位大小绑定。
- **每槽最多 5 座**（`MAX_BUILDINGS_PER_SLOT`）；**每月订单数量不限**。每点工程量造价固定
  **0.2 金**；各建筑的资金乘数/加数 v1 全为 1/0，总造价 = 总工程量 × 0.2，与快慢无关。
- **建造点需求**（`CAPACITY_COST`，每座/月）：营造所 1.5、农场 0.5、煤矿/铁矿/兵营/官署 1、
  伐木场 0.8、纺织/军械/奢侈 2、家具/酿酒 1.5、机械/钢铁 2.5、大学 2、**基础设施 3**。
- **私人项目（ADR 0017）**：自建 **50%**；可**租用国有闲置建造点**，租金 **0.3 金/点**入国库
  （记为收入「其他」）。分配完后剩余点也按 0.3 金/点出租给私人。私人项目**不可取消**；
  每两月最多开工一次、最多三单在途，且只建有利润的类型（ADR 0022）。国有与私人两栏队列分开显示。
- **建设补贴**（`spending.construction`，ADR 0015）：每级每月 **+1.5 建造点、花 0.45 金**；
  补贴点与营造所产点同质、同样受原料约束；没有营造所时补贴不产生建造力。
- **统一基础设施（ADR 0026 F5；plan 0014 / ADR 0029 合并）**：基础设施的**短缺乘数**对**所有建筑
  产出**（含服务）生效，`ratio = 供给 / max(ε, 需求)`；`乘数 = ratio ≥ 1 ? 1 : clamp(ratio, 0.35, 1)`，
  **只罚不奖**，生产读**上月**存储值（滞后一月）。供给来自 `INFRA_BUILDING_IDS` 列出的建筑
  （v12 起只有单一 `infrastructure`，供给 2.16/座；铁路/港口/电报已合并、运河已删除）；需求来自每类
  建筑的 `infrastructureNeed`（农场 0；基础设施自身 0.165）。基建自身每月消耗原料 + 服务（维护，
  `computeDemand` 的中间需求）。**可重拆接缝**：所有基建消费点遍历 `INFRA_BUILDING_IDS` / 读逐建筑
  系数表，将来拆分只改数据（`docs/adr/0029-infrastructure-merge.md`）。详见 `docs/gm-handbook.md` §4.3。

来源：ADR 0010/0012/0013/0015、ADR 0017/0022/0026、`engine/construction.ts`、
`engine/config/construction.ts`。

## 5. 贸易：到岸价、双关税与持久航线

- **到岸价**：`出口国国内价 × (1 + 出口关税) × (1 + 进口关税) × 区域运输 × 市场接入 × 交通 × 关系风险`。
- **双向关税（ADR 0009/0014）**：`tariff` 是**进口税率**，`exportTariff` 可选、**缺省与进口同率**。
  进口国私人付边境价 + 进口税，出口国国库收出口税，进口国国库收进口税；自由贸易把两个税率
  都降到 **5% 下限**。`v3_action tariff` 可用 `rate` 与 `exportRate` 分开设定。
- **结算归属（ADR 0008）**：出口国**私人**收国内价、出口国国库收出口税；进口国**私人**付边境价 +
  进口税。**私人进口逆差由私人资本/私人外债承担，不记国家国债**；国库只经手关税。
  支付能力 = 出口收入 + `max(0, privateCapital)` + `GDP × 3%`。
- **持久化贸易航线（软闸门，ADR 0020）**：一对国家就某种商品建立持久贸易航线，存在
  `world.tradeRoutes`，有等级（≤5）与所有者（国有/私人）。每月清算**两遍**：
  1. **航线遍**（先）：按航线折扣到岸价（×0.9、**不含关系风险**）优先成交；
     端点交战 / 该商品被禁运 / 进口方关系低于 **−50** 时跳过（供给留给现货）。
  2. **现货残差遍**（后）：用剩余 offer/bid 按现货价加摩擦（×1.15）、候选更窄（Top-3）。

  **没有航线也能贸易。** 航线运量达容量 **80%** 且有利可图则升级，否则衰退、归零即删除；
  被切断的航线当月运量 0 并衰退。AI 每月每国最多自动开通 1 条；1836 开局自带一套种子航线。
  硬切断：战争切断交战双方全部贸易；禁运按商品或全部切断；关系低于 −50 硬切断。
- **玩家操作**：`v3_action route` 的 `open`/`raise`/`lower`/`close`，方向由两端净盈余决定
  （盈余大者出口，平局按较小 id）。校验：商品可贸易、伙伴存在、非本国、非交战、非禁运。

来源：ADR 0008/0009/0014/0020、`engine/trade.ts`、`docs/plans/0004-trade-diplomacy.md`、
GLOSSARY（航线/到岸成本/软容量/禁运）。

## 6. 财政：国库=净资产、债务压力、赔款

- **国库 = 净资产（单一余额，ADR 0006）**：`engine/fiscal.ts` 把国库抽象成一个带符号的净资产
  余额——`treasury > 0` 是**主权基金**（按基金月息生息），`treasury < 0` 是**国债**（按国债月息付息）。
  没有独立的债务存量或还本步骤。两个月息都受合法性、威望、战争、市场接入、重组窗口与民怨影响。
- **债务压力（ADR 0007）**：`ratio = 债务 / GDP`，`severity = clamp((ratio − 0.25)/1.75, 0, 2)`。
  债务/GDP 超过 25% 后，收入、建设速度、合法性目标与借债月息随比例持续恶化，直到 **3× GDP 重组
  底线**（越线后降债到 1.5× GDP 并进入 12 个月重组窗口）。**轻微负净资产不冻结建设**；
  现金上限是 3× GDP。`v3_status`、HUD 与财政账本都显示当前债务压力档位。
- **收支账**：收入 = 四税基税入 + 关税（进+出）+ 基建 + 基金收益 + 赔款收入 + 其他（建造力出租）；
  支出 = 陆军 + 海军 + 行政 + 教育 + 福利 + 债息 + 市场损耗 + 设施维护 + 赔款支出 + 国有建设 +
  建设补贴。**国库净额 = 收入 − 支出**；私人逆差**不在**这个账里。
- **战争赔款**：胜方声明总额与最长分期月数，败方自行决定一次付清多少、余款分几期；分期部分
  每月计入付款方支出与收款方收入，日程存在 `world.indemnities`。默认总额 = 败方 GDP × 10%，
  最长 60 个月。

来源：ADR 0006/0007、`engine/fiscal.ts`、`docs/plans/0007-economy-polish.md` §E6。

## 7. 四税基

税入按**四个真实税基**累加（ADR 0023），**GDP 不是税基**（它只是派生的产出指标）：

| 税基 | 税基量 | 承担者 |
| --- | --- | --- |
| **土地税** `land` | `resources.farmland × 4`（地价系数） | 地主 / 农业 |
| **企业所得税** `profit` | `Σ_建筑 max(0, buildingProfit.profit)`，逐建筑单算后累加 | 资本 / 经营体 |
| **消费品消费税** `consumption` | Stone-Geary 的**最终消费**货值（仅最终消费，不含中间投入） | 消费者 |
| **关税** `tariff` | 进出口货值（含贸易路线），在边境征清 | 进出口商 |

统一式（土地/企业/消费）：

```
税额 = 税基量 × 税率 × 征收效率 × 合规 × 债务削减
征收效率 = clamp(0.35 + 官僚效能/200 + 合法性/400, 0.3, 1.1) × taxEfficiency
合规     = 税率 ≤ 25% 时为 1，>25% 起按 1 − (税率−25)×0.015 侵蚀，下限 0.45（逐基）
债务削减 = 1 − 债务压力收入惩罚
```

- **关税**：`税额 = 边境实收 duty × 债务削减`（在边境一次征清，征收效率按设计为 1）。
- **初始税率**：土地 2% / 企业 2% / 消费 3%（关税取各国种子值，5%~20%），四基合计与旧 GDP 比例制相当。
- **税负归属**：私人可支配收入按私人税负（土 + 企 + 消，**不含关税**）扣减，避免重复计征；
  关税在边境由进出口商一次缴清。
- **查看/设置**：`v3_inspect fiscal` 逐基显示**税基量 / 税率 / 税额**；
  `v3_action tax { base, rate }`，`base ∈ land/profit/consumption/tariff`（0..60）；省略 `base`
  返回四基菜单与当前税率。

来源：ADR 0023、`engine/fiscal.ts`、`docs/plans/0008-economy-remake.md` §4。

## 8. 修正叠算（modifiers / config blocks）

政策、法案、事件、阈值与天命都通过 `engine/modifiers.ts` 给同一批数值入口挂 buff/debuff；
按 **flat → percent → multiply** 固定顺序结算，支持持续时间与**来源**；同一 `id` **覆盖**而不是
无限叠加（ADR 0004，其配置机制由 ADR 0024 的分层块取代）。

- **政策**：`v3_policy` 接受一组效果条目，引擎校验、消耗权威后落成修正。
- **阈值**：`engine/thresholds.ts` 的规则在每月结算后检查状态（如激进 ≥50 → 民怨沸腾，
  识字率 ≥60% → 启蒙时代）；`while` 规则条件消失即移除，`once` 规则永久保留。
- **事件**：事件选项的 `effects.modifiers` 直接携带限时 buff。
- **配置分层（ADR 0024 / plan 0009）**：`engine/config/*.ts`（平衡常数与块注册表）+
  `engine/data/*.ts`（数据）+ `engine/config/blocks/*`（各域声明块）。详见下节文件结构。

来源：ADR 0004/0024、`engine/modifiers.ts`、`engine/thresholds.ts`、`docs/plans/0009-config-refactor.md`。

## 9. 界面层

- **三层界面**：
  1. `$.ui.status` —— 最底部的单行 HUD（日期、国库净资产与净额、收入/支出、国债或主权基金、
     GDP、合法性、激进、科技、战争、铁人）；
  2. `AbovePrompt` —— 输入框上方的常驻仪表盘；会议打开时第一行是「御前会议 · 待议」；
  3. `Pane` —— `/v3 panel` 打开的完整面板，十一个标签页（御前/概览/排名/市场/经济/人口/外交/
     军事/科技/事件/日志）。「市场」只包含商品供需与对外贸易伙伴（贸易航路），其余经济内容留在
     「经济」；「排名」按经济、人口与社会、军事、科技与行政、外交与威望五维列出列强。
- 另外 `/v3 ...` 命令的输出会在对话里渲染成富文本报告。
- **建造面板（ADR 0027）**：`view/panels/construction.tsx` 的共享 `ConstructionPanel` 同时挂在
  御前面板与经济面板——「可建建筑」清单（19 类、按 6 族分组、`x*y` 下单按钮）+
  「国有建造队列」（`#index`/`id`、进度、取消/↑/↓/置顶；私人条目只读）。面板只读世界状态，
  只通过 `onControl(control, payload)` 抛出意图。

来源：`view/panels/`、`hooks/render.tsx`、ADR 0027。

## 10. 与 claude-hud 共存

`~/.claude/plugins/terminal-legend/statusline.mjs` 是一个状态行调度器：它始终执行
`delegate.txt` 里保存的原始命令（即 claude-hud 的 statusline），不再按游戏是否激活屏蔽对方。
游戏的状态文字与 `AbovePrompt` Band 叠加在同一屏上，两者共存。插件不再写 `active.json`，
也不再判断游戏是否激活。安装/修复：

```bash
node statusline/install.mjs
```

它会把当前 `~/.claude/settings.json` 的 `statusLine.command` 备份到 `delegate.txt`，然后把状态行
指向调度器。设置改动对**新启动的会话**生效；当前会话可能需要重启 Claude Code。

## 11. 文件结构

这个仓库本身就是插件目录：

```
/home/developer/gaming/terminal-legend/
├── .claude-plugin/plugin.json   ← 插件清单
├── hooks/register.tsx           ← 热重载入口
├── engine/  view/  types/  tests/  statusline/
└── .terminal-legend/save.json   ← 存档（已 gitignore）
```

会话热重载入口是 `~/.claude/dev-mods/<session>/terminal-legend`，它是指向本目录的符号链接
——所以直接改本目录的文件即可热重载，不需要再往 dev-mods 里写代码。完整树如下：

```
.claude-plugin/plugin.json   清单、userConfig（AI 模型）
hooks/hooks.json             单个 hooks 模块（入口指向 register.tsx）
hooks/register.tsx           入口：注册命令/工具/御前/渲染并接线各关注点模块（保留 register 导出）
hooks/internal.ts            共享插件状态与 UI 管线：state 读写、状态行、面板、常量、共享标志
hooks/tools.ts               v3_* 工具 schema、tool.call 处理器与白名单（SECRETARY_TOOLS + 参数表）
hooks/council.ts             推进/御前/托管/中断/停止/秘书 spawn/事件结算
hooks/render.tsx             ui.render 挂载（Panel / Band / Report）
hooks/prompt.ts              系统提示拼装（narratorPrompt）与状态文本（statusText）
hooks/commands.ts            /v3 命令分发（含 /v3 stop）
types/index.d.ts             PluginState 契约与世界模型类型（world v13：建筑配方、逐建筑利润与四税基、
                             铁矿石/钢铁、ControlPayload；4 时代 / 16 节点科技树 TechState + techTier）
engine/data/index.ts         桶：原样再导出全部公共符号，`./data` 导入路径不变
engine/data/goods.ts         商品/资源禀赋/区域运输成本/消费需求参数
engine/data/buildings.ts     建筑定义/配方/建造时长/基础设施系数/工业建筑清单
engine/data/tech.ts          科技树 TECH_NODES（4 时代 / 16 节点）、techTier 代理、选择/前置/时代门槛助手
engine/data/leaders.ts       领袖构造函数与继承序列（successorFor）
engine/data/countries.ts     十国种子、支出分类与政府类型
engine/data/events.ts        事件模板、随机抽取与对手选择
engine/data/derivations.ts   官僚/失业/劳动力/资源乘数/基础设施等派生函数
engine/data/world.ts         createWorld 与各类空状态构造函数
engine/config/balance.ts     全局平衡常数（上下限、历史长度、运行/账本上限）
engine/config/economy.ts     价格形成、Stone-Geary 需求、利用率反馈、私人投资门槛等经济常数
engine/config/society.ts     人口/城市化/sol/识字/失业/激进/合法性/政府类型等社会常数
engine/config/military.ts    人力、士气、领袖年龄、战争结算常数
engine/config/tech.ts        研究速率公式常数
engine/config/diplomacy.ts   关系漂移、恶名、外交动作幅度、战争目标结算常数
engine/config/trade.ts       贸易候选数、航线系数、到岸价系数、支付能力常数
engine/config/tax.ts         土地系数、建设补贴、自由贸易下限、征收效率/合规
engine/config/fiscal.ts      债/基金利率、支出系数、重组规则、支出上限
engine/config/construction.ts 营造所产能、每槽/工程量/造价、完工副作用
engine/config/events.ts      随机事件概率、AI 选项概率、实时事件解析上限与显著性阈值
engine/config/situations.ts  鸦片危机窗口/触发线/时限/禁运月数
engine/config/blocks.ts      域注册表（BLOCK_REGISTRY）聚合与块校验入口
engine/config/blocks/*.ts    各域声明块：thresholds/policies/events/situations/laws/war/tech/gates/fiscal
engine/sim.ts                门面（barrel）：原样再导出下列模块，保持公共导入面不变
engine/internal.ts           跨模块共享的小工具：clamp、日期、GOOD 校验、v7 建造字段补齐
engine/economy.ts            产出/需求/价格形成、支出法 GDP、逐建筑利润、税基量与利用率反馈
engine/construction.ts       建造能力、工程量/造价、队列排程与负载、完工与结算
engine/investment.ts         私人资本投资评分、资本门槛与私人项目节奏
engine/diplomacy.ts          关系漂移、贸易冷暖/敏感拖累、禁运到期、宣战/停战与战争目标
engine/events.ts             事件选项结算与月度事件抽取（AI 自动抉择 / 玩家待决）
engine/country.ts            单国月度结算：人口/就业/生活水平/合法性/科技/军力
engine/actions/index.ts      桶：原样再导出旧 engine/actions.ts 的 6 个公共符号，`./actions` 导入路径不变
engine/actions/decision.ts   applyDecision 调度器：未知国家守卫 + 未知行动兜底，按 action 分发到各处理器
engine/actions/types.ts      处理器共享的 ActionResult / ActionParams 类型
engine/actions/build.ts      建造入队/取消/重排（build / cancel / reorder；position/before、projectId/index）
engine/actions/tax.ts        四税基税率与税基菜单（tax / taxMenuText）
engine/actions/tariff.ts     进出口关税（tariff）
engine/actions/spending.ts   支出类别调整（spending）
engine/actions/research.ts   研究方向（research）
engine/actions/invest.ts     投资信心（invest）
engine/actions/conscript.ts  征兵（conscript）
engine/actions/law.ts        法案与 installLawModifier（law）
engine/actions/diplomacy.ts  外交动作与 relationLine（diplomacy）
engine/actions/route.ts      贸易航线动作（route）
engine/actions/situation.ts  危机提案（situation）
engine/actions/event.ts      事件选项结算（event）
engine/actions/play.ts       切换玩家国家（play）
engine/actions/policy.ts     政策提案与权威计价（applyPolicy）
engine/actions/random.ts     确定性随机决策回退（randomDecision）
engine/actions/interrupt.ts  托管中断判定（councilInterrupt）
engine/world.ts              世界创建与校准、航线引导、月度 advance 主循环
engine/fiscal.ts             国库收支账：收入来源与支出用途拆分（GDP ≠ 财政）
engine/trade.ts              区域运输矩阵、Top-6 双边数量清算、有效供给
engine/ai.ts                 批量 AI 领袖决策提示与解析
engine/secretary.ts          秘书系统提示与月度简报
engine/modifiers.ts          buff/debuff 叠算入口与到期结算
engine/thresholds.ts         状态阈值触发的修正规则
engine/cheat.ts              天命工具
engine/save.ts               存档、版本校验与状态行激活文件
engine/inspect/index.ts      桶 + INSPECT_SECTIONS / InspectSection 与 inspectWorld 调度器，导入路径不变
engine/inspect/shared.ts     inspect 共享助手（n/signed/pct、日期、战争、配方篮）与 InspectOptions
engine/inspect/economy.ts    v3_inspect economy 分区（读结算快照）
engine/inspect/market.ts     v3_inspect market 分区（产出/进口/出口/有效供给，按有效供给判状态）
engine/inspect/fiscal.ts     v3_inspect fiscal 分区（税基量 × 税率 × 征收效率 = 税额）
engine/inspect/labor.ts      v3_inspect labor 分区
engine/inspect/trade.ts      v3_inspect trade 分区
engine/inspect/routes.ts     v3_inspect routes 分区
engine/inspect/buildings.ts  v3_inspect buildings 分区
engine/inspect/construction.ts v3_inspect construction 分区（#index + id=<projectId>）
engine/inspect/military.ts   v3_inspect military 分区
engine/inspect/pops.ts       v3_inspect pops 分区
engine/inspect/diplomacy.ts  v3_inspect diplomacy 分区
engine/inspect/tech.ts       v3_inspect tech 分区
engine/inspect/modifiers.ts  v3_inspect modifiers 分区
engine/inspect/rankings.ts   v3_inspect rankings 分区
engine/inspect/log.ts        v3_inspect log 分区
engine/inspect/history.ts    v3_inspect history 分区
engine/inspect/forecast.ts   forecastWorld 下月现金流预估
view/format.ts               数字、进度条、火花线、状态行
view/panels/index.tsx        桶：原样再导出旧 view/panels.tsx 的全部公共符号，`./panels` 导入路径不变
view/panels/shared.tsx       面板共享层：UiKit/控制类型、Heading/StatLine/Meter/TableRow、playerOf/pendingOf/partnerTotals、SituationCard、PanePlaceholder、helpText
view/panels/panel.tsx        Panel 标签分发 + TABS
view/panels/construction.tsx 共享建造面板：可建建筑（19 类/6 族、x*y 下单）+ 队列（取消/↑/↓/置顶）
view/panels/overview.tsx     概览面板
view/panels/council.tsx      御前面板（含 ConstructionPanel）
view/panels/market.tsx       市场面板
view/panels/economy.tsx      经济面板（含 ConstructionPanel）
view/panels/pops.tsx         人口面板
view/panels/diplomacy.tsx    外交面板
view/panels/military.tsx     军事面板
view/panels/tech.tsx         科技面板
view/panels/events.tsx       事件面板
view/panels/log.tsx          日志面板
view/panels/rankings.tsx     排名面板
view/panels/band.tsx         Band（AbovePrompt 仪表盘）
view/panels/report.tsx       Report + TurnReport（命令输出）
statusline/install.mjs       状态行调度器安装脚本
tests/game.test.tsx          引擎、命令与渲染测试
tests/first-slice-data.test.ts        第一刀 M1：类型 / 数据 / 存档迁移
tests/first-slice-engine.test.ts      第一刀 M2–M6：引擎侧用例（建造 / 简报 / 中断 / 天命）
tests/first-slice-modifiers.test.ts   第一刀：buff/debuff 叠算与政策/阈值/事件修正来源
tests/first-slice-commands.test.ts    第一刀：M3–M6 命令与 hook 面 + v3_manual 工具面
tests/economic-loop-gdp.test.ts           经济循环：支出法 GDP / Stone-Geary / 需求冲击
tests/economic-loop-investment.test.ts    经济循环：私人资本 / 私人项目节奏 / 投资评分
tests/economic-loop-resources.test.ts     经济循环：资源禀赋与 0.7–1.3 乘数
tests/economic-loop-regressions.test.ts   经济循环：E4/E5 AI 与确定性 + Round 1–3 回归
```

类型契约在 `types/index.d.ts`，`$.state` 的两个值（`world`、`ui`）都在那里声明。
引擎是纯 TypeScript，不依赖渲染层；`view/panels/` 只读世界状态，不写状态。
