# 建筑扩张与统一基础设施（Building Expansion + Infrastructure）

- Status: **F1–F7 已实现**（World v11：F1 `iron`→铁矿石、新增 `steel`，详见 §7.2；F2 `mines`→`coalMines`/`ironMines`/`lumberMills`，详见 §7.3；F3 `factories`→七个单产工业建筑，详见 §7.4；F4 加学校/运河/电报/要塞/船坞，详见 §7.5；F5 统一基础设施，详见 §7.6；F6 `unlock` 前向字段 + `build` 校验，详见 §7.7）；**F7 分批校准已完成**。其余章节仍为提案（本文件描述，F2+ 再改引擎/测试）
- **⚠️ 已被 plan 0014 / ADR 0029 取代（World v12）**：F4 的四类基础设施供给者（铁路/港口/运河/电报）已**合并为单一 `infrastructure`、运河删除**，名册 22→19。本文 §3.1/§5/§7.5/§7.8 里「铁路/港口/运河/电报各自供给」的四类模型**描述的是历史（v11）状态**，不再对应当前引擎；当前供给由 `INFRA_BUILDING_IDS` 接缝（只含 `infrastructure`）承载。种子折算、系数校准与可重拆接缝见 `docs/adr/0029-infrastructure-merge.md` 与 `docs/plans/0014-infrastructure-merge.md`。
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
| `forts` 要塞 | arms **0.08**（F7 定案，§7.8） | steel 0.02、wood 0.03 | 0.3 | tech+industrial |
| `navalYards` 船坞 | machinery **0.14**（F7 定案，§7.8） | steel 0.08、wood 0.08 | 0.8 | tech+industrial |
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

> **`infrastructureNeed` 一列的「已落地值」见 §4.1（农场 0、其余 0.03–0.22，F5 按 1836 基线重定），
> 本节其余列为当初的提案值。**

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

供给系数（**F7 已校准值**）：铁路 2.5、港口 1.1、运河 1.6、电报 0.7（F5 的 3.0/1.5/2.0/0.8 已下调，见 §7.8）。
需求（`infrastructureNeed`，**F5 已落地值**）：农场 **0**（自给农业不依赖国家运输网；§3.2 的 0.4 在 3000 座农场的 QING 上会把 ratio 压到 0.016）；采掘 0.12–0.15；轻工业 0.09–0.18；重工业 0.18–0.22（钢铁厂最高）；服务/公共 0.03–0.08；军事 0.05–0.15；基建自身 0.05–0.12。完整逐建筑值见 `engine/data.ts` 的 `BUILDINGS[*].infrastructureNeed`。
**F7 校准后**：1836 基线（种子 9100）的 ratio 为 QING 1.10／GBR 2.30／FRA 1.55／PRU 1.15／RUS 1.14／AUS 1.20／USA 1.78／JAP 1.27／OTT 1.26／SPA 1.69——**十国全部 ≥1，不预触发**。随工业化推进而基建不扩建时 debuff 自然显现（84 月 QING 0.87、PRU 0.54、RUS 0.66、AUS 0.51，其余供过于求无罚；最低 0.51 未触 0.35 地板）。

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

**目标利润带（`buildingProfits` 口径，7 大国产量加权，24/48/84 月；F7 已校准）**：

| 组 | 建筑 | 目标毛利带 |
| --- | --- | --- |
| 农业 | `farms` | 48–62% |
| 采掘 | `coalMines`/`ironMines`/`lumberMills` | 42–62%（资源租，带宽大） |
| 轻工业 | `textileMills`/`furnitureWorks`/`distilleries`/`luxuryWorks` | 4–25% |
| 重工业 | `steelMills`/`machineryWorks`/`arsenals` | 0–36% |
| 服务/知识 | `schools`/`universities`/`offices` | 38–58% |
| 军事 | `barracks`/`forts`/`navalYards` | 45–65% |
| 成本中心 | `railroads`/`ports`/`canals`/`telegraphs`/`workshops` | **不设带**（基建/建造体系） |

> **为何不是 §6 原稿的 5–20%**：`buildingProfits` 是**毛经营剩余**，工资按 `WAGE_ALLOCATION='valueAdded'`
> 分摊，于是**无材料投入的部门**（农场/矿场/服务/兵营）的毛利率恒为 `1 − 全国工资/Σ增值 ≈ 45–60%`；
> 只有**材料加工型工业**能落进 5–25% 带。原稿对所有组都写 ≤25% 与宏观工资份额不自洽——F7 按
> 这一结构**重定带**（把工业带收在 4–25%），并把改前「近乎不赚」的家具厂（0.3%）、兵工厂（1.0%）
> 提到正毛利。详见 §7.8。

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
| **F1 商品：加 `steel` + `iron`→铁矿石** ✅ | `GOODS`（+steel，iron 改名）、`SUBSISTENCE`/`INCOME_ELASTICITY` 补键、`GOVERNMENT_DEMAND.construction` iron→steel、`TRADABLE_GOODS` 加 steel；`GoodId` 扩项 | `Record<GoodId,number>` 漏键会编译失败；改基价会挪动物价中心 | `GOODS.steel` 存在且 `iron.name='铁矿石'`；`SUBSISTENCE/INCOME_ELASTICITY` 含 `steel:0`；`zeroGoods`/`basePrices` 覆盖 steel；`steel` 可贸易、非消费品 |
| **F2 拆矿场** ✅ | `mines` → `coalMines`/`ironMines`/`lumberMills`（名册/配方/时间/建造点/投资/输出/种子） | 漏改任一 `Record<BuildingId,…>` 或派生消费点即编译失败；种子座数分配改变产出总量 | 每个新矿只产 1 货；`steelMills` 吃 `iron`+`coal`；全仓无 `mines` 残留；种子座数总和守恒或按资源禀赋可解释 |
| **F3 拆工厂** ✅ | `factories` → 7 个工业建筑；机械/军械/铁路/家具改吃 `steel` | 链条断裂（无 `steel` 来源）会让重工业停摆；`deriveUnemployment`/`boom` 事件读 `factories` 需改 | 每个工业建筑 output 键数 ≤2；`steelMills`/`machineryWorks`/`arsenals` 配方正确；`buildingProfits` 逐类可算；无 `factories` 残留 |
| **F4 加 5 类建筑** ✅ | `schools`/`canals`/`telegraphs`/`forts`/`navalYards`（名册/配方/时间/建造点/投资/输出/种子） | 每个 `Record<BuildingId,…>` 都要补 5 键；运河/电报无产出需特判为成本中心 | 5 个 id 出现在全部 `Record<BuildingId,…>` 表；`canals`/`telegraphs` output 空且供给 >0；`completeBuilding` 对新增的可建筑无遗漏（或明确无副作用） |
| **F5 统一基础设施 + debuff** ✅ | `INFRA_SUPPLY`/`infrastructureNeed`；`ratio`/乘数；`computeProduction` 施加；`computeDemand` 加维护需求；月末写 `基础设施水平`；旧 `gates.infrastructure` 与旧曲线退场 | 改变了全部建筑的产出口径（行为变更）；维护需求进市场会推高 wood/coal/services 需求 | `ratio=1` → 乘数 1（无 debuff）；`ratio=0.5` → 乘数 0.5；`ratio≥1` 不奖励；维护需求按供给/水平正确计入 demand；`C+I+G+NX===GDP` 不变；60 月确定性 |
| **F6 `unlock` + build 校验** ✅ | `BuildingDef.unlock`（`{ techLevel?: number }`）；`build` 动作加 techLevel 校验；`inspect buildings` 只读显示 | 校验写反会误挡建筑；字段位置写错会让 TS 契约不一致 | 开局所有建筑可建；合成一个 `unlock.techLevel > 当前` 的建筑被拒；当前缺省下 `build` 行为与接入前逐位相同 |
| **F7 分批校准 + gate** ✅ | 扩展 `tests/economy-recipe-calibration.test.ts`：按 §6 的分组利润带、`steel` 两侧、无钉价；按批 A→B→C→D 校准种子与系数 | 一次全调会互相掩盖；参考点选择影响结论 | 每组产货建筑在参考点落带；`iron`/`steel`/`machinery` 两侧都有市场（每 12 月 ≥1 次）；无商品长期钉 0.25×/4×；`wages+profits ∈ [0.5,1.5]×realGdp` |

### 7.1 拆分的迁移顺序（降低红绿时间）

F2/F3/F4 都是 `BuildingId` 联合类型变更，**一次改全**（类型 + 全部 `Record<BuildingId,…>` +
派生消费点 + 种子）才能编译；建议**每类拆分单独一个 commit**，用「先加新 id、旧 id 暂时保留、
再把旧 id 的座数与配方迁走、最后删旧 id」的方式控红时间（旧 id 的临时双声明**同一 commit 内完成删除**）。

### 7.2 F1 已落地的安排（World v11）

F1 只做「商品 + 最小链条」，**不动名册**（矿场/工厂仍打包，F2/F3 才拆）。实际落地：

- **商品**：`iron` 保留 id，显示名 `钢铁`→**`铁矿石`**、`basePrice` 2.2→**1.0**；新增
  **`steel`（钢铁）**，`basePrice` **2.2**（取旧 `iron` 的价，使改吃钢的下游真实成本不变）。
  `SUBSISTENCE`/`INCOME_ELASTICITY` 补 `steel: 0`；`TRADABLE_GOODS` 含 `steel`；`ModifierStat`
  文案 `ironOutput/ironDemand`→铁矿石，新增 `steelOutput/steelDemand`。
- **链条（F1 打包版）**：`factories` **投入** `iron`(铁矿石，0.2→**0.45**) + `coal`，**产出**
  `steel 0.09`（唯一来源）。`railroads.input` `iron→steel 0.5`；`INVESTMENT_DEMAND`
  的 `iron` 全部改 `steel`；`GOVERNMENT_DEMAND.construction` `iron→steel`（该块当前
  `governmentGold.construction = 0`，是登记用、不影响当期需求）。`BUILDING_OUTPUT.factories`
  补 `steel`（私人投资评分代理）。
- **两侧市场**：`engine/economy.ts` 的全国工业中间篮子把 `iron` 项从 `popFactor×0.8` 降到
  **`popFactor×0.6`**，并新增 **`steel: popFactor×0.2`**——按人口缩放使钢铁市场天然双侧
  （人口多、工厂少的经济体买钢，工厂密集的经济体卖钢），同时把铁矿石需求留给炼钢的工厂。
- **为何这样选**：goal 要求「工厂吃铁矿石 + 煤产钢、重工业改吃钢、投资与政府需求改吃钢」。
  F1 不拆工厂，故 `machinery/arms/furniture` 的用钢**不单列**（它们仍打包在工厂产出里）；
  工厂的钢投入通过`INVESTMENT_DEMAND`/中间篮子/铁路体现。曾试验「把整篮子 iron→steel」
  与「工厂内部再消费 steel」两种排法：前者使 QING（人口占 65 中约 40、工厂仅 20）出现巨大
  钢缺口，进口钢挤压支付能力、**压掉了鸦片进口门**；后者让每个工厂国自给、钢无贸易。
  现值在 24 月基线上 `iron`/`steel` **双侧均 >0**、`steel` 出现于进出口流，且鸦片门（≥2/月、
  ≥20% 来自英国）保持。
- **不变量**：`C+I+G+NX===GDP`、金币守恒、60/120 月确定性、工资分摊恒等式、鸦片门、
  以及 `tests/economy-recipe-calibration.test.ts` 全部 9 项 gate 均绿（334 pass / 0 fail）。
  工厂毛利带仍在 5–20%（工厂新增钢收入、铁矿石变便宜，合价后落带内）。
- **可调数字（F7 统一校准）**：`GOODS.iron.basePrice`、`GOODS.steel.basePrice`、
  `factories.input.iron=0.45`、`factories.output.steel=0.09`、中间篮子的 `0.6/0.2`。
  参考点仍是 plan 0008 §5 的「七大国产量加权聚合」。

### 7.3 F2 已落地的安排（World v11，名册不变）

F2 把打包的 `mines` 拆成三个单产采掘建筑，**World 版本仍为 v11**（同一次扩张，无结构断裂）。实际落地：

- **配方（每座/月）**：`coalMines`→`coal 0.96`、`ironMines`→`iron 0.96`、`lumberMills`→`wood 0.96`；三者
  `input` 皆空、门控 `{tech:true}`、`outputModifier: 'mineOutput'`（复用，最小改动）、labor 各 0.6/0.6/0.4。
- **为何系数是 0.96 而非 §3.1 的 0.5**：0.96 = 旧 `mines` 单座的**产出总和**（`0.5+0.42+0.04`）。
  `COUNTRY_SEEDS` 把旧矿场座数**按旧产出比例拆开**（见下），于是「单产系数 = 旧总和 × 按比例拆
  的座数」恰好**逐货守恒**旧世界的煤/铁/木供给，同时**总采掘座数不变**（labor 与投资量级也基本不变）。
  若照 §3.1 用 0.5/0.42 配「按比例拆座数」，煤/铁供给会腰斩、`iron` 双侧市场会破——这正是本计划
  §10“种子座数分配”要 F7 校准的地方；F2 选了守恒式初值，把校准留给 F7。
- **`COUNTRY_SEEDS` 拆分规则**：每国旧 `mines` 座数 N 按 `coal 0.5 : iron 0.42 : wood 0.04` 的比例
  拆到三矿，即 `coalMines≈0.52N、ironMines≈0.44N、lumberMills≈0.04N`（四舍五入，余数给煤矿）。
  十国总和守恒：旧 `mines` 合计 **512**，新三矿合计亦 **512**（煤 266 / 铁 225 / 木 21）。
- **造价/工期/建造点**：`coalMines`/`ironMines` cost 2.5、工期 3、建造点 1；`lumberMills` cost 2、工期 2、
  建造点 0.8（§3.2 提案值）。
- **`INVESTMENT_DEMAND`**（F1 后一律用 `steel`，不再有 `iron` 键）：`coalMines` `{steel 0.1, machinery 0.03, wood 0.1}`、
  `ironMines` `{steel 0.05, machinery 0.03, wood 0.1}`、`lumberMills` `{wood 0.05, machinery 0.02}`。
- **`BUILDING_OUTPUT`**（私人投资短缺信号）：三矿各为单货 `0.96`。
- **同步更新的消费点**：`deriveLabor`、`randomDecision` 的 build 候选、`engine/ai.ts` 提示词与国别行、
  `hooks/register.tsx` 的两个建筑 enum、`engine/inspect.ts` 的 labor/building 文案、以及引用 `mines`
  的测试。
- **世界供给核对**（种子 9100，第 24 月，全球 bid/offer）：煤 31.5/175.8、铁 49.4/30.7、木 45.1/147.7
  ——与拆分前（煤 31.6/172.3、铁 51.9/27.5、木 46.2/146.7）基本一致，三货双侧性保持。
- **不变量**：`tests/economy-recipe-calibration.test.ts` 全部 9 项 gate 绿；`C+I+G+NX===GDP`、金币守恒、
  60/120 月确定性、工资分摊恒等式均绿（344 pass / 0 fail）。新增 `tests/extraction-split.test.ts` 覆盖三矿
  单产配方、`mines` 无残留、种子座数守恒与三货双侧性。

### 7.4 F3 已落地的安排（World v11，名册不变）

F3 把打包的 `factories` 拆成七个单产/少产工业建筑，**World 版本仍为 v11**。实际落地：

- **七个建筑（每座/月，labor = 万人）**：
  - `textileMills` 纺织厂：产出 `fabric 1.45 + clothes 0.68`；投入 `grain 1.0、coal 0.18、wood 0.1、machinery 0.18`；labor 0.9。
  - `furnitureWorks` 家具厂：产出 `furniture 1.54`；投入 `wood 0.1、coal 0.18、fabric 1.14、steel 0.3、machinery 0.18`；labor 0.7。
  - `distilleries` 酿酒厂：产出 `liquor 1.9`；投入 `grain 1.0、coal 0.18、wood 0.1、machinery 0.18`；labor 0.6。
  - `machineryWorks` 机械厂：产出 `machinery 0.82`；投入 `steel 0.5、coal 0.18、wood 0.1、machinery 0.18`；labor 1.0。
  - `steelMills` 钢铁厂：产出 `steel 4.0`；投入 `iron(铁矿石) 3.5、coal 0.5、machinery 0.18`；labor 1.0。
  - `arsenals` 兵工厂：产出 `arms 0.9`；投入 `steel 0.5、machinery 0.3、coal 0.18、iron 0.3`；labor 0.9。
  - `luxuryWorks` 奢侈品厂：产出 `luxury 0.49`；投入 `fabric 1.14、coal 0.18、wood 0.1、machinery 0.18`；labor 0.8。
- **门控**：七个全部 `{tech, industrial}`，共用 `outputModifier: 'factoryOutput'`；旧工厂的
  **liquor 仅 `industrial`** 覆盖被原样保留在 `distilleries` 上（`outputGates.liquor`）。
- **输出守恒（为何系数不是 §3.1 的值）**：沿用 F2 的守恒思路——每个建筑某货的产出系数 =
  **旧 `factories` 该货系数 ÷ 该建筑的旧产出价值占比**（value share）。价值占比按旧工厂产出
  向量与基准价算：纺织 41.4%、机械 21.9%、家具 10.4%、军械 7.8%、酿酒 7.4%、奢侈 7.1%、钢铁 4.0%。
  这样「按价值占比拆座数 × 系数 = 旧产出」逐货守恒，全国工业供给与拆分前一致。
- **投入守恒（防止拆分断链）**：新建筑的投入合计**复现旧工厂的每厂消耗篮子**——粮食给纺织/酿酒、
  铁矿石给炼钢、布料给家具/奢侈，而煤/木材/**机械（工业周转资本）**按座给到七个建筑。
  于是**聚合投入价值守恒**，聚合毛利回到旧工厂的 ~16% 带内（参考点实测 7 大国产量加权 **16.0%**）。
- **`COUNTRY_SEEDS` 拆分规则**：每国旧 `factories` 座数 N 按旧**产出价值占比**拆到七个建筑
  （四舍五入，余数给纺织厂）。十国总和守恒：旧 `factories` 合计 **516**，新七类合计亦 **516**。
- **造价/工期/建造点**：`textileMills` 4/4/2、`furnitureWorks` 3.5/3/1.5、`distilleries` 3.5/3/1.5、
  `machineryWorks` 5/5/2.5、`steelMills` 5/5/2.5、`arsenals` 4.5/4/2、`luxuryWorks` 5/4/2（§3.2 提案值）。
- **`INVESTMENT_DEMAND`**（F1 后一律 `steel`、无 `iron` 键）：纺织 `{steel 0.1, machinery 0.1, wood 0.1}`、
  家具 `{wood 0.2, steel 0.08, machinery 0.05}`、酿酒 `{steel 0.1, machinery 0.05, wood 0.1}`、
  机械 `{steel 0.2, machinery 0.1}`、钢铁 `{steel 0.15, machinery 0.1}`、军械 `{steel 0.2, machinery 0.1}`、
  奢侈 `{steel 0.1, machinery 0.1, fabric 0.05}`。
- **`BUILDING_OUTPUT`**（私人投资短缺信号）：按旧工厂七货权重拆到对应建筑。
- **`factories` 引用全部改线**：`BuildingId`、`BUILDING_RECIPES`、`BUILDINGS`、`BUILDING_TIME`、
  `INVESTMENT_DEMAND`、`BUILDING_OUTPUT`、`CAPACITY_COST`、`BUILDING_COST_MULTIPLIER/ADDEND`、
  `COUNTRY_SEEDS`、`randomDecision` 的 build 候选、`engine/ai.ts` 提示词与国别行、`engine/inspect.ts`
  的就业基础/建筑提示、`hooks/register.tsx` 的两个建筑 enum。派生消费点 `deriveUnemployment`、
  `country.ts` 的城市化/工匠转移、`investment.ts` 的工业禀赋乘子改用 `industrialBuildingCount`
  （= 七个工业建筑之和，座数守恒使其量级与旧 `factories` 一致）。
- **`boom` 事件与 `工业起飞` 阈值**：`factories >= 20` / `>= 100` 改为**工业建筑总数** `>= 20` / `>= 100`
  （座数守恒故行为等价）；配置条件 `ConditionStat` 的 `'factories'` 更名 **`'industry'`**
  （`engine/scale.ts`、`engine/config/blocks/thresholds.ts`）。
- **世界供给核对**（种子 9100）：`fabric`/`machinery`/`steel`/`iron` 与粮/煤/木在所有 12 月窗口**双侧性达标**；
  参考点（第 24 月）7 大国产量加权聚合工业毛利 **16.0%**（GBR 6.5%、FRA 11.6%、PRU 11.2%），
  无商品钉价、每个主要国至少一类工业盈利。
- **不变量**：`tests/economy-recipe-calibration.test.ts` gate 全绿（边际带、双侧性、无钉价、
  `C+I+G+NX===GDP`、工资分摊恒等式、60/120 月确定性）；新增 `tests/industrial-split.test.ts`
  覆盖七建筑配方（output 键 ≤2、钢铁/机械/军械链条、纺织两产）、`factories` 无残留、种子座数守恒与
  工业货双侧性（351 pass / 0 fail）。
- **可调数字（F7 统一校准）**：七建筑的 output/input 系数、`COUNTRY_SEEDS` 的国别占比、`GOODS` 基准价。
  参考点仍为 plan 0008 §5 的「七大国产量加权聚合」。

### 7.5 F4 已落地的安排（World v11，名册不变）

F4 把名册从 17 类扩到 **22 类**（加 5 类），**World 版本仍为 v11**。实际落地：

- **五类建筑（每座/月；labor = 万人）**：
  - `schools` 学校：初等教育。产出 `services 0.1`，门控 `{access}`，labor 0.15；造价 2、工期 3、建造点 1。
  - `canals` 运河：**无货产出的成本中心**。投入 `wood 0.05`，labor 0.3；造价 6、工期 6、建造点 3。
  - `telegraphs` 电报：**无货产出的成本中心**。投入 `wood 0.02、iron 0.02`，labor 0.2；造价 4、工期 2、建造点 1.5。
  - `forts` 要塞：小量军械产出 `arms 0.03`，投入 `steel 0.1、wood 0.1`，门控 `{tech, industrial}`，labor 0.3；造价 4、工期 4、建造点 2。
  - `navalYards` 船坞：小量机械产出 `machinery 0.1`，投入 `steel 0.2、wood 0.2`，门控 `{tech, industrial}`，labor 0.8；造价 5、工期 5、建造点 2.5。
- **`completeBuilding` 完成副作用**（照铁路/港口/大学的既有模式）：
  - `schools`：识字率 `+count × 0.002`（clamp 0..1）——**解决 §10 待定「学校是否在建成时加识字率/教育效果」：是**。
  - `canals`：`transportInfrastructure +count × 2`、`marketAccess +count × 0.01`。
  - `telegraphs`：`transportInfrastructure +count × 0.8`、`marketAccess +count × 0.005`。
  - `forts` / `navalYards`：**明确无完成副作用**（其效果即上面的小量军事产出）。
- **基础设施的过渡处理**：`canals`/`telegraphs` 在 F4 只走**旧的 `transportInfrastructure` 标量**（同铁路），**不实现**统一基础设施的供给/需求/线性 debuff（F5 才做，系数按 §4.1 的运河 2.0 / 电报 0.8 预留，见上）。这两类建筑在配方里 **`output` 为空**（成本中心）。
- **`INVESTMENT_DEMAND`**（F1 后一律 `steel`，无 `iron` 键——故电报用 `steel` 而非 §3.2 草表里的 `iron`）：学校 `{furniture 0.1, wood 0.05}`、运河 `{wood 0.2, steel 0.15, machinery 0.05}`、电报 `{steel 0.1, wood 0.15}`、要塞 `{steel 0.15, wood 0.15}`、船坞 `{wood 0.3, steel 0.2, machinery 0.1}`。
- **`BUILDING_OUTPUT`**（私人投资短缺信号）：五类**全为 `{}`**——与大学/官署一致，使**私人投资不会自动投建它们**（公共/军事工程由国有/AI 建造），从而不扰动 84 月基线与物价校准。
- **`COUNTRY_SEEDS`**：五类**起步 0 座**（`buildings()` 辅助函数把缺省键补 0），由 F7 再校准国别初值；这样 1836 基线与 `economy-recipe-calibration` 全部 gate 保持不变。
- **`deriveLabor`**：把五类按 labor 系数计入劳动需求（起步 0 座故基线不变，建成后生效）。
- **同步更新的消费点**：`types/index.d.ts` 的 `BuildingId`、`randomDecision` 的 build 候选、`engine/ai.ts` 的提示词与国别建筑行、`hooks/register.tsx` 的两个建筑 enum（`v3_cheat` / `v3_action`）、`engine/inspect.ts` 的建筑计数文案（17→22）。
- **不变量与 gate**：`tests/economy-recipe-calibration.test.ts` 全部 9 项 gate 绿（五类未进 `PRODUCTION_BUILDINGS` 生产利润带，其利润带留待 F7）；`C+I+G+NX===GDP`、金币守恒、60/120 月确定性、工资分摊恒等式均绿（新增 `tests/building-expansion.test.ts` 后 **359 pass / 0 fail**）。
- **可调数字（F7 统一校准）**：五类的 recipe/input、`COUNTRY_SEEDS` 初值、`completeBuilding` 副作用系数（学校识字、运河/电报交通）。
- **F4 解决的 §10 待定**：① 学校建成加识字率 → **是**（完成副作用 +0.002/座）；② `forts`/`navalYards` 产出 → 取「**小量产出**」（军械/机械），不新增军事结算点；③ `transportInfrastructure` 种子标量 → **保留**（F4 仍走标量，F5 再决定派生/丢弃）。
- **未做（刻意）**：统一基础设施供给/需求/debuff（F5）、`unlock` 校验（F6）、分批再校准（F7）。

### 7.6 F5 已落地的安排（World v11，名册不变）

F5 把「交通基础设施」升级为**唯一的国家级基础设施池**，并让它成为所有建筑的产出侧要求。实际落地：

- **统一方式：派生（derived），字段复用**。旧的 `econ.transportInfrastructure` 标量**保留字段名**
  （`ModifierStat` 也保留，仅显示名从「交通基础设施」改为「基础设施」），但语义从「累积的 0–100 交通量」
  改为**派生**：`level = clamp(100 × 供给/需求, 0, 100)`，由建筑座数每月重算（不是加 3/加 2 累加）。
  这样**不新增字段、不改存档形状，World 仍为 v11**。§10 的「种子标量丢弃还是保留」→ **丢弃**（由
  供给建筑直接决定起步值）。
- **供给**（`INFRA_SUPPLY`，每座/月）：`railroads 3.0`、`ports 1.5`、`canals 2.0`、`telegraphs 0.8`。
- **需求**（`BUILDINGS[*].infrastructureNeed`，每座/月）：见 §4.1 的已落地表；农场 **0**。
- **短缺 debuff**：`ratio = 供给 / max(ε, 需求)`（需求 ≤ 0 时 ratio = 1）；`乘数 = ratio ≥ 1 ? 1 : clamp(ratio, 0.35, 1)`。
  `computeProduction` 对**每一座建筑的产出**乘该乘数（含服务；工匠/人口等国家级项不乘）。旧的逐配方
  `gates.infrastructure` 标志与 `0.6 + 交通/160` 曲线**退场**（`PRODUCTION_GATE_SPECS` 里的曲线保留
  供配置注册表与 ModifierStat 使用，但无配方再引用它）。**只罚不奖**。
- **滞后与存储**：`computeProduction` 读**存储的** `level`（月末刷新，滞后一月，沿用 ADR 0022 纪律）。
  月末（`simulateCountry` 建筑折旧之后）与每次 `completeBuilding` 都调用 `refreshInfrastructure` 重算 level。
- **维护消耗**（`INFRA_UPKEEP`）：`吞吐维护 = 供给 × { wood 0.01, coal 0.015, services 0.02 }`，
  `行政维护 = (level/100) × { services 0.01 }`，作为**中间需求**并入 `computeDemand`（不反向门控供给）。
- **建设能力**：`constructionCapacity` 的旧 `0.6 + 交通/160` 改为统一乘数（营造所也是建筑）。
- **同步更新的读取点**：`engine/construction.ts`（`completeBuilding` 不再给铁路/运河/电报加标量，只保留
  市场接入副作用；`constructionCapacity`）、`engine/country.ts`（删除 `transportInfrastructure` 的独立折旧，
  改为按折旧后座数刷新）、`engine/economy.ts`、`engine/inspect.ts`（`economy` 分区新增统一基础设施一行 +
  `buildings` 每类显示 `基础设施需求`）、`engine/secretary.ts`、`hooks/register.tsx`、`view/panels.tsx` 的文案。
- **交易侧不变**：`transportInfrastructure` 仍被 `engine/trade.ts`（到岸价/航线运力/进口容量）与
  `engine/investment.ts`（铁路续建评分）读取，只是数值来自统一池。
- **不变量**：`tests/economy-recipe-calibration.test.ts` 全部 gate 绿（毛利带读 `buildingProfits` 快照，
  不含基建乘数，故不受影响）；`C+I+G+NX===GDP`、金币守恒、60/120 月确定性、工资分摊恒等式、鸦片门均绿
  （新增 `tests/infrastructure.test.ts` 后 **369 pass / 0 fail**）。新增测试覆盖：各供给来源、逐类需求求和、
  线性+下限 debuff、维护消耗、`transportInfrastructure` 统一/派生、60 月确定性、基线不误伤主要国。
- **可调数字（F7 统一校准）**：`INFRA_SUPPLY`、`BUILDINGS[*].infrastructureNeed`、`INFRA_UPKEEP`、`INFRA_MULT_FLOOR`。
- **F5 解决的 §10 待定**：① 字段命名 → **保留 `transportInfrastructure` 字段名**（避免形状断裂），显示名改「基础设施」；
  ② 种子标量 → **丢弃**，由供给建筑派生；③ 过剩奖励 → **不给**（只罚不奖）；④ 维护反噬供给 → **v1 不做**；
  ⑤ 基建供给的门控 → **常数**（不乘 tech/access）。

### 7.7 F6 已落地的安排（World v11，名册不变）

F6 给建筑加**前瞻 `unlock` 字段**并在 `build` 动作里执行，**行为保持**（当前全部解锁），World 仍为 v11。实际落地：

- **字段契约**（`engine/data.ts`）：新增导出类型 `BuildingUnlock = { techLevel?: number }` 与
  `BuildingDef`（`name`/`cost`/`note`/`unlock?`/`infrastructureNeed`）；`BUILDINGS: Record<BuildingId, BuildingDef>`。
  `unlock` 缺省、或 `techLevel` 为 `undefined` = **永远可建**。**本次 22 类建筑的 `unlock` 全部缺省**。
- **校验**（`engine/actions.ts` 的 `case 'build'`）：存在性检查之后、数量 clamp 之前，新增
  `const unlock = BUILDINGS[building].unlock; if (unlock?.techLevel !== undefined && country.tech.level < unlock.techLevel) → 拒绝`，
  拒绝文案为「`<国名> <建筑>尚未解锁（需要科技等级 N，当前 M）`」。既有检查（未知建筑、数量 1..5 clamp）不变。
- **只读展示**（`engine/inspect.ts` 的 `buildingsSection`）：去掉旧的内联 cast，直接读 `BuildingDef`；
  仅当 `unlock.techLevel` 有值时追加「需科技等级 N」。因当前无建筑设阈值，该分区输出**逐字不变**（末行说明改为陈述 F6 已接入）。
- **不变量**：`claude plugin test .` **377 pass / 0 fail**（369 + 新增 `tests/building-unlock.test.ts` 8 项）；`claude plugin validate .` 通过（仅存量告警）；World 仍为 **v11**，无版本提升。
- **新增测试**（`tests/building-unlock.test.ts`）：无 `unlock` 的建筑任意科技等级都可建；`unlock.techLevel > 当前` 被拒且不入队；
  `techLevel == 当前` 与 `> 当前` 均通过；`unlock = {}`（无 techLevel）不受门控；存在性检查先于解锁检查；
  现名册 22 类全部无阈值且每类可入队；`randomDecision` 的 build 候选仍产出可应用的决策；`newWorld().version === 11`。
- **未做（刻意）**：科技树（plan 0005）、任何真实解锁阈值、F7 分批再校准。

### 7.8 F7 已落地的安排（World v11，名册/结构不变）

F7 是一次 **numbers-only** 的分批校准（B-1 商品/配方 → B-2 基础设施 → B-3 造价/工期/建造点 → B-4
gate 扫尾），不改任何公式、结构或世界形状（仍 **v11**）。全部为数据面改动：

- **B-1 配方与基价**（`engine/data.ts`）：
  - **家具厂**砍材料单（`fabric 1.14→0.7、steel 0.3→0.18、machinery 0.18→0.1、wood 0.1→0.06、
    coal 0.18→0.1`）——改前产出价值 ≈ 投入价值，毛利仅 0.3%。
  - **兵工厂**提产出/砍投入（`arms 0.9→1.0`；`steel 0.5→0.36、machinery 0.3→0.18、iron 0.3→0.18、
    coal 0.18→0.12`）——改前毛利 1.0%。
  - **钢铁厂**改为**低机械、高煤**（`iron 3.5→3.2、coal 0.5→1.0、machinery 0.18→0.1`），使其对机械
    涨价的暴露变小、整段基线内毛利保持为正（改前 84 月仅 +1.9%）。
  - **机械厂**（`steel 0.5→0.55、machinery 0.82→0.8`）、**酿酒厂**（`grain 1.0→1.35`）、**奢侈品厂**
    （`fabric 1.14→1.5、output 0.49→0.48`）微调入带。
  - **要塞**（`arms 0.03→0.08`；`steel 0.1→0.02、wood 0.1→0.03`）、**船坞**（`machinery 0.1→0.14`；
    `steel 0.2→0.08、wood 0.2→0.08`）——改前两者为**负增值**配方，F7 定为可盈利的小量军事产出。
  - **基价**：`machinery 6.0→5.2`、`steel 2.2→2.6`（钢铁链在 84 月内保持正毛利；`steel>iron`、
    `steel<machinery` 关系不变）。
- **B-2 基础设施**：`INFRA_SUPPLY` 由 3.0/1.5/2.0/0.8 降到 **2.5/1.1/1.6/0.7**，并重定少数种子
  铁路/港口座数（QING 港 14→16；PRU 铁 6→7、港 10→12；RUS 铁 2→5、港 12→14；AUS 铁 4→7、港 5→9），
  使 1836 十国 ratio **全部 ≥1（1.10–2.30）**、84 月有国家自然跌破 1（QING/PRU/RUS/AUS），
  debuff **由产业增长触发**、不预触发、不触地板。
- **B-3 造价/工期/建造点**：核对无误，**未改**——重型 > 轻工 > 采掘（造价），铁路（8 月）/运河
  （6 月）最长，**无奇廉/奇慢项**；`CAPACITY_COST` 铁路 4 / 运河 3 最高，与工程量口径一致。
- **B-4 gate**（`tests/economy-recipe-calibration.test.ts` 新增 5 项）：逐族毛利带（24/48/84 月）、
  「每类产货建筑均为正毛利」、「新建才出现的工事（学校/要塞/船坞）建成后可盈利」、
  「基础设施：1836 不预触发 + 84 月有国家跌破 1 + 不低于 0.35 地板」、造价/工期/建造点排序。
- **实测（种子 9100，7 大国产量加权毛利，m24/m48/m84）**：农业 53.6/58.3/56.9；采掘 50.5–54.9；
  轻工 6.1–19.6；重工 2.2（钢铁 m84）–31.0（钢铁 m24）；服务 44.4–50.5；军事 53.3–59.0。
  84 月内**无商品钉在 0.25×/4× 超 3 个月**；grain/wood/coal/iron/fabric/machinery/steel **每 12 月
  两侧性 12/12**。
- **不变量**：`C+I+G+NX===GDP`、金币守恒、60/120 月确定性、鸦片门、工资分摊恒等式全部保持；
  世界版本仍 **v11**。`claude plugin test .` **382 pass / 0 fail**；`claude plugin validate .` 通过。

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
  → **F7 已定：取小量产出并校准为可盈利（`forts` arms 0.08、`navalYards` machinery 0.14，§7.8）。**
- **`lumberMills` 的 `outputModifier`**：复用 `mineOutput` 还是新增 `lumberOutput`？
- **基础设施字段命名**：`econ.transportInfrastructure` 保留 vs 改名 `econ.infrastructure`；
  `ModifierStat` 是否同步。建议字段改名、ModifierStat 保留（降政策改动）。
  → **F5 已定：字段名与 ModifierStat 均保留 `transportInfrastructure`（避免形状断裂），仅把显示名改为「基础设施」**。
- **`transportInfrastructure` 种子标量**：丢弃（由供给建筑决定）还是保留作底数？
  → **F5 已定：丢弃**，起步 level 由供给建筑（铁路/港口/运河/电报）派生。
- **过剩奖励**：基础设施供给 > 需求是否给生产奖励（本 ADR 只罚不奖）。
  → **F5 已定：不给**（只罚不奖）。
- **维护反噬**：原料/服务短缺是否拖累基础设施供给与水平。
  → **F5 已定：v1 不做**，维护仅是中间需求。
- **基础设施供给是否受市场接入/科技门控**：本 ADR 的供给系数是常数；是否乘 tech/access 待定。
  → **F5 已定：常数**，不乘 tech/access。
- **种子座数分配**：三矿与七工的初始分配、新建筑的国别初值（可按 techLevel/region 给）。
  → **F7 已定：工业/采掘座数沿用 F2/F3 的守恒分配；新建筑仍起步 0 座（私人不投建）；
  仅重定少数种子铁路/港口座数，使 1836 基础设施 ratio 不预触发（§7.8）。**
- **学校是否在建成时加识字率/教育效果**：本文只让其产出 `services`；加 side effect 需改
  `completeBuilding`。
- **`unlock` 与 plan 0005 的接口**：科技树里「解锁」是节点还是等级门槛，留给 0005。

## 11. 与 plan 0005 / 0009 的关系

- `0005-tech-tree.md`：本计划只给建筑加前向兼容的 `unlock` 占位与校验，不实现科技树。
- `0009-config-refactor.md`（ADR 0024）：本计划新增的 `INFRA_SUPPLY`/`infrastructureNeed` 等
  常数，先与现有配置同处 `engine/data.ts`；0009 落地时按同一分层规则迁到 `engine/config/`。
