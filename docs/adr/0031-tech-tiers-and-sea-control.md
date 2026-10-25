# 科技接入建筑分级、新建筑与制海权（tech tiers, new works, sea control）

- Status: accepted（**World v14**：科技树 16 → 20 节点并全部重写；建筑分级；三座新建筑；制海权接上战争结算）
- Fixes:
  - 科技与建筑之间**没有任何连接**——`unlock`/`unlocks`/`year` 三个字段全是死字段，20 类建筑开局即可造；
  - 科技效果**同质化**——16 个节点清一色「某类产出 +X%」，玩家看不出「为什么选这条」；
  - 海军**完全没有参战**——`military.navy` 不进战争结算，`navyStrength` 无消费者，
    英国 120 艘战舰在玩法上等于 0。
- Depends on: `docs/plans/0005-tech-tree.md`、ADR 0021（建筑配方单一真源）、ADR 0022（利用率与利润）、
  ADR 0026（建筑扩张）、ADR 0030（科技树）
- Supersedes:
  - **ADR 0027 的「面板下单」部分**——建造/升级下单按钮全部移除，操作走对话（队列管理按钮保留）；
  - **ADR 0030 的 16 节点表**——节点扩到 20 并全部重写效果（树形、`techTier` 派生、溢出与扩散机制不变）。
- Superseded by: —

## 背景

1839 年这一局暴露了三件事，都指向同一个断点：**科技只是一个数值乘数，没有接到任何玩法上。**

1. **建筑全开局可造**。`BuildingUnlock = { techLevel?: number }` 早就存在，`build` 动作也会校验，
   但没有任何建筑设置阈值，科技节点也不挂接建筑。
2. **效果清一色乘数**。16 个节点的 `effects` 只有 `flat`/`percent` 两种栈，没有 `multiply`，
   没有一个节点写 `label`。`unlocks: ['electrification']` 是死标记，`year` 无人读取。
3. **海军空转**。战争结算 `strength()`（`engine/diplomacy.ts`）只读陆军数量、陆军质量、士气、科技；
   `military.navy` 只出现在威望、开支、排名与界面数字里。`military-3` 的 `navyStrength +5%` 没有任何消费者。
   鸦片战争在历史上是舰队封锁，而引擎里它是一场纯陆战。

同时，界面把**操作**堆在面板上：建造页有 20 类 × 三种下单按钮。玩家在试玩中明确要求
**「点击建造的 UI 干掉，直接对话」**——操作归对话，面板归展示。

## 决定

### 1. World v14，旧档不再兼容

本轮改动触碰三处**结构**：建筑的等级与升级项目、三个新商品、`military.navalQuality`。
任何一处单独都足以升版本。按 ADR 0005（不做存档兼容），升 **v14**，v13 存档拒绝载入。
当前 1839 年的活档随之作废。

### 2. 科技树：20 节点，效果全部重写

- **4 分支 × 5 节点 = 20**：通用 / 工业 / 行政 / 军事，每分支每时代至少一个。
- 树形与机制**不变**：`era` 门槛、分支内线性前置、`requiresAnyBranch`、跨分支溢出（15–25%）、
  国际扩散（0–50%）、`techTier = 1 + era×1.5 + unlocked×0.05`、研究率公式（ADR 0018）。
- **已有 16 个节点的效果全部重写**；节点 id 可保留或重命名，但语义按新效果类型重新定义。
- **第五时代本轮不做**（上限仍是 IV / 1880），留作后续需求。

### 3. 效果类型学：节点能给出六类东西

`TechNodeEffect` 在既有 `modifier` / `immediate` 之外新增四类：

| 新效果 | 形状 | 语义 |
| --- | --- | --- |
| `unlockTier` | `{ kind, building, tier }` | 把某类建筑的**等级上限**提到 `tier`（2 或 3） |
| `unlockBuilding` | `{ kind, building }` | 解锁一座**新建筑**（此前不可建） |
| `unlockLaw` | `{ kind, law }` | 解锁一项法案（`v3_action law` 的前置） |
| `demandShift` | `{ kind, good, percent }` | 节点级需求修正（最小版，接 PT-068） |

保留 `modifier`（乘数）与 `immediate`（一次性存量）——但它们不再是默认手段：
**每个节点至少要给一项「解锁类」效果**，纯乘数节点只允许出现在早期垫底节点。

`unlocks` 与 `year` 两个死字段在 v14 移除。

**不做的**：`policyGate`。评审指出 `v3_policy` 是自由格式、没有政策模板库，
「只做门控不建模板库」无法实现（没有可门控的注册表）。政策模板与门控一并留给后续政策库切片。

### 4. 建筑分级

- **同一 id 内部分级**：最多 3 级，每级一套 `output` / `input` / `labor`。
  不新增建筑 id，不新增名册条目。
- **单一真源（评审 F3）**：`BUILDING_RECIPES[id]` **就是 I 级**，保持不动；
  新增的 `tiers` **只存 II / III 两级**（数组长度 0–2）。全 I 级时行为与 v13 逐位等价。
  访问统一走 `recipeAt(id, tier)`，禁止任何地方另写一份 I 级配方。
- **座数真源（评审 F2）**：`econ.buildings[id]` 仍是**唯一座数来源**；
  `econ.buildingTiers[id]` 只记**各级座数分布**，并恒满足 `Σ tiers === buildings[id]`。
  建成、升级、折旧、天命四条写路径必须走同一个 mutator，每次变更后恒等式必须成立。
- **覆盖范围**（全部要做）：
  - 重工业：`steelMills`、`machineryWorks`、`arsenals`
  - 采掘与基建：`coalMines`、`ironMines`、`lumberMills`、`infrastructure`
  - 船坞与海军：`navalYards`、`navalBases`
  - 轻工业：`textileMills`、`furnitureWorks`、`distilleries`、`luxuryWorks`
  - 可选（按需）：`farms`
  - **不分级**：`schools`、`universities`、`offices`、`barracks`、`forts`、`workshops`
- **无配方建筑的收益通道（评审 M9）**：`infrastructure` 与 `navalBases` 的 `output` 为空，
  真实收益来自 `INFRA_SUPPLY`（每座供给 2.16）与海军编练（每座每月吃 1 艘）。
  这两类必须同时引入**按级系数**（III 级基础设施供给与编练率按级提高），
  否则升级只增加投入与用工、产出不变，是纯亏选项。
- **混级共存**：`Country.econ.buildingTiers: Record<BuildingId, number[]>`，记录该类建筑各级各有多少座；
  产出、投入、工资、劳动需求**按座数加权**。选址、利润快照同样按级计算。
- **等级上限**由科技节点 `unlockTier` 提升；未解锁的等级不可升级。

### 5. 新建可选等级，升级是「改造存量」

- **新建可选等级**：科技解锁 II/III 级后，`build` 可带 `tier` 参数（缺省 I）；
  新建 II 级要付 **II 级的全量工程量与材料**。
- **升级是一种建造项目**：队列新增 `kind: 'upgrade'`，字段 `building`、`fromTier`、`toTier`、`count`。
  **按座升级、可大批量**：`count` 不受「每槽 5 座」限制，上限为该类建筑中处于 `fromTier` 的实际座数。
- **升级省的是工程量，不是单价**：单价与新建一致（每点 0.2 金），
  **升级工程量 ≤ 同级新建的 60%**（改造比新建快，但快得有限）。
  新建与升级的差别因此落在**时间**上，而不是「打折」上。
- **代价**：建造力 + 按工程量计的金（月开销），**不另收材料**；
  **计入 GDP 的投资项**（I），与新建同口径（按工程量计算，避免成为税账之外的支出）。
- **科技红利原则**：科技解锁的是**选项**，不是**税**。研究点、大学与时间已经付过成本，
  升级不该再被收一次「科技税」——所以工程量只用来表达「快多少」，不用来表达「贵多少」。
- **正反馈约束（评审 F4）**：升级不消耗材料，但**营造所本身不可升级**，
  且升级项目的工程量不计入建造力产出；避免「升级伐木/铁矿 → 建造力↑ → 更快升级」的自我加速循环。

### 6. 三座新建筑、三个新商品

| 建筑 | 解锁时代 | 产出 | 投入 | 商品定位 |
| --- | --- | --- | --- | --- |
| `chemicalWorks` 化工厂 | III（1865） | `chemicals` 化工品 | 煤、铁矿石、机械 | **1865 才进消费篮子** |
| `powerPlants` 发电厂 | IV（1880） | `electricity` 电力 | 煤、机械、钢铁 | 中间品，**不可贸易** |
| `locomotiveWorks` 机车厂 | IV（1880） | `locomotives` 机车 | 钢铁、机械、煤 | 中间品，供 III 级基础设施 |

- `chemicals` 在 **1836–1865 需求为 0**（不进篮子），化工厂解锁的那个 III 时代节点用一条
  `demandShift` 把它真正接入 Stone-Geary。这样 1836 基线数值不变，`demandShift` 也有了真实用途
  （评审 M4：若一上来就进篮子，「1836 无跳变」在数学上不可能成立）。
- `electricity` 作为若干建筑的中间投入，并给**自产电力**的国家一个全局产出乘数
  （按 `powerPlants` 座数或电力产量派生；**进口电力不计入**）。
  **加入 `NON_TRADABLE`**——19 世纪的电力不能跨境定价（评审 M14）。
- `locomotives` 作为 `infrastructure` **III 级的持续投入**（不是一次性改造材料），
  并同步提高 III 级基础设施的供给系数。

### 7. 海军：舰船质量与制海权

**本轮只做「最简可玩版」**：数值调到能真正结束战争，其余（海战损耗、海域分区、封锁外交代价）
留给后续的战争线专项设计。

- **新增 `military.navalQuality`**（0–1，存量），由海军科技节点的 `immediate` 提升，开局按国家种子设定。
- **海军战力**：`seaPower = navy × navalQuality × (1 + navyStrength/100)`。
  **只保留 `navyStrength` 一条科技乘数通道**，不再乘 `techTier`——避免同一意图被乘两次（评审 M11）。
- **制海权**：交战双方 `seaPower` 比值，分**五档**——
  完全控制（≥2.0）/ 优势（≥1.25）/ 均势（0.8–1.25）/ 劣势 / 丧失。
- **战争分数**：每月累加。**优势 +0.75/月，完全控制 +1.5/月**；均势 0；劣势/丧失为对方所得。
  完全控制 50 个月可独力打到 75 分，**封锁因此能真正结束战争**（评审 F5：原 +0.8×60=48<75）。
- **封锁**：制海权一方可切断**敌国与第三方的海上贸易**（不是敌我之间——敌我贸易在 `atWar` 时
  本就已断，那样是 no-op）；亦可**指定国家**（含中立国），但要付出关系与恶名的代价。
- **时序**：`seaPower` 与制海权在贸易清算**之前**计算一次，当月生效。
- 制海权是**独立维度**：不折算成陆军战力，陆战仍由陆军决定。

### 8. 界面：面板只读，操作归对话

- **面板定位改为只读仪表盘**：所有**操作**（建造、升级、税率、研究、法案、征兵、路线）只走对话 / GM 工具。
- **建造页移除全部下单按钮**（`建×1` / `5×1` / `⇤`）；**保留队列管理**（取消 / ↑ / ↓ / 置顶）。
- **建筑页只显示等级比例条**（如「钢铁厂：II 级 37%」），不列具体座数与配方细节；
  具体数值查询走 `v3_inspect buildings`。
- `v3_action build` / 新增 `v3_action upgrade` 是唯一下单入口。

### 9. 评审发现、必须一并处理的实现缺口

以下四条来自设计评审，不是新决策，而是**本 ADR 落地时必须补的洞**：

1. **种子已解锁的科技节点从不安装效果**（`techStateFromLevel` 只 push 进 `unlocked`）。
   GBR/FRA 等开局带 era 2–3 的国家，其节点的 `unlockTier` / `unlockBuilding` 从未生效。
   → 世界创建时对 `unlocked` 逐个安装，或把解锁效果改成**从 `unlocked` 派生**而非安装态。
2. **私人投资与 AI 绕过建筑解锁**（`investment.ts` 直接遍历 `BUILDINGS`；`ai.ts` 建筑列表硬编码）。
   → 抽一个 `isBuildingUnlocked(country, building)`，在 `actionBuild`、私人投资、AI prompt、
   AI 校验、`randomDecision` 全部调用。
3. **新建筑不在工具 schema 里**（`v3_action` / `v3_cheat` 的 `building` 枚举硬编码 20 项）。
   → 枚举改为从 `BUILDING_IDS` 生成；`v3_action` 增加 `upgrade` 与 `tier` 参数。
4. **20 节点与 era 上限 4 的边界**：通用线第 5 个节点必须写明 era（建议 1/1/2/3/4），
   并在完成路径加 `clampEra`。

## 后果

- **正面**：科技第一次真正改变可建造物与军队形态；海权成为可玩的维度；界面从「操作台」变成「仪表」。
- **负面**：
  - 旧档作废，1839 年这一局结束；
  - 建筑分级使产出、需求、利润、劳动需求四处都要按座加权，**配方与就业的测试面显著变大**；
  - 面板去掉操作后，**所有操作延迟一轮对话**，重开一局时下单节奏会变慢（玩家明确接受）。
- **风险**：
  - `chemicals` 进篮子会改动 Stone-Geary 的校准（切片 S4 必须跑经济回归）；
  - 制海权五档的阈值若过宽，鸦片战争会变成「英国单方面碾压」；需在 S6 用 1839 基线校准。

## 关联

- `docs/plans/0015-tech-and-building-tiers.md`（切片与验收）
- `docs/plans/0005-tech-tree.md`（K0–K4，被本 ADR 修订）
- `docs/adr/0021-building-recipes.md`、`0022-utilization-and-profit-investment.md`、`0027-construction-queue-orchestration.md`、`0030-tech-tree.md`
- `docs/playtest-issues.md` PT-068（需求变迁，本 ADR 只做节点级最小版）、PT-074（跨国查询）
