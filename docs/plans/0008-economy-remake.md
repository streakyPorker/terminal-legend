# 经济系统 remake（配方经济 · 四税基 · 贸易路线）

- Status: proposed（当前最高优先级；0002 事件树与 0005 科技树 v8 暂缓）
- Depends on: `0003-economic-loop.md`、`0004-trade-diplomacy.md`、ADR 0005（不做存档兼容）、ADR 0006–0019、ADR 0020（贸易路线，本系列第①步）
- Scope: 把「抽象产出 + GDP 比例税」换成「逐建筑显式配方 + 要素/消费/贸易税基」。世界版本升到 **v9**。
- 来源：试玩 PT-031（`docs/playtest-issues.md`）＋玩家口述：
  - 「每类建筑都会消费指定数值的产品，产出指定数值的产品，这些产品的价格决定了这类建筑是否能够赢利，这要求你平衡各类物价与建筑产出的数值」。
  - 「建筑背后的运作实体 + 人头税 + 消费品消费税 + 关税是四大税基，不要基于 GDP 算比例了，按着四种数值来算税」。
  - 追加澄清：「人头税其实就是土地税 + 利润税」；「建筑贡献的企业所得税要单独算，这鼓励各国多发展」；「GDP 和税不硬挂钩，GDP 也是算出来的」。

## 0. 现状诊断（已核实）

| 现象 | 事实 | 位置 |
| --- | --- | --- |
| 建筑无配方 | 建筑只有总产出系数；真正生效的系数硬编码在 `computeProduction`，与 `BUILDING_OUTPUT` 表**两套源头不一致** | data.ts:176-194 vs sim.ts:212-283 |
| 投入不对账 | 中间投入是国家级、按建筑数拍死的块，不与产出建筑挂钩 | sim.ts:703-720 |
| 无逐建筑利润率 | 利润是全国 `realGdp×(1−laborShare)` | sim.ts:870-875 |
| 税按 GDP 比例 | `税入 = GDP × 税率 × 征收效率`；GDP 是产出侧核算结果，做税基是循环论证 | fiscal.ts:222-247 |
| 唯一真配方 | 只有营造所的建造点投入受门控 | WORKSHOP_INPUTS sim.ts:289-293 / constructionCapacity sim.ts:405-436 |

## 1. 目标与非目标

**目标**
- 每类建筑有**一份声明式配方**（投入 goods × 数量、产出 goods × 数量、用工），成为生产/消费/利润率的**单一真源**。
- 产出受投入可得性门控；每类建筑按月算出**经营利润** `Σ产出×价 − Σ投入×价 − 工资`；利润驱动私有投资与产能闲置/萎缩。
- 税收从**四税基**计算：土地税、企业所得税（**逐建筑单独算**）、消费品消费税、关税；GDP 只作派生产出指标，永不作税基。
- 全场可解释：`v3_inspect economy/market/fiscal` 能看到每类建筑的利润、每税基的税基量与税额。

**非目标**
- 不做「一建筑一实例」的细粒度：建筑仍是按类型的计数（`econ.buildings: Record<BuildingId, number>`）。利润率按**建筑类型**计算。
- 不做多币种/汇率、不做每国独立科技树、不做 0002 事件树。
- 不做建筑子类型拆分（如「纺织厂/机械厂」）：先按「一类建筑 = 一个多产出配方包」；子类型拆分为后续 v10 备选。

## 2. 数据模型（World v9）

### 2.1 `BUILDING_RECIPES`（单一真源，engine/data.ts）

```ts
export type RecipeIO = Partial<Record<GoodId, number>>

export type BuildingRecipe = {
  /** 每座每月满负荷产出。 */
  output: RecipeIO
  /** 每座每月满负荷投入。 */
  input: RecipeIO
  /** 每座用工（万人），用于劳动需求与工资分摊。 */
  labor: number
  /** 参与何种乘数门控（科技/基建/市场接入/资源禀赋）。 */
  gates?: { tech?: boolean; infrastructure?: boolean; access?: boolean; industrial?: boolean; resource?: ResourceId[] }
}

export const BUILDING_RECIPES: Record<BuildingId, BuildingRecipe>
```

- `computeProduction`（sim.ts:212-283）改为**只读表**，删除硬编码系数；`BUILDING_OUTPUT` 表废弃（或改为从配方派生）。
- 中间投入块（sim.ts:703-720）**删除**，改为按建筑数汇总配方 `input`。
- `WORKSHOP_INPUTS` 并入配方（营造所：投入 wood 1 / grain 0.6 / iron 0.3，产出为建造点，`output` 空、特判）。
- 初始配方（草案，待 §5 校准）：农场 `{grain:0.30, wood:0.04}`、矿场 `{coal:0.5, iron:0.42, wood:0.04}`、工厂投入 `{coal,iron,wood,grain}` 产出 `{fabric,clothes,liquor,furniture,machinery,arms,luxury}` 一篮、兵营 `{arms:0.05}` 投入铁/煤、官署产出 `services`、铁路/港口/大学产出空（基建/知识，特殊处理）。

### 2.2 逐建筑利润（派生但存快照）

```ts
export type BuildingProfit = {
  revenue: number
  inputCost: number
  wages: number
  profit: number
  /** 上月实际开工率 0..1（受投入与利润门控）。 */
  utilization: number
  /** 每座每月利润，供私有投资与闲置判断。 */
  profitPerBuilding: number
}
// Economy 新增：
buildingProfits: Record<BuildingId, BuildingProfit>
```

- 每月重算后**存快照**（与 `gdpComponents`/`wages` 同模式），供 AI 决策、下月投资与 `v3_inspect` 读取，保证月内一致。

### 2.3 税菜单（Economy）

```ts
export type TaxBaseId = 'land' | 'profit' | 'consumption' | 'tariff'
export type TaxRates = Record<TaxBaseId, number>   // 百分比
// Economy 新增：taxes: TaxRates；移除单一 taxRate
// tariff/exportTariff 保留现状（关税税基的税率）
```

- `v3_action tax` 扩展为 `{ base, rate }`（`base ∈ TaxBaseId`）；缺省返回税菜单。
- 关税沿用 `econ.tariff` / `econ.exportTariff`。

### 2.4 贸易路线（见 ADR 0020）

- `WorldState.tradeRoutes: TradeRoute[]`（①已实现）。②不重做路线，只在配方/税制下重新校准路线收益。

## 3. 生产与利润率算法

月度顺序（在 `computeEconomy` 内，保持 C+I+G+NX=GDP 恒等式）：

1. **物理产出**：`production[b] = 配方.output × 有效座数 × 门控乘数`；有效座数 = `count × utilization_prev`（对工厂再乘 `industrial` 资源因子）。**不读当月价格**，避免循环。
2. **投入门控**：`need[b] = 配方.input × count`；`inputRatio = min_g(available[g] / need[b][g])`；`production[b] ×= clamp(inputRatio,0,1)`。
3. **需求**：`computeDemand` 保留最终需求（消费/投资/政府），**中间投入进入 demand 用于定价与贸易**（同今日 sim.ts:703 的口径），但**不计入 GDP**。
4. **价格**：沿用 `target = basePrice × clamp(√(demand/supply),0.35,3)`，30% 平滑（sim.ts:798-809）。
5. **逐建筑利润**：用本月物理产出与本月价格（产出已定，价格已定，无环）：
   `revenue[b] = Σ output_g × price_g × effCount`；
   `inputCost[b] = Σ input_g × price_g × effCount`；
   `wages[b] = totalWages × (labor(b)·count_b / Σ labor·count)`（`totalWages` 仍来自 GDP 分配，保持宏观口径稳定）；
   `profit[b] = revenue − inputCost − wages[b]`。
6. **GDP**：仍为 C+I+G+NX 按基期价估值（sim.ts:811-831），**不含中间投入**，恒等式不变。
7. **utilization 反馈（下月）**：
   - `target = profitPerBuilding > 0 ? 1 : UTIL_IDLE_FLOOR`（如 0.5）；
   - `utilization += (target − utilization) × 0.25`（确定性平滑，一阶滞后破环）；
   - 深度亏损时加速折旧：`decayExtra = clamp(−profitPerBuilding/(revenue+1), 0, MAX_DECAY)`，叠加到 `DEPRECIATION_PER_MONTH`。
8. **私有投资**：`investPrivateCapital` 的候选评分改为 `profitPerBuilding / 摊销建设成本`；只投 `> hurdle` 者（替换启发式 `investmentScore` sim.ts:1246-1276）。

**校验**：`wages + profits ≈ realGdp` 允许带内偏差（价值增值闭合），新增测试断言 `∈ [0.5,1.5]×realGdp`；逐建筑利润之和与宏观利润的关系在 `v3_inspect economy` 中显式说明。

## 4. 税制算法（四税基）

统一式：`税收(base) = 税基量(base) × 税率(base)/100 × 征收效率(官僚/合法/合规) × 债务削减`。

| 税基 | 税基量 | 承担者 | 说明 |
| --- | --- | --- | --- |
| **土地税** land | `resources.farmland × 地价系数` | 地主/农业 | 禀赋稳定；政策可调税率 |
| **企业所得税** profit | `Σ_建筑 max(0, buildingProfit.profit)`，**逐建筑算后累加** | 资本/经营体 | 多发展→利润↑→税↑；`v3_inspect` 按建筑类型拆出各自贡献 |
| **消费税** consumption | `Σ_{消费品} 最终消费量 × 价格`（**仅最终消费，不含中间投入**） | 消费者 | 用 Stone-Geary 的消费量，不用总 demand |
| **关税** tariff | 进出口货值（含贸易路线） | 进出口商 | 沿用现有两税率 |

**去重规则（必须遵守）**
- 中间投入只在最终消费/利润环节征税，买入时不征。
- 进口在边境征关税，消费税按 `consumer_qty × (1 − importShare)` 近似避免对进口重复征。
- 企业所得税按净经营利润，不再另设「建筑经营额税」，避免与企业税重复。

**征收效率**：`collection = clamp(0.35 + 官僚效能/200 + 合法性/400, 0.3, 1.1)`，受 `taxEfficiency` 修正。逐税基合规率随该基税率升高而衰减（沿用 `taxCompliance` 思路，改为按 base）。

**接入点**
- `engine/fiscal.ts` `incomeParts` 重写为按税基累加；`IncomeParts` 内部分项扩展（fiscal ledger 为引擎内部结构，非 `types` 契约，改动面可控）。
- `sim.ts` 消费可支配收入（现 sim.ts:667 的 `taxTake`）改为扣除人头/利润相关个人负担；消费税作为价格楔子体现在购买力上。
- AI `randomDecision`（sim.ts:3394 附近加税逻辑）改为按 base 调整。
- `v3_action tax`、`v3_status`、`v3_inspect fiscal` 全部改走税菜单。

## 5. 数值校准方法（本计划的关键）

> 用户明确：「关键是要调整经济数值」。价格是**市场价**（向 basePrice × √(d/s) 收敛），所以「自洽」定义在 **basePrice 中心**上。

**方法（确定性，非运行时迭代）**
1. 取一个参考运行点：10 国种子的平均建筑数/资源，或一个合成「前沿国」。
2. 原料（grain/wood/coal/iron/opium）设定根基价。
3. **拓扑序解价**（货物图无环：原料 → fabric/machinery → clothes/furniture/luxury/arms）：
   `price_g = (Σ 投入成本 at 上游价) × (1 + 目标毛利) + 工价分摊`，逐层解出。
4. 目标是让每类建筑在参考点有**正、且合理**的利润率（工厂 5–20% 区间），形成真实信号。

**Gate（新增 `tests/economy-recipe-calibration.test.ts`）**
- 84 月基线内没有商品长期钉在 0.25×/4× 价格上下限（>3 个月连续）。
- grain/wood/coal/iron/fabric/machinery 每 12 个月至少各有一次全局 bid>0 且 offer>0（扩展 economy-calibration.test.ts）。
- 主要国家在开局与第 24 月，至少有一类生产建筑 `profit>0`。
- 没有「所有国家永久亏损」的建筑类型。
- `wages+profits ∈ [0.5,1.5]×realGdp`；`C+I+G+NX == GDP`（已有）。
- 大清第 12 月至少出口一种商品 ≥5 金/月（沿用 E1 目标）。
- 工厂毛利落在 5–20% 带内（信号有意义、不可套利）。

## 6. 工作包与顺序

| 包 | 内容 | 破坏的既有测试 |
| --- | --- | --- |
| **B1（v9 结构）** | 加 `BUILDING_RECIPES`；`computeProduction` 只读表；删硬编码系数与中间投入块；并 `WORKSHOP_INPUTS`；升 v9 | trade.test 版本断言、各基线（数值变化） |
| **B2（利润率）** | 加 `buildingProfits`（算+存+inspect），不改决策 | inspect.test 新增；基线应不变 |
| **B3（决策联动）** | 私有投资改用利润率；加 utilization 门控与深度亏损折旧 | economic-loop 投资相关、60/84 基线 |
| **B4（税基）** | 移除 `taxRate`，加 `taxes`；重写 `incomeParts`；`v3_action tax`；fiscal/sim/thresholds/inspect | fiscal.test「税是 GDP 份额」、经济循环高税侵蚀 |
| **B5（再校准）** | 调 `GOODS.basePrice` 与配方系数；加校准测试；收敛 PT-002/PT-001 | economy-calibration、trade 基线 |
| **B6（文档）** | ADR 0021–0023、README/GLOSSARY、playtest 状态更新 | — |

- ①（贸易路线，ADR 0020）先于本计划落地；B5 再校准会顺带重定路线收益。
- 每个包独立提交、测试全绿再进下一个。

## 7. 验收

- 每类建筑的投入/产出/利润率能在 `v3_inspect market/economy` 看到，账本能解释「为什么变了」。
- 四税基各自可追溯；`v3_inspect fiscal` 显示每基税基量、税率、税额。
- §5 的 gate 测试全绿；`claude plugin test .` 全绿、`claude plugin validate .` 通过。
- 世界版本 v9；旧档按 ADR 0005 拒绝。

## 8. 风险

| 风险 | 缓解 |
| --- | --- |
| 循环定价（价→利润→产能→供给→价） | utilization/投资读**上月**快照，物理产出不读当月价；一阶滞后 |
| 金币/收入重复计算 | 中间投入不进 GDP；消费税只对最终消费；企业税按净利；进口关税与消费税用 importShare 近似去重 |
| 破坏 trade-gold 金流守恒 | 配方不改变 `settleTrade`/`deriveBalance` 口径；只改供给/需求与税基 |
| PT-002 消费品过剩复发 | 用配方让工厂吸收中间品、或下调消费品产出系数；以 bid/offer gate 判定，不靠声明 |
| 基线大面积漂移 | 每包独立重定基线；确定性与绝对额断言分开处理 |
| 一配方装不下多产出 | 采用「一类建筑 = 多产出配方包」；子类型拆分留 v10 |

## 9. 暂缓

- `0002-agent-event-trees.md`：多国交互与事件树，暂停。
- `0005-tech-tree.md`：科技树 v8，等本计划 B5 校准后再做。
- 建筑子类型（纺织厂/机械厂等）拆分、专卖/厘金/印花/吨税等扩展税基：列为 v10 备选。
