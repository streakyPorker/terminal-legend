# 建筑扩张与统一基础设施（Building Expansion + Infrastructure）

- Status: proposed（待用户批准实现；本文件只描述，不改引擎/测试）
- Depends on: ADR 0026（本计划对应的决策）、ADR 0021（建筑配方单一真源）、ADR 0022（利用率与利润投资）、ADR 0010/0012/0013（营造所与建造能力）、ADR 0005（不做存档兼容）
- Scope: 把建筑名册从 9 类扩到 **22 类**（拆矿场、拆工厂、加 5 类）；引入 `steel` 商品与「铁矿石」语义；把「交通基础设施」升级为**统一基础设施**（供给/需求/线性 debuff/维护）；给建筑加前瞻 `unlock` 字段。世界版本升到 **v11**。
- 来源：用户口述。核心诉求：「建筑盈利能力要读得清 → 单产/少产建筑」；「基础设施是一个统一的东西，铁路/港口/运河/电报都产它，所有建筑都要用它」；「商品按需加，先维护一个最小可用集」。

## 0. 现状诊断（已核实）

| 现象 | 事实 | 位置 |
| --- | --- | --- |
| 名册只有 9 类 | `farms/mines/factories/railroads/ports/universities/barracks/offices/workshops` | `types/index.d.ts` 的 `BuildingId`；`engine/data.ts` 的 `BUILDINGS`/`BUILDING_IDS` |
| 矿场一包三货 | `mines` 产出 `coal 0.5 / iron 0.42 / wood 0.04` | `BUILDING_RECIPES.mines`（`engine/data.ts`） |
| 工厂一包七货 | `factories` 产出 `fabric/clothes/liquor/furniture/machinery/arms/luxury` | `BUILDING_RECIPES.factories` |
| 利润按整包算 | `buildingProfits` 用整行 output/input 算毛利 | `computeEconomy`（`engine/economy.ts`） |
| 货名与资源不符 | `GOODS.iron.name = '钢铁'`，但产出它的资源叫「铁矿」 | `engine/data.ts` 的 `GOODS` / `RESOURCE_MAP` |
| 基础设施只有两来源 | 铁路 +3 交通、港口只加市场接入；门控 `0.6 + 交通/160` | `completeBuilding`（`engine/construction.ts`）；`PRODUCTION_GATE_CURVES.infrastructure`（`engine/config/blocks/gates.ts`） |
| 无建筑解锁 | `build` 动作只校验建筑 id 与数量 | `applyDecision` 的 `case 'build'`（`engine/actions.ts`） |

## 1. 目标与非目标

**目标**

- 每类产货建筑**单产**（少数链条允许两产），逐建筑利润率**可读、可调**。
- `steel` 商品落地；`iron` 语义转为「铁矿石」；铁矿 → 钢铁 → 机械/军械/铁路 的链条打通。
- **统一基础设施**：一个国家级量，铁路/港口/运河/电报供给，全建筑需求，短缺给**线性 debuff**，
  自身消耗原料 + 服务。
- 每个新建筑有**目标利润带**并进入校准 gate（分批调）。
- 建筑加前瞻 `unlock`，`build` 动作加校验（当前全解锁，行为不变）。
- 世界版本 **v11**。

**非目标**

- 不做科技树（`unlock` 只占位，真科技树是 plan 0005）。
- 不做更多新商品（本次只加 `steel`）。
- 不做「一建筑一实例」细粒度：仍是按类型计数（`Record<BuildingId, number>`）。
- 不做基础设施分池（明确是**一个国家级统一池**）。
- 不改贸易/税制/建造的既有口径（只改建筑/商品/基础设施三块数据与读取点）。

## 2. 要动的数据面（data surfaces）

| 表 / 类型 | 位置 | 改动 |
| --- | --- | --- |
| `GOODS` | `engine/data.ts` | `iron.name` → 「铁矿石」；**新增 `steel`（钢铁）** |
| `GOOD_IDS` | `engine/data.ts` | 派生，自动含 `steel` |
| `RESOURCE_MAP` / `RESOURCE_NAMES` | `engine/data.ts` | `iron`（铁矿）产出 `iron`（铁矿石），语义自洽 |
| `SUBSISTENCE` / `INCOME_ELASTICITY` | `engine/data.ts` | 补 `steel: 0` 键（`Record<GoodId, number>` 必须穷尽） |
| `CONSUMER_GOODS` | `engine/data.ts` | 不变（`steel` 非消费品） |
| `GOVERNMENT_DEMAND` | `engine/data.ts` | `construction` 的 `iron` → `steel` |
| `BUILDING_RECIPES` | `engine/data.ts` | 按新名册重写（§3） |
| `BUILDINGS` | `engine/data.ts` | 新名册 + `unlock?` + `infrastructureNeed`（§3/§5） |
| `BUILDING_TIME` | `engine/data.ts` | 新名册逐项 |
| `BUILDING_OUTPUT` | `engine/data.ts` | 补齐新 id（私人投资评分代理，ADR 0022 未退役） |
| `INVESTMENT_DEMAND` | `engine/data.ts` | 新名册；`iron` → `steel` 处按 §3 |
| `CAPACITY_COST` | `engine/construction.ts` | 新名册逐项 |
| `BUILDING_COST_MULTIPLIER/ADDEND` | `engine/construction.ts` | 补新 id（仍全 1/0） |
| `COUNTRY_SEEDS` | `engine/data.ts` | `buildings` 按新名册重写；`transportInfrastructure` 起步值重定 |
| `BuildingId` / `GoodId` | `types/index.d.ts` | 联合类型扩项 |
| `TRADABLE_GOODS` | `engine/trade.ts` | 加入 `steel` |
| `WorldState.version` | `engine/data.ts` / `engine/save.ts` | 10 → **11** |

**派生消费点（必须同步，否则编译或行为出错）**：`deriveLabor`、`deriveUnemployment`
（读 `buildings.factories`）、`completeBuilding`（读 `railroads`/`ports`/`universities`/`offices`）、
`randomDecision`（`build` 候选列表含 `factories`/`mines`）、`computePrestige`（读 `ports`）、
`EVENT_TEMPLATES` 的 `boom`（`buildings.factories >= 20`）。

## 3. 名册与配方（全部为**提案，可调**）

### 3.1 配方（每座/月；`labor` = 万人；门控沿用 ADR 0021 的 seam）

| 建筑 | output | input | labor | gates / outputModifier |
| --- | --- | --- | --- | --- |
| `farms` 农场 | grain 0.30、wood 0.04、opium 0.004 | — | 0.3 | tech+access（**`infrastructure` 标志退役**）；outputGates `{wood:{}}`；`farmOutput` |
| `coalMines` 煤矿 | coal 0.5 | — | 0.6 | tech；`mineOutput` |
| `ironMines` 铁矿 | iron 0.5 | — | 0.6 | tech；`mineOutput` |
| `lumberMills` 伐木场 | wood 0.5 | — | 0.4 | tech；`mineOutput`（或新 `lumberOutput`，**待定**） |
| `textileMills` 纺织厂 | fabric 0.6、clothes 0.3 | grain 0.3、coal 0.1、wood 0.05 | 0.9 | tech+industrial |
| `furnitureWorks` 家具厂 | furniture 0.3 | wood 0.4、iron 0.1、fabric 0.05 | 0.7 | tech+industrial |
| `distilleries` 酿酒厂 | liquor 0.3 | grain 0.5、coal 0.05、wood 0.05 | 0.6 | tech+industrial |
| `luxuryWorks` 奢侈品厂 | luxury 0.1 | fabric 0.2、coal 0.05、wood 0.05 | 0.8 | tech+industrial |
| `steelMills` 钢铁厂 | **steel 0.4** | **iron（铁矿石）0.5、coal 0.3** | 1.0 | tech+industrial |
| `machineryWorks` 机械厂 | machinery 0.3 | **steel 0.3**、coal 0.1、wood 0.05 | 1.0 | tech+industrial |
| `arsenals` 兵工厂 | arms 0.2 | **steel 0.25**、machinery 0.05、coal 0.1 | 0.9 | tech+industrial |
| `schools` 学校 | services 0.1 | — | 0.15 | access |
| `universities` 大学 | services 0.2 | — | 0.2 | — |
| `barracks` 兵营 | arms 0.05 | — | 0.3 | — |
| `forts` 要塞 | arms 0.03（**待定**） | steel 0.1、wood 0.1 | 0.3 | tech+industrial |
| `navalYards` 船坞 | machinery 0.1（**待定**） | steel 0.2、wood 0.2 | 0.8 | tech+industrial |
| `offices` 官署 | services 0.8 | — | 0.1 | — |
| `railroads` 铁路 | — | **steel 0.5**、wood 0.4 | 0.2 | — |
| `ports` 港口 | — | — | 0.4 | — |
| `canals` 运河 | — | wood 0.05（**待定**） | 0.3 | — |
| `telegraphs` 电报 | — | wood 0.02、iron 0.02（**待定**） | 0.2 | — |
| `workshops` 营造所 | —（建造点，特判） | wood 1、grain 0.6、**steel 0.3**（**待定**，见 §9 风险） | 0 | — |

要点：

- `iron` 现在**只**是 `steelMills` 的投入（铁矿石）；机械厂/兵工厂/铁路/家具厂/营造所把原
  `iron` 投入改成 `steel`。
- **单产**：除纺织厂（fabric→clothes 同链两产）外，每个工业建筑只产 1 种货。
- 农场不再走 `infrastructure` 门控——统一基础设施的 debuff 对所有建筑生效（§4）。

### 3.2 造价 / 工期 / 建造点 / 投资投入 / 基础设施需求

| 建筑 | cost | BUILDING_TIME(月) | CAPACITY_COST(点) | INVESTMENT_DEMAND | infrastructureNeed |
| --- | --- | --- | --- | --- | --- |
| `farms` | 1.5 | 2 | 0.5 | wood 0.12、furniture 0.02 | 0.4 |
| `coalMines` | 2.5 | 3 | 1 | iron 0.1、machinery 0.03、wood 0.1 | 1.0 |
| `ironMines` | 2.5 | 3 | 1 | steel 0.05、machinery 0.03、wood 0.1 | 1.0 |
| `lumberMills` | 2 | 2 | 0.8 | wood 0.05、machinery 0.02 | 0.8 |
| `textileMills` | 4 | 4 | 2 | iron 0.1、steel 0.05、machinery 0.1、wood 0.1 | 1.2 |
| `furnitureWorks` | 3.5 | 3 | 1.5 | wood 0.2、iron 0.08、machinery 0.05 | 1.0 |
| `distilleries` | 3.5 | 3 | 1.5 | iron 0.1、machinery 0.05、wood 0.1 | 0.8 |
| `machineryWorks` | 5 | 5 | 2.5 | steel 0.2、machinery 0.1 | 1.2 |
| `steelMills` | 5 | 5 | 2.5 | steel 0.1、iron 0.15、machinery 0.1 | 1.5 |
| `arsenals` | 4.5 | 4 | 2 | steel 0.2、machinery 0.1 | 1.0 |
| `luxuryWorks` | 5 | 4 | 2 | iron 0.1、machinery 0.1、fabric 0.05 | 0.6 |
| `schools` | 2 | 3 | 1 | furniture 0.1、wood 0.05 | 0.2 |
| `universities` | 5 | 5 | 2 | furniture 0.12、wood 0.05 | 0.3 |
| `barracks` | 2.5 | 2 | 1 | wood 0.1、furniture 0.05 | 0.6 |
| `forts` | 4 | 4 | 2 | steel 0.15、wood 0.15 | 0.3 |
| `navalYards` | 5 | 5 | 2.5 | wood 0.3、steel 0.2、machinery 0.1 | 1.0 |
| `offices` | 3 | 3 | 1 | furniture 0.1、wood 0.05 | 0.5 |
| `railroads` | 7 | 8 | 4 | steel 0.5、machinery 0.16、wood 0.4 | 0.5 |
| `ports` | 3 | 3 | 1.5 | wood 0.3、steel 0.1 | 0.8 |
| `canals` | 6 | 6 | 3 | wood 0.2、steel 0.15、machinery 0.05 | 0.3 |
| `telegraphs` | 4 | 2 | 1.5 | iron 0.1、wood 0.15 | 0.4 |
| `workshops` | 3 | 3 | 1.5 | wood 0.3、steel 0.2、furniture 0.05 | 0.8 |

### 3.3 `COUNTRY_SEEDS` 重写（成本中心）

每个种子的 `buildings` 必须按新名册重写：

- `mines` 的座数拆到 `coalMines`/`ironMines`/`lumberMills`（按旧产出比例，或按国别资源禀赋；
  **初始分配待 F7 校准**）。
- `factories` 的座数拆到 7 个工业建筑。
- 新建筑（`schools`/`canals`/`telegraphs`/`forts`/`navalYards`）赋初值（可按技术等级/区域给
  不同起步，**待定**）。
- `transportInfrastructure` 起步值：因基础设施改为**派生**（§4），种子的标量要么**丢弃**
  （由供给建筑决定起步），要么保留作**起步底数**。**待定**——推荐丢弃，用供给建筑（铁路/港口/
  运河/电报）的初始座数体现起步差异，再按 F7 校准至旧开局量级。

## 4. 统一基础设施模型（**提案，可调**）

### 4.1 供给与需求

```
供给 = Σ_{b ∈ {railroads, ports, canals, telegraphs}} count_b × 供给系数[b]
需求 = Σ_{all b} count_b × infrastructureNeed[b]
ratio = 供给 / max(0.1, 需求)
基础设施乘数 = ratio ≥ 1 ? 1 : clamp(ratio, 0.35, 1)     // 线性短缺 debuff
```

供给系数：铁路 3.0、港口 1.5、运河 2.0、电报 0.8。
需求见 §3.2 的 `infrastructureNeed`（0.2–1.5）。**所有数值为提案，待 F5/F7 校准。**

### 4.2 应用与存储

- **统一池**：一个国家级 `供给` 对**全部建筑**的需求求和；**无分池**。
- **线性 debuff**：对**每座建筑的产出**乘 `基础设施乘数`（服务业也乘）。逐配方的
  `gates.infrastructure` 标志与旧 `0.6 + 交通/160` 曲线**退场**（只在文档与展示里保留旧名）。
- **存储**：月末 `基础设施水平 = clamp(100 × ratio, 0, 100)` 写入 `econ.transportInfrastructure`
  （字段**改名** `econ.infrastructure` = **待定**；`transportInfrastructure` 这个 `ModifierStat`
  保留，避免政策文案改串）。生产**下月**读取，沿用 ADR 0022 的滞后纪律。
- **只罚不奖**：供过于求不给奖励（是否加奖励**待定**）。

### 4.3 维护（消耗）

`computeDemand` 增加一块与基础设施挂钩的**中间需求**：

```
吞吐维护 = 供给 × { wood: 0.01, coal: 0.015, services: 0.02 }
行政维护 = (水平 / 100) × { services: 0.01 }
```

- 服务来自现有官署/大学产出（`services`），不新增建筑也能供给。
- v1 维护**不反向门控供给**（只是需求），原料短缺是否拖累基础设施**待定**。
- 数值**可调**。

## 5. `unlock` 字段与 `build` 校验

```ts
type BuildingUnlock = { techLevel?: number }
type BuildingDef = {
  name: string
  cost: number
  note: string
  unlock?: BuildingUnlock          // 前瞻占位（plan 0005）
  infrastructureNeed: number       // §4
}
```

- `BUILDINGS: Record<BuildingId, BuildingDef>`；本次所有建筑的 `unlock` **缺省**（全解锁）。
- `applyDecision` 的 `case 'build'`（`engine/actions.ts`）加入校验：
  `const need = BUILDINGS[building].unlock?.techLevel; if (need !== undefined && country.tech.level < need) → 拒绝`。
  因当前全部缺省，**行为与今天一致**。

## 6. 利润带与校准（分批）

**目标利润带（`buildingProfits` 口径；全部为提案，可调）**：

| 组 | 建筑 | 目标毛利带 |
| --- | --- | --- |
| 农业 | `farms` | 5–20% |
| 采掘 | `coalMines`/`ironMines`/`lumberMills` | 8–25%（资源租，带宽大） |
| 轻工业 | `textileMills`/`furnitureWorks`/`distilleries`/`luxuryWorks` | 5–20% |
| 重工业 | `steelMills`/`machineryWorks`/`arsenals` | 5–18% |
| 服务/知识 | `schools`/`universities`/`offices` | 0–15%（公共，可低） |
| 军事 | `barracks`/`forts`/`navalYards` | 0–12% |
| 成本中心 | `railroads`/`ports`/`canals`/`telegraphs`/`workshops` | **不设带**（基建/建造体系） |

**分批调参（`分批`，不是一次全调）**：把 gate 扩展成**按组回归**，一次调一组：

- **批 A 采掘**：先让三矿在参考点落带（它们无投入，主要受基价与工资分摊影响）。
- **批 B 轻工业**：纺织/家具/酿酒/奢侈品——消费品的本地产销。
- **批 C 重工业**：钢铁/机械/军械——链式（铁矿石→钢铁→机械），利润被上游价传导。
- **批 D 农业 + 服务 + 军事**：农场与公共服务/军事建筑；成本中心的「价值」由基础设施流体现。
- 每批独立提交、测试全绿再进下一批；**参考点**沿用 plan 0008 §5 的「七大国产量加权聚合」。

## 7. TDD 里程碑

每个里程碑先写失败测试，再补实现；独立提交、测试全绿再进下一个。

| 里程碑 | 内容 | 行为 / 风险 | 护栏测试 |
| --- | --- | --- | --- |
| **F1 商品：加 `steel` + `iron`→铁矿石** | `GOODS`（+steel，iron 改名）、`SUBSISTENCE`/`INCOME_ELASTICITY` 补键、`GOVERNMENT_DEMAND.construction` iron→steel、`TRADABLE_GOODS` 加 steel；`GoodId` 扩项 | `Record<GoodId,number>` 漏键会编译失败；改基价会挪动物价中心 | `GOODS.steel` 存在且 `iron.name='铁矿石'`；`SUBSISTENCE/INCOME_ELASTICITY` 含 `steel:0`；`zeroGoods`/`basePrices` 覆盖 steel；`steel` 可贸易、非消费品 |
| **F2 拆矿场** | `mines` → `coalMines`/`ironMines`/`lumberMills`（名册/配方/时间/建造点/投资/输出/种子） | 漏改任一 `Record<BuildingId,…>` 或派生消费点即编译失败；种子座数分配改变产出总量 | 每个新矿只产 1 货；`steelMills` 吃 `iron`+`coal`；全仓无 `mines` 残留；种子座数总和守恒或按资源禀赋可解释 |
| **F3 拆工厂** | `factories` → 7 个工业建筑；机械/军械/铁路/家具改吃 `steel` | 链条断裂（无 `steel` 来源）会让重工业停摆；`deriveUnemployment`/`boom` 事件读 `factories` 需改 | 每个工业建筑 output 键数 ≤2；`steelMills`/`machineryWorks`/`arsenals` 配方正确；`buildingProfits` 逐类可算；无 `factories` 残留 |
| **F4 加 5 类建筑** | `schools`/`canals`/`telegraphs`/`forts`/`navalYards`（名册/配方/时间/建造点/投资/输出/种子） | 每个 `Record<BuildingId,…>` 都要补 5 键；运河/电报无产出需特判为成本中心 | 5 个 id 出现在全部 `Record<BuildingId,…>` 表；`canals`/`telegraphs` output 空且供给 >0；`completeBuilding` 对新增的可建筑无遗漏（或明确无副作用） |
| **F5 统一基础设施 + debuff** | `INFRA_SUPPLY`/`infrastructureNeed`；`ratio`/乘数；`computeProduction` 施加；`computeDemand` 加维护需求；月末写 `基础设施水平`；旧 `gates.infrastructure` 与旧曲线退场 | 改变了全部建筑的产出口径（行为变更）；维护需求进市场会推高 wood/coal/services 需求 | `ratio=1` → 乘数 1（无 debuff）；`ratio=0.5` → 乘数 0.5；`ratio≥1` 不奖励；维护需求按供给/水平正确计入 demand；`C+I+G+NX===GDP` 不变；60 月确定性 |
| **F6 `unlock` + build 校验** | `BuildingDef.unlock/infrastructureNeed`；`build` 动作加 techLevel 校验 | 校验写反会误挡建筑；字段位置写错会让 TS 契约不一致 | 开局所有建筑可建；合成一个 `unlock.techLevel > 当前` 的建筑被拒；当前缺省下 `build` 行为与接入前逐位相同 |
| **F7 分批校准 + gate** | 扩展 `tests/economy-recipe-calibration.test.ts`：按 §6 的分组利润带、`steel` 两侧、无钉价；按批 A→B→C→D 校准种子与系数 | 一次全调会互相掩盖；参考点选择影响结论 | 每组产货建筑在参考点落带；`iron`/`steel`/`machinery` 两侧都有市场（每 12 月 ≥1 次）；无商品长期钉 0.25×/4×；`wages+profits ∈ [0.5,1.5]×realGdp` |

### 7.1 拆分的迁移顺序（降低红绿时间）

F2/F3/F4 都是 `BuildingId` 联合类型变更，**一次改全**（类型 + 全部 `Record<BuildingId,…>` +
派生消费点 + 种子）才能编译；建议**每类拆分单独一个 commit**，用「先加新 id、旧 id 暂时保留、
再把旧 id 的座数与配方迁走、最后删旧 id」的方式控红时间（旧 id 的临时双声明**同一 commit 内完成删除**）。

## 8. 验收

- `v3_inspect economy` 能逐类读到**单产建筑**的「产出 − 投入 − 工资 = 利润（毛利，金/座）」。
- `v3_inspect`（或 market）能读到统一的**基础设施供给 / 需求 / ratio / debuff** 与维护需求。
- §6 的利润带 gate 与 §7 的护栏测试全绿；`claude plugin test .` 全绿、`claude plugin validate .` 通过。
- 世界版本 **v11**；v10 及更旧存档按 ADR 0005 拒绝。
- 不变量保持：`C+I+G+NX===GDP`、金币守恒、贸易路线金币守恒、60/120 月确定性、鸦片危机门。

## 9. 风险

| 风险 | 缓解 |
| --- | --- |
| `COUNTRY_SEEDS` 大改引入不平衡 | 座数拆分按旧产出比例做初值，F7 分批校准重建基线 |
| `iron`→铁矿石 语义断层被误读 | 保留 id 降低改动量；提交信息、本文、GLOSSARY 三处写清；机械/军械等改吃 `steel` |
| 重工业链条断裂（无钢铁供给） | `steelMills` 投入只有铁矿石 + 煤，起步即可建；F7 保证 `iron`/`steel` 两侧有市场 |
| 营造所改吃 `steel` 拖慢早期建造 | **待定**：可让营造所继续吃 `iron`（见 §10），F2 时定 |
| 基础设施从「标量」改「派生」使开局漂移 | 种子用供给建筑体现起步；F5/F7 校准至旧开局量级；命名变更**待定** |
| 维护需求推高 wood/coal/services 价格 | 维护系数设小（0.01–0.02 量级）；F7 校准；必要时 v1 不反向门控供给 |
| 拆分后建筑数爆炸、界面冗长 | 22 类在面板里分组显示（采掘/轻工/重工/服务/军事/基建）；不改结算 |
| 一次性行为变更破坏既有基线 | 每个里程碑独立重定基线；确定性与绝对额断言分开；ADR 0005 允许重开 |

## 10. 待定

- **营造所投入**：木材/粮食 + `iron`（铁矿石）还是 `steel`？改 `steel` 更符合「建筑用钢」，
  但会让早期建造依赖钢铁链。F2 时定。
- **`forts` / `navalYards` 的产出**：军事成本中心（无货产出 + 军事效果）还是小量军械/机械产出？
  本文按小量产出写；若要军事效果（士气/质量/防御），需新增结算点，超本切片范围。
- **`lumberMills` 的 `outputModifier`**：复用 `mineOutput` 还是新增 `lumberOutput`？
- **基础设施字段命名**：`econ.transportInfrastructure` 保留 vs 改名 `econ.infrastructure`；
  `ModifierStat` 是否同步。建议字段改名、ModifierStat 保留（降政策改动）。
- **`transportInfrastructure` 种子标量**：丢弃（由供给建筑决定）还是保留作底数？
- **过剩奖励**：基础设施供给 > 需求是否给生产奖励（本 ADR 只罚不奖）。
- **维护反噬**：原料/服务短缺是否拖累基础设施供给与水平。
- **基础设施供给是否受市场接入/科技门控**：本 ADR 的供给系数是常数；是否乘 tech/access 待定。
- **种子座数分配**：三矿与七工的初始分配、新建筑的国别初值（可按 techLevel/region 给）。
- **学校是否在建成时加识字率/教育效果**：本文只让其产出 `services`；加 side effect 需改
  `completeBuilding`。
- **`unlock` 与 plan 0005 的接口**：科技树里「解锁」是节点还是等级门槛，留给 0005。

## 11. 与 plan 0005 / 0009 的关系

- `0005-tech-tree.md`：本计划只给建筑加前向兼容的 `unlock` 占位与校验，不实现科技树。
- `0009-config-refactor.md`（ADR 0024）：本计划新增的 `INFRA_SUPPLY`/`infrastructureNeed` 等
  常数，先与现有配置同处 `engine/data.ts`；0009 落地时按同一分层规则迁到 `engine/config/`。
