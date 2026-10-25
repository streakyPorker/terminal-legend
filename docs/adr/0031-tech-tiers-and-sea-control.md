# 科技接入建筑分级、新建筑与制海权（tech tiers, new works, sea control）

- Status: accepted（**World v14**：科技树 16 → 20 节点并全部重写；建筑分级；三座新建筑；制海权接上战争结算）
- Fixes:
  - 科技与建筑之间**没有任何连接**——`unlock`/`unlocks`/`year` 三个字段全是死字段，19 类建筑开局即可造；
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

同时，界面把**操作**堆在面板上：建造页有 19 类 × 三种下单按钮。玩家在试玩中明确要求
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

`TechNodeEffect` 在既有 `modifier` / `immediate` 之外新增：

| 新效果 | 形状 | 语义 |
| --- | --- | --- |
| `unlockTier` | `{ kind, building, tier }` | 把某类建筑的**等级上限**提到 `tier` |
| `unlockBuilding` | `{ kind, building }` | 解锁一座**新建筑**（此前不可建） |
| `unlockLaw` | `{ kind, law }` | 解锁一项法案（`v3_action law` 的前置） |
| `policyGate` | `{ kind, policy }` | 解锁一个**政策模板**（`v3_policy` 的前置；本轮只做门控，不建模板库） |
| `demandShift` | `{ kind, good, percent }` | 节点级需求修正（最小版，接 PT-068） |

保留 `modifier`（乘数）与 `immediate`（一次性存量）——但它们不再是默认手段：
**每个节点至少要给一项「解锁类」效果**，纯乘数节点只允许出现在早期垫底节点。

`unlocks` 与 `year` 两个死字段在 v14 移除。

### 4. 建筑分级

- **同一 id 内部分级**：`BuildingTierDef[]`（最多 3 级），每级一套 `output` / `input` / `labor`。
  不新增建筑 id，不新增名册条目。
- **覆盖范围**（全部要做）：
  - 重工业：`steelMills`、`machineryWorks`、`arsenals`
  - 采掘与基建：`coalMines`、`ironMines`、`lumberMills`、`infrastructure`
  - 船坞与海军：`navalYards`、`navalBases`
  - 轻工业：`textileMills`、`furnitureWorks`、`distilleries`、`luxuryWorks`
  - 可选（按需）：`farms`
  - **不分级**：`schools`、`universities`、`offices`、`barracks`、`forts`、`workshops`
- **混级共存**：`Country.econ.buildingTiers: Record<BuildingId, number[]>`，记录该类建筑各级各有多少座；
  产出、投入、工资、劳动需求**按座数加权**。选址、利润快照同样按级计算。
- **等级上限**由科技节点 `unlockTier` 提升；未解锁的等级不可升级。

### 5. 升级是一种建造项目

- 队列新增项目类型 `kind: 'upgrade'`（与 `build` 并列），字段：`building`、`fromTier`、`toTier`、`count`。
- **按座升级、可大批量**：`count` 不受「每槽 5 座」限制，一次可下任意座数；
  受限于该国该类建筑中处于 `fromTier` 的实际座数。
- **代价 = 建造力 + 月开销**（每点 0.2 金，沿用既有 `CONSTRUCTION_COST_PER_POINT`）。
  **不消耗材料**。
- 工程量按**升级单价**计算，显著低于同座数新建（建议 30–50%，实现时校准）。
- 与普通项目共用建造力分配；同月既有新建又有升级时，按队列顺序分配。

### 6. 三座新建筑、三个新商品

| 建筑 | 解锁时代 | 产出 | 投入 | 商品定位 |
| --- | --- | --- | --- | --- |
| `chemicalWorks` 化工厂 | III（1865） | `chemicals` 化工品 | 煤、铁矿石、机械 | **进消费篮子** |
| `powerPlants` 发电厂 | IV（1880） | `electricity` 电力 | 煤、机械、钢铁 | 中间品，不进篮子 |
| `locomotiveWorks` 机车厂 | IV（1880） | `locomotives` 机车 | 钢铁、机械、煤 | 中间品，进基础设施供给 |

- `chemicals` 进入 Stone-Geary 消费篮子（生存线与收入弹性需重新校准，切片 S4 验收）。
- `electricity` 作为若干建筑的中间投入，并给所在国一个**全局产出加成**（实现时定系数）。
- `locomotives` 作为 `infrastructure` 的**升级级投入**——III 级基础设施需要机车。

### 7. 海军：舰船质量与制海权

- **新增 `military.navalQuality`**（0–1，存量），由海军科技节点与事件提升；开局按国家种子设定。
- **海军战力** `seaPower = navy × navalQuality × (1 + techTier × 系数)`。
  `navyStrength` 修正终于有消费者：乘在 `seaPower` 上。
- **制海权（sea control）**：交战双方 `seaPower` 比值，分**五档**——
  完全控制 / 优势 / 均势 / 劣势 / 丧失。
- **战争分数**：每月累加。优势 **+0.4/月**，完全控制 **+0.8/月**；均势 0；劣势/丧失为对方所得。
  总结束条件不变（75 分或 60 个月）。
- **封锁**：制海权一方可切断**交战国**的海上贸易（默认）；亦可**指定国家**封锁（含中立国）。
  被切断的航线当月运量为 0 并衰退（沿用现有航线切断语义）。
- 制海权是**独立维度**：不折算成陆军战力，陆战仍由陆军决定。

### 8. 界面：面板只读，操作归对话

- **面板定位改为只读仪表盘**：所有**操作**（建造、升级、税率、研究、法案、征兵、路线）只走对话 / GM 工具。
- **建造页移除全部下单按钮**（`建×1` / `5×1` / `⇤`）；**保留队列管理**（取消 / ↑ / ↓ / 置顶）。
- **建筑页只显示等级比例条**（如「钢铁厂：II 级 37%」），不列具体座数与配方细节；
  具体数值查询走 `v3_inspect buildings`。
- `v3_action build` / 新增 `v3_action upgrade` 是唯一下单入口。

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
