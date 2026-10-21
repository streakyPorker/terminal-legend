# 建筑配方与逐建筑经营利润（配方单一真源）

- Status: accepted（World v9）
- Fixes: PT-031 的建筑侧（配方缺位 / 逐建筑利润率缺位）。税制四税基部分见后续 B4，本 ADR 不覆盖。
- Depends on: `docs/plans/0008-economy-remake.md`、ADR 0005（不做存档兼容）、ADR 0010/0012/0013（营造所与建造能力）

## 背景

原经济有两套互不一致的产出来源：

- `BUILDING_OUTPUT`（`engine/data.ts`）是一张**从未被生产读取**的总产出表；
- 真正生效的系数**硬编码**在 `computeProduction`（`engine/sim.ts`）里。

中间投入则是一段**国家级、按建筑数拍死**的块（`computeDemand`），不与产出建筑挂钩。
营造所的建造点门控另有独立的 `WORKSHOP_INPUTS` 字面量。利润是全国统一
`realGdp × (1 − laborShare)`，无法回答“这类建筑按当前物价赚不赚钱”。

PT-031 记录了这些问题。

## 决定

新增一份声明式配方表 **`BUILDING_RECIPES: Record<BuildingId, BuildingRecipe>`**
（`engine/data.ts`），作为建筑**产出**与**中间投入**的**单一真源**。世界版本升到 **v9**。

```ts
type RecipeIO = Partial<Record<GoodId, number>>
type RecipeGates = {
  tech?: boolean            // 1 + 科技等级 × 0.07
  infrastructure?: boolean  // 0.6 + 交通 / 160
  access?: boolean          // 0.55 + 市场接入 × 0.9
  industrial?: boolean      // clamp((煤 + 铁 禀赋因子) / 2, 0.7, 1.3)
  resource?: ResourceId[]   // 预留（B1+B2 未使用）
}
type BuildingRecipe = {
  output: RecipeIO          // 每座每月满负荷产出（未过门控）
  input: RecipeIO           // 每座每月中间投入
  labor: number             // 每座用工，用于劳动需求与工资分摊
  gates?: RecipeGates       // 施加到该建筑全部产出上的乘数
  outputGates?: Partial<Record<GoodId, RecipeGates>>  // 副产品的按货物覆盖
  outputModifier?: ModifierStat  // 建筑类别产出修正入口（farmOutput/mineOutput/factoryOutput）
}
```

### 配方表（v9 初值，等于 B1 之前硬编码的系数）

| 建筑 | output（每座/月） | input（每座/月） | labor | 门控 |
| --- | --- | --- | --- | --- |
| farms | grain 0.30、wood 0.04、opium 0.004 | — | 0.3 | tech+infra+access（wood 除外） |
| mines | coal 0.5、iron 0.42、wood 0.04 | — | 0.6 | tech（wood 除外） |
| factories | fabric 0.6、clothes 0.38、liquor 0.2、furniture 0.22、machinery 0.18、arms 0.07、luxury 0.035 | grain 1.0、coal 0.35、iron 0.4、fabric 0.45、wood 0.2、machinery 0.18 | 1.0 | tech+industrial（liquor 仅 industrial） |
| railroads | — | iron 0.5、wood 0.4 | 0.2 | — |
| ports | — | — | 0.4 | — |
| universities | services 0.2 | — | 0.2 | — |
| barracks | arms 0.05 | — | 0.3 | — |
| offices | services 0.8 | — | 0.1 | — |
| workshops | —（建造点，sim.ts 特判） | wood 1、grain 0.6、iron 0.3 | 0 | — |

要点：

- **`output` 只放逐建筑系数**。人口派生的全国项（手工业者：成衣 +0.035、酒 +0.01、家具 +0.006、
  服务 +0.01；总人口服务项）与鸦片的国家 `outputFactor` 不是逐建筑配方，仍留在
  `computeProduction`。
- **门控按建筑声明，副产品按货物覆盖**（`outputGates`）。历史上农场的木材、矿场的木材不受
  科技/交通/接入门控，工厂的酒类不含科技项——这些差异用按货物的门控覆盖表达，从而
  **逐位复现**旧结果。
- `WORKSHOP_INPUTS` 不再单独定义，改为 `BUILDING_RECIPES.workshops.input` 的派生别名，
  `constructionCapacity` 的门控口径不变。

### 行为保持（B1+B2 的不变量）

B1+B2 **只做结构迁移，不动任何数值**：

- `computeProduction` 改为**只读** `BUILDING_RECIPES`，删除全部硬编码系数；对 4 个种子 × 6 个月 ×
  10 国做 A/B，产出与旧公式**逐位相同**。
- `computeDemand` 的中间投入块改为 `Σ_建筑 count × recipe.input`（人口项与军械项按旧口径保留），
  与旧块数值一致（浮点加法结合序差异量级 ≤1e-9）。
- `BUILDING_OUTPUT` **不再是生产来源**，但**原样保留**作为私人投资评分代理
  （`investmentScore`）。派生自配方会改变 `hasOutput`（官署/大学会凭空多出 `services`）与评分权重，
  从而改变私人投资决策——那属于 B3，B1+B2 不得触碰。B3 用 `buildingProfits` 替换该代理后即退役此表。
- 工程量、建造队列、贸易/金币守恒、地理不变量均未改动。

### 逐建筑经营利润（派生快照）

`Economy` 新增 `buildingProfits: Record<BuildingId, BuildingProfit>`，每月在 `computeEconomy`
末尾用**本月**物理产出与**本月**价格计算并存快照（与 `gdpComponents`/`wages` 同模式）：

```ts
type BuildingProfit = {
  revenue: number          // Σ output_g × price_g × effectiveCount_b
  inputCost: number        // Σ input_g × price_g × effectiveCount_b
  wages: number            // totalWages × (labor_b × count_b / Σ labor × count)
  profit: number           // revenue − inputCost − wages
  utilization: number      // 0..1；B1+B2 恒为 1，B3 由利润驱动
  profitPerBuilding: number // profit / max(1, count)
}
```

- `effectiveCount_b = effectiveCount(count_b)`（`count^0.98`；B3 再乘 `utilization`）。
- **工资分摊规则**：按 `labor_b × count_b` 的占比，把全国工资 `realGdp × laborShare` 分到各类型；
  占比之和为 1，故 `Σ buildingProfits.wages === 全国 wages`（精确）。B5（plan 0008 §5）把这条规则
  抽成配置常量 **`WAGE_ALLOCATION`**（`engine/data.ts`）：`basis ∈ {'labor'|'valueAdded'|'capitalPlusLabor'}`
  加可选 `weights`；`'labor'` 即本文原规则（逐位复现），B5 默认改用 `'valueAdded'`（见 plan 0008 §5.1）。
  **注**：该常量在 plan 0009（ADR 0024）的配置分层落地时会迁移到 `engine/config/economy.ts`，
  形状不变。
- **毛利率** = `profit / revenue`（`revenue > 0` 时）。
- **关系说明**：`Σ profit_b = Σ(revenue_b − inputCost_b) − 全国 wages`。它按**市场价、毛产出**
  估值，与宏观 `realGdp × (1 − laborShare)`（按基期价、增值口径）不是同一量，通常更大；
  测试只用**宽松带**断言量级合理，不强行对齐。
- B1+B2 中该快照**纯信息，无数值消费**：不改变任何决策、GDP、投资或贸易结果。

### 暴露

`v3_inspect economy` 增列逐建筑的 `产出 − 投入 − 工资 = 利润（毛利率，金/座）`，仅供阅读。

### 世界版本

升到 **v9**（`createWorld` 的 `version`、`save.ts` 的 `CURRENT_WORLD_VERSION`）。
按 ADR 0005 不做兼容，旧 v8 存档直接拒绝；`normalizeWorld` 对缺 `buildingProfits` 的同版本存档补零。

## 代价

- `outputGates` / `outputModifier` 是为**不改变旧数值**而加的字段；表格略显冗长，但把“哪类建筑
  受哪个乘数门控”显式化了，反而更可读。
- 配方表与 `BUILDING_OUTPUT`（投资评分代理）暂时并存，需靠注释与 ADR 说明；B3 退役后者后收敛。
- `buildingProfits` 与宏观利润口径不同，读者须理解“毛经营盈余”与“增值利润”的区别。
