# 终末传奇 · Game Master (GM) 机制手册

本手册写给**扮演主要大国的 GM（LLM）**：你不读引擎源码、不读存档，所有世界状态
与操作都通过 MCP 工具完成。这一份文档就是你的唯一机制参考，遇到「为什么变了」先翻它，
再按指向调用 `v3_inspect`。

> 世界版本：**v14**（**23 类建筑**、**生产建筑 I–V 分级与 IV/V 电气化投入**（plan 0016/ADR 0032）、建筑配方与利用率/利润驱动投资、**四税基**、**铁矿石/钢铁**拆分、
> **统一基础设施**（铁路/港口/电报合并为单一「基础设施」、运河删除，plan 0014/ADR 0029）、建筑 `unlock` 前向字段均已落地，ADR 0021/0022/0023/0026/0029/0032；另有 **16 个 `v3_inspect`
> 分区 + `v3_forecast` + `v3_manual`**、**逐回合实时事件 E1–E7**（ADR 0025，World v13）。
> 数值口径以工具返回为准，本手册只解释**为什么**，不复述**是多少**。

---

## 1. GM 边界

- **查询状态只走 MCP 工具**：`v3_status`（摘要）、`v3_inspect`（明细）、`v3_forecast`（预测）。
  绝不读取 `.terminal-legend/save.json`；存档是引擎内部表示，结构随世界版本变化。
- **写入只走工具**：`v3_action` / `v3_policy` / `v3_diplomacy` / `v3_event` / `v3_leader` /
  `v3_control` 等；你不直接改引擎状态。
- **源码只在用户明确要求开发/修复时读**。游玩决策不得靠读源码推断规则。
- **遇到「为什么变了」→ 先用 `v3_inspect` 回答，不要猜**。每个分区对应一类问题（见 §3、§9）。
- 数值一律以工具返回为准，**不要编造数字**；工具给不出时就说明「工具未提供」。

来源：`docs/plans/0006-gm-engine-interface.md`、ADR 0003、ADR 0016、`CLAUDE.md`。

## 2. 回合与节奏

- **没有实时时钟**：每月推进后停在**御前会议**，玩家审阅月报、处理事件、批准推进。
- **`v3_advance`**：批准推进一月（`months` 缺省 1）。**只有玩家可推进**，秘书调用会被审计。
- **托管**：`months > 1` 进入后台托管，遇以下情况**中断**并提示：
  待决事件、新的战争、战争结束、秘书越权（`councilInterrupt` + 秘书连续越权计数）。
- **手动停止托管**：托管启动文案会提示「`/v3 stop` 可随时停下」。玩家/GM 用 **`/v3 stop`**
  命令或 **`v3_control { action: "stop" }`** 即可请求停止；停止是**协作式标志**，
  **当前月推进结束后**才生效（世界永不半结算），随后回到御前会议，
  中断原因记作「手动停止」。没有托管在跑时返回「当前没有正在进行的托管」。
  **秘书无此授权**（`v3_control` 不在其工具列表；若仍调用会被审计为「控制托管」）。
- **秘书**：`/v3 secretary` 召见，一个 haiku 子代理，在玩家授权的内政/外交范围内起草并执行；
  连续越权第 4 次起运行时拒绝。军事与战争**永远由玩家亲自决定**。
- **铁人（ironman）**：仅开局第一个月可切换；禁用天命、只保留自动存档、不能读其他存档。
- **天命（`v3_cheat`）**：金钱/科技点/建筑/关系/战争分数/日期/事件/领袖/修正，
  铁人模式拒绝。使用它会记入编年史。

来源：ADR 0001、README「月度御前会议」、`hooks/`（`register.tsx` 入口、`council.ts` 的 advance / interrupt）。

## 3. 工具速查表

| 工具 | 作用 | 关键参数 | 何时用 |
| --- | --- | --- | --- |
| `v3_status` | 完整状态摘要：本国财政、人口、军力、科技、待决事件、战争、队列 | 无 | 回答任何需要具体数字的问题**之前**先调它 |
| `v3_inspect` | 只读明细，按 `section` 分区 | `section`（`log` 另可 `kind`/`country`/`limit`） | 「为什么变了」的默认答案来源 |
| `v3_forecast` | 下月现金流预估（收入、支出、净额、结算后国库、建造力分配） | 无 | 推进前预判财政；**是计划值**，会偏移 |
| `v3_manual` | 返回本手册全文（`docs/gm-handbook.md`） | 无 | 需要机制口径时读规则，无需打开文件 |
| `v3_advance` | 批准推进一月；`months>1` 托管 | `months` 1..24 | 玩家批准时间推进 |
| `v3_control` | 运行控制：停止托管 / 存档 | `action`∈ `stop`/`save` | 想提前停下后台托管（`stop`）；秘书无权调用，越权会审计 |
| `v3_action` | 内政行动（见下表） | `action` 及各行动参数 | 建造/升级（可插队）、取消、重排队列、税率、关税、支出、研究、征兵、法案、贸易路线 |
| `v3_policy` | 提交政策提议：一组效果条目变成可叠算 buff/debuff | `name`、`effects[]`（`stat`/`stack`/`value`/`months`/`label`）、`authorityCost` | 常规施策，不针对特定局势 |
| `v3_diplomacy` | 外交行动（改善/交恶/结盟/对手/赠礼/宣战/停战/禁运/解除禁运/贸易张力/**封锁/解除封锁**） | `target`、`move` + 各 move 参数 | 双边外交与战争 |
| `v3_situation` | 就当前局势（如鸦片危机）提交立场 | `action`(submit/abstain)、`stance`、`narrative` | 局势开启时 |
| `v3_event` | 列出或处理待决事件 | `eventId`、`optionId`（省略 `eventId` 则列出） | 处理随机/局势事件 |
| `v3_leader` | 记录与该国领袖的交流，调情绪/关系，暂停其后台 AI 12 回合 | `country`、`message`、`mood`、`relation` | 玩家与该国领袖对话后 |
| `v3_save` | 保存 | `name`（可选；铁人不能命名） | 玩家要求存档 |
| `v3_play` | 切换玩家扮演的国家 | `country` | 换旗 |

### `v3_inspect` 的 16 个分区

`section` 取以下之一（缺省 `economy`）。**每个事实只在一个分区出现**（上下文经济）：
逐建筑行在 `buildings`（不在 `economy`），贸易路线在 `routes`（不在 `trade`），
各国对比在 `rankings`（不在 `v3_status`）。**`economy`/`market`/`fiscal` 读的是上月结算快照**
（与 `v3_status` 同源），分区标题会注明口径。

**查他国（PT-074）**：除 `log` 外，每个分区都接受 **`country`** 参数指定主体国家，
缺省为本国。例如 `v3_inspect { section: "fiscal", country: "GBR" }` 读英国的四税基、税率与债务，
`section: "economy"` 同样可指向任意列强——基本经济数据不再是本国专有。
`log` 分区里的 `country` 是**日志行过滤**，不是主体选择。

| 分区 | 回答什么 |
| --- | --- |
| `economy` | **结算快照**：GDP 分解 C+I+G+NX（NX 已接入贸易、`C+I+G+NX = GDP`，与 `v3_status` 一致）、各商品现价/基准/缺口、工资利润（逐建筑利润见 `buildings`） |
| `market` | **结算快照**：逐商品 产出/进口/出口/**有效供给**/价格/状态（状态按有效供给 = 产出 + 进口 − 出口 判定）、对外贸易与主要伙伴 |
| `fiscal` | 收入与支出逐项、国库/国债与利率、**债务压力**、私人逆差、租金；税基行显示 `税基量 × 税率 × 征收效率 = 税额` |
| `labor` | 失业率、原始需求/劳动力、结构性缺口、**部门来源**（劳动需求按利用率为权，闲置部门释放劳力）、工资、就业基础（劳动力市场视角） |
| `trade` | 进出口总额、分商品与伙伴货值、关税、进口容量（路线见 `routes`） |
| `routes` | 本国贸易路线：商品 / from→to / 等级 / 上月运量 / 进口方单位利差 / 所有者 |
| `buildings` | 每类建筑：配方（产出/投入）、造价、工程量与建造点、**逐建筑经营利润与开工率**、本国存量 |
| `construction` | 建造力构成（营造所 + 补贴）、队列（每条带 **`#index`** 与 **`id=<projectId>`**，供 `cancel`/`reorder` 引用）、私人流转、租金 |
| `military` | 陆军/海军/士气/人力/质量、军费等级、战争分数与 **seaPower / 制海权档位** |
| `pops` | 人口阶级结构（农民/工人/手工业者/教士/贵族/资本家）、识字率、生活水平、激进/忠诚（阶级视角） |
| `diplomacy` | 关系、盟友、对手、势力范围、禁运、贸易张力、局势 |
| `tech` | 科技时代（I–IV）、已解锁节点、点数、当前研究方向、月产出分解（基础 + 大学）、跨分支溢出率、国际扩散加成 |
| `modifiers` | 各生效修正：来源 / stat / stack / value / 到期 |
| `rankings` | 列强五维排名数据（经济 / 人口与社会 / 军事 / 科技与行政 / 外交与威望） |
| `log` | 最近编年史；可用 `kind`（日志类型）与 `country`（国家 id）过滤，`limit` 控制条数 |
| `history` | 最近 12 个月 GDP/C/I/G/失业/收入/支出/关税/国债 序列 |

来源：`engine/inspect/`（`index.ts` 调度 + 16 个分区模块）、ADR 0016、`hooks/tools.ts` 的 `v3_inspect` 工具规格。

### `v3_action` 的动作与参数

| action | 必填参数 | 其他参数 | 说明 |
| --- | --- | --- | --- |
| `build` | `building`、`count` | `count` 1..5（每槽座数）；**`slots` 1..50（默认 1，槽数）**；`tier`（1-based，默认 1 = I 级，须已解锁）；`position`∈ head/tail/before/after（默认 tail）、`before`（before/after 的锚点项目 id） | 入队国有项目。**`x*y` 聚合下单**：`count=x, slots=y` 一次生成 y 个各含 x 座的队列条目（逐槽完工，绝不打包成一单）；可指定目标等级或插队首/某条目之前/之后（ADR 0027 / PT-078） |
| `upgrade` | `building`、`fromTier`、`toTier`、`count` | `fromTier`/`toTier` 为 1-based 等级（如钢铁厂 I→II 为 1→2）；`count` 无 5 座上限，但不得超过来源等级未被预约的存量座数；可选 `position`/`before` | 把存量座位从低等级改造成高等级（`toTier` 须已解锁）；**营造所也可升级**；工程量随目标等级膨胀（ADR 0031/0032、plan 0016 §S7） |
| `cancel` | `projectId` **或** `index` | `index` 为 1-based 队列序号（见 `v3_inspect construction`） | **仅国有**项目可取消；私人项目不可取消；未命中时错误会列出「可用项目」 |
| `reorder` | `projectId` **或** `index`、`position` | `before`（before/after 的锚点 id） | 调整既有国有条目的队列顺位（head/tail/before/after）；**保留已投入进度**；私人项目不可重排 |
| `tax` | `base`、`rate` | `base`∈ land/profit/consumption/tariff；`rate` 0..60 | 设定四大税基之一；省略 `base` 返回税菜单（见 §4.7） |
| `tariff` | `rate` | `rate` 0..60；`exportRate` 可选 0..60 | `rate` 是进口税率；省略 `exportRate` 则进出口同率 |
| `spending` | `category`、`amount` | `category`∈ army/navy/bureaucracy/education/welfare/construction；`amount` 0..50 | 设定支出等级 |
| `research` | `tech` | 无 | 指定研究方向为某科技**节点 id**（如 `industry-1`、`general-1850`）；省略 `tech` 返回当前可研究节点清单（校验前置 + 时代门槛） |
| `conscript` | `amount` | 约 1..20 | 征兵：加陆军、耗人力、加激进 |
| `law` | `name` | 无 | 教育改革 / 福利改革 / 自由贸易 / 保护关税 / 征兵制 / 宗教宽容 |
| `route` | `op`、`good`、`partner` | `op`∈ open/raise/lower/close | 贸易航线：开通/提升/降低/关闭 |

来源：`hooks/tools.ts` 的 `v3_action` 工具规格、`engine/actions/decision.ts` 的 `applyDecision`。

## 4. 经济

### 4.1 GDP 是产出，不是国库收入

- **GDP = C + I + G + NX**（消费 + 投资 + 政府 + 净出口），**按基期价**估值（实际 GDP，
  避免产能扩张压低价格时名义 GDP 倒退）。
- NX 为净出口（基期价），已接入双边贸易；**可以为负**。
- **口径（PT-041/042）**：`v3_inspect economy` 读的是**存储的结算快照**（`country.econ.gdp` /
  `gdpComponents`），其 NX 已接入贸易结算，`C+I+G+NX = GDP`，**与 `v3_status` 的 GDP 一致**；
  `v3_status` 的 GDP 分解行也已补上「净出口」。若两个分区数字有差，先确认是否跨了月份。
- **GDP 与国库收支不是同一本账**：国库只经手税入、关税、基建费、基金收益与赔款；
  GDP 是产出。对比两者时说明这一点。
- 每个最终用途块按「需求对有效供给」的满足比例填充，未满足的订单**压低** GDP 而不是吹高。

来源：README「支出法经济循环」、`engine/economy.ts` `computeEconomy`、GLOSSARY「支出法 GDP」。

### 4.2 商品与物价

18 种商品与基价（`basePrice`，单位「金」）：

| 商品 | id | 基价 | 商品 | id | 基价 |
| --- | --- | ---: | --- | --- | ---: |
| 粮食 | `grain` | 1.0 | 家具 | `furniture` | 3.2 |
| 木材 | `wood` | 1.2 | 机械 | `machinery` | 5.2 |
| 煤炭 | `coal` | 1.6 | 军械 | `arms` | 5.5 |
| 铁矿石 | `iron` | 1.0 | 钢铁 | `steel` | 2.6 |
| 布料 | `fabric` | 2.0 | 奢侈品 | `luxury` | 10.0 |
| 成衣 | `clothes` | 3.0 | 鸦片 | `opium` | 2.5 |
| 酒类 | `liquor` | 2.6 | 服务 | `services` | 4.0 |
| **船只** | `ships` | **8.0** | 化工品 | `chemicals` | 3.0 |
| 电力 | `electricity` | 2.0 | 机车 | `locomotives` | 8.0 |

- `iron` 是**铁矿石**（World v11 起；id 未变），由铁矿产出、只作**钢铁厂**炼钢的投入；`steel`（钢铁）
  由钢铁厂用「铁矿石 + 煤」炼成，供基础设施、建设投资、政府建设与机械/军械/家具使用。
- `electricity`（电力）**不可贸易**（`NON_TRADABLE`，只作建筑 IV/V 级的投入、由发电厂自产）；
  `chemicals` 由 `industry-5` 解锁需求，`locomotives` 供基础设施建造（plan 0015/0016）。

- **价格收敛**：目标价 `= basePrice × clamp(√(需求/供给), 0.35, 3)`，每月向目标移动 **30%**。
- **硬上下限**：`0.25 × basePrice` 与 `4 × basePrice`。
- **供给取有效供给（PT-040）**：价格公式的「供给」是**有效供给 = 国内产出 + 进口 − 出口**
  （不是只看国内产出）。`v3_inspect market` 为**结算快照**，每行显示 **产出 / 进口 / 出口 /
  有效供给**，状态标记也按有效供给判定——所以「产出 < 需求」但价格接近基准是正常的
  （缺口由进口补上）。价格引擎本身无误，此前只是报表口径漏了进出口。
- `v3_inspect economy/market` 用 `↑`（价高于基价 5%）、`↓`（低于 5%）、`·` 标记盈亏。

来源：`engine/data/goods.ts` `GOODS`、`engine/economy.ts` 价格步进。

### 4.3 建筑配方（单一真源，ADR 0021）

`engine/data/buildings.ts` 的 `BUILDING_RECIPES`（I 级基准）与其 `tiers[]`（II–V）是**产出与中间投入的唯一来源**；
`computeProduction` 经 `recipeAt`/`mixedRecipe` 只读该表（混级按座加权）。23 类建筑中 **18 类有 I–V 分级**
（`schools`/`universities`/`offices`/`barracks`/`forts` 无分级）；下表列 **I 级基准**配方，每座每月。
**IV/V 级换入 `electricity`**（族分档，含煤家族同时置换 `coal`；`powerPlants`/`farms` 不耗电）；
**营造所 II 级起引入钢铁（铁矿石随级递减）、III 级加机械、IV/V 级加电力**（plan 0016 附录 A / ADR 0032）：

| 建筑 | output（每座/月） | input（每座/月） | labor | 门控 |
| --- | --- | --- | ---: | --- |
| 农场 `farms` | grain **0.20**、wood 0.04、opium 0.004 | 无 | 0.3 | tech + access（wood 除外） |
| 煤矿 `coalMines` | coal 0.96 | 无 | 0.6 | tech |
| 铁矿 `ironMines` | iron 0.96 | 无 | 0.6 | tech |
| 伐木场 `lumberMills` | wood 0.96 | 无 | 0.4 | tech |
| 纺织厂 `textileMills` | fabric 2.0、clothes 0.2 | grain 1.0、coal 0.18、wood 0.1、machinery 0.18 | 0.9 | tech + industrial |
| 家具厂 `furnitureWorks` | furniture 0.693 | wood 0.027、coal 0.045、fabric 0.315、**steel 0.081**、machinery 0.045 | 0.7 | tech + industrial |
| 酿酒厂 `distilleries` | liquor 0.855 | grain 0.6075、coal 0.09、wood 0.0495、machinery 0.0855 | 0.6 | tech + industrial（liquor 仅 industrial） |
| 机械厂 `machineryWorks` | machinery 0.8 | **steel 0.55**、coal 0.2、wood 0.1、machinery 0.18 | 1.0 | tech + industrial |
| 钢铁厂 `steelMills` | **steel 4.0** | **iron(铁矿石) 3.2**、coal 1.0、machinery 0.1 | 1.0 | tech + industrial |
| 兵工厂 `arsenals` | arms 1.0 | **steel 0.36**、machinery 0.18、coal 0.12、iron 0.18 | 0.9 | tech + industrial |
| 奢侈品厂 `luxuryWorks` | luxury 0.48 | fabric 1.5、coal 0.26、wood 0.14、machinery 0.24 | 0.8 | tech + industrial |
| 化工厂 `chemicalWorks` | chemicals 1.5 | coal 0.5、iron 1.25、machinery 0.2 | 1.0 | tech + industrial |
| 发电厂 `powerPlants` | electricity 2.8 | coal 0.6、machinery 0.2、steel 0.7 | 1.0 | tech + industrial |
| 机车厂 `locomotiveWorks` | locomotives 0.8 | steel 1.0、machinery 0.2、coal 0.4 | 1.0 | tech + industrial |
| 学校 `schools` | services 0.1 | 无 | 0.15 | access |
| 基础设施 `infrastructure` | 无 | **steel 0.2**、wood 0.16 | 0.54 | 无 |
| 要塞 `forts` | arms 0.08 | steel 0.02、wood 0.03 | 0.3 | tech + industrial |
| 船坞 `navalYards` | **ships 0.3**、machinery 0.03 | steel 0.18、wood 0.12、machinery 0.04 | 0.8 | tech + industrial |
| 海军营地 `navalBases` | 无（把船只编为海军，见下） | **ships 0.5** | 0.6 | tech |
| 大学 `universities` | services 0.2 | 无 | 0.2 | 无 |
| 兵营 `barracks` | arms 0.05 | 无 | 0.3 | 无 |
| 官署 `offices` | services 0.8 | 无 | 0.1 | 无 |
| 营造所 `workshops` | 无（产出建造点，`engine/economy.ts` 特判） | wood 1、grain 0.6、iron 0.3 | **0.8** | 无 |

- **船只链（PT-066 / PT-080）**：`ships` 是可贸易商品。**船坞**每月每座产 **0.5 艘**（II–V 级
  0.625 / 0.938 / 1.219 / 1.645），与机械厂 4.16 金/座同量级；**海军营地**每月每座吃
  **0.5 艘**、编练 **0.5 艘海军**（`SHIPS_PER_NAVAL_BASE = 0.5`，仍是 1 船 = 1 舰，但海军扩张变慢），
  并按「当月实际到货比例」把船编入海军：`navy += 营地数 × 0.5 × min(1, 有效供给 ÷ 需求)`。
  船也可以进口/出口，是列强海权的产业基础。
- **船队决定出口运力（PT-067）**：`出口方`的船队 = **海军 + 商船（`econ.merchantHulls`）**。
  每 **2 级**航线占用 **1 艘**船（`SHIPS_PER_ROUTE_LEVEL = 0.5`）；船不够时该国的**所有出口航线**
  按 `船队 ÷ 需求` 同比例削减运量（不是逐条砍）。商船来自「国内船只产出 − 海军营地消耗」的结余，
  每月累积。`v3_action route open/raise` 在船不够时会直接拒绝并说明缺口。
- **门控乘数**：tech `1 + 等级 × 0.07`；access `0.55 + 市场接入 × 0.9`；industrial 为煤铁禀赋因子
  （0.7~1.3）。旧的逐配方 infrastructure 门控（`0.6 + 交通 / 160`）**已退役**，由 F5 的统一基础设施
  短缺乘数（对所有建筑生效）取代。
- **中间投入进入需求**（用于定价与贸易），但**不计入 GDP**；GDP 只算最终用途。
- 除逐建筑配方外，还有**国家级**项留在引擎里（手工业者产出、总人口服务项、鸦片国家
  `outputFactor`、工业城镇的煤(1.2)/铁矿石(0.6)/钢铁(0.2)/布(0.5)/木(0.3)消费，按 `popFactor`）。
  它们是历史口径，不随配方变动。
- **F1 铁矿石/钢铁拆分（World v11）**：`iron` 转为**铁矿石**（只作 **钢铁厂 `steelMills`** 炼钢的投入），
  新增 **`steel`**；铁路、建设投资（`INVESTMENT_DEMAND`）、政府建设改吃钢铁，营造所**运行**投入仍为
  铁矿石（plan 0011 §9/§7.8 已定：保持铁矿石）。工厂在参考点的加权**聚合毛利仍在 5–20% 带内**。
- **F2 矿场三拆（World v11）**：打包的 `mines` 拆成 **`coalMines`（煤）/`ironMines`（铁矿石）/
  `lumberMills`（木材）**三个单产建筑，各产 0.96、用工 0.6/0.6/0.4、仅 tech 门控。种子按旧
  产出比例（煤 0.5 : 铁 0.42 : 木 0.04）拆座数，**总采掘座数守恒**（512→512），故世界煤/铁/木
  供给与拆分前基本一致（plan 0011 §7.3）。
- **F3 工厂七拆（World v11）**：打包的 `factories` 拆成 **`textileMills`（布料+成衣）/
  `furnitureWorks`/`distilleries`/`machineryWorks`/`steelMills`/`arsenals`/`luxuryWorks`** 七个
  单产/少产建筑（见上表），全部 tech+industrial 门控、共用 `factoryOutput`；旧的「liquor 仅
  industrial」覆盖保留在 `distilleries`。**输出系数 = 旧工厂该货系数 ÷ 该建筑的旧产出价值占比**，
  故每货全国供给守恒；投入当时复现旧工厂的每厂篮子。**F7 再校准**后参考点 7 大国加权聚合工业
  毛利 ≈ 16%（材料单已重定，逐类见 §4.3 与 `tests/economy-recipe-calibration.test.ts` 的 F7 带）。
  种子按旧产出价值占比拆座数（纺织 41.4%…钢铁 4.0%，余数给纺织），**总工业座数守恒**（516→516）。
  机械/军械/家具改吃 `steel`；`iron`（铁矿石）只作钢铁厂投入。`factories` 已从全部表面移除，
  派生口径改用工业建筑总数 `industrialBuildingCount`；`boom` 事件与 `工业起飞` 阈值改用该总数，
  配置条件 `'factories'` 更名 `'industry'`（plan 0011 §7.4）。
- **F4 加五类建筑（World v11，名册 17→22）**：**学校 `schools`**（初等教育，产服务，
  门控 access；**建成时识字率 +0.002/座**）、**运河 `canals`** 与 **电报 `telegraphs`**
  （**无货产出的基建成本中心**，各给少量市场接入，并**供给统一基础设施**——运河 2.0/座、
  电报 0.8/座，见 F5）、**要塞 `forts`**
  （产少量军械 arms，F7 定为 0.08）与 **船坞 `navalYards`**（产少量机械 machinery，F7 定为 0.14）。五类**种子起步 0 座**、
  `BUILDING_OUTPUT` 为空，故**私人投资不会自动投建**（公共/军事工程由国有或 AI 建造），1836 基线
  与物价校准不受扰动（plan 0011 §7.5）。**注意：其中运河/电报（及铁路/港口）已由 plan 0014 / ADR 0029
  合并为单一 `infrastructure`、运河删除（World v12）——本条的运河/电报条目为历史。**
- **F5 统一基础设施（World v11；ADR 0026、plan 0011 §7.6）**：把旧的「交通基础设施」标量升级为
  **唯一的国家级基础设施池**（**一个池，不分池**）。旧的 `econ.transportInfrastructure` 字段名保留
  （避免 v11 形状断裂），但语义改为**派生**：`level = clamp(100 × 供给/需求, 0, 100)`，每月按建筑座数重算。
  - **供给**（`INFRA_SUPPLY`，每座/月）：v12 起只有单一 **`infrastructure`「基础设施」= 2.16**
    （plan 0014 合并；旧四类权重 铁路 2.5 / 港口 1.1 / 运河 1.6 / 电报 0.7）。
    「哪些建筑供池」的唯一真源是 `INFRA_BUILDING_IDS`（见下）。
  - **需求**（`BUILDINGS[*].infrastructureNeed`，每座/月）：重工业最高（钢铁厂 0.22、机械 0.18）、
    轻工业次之（0.09–0.18）、服务/公共最低（0.03–0.08）、**农场 0**（自给农业不依赖国家运输网）、
    **基础设施自身 0.165**。
  - **短缺 debuff**：`ratio = 供给 / max(ε, 需求)`；`乘数 = ratio ≥ 1 ? 1 : clamp(ratio, 0.35, 1)`，
    对**所有建筑的产出**（含服务）线性施加；**只罚不奖**。生产读**上月**存储值（滞后一月）。
  - **维护消耗**：`吞吐维护 = 供给 × { 木材 0.01, 煤 0.015, 服务 0.02 }`、
    `行政维护 = (level/100) × { 服务 0.01 }`，作为**中间需求**并入市场（不反向门控供给）。
    服务来自现有官署/大学/学校。
  - **GM 读取**：`v3_inspect economy` 新增「统一基础设施」一行（供给 ÷ 需求 = ratio、水平、产出乘数、
    本月维护消耗）；`v3_inspect buildings` 每类显示「基础设施需求」；`v3_forecast` 显示下月产出乘数。
  - **数值（F7 已校准；plan 0014 合并后）**：1836 基线（种子 9100）十国 ratio 全部 ≥1，与合并前偏差
    **<5%**（最大 2.63%）；工业化推进而基建不扩建时 debuff 显现，84 月有国家自然跌破 1。
- **plan 0014 基础设施合并（World v12，ADR 0029）**：铁路/港口/电报**合并为单一 `infrastructure`
  （显示名「基础设施」）、删除运河**，名册 22→19。合并建筑承载三者全部职能——统一基础设施供给、
  市场接入、**港口关税效应**（港口税入、进口/航线容量、威望）。
  - **可重拆接缝**：`INFRA_BUILDING_IDS: BuildingId[] = ['infrastructure']` 是「哪些建筑供池」的
    唯一真源；所有基建逻辑（供给求和、维护、市场接入、面板分组、`completeBuilding` 判断、港口效应）
    都**遍历它 / 读逐建筑系数表**（`INFRA_SUPPLY`、`INFRA_MARKET_ACCESS`），**不硬编码**，
    故将来拆回多座建筑**只改数据**。
  - **系数**：`INFRA_SUPPLY.infrastructure = 2.16`（供给等价折算四类）、`infrastructureNeed = 0.165`；
    配方 `output {}` / `input { steel 0.2, wood 0.16 }` / labor 0.54；造价 5、建造点 3、
    `INFRA_MARKET_ACCESS = 0.019`（市场接入总量守恒）。种子按 `round((rail×2.5 + port×1.1)/2.16)` 折算。
  - 遗留映射与完整决定见 `docs/adr/0029-infrastructure-merge.md`。
- **F6 建筑解锁字段（World v11，plan 0011 §7.7）**：`BuildingDef` 新增可选 `unlock?: { techLevel?: number }`，
  `build` 动作在该国科技等级低于阈值时**拒绝**建造。**当前 23 类建筑全部缺省该字段**（无阈值）；
  实际解锁走 plan 0015 §S4 的 `unlockBuilding`（`chemicalWorks`/`powerPlants`/`locomotiveWorks` 三类新厂由其科技节点解锁）；
  `v3_inspect buildings` 仅在建筑设阈值时才显示「需科技等级 N」。
- **F7 数值校准（World v11，plan 0011 §7.8）**：一次 numbers-only 的分批校准，不改公式/结构。
  - **配方**：把 F3「投入守恒」留下的、产出价值几乎等于投入的家具厂/兵工厂改成可盈利（家具厂砍
    材料单、兵工厂提产出/砍投入），钢铁厂改为**低机械、高煤**的投入组合以耐受机械涨价，奢侈品厂
    提布料投入；要塞/船坞产出提高到能覆盖投入。
  - **基价**：`machinery` 6.0→5.2、`steel` 2.2→2.6（使钢铁链在整段基线内保持正毛利）。
  - **族毛利带**（7 大国产量加权，24/48/84 月）：农业 48–62%、采掘 42–62%、轻工业 4–25%、
    重工业 0–36%、服务 38–58%、军事 45–65%；**每类产货建筑均为正毛利**（改前家具厂 0.3%、
    兵工厂 1.0% 近乎不赚）。带宽被 `WAGE_ALLOCATION='valueAdded'` 的「无投入部门天然高毛利」
    结构决定（见 `tests/economy-recipe-calibration.test.ts` 的 F7 gate）。
  - **基础设施**：`INFRA_SUPPLY` 与少数种子铁路/港口座数重定，使 1836 十国 ratio 全部 ≥1、
    84 月有国家自然跌破 1（debuff 由产业增长触发的设计意图成立）。
  - **不变量**：`C+I+G+NX===GDP`、金币守恒、60/120 月确定性、鸦片门、工资分摊恒等式全部保持；
    世界版本仍 v11。
- **B5 工厂再平衡（ADR 0021、plan 0008 §5）**：工厂配方调轻了材料单、并下调成衣/酒/家具产出，
  使工厂在参考点可盈利。7 大国产量的加权**聚合工厂毛利落在 5–20% 带内**；工业核心 GBR/FRA/PRU
  亦在带内，资源富集、工资低的 RUS/QING/JAP 在带上界之上（属预期）。F1（World v11）重定了工厂
  配方，F3 把工厂拆成七个单产建筑并把门线改为**工业建筑聚合**，带内性质由
  `tests/economy-recipe-calibration.test.ts` 守住。
- **消费品真双向（B5-r2，plan 0008 §5）**：成衣、酒类、家具**在世界上双向交易**（真实 bid 与 offer）：
  纺织厂转做布料、成衣交由各国**手工匠**（`ARTISAN_OUTPUT`）供给，家具厂/酿酒厂配方按 0.45 缩放并
  同比例下调投入，同时上抬消费品生存需求与成衣收入弹性。实测（seed 9100，84 月）成衣 81/84 月双侧、
  酒类 84/84、家具 81/84（其后每 12 月窗口均出现）；鸦片贸易门保持（QING 鸦片进口最小 2.251 ≥2）。**军械**仍是单侧（生产恒 > 需求，
  无 bid）——这是唯一按设计非双向的商品，`tests/economy-recipe-calibration.test.ts` 有生产下限断言。
  GM 可以在世界市场上买卖成衣/酒/家具，也可以买卖粮食/木材/煤/铁/布/机械等原料与中间品；军械需自建兵工厂。

来源：ADR 0021、`engine/data/buildings.ts` `BUILDING_RECIPES`、`engine/economy.ts` `computeDemand`。

### 4.4 逐建筑经营利润 `buildingProfits`

- 每月按类计算快照：**利润 = 产出价值 − 中间投入价值 − 分摊工资**。
- **工资分摊可配置（plan 0008 B5）**：全国工资如何摊到各建筑类型由 `engine/data/buildings.ts` 的
  `WAGE_ALLOCATION = { basis, weights? }` 决定。`basis` 取：
  `'labor'`（按 `用工 × 座数`，旧口径）| `'valueAdded'`（按 `max(0, 产出价值 − 中间投入)`，
  **当前值**）| `'capitalPlusLabor'`（按 `用工 + 建造成本 × 0.25`）。`weights?` 可再按类型乘系数
  （当前未用）。三种 basis 都**精确**满足 `Σ buildingProfits.wages === 全国 wages`。
  （plan 0009 D1 只抽了 `engine/*.ts` 的散落字面量，**未**搬 data 侧业务系数，故此常量仍在
  `engine/data/buildings.ts`；默认 `'valueAdded'`。）
- 单位：`profitPerBuilding`（金/座）、毛利率 `profit / revenue`。
- **自 B3（ADR 0022）起它已驱动决策**：
  - 产出按**上月**存储的 `utilization` 门控（亏损类目闲置，下界 0.5，一阶平滑 0.25）；
  - 深度亏损的类目每月额外萎缩（上限 0.02/月，计数永不为负）；
  - 私人投资**只建 `profitPerBuilding > 0`** 的类型；
  - 同一 `utilization` 还**加权劳动需求**（0007 E8）：闲置/亏损类目按开工率**释放劳力**，
    使失业有**行业来源**（见 §7 的「部门来源」行）。
- 该口径按**市场价、毛产出**估值，与宏观 `realGdp × (1 − laborShare)`（基期价、增值口径）
  不是同一个量；通常更大，仅供判断「这类建筑按现价赚不赚钱」。
- 查看：`v3_inspect buildings` 的逐建筑行（含「开工率 %」「闲置」标记）。

来源：ADR 0021、ADR 0022、`engine/data/buildings.ts`（`WAGE_ALLOCATION`）、`engine/economy.ts`（利润快照）、`engine/inspect/economy.ts`（展示）。

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

来源：`docs/plans/0003-economic-loop.md`、`engine/data/goods.ts`（`SUBSISTENCE`/`INCOME_ELASTICITY`/
`CONSUMPTION_PROPENSITY`）、`engine/economy.ts`、GLOSSARY（私人资本/私人外债/投资信心）。

### 4.6 建造能力

- **营造所产出建造点**：I 级每座每月 **4 点**，受科技、交通、市场接入与**原料可得性**约束
  （木、粮、铁不够则打折）。**营造所现已分级（I–V）**：按座加权，高等级产出**更多**点
  （`CONSTRUCTION_CAPACITY_TIER_MULTIPLIER` `[1,1.2,1.45,1.75,2.1]`）、每点**更便宜**
  （`CONSTRUCTION_COST_TIER_MULTIPLIER` `[1,0.95,0.9,0.85,0.8]`），且 II 级起以 `steel` 逐步替下 `iron`
  （III 加 `machinery`、IV/V 加 `electricity`）作运行投入（plan 0016 §S7，ADR 0032）。
- **工程量**：`工程量 = 单座月度点数 × 30 × WORKLOAD_TIER_MULTIPLIER[目标级-1]`
  （`[1,1.3,1.7,2.2,2.8]`，I 级 = ×1；**升级工程量 = 0.5 × 同级新建工程量**，故升到高等级更贵）。
  单座 I 级营造所 = `1.5 × 30 = 45` 点；5 座 = 225 点。
- **工期 = 剩余工程量 ÷ 每月实际投入**，不再有固定月份。国有队列**按入队顺序**分配；
  每个 entry 每月可拿 `min(队列剩余建造力, 本项目剩余工程量)`，**没有每槽月度上限**。
- **队列编排（ADR 0027，面板自 ADR 0031 §8 起只读）**：御前/经济面板有共享的建造面板
  （23 类建筑按 6 族只读列出，不再有下单按钮；下单走对话 `v3_action build` / `upgrade`），
  队列显示 `#index`/`id`/进度并带 取消/↑/↓/置顶。GM 侧对应：
  `v3_inspect construction` 每条带 **`#index`** 与 **`id=<projectId>`**；
  `v3_action build` 可带 **`position`(head/tail/before/after)+`before`** 插队；
  `v3_action cancel` 按 **`projectId` 或 1-based `index`**；`v3_action reorder` 移动既有条目。
  **重排保留已投入进度**（只改顺序，不退回工程量），**引擎的建造力分配逻辑不变**。
- **每槽最多 5 座**；每月订单数量不限。每点工程量造价 **0.2 金**（乘数/加数 v1 全为 1/0）。
- **两条独立的建造杠杆（PT-076）**：
  - `constructionSpeed`（**建造速度**）——乘在**每月产出点数**上。+100% 就是建造力从 55.4 变成 ~110.8 点/月，
    **会计入 `v3_status` 的建造能力、ETA 与满负荷现金支出**；它不改变每点单价，单价只由 `constructionCost`
    与营造所等级决定。债务压力的建设惩罚仍单独乘在每月进度上（PT-079）。
  - `constructionCost`（**建造花费**）——乘在**每点单价**上，`-50%` 即项目**总造价减半**，工期不受影响。
    显示口径：状态行的「每点工程量造价」、队列行的「总造价」、建造面板的「造价」都读修正后的值；
    结果被钳在 `[0, 10]` 倍，堆叠减免最多把单价压到 0，不会变成倒收钱。
- **私人项目**：自建 **50%**；可**租用国有闲置建造点**，租金 **0.3 金/点**入国库
  （记为收入「其他」）。分配完后剩余点也按 0.3 金/点出租给私人。
- **建设补贴**（`spending.construction`）：每级每月 **+1.5 建造点、花 0.45 金**；
  补贴点与营造所产点同质，同样受原料约束；没有营造所时补贴不产生建造力。

每座每月的建造点需求（`CAPACITY_COST`）：营造所 1.5、农场 0.5、煤矿/铁矿/兵营/官署 1、
伐木场 0.8、纺织/军械/奢侈 2、家具/酿酒 1.5、机械/钢铁 2.5、大学 2、基础设施 3。

来源：ADR 0010/0012/0013/0015、README「建造能力」、`engine/config/construction.ts`（`CAPACITY_COST`/
`WORKLOAD_MULTIPLIER=30`/`CONSTRUCTION_COST_PER_POINT=0.2`/`CONSTRUCTION_RENT_PER_POINT=0.3`；经 `engine/construction.ts` 重导出）。

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
- **税负归属（PT-073 起）**：私人**消费需求**只按土地税 + 企业所得税扣减，**消费税不再压缩需求**。
  消费税改为**价格楔子**：消费者面对的含税价 = 市场价 × (1 + 税率)，需求仍按**税前价**计算；
  税款从**私人储蓄**（`privateCapital`）中扣除，国库照收，金币不凭空产生。储蓄不够时私人资本转负（私人外债）。
- **分商品消费税（PT-073）**：`econ.consumptionTaxByGood` 可按 `GoodId` 覆盖统一税率，
  未覆盖的商品沿用 `taxes.consumption`；显式 0 = 免税。设置方式：
  `v3_action tax { base: "consumption", good: "grain", rate: 8 }`（不带 `good` 则改统一税率）。
  `v3_inspect fiscal` 在存在覆盖时逐商品列出 **税基 → 税额** 与**含税价**。
- **查看（PT-042）**：`v3_inspect fiscal` 逐基显示 **`税基量 × 税率 × 征收效率 = 税额`**，
  把此前隐藏的**征收效率**因子摆到明面——所以「土地税 340 × 4%」的税额不是 13.6，而是
  再乘征收效率（约 0.6）后的结果。要判断某项税率调整的影响，看这条三元等式而不是只乘税率。
- **设置**：`v3_action tax { base, rate }`，`base ∈ land/profit/consumption/tariff`（0..60）；
  消费税可加 `good` 单设一种消费品（见上）；
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
  （盈余大者出口）。校验：商品可贸易、伙伴存在、非本国、非交战、非禁运；**出口方船队不足时
  `open`/`raise` 会被拒绝**（2 级 = 1 艘，见 §4.3「船队决定出口运力」）。
- **到岸价**：`出口国国内价 × (1 + 出口国出口税) × (1 + 进口国进口税) × 区域运输 ×
  市场接入 × 交通 × 关系风险`。航线价另乘折扣 0.9 且不含关系风险。
- **双关税**（ADR 0009/0014）：`tariff` 是**进口税率**，`exportTariff` 可选、缺省与进口同率；
  自由贸易把两个税率降到 **5% 下限**。进口国国库收进口税，出口国国库收出口税。
- **关税议价能力 `tariffBargaining`（0–0.9，默认 0）**：直接值，不是百分比。它让**进口关税**
  落到本国价格上的楔子只剩 `1 − b`：`b = 0.5` 时，标称 20% 的关税只让到岸价涨约 10%。
  关键在**税收不缩水**——国库仍按**名义税率**全额征收，差价由出口国的私人部门吸收
  （`TradeFlow.absorbed`：进口方账单与出口方收入同步减少，金币守恒）。所以高议价能力的效果是
  **国内价格不动、关税收入照收、外国生产者吃下成本**。
  **出口税**不需要这个接缝：引擎里出口税本来就全额落在外国的进口方头上（出口国国内价不被压低），
  再阻尼反而会让外国消费者不付钱。
  `v3_inspect fiscal` 在 `b > 0` 时同时列出名义税率与进口实际楔子。施加方式：
  `v3_cheat modifier stat=tariffBargaining stack=flat value=0.5`
  （基数是 0，`percent` 栈乘不出东西，必须用 `flat`）。
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
  | 25%~50% | 轻度 | 0~3.6% | 0~6.4% | 0~1.6 | 0~0.12% |
  | 50%~100% | 中度 | 3.6%~10.8% | 6.4%~19.2% | 1.6~4.8 | 0.12%~0.36% |
  | 100%~200% | 重度 | 10.8%~25.2% | 19.2%~44.8% | 4.8~11.2 | 0.36%~0.84% |
  | ≥ 200% | 危重 | 25.2%~36% | 44.8%~64% | 11.2~16 | 0.84%~1.2% |

  **口径（PT-063 已收紧）**：`severity = clamp((债务/GDP − 0.25) / 1.25, 0, 2)`，
  各惩罚 = `severity × 系数`（收入 0.18、建设 0.32、合法性 8、月息 0.006）；
  **275% 债务/GDP 时 severity 触顶**，此后再借不再加罚——因为 **3× GDP 是重组底线**：
  越线后降债到 1.5× GDP 并进入 12 个月重组窗口。**轻微负净资产不冻结建设。**
  标签仍按 25% / 50% / 100% / 200% 四档显示（标签只描述深度，罚款由 severity 决定）。
- **收入拆分**：税入 + 关税（进+出）+ 基建 + 基金收益 + 赔款收入 + 其他（建造力出租）。
- **支出拆分**：陆军 + 海军 + 行政 + 教育 + 福利 + 债息 + 市场损耗 + 设施维护 + 赔款支出 +
  国有建设 + 建设补贴。
- **赔款**：胜方声明总额与最长分期月数；败方自行决定一次付清多少、余款分几期；分期部分每月
  计入付款方支出与收款方收入，日程在 `world.indemnities`。默认总额 = 败方 GDP × 10%，最长 60 个月。
- **国库净额 = 收入 − 支出**；私人逆差**不在**这个账里（见 §5、§9）。

来源：ADR 0006/0007、`engine/fiscal.ts`、README「国库 = 净资产」「债务压力」「国库收支账」。

## 7. 人口 / 劳动 / 社会

- **失业率**是**结构性**指标：由工业建筑吸纳能力、识字率与激进共同决定（`deriveUnemployment`），
  口径上**不等于** `1 − 劳动需求/劳动力`。
- `v3_inspect labor` 并列显示：失业率、**原始需求/劳动力**利用率与「结构性缺口」、**部门来源**；
  并给出就业基础（农田/煤矿/铁矿/伐木场/七个工业建筑/营造所/基础设施）。
- **劳动需求 = `Σ(labor × count × utilization)`**（0007 E8，`d346b12`）：逐类建筑按
  `用工 × 座数 × 上月开工率` 求和，**利用率为权**。`utilization` 取**上月存储值**（与产出门控同一字段、
  同一滞后，ADR 0022）；全行业满负荷时**逐值退化**为旧的 `Σ(labor × count)`。**闲置/亏损行业释放劳力**，
  失业因此获得**行业来源**。**劳动力** = `总人口 × 劳动参与率`（`laborParticipation`）。
  **营造所 `labor = 0.8`**（工地雇人，PT-048/PT-061）：它既计入失业模型的 `industryCount`，也计入劳动需求。
- **劳动参与率（设计核心，PT-061）**：**农田是蓄水池**——还没有进入统计劳动的人口住在那里。
  参与统计的劳动池 = `总人口 × 参与率`（`laborParticipation`，0.35~0.85）；
  参与率随 **识字率** 与 **农业/科技进步**（科技时代）上升：
  `0.58 + 识字率 × 0.25 + (时代 − 1) × 0.02`。**玩家建的每一座建筑都从这个池子取人**，
  所以参与率上升而**没有对应产业接住**，就会直接表现为失业上升——这就是「要有产业对应」的含义。
- **「劳动需求 ÷ 劳动力」不是就业率**（PT-061）：分子只统计**建筑正式用工**（农场/矿场/工厂/营造所/基建），
  不含蓄水池里的自耕农与手工业自雇；分母是参与统计的劳动池。在农业国该比值天然只有几个百分点，
  引擎把它夹在 `0.5~1` 后只用作失业公式里的**低利用率罚项**（`(1 − utilization) × 2`），
  **不要**把它读成「就业率」或与失业率相减。要看失业的真实成因，读同一行的**分解式**
  （基础 / 工业吸纳不足 / 罚项 / 激进 / 识字）。
- **`v3_inspect labor` 的「部门来源」行**：把**满座需求**（假想所有行业 `utilization = 1`）与当月
  实际劳动需求相减 = 闲置部门**释放的劳力**；行内按开工率从低到高列出前几个**闲置部门**（含其开工率）。
  全部满负荷时显示「各部门满负荷（无闲置释放）」。要解释「为什么这个月失业升了」，先看这一行。
- **生活水平（sol）**、**识字率**、**激进**、**合法性**、**城市化**都在月度结算里更新；
  `sol` 与粮价联动（饥荒触发条件见 §8）。
- **官僚效能**（0~100 派生分）：由官僚支出、识字率、行政能力、政府类型与激进共同决定，
  受**官署**抬高上限；决定每月行动预算、资金效率、工期延迟与信息失真。
- **行政能力**：由官署、识字与税制构成，进入官僚效能的原始分。

来源：`engine/data/derivations.ts`（`deriveUnemployment`/`deriveLabor`/`deriveBureaucracy`/`administrativeCapacityFor`）、
`engine/inspect/labor.ts` `laborSection`、GLOSSARY（官僚效能/行政能力/官署）。

## 8. 科技 / 军事 / 外交 / 事件

### 科技

- **基础研究率**（ADR 0018）：`base = 2 + 识字率 × 3 + 官僚效能 × 0.06`；
  大学是主要放大器：`+ 大学数 × 0.9 × (0.4 + 识字率) × (1 + 教育支出 × 0.03) × (1 + 科技层级 × 0.02)`。
- **4 时代 / 22 节点科技树**（plan 0005 K0–K4 + plan 0015/0016 扩表，World v13→v14，ADR 0030/0031/0032）：`techTier = 1 + 时代×1.5 + 已解锁节点×0.05`
  是旧 1–10 级线性科技的派生替代，受科技门控的产出/建造仍按 `1 + techTier×0.07`。树 = 通用时代线 5
  （`general-1836/1840/1850/1865/1880`，逐级推进**时代 I–IV**）+ 工业 7（含 `industry-6`「电力工业」/
  `industry-7`「第二次工业革命」两个电气化节点，把建筑等级上限抬到 **IV/V**）+ 行政 5 + 军事 5。节点造价按时代
  1/2/3/4 = 160/360/720/1280（单一真源 `TECH_ERA_COSTS`，K4 调平 ≈ 每 2–4 年一节点）。
  `v3_action research tech=<节点 id>` 选择研究（校验**前置 + 时代门槛**；`v3_action research` 不带 id 时
  返回当前可研究清单）。开局大清约 4 点/月。研究页签是树形 UI，点可研究节点等价于一次 `v3_action research`。
- **跨分支溢出**：主研究节点拿全额科技点，额外 15–25%（随识字率 / 大学数 / 教育支出上升）平均流入另外
  两条分支的当前时代节点；是**额外进度**，不扣主节点。
- **国际扩散**：落后国研究**速度**最高 +50%（按科技差 + 贸易占比 + 关系 + 同盟），与先进伙伴战争 / 禁运时归零；
  只加速，不送点、不免费解锁。
- **AI 选择**（非玩家国）：按时代门槛（优先补通用线）+ 领袖特质 + 国情（工厂少 / 激进高 / 战争弱军）加权，
  同权重按节点 id 字典序兜底，**同种子可复现**。

### 军事

- 军力 = 陆军、海军、士气、质量、人力、战争疲劳；军费按兵力计算基本维持费，
  砍到 0 级也不会消失。
- 战争以双方陆军质量、士气、科技计算的战争分数推进，**75 分或 60 个月**结束。
- **制海权**（`seaPower`）：`navy × navalQuality × (1 + navyStrength/100)`，**不乘 techTier**。
  交战双方按月比较海权比值，分五档：**完全控制**（≥2.0）/ **优势**（≥1.25）/ **均势**（0.8–1.25）/ **劣势** / **丧失**。
  优势 +0.75/月、完全控制 +1.5/月**战争分数**（在贸易清算**之前**计算，当月生效）；
  完全控制 50 个月即可独力打到 75 分，**封锁因此能结束战争**。`v3_inspect military` 显示各国 `seaPower` 与档位。

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
| `blockade` | **封锁**：需已掌握对 `target` 的**制海权（优势或完全控制）**；切断 `target` 与第三方的海上贸易。可给 `party` 指定第三方（含中立国，否则封锁其与一切第三方），可给 `good` 限定商品。恶名 +5；指定 `party` 时与其中立国关系 −12（对方 −8）。当月生效 |
| `unblockade` | **解除封锁**：参数同 `blockade`（`target`/`party`/`good`），移除匹配的封锁记录 |

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

### 实时事件（逐回合，E1–E7，ADR 0025 / plan 0010）

- **缝合点**：每次 `v3_advance` 之后、御前会议呈现之前，世界先被扫描出**显著题材**，再由 LLM 现场生成
  **0 至 2 个**可交互事件，写进 `world.events`（与随机事件同一数组、同一结算路径）。
- **显著题材（E2）**：引擎按**经济 / 政治 / 外交 / 民生**四维扫描，各取一个最强信号，按显著性降序取
  1 至 2 个作为种子交给 LLM；旧的 10 个随机事件模板**降级为「题材方向」目录**（只提示往哪个方向写）。
  各类阈值集中在 `engine/config/events.ts`（`LIVE_*`）。
- **多主体（E5）**：引擎按「玩家优先 → GDP 降序 → id 破平」选最多 `LIVE_MAX_SUBJECTS`（=2）个主体分别生成；
  已被先前主体认领的题材键从后续主体剔除（跨主体去重），无题材的主体直接跳过。每回合**模型调用硬上限**
  `LIVE_MAX_MODEL_CALLS`（=2），生成事件恒 ≤ `LIVE_MAX_EVENTS`（=2）。
- **三视角旁白（E6）**：史官（朝廷编年）/ 市井（街头百姓）/ 列国舆论（他国观感）**只作为提示词引导**，不设硬结构。
- **效果信封（E3）**：LLM 只写 `EventOption` 形状（国库 / 激进 / 合法性 / 威望 / 军队 / 人口 / 科技点 /
  关系 + `modifiers[]`）；引擎**校验、钳位、降级**（非有限值 / 未知字段 / 未知 stat / 越界一律**整条丢弃**），
  每回合 ≤2 事件、≤4 选项，数值上限见 `engine/config/events.ts`，再走既有 `applyEventOption` 落账。
  **坏事件整体丢弃**（宁愿 0 个，不落坏事件）。
- **例行场景（E7）**：按日历低频出现（每 6 个月一次，约每年 1 至 2 次），选项**一律无效果**、可跳过；
  跳过不产生效果、也不卡流程。
- **持久化与可复现（E4）**：生成结果随事件写入 `world.events`，**读档直接复用、零模型调用**；
  事件数组上限 `EVENTS_MAX = 80`，超限丢最旧。
- **兜底**：生成同步执行、带有限超时（`LIVE_EVENT_TIMEOUT_MS` = 20000ms），超时或失败降级为空事件；
  **托管**（`months > 1`）走轻量模式、跳过生成，绝不阻塞推进。
- **进度**：**E1–E7 全落地**（`engine/liveEvents.ts` + `engine/config/events.ts` + `hooks/council.ts`，
  测试见 `tests/live-events*.test.ts`），World v13。

来源：ADR 0018/0019/0025、`engine/data/tech.ts`（`TECH_NODES`）、`engine/data/events.ts`（`EVENT_TEMPLATES`）、
`engine/liveEvents.ts`、`engine/config/events.ts`、`engine/economy.ts`（研究率）、`engine/diplomacy.ts`（war goal）、
`docs/plans/0004-trade-diplomacy.md` §4/§5、`docs/plans/0010-live-events.md`、`hooks/council.ts`。

## 9. 口径速查 / FAQ（「为什么变了」）

| 现象 | 原因 | 去哪看 |
| --- | --- | --- |
| 已付建设款，GDP 的 I 却是 0 | 投资需求读**上月实际建设支出**（防幽灵投资），**滞后一月** | `v3_inspect history`（逐月 C/I/G） |
| 收入 > 支出，净资产仍下降 | 私人进口逆差由**私人资本/私人外债**承担，**不进国库账** | `v3_inspect fiscal`（私人逆差、私人外债） |
| 出口为 0，不知为什么 | 全球可能没有 bid，或伙伴关系/禁运/战争切断 | `v3_inspect trade`、`market`（伙伴与货值） |
| 关税收入翻倍 | 进口税与出口税两个方向之和，或贸易量上升 | `v3_inspect fiscal`（含税率行） |
| 税入与 GDP 不再按比例 | 已改为**四税基**（土地 / 企业 / 消费 / 关税），GDP 只作派生产出指标 | `v3_inspect fiscal`（每基税基量/税率/税额）、§4.7 |
| 税入随租金缩放、GDP 上升税反降 | 「其他（建造力出租）」入账时差曾被并入上月收入；现已用 `lastIncomeOther` 修正口径 | `v3_inspect fiscal` |
| 失业率与「原始利用率」不一致 | 失业率是**结构性**指标，含工业吸纳、进口竞争与在职不足；原始利用率只反映需求缺口 | `v3_inspect labor` |
| 工厂闲置，失业随之上升 | 劳动需求**按上月开工率加权**（`Σ labor×count×utilization`），闲置/亏损行业**释放劳力**；来源看「部门来源」行 | `v3_inspect labor`（部门来源）、§7 |
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
    工厂转为可盈利；收敛 PT-001。
  - **B5-r2 已落地**：**消费品真双向**（成衣/酒/家具进世界市场；军械记为唯一非双向商品），
    以工厂侧配方缩放 + 消费品需求侧重定实现，鸦片门保持；收敛 PT-002。
  - **B6（随 B5-r2 完成）**：文档同步（本手册、README、GLOSSARY、playtest 状态）。
- **config-block 重构（ADR 0024 / plan 0009，取代 ADR 0004）**：
  配置分层（`engine/config/` + `engine/data/`）与统一 `ConfigBlock` 乘数机制。**C1–C7 修正块迁移、D1
  字面量抽取、D2 `engine/data.ts` 拆桶均已完成**（`engine/config/*.ts`、`engine/data/*.ts`，World 仍 v11、
  行为零改动）；仅 **D3（可选）** 的其它模块域内常量归位未做。`C7` 的**债务压力 / 配方门控 / 科技乘数**
  三项作为「声明块」由引擎在既有接缝读其 `scales_with` 曲线。
- **建筑扩张与统一基础设施（ADR 0026 / plan 0011，F1–F7 全落地，World v11）**、**实时事件 E1–E7
  （ADR 0025 / plan 0010，World v13）** 与 **代码拆分（plan 0012，S1–S6 全落地）** 亦已完成，见 §4.3、§8。
- **建造面板与队列编排（ADR 0027 / plan 0013）** 与 **托管手动停止 `v3_control` + `/v3 stop`
  （ADR 0028）** 已落地。前者把建造搬到面板（19 类建筑 `x*y` 下单 + 队列 取消/重排），
  GM 侧同时暴露 `#index`/`projectId` 与 `reorder`；后者补上手工中断托管的入口。见 §2、§3、§4.6。
- 经济口径已全部落地，§4.3（配方）、§4.4（利润口径）、§4.7（税制）与 §9 均已按 shipped 状态更新；
  实际数值以 `v3_inspect` 的分区输出为准。

来源：`docs/plans/0008-economy-remake.md` §6、`docs/plans/0009-config-refactor.md`、
`docs/playtest-issues.md` PT-031。

---

### 主要来源索引

- 边界与工具：`docs/plans/0006-gm-engine-interface.md`、ADR 0003/0016、`hooks/tools.ts`、`engine/inspect/`
- 回合：ADR 0001、README、`hooks/`（`register.tsx`、`council.ts`）
- 经济：`docs/plans/0003-economic-loop.md`、ADR 0021/0022/0026、`engine/data/buildings.ts`、`engine/data/goods.ts`、`engine/economy.ts`
- 配置分层：ADR 0024、`docs/plans/0009-config-refactor.md`、`engine/config/`
- 税制：`engine/fiscal.ts`、`docs/plans/0008-economy-remake.md`
- 贸易：ADR 0008/0009/0014/0020、`engine/trade.ts`、`docs/plans/0004-trade-diplomacy.md`
- 财政：ADR 0006/0007、`engine/fiscal.ts`
- 人口/科技/军事/外交/事件：ADR 0018/0019/0025、`engine/data/derivations.ts`、`engine/liveEvents.ts`、`docs/plans/0004-trade-diplomacy.md`、`docs/plans/0010-live-events.md`
- 口径：`docs/playtest-issues.md`、GLOSSARY.md、README.md
