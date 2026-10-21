# 终末传奇 · Game Master (GM) 机制手册

本手册写给**扮演主要大国的 GM（LLM）**：你不读引擎源码、不读存档，所有世界状态
与操作都通过 MCP 工具完成。这一份文档就是你的唯一机制参考，遇到「为什么变了」先翻它，
再按指向调用 `v3_inspect`。

> 世界版本：**v11**（建筑配方、利用率/利润驱动投资、**四税基**与**铁矿石/钢铁**拆分均已落地，ADR 0021/0022/0023/0026）。
> 数值口径以工具返回为准，本手册只解释**为什么**，不复述**是多少**。

---

## 1. GM 边界

- **查询状态只走 MCP 工具**：`v3_status`（摘要）、`v3_inspect`（明细）、`v3_forecast`（预测）。
  绝不读取 `.terminal-legend/save.json`；存档是引擎内部表示，结构随世界版本变化。
- **写入只走工具**：`v3_action` / `v3_policy` / `v3_diplomacy` / `v3_event` / `v3_leader` 等；
  你不直接改引擎状态。
- **源码只在用户明确要求开发/修复时读**。游玩决策不得靠读源码推断规则。
- **遇到「为什么变了」→ 先用 `v3_inspect` 回答，不要猜**。每个分区对应一类问题（见 §3、§9）。
- 数值一律以工具返回为准，**不要编造数字**；工具给不出时就说明「工具未提供」。

来源：`docs/plans/0006-gm-engine-interface.md`、ADR 0003、ADR 0016、`CLAUDE.md`。

## 2. 回合与节奏

- **没有实时时钟**：每月推进后停在**御前会议**，玩家审阅月报、处理事件、批准推进。
- **`v3_advance`**：批准推进一月（`months` 缺省 1）。**只有玩家可推进**，秘书调用会被审计。
- **托管**：`months > 1` 进入后台托管，遇以下情况**中断**并提示：
  待决事件、新的战争、战争结束、秘书越权（`councilInterrupt` + 秘书连续越权计数）。
- **秘书**：`/v3 secretary` 召见，一个 haiku 子代理，在玩家授权的内政/外交范围内起草并执行；
  连续越权第 4 次起运行时拒绝。军事与战争**永远由玩家亲自决定**。
- **铁人（ironman）**：仅开局第一个月可切换；禁用天命、只保留自动存档、不能读其他存档。
- **天命（`v3_cheat`）**：金钱/科技点/建筑/关系/战争分数/日期/事件/领袖/修正，
  铁人模式拒绝。使用它会记入编年史。

来源：ADR 0001、README「月度御前会议」、`hooks/register.tsx`（advance / interrupt）。

## 3. 工具速查表

| 工具 | 作用 | 关键参数 | 何时用 |
| --- | --- | --- | --- |
| `v3_status` | 完整状态摘要：本国财政、人口、军力、科技、待决事件、战争、队列 | 无 | 回答任何需要具体数字的问题**之前**先调它 |
| `v3_inspect` | 只读明细，按 `section` 分区 | `section`（`log` 另可 `kind`/`country`/`limit`） | 「为什么变了」的默认答案来源 |
| `v3_forecast` | 下月现金流预估（收入、支出、净额、结算后国库、建造力分配） | 无 | 推进前预判财政；**是计划值**，会偏移 |
| `v3_manual` | 返回本手册全文（`docs/gm-handbook.md`） | 无 | 需要机制口径时读规则，无需打开文件 |
| `v3_advance` | 批准推进一月；`months>1` 托管 | `months` 1..24 | 玩家批准时间推进 |
| `v3_action` | 内政行动（见下表） | `action` 及各行动参数 | 建造、税率、关税、支出、研究、征兵、法案、贸易路线 |
| `v3_policy` | 提交政策提议：一组效果条目变成可叠算 buff/debuff | `name`、`effects[]`（`stat`/`stack`/`value`/`months`/`label`）、`authorityCost` | 常规施策，不针对特定局势 |
| `v3_diplomacy` | 外交行动（改善/交恶/结盟/对手/赠礼/宣战/停战/禁运/解除禁运/贸易张力） | `target`、`move` + 各 move 参数 | 双边外交与战争 |
| `v3_situation` | 就当前局势（如鸦片危机）提交立场 | `action`(submit/abstain)、`stance`、`narrative` | 局势开启时 |
| `v3_event` | 列出或处理待决事件 | `eventId`、`optionId`（省略 `eventId` 则列出） | 处理随机/局势事件 |
| `v3_leader` | 记录与该国领袖的交流，调情绪/关系，暂停其后台 AI 12 回合 | `country`、`message`、`mood`、`relation` | 玩家与该国领袖对话后 |
| `v3_save` | 保存 | `name`（可选；铁人不能命名） | 玩家要求存档 |
| `v3_play` | 切换玩家扮演的国家 | `country` | 换旗 |

### `v3_inspect` 的 16 个分区

`section` 取以下之一（缺省 `economy`）。**每个事实只在一个分区出现**（上下文经济）：
逐建筑行在 `buildings`（不在 `economy`），贸易路线在 `routes`（不在 `trade`），
各国对比在 `rankings`（不在 `v3_status`）。

| 分区 | 回答什么 |
| --- | --- |
| `economy` | GDP 分解 C+I+G+NX、各商品现价/基准/缺口、工资利润（逐建筑利润见 `buildings`） |
| `market` | 逐商品产出/需求/价格/状态、对外贸易与主要伙伴 |
| `fiscal` | 收入与支出逐项、国库/国债与利率、**债务压力**、私人逆差、租金、税率 |
| `labor` | 失业率、原始需求/劳动力、结构性缺口、工资、就业基础（劳动力市场视角） |
| `trade` | 进出口总额、分商品与伙伴货值、关税、进口容量（路线见 `routes`） |
| `routes` | 本国贸易路线：商品 / from→to / 等级 / 上月运量 / 进口方单位利差 / 所有者 |
| `buildings` | 每类建筑：配方（产出/投入）、造价、工程量与建造点、**逐建筑经营利润与开工率**、本国存量 |
| `construction` | 建造力构成（营造所 + 补贴）、队列、私人流转、租金 |
| `military` | 陆军/海军/士气/人力/质量、军费等级、战争与分数 |
| `pops` | 人口阶级结构（农民/工人/手工业者/教士/贵族/资本家）、识字率、生活水平、激进/忠诚（阶级视角） |
| `diplomacy` | 关系、盟友、对手、势力范围、禁运、贸易张力、局势 |
| `tech` | 科技等级、点数、研究方向、研究率分解（基础 + 大学） |
| `modifiers` | 各生效修正：来源 / stat / stack / value / 到期 |
| `rankings` | 列强五维排名数据（经济 / 人口与社会 / 军事 / 科技与行政 / 外交与威望） |
| `log` | 最近编年史；可用 `kind`（日志类型）与 `country`（国家 id）过滤，`limit` 控制条数 |
| `history` | 最近 12 个月 GDP/C/I/G/失业/收入/支出/关税/国债 序列 |

来源：`engine/inspect.ts`、ADR 0016、`hooks/register.tsx` 的 `v3_inspect` 工具规格。

### `v3_action` 的动作与参数

| action | 必填参数 | 其他参数 | 说明 |
| --- | --- | --- | --- |
| `build` | `building`、`count` | `count` 1..5 | 入队一座国有项目（每槽最多 5 座） |
| `cancel` | `projectId` | 无 | **仅国有**项目可取消；私人项目不可取消 |
| `tax` | `base`、`rate` | `base`∈ land/profit/consumption/tariff；`rate` 0..60 | 设定四大税基之一；省略 `base` 返回税菜单（见 §4.7） |
| `tariff` | `rate` | `rate` 0..60；`exportRate` 可选 0..60 | `rate` 是进口税率；省略 `exportRate` 则进出口同率 |
| `spending` | `category`、`amount` | `category`∈ army/navy/bureaucracy/education/welfare/construction；`amount` 0..50 | 设定支出等级 |
| `research` | `tech` | 无 | 指定研究方向（科技名） |
| `conscript` | `amount` | 约 1..20 | 征兵：加陆军、耗人力、加激进 |
| `law` | `name` | 无 | 教育改革 / 福利改革 / 自由贸易 / 保护关税 / 征兵制 / 宗教宽容 |
| `route` | `op`、`good`、`partner` | `op`∈ open/raise/lower/close | 贸易航线：开通/提升/降低/关闭 |

来源：`hooks/register.tsx` 的 `v3_action` 工具规格、`engine/sim.ts` 的 `applyDecision`。

## 4. 经济

### 4.1 GDP 是产出，不是国库收入

- **GDP = C + I + G + NX**（消费 + 投资 + 政府 + 净出口），**按基期价**估值（实际 GDP，
  避免产能扩张压低价格时名义 GDP 倒退）。
- NX 为净出口（基期价），已接入双边贸易；**可以为负**。
- **GDP 与国库收支不是同一本账**：国库只经手税入、关税、港口费、基金收益与赔款；
  GDP 是产出。对比两者时说明这一点。
- 每个最终用途块按「需求对有效供给」的满足比例填充，未满足的订单**压低** GDP 而不是吹高。

来源：README「支出法经济循环」、`engine/sim.ts` `computeEconomy`、GLOSSARY「支出法 GDP」。

### 4.2 商品与物价

14 种商品与基价（`basePrice`，单位「金」）：

| 商品 | id | 基价 | 商品 | id | 基价 |
| --- | --- | ---: | --- | --- | ---: |
| 粮食 | `grain` | 1.0 | 家具 | `furniture` | 3.2 |
| 木材 | `wood` | 1.2 | 机械 | `machinery` | 6.0 |
| 煤炭 | `coal` | 1.6 | 军械 | `arms` | 5.5 |
| 铁矿石 | `iron` | 1.0 | 钢铁 | `steel` | 2.2 |
| 布料 | `fabric` | 2.0 | 奢侈品 | `luxury` | 10.0 |
| 成衣 | `clothes` | 3.0 | 鸦片 | `opium` | 2.5 |
| 酒类 | `liquor` | 2.6 | 服务 | `services` | 4.0 |

- `iron` 是**铁矿石**（World v11 起；id 未变），由矿场产出、只作工厂炼钢的投入；`steel`（钢铁）
  由工厂用「铁矿石 + 煤」炼成，供铁路、建设投资与政府建设使用。

- **价格收敛**：目标价 `= basePrice × clamp(√(需求/供给), 0.35, 3)`，每月向目标移动 **30%**。
- **硬上下限**：`0.25 × basePrice` 与 `4 × basePrice`。
- `v3_inspect economy/market` 用 `↑`（价高于基价 5%）、`↓`（低于 5%）、`·` 标记盈亏。

来源：`engine/data.ts` `GOODS`、`engine/sim.ts` 价格步进。

### 4.3 建筑配方（单一真源，ADR 0021）

`engine/data.ts` 的 `BUILDING_RECIPES` 是**产出与中间投入的唯一来源**；`computeProduction`
只读该表。9 类建筑每座每月：

| 建筑 | output（每座/月） | input（每座/月） | labor | 门控 |
| --- | --- | --- | ---: | --- |
| 农场 `farms` | grain 0.30、wood 0.04、opium 0.004 | 无 | 0.3 | tech + infra + access（wood 除外） |
| 矿场 `mines` | coal 0.5、iron 0.42、wood 0.04 | 无 | 0.6 | tech（wood 除外） |
| 工厂 `factories` | fabric 0.6、clothes 0.28、liquor 0.14、furniture 0.16、machinery 0.18、arms 0.07、luxury 0.035、**steel 0.09** | grain 0.5、coal 0.18、**iron 0.45**、fabric 0.2、wood 0.1、machinery 0.18 | 1.0 | tech + industrial（liquor 仅 industrial） |
| 铁路 `railroads` | 无 | **steel 0.5**、wood 0.4 | 0.2 | 无 |
| 港口 `ports` | 无 | 无 | 0.4 | 无 |
| 大学 `universities` | services 0.2 | 无 | 0.2 | 无 |
| 兵营 `barracks` | arms 0.05 | 无 | 0.3 | 无 |
| 官署 `offices` | services 0.8 | 无 | 0.1 | 无 |
| 营造所 `workshops` | 无（产出建造点，`sim.ts` 特判） | wood 1、grain 0.6、iron 0.3 | 0 | 无 |

- **门控乘数**：tech `1 + 等级 × 0.07`；infrastructure `0.6 + 交通 / 160`；
  access `0.55 + 市场接入 × 0.9`；industrial 为煤铁禀赋因子（0.7~1.3）。
- **中间投入进入需求**（用于定价与贸易），但**不计入 GDP**；GDP 只算最终用途。
- 除逐建筑配方外，还有**国家级**项留在引擎里（手工业者产出、总人口服务项、鸦片国家
  `outputFactor`、工业城镇的煤(1.2)/铁矿石(0.6)/钢铁(0.2)/布(0.5)/木(0.3)消费，按 `popFactor`）。
  它们是历史口径，不随配方变动。
- **F1 铁矿石/钢铁拆分（World v11）**：`iron` 转为**铁矿石**（只作工厂炼钢的投入），新增
  **`steel`**；铁路、建设投资（`INVESTMENT_DEMAND`）、政府建设改吃钢铁，营造所**运行**投入仍为
  铁矿石（plan 0011 §9 待定，F2 再定）。工厂在参考点的加权**聚合毛利仍在 5–20% 带内**。
- **B5 工厂再平衡（ADR 0021、plan 0008 §5）**：工厂配方调轻了材料单、并下调成衣/酒/家具产出
  （见上表），使工厂在参考点可盈利。7 大国产量的加权**聚合工厂毛利落在 5–20% 带内**；
  工业核心 GBR/FRA/PRU 亦在带内，资源富集、工资低的 RUS/QING/JAP 在带上界之上（属预期）。
  F1（World v11）重定了工厂配方，带内性质由 `tests/economy-recipe-calibration.test.ts` 守住。
- **部分商品按设计为本地自给**：成衣、酒类、家具由各国**手工匠**（`ARTISAN_OUTPUT`）供给，
  军械由本地兵营供给，**不做全球双向贸易**（PT-002 的另一允许路径；写入 ADR 0021 与
  `tests/economy-recipe-calibration.test.ts`）。GM 不应指望在世界市场上买卖这四类商品；
  真正的全球双向交易商品是粮食/木材/煤/铁/布/机械等原料与中间品。

来源：ADR 0021、`engine/data.ts` `BUILDING_RECIPES`、`engine/sim.ts` `computeDemand`。

### 4.4 逐建筑经营利润 `buildingProfits`

- 每月按类计算快照：**利润 = 产出价值 − 中间投入价值 − 分摊工资**。
- **工资分摊可配置（plan 0008 B5）**：全国工资如何摊到各建筑类型由 `engine/data.ts` 的
  `WAGE_ALLOCATION = { basis, weights? }` 决定。`basis` 取：
  `'labor'`（按 `用工 × 座数`，旧口径）| `'valueAdded'`（按 `max(0, 产出价值 − 中间投入)`，
  **当前值**）| `'capitalPlusLabor'`（按 `用工 + 建造成本 × 0.25`）。`weights?` 可再按类型乘系数
  （当前未用）。三种 basis 都**精确**满足 `Σ buildingProfits.wages === 全国 wages`。
  （plan 0009 将把该常量迁到 `engine/config/economy.ts`；默认 `'valueAdded'`。）
- 单位：`profitPerBuilding`（金/座）、毛利率 `profit / revenue`。
- **自 B3（ADR 0022）起它已驱动决策**：
  - 产出按**上月**存储的 `utilization` 门控（亏损类目闲置，下界 0.5，一阶平滑 0.25）；
  - 深度亏损的类目每月额外萎缩（上限 0.02/月，计数永不为负）；
  - 私人投资**只建 `profitPerBuilding > 0`** 的类型。
- 该口径按**市场价、毛产出**估值，与宏观 `realGdp × (1 − laborShare)`（基期价、增值口径）
  不是同一个量；通常更大，仅供判断「这类建筑按现价赚不赚钱」。
- 查看：`v3_inspect buildings` 的逐建筑行（含「开工率 %」「闲置」标记）。

来源：ADR 0021、ADR 0022、`engine/data.ts`（`WAGE_ALLOCATION`）、`engine/inspect.ts` `economySection`。

### 4.5 消费、工资与利润、私人资本

- **消费（Stone-Geary）**：每种消费品有每 popFactor 的**生存底线**，超出部分按**收入弹性**
  分配（弹性和为 1）；实际只花掉超额收入的 **0.75**（`CONSUMPTION_PROPENSITY`，防支出乘数失控）。
  消费品：粮食、成衣、家具、酒类、服务、奢侈品。
- **劳动份额**：`laborShare = clamp(基准 − (失业 − 5) × 0.01, 0.35, 0.70)`；
  `wages = realGdp × laborShare`，`profits = realGdp × (1 − laborShare)`。
  各国基准不同（英国 0.52、大清 0.62 等）。
- **私人资本**：利润中储蓄下来、专门给私人建造出资的资金池；**不进国库、玩家不能直接征用**。
  可以为负：负值即**私人外债**（`max(0, −privateCapital)`），记在私人资产负债表上。
- **投资信心**：影响储蓄率与私人投资意愿的百分比偏移；AI 每月可在**基准上下 10 点**内调整，
  单月变动**±3**；政策与天命也可修正。

来源：`docs/plans/0003-economic-loop.md`、`engine/data.ts`（`SUBSISTENCE`/`INCOME_ELASTICITY`/
`CONSUMPTION_PROPENSITY`）、`engine/sim.ts`、GLOSSARY（私人资本/私人外债/投资信心）。

### 4.6 建造能力

- **营造所产出建造点**：每座每月 **4 点**，受科技、交通、市场接入与**原料可得性**约束
  （木、粮、铁不够则打折）。
- **工程量**：`工程量 = 单座月度点数 × 30`。单座营造所 = `1.5 × 30 = 45` 点；5 座 = 225 点。
- **工期 = 剩余工程量 ÷ 每月实际投入**，不再有固定月份。国有队列**按入队顺序**分配；
  每个 entry 每月可拿 `min(队列剩余建造力, 本项目剩余工程量)`，**没有每槽月度上限**。
- **每槽最多 5 座**；每月订单数量不限。每点工程量造价 **0.2 金**（乘数/加数 v1 全为 1/0）。
- **私人项目**：自建 **50%**；可**租用国有闲置建造点**，租金 **0.3 金/点**入国库
  （记为收入「其他」）。分配完后剩余点也按 0.3 金/点出租给私人。
- **建设补贴**（`spending.construction`）：每级每月 **+1.5 建造点、花 0.45 金**；
  补贴点与营造所产点同质，同样受原料约束；没有营造所时补贴不产生建造力。

每座每月的建造点需求（`CAPACITY_COST`）：营造所/港口 1.5、农场 0.5、矿场/兵营/官署 1、
工厂/大学 2、铁路 4。

来源：ADR 0010/0012/0013/0015、README「建造能力」、`engine/sim.ts`（`CAPACITY_COST`/
`WORKLOAD_MULTIPLIER=30`/`CONSTRUCTION_COST_PER_POINT=0.2`/`CONSTRUCTION_RENT_PER_POINT=0.3`）。

### 4.7 税制（四税基，ADR 0023）

**现状（World v10 起）**：税入按**四个真实税基**累加，**GDP 不再是税基**（它只是派生的产出指标）：

| 税基 | 税基量 | 承担者 |
| --- | --- | --- |
| **土地税** `land` | `resources.farmland × 4`（地价系数） | 地主 / 农业 |
| **企业所得税** `profit` | `Σ_建筑 max(0, buildingProfit.profit)`，**逐建筑单独算后累加** | 资本 / 经营体 |
| **消费品消费税** `consumption` | Stone-Geary 的**最终消费**货值（**仅最终消费，不含中间投入**） | 消费者 |
| **关税** `tariff` | 进出口货值（含贸易路线），在边境征清 | 进出口商 |

统一式（土地税 / 企业税 / 消费税）：

```
税额 = 税基量 × 税率 × 征收效率 × 合规 × 债务削减
征收效率 = clamp(0.35 + 官僚效能/200 + 合法性/400, 0.3, 1.1) × taxEfficiency
合规     = 税率 ≤ 25% 时为 1，>25% 起按 1 − (税率−25)×0.015 侵蚀，下限 0.45（逐基）
债务削减 = 1 − 债务压力收入惩罚
```

- **关税**：`税额 = 边境实收 duty × 债务削减`（在边境一次征清，征收效率按设计为 1）。
- **初始税率**：土地 2% / 企业 2% / 消费 3%（关税取各国种子值，5%~20%），
  四基合计与旧 GDP 比例制相当（无财政冲击）。
- **税负归属**：私人可支配收入按私人税负（土 + 企 + 消，**不含关税**）扣减，
  闭合宏观循环、避免重复计征；关税在边境由进出口商一次缴清。
- **查看**：`v3_inspect fiscal` 逐基显示**税基量 / 税率 / 税额**。
- **设置**：`v3_action tax { base, rate }`，`base ∈ land/profit/consumption/tariff`（0..60）；
  省略 `base` 返回四基菜单与当前税率。
- **务必**：不再声称「税入 = GDP 比例」；按 `v3_inspect fiscal` 的税基逐项解释。

来源：ADR 0023、`engine/fiscal.ts`（`taxBaseRevenues`/`collectionEfficiency`/`taxCompliance`）、
`engine/economy.ts`（税基量快照）、`docs/plans/0008-economy-remake.md` §4。

## 5. 贸易

- **持久双边航线**（ADR 0020，World v8）：航线存在 `world.tradeRoutes`，有等级与所有者
  （国有/私人）。每月清算**两遍**：
  1. **航线遍**（先）：按航线折扣到岸价优先成交，**不含关系风险**；端点交战、该商品被禁运、
     或进口方关系低于 **-50** 时跳过（供给留给现货）。
  2. **现货残差遍**（后）：用剩余 offer/bid 按现货价加摩擦（×1.15）、候选更窄（Top-3）。
  **没有航线也能贸易**（软闸门）。
- **成长/衰退**：运量达容量 **80%** 且有利可图则升级（最高 5 级），否则降级、归零即删除；
  被切断的航线当月运量 0 并衰退。AI 每月每国最多自动开通 1 条；1836 开局自带种子航线。
- **玩家操作**：`v3_action route` 的 `open`/`raise`/`lower`/`close`，方向由两端净盈余决定
  （盈余大者出口）。校验：商品可贸易、伙伴存在、非本国、非交战、非禁运。
- **到岸价**：`出口国国内价 × (1 + 出口国出口税) × (1 + 进口国进口税) × 区域运输 ×
  市场接入 × 交通 × 关系风险`。航线价另乘折扣 0.9 且不含关系风险。
- **双关税**（ADR 0009/0014）：`tariff` 是**进口税率**，`exportTariff` 可选、缺省与进口同率；
  自由贸易把两个税率降到 **5% 下限**。进口国国库收进口税，出口国国库收出口税。
- **结算**（ADR 0008）：进口国**私人**付边境价 + 进口税；出口国**私人**收国内价、
  出口国国库收出口税。**私人进口逆差由私人资本/私人外债承担，不扣国家净资产**；国库只收关税。
  支付能力 = 出口收入 + `max(0, privateCapital)` + `GDP × 3%`。
- 战争自动切断交战双方全部贸易；禁运按商品或全部切断；关系低于 -50 硬切断（外交仍可回暖）。

来源：ADR 0020/0009/0014/0008、`engine/trade.ts`、`docs/plans/0004-trade-diplomacy.md`、
GLOSSARY（航线/到岸成本/软容量/禁运）。

## 6. 财政

- **国库 = 净资产（单一余额）**：`treasury > 0` 是**主权基金**（按基金月息生息）；
  `treasury < 0` 是**国债**（按国债月息付息）。没有独立的债务存量或还本步骤。
- **债务压力**（ADR 0007）：`ratio = 债务 / GDP`，`severity = clamp((ratio − 0.25)/1.75, 0, 2)`。

  | 债务/GDP | 标签 | 收入惩罚 | 建设速度 | 合法性目标 | 月息加成 |
  | ---: | --- | ---: | ---: | ---: | ---: |
  | < 25% | 无 | 0 | 0 | 0 | 0 |
  | 25%~50% | 轻度 | 0~1.4% | 0~2.9% | 0~0.7 | 0~0.06% |
  | 50%~100% | 中度 | 1.4%~4.3% | 2.9%~8.6% | 0.7~2.1 | 0.06%~0.17% |
  | 100%~200% | 重度 | 4.3%~10% | 8.6%~20% | 2.1~5 | 0.17%~0.4% |
  | ≥ 200% | 危重 | 10%~20% | 20%~40% | 5~10 | 0.4%~0.8% |

  **3× GDP 是重组底线**：越线后降债到 1.5× GDP 并进入 12 个月重组窗口。**轻微负净资产不冻结建设。**
- **收入拆分**：税入 + 关税（进+出）+ 港口 + 基金收益 + 赔款收入 + 其他（建造力出租）。
- **支出拆分**：陆军 + 海军 + 行政 + 教育 + 福利 + 债息 + 市场损耗 + 设施维护 + 赔款支出 +
  国有建设 + 建设补贴。
- **赔款**：胜方声明总额与最长分期月数；败方自行决定一次付清多少、余款分几期；分期部分每月
  计入付款方支出与收款方收入，日程在 `world.indemnities`。默认总额 = 败方 GDP × 10%，最长 60 个月。
- **国库净额 = 收入 − 支出**；私人逆差**不在**这个账里（见 §5、§9）。

来源：ADR 0006/0007、`engine/fiscal.ts`、README「国库 = 净资产」「债务压力」「国库收支账」。

## 7. 人口 / 劳动 / 社会

- **失业率**是**结构性**指标：由工厂吸纳能力、识字率与激进共同决定（`deriveUnemployment`），
  口径上**不等于** `1 − 劳动需求/劳动力`。
- `v3_inspect labor` 并列显示：失业率、**原始需求/劳动力**利用率与「结构性缺口」；
  并给出就业基础（农田/矿场/工厂/营造所/铁路/港口）。
- **劳动需求**由各建筑配方 `labor × count` 汇总；**劳动力** = `peasants×0.6 + workers + artisans`。
- **生活水平（sol）**、**识字率**、**激进**、**合法性**、**城市化**都在月度结算里更新；
  `sol` 与粮价联动（饥荒触发条件见 §8）。
- **官僚效能**（0~100 派生分）：由官僚支出、识字率、行政能力、政府类型与激进共同决定，
  受**官署**抬高上限；决定每月行动预算、资金效率、工期延迟与信息失真。
- **行政能力**：由官署、识字与税制构成，进入官僚效能的原始分。

来源：`engine/data.ts`（`deriveUnemployment`/`deriveLabor`/`deriveBureaucracy`/`administrativeCapacityFor`）、
`engine/inspect.ts` `laborSection`、GLOSSARY（官僚效能/行政能力/官署）。

## 8. 科技 / 军事 / 外交 / 事件

### 科技

- **基础研究率**（ADR 0018）：`base = 2 + 识字率 × 3 + 官僚效能 × 0.06`；
  大学是主要放大器：`+ 大学数 × 0.9 × (0.4 + 识字率) × (1 + 教育支出 × 0.03) × (1 + 科技等级 × 0.02)`。
- 10 级科技（`TECHS`），升级消耗 `techCost`；开局大清约 4 点/月。

### 军事

- 军力 = 陆军、海军、士气、质量、人力、战争疲劳；军费按兵力计算基本维持费，
  砍到 0 级也不会消失。
- 战争以双方陆军质量、士气、科技计算的战争分数推进，**75 分或 60 个月**结束。

### 外交动作（`v3_diplomacy`）

| move | 效果要点 |
| --- | --- |
| `improve` | 关系 +（默认 8，可给 `amount`）；双向，对方加分略少 |
| `insult` | 关系 −15（双向） |
| `alliance` | 结盟；要求不互为对手且关系 ≥ 30 |
| `rival` | 设为对手，关系 −30 |
| `gift` | 赠礼（扣国库）；关系 +`amount×2` |
| `war` | 宣战，可给 `goal`（见下）；双方关系 −50，恶名 +10 |
| `peace` | 停战；本方获胜时可用 `indemnityTotal`/`indemnityMonths` 声明赔款总额与最长分期月数 |
| `embargo` / `unembargo` | 禁运/解除（可指定 `good` 与 `months`）；禁运关系 −15、解除 +5 |
| `tension` | 就敏感商品（鸦片/军械/粮食）施加贸易张力，`relationDelta` 在 ±10 内，**下月生效** |

**战争目标**（`goal`，决定胜利后可索取的和约条款）：

| goal | 胜利效果 |
| --- | --- |
| `reparations` 赔款 | 战败方支付；胜方威望 +10；败方合法性 −5 |
| `openMarket` 开放市场 | 战败方关税 −10、市场接入 +0.15（24 个月）；胜方收入 +5%（24 个月） |
| `sphere` 势力范围 | 战败方进入胜方势力范围；胜方市场接入 +0.05（24 个月） |
| `humiliation` 威望羞辱 | 胜方威望 +15；败方威望 −15、合法性 −8 |

### 局势与事件

- **局势**（如**鸦片危机**）：跨月外交危机，参与者提交立场与提案，仲裁从预置结果包中选一个，
  引擎落账。鸦片危机触发窗口 1839.01~1842.12、QING 与 GBR、鸦片进口 ≥2 单位/月或份额 ≥20%、
  关系 ≤ −10 且未交战。玩家用 `v3_situation` 提交立场
  （`crackdown` 禁烟 / `compromise` 妥协 / `war` 开战 / `aid` 求援 / `neutral` 观望）。
- **随机事件**（`v3_event`）：丰年、饥荒、工业繁荣、经济萧条、革命浪潮、边疆危机、技术突破、
  领袖病重、殖民地动荡、外交照会等，各有多个选项，效果包括国库、激进、合法性、威望、军队、
  人口、科技点与双边关系。
- **饥荒触发条件**（ADR 0019）：生活水平 < 45 **且** 粮价 ≥ 基准 × 1.05；粮食过剩时不再触发。

来源：ADR 0018/0019、`engine/data.ts`（`TECHS`/`EVENT_TEMPLATES`）、`engine/sim.ts`（研究率/war goal）、
`docs/plans/0004-trade-diplomacy.md` §4/§5、`hooks/register.tsx`。

## 9. 口径速查 / FAQ（「为什么变了」）

| 现象 | 原因 | 去哪看 |
| --- | --- | --- |
| 已付建设款，GDP 的 I 却是 0 | 投资需求读**上月实际建设支出**（防幽灵投资），**滞后一月** | `v3_inspect history`（逐月 C/I/G） |
| 收入 > 支出，净资产仍下降 | 私人进口逆差由**私人资本/私人外债**承担，**不进国库账** | `v3_inspect fiscal`（私人逆差、私人外债） |
| 出口为 0，不知为什么 | 全球可能没有 bid，或伙伴关系/禁运/战争切断 | `v3_inspect trade`、`market`（伙伴与货值） |
| 关税收入翻倍 | 进口税与出口税两个方向之和，或贸易量上升 | `v3_inspect fiscal`（含税率行） |
| 税入与 GDP 不再按比例 | 已改为**四税基**（土地 / 企业 / 消费 / 关税），GDP 只作派生产出指标 | `v3_inspect fiscal`（每基税基量/税率/税额）、§4.7 |
| 税入随租金缩放、GDP 上升税反降 | 「其他（建造力出租）」入账时差曾被并入上月收入；现已用 `lastIncomeOther` 修正口径 | `v3_inspect fiscal` |
| 失业率与「原始利用率」不一致 | 失业率是**结构性**指标，含工厂吸纳、进口竞争与在职不足；原始利用率只反映需求缺口 | `v3_inspect labor` |
| 自由贸易后关税不是 0 | 自由贸易下限 **5%**，且进出口各收一次 | `v3_inspect fiscal`、README「双向关税」 |
| 债务很小却出现压力 | 看的是**债务/GDP 比例**（25% 起），不是绝对额 | `v3_inspect fiscal`、`v3_status` 债务压力行 |
| 私人项目不可取消/出现很慢 | 私人项目**不可取消**；每两月最多开工一次、最多三单在途（ADR 0017），且只建有利润的类型（ADR 0022） | `v3_inspect construction` |
| 建筑看起来在但产出低 | 该类目可能**闲置**（开工率 < 100%），按上月利润门控（ADR 0022） | `v3_inspect buildings`（逐建筑开工率） |

来源：`docs/playtest-issues.md`（PT-004/006/008/010/013/014/019/023/026/028/029/031）、ADR 0016/0017/0022。

## 10. 在建（本手册将随后续包更新）

- **plan 0008 经济 remake**：
  - **B1~B3 已落地**：`BUILDING_RECIPES` 配方单一真源、逐建筑 `buildingProfits` 快照、
    利用率与利润驱动的私人投资（ADR 0021、ADR 0022，World v9）。
  - **B4 已落地**：**四税基**（土地税 / 企业所得税逐建筑单算 / 消费品消费税 / 关税），
    移除 GDP 比例税基；`v3_action tax` 改按 `base` 设税率（ADR 0023，World v10）。
  - **B5 已落地**：**配方 + 工资分摊再平衡**（`WAGE_ALLOCATION`，默认 `'valueAdded'`），
    工厂转为可盈利；消费品按设计判为**本地自给**，收敛 PT-002 / PT-001。
  - **B6（本次）**：文档同步（本手册、README、GLOSSARY、playtest 状态）。
- **未完成的后续工作 = config-block 重构（ADR 0024 / plan 0009，取代 ADR 0004）**：
  配置分层（`engine/config/` + `engine/data/`）与统一 `ConfigBlock` 乘数机制，
  增量 TDD、每步一个提交、第一刀行为保持，里程碑 **C1–C7**；不升世界版本。
- 经济口径已全部落地，§4.4（利润口径）、§4.7（税制）与 §9 均已按 shipped 状态更新；
  实际数值以 `v3_inspect` 的分区输出为准。

来源：`docs/plans/0008-economy-remake.md` §6、`docs/plans/0009-config-refactor.md`、
`docs/playtest-issues.md` PT-031。

---

### 主要来源索引

- 边界与工具：`docs/plans/0006-gm-engine-interface.md`、ADR 0003/0016、`hooks/register.tsx`、`engine/inspect.ts`
- 回合：ADR 0001、README、`hooks/register.tsx`
- 经济：`docs/plans/0003-economic-loop.md`、ADR 0021/0022、`engine/data.ts`、`engine/sim.ts`
- 税制：`engine/fiscal.ts`、`docs/plans/0008-economy-remake.md`
- 贸易：ADR 0008/0009/0014/0020、`engine/trade.ts`、`docs/plans/0004-trade-diplomacy.md`
- 财政：ADR 0006/0007、`engine/fiscal.ts`
- 人口/科技/军事/外交/事件：ADR 0018/0019、`engine/data.ts`、`engine/sim.ts`、plan 0004
- 口径：`docs/playtest-issues.md`、GLOSSARY.md、README.md
