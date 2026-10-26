# 建筑五级化与电气化投入（five building tiers & electrified inputs）

- Status: accepted（**World v14**：建筑等级 I–V；电力成为 IV/V 级投入并**置换燃料**；退役 plan 0015 的全局电力产出乘数；**营造所 `workshops` 也分级**（更多、更便宜的建造力，自我加速循环**有意保留**）；**不升世界版本**）
- Fixes:
  - **电力没有任何消费者**——`powerPlants` 产出的 `electricity` 只进市场、不进任何 `recipe.input`
    （`engine/data/buildings.ts:510-517` 产出、全表无一处消费），`NON_TRADABLE`
    （`engine/trade.ts:59`）又让它无法出口，于是它在任何一局里都只是停在基价的死库存；
    当前唯一的「用电」是 plan 0015 §S4 的**全局产出乘数**——它不是一条投入链，而是给每座建筑
    （**包括发电厂自己**）白送一个 1+k 的乘数，一旦电力成为真实投入就会**重复计算**；
  - **建筑分级停在 3 级**（I/II/III）——1880 之后的工业没有向上的空间，tier 系统与 V3 的
    「建筑等级 + 高级生产方法换入新中间品」范式只对上了前半段；
  - **升级到顶只是同篮子按比例放大**——V3 里高级形态要**换掉**旧投入（电弧炉少烧煤、柴油机换油、
    硫化换入橡胶）的模式在引擎中缺席，III 级之后只剩「再乘一个系数」。
- Depends on: `docs/adr/0031-tech-tiers-and-sea-control.md`、`docs/plans/0015-tech-and-building-tiers.md`、
  ADR 0021（建筑配方单一真源）、ADR 0022（利用率与利润）
- Supersedes:
  - **plan 0015 §S4 的「自产电力给全局产出乘数」**（`electricityOutputMultiplier`）——本 ADR 退役该乘数，电力的价值改为**纯粹作为 IV/V 级的投入**；
  - **plan 0015 §S2 / ADR 0031 §5 的「营造所不可升级、升级不提高建造力」守卫**——营造所现在可升级、高等级产出更多更便宜的建造力，其自我加速循环**有意保留**（见 §6）。
- Superseded by: —

## 背景

plan 0015 / ADR 0031 把建筑做成「同 id 内 1–3 级、混级共存、按座加权」，并落了三座新建筑与
三个新商品。1839 年之后的世界暴露出两处断点，都指向同一个结论：**分级系统提前到顶，而电力没有出口却有乘数。**

1. **三级天花板**。现有 13 类分级建筑的 `tiers` 数组长度固定为 2（II/III），
   `tests/tier-recipe-data.test.ts:126` 用 `expect(tiers?.length).toBe(2)` 把它写死。
   `recipeAt`（`engine/data/tiers.ts:13`）本身是通用的（`tiers[tier-1]`），4 级、5 级都能读；
   但数据、系数表、罗马数字与配色都只写了 3 档。
2. **电力无消费者、却有乘数**。`powerPlants`（IV/1880 解锁）产出 `electricity`，基价 2
   （`engine/data/goods.ts:41`）；但全表没有任何 `recipe.input` 收电力。plan 0015 §S4 给了一条
   **全局产出乘数**（`electricityOutputMultiplier`，`engine/data/derivations.ts:101-113`）：
   `1 + min(0.2, 电厂座数 × 0.02)`，在 `engine/economy.ts:218` 取值、`:263` 对**每座建筑的每项产出**
   相乘——**连 `powerPlants` 自己的产出也乘**。它既不是投入链，又和「电力作为投入」重复计功。

**V3 的先例（本 ADR 的设计依据）。** 对 Victoria 3 1.9 期游戏文件（已抓取，见下文引用）的核对确认：

- 建筑用 **levels（可建座数）+ production methods（PM）** 表示形态，**没有「tier」概念**；
  形态升级表现为**切换 PM**，「更高级的 PM **换掉**一种旧投入、换入一种新中间品」是 V3 的核心范式。
- **电力是 `local=yes` 的地方商品**：`common/goods/00_goods.txt` 里 electricity 为本地商品，
  维基《Goods modding》页确认 `local = yes` 使商品**本地化且不可贸易**——每个州必须自建
  **Power Plant** 供本地消费，无法跨州/跨国传输折算。
- **具体哪些 PM 换入电力、并置换旧投入**（均以 `required_input_goods` 出现）：
  1. 铁路 **Electric Trains**（`pm_electric_trains`，消耗 electricity，蒸汽车不耗）；
  2. 钢铁厂 **Electric Arc Process**（`pm_electric_arc_process`，**少烧煤**）；
  3. 机动车工业 **Electric Engines**（`pm_electric_engines`）；
  4. 化工厂 **Brine Electrolysis**（`pm_brine_electrolysis`）；
  5. 纺织 **Automatic Power Looms / Electric Sewing Machines**；
  6. 工具车间 **Assembly Lines**（electricity + oil）；
  7. 城市中心 **Electric Streetlights**。
  非电力的同类例子：**Rubber Grips**（换入橡胶）、**Diesel Engines / Nitrogen Fixation**（换入石油）。
- **V3 没有「有电就全局加成」的机制**——电力的价值全部来自**它作为某个 PM 的投入**。
- **科技链**：`electrical_generation`（era 3，解锁 Power Plants）、`electrical_capacitors`（era 4，
  解锁 Automatic Power Looms / Brine Electrolysis / Electric Sewing Machines）、
  `electric_arc_process`（era 4）、`electric_railway`（era 4）、`combustion_engine`（era 4）。

> 抓取来源：Victoria 3 1.9 期 `common/goods/00_goods.txt`、`common/production_methods/01_industry.txt`、
> `common/technology/technologies/10_production.txt` 与维基 Electricity / Goods modding / Production
> technology 页；完整笔记见本地抓取工件 `tool_175d25002001vamUgOppltUhzH`。

**结论。** 引擎需要三件事，而不是「再加一个全局乘数」：把分级从 3 级延到 **5 级**；
让 **IV/V 级换入电力并置换燃料**（V3 的「高级形态换新中间品 + 少用旧投入」）；
并**退役** plan 0015 的全局电力乘数，让电力的价值只来自它的用途。

## 决定

### 1. `BuildingRecipe.tiers` 从 2 项扩到 4 项（II–V），II/III 原值逐位不变

`BuildTierDef[]`（`engine/data/buildings.ts:167-171`）语义不变，只是变长：
`tiers[0]`=II、`tiers[1]`=III、`tiers[2]`=IV、`tiers[3]`=V。`BUILDING_RECIPES[id]` 仍是 I 级。
`recipeAt` / `mixedRecipe` / `applyBuildingDelta` / `tierWeightedMultiplier` 的消费者
（`engine/economy.ts`、`engine/data/derivations.ts`、`engine/inspect/buildings.ts`、`engine/inspect/labor.ts`）
都按数组长度循环（`counts.length` / `tiers[tier-1]`），**不因长度变化而改一行代码**。

**硬约束**：现有 13 类建筑的 II/III 两个 `BuildTierDef` 必须**逐位保持不变**——这是「≤III 级零行为变化」
的保证，也是 `tests/tier-recipe-data.test.ts` 的 drift guard 基线。

### 2. 电力成为 IV/V 级的投入（DATA-ONLY），并退役全局电力乘数

分三件事，都是本 ADR 的核心：

**(a) 加入电力投入。** 在每一类**生产建筑**的 IV/V 级 `input` 中加入 `electricity`，数量按族分档
（重工业多、采掘少）。这**不需要结算代码改动**：中间需求循环（`engine/economy.ts:390-404`）已经对
`mixedRecipe(country, id).input` 里的**任意商品**按 `座数 × 系数` 通用收费。电力仍 `NON_TRADABLE`
（`engine/trade.ts:59`），因此**只能自产自用**——`powerPlants` 成为后期瓶颈品。
`powerPlants` 自身**不耗电**（它是生产者）；`farms` **不接电**（19 世纪农业不接电，V3 农业 PM 无 electricity）。

**(b) 退役全局电力产出乘数（Supersedes plan 0015 §S4）。** 删除
`electricityOutputMultiplier`（`engine/data/derivations.ts:101-113`）与它的两个常量
`ELECTRICITY_BONUS_PER_PLANT` / `ELECTRICITY_BONUS_MAX`，从 `engine/economy.ts:24`（import）、
`:218`（取值）与 `:263`（`value *= electric`）移除；并**同步处理两处活引用，否则套件无法编译**——
桶文件再导出 `engine/data/index.ts:114-116`、S4 的电力加成用例 `tests/s4-new-industries.test.ts:7,92-115`。
理由：它把电力当成一条**全局乘数**而非投入链，会与
(a) 的投入链**重复计功**，且会给 `powerPlants` 自己的产出加成（自反馈）。V3 同样没有
「有电就全局加成」——**电力的价值只来自它作为投入的用途**。退役后，电力从「免费加成」变成
「真实成本」，`powerPlants` 才成为需要认真配平的瓶颈。

**(c) 不可贸易投入按利用率计费。** 现有中间需求按**原始座数** `buildings[id]` 收费
（`engine/economy.ts:392-395`），而产出按 `effectiveCount × storedUtilization`（`:251`）。
若电力照原始座数收费，则**闲置/过剩的电气化座位会永远按满负荷吃电**，且电力不可进口、无法绕开。
**决定**：中间需求对 **`NON_TRADABLE` 商品（即电力）** 改按 `effectiveCount(buildings[id]) × storedUtilization`
计费（闲置座位按比例少耗电）；**可贸易商品的收费口径不变**（因此全 I 级 oracle 逐位保持）。
这与「产出按利用率折算」的口径对齐，也让电力紧张时可以**关停**高耗电座位。

### 3. 覆盖：18 类生产建筑

| 组 | 建筑 | 处理 |
| --- | --- | --- |
| 现有 13 类（已有 II/III） | `coalMines`、`ironMines`、`lumberMills`、`textileMills`、`furnitureWorks`、`distilleries`、`machineryWorks`、`steelMills`、`arsenals`、`luxuryWorks`、`infrastructure`、`navalYards`、`navalBases` | 追加 IV/V 两项 |
| 农场 | `farms` | 新增 II/III/IV/V 四项 |
| S4 三座新厂 | `chemicalWorks`、`powerPlants`、`locomotiveWorks` | 新增 II/III/IV/V 四项 |
| 营造所 | `workshops` | 新增 II/III/IV/V 四项（产出**建造力**，见 §6） |
| **合计** | **18 类** | — |

**不分级**（保持现状，**5 类**）：`schools`、`universities`、`offices`、`barracks`、`forts`
（公共服务/行政建筑，无 goods 生产扩张语义）。

> 附带修复：`farms` 目前**没有 `tiers`**，而 `general-1836` 等节点早已给出 `unlockTier farms 2`
> ——该效果长期是**死字段**（上限 2，但 `recipeAt('farms', 1)` 回落到 I 级）。为 `farms` 补 II–V
> 后，这条旧的解锁才真正生效。

### 4. 不新增时代，IV/V 由新增的 era-4 电气化节点解锁（集中在工业线）

第 5 时代（1900）本轮不做，`TECH_MAX_ERA` 仍为 4（`engine/config/tech.ts:27`）。
IV/V 级由**新增的 era-4 电气化节点**给出 `unlockTier … 4 / 5`：

- `industry-6 电力工业`（era 4，前置 `industry-4`）：对 **18 类**给 `unlockTier … 4`；
- `industry-7 第二次工业革命`（era 4，前置 `industry-6`）：对 **18 类**给 `unlockTier … 5`。

**已定（不再待确认）**：解锁**集中在工业线的这两个节点**——电气化是工业技术，改动最小、语义最简，
且 `unlockTier` 是全局派生（`maxUnlockedTier`，`engine/data/tech.ts:318`，无上限、默认 1），
任何国家研究到这两个节点即可对全部 18 类解锁 IV/V，无论其主攻哪条分支。

### 5. IV/V 乘数延展附录 B 的族规则，并**置换燃料**（不是纯累乘）

IV/V 沿用 plan 0015 §附录 B 的**族（family）**划分与「累乘」口径（IV 在 III 之上再乘、V 在 IV 之上再乘），
每一级产出增幅落在 **+25%–35%** 区间（对齐 V3 的档位量级），并叠加两项 V3 式改动：

1. **加入 `electricity`**（族分档，见 plan 0016 §附录 A.2）；
2. **置换被替代的燃料 `coal`**：IV/V 把**含煤家族**的 `coal` 系数**下调**（电力替代蒸汽动力），
   再做电力加法。这样升级是一次**真实取舍**（省煤但耗电、且电是瓶颈品），而不是「整体乘一遍再叠一项」。

含煤家族（`steelMills`/`machineryWorks`/`arsenals`/`chemicalWorks`/`locomotiveWorks` 属重工业、
`textileMills`/`furnitureWorks`/`distilleries`/`luxuryWorks` 属轻工业）置换强度见附录 A.1；
**无煤家族**（采掘、船坞、基础设施、海军营地、农场）不置换，电力为纯加法；
**`powerPlants` 不置换**（它的煤是发电燃料，改成「少煤」在语义上不成立；V3 的电厂是
`coal-fired → oil-fired` 换燃料，不是换电）。

### 6. 营造所 `workshops` 分级与高级建筑工程量膨胀：更多、更便宜的建造力（自我加速循环**有意保留**）

营造所（`engine/data/buildings.ts:488-494`）现为 `output:{}`、`input:{wood:1, grain:0.6, iron:0.3}`、
labor 0.8，产出的**建造点**由 `constructionCapacity` 特别处理（`engine/construction.ts:147-181`）。
本 ADR 把营造所纳入分级（I–V），让**更高等级**：

1. **用更先进的材料**：II 起把原始 `iron` 逐步换成加工 `steel`，III 加 `machinery`，IV/V 加 `electricity`
   （完整系数见 plan 0016 §附录 A.5）；`wood`/`grain` 随级小幅下降，labor 累乘上升。
2. **产出更多建造力**：新增 `CONSTRUCTION_CAPACITY_TIER_MULTIPLIER`，按座加权
   （`tierWeightedMultiplier`）乘进 `constructionCapacity` 的 `gross`（`engine/construction.ts:162`）。
3. **每点更便宜**：新增 `CONSTRUCTION_COST_TIER_MULTIPLIER`（随等级递减），按座加权乘进
   `constructionGoldPerPoint`（`engine/construction.ts:118-125`）：
   `每点金价 = CONSTRUCTION_COST_PER_POINT × BUILDING_COST_MULTIPLIER[b] × constructionCostTierMultiplier(country) + 附加项/工程量`。
4. **高级建筑的工程量随等级膨胀（需求侧）**：新增 `WORKLOAD_TIER_MULTIPLIER = [1, 1.3, 1.7, 2.2, 2.8]`——
   **新建**在 tier N 的工程量 `= CAPACITY_COST[id] × WORKLOAD_MULTIPLIER × WORKLOAD_TIER_MULTIPLIER[N-1]`
   （`engine/construction.ts:102`）；升级沿用 §S2 的「`≤60% × 同级新建工程量`」，因此**自动继承膨胀**。

**耦合（本设计的关键，也是需求 1–3 的落点）**：工程量随等级膨胀后，**只有升级过的营造所**
（容量 ×↑、每点金价 ×↓）才付得起——「**用旧（I 级）营造所建 IV/V 建筑会非常困难；升级营造所
正是让这份膨胀的工程量变得可负担的手段**」。两条曲线按座加权后「每金产能」（容量/成本）随营造所
等级上升，但**始终略低于**工程量膨胀，故难度被**保留**而非送掉（平衡表见 plan 0016 附录 D）。

**移除 `NON_UPGRADABLE_BUILDINGS` 里的 `workshops`**（`engine/config/construction.ts:59`），
**Supersedes plan 0015 §S2 / ADR 0031 §5 的「营造所不可升级、升级不提高建造力」守卫**。
被该守卫拦下的**正反馈循环（升级营造所 → 建造力↑ → 更快升级）现在是有意保留的**——
它是本作的**增长引擎**。它由三重闸门约束，不会失控：

- **先进材料供给**：IV/V 的营造所需要 `steel`/`machinery`/`electricity`（电力**不可贸易**，只能自产），缺料即减产；
- **每点成本曲线 + 座数上限**：高等级单价虽降，但每槽仍限 5 座、工程量与建造力抽取规则不变；
- **升级工程量不产建造力**：现有守卫「升级项目的工程量不计入建造力产出」**保留**（升级是消耗方，不是产出方）。

> 营造所的 II/III 解锁来源已定：`industry-1`（era 1）给 II、`industry-3`（era 3）给 III；IV/V 由
> `industry-6`/`industry-7` 给出（见 plan 附录 C.2）。

### 7. 逐级系数表扩到 5 项（含三张新表：两张营造所 + 一张工程量）

七张「按级系数」表必须与 4 项 `tiers` 同步扩到 5 项（索引 0=I … 4=V）：

| 表 | 位置 | 现值 | 建议值（**派生**） |
| --- | --- | --- | --- |
| `INFRA_SUPPLY_TIER_MULTIPLIER` | `engine/data/buildings.ts:666` | `[1, 1.3, 1.6]` | `[1, 1.3, 1.6, 2.08, 2.70]` |
| `SHIPS_PER_NAVAL_BASE_TIER_MULTIPLIER` | `engine/config/military.ts:34` | `[1, 1.25, 1.5]` | `[1, 1.25, 1.5, 1.95, 2.54]` |
| `CONSTRUCTION_CAPACITY_TIER_MULTIPLIER`（**新**） | `engine/config/construction.ts`（`CONSTRUCTION_COST_PER_POINT`:61 旁） | — （新增） | `[1, 1.20, 1.45, 1.75, 2.10]` |
| `CONSTRUCTION_COST_TIER_MULTIPLIER`（**新**） | `engine/config/construction.ts` | — （新增） | `[1, 0.95, 0.90, 0.85, 0.80]` |
| `WORKLOAD_TIER_MULTIPLIER`（**新**） | `engine/config/construction.ts` | — （新增） | `[1, 1.3, 1.7, 2.2, 2.8]` |
| `ROMAN_TIERS` | `view/format.ts:110` **与** `engine/inspect/construction.ts:7` | `['I','II','III']` | `['I','II','III','IV','V']` |
| `TIER_COLORS` | `view/panels/economy.tsx:52` | `['cyan','yellow','green']` | `['cyan','yellow','green','magenta','blue']` |

- **唯一口径**：`INFRA`/`NAVAL` 的 IV/V 取自「在 III 之上每级 ≈×1.30」（`2.08 ≈ 1.6×1.30`、
  `2.70 ≈ 2.08×1.30`；`1.95 = 1.5×1.30`、`2.54 ≈ 1.95×1.30`）；`CONSTRUCTION_CAPACITY` 每级 ≈×1.20、
  `CONSTRUCTION_COST` 每级 ≈×0.95（越升越便宜）、`WORKLOAD` 每级 ≈×1.28–1.30（越升越贵）。
  **绝对系数只写在本表与 plan 附录 B**，正文只写「按系数表」。
- 越界回落（`?? base` / `?? 'cyan'` / `?? String(tier)`）**保留**，旧档/新档都不会抛错。
- **数值校准（本轮的关键）**：本表的 IV/V 为**起始派生值**，由 plan 0016 §S8 用可复现 fixture 校准并
  **回填**（附录 A/B/D = 单一真源）；闸门：每一级 `净每金产能 < WORKLOAD_TIER_MULTIPLIER`、≤III 逐位不变。

### 8. 世界版本：**不升**（保持 v14）

本轮改动**全部是数据 + 一处结算口径**：`tiers` 数组、七张系数表、科技节点表、以及 §2(b) 的乘数退役与
§2(c) 的不可贸易计费口径。**没有新增/变更任何结构字段**（`BuildingRecipe`/`BuildTierDef`/`Country.econ`/
`WorldState` 形状不变）。因此：

- v14 存档**结构上不被破坏**：其 `buildingTiers` 数组最长为 3（全是 I/II/III），载入后
  所有建筑自然停在 ≤ III 级——这是**合法状态**（IV/V 是「尚未解锁的更高档」），
  `recipeAt` 对越界 tier 回落到 I 级；
- 没有需要迁移的字段，因此**不触发 ADR 0005 的版本升级**，也**不做兼容层**。

**明确结论：不升版本。** 但需注意**同版本前向风险**（新档被旧代码读），见 plan 0016 §2。

### 9. 文档同步

见 plan `0016` §4。要点：`GLOSSARY.md` 的「建筑等级」（I/II/III → I–V）、「时代」、
**过时的「科技分支」**条目（4 分支、20 → 22 节点）、新增「电力」词条、**「营造所」词条**（分级 +
更多更便宜的建造力 + 有意保留的正反馈）；
`docs/architecture.md`（§1 规模行、世界版本行、建筑配方 §4.3、建造力一节）；`docs/gm-handbook.md`
（§4.3 配方表、工具示例）；`README.md` 世界模型摘要。

## 后果

- **正面**：
  - 分级系统终于有 5 档，1880 之后的工业有继续投资/升级的意义；
  - 电力从死商品变成**后期瓶颈品**：需要自建 `powerPlants`、配平电网、并在电力紧张时取舍；
  - 「高级形态换入新中间品 + 置换旧投入」这条 V3 范式首次在引擎里成立；
  - **营造所分级**让建造力成为可投资的**增长引擎**：高等级营造所产出更多、每点更便宜；
  - **工程量随等级膨胀**（`WORKLOAD_TIER_MULTIPLIER`）与营造所阶梯咬合：用旧营造所建 IV/V 建筑很困难，
    升级营造所才可负担——「**何时把建造业升级**」第一次成为一个真实决策；
  - 退役全局电力乘数消除了「电力重复计功」和「电厂给自己加成」的自反馈。
- **负面**：
  - 分级配方从 13×2 变为 **18 类的 4 档**配方，`tier-recipe-data.test.ts` 的 drift guard 与 oracle 显著变大；
  - 退役全局乘数是一次**行为变化**（1880 后有电厂的国家产出下降），需要专门的回归测试；
  - 电力**不可贸易**，供需失衡无法靠进口修补，只能靠补 `powerPlants`。
- **风险**：
  - **电力供给瓶颈 / 自举问题**：IV/V 铺开后若 `powerPlants` 跟不上，电力缺口会传导成普遍产出短缺；
    且「电气化的上游（钢/机械）自己也要电」形成自举难题。需要 S5 用可复现 fixture 证明闭合平衡与可行启动顺序。
  - **营造所正反馈循环（有意保留）**：升级营造所 → 建造力↑ → 更快升级。这是**增长引擎**，但若材料/电力
    供给过松会失控；由三重闸门约束（IV/V 需 `steel`/`machinery`/不可贸易的 `electricity`、每点成本曲线、
    每槽 5 座 + 升级工程量不产建造力），并由 S7 用 fixture 断言增幅受限。
  - **非玩家帝国不电气化**：`engine/ai.ts` 与 `engine/investment.ts` 目前**只建 I 级**（从不下 `upgrade`），
    若不加 AI/私人投资升级路径，本特性对非玩家国家形同虚设（见 plan S6）。
  - **分级乘数通胀**：5 档累乘会放大高等级产出，虽以煤置换对冲，仍需 S5 跑经济回归，必要时下调（派生值，可调）。

## 关联

- `docs/plans/0016-five-tiers-and-electrified-inputs.md`（切片、附录与验收）
- `docs/adr/0031-tech-tiers-and-sea-control.md`、`docs/plans/0015-tech-and-building-tiers.md`（分级与三新建筑的来源；本 ADR 退役其 §S4 电力乘数与 §S2 营造所守卫）
- `docs/adr/0021-building-recipes.md`（配方单一真源）、`docs/adr/0022-utilization-and-profit-investment.md`（利用率与利润）
- `engine/data/tiers.ts`、`engine/data/buildings.ts`、`engine/data/derivations.ts`、`engine/data/tech.ts`、
  `engine/config/construction.ts`、`engine/construction.ts`、`engine/config/military.ts`、`engine/trade.ts`、
  `engine/ai.ts`、`engine/investment.ts`
