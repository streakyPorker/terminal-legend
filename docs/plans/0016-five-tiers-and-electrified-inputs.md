# 建筑五级化与电气化投入（five building tiers & electrified inputs）

- Status: **planned**（决策见 `docs/adr/0032-building-tiers-v-and-electrified-inputs.md`；目标 World **v14**）
- Depends on: ADR 0031（科技分级/制海权）、plan 0015（3 级分级与三新建筑）、ADR 0021（配方单一真源）、ADR 0022（利用率与利润）
- Supersedes: plan 0015 §S4 的全局电力产出乘数（`electricityOutputMultiplier`，退役于 S1）
- 评审：纯数据 + 一处结算口径，无结构字段变更。关键派生数值在附录内标 `> 派生值`。修订点在各切片内标 **〔评审〕**。

## 0. 目标与边界

**目标**：把建筑分级从 3 档（I/II/III）延到 **5 档（I–V）**；让 **IV/V 级换入电力并置换燃料**；
**退役** plan 0015 的全局电力产出乘数——修复「电力无消费者却有全局加成」的断点，让 `powerPlants`
成为后期瓶颈品，把 V3「高级形态换入新中间品、换掉旧投入」的范式落到引擎里。

**本轮做**：

- 13 类现有分级建筑的 `tiers` 从 2 项扩到 **4 项**（新增 IV/V；II/III 逐位不变）；
- 18 类生产建筑全覆盖（13 现有 + `farms` + `chemicalWorks`/`powerPlants`/`locomotiveWorks` + `workshops`）；
- 电力成为 **IV/V 级投入**（族分档；含煤家族**置换 `coal`**；`powerPlants` 不耗电、`farms` 不耗电）；
- **退役**全局电力产出乘数；**不可贸易投入按利用率计费**；
- 新增 **era-4 电气化节点** `industry-6` / `industry-7` 给出 `unlockTier … 4 / 5`；
- 七张逐级系数表（`INFRA_SUPPLY_TIER_MULTIPLIER`、`SHIPS_PER_NAVAL_BASE_TIER_MULTIPLIER`、
  `CONSTRUCTION_CAPACITY_TIER_MULTIPLIER`、`CONSTRUCTION_COST_TIER_MULTIPLIER`、`WORKLOAD_TIER_MULTIPLIER`、
  `ROMAN_TIERS`、`TIER_COLORS`）扩到 5 项；
- 面板显示 V 级；**AI 与私人投资具备升级（electrify）路径**；
- **营造所 `workshops` 也分级**：更高等级用更先进的材料、产出**更多、更便宜的建造力**；
  移除「不可升级」守卫，正反馈循环**有意保留**为增长引擎（见 S7）；
- **高级建筑工程量随等级膨胀**：新增 `WORKLOAD_TIER_MULTIPLIER = [1,1.3,1.7,2.2,2.8]`——
  **只有旧（I 级）营造所时，建 IV/V 建筑会非常困难**；**升级过的营造所（容量 ×↑、每点金价 ×↓）
  正是让这份膨胀变得可负担的手段**（需求侧与营造所阶梯的耦合，见 S1/S7 与附录 D）。
- **数值校准（本轮的关键：这里关键是调数值）**：**S0–S7 落机制，S8 调数值**——用可复现 fixture
  把附录 A/B/D 的派生值调进目标带内，最终值回填附录（附录 = 单一真源）。S8 可能回改 S0/S7 的表，
  届时**必须重跑那两个切片的测试**（见 S8 与附录 E）。

**本轮不做**：

- 第五时代（1900）——`TECH_MAX_ERA` 仍为 4，IV/V 走 era 4；
- 新的商品（电力/化工品/机车已在 v14 存在）；
- **逐建筑**独立的工程量微调表——工程量只随 tier 膨胀（`WORKLOAD_TIER_MULTIPLIER`），不按建筑单独调；
- 结构性字段（无新字段 → 不升世界版本，见 §2）。

### 0.5 变更面（已核对 file:line）

> 以下为**核对过**的现有代码位置；本计划只改标注「改」的部分，其余是「读通即用」。

**配方数据（改）**：13 类现有 `tiers[]` 各追加 IV/V 两项——
`engine/data/buildings.ts` `coalMines`:226、`ironMines`:237、`lumberMills`:248、`textileMills`:274、
`furnitureWorks`:296、`distilleries`:321、`machineryWorks`:340、`steelMills`:363、`arsenals`:378、
`luxuryWorks`:397、`infrastructure`:430、`navalYards`:448、`navalBases`:468；
**新增 tiers**：`farms`（`:212`）、`chemicalWorks`（`:502`）、`powerPlants`（`:510`）、`locomotiveWorks`（`:518`）。
类型 `BuildTierDef`（`:167`）、`BuildingRecipe.tiers`（`:199`）形状不变。

**系数表（改）**：`INFRA_SUPPLY_TIER_MULTIPLIER`（`engine/data/buildings.ts:666`）、
`SHIPS_PER_NAVAL_BASE_TIER_MULTIPLIER`（`engine/config/military.ts:34`）、
新增 `CONSTRUCTION_CAPACITY_TIER_MULTIPLIER` / `CONSTRUCTION_COST_TIER_MULTIPLIER` / `WORKLOAD_TIER_MULTIPLIER`
（`engine/config/construction.ts`，`CONSTRUCTION_COST_PER_POINT`:61 旁）、
`ROMAN_TIERS`（`view/format.ts:110` **与** `engine/inspect/construction.ts:7`）、
`TIER_COLORS`（`view/panels/economy.tsx:52`）。

**科技节点（改）**：`engine/data/tech.ts` `TECH_NODES`:26 追加 `industry-6`/`industry-7`；
增补既有节点效果（`industry-4`:137、`industry-5`:124、`general-1865`:61）；
`maxUnlockedTier`:318 **无需改**（已派生、无上限）。

**结算口径（改）**：退役 `electricityOutputMultiplier`（`engine/data/derivations.ts:101-113`）与其常量
`ELECTRICITY_BONUS_PER_PLANT` / `ELECTRICITY_BONUS_MAX`。**该符号有两处活引用，S1 必须同步删除/改写，
否则测试套件无法编译**：
- **桶文件再导出** `engine/data/index.ts:114-116`（`electricityOutputMultiplier` + 两个常量）；
- **S4 测试** `tests/s4-new-industries.test.ts:7`（import）与 `:92-115`
  （`describe('S4 electricity: non-tradable, and only self-production gives the output bonus …')` 用例）——
  S1 须整块删除或改写为「电力只作投入、无全局产出加成」的新断言。
另移除 `engine/economy.ts:24`（import）与 `:218`（取值）、`:263`（`value *= electric`）。
`engine/economy.ts:390-404` 的中间需求对 `NON_TRADABLE` 商品改用 `effectiveCount × storedUtilization`。

**AI / 私人投资（改）**：`engine/ai.ts`（`build` action 枚举与校验，`:210-268`）新增 `upgrade`；
`engine/investment.ts`（`:172-256` 只 `draftProject(building, 1)` 建 I 级）新增升级判定。

**建造力 / 营造所（改）**：`engine/config/construction.ts` —— `NON_UPGRADABLE_BUILDINGS`（`:59`，清空 `'workshops'`）、
新增 `CONSTRUCTION_CAPACITY_TIER_MULTIPLIER`、`CONSTRUCTION_COST_TIER_MULTIPLIER` 与 `WORKLOAD_TIER_MULTIPLIER`
（`CONSTRUCTION_COST_PER_POINT`:61 旁）；
`engine/construction.ts` —— `WORKSHOP_INPUTS`（`:52-53`，`= BUILDING_RECIPES.workshops.input`，改为 tier-aware）、
`constructionGoldPerPoint`（`:118-125`，乘成本乘数）、`constructionCapacity`（`:147-181`，`gross` 乘容量乘数）、
`projectWorkload`（`:102-105`，**新建**乘 `WORKLOAD_TIER_MULTIPLIER[targetTier-1]`；升级 = `UPGRADE_WORKLOAD_SHARE × 同级新建`，故继承膨胀）。

**测试（改）**：`tests/tier-recipe-data.test.ts`（`TIERED`:29、`FAMILY_RULES` 6 元组:39-54、
`expandTiersRaw`:79-117、`length===2`:126、`untiered` 守护:139、`CHECK`:165、`checkVA`:174）；
`tests/tier-settlement.test.ts`（`blend()` 2 级助手在 **:65**，须扩到 4 级）；
`tests/s3-tech-nodes.test.ts`（`APPENDIX_IDS`:50、节点数/每分支:57-64、era 序列:60）；
`tests/s4-new-industries.test.ts`（`:7` import、`:92-115` 电力加成用例：S1 退役后删除/改写）；
`tests/tech-ai-selection.test.ts`（120 月 pacing `gained ∈ [2,5]` 在 **:169-171**，新增 2 个 era-4 节点后须复核）；
`tests/construction-capacity.test.ts`（容量乘数）、`tests/s2-upgrade.test.ts`（营造所可升级）、
`tests/building-recipes.test.ts`（非可升级断言）。

**面板（改）**：`view/panels/economy.tsx:52,104`（`TIER_COLORS`）、
`view/panels/construction.tsx:14,24`（用 `tierName` 显示 `IV→V`）、
`view/panels/tech.tsx:16,27`（`effectText` 渲染 `unlockTier` 到 IV/V）。

**读通即用（不改）**：`recipeAt`/`mixedRecipe`（`engine/data/tiers.ts:13,29`）、
`tierWeightedMultiplier`（`:65`）、`applyBuildingDelta`（`:99`）；
生产（`engine/economy.ts:248-251`）、利润工资（`:181,599`）、劳动需求（`engine/data/derivations.ts:315`、
`engine/inspect/labor.ts:17`）、`inspect/buildings.ts:10`、`actions/build.ts:113-194`（tier 校验走 `maxUnlockedTier`）；
`NON_TRADABLE`（`engine/trade.ts:59`）；`CURRENT_WORLD_VERSION = 14`（`engine/save.ts:7`）。

## 1. 切片

九个切片，**按顺序提交**。S0 先让 13 类的数据与守护自洽，≤III 行为不变；**S8 调数值**（可能回改 S0/S7 的表）。

### S0 数据片：13 类 tiers 扩到 4 项 + 系数表 + 守护余量 〔评审〕

**做**

1. **13 类**现有建筑的 `tiers` 数组**追加 IV/V 两项**（`engine/data/buildings.ts`，见 §0.5 行号）；
   II/III 两项**逐位不变**（与 0015 落值一致）。
2. IV/V 的 `input` 加入 `electricity`，并对**含煤家族**先做 `coal` 置换（规则见附录 A）。
3. 逐级系数表扩到 5 项 / 新增：`INFRA_SUPPLY_TIER_MULTIPLIER = [1,1.3,1.6,2.08,2.70]`、
   `SHIPS_PER_NAVAL_BASE_TIER_MULTIPLIER = [1,1.25,1.5,1.95,2.54]`，并**新增**
   `WORKLOAD_TIER_MULTIPLIER = [1,1.3,1.7,2.2,2.8]`（工程量随等级膨胀，S1 接线）。
   （`CONSTRUCTION_CAPACITY_TIER_MULTIPLIER` / `CONSTRUCTION_COST_TIER_MULTIPLIER` 在 S7 引入，见附录 B。）
4. `ROMAN_TIERS` 与 `TIER_COLORS` 扩到 5 项（附录 B）。
5. **守护扩列（只管 13 类）**：`tests/tier-recipe-data.test.ts` 的 `TIERED` **保持 13**；
   `length===2` → `===4`；`FAMILY_RULES` 由 6 元组扩为 **12 元组**
   `[outII,inII,labII, outIII,inIII,labIII, outIV,inIV,labIV, outV,inV,labV]`；
   新增 `FAMILY_COAL`（重工业 0.70/0.60、轻工业 0.80/0.70、其余 1/1）；
   新增**逐建筑** `PER_BUILDING_ELECTRICITY` 表（A.2；S0 覆盖 13 类）；
   `expandTiersRaw` 扩到 4 项，含**置换**与**逐建筑电力**（见附录 A）；`CHECK` oracle 扩 IV/V 两列。

**验收**

- **全 I/II/III 级**时输出、投入、劳动、利润、需求与 v14 **逐位一致**；
- drift guard：存储的 4 项 `tiers` 与按附录 A 规则**独立展开**（含 `FAMILY_COAL` 与 `PER_BUILDING_ELECTRICITY`）
  **逐位相等**；电力数量**逐建筑断言**（重工业 `steelMills` 0.30 ≠ `chemicalWorks` 0.35 ≠ `locomotiveWorks` 0.25）；
- 5 项系数表不被越界访问（`tierWeightedMultiplier` / `ROMAN_TIERS` / `TIER_COLORS` 的兜底分支有测试）；
- 全量测试通过；`CURRENT_WORLD_VERSION === 14`。

### S1 结算贯通：退役电力乘数 + 电力按利用率计费 〔评审〕

**做**

1. **退役全局电力乘数**：删除 `electricityOutputMultiplier`（`engine/data/derivations.ts:101-113`）
   与 `ELECTRICITY_BONUS_PER_PLANT`/`ELECTRICITY_BONUS_MAX`；移除 `engine/economy.ts:24`（import）、
   `:218`（取值）与 `:263`（`value *= electric`）。**同步处理两处活引用（否则套件无法编译）**：
   删除桶文件再导出（`engine/data/index.ts:114-116`），删除/改写 S4 用例
   （`tests/s4-new-industries.test.ts:7,92-115`，改为「电力只作投入」的新断言）。加一条测试锁死「电力的价值只来自投入」。
2. **不可贸易投入按利用率计费**：`engine/economy.ts:390-404` 对 `NON_TRADABLE` 商品改用
   `effectiveCount(buildings[id]) × storedUtilization(country, id)`（闲置座位按比例少耗电）；
   **可贸易商品的收费口径不变**（全 I 级 oracle 逐位保持）。
3. 证明**通用收费路径**：`mixedRecipe(...).input` 收入 `electricity` 后自动按上述口径充电，无需额外接线。
4. 边界测试：`counts` 长 4/5 时 `mixedRecipe`/`recipeAt`/`tierWeightedMultiplier` 正确；
   混级（如 5 I + 3 II + 2 IV + 1 V）时 `intermediate.electricity` 等于**独立手算值**——
   扩 **`tests/tier-settlement.test.ts`**（其 `blend()` 2 级助手在 **:65**，扩为 4 级多座混合）。
5. `engine/inspect/buildings.ts` / `labor.ts` 展示 IV/V（已读 `mixedRecipe`，验证含新级）。
6. 私人投资 / AI 的 tier 上限：`actions/build.ts` 的 `tier`/`upgrade` 在 `maxUnlockedTier` 达 IV/V 时接受 4/5。
7. **工程量随等级膨胀**：`projectWorkload`（`engine/construction.ts:102-105`）对**新建**乘
   `WORKLOAD_TIER_MULTIPLIER[targetTier-1]`（targetTier 缺省 1 → ×1）；**升级**沿用
   `UPGRADE_WORKLOAD_SHARE × 同级新建工程量`，因此**自动继承膨胀**（V 级升级 ≫ I 级升级）。

**验收**

- 只含 I–III 座数时 `intermediate.electricity === 0`；出现 IV/V 座数后 > 0；
- **闲置门槛**：把电气化座位利用率降到 0，electricity 需求随之降到 0；可贸易商品需求**不受影响**；
- 退役乘数后，1880 前（无电厂）产出**逐位不变**；有电厂的国家产出按投入链变动（新 oracle）；
- `powerPlants` 的 IV/V **不自耗** `electricity`；
- **工程量膨胀**：tier-V 新建工程量 ≈ **2.8×** 同建筑的 tier-I 工程量；升级到 V 的工程量
  = `0.5 × V 级新建`（继承膨胀）；全 I 级时逐位不变（乘数 ×1）；
- 存档往返后可继续施工；60/120 月确定性与金币守恒不破。

### S2 科技节点：IV/V 解锁（`unlockTier 4/5`）

**做**

1. 新增 `industry-6 电力工业`（era 4，前置 `industry-4`）：对 **17 类**给 `unlockTier … 4`；
   新增 `industry-7 第二次工业革命`（era 4，前置 `industry-6`）：对 **17 类**给 `unlockTier … 5`（附录 C）。
   （S3 后为 17 类；**S7 加入 `workshops` 后扩到 18 类**——见 S7#7 与附录 C.1。）
2. 更新 `tests/s3-tech-nodes.test.ts`（`APPENDIX_IDS`、节点总数 20 → 22、每分支数量、era 序列）。
3. **复核 `tests/tech-ai-selection.test.ts:169-171`** 的 120 月 pacing 上界 `gained ∈ [2,5]`——
   新增 2 个 era-4 节点可能改变可得节点数；如越界，按新节点数更新上界（并注明理由）。
4. 面板科技页渲染 `unlockTier` 到 IV/V 的中文文本（`view/panels/tech.tsx:16,27`，已按 `kind` 分支）。

**验收**

- 节点表完整性：id 唯一、前置存在、无环、每节点至少一项解锁效果（表驱动测试）；
- `maxUnlockedTier(qing, 'steelMills')` 在解锁 `industry-4/6/7` 后依次为 3/4/5；
- 未解锁 IV/V 时 `build tier=4` / `upgrade toTier=5` 被拒（正反用例）；
- **升级工程量继承膨胀**：升级到 V 级的工程量 = `UPGRADE_WORKLOAD_SHARE × V 级新建工程量`
  = `0.5 × CAPACITY_COST × WORKLOAD_MULTIPLIER × 2.8`（显著高于升级到 I/II 级，见 S1 与附录 D）；
- 开局国家的已解锁节点效果仍生效（`industry-6/7` 是后期节点，不影响 1836 基线）。

### S3 新建筑与农场分级（守护扩到 17 类）

**做**

1. 给 `farms` 补 `tiers` II/III/IV/V（附录 A「农场族」规则）；**同时使既有 `unlockTier farms 2`
   （`general-1836`）由死字段变为生效**。
2. 给 `chemicalWorks`、`powerPlants`、`locomotiveWorks` 补 II/III/IV/V
   （`chemicalWorks`/`locomotiveWorks` 用重工业族规则；`powerPlants` 用重工业族输出规则但**不耗电、不置换**）。
3. 补齐新建筑的 `unlockTier` 来源（附录 C）：`farms` III ← `general-1865`；
   `chemicalWorks` II ← `industry-5`、III ← `industry-4`；
   `powerPlants`/`locomotiveWorks` II/III ← `industry-4`；IV/V ← `industry-6`/`industry-7`。
4. **守护扩到 17 类**：`tests/tier-recipe-data.test.ts` 的 `TIERED` 由 13 → **17**，
   `PER_BUILDING_ELECTRICITY` 补 `farms`/`powerPlants`（均为 none）与三座新厂，
   `expandTiersRaw` 增加显式 **`powerPlants`（不耗电）** 与 **`farms`（不耗电）** 分支并断言相等。

**验收**

- `farms`、三座新建筑的 II–V 级产出/投入/劳动符合附录 A 规则；
- `powerPlants` IV/V 无 `electricity` 投入（自耗为 0）；`farms` IV/V 无 `electricity` 投入；
- `unlockTier farms 2` 生效：解锁后 `maxUnlockedTier(farms) === 2` 且 `recipeAt('farms',1)` 为 II 级；
- 新建筑解锁前不可建（玩家、AI、私人投资三条路径都拒绝）；17 类 drift guard 全绿。

### S4 面板与等级显示

**做**

1. `tierName` 显示 I–V（`view/format.ts:110` 与 `engine/inspect/construction.ts:7` 两处 `ROMAN_TIERS`）。
2. `TIER_COLORS` 5 色（`view/panels/economy.tsx:52`）；经济页「建筑与基础设施」段的等级比例条可容纳 5 段。
3. 建造队列行显示 `IV→V`（`view/panels/construction.tsx:24` 复用 `tierName`）。

**验收**

- 面板不越界（`TIER_COLORS[4]` 有值）；比例条与 `buildingTiers` 一致；
- `panel-build.test.tsx`、`construction-layout.test.ts`、`game.test.tsx` 按 5 级改写并更新。

### S5 经济回归、自举与可满足性 〔评审〕

**做**

1. **可满足性 fixture（从零）**：构造一个从空开始的场景，证明**闭合的电力平衡**——
   发电所需的上游（`steelMills`/`machineryWorks`/`coalMines` 的 IV/V）**自己也吃电**，
   这是一个联立关系；fixture 证明存在一组座数让 `Σ 电力供给 ≥ Σ 电力需求`。
2. **可行启动顺序**：证明先建 I/II/III（不耗电）的钢/机械 → 建 `powerPlants` → 再电气化的顺序
   不会死锁（前一步不依赖后一步）；把它写成 fixture 的注释与断言。
3. 用可复现 fixture（`newWorld(seed, …)` + 手工设定 IV/V 座数与 `powerPlants` 座数）跑 60/120 月，
   检查：电力供需可闭合、IV/V 升级后利润在校准带内、aggregate margin 不被顶爆。
4. 必要时下调 IV/V 乘数、置换强度或电力数量（附录 A 数值是**派生值**，可调）。
5. **软提示**：当某国电力供给为 0 且尝试 IV/V `build`/`upgrade` 时，工具返回一条**警告文本**
   （不阻断，只提示「该国无电力供给」）。

**验收**

- 1836 基线（无 IV/V 座数）逐位不变；
- 末期存在电力需求与供给且缺口可被 `powerPlants` 补上（无永久负库存）；fixture 的闭合平衡成立；
- 末期逐建筑毛利率落在 `tests/economy-recipe-calibration.test.ts` 的带内（或按新带更新）；
- 无电力供给的国家下 IV/V 令时收到警告文本。

### S6 AI 与私人投资的升级路径 〔评审〕

> ADR 0032 §后果风险：`engine/ai.ts` 与 `engine/investment.ts` 目前**只建 I 级**，非玩家帝国永不电气化。
> **已定：本轮要做**（而非「本轮不做 + 后续」）——否则本特性对非玩家国家形同虚设。

**做**

1. `engine/ai.ts`：`build` action 之外支持 `upgrade`（`building`/`fromTier`/`toTier`/`count`）；
   在下一档已解锁且**预估毛利提升**时，把「升级既有座位」列为候选，按既有打分逻辑择优。
2. `engine/investment.ts`：当 `maxUnlockedTier(country, building) > 1` 且目标类已有存量座位时，
   私人投资可下 `kind:'upgrade'` 项目（复用 `UPGRADE_WORKLOAD_SHARE` 与座数预约规则），
   与新建共用余额与上限。
3. 保持确定性：AI/私人升级选择**无 RNG**，同种子同结果。
4. **基线重定带（S6 专属）**：私人投资本就跑在基线 `advance` 结算内，S6 一加升级路径，**II/III 级的
   产出/毛利基线就会移动**——须在 S6 重跑 `tests/economy-recipe-calibration.test.ts` 并**必要时重定
   其 `FAMILY_BANDS`**（不是只在 S5 做；S5 只覆盖 IV/V 的带内）。这是**行为变化**，需在验收里显式断言。

**验收**

- 解锁 IV/V 后，非玩家国家在 60 月内出现 ≥1 次升级（fixture）；
- 升级不越过 `maxUnlockedTier`，不超库存座数，不触发建成副作用；
- 60/120 月确定性与金币守恒不破；
- **S6 后 `tests/economy-recipe-calibration.test.ts` 重跑通过**：私人投资升级导致的 II/III 毛利率偏移
  要么仍落在既有 `FAMILY_BANDS` 内，要么按新基线**重定 `FAMILY_BANDS` 并注明理由**（不得静默放过）。

### S7 营造所分级：让膨胀的高级建筑工程量变得可负担（自我加速循环**有意保留**）〔评审〕

> **切片选择**：营造所独立成 **S7**（不并入 S3）。理由：S3 是纯配方数据（farms + 三新厂），而营造所
> 触及**结算接缝**（`constructionCapacity` / `constructionGoldPerPoint` / `WORKSHOP_INPUTS`）与
> 「可升级」守卫的移除，风险面与测试面独立，需单独验收。

**做**

1. 给 `workshops` 补 `tiers` II–V（附录 A.5：II 起原始 `iron` 换加工 `steel`、III 加 `machinery`、
   IV/V 加 `electricity`；`output:{}`，产出仍由 `constructionCapacity` 特别处理）。
2. **更多建造力**：新增 `CONSTRUCTION_CAPACITY_TIER_MULTIPLIER = [1,1.20,1.45,1.75,2.10]`；
   `constructionCapacity`（`engine/construction.ts:147`）的 `gross` 乘
   `tierWeightedMultiplier(country,'workshops',…)`（全 I 级时 ×1，逐位不变）。
3. **每点更便宜**：新增 `CONSTRUCTION_COST_TIER_MULTIPLIER = [1,0.95,0.90,0.85,0.80]`；
   `constructionGoldPerPoint`（`:118`）乘 `tierWeightedMultiplier(country,'workshops',…)`，即
   `每点金价 = CONSTRUCTION_COST_PER_POINT × BUILDING_COST_MULTIPLIER[b] × 营造所成本乘数 + 附加项/工程量`。
4. **材料进阶接线**：`WORKSHOP_INPUTS`（`:52-53`）由 `BUILDING_RECIPES.workshops.input`
   改为 `mixedRecipe(country,'workshops').input`（tier-aware），使 IV/V 的 `steel`/`machinery`/`electricity`
   真实进入 `constructionCapacity` 的供给约束（缺料则建造力下降）。
5. **移除守卫**：`NON_UPGRADABLE_BUILDINGS`（`engine/config/construction.ts:59`）清空为 `[]`；
   **Supersedes plan 0015 §S2 / ADR 0031 §5「营造所不可升级、升级不提高建造力」**；
   「升级项目工程量不计入建造力产出」的守卫**保留**（升级是消耗方）。
6. **守护/测试**：`tests/tier-recipe-data.test.ts` 的 `TIERED` 17 → **18**，`expandTiersRaw` 增加 `workshops`
   分支（`output:{}` + A.5 输入/用工）；`tests/construction-capacity.test.ts` 增容量乘数与成本乘数用例；
   `tests/s2-upgrade.test.ts` 改「营造所可升级」；`tests/building-recipes.test.ts` 更新非可升级断言。
7. **解锁来源**：把 `workshops` 加入 `industry-6`/`industry-7` 的 `unlockTier` 覆盖（**17 → 18 类**），
   并给 `industry-1` 加 `unlockTier workshops 2`、`industry-3` 加 `unlockTier workshops 3`（附录 C.2）。

**验收**

- 全 I 级时建造力与 v14 **逐位一致**（`CONSTRUCTION_CAPACITY_TIER_MULTIPLIER[0]=1`，成本乘数亦 ×1）；
- 高等级营造所**按座加权**产出更多建造力；**每点金价按公式下降**（容量与成本各一条测试）；
- IV/V 的 `steel`/`machinery`/`electricity` 计入 `WORKSHOP_INPUTS` 供给约束，缺料则建造力同比下降；
- **可负担性（本切片的目的）**：同一 V 级新建工程，在**只有 I 级营造所**时（净每金产能 ×1.0）工期明显更长
  （≈ **2.8×** 同建筑在 I 级营造所下建 I 级的工期）；换成 **V 级营造所**（容量 ×2.10、每点金价 ×0.80，
  净每金产能 ×2.63）后回到与 I 级建筑接近的水平（平衡表见附录 D）——**升级营造所 = 让膨胀的工程量可负担**；
- `upgrade` 对 `workshops` 不再被拒（正反用例）；**正反馈循环存在但被约束**——
  fixture 断言升级后建造力增幅受材料/电力供给上限约束、且每点成本随级下降；
- 60/120 月确定性与金币守恒不破。

### S8 数值校准（本轮的关键：这里关键是调数值）〔评审〕

> **定位**：S0–S7 把**机制**搭好（分级、电力投入、营造所容量/成本、工程量膨胀）；**S8 只调数值**。
> 用**可复现 fixture** 把附录 A/B/D 的派生值调进目标带，并把最终值**回填**附录，使**附录成为单一真源**
> （fixture 内嵌附录值并断言引擎常量相等）。若 S8 改动了 S0/S7 的表，**必须重跑那两个切片的测试**。

**做**

1. 新建 `tests/tier-calibration.test.ts`（setup 与确切测量见附录 E.2）。
2. 按附录 E.1 的**目标表**逐项测量：难度比、工期（I 级 vs N 级营造所）、单次金价、电力供需、逐类毛利。
3. 按附录 E.3 的**调参顺序**（`WORKLOAD` → `CAPACITY` → `COST` → 族电力数量 → IV/V 配方乘数）修表，
   每次只动一个旋钮。
4. 把**最终值回填**附录 A/B/D，并让 fixture 内嵌同一组值断言引擎常量（附录 = 单一真源）。
5. 每次改数值后**重跑** S0（drift guard）、S1（全 I 位等价）、S6/S7 相关测试。

**验收**

- fixture 测得的**难度比 / 工期比 / 金价比**与附录 E.1 目标**在容差内**（见 E.1 容差列）；
- 电力供需闭合（`demand/supply ∈ [0.60, 0.95]`，容差 ±0.05）；
- 各分级建筑 IV/V 毛利落在 `tests/economy-recipe-calibration.test.ts` 的 `FAMILY_BANDS` 内；增值 I→V **单调不减**；
- ≤III **逐位不变**、60/120 月确定性 + 两条金币恒等式全绿；
- **记录（records）**：最终值只存在于附录（A/B/D）；fixture 断言「引擎常量 == 附录值」——**文档即单一真源**，
  不允许数值只活在测试里。

## 附录 A：IV/V 分级配方（规则 + 派生值）

> 评审：IV/V 数值为**派生值（非既有冻结值）**，可调。I 级 = 现有 `BUILDING_RECIPES`，**不动**；
> II/III 级 = plan 0015 §附录 B 的**既有冻结值**，逐位不变。以下定义 IV/V（族规则）、`farms` 的 II/III
> 与 `workshops` 的 I–V 进阶（A.5）。
> 乘数为**累乘**口径：IV 在 III 之上再乘、V 在 IV 之上再乘；展开结果入库到 `engine/data/buildings.ts` 的 `tiers`。

### A.1 族规则（IV/V）

| 族 | 成员 | IV 级 | V 级 |
| --- | --- | --- | --- |
| 重工业 | `steelMills`、`machineryWorks`、`arsenals`、`chemicalWorks`、`locomotiveWorks` | output ×1.30，input ×1.12，labor ×1.05，**置换 `coal` ×0.70** | output ×1.28，input ×1.10，labor ×1.02，**置换 `coal` ×0.60** |
| 采掘 | `coalMines`、`ironMines`、`lumberMills` | output ×1.30，labor ×1.10 | output ×1.28，labor ×1.08 |
| 轻工业 | `textileMills`、`furnitureWorks`、`distilleries`、`luxuryWorks` | output ×1.30，input ×1.10，labor ×1.05，**置换 `coal` ×0.80** | output ×1.28，input ×1.08，labor ×1.03，**置换 `coal` ×0.70** |
| 船坞 | `navalYards` | `ships` ×1.30，input ×1.08，labor ×1.05（`machinery` 沿用 II 后不变） | `ships` ×1.35，input ×1.06，labor ×1.03 |
| 基础设施 | `infrastructure` | `INFRA_SUPPLY` **按附录 B 系数表**（每级 ≈×1.30），input ×1.20 | 同上，input ×1.25 |
| 海军营地 | `navalBases` | 编练率 **按附录 B 系数表**（每级 ≈×1.30），input ×1.15 | 同上，input ×1.20 |
| 发电厂 | `powerPlants` | output ×1.30，input ×1.12，labor ×1.05（**不耗电、不置换**） | output ×1.28，input ×1.10，labor ×1.02（**不耗电、不置换**） |
| 农场 | `farms` | output ×1.25，labor ×1.08（**不耗电**） | output ×1.25，labor ×1.05（**不耗电**） |

**置换操作顺序（drift guard 须照此展开）**：先按上表 `input ×系数` 缩放整篮，**再**对存在的 `coal`
乘**置换系数**，**最后**把 `electricity`（A.2）写入 `input`。`farms` 的 **II/III** 为：
II = output ×1.25、labor ×1.10；III = output ×1.25、labor ×1.08（累乘；无 input、无置换、无电力）。

> 与附录 B 同型：IV/V 每条都是乘数，累乘于 III 之上；每级产出增幅落在 **+25%–35%**。
> 船坞的 `machinery` 输出沿用 0015 的「II 之后不变」口径；
> 基础设施的 `locomotives` 投入（III 为 0.4/座/月）随 input 乘数同步抬升（IV 0.48、V 0.60）。
> 无煤家族（采掘/船坞/基础设施/海军营地/农场）不置换——电力为纯加法。

### A.2 电力投入（IV/V，每座每月）

| 建筑 / 族 | IV 级 `electricity` | V 级 `electricity` |
| --- | ---: | ---: |
| 重工业：`steelMills`/`machineryWorks`/`arsenals` | 0.30 | 0.40 |
| 化工：`chemicalWorks` | 0.35 | 0.45 |
| 机车：`locomotiveWorks` | 0.25 | 0.32 |
| 轻工业：`textileMills`/`furnitureWorks`/`distilleries`/`luxuryWorks` | 0.15 | 0.20 |
| 营造所：`workshops` | 0.15 | 0.22 |
| 船坞：`navalYards` | 0.20 | 0.28 |
| 基础设施：`infrastructure` | 0.30 | 0.40 |
| 海军营地：`navalBases` | 0.10 | 0.15 |
| 采掘：`coalMines`/`ironMines`/`lumberMills` | 0.08 | 0.12 |
| 发电厂：`powerPlants` | — （自产不耗） | — （自产不耗） |
| 农场：`farms` | — （不接电） | — （不接电） |

> **耗电强度排序（由高到低）：化工 0.35 > 重工业 0.30 = 基础设施 0.30 > 机车 0.25 > 船坞 0.20 >
> 轻工业 0.15 = 营造所 0.15 > 海军营地 0.10 > 采掘 0.08**（`powerPlants`/`farms` 为 0）。
> 派生依据：`powerPlants` I 级产 `electricity` 2.8/座/月（V 级 8.49），故一座 V 级电厂约可支撑
> 20+ 座 V 级重工业座位的用电。全部为**派生值**，S5 按电力供需回归校准。
> **drift guard 须逐建筑编码本表**（重工业内部并不一致：`steelMills` 0.30 ≠ `chemicalWorks` 0.35 ≠ `locomotiveWorks` 0.25）。

### A.3 关键校验值（基价下，用于 S0/S1 的 oracle）

| 建筑 | I 级增值 | II 级增值 | III 级增值 | IV 级增值 | V 级增值 |
| --- | ---: | ---: | ---: | ---: | ---: |
| steelMills | 5.08 | 7.92 | 12.10 | **17.06** | **23.77** |
| machineryWorks | 1.35 | 2.39 | 3.97 | **5.35** | **7.66** |
| arsenals | 3.26 | 4.84 | 7.13 | **9.28** | **12.50** |
| textileMills | 2.26 | 3.35 | 4.89 | **6.71** | **9.29** |
| furnitureWorks | 1.04 | 1.56 | 2.30 | **2.99** | **4.16** |
| luxuryWorks | −0.03 | 0.83 | 2.16 | **3.81** | **6.29** |

> 计算口径：基价、单座、每月。`增值 = Σ(产出×价) − Σ(投入×价)`，未扣工资；工资按
> `WAGE_ALLOCATION='valueAdded'` 分摊。I–III 列为 0015 既有 oracle；
> **IV/V 列为派生值**（按 A.1 规则在 III 之上展开：input 先缩放、`coal` 再置换、再加 `electricity`、
> 并扣除 A.2 电力成本）。

> 2026-10-26 设计冻结：IV/V 列为派生值，S0 入库时以 drift guard（规则重展开）为准；
> 若 S5 校准改动规则，须同步改本表并注明日期（参考 0015 的 `2026-10-25` 校正先例）。

### A.4 已落值（IV/V 入库结果，`round3`）

> 以下为按 A.1/A.2 规则展开、四舍五入到 3 位小数后的**入库值**（`tiers[2]`/`tiers[3]`）。
> drift guard 须断言存储值 === 规则展开值。**派生值**。

**IV 级（`tiers[2]`）**

| 建筑 | output | input | labor |
| --- | --- | --- | ---: |
| coalMines | `{coal:2.109}` | `{electricity:0.08}` | 0.835 |
| ironMines | `{iron:2.109}` | `{electricity:0.08}` | 0.835 |
| lumberMills | `{wood:2.109}` | `{electricity:0.08}` | 0.557 |
| textileMills | `{fabric:4.394, clothes:0.439}` | `{grain:1.355, coal:0.195, wood:0.136, machinery:0.244, electricity:0.15}` | 1.091 |
| furnitureWorks | `{furniture:1.523}` | `{wood:0.037, coal:0.049, fabric:0.427, steel:0.11, machinery:0.061, electricity:0.15}` | 0.849 |
| distilleries | `{liquor:1.878}` | `{grain:0.823, coal:0.098, wood:0.067, machinery:0.116, electricity:0.15}` | 0.728 |
| machineryWorks | `{machinery:1.895}` | `{steel:0.793, coal:0.202, wood:0.144, machinery:0.26, electricity:0.3}` | 1.213 |
| steelMills | `{steel:9.477}` | `{iron:4.616, coal:1.01, machinery:0.144, electricity:0.3}` | 1.213 |
| arsenals | `{arms:2.369}` | `{steel:0.519, machinery:0.26, coal:0.121, iron:0.26, electricity:0.3}` | 1.091 |
| luxuryWorks | `{luxury:1.055}` | `{fabric:2.033, coal:0.282, wood:0.19, machinery:0.325, electricity:0.15}` | 0.97 |
| infrastructure | `{}` | `{steel:0.331, wood:0.265, locomotives:0.48, electricity:0.3}` | 0.54 |
| navalYards | `{ships:0.731, machinery:0.033}` | `{steel:0.231, wood:0.154, machinery:0.051, electricity:0.2}` | 0.97 |
| navalBases | `{}` | `{ships:1.455, electricity:0.1}` | 0.6 |
| farms | `{grain:0.391, wood:0.078, opium:0.008}` | `{}` | 0.385 |
| chemicalWorks | `{chemicals:3.554}` | `{coal:0.505, iron:1.803, machinery:0.289, electricity:0.35}` | 1.213 |
| powerPlants | `{electricity:6.634}` | `{coal:0.866, machinery:0.289, steel:1.01}` | 1.213 |
| locomotiveWorks | `{locomotives:1.895}` | `{steel:1.443, machinery:0.289, coal:0.404, electricity:0.25}` | 1.213 |

**V 级（`tiers[3]`）**

| 建筑 | output | input | labor |
| --- | --- | --- | ---: |
| coalMines | `{coal:2.7}` | `{electricity:0.12}` | 0.902 |
| ironMines | `{iron:2.7}` | `{electricity:0.12}` | 0.902 |
| lumberMills | `{wood:2.7}` | `{electricity:0.12}` | 0.601 |
| textileMills | `{fabric:5.624, clothes:0.562}` | `{grain:1.464, coal:0.148, wood:0.146, machinery:0.263, electricity:0.2}` | 1.124 |
| furnitureWorks | `{furniture:1.949}` | `{wood:0.04, coal:0.037, fabric:0.461, steel:0.119, machinery:0.066, electricity:0.2}` | 0.874 |
| distilleries | `{liquor:2.404}` | `{grain:0.889, coal:0.074, wood:0.072, machinery:0.125, electricity:0.2}` | 0.749 |
| machineryWorks | `{machinery:2.426}` | `{steel:0.873, coal:0.133, wood:0.159, machinery:0.286, electricity:0.4}` | 1.237 |
| steelMills | `{steel:12.131}` | `{iron:5.078, coal:0.666, machinery:0.159, electricity:0.4}` | 1.237 |
| arsenals | `{arms:3.033}` | `{steel:0.571, machinery:0.286, coal:0.08, iron:0.286, electricity:0.4}` | 1.113 |
| luxuryWorks | `{luxury:1.35}` | `{fabric:2.195, coal:0.213, wood:0.205, machinery:0.351, electricity:0.2}` | 0.999 |
| infrastructure | `{}` | `{steel:0.414, wood:0.331, locomotives:0.6, electricity:0.4}` | 0.54 |
| navalYards | `{ships:0.987, machinery:0.033}` | `{steel:0.245, wood:0.163, machinery:0.054, electricity:0.28}` | 0.999 |
| navalBases | `{}` | `{ships:1.746, electricity:0.15}` | 0.6 |
| farms | `{grain:0.488, wood:0.098, opium:0.01}` | `{}` | 0.404 |
| chemicalWorks | `{chemicals:4.549}` | `{coal:0.333, iron:1.984, machinery:0.317, electricity:0.45}` | 1.237 |
| powerPlants | `{electricity:8.491}` | `{coal:0.952, machinery:0.317, steel:1.111}` | 1.237 |
| locomotiveWorks | `{locomotives:2.426}` | `{steel:1.587, machinery:0.317, coal:0.267, electricity:0.32}` | 1.237 |

**农场 II/III（新补，`tiers[0]`/`tiers[1]`）**

| 建筑 | 级 | output | input | labor |
| --- | --- | --- | --- | ---: |
| farms | II | `{grain:0.25, wood:0.05, opium:0.005}` | `{}` | 0.33 |
| farms | III | `{grain:0.313, wood:0.063, opium:0.006}` | `{}` | 0.356 |

### A.5 营造所（`workshops`）I–V 进阶（新补）

> 营造所产出**建造力**（非 goods），故无增值 oracle（同基础设施/海军营地）。I 级 = 现有
> `BUILDING_RECIPES.workshops`（`output:{}`，`input:{wood:1, grain:0.6, iron:0.3}`，labor 0.8），**不动**；
> 以下 II–V 为**派生值**。规则：高级营造所把原始 `iron` 换成加工 `steel`（II 起），III 加 `machinery`，
> IV/V 加 `electricity`；`wood`/`grain` 随级小幅下降；labor 累乘 ×1.10/×1.10/×1.08/×1.08（`round3`）。

| 级 | output | input | labor |
| --- | --- | --- | ---: |
| I（基准，不动） | `{}` | `{wood:1, grain:0.6, iron:0.3}` | 0.8 |
| II（`tiers[0]`） | `{}` | `{wood:1.0, grain:0.58, iron:0.15, steel:0.15}` | 0.88 |
| III（`tiers[1]`） | `{}` | `{wood:0.98, grain:0.55, iron:0.06, steel:0.2, machinery:0.06}` | 0.968 |
| IV（`tiers[2]`） | `{}` | `{wood:0.95, grain:0.52, steel:0.26, machinery:0.1, electricity:0.15}` | 1.045 |
| V（`tiers[3]`） | `{}` | `{wood:0.92, grain:0.5, steel:0.3, machinery:0.14, electricity:0.22}` | 1.129 |

> 建造力与每点金价另由 `CONSTRUCTION_CAPACITY_TIER_MULTIPLIER` / `CONSTRUCTION_COST_TIER_MULTIPLIER`
> 按座加权给出（附录 B），**不写进 recipe.tiers**。
> drift guard 须为 `workshops` 加一条 `output:{}` 分支并逐位断言 A.5 的输入/用工。

## 附录 B：逐级系数表（5 项）

| 常量 | 位置 | v14 值 | 建议值（**派生**） |
| --- | --- | --- | --- |
| `INFRA_SUPPLY_TIER_MULTIPLIER.infrastructure` | `engine/data/buildings.ts:666` | `[1, 1.3, 1.6]` | `[1, 1.3, 1.6, 2.08, 2.70]` |
| `SHIPS_PER_NAVAL_BASE_TIER_MULTIPLIER` | `engine/config/military.ts:34` | `[1, 1.25, 1.5]` | `[1, 1.25, 1.5, 1.95, 2.54]` |
| `CONSTRUCTION_CAPACITY_TIER_MULTIPLIER`（**新**） | `engine/config/construction.ts`（`:61` 旁） | — （新增） | `[1, 1.20, 1.45, 1.75, 2.10]` |
| `CONSTRUCTION_COST_TIER_MULTIPLIER`（**新**） | `engine/config/construction.ts` | — （新增） | `[1, 0.95, 0.90, 0.85, 0.80]` |
| `WORKLOAD_TIER_MULTIPLIER`（**新**） | `engine/config/construction.ts` | — （新增） | `[1, 1.3, 1.7, 2.2, 2.8]` |
| `ROMAN_TIERS` | `view/format.ts:110`、`engine/inspect/construction.ts:7` | `['I','II','III']` | `['I','II','III','IV','V']` |
| `TIER_COLORS` | `view/panels/economy.tsx:52` | `['cyan','yellow','green']` | `['cyan','yellow','green','magenta','blue']` |

> 唯一口径：`INFRA`/`NAVAL` 取自「在 III 之上每级 ≈×1.30」；`CONSTRUCTION_CAPACITY` 每级 ≈×1.20、
> `CONSTRUCTION_COST` 每级 ≈×0.95（越升越便宜）、`WORKLOAD` 每级 ≈×1.28–1.30（越升越贵）。**工程量公式**：
> 新建 `= CAPACITY_COST[id] × WORKLOAD_MULTIPLIER × WORKLOAD_TIER_MULTIPLIER[targetTier-1]`；
> 升级 `= UPGRADE_WORKLOAD_SHARE × 同级新建`（继承膨胀）。**每点金价公式**：
> `每点 = CONSTRUCTION_COST_PER_POINT × BUILDING_COST_MULTIPLIER[b] × constructionCostTierMultiplier(country) + 附加项/工程量`，
> 其中 `constructionCostTierMultiplier(country) = tierWeightedMultiplier(country, 'workshops', CONSTRUCTION_COST_TIER_MULTIPLIER)`
> （全 I 级 = ×1，逐位不变）。绝对系数只写在本表与 §A.5 的「按系数表」引用。

## 附录 C：新增科技节点与增补效果（**派生值**）

### C.1 新增节点（2 个，era 4，工业线）——**已定**

| id | era | 名称 | 前置 | 成本 | 效果 |
| --- | ---: | --- | --- | ---: | --- |
| `industry-6` | 4 | 电力工业 | `industry-4` | `techNodeCost(4)` | `unlockTier` ×18 类 → **4** |
| `industry-7` | 4 | 第二次工业革命 | `industry-6` | `techNodeCost(4)` | `unlockTier` ×18 类 → **5** |

`unlockTier` 覆盖的 18 类：`coalMines`、`ironMines`、`lumberMills`、`textileMills`、`furnitureWorks`、
`distilleries`、`machineryWorks`、`steelMills`、`arsenals`、`luxuryWorks`、`infrastructure`、
`navalYards`、`navalBases`、`farms`、`workshops`、`chemicalWorks`、`powerPlants`、`locomotiveWorks`。

> **已定**：解锁**集中在工业线这两个节点**（ADR 0032 §4）——不再保留「分散到各分支」的备选。
> `unlockTier` 是全局派生（`maxUnlockedTier`），任何国家研究到这两个节点即对全部 18 类解锁 IV/V。

### C.2 既有节点增补效果（补全农场/新建筑的 II/III 来源）

| 节点 | 追加效果 | 说明 |
| --- | --- | --- |
| `industry-1`（era 1） | `unlockTier workshops 2` | 营造所 II 级来源 |
| `industry-3`（era 3） | `unlockTier workshops 3` | 营造所 III 级来源（IV/V 由 `industry-6`/`industry-7` 给出） |
| `general-1865`（era 3） | `unlockTier farms 3` | 农场 III 级来源；农场 II 级由 `general-1836`（既有，S3 后生效） |
| `industry-5`（era 3） | `unlockTier chemicalWorks 2` | 与既有 `unlockBuilding chemicalWorks` 同节点 |
| `industry-4`（era 4） | `unlockTier chemicalWorks 3`、`unlockTier powerPlants 3`、`unlockTier locomotiveWorks 3` | 三座新厂的 II/III 来源 |

> 上述增补只**追加**效果，不改任何既有解锁的时间线（`maxUnlockedTier` 取最大，追加更高档不改变低档解锁时刻）。

## 附录 D：建造力—工程量 平衡表（**派生值**）

> 目的：验证两条曲线互相**咬合**——营造所阶梯让「每金产能」随级上升（容量 ×↑、每点金价 ×↓），
> 而工程量随等级膨胀（`WORKLOAD_TIER_MULTIPLIER`）。两者按座加权后，**配套升级的营造所**把膨胀
> 基本抹到接近 I 级难度（**可负担**），但不白送（难度比 **>1**）；而只有**旧（I 级）营造所**时，
> 建高级建筑非常困难（难度比可达 **2.80**）。

| 级 | `WORKLOAD_TIER_MULTIPLIER`（新建工程量，需求） | `CONSTRUCTION_CAPACITY_TIER_MULTIPLIER` | `CONSTRUCTION_COST_TIER_MULTIPLIER` | 净每金产能 = 容量 ÷ 成本 | 难度比 = 工程量 ÷ 净每金产能 |
| --- | ---: | ---: | ---: | ---: | ---: |
| I | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| II | 1.30 | 1.20 | 0.95 | 1.26 | 1.03 |
| III | 1.70 | 1.45 | 0.90 | 1.61 | 1.06 |
| IV | 2.20 | 1.75 | 0.85 | 2.06 | 1.07 |
| V | 2.80 | 2.10 | 0.80 | 2.63 | 1.07 |

> 读法：**「难度比」= 该级建筑在「配套同级营造所」下的建造难度（相对「I 级建筑 + I 级营造所」）**。
> 它从 1.00 缓升到 1.07——**配套升级的营造所把 2.80× 的工程量膨胀基本抹平到约 I 级水平**（可负担），
> 但**始终 >1**（不 trivial 送掉难度，也即「不改造成本曲线就还是略贵一点」）。
> **错配场景（用户意图）**：若只有 **I 级**营造所（净产能 ×1.00）去建 **V 级**建筑（工程量 ×2.80），
> 难度比 = **2.80×**——「用旧营造所建高级建筑会非常困难」。升级营造所（容量↑、每点↓）**正是**把这
> 条从 2.80 拉回 ≈1.07 的手段。
> 三张表均为**派生值**，可调；但须保持 `净每金产能 < WORKLOAD_TIER_MULTIPLIER`（难度比 >1）不破
> ——否则某级会变成「免费变强」。当前各列已满足：1.26<1.30、1.61<1.70、2.06<2.20、2.63<2.80。

## 附录 E：S8 校准方法（**派生值**；doc 为单一真源）

> 附录 A/B/D 给出的是**起始派生值**；**S8 用下面这套方法把它们调到目标带**，并把最终值**回填本附录与
> A/B/D**。`tests/tier-calibration.test.ts` 内嵌这些最终值，断言引擎常量与之相等——**附录即单一真源**。

### E.1 目标表（Targets）

| # | 量 | 目标（配套同级营造所） | 容差 |
| --- | --- | --- | --- |
| T1 | 难度比 `工程量 ÷ 净每金产能` | I 1.00 → II 1.03 → III 1.06 → IV 1.07 → V 1.07 | ±0.05 |
| T1b | 错配：**I 级**营造所建 **V 级** | 难度比 **2.80** | ±0.10 |
| T2 | 工期（相对「I 级建筑 + I 级营造所」） | @I级营造所：II 1.30 / III 1.70 / IV 2.20 / V 2.80；@N级营造所：II 1.08 / III 1.17 / IV 1.26 / V 1.33 | ±0.10 |
| T3 | 单次**总金价**（相对基线） | @N级营造所：II 1.24 / III 1.53 / IV 1.87 / V 2.24；@I级营造所建 V：2.80 | ±0.10 |
| T4 | 电力供需比 `demand ÷ supply`（参考库存） | 0.60–0.95（有缺口余量但吃紧） | ±0.05 |
| T5 | 逐类毛利 | 落在 `FAMILY_BANDS` | 0 越界 |
| T5b | 增值 I→V **单调不减** | 每级 ≥ 前一级 | 0 违反 |

> T1/T1b/T2/T3 直接对应附录 D 的平衡表与「错配场景」；T4 对应 S5 的闭合电力平衡；T5/T5b 对应经济校准。
> 目标值均为**派生值**，S8 若调整则同步改本表与附录 D。

### E.2 可复现 fixture（`tests/tier-calibration.test.ts`）

- **世界**：`const w = newWorld(SEED, 'QING')`（固定 seed）；把 `qing.tech.unlocked` 手工设为含
  `general-1880` / `industry-4` / `industry-6` / `industry-7`（使 `maxUnlockedTier(qing, ·) === 5`）。
- **营造所两组**（只差营造所，其余同状态）：
  (a) 全 I `buildingTiers.workshops = [20,0,0,0,0]`；(b) 全 V `[0,0,0,0,20]`（可另加混级）。
  两者都同步 `buildings.workshops = Σ`。
- **营造所阶梯**：五个世界，除营造所外逐位同状态，各 20 座（`[20,0,0,0,0]`…`[0,0,0,0,20]`）。
  营造所投入篮（I：木/粮/铁；IV/V：钢/机械/电）以进口「解放」，**隔离出附录 D 描述的毛产能/成本阶梯**
  （投入约束由 S7 单独测）。阶梯被测建筑 = `steelMills`，固定 **100 座**（使 `⌈·⌉` 舍入相对 ±0.10 容差可忽略）。
- **参考电气库存**（T4/T5）：seed QING + 手工在**既有座数之上**加 IV/V
  `coalMines +8IV/4V`、`ironMines +6IV/3V`、`steelMills +10IV/6V`、`machineryWorks +8IV/6V`（电厂上游闭环，S5 同形），
  `powerPlants = [0,0,0,2,1]`。三座命名建筑（`steelMills`/`powerPlants`/`machineryWorks`）齐备；**营造所混级取全 I `[20,0,0,0,0]`**（法比对耦合稳定；全 V 混级另测，见 T4）。
- **测量**（每项都从引擎函数取，独立于被测常量）：
  - 工作量：`projectWorkload(draft(id, 100, tier))`，tier = I..V；
  - 产能：`constructionCapacity(qing)`（五组）→ 点/月；
  - 工期 = `ceil(工作量 ÷ 点/月)`（各组除营造所外同 `tech`/`infra`/`access`）；
  - 金价：`constructionGoldPerPoint(draft(id, 100, tier), qing)`；总金 = 工作量 × 金/点；
  - 电力：`inspectEconomy(qing)` 的 `demand.electricity` / `production.electricity`（电力**不可贸易**，无进口项）；
  - 毛利：settle 后 `qing.econ.buildingProfits[id]`（与 S5 同口径），对 `FAMILY_BANDS`。
- **horizon**：构造阶梯为静态（不 advance）；T4/T5 在参考库存上 `advance` **60/120 月**后取快照——
  `FAMILY_BANDS` 与电力带是**结算态**口径，1836 开局（无 IV/V 座）测不出，故按固定 60/120 月取样（确定性，同 seed 同结果）。

### E.3 调参流程（症状 → 旋钮；每次只动一个，改完重跑 fixture）

| 症状 | 优先旋钮（按此顺序） |
| --- | --- |
| 难度比曲线太平 / 太陡（T1 / T1b） | ① `WORKLOAD_TIER_MULTIPLIER` |
| 工期过长 / 过短（T2） | ② `CONSTRUCTION_CAPACITY_TIER_MULTIPLIER` |
| 单次金价过高 / 过低（T3） | ③ `CONSTRUCTION_COST_TIER_MULTIPLIER` |
| 电力缺口 / 过剩（T4） | ④ 各族电力数量（附录 A.2） |
| 毛利越带 / 增值非单调（T5 / T5b） | ⑤ IV/V 配方乘数（附录 A.1） |

> 顺序依据：先定**需求侧**（工作量曲线），再定产能/成本（营造所阶梯），再电力，最后微调配方乘数——
> 因为最后一项会牵动 `economy-recipe-calibration` 的既有带。

**闸门（guardrails，任何时候不得破）**：

- **(a)** `净每金产能 < WORKLOAD_TIER_MULTIPLIER` 在**每一级**成立——营造所阶梯**永不得**把工程变成免费/净收益；
- **(b)** **≤III 逐位不变**（`tier-recipe-data` 的 I–III oracle + `tier-settlement` 的全 I 位等价）；
- **(c)** **60/120 月确定性** + **两条金币恒等式**全绿；
- **(d)** **改一个数前先跑 fixture**，改完再跑；最终值**回填附录**（A/B/D），fixture 断言引擎 == 附录。

### E.4 S8 校准结果（2026-10-26 执行，`tests/tier-calibration.test.ts`）

> 结论：**S0/S7 的起始派生值已全部落在附录 E.1 目标带内，S8 未改动任何引擎常量**（A/B/D 逐位保持）。
> 下表为 fixture 实测值 vs 目标；`净每金产能 < WORKLOAD` 闸门 (a) 在 II–V 每级成立（难度比 >1）。

| # | 实测（I→V） | 目标 | 容差 | 判定 |
| --- | --- | --- | --- | --- |
| T1 难度比 | 1.000 / 1.029 / 1.055 / 1.069 / 1.067 | 1.00 / 1.03 / 1.06 / 1.07 / 1.07 | ±0.05 | ✅ |
| T1b 错配（I 营造所建 V） | 2.800 | 2.80 | ±0.10 | ✅ |
| T2 工期 @I 营造所 | 1.000 / 1.289 / 1.687 / 2.181 / 2.783 | 1.00 / 1.30 / 1.70 / 2.20 / 2.80 | ±0.10 | ✅ |
| T2 工期 @配套营造所 | 1.000 / 1.084 / 1.169 / 1.253 / 1.325 | 1.00 / 1.08 / 1.17 / 1.26 / 1.33 | ±0.10 | ✅ |
| T3 总金 @配套营造所 | 1.000 / 1.235 / 1.530 / 1.870 / 2.240 | 1.00 / 1.24 / 1.53 / 1.87 / 2.24 | ±0.10 | ✅ |
| T3 总金 @I 营造所建 V | 2.800 | 2.80 | ±0.10 | ✅ |
| T4 电力供需比（全 I 混级，m60/m120） | 0.673 / 0.697 | 0.60–0.95 | ±0.05 | ✅ |
| T4 电力供需比（全 V 混级，m60） | 0.922（> 全 I，电气化营造所收紧余量） | 0.60–0.95 | ±0.05 | ✅ |
| T5 逐类毛利（m60/m120） | 六族全落 `FAMILY_BANDS` | 0 越界 | — | ✅ |
| T5b 增值 I→V 单调不减 | 15 类产出型分级建筑全单调 | 每级 ≥ 前级 | — | ✅ |

> fixture 内嵌 **附录 B 的 5 张表**（`WORKLOAD` / `CONSTRUCTION_CAPACITY` / `CONSTRUCTION_COST` /
> `INFRA_SUPPLY.infrastructure` / `SHIPS_PER_NAVAL_BASE`）并逐位断言引擎常量相等——**文档即单一真源**。
> 另测：全 I–III 座时电力需求 = 0（≤III 逐位不变，由 `tier-recipe-data` / `tier-settlement` 守护），
> 两个同构参考世界 60 月后经济逐字节相同（闸门 (c)）。

## 2. 迁移与兼容

- **不升世界版本**（ADR 0032 §8）：本轮全部是数据（`tiers` 数组、系数表、节点表）+ 一处结算口径
  （退役电力乘数、不可贸易按利用率计费），**无结构字段变更**。
- v14 存档**结构上不被破坏**：其 `buildingTiers` 最长 3 项，载入后全部建筑停在 ≤ III 级——合法状态；
  `recipeAt` 对越界 tier 回落 I 级；七张系数表的越界兜底分支保留。**不做兼容层**（ADR 0005 不适用——版本未变）。
- **同版本前向风险（必须记录）**：
  - **新档被旧 v14 代码读**：新档的 `buildingTiers` 可能长 5 项、含 IV/V 座位；
    旧代码的 `recipeAt(id, 4)` 取 `tiers[3]`（旧表只有 2–3 项）→ `undefined` → **回落 I 级**，
    即 **V 级座位会被静默当成 I 级**（产出/投入都按 I 级），不报错但失真。属「同版本不可前向兼容」，
    与 ADR 0005「不做兼容」一致，需在文档与发布说明中点明。
  - **旧档获得一个「活的」农场升级**：旧 v14 档的 `farms` 无 `tiers`，升级被静默忽略；
    升到本版后 `farms` 有了 II–V，且 `general-1836` 的 `unlockTier farms 2` 一直存在 →
    旧档**凭空多了农场 II 级升级能力**。这是预期内的「死字段复活」，须在文档记录。
- **存档往返测试**：S1/S3 各加一条——写入长度 5 的 `buildingTiers` 数组、存档、读回，
  断言数组与 `Σ tiers === buildings` 一致；并对 `farms` 断言 II 级在旧档语境下可用。
  （实现放在 `tests/tier-settlement.test.ts` 与 `tests/save-roundtrip` 相关用例内。）

## 3. 风险与对策

| 风险 | 对策 |
| --- | --- |
| **电力供给瓶颈**：IV/V 铺开后 `powerPlants` 跟不上，电力缺口传导成普遍产出短缺 | 电力数量按 A.2 保守起步；S5 用可复现 fixture 校准电力数量与电厂产出（×1.30/×1.28） |
| **自举/可满足性**：电气化上游（钢/机械）自己也吃电，形成联立 | S5 从零 fixture 证明闭合平衡 + 可行启动顺序（先建不耗电的 I–III 钢/机械 → 建电厂 → 电气化） |
| **电力不可贸易**：缺电无法靠进口修补 | 有意保留（V3 先例：电力本地）；电厂是唯一供给来源；S5 加「无电力供给时下 IV/V 令给警告」 |
| **退役全局乘数造成行为变化** | S1 专门测试：1880 前逐位不变，有电厂国家按投入链重算 oracle；明确它 Supersedes 0015 §S4 |
| **闲置座位满负荷吃电** | S1：`NON_TRADABLE` 投入按 `effectiveCount × storedUtilization` 计费；可贸易不变 |
| **非玩家帝国不电气化** | S6 新增 AI / 私人投资升级路径（否则特性对非玩家形同虚设） |
| **S6 移动 II/III 基线**：私人投资升级跑在基线 `advance` 内，会改变 `tests/economy-recipe-calibration.test.ts` 的 II/III 毛利 | S6 内重跑该测试；必要时**在 S6（非 S5）重定 `FAMILY_BANDS`** 并注明理由，作为 S6 验收的显式断言 |
| **营造所正反馈循环（有意保留）**：升级营造所 → 建造力↑ → 更快升级，可能失控 | **有意保留为增长引擎**（Supersedes plan 0015 §S2 守卫）；三重闸门约束：IV/V 需 `steel`/`machinery`/不可贸易的 `electricity`（缺料即减产）、**每点成本曲线 + 工程量膨胀（`WORKLOAD_TIER_MULTIPLIER`，高级建筑工作量本就 ×2.2–2.8）+ 每槽 5 座**、升级工程量不产建造力（守卫保留）。S7 用 fixture 断言增幅受限 |
| **工程量膨胀 vs 经济/粮食校准基线**：`WORKLOAD_TIER_MULTIPLIER` 或扰动 `economy-recipe-calibration` 的 gate | **既有 gate 不受影响**：标准 60/84/120 月基线自 1836 起算，**到不了 era 4/1880**，故 IV/V 的工程量（×2.2/×2.8）根本不触发；II/III 的 ×1.3/×1.7 也只在有人建/升 II/III 时触发，而基线在 **S6 之前无人建 >I 级**（AI/私人投资只建 I 级）。S6 加升级路径后，II/III 的基线移动由既有「S6 移动 II/III 基线」行负责重定带 |
| **分级乘数通胀** | IV/V 以 `coal` 置换对冲；S5 跑经济回归，必要时下调（派生值，可调） |
| **≤III 行为漂移** | drift guard 断言存储值 === 规则展开；「全 I–III 逐位等价 v14」冻结 oracle |
| **测试守护过期** | `length===2` / 6 元组 / 20 节点写死 → S0/S2/S3 同步扩守护；每切片先改守护再改数据 |
| **`unlockTier farms 2` 是死字段** | S3 给 `farms` 补 `tiers` 使解锁生效；并加正反测试 |
| **两处 `ROMAN_TIERS` 不同步** | `view/format.ts:110` 与 `engine/inspect/construction.ts:7` 必须同改（§0.5 已列） |
| **`tech-ai-selection` pacing 上界** | 新增 2 个 era-4 节点后复核 `gained ∈ [2,5]`；必要时按新节点数更新 |

## 4. 文档同步

- `GLOSSARY.md`：
  - **建筑等级**：I / II / III → **I–V**；补一句「IV/V 级换入电力并置换燃料」；
  - **时代**：保持 1836–1880 四层，补「IV/V 级由 era 4 电气化节点解锁」；
  - **科技分支**（**已过时**条目）：改为「通用 + 工业 / 行政 / 军事」四线，并明确工业线 5→7 节点（本计划后）；
  - 新增 **电力（electricity）** 词条：不可贸易的中间品，IV/V 级生产建筑的投入（置换煤），
    由 `powerPlants` 供给；**不再有全局产出加成**；
  - 更新 **营造所** 词条：I–V 分级，高等级用先进材料（钢/机械/电力）产出**更多、更便宜的建造力**；
    **可升级**（正反馈循环有意保留）。同时删除/改写 GLOSSARY 里「营造所不可升级」的旧表述。
- `docs/architecture.md`：§1 规模行（建筑等级 I–V、电力投入链、退役电力乘数、18 类分级）、§世界版本行（注「不升版本的原因」）、
  建筑配方小节（§4.3）补 IV/V 规则与电力、建造力小节补营造所分级（容量/成本乘数）。
- `docs/gm-handbook.md`：§4.3 配方表加 IV/V 与电力；§3 工具示例补 `v3_action build tier=4` / `upgrade toTier=5`。
- `README.md`：世界模型摘要行（建筑「1–3 级」→「1–5 级」、补电力）。
- `docs/plans/0015-tech-and-building-tiers.md`：加一条「§S4 全局电力乘数已由 plan 0016 退役；
  分级延到 I–V」的指引（不改 0015 的冻结值）。
- `docs/playtest-issues.md`：如试玩发现电力卡点，新增条目并关联 `docs/plans/0007-economy-polish.md`。
