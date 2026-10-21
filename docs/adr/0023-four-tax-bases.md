# 四税基税制（B4）

- Status: accepted（World v10）
- Fixes: PT-031 的税制侧（`税入 = GDP × 税率 × 征收效率` 循环论证）
- Depends on: `docs/plans/0008-economy-remake.md` §4、ADR 0006（国库净资产）、ADR 0007（债务压力）、ADR 0021（建筑配方与逐建筑利润）、ADR 0022（利用率与利润投资）

## 背景

旧税制只有一条公式：`税入 = GDP × 税率 × 0.45 × 征收效率 × 合规`。GDP 是**产出侧核算结果**，拿它当税基是循环论证，而且掩盖了「谁在纳税、什么在增长」。B4 把税拆成四个真实税基，并让 GDP 退回派生指标：**永远不作税基**。

## 决定

### 1. 四税基与税基量

| 税基 `TaxBaseId` | 税基量（`Economy.taxBaseQty`） | 承担者 |
| --- | --- | --- |
| `land` 土地税 | `resources.farmland × LAND_VALUE_PER_UNIT` | 地主 / 农业 |
| `profit` 企业所得税 | `Σ_建筑 max(0, buildingProfits[b].profit)`，**逐建筑算后累加** | 资本 / 经营体 |
| `consumption` 消费税 | `Σ_{g∈CONSUMER_GOODS} 最终消费量[g] × 价格[g]` | 消费者 |
| `tariff` 关税 | `lastImportBill + lastExportRevenue`（税率 `econ.tariff` / `exportTariff`） | 进出口商 |

- `land`：`LAND_VALUE_PER_UNIT = 4`（`engine/fiscal.ts`，导出）。farmland 是 0..100 的静态禀赋，乘 4 后让默认 2% 土地税的量级与其他税基相当；不是地价的精确建模，是量纲常数。
- `profit`：只有**正利润**计入；逐建筑类型的贡献保留在 `econ.buildingProfits`（ADR 0021）里，`v3_inspect economy` 可读。**多发展 → 利润↑ → 税↑**。
- `consumption`：只取 Stone-Geary 的**最终消费**量（`computeDemand` 的 `consumer` 块），按当月价估值；**中间投入与投资/政府购买不计入**。这是去重的核心。
- `tariff`：沿用 `settleTrade` 已算出的进出口税（border duty），不做二次评估。

`Economy` 的 `taxes: TaxRates`（`Record<TaxBaseId, number>`，百分比）取而代之旧的单一 `taxRate`。`taxes.tariff` 是 `econ.tariff` 的镜像（贸易清算仍读 `econ.tariff` / `exportTariff`，ADR 0009/0014 不变）。

### 2. 税额与征收效率

统一式（`engine/fiscal.ts` `taxBaseRevenues`）：

```
税额(base) = 税基量(base) × 税率(base)/100 × 征收效率 × 合规(base) × 债务削减
```

```
征收效率 = clamp(0.35 + 官僚效能/200 + 合法性/400, 0.3, 1.1) × taxEfficiency 修正
合规(base) = 税率 ≤ 25 ? 1 : clamp(1 − (税率−25)×0.015, 0.45, 1)   // 逐税基侵蚀
债务削减   = 1 − debtPressure.incomePenalty                          // ADR 0007
```

`income.taxes = land + profit + consumption + tariff`，逐基明细在 `FiscalLedger.income.taxBases`。

**关税例外**：关税在边境征收，`settleTrade` 给出的 `tariffRevenue` 已是应征额，故 `税基.tariff 税额 = tariffRevenue × 债务削减`（不再乘征收效率与合规）。这保住了既有的金币守恒恒等式与 `trade-gold` 测试（`computeEconomy(..., {tariffRevenue})` 使收入恰好增加该额）。

### 3. 税负归属与宏观闭环（避免重复计入）

- **承担者**：土地税归地主、企业税归资本、消费税归消费者、关税归进出口商。
- **私人税负** = `土地 + 企业 + 消费`（`privateTaxBurden`，**不含关税**）。`computeDemand` 的可支配收入按此扣减（替代旧 `taxTake`），并复用**上月存储**的 `econ.taxBaseQty` 保持一个月滞后——与工资/利润的滞后同构，避免同月环。
- **不重复征税**：中间投入只在最终消费/利润环节被征；关税在边境一次征清，不再计入私人可支配收入的扣减；企业税按**净经营利润**，不另设营业额税。因此税不再与 GDP 双重挂钩，宏观支出法恒等式 `C+I+G+NX === GDP` 不受影响。

### 4. 与 GDP 解耦

`incomeParts` 不再接受 GDP 参数；GDP 仅用于展示与债务率。`v3_inspect fiscal` 显示每基的**税基量 / 税率 / 税额**，`v3_status` 与面板显示四基税率与各基税额。

### 5. 初始税率（1836）

`engine/data.ts` `DEFAULT_TAX_RATES = { land: 2, profit: 2, consumption: 3, tariff: 各国种子 tariff }`。

校准（seed 7，10 国，1836+3 月）：新四税基合计 ≈ **99.3 金/月**，旧「GDP 比例税 + 关税」合计 ≈ **99.8 金/月**（≈0.995×，无财政冲击）；占 GDP 约 **5%–7%**。单国结构不同（旧制是 GDP 比例，新制按真实税基），故个别国家有离差，留待 B5 随物价/配方一并再平衡。

### 6. 接入点

- `v3_action tax` → `{ base, rate }`（`base ∈ TaxBaseId`，`rate` 0..60）。缺省 `base` 返回四基税菜单；`base='tariff'` 设 `econ.tariff`（`v3_action tariff` 仍可分开设进出口税率）。
- AI `randomDecision` 的偿债加税：**确定性**地选当前税额**最低**的税基加 2%（无 RNG，tie-break 按 `TaxBaseId` 顺序）。
- 民怨 `radicalPressure` 用三个内部税基中的**最高税率**（阈值 5）替代旧单一税率。
- 版本 9 → **10**；旧档按 ADR 0005 拒绝。

## 代价与权衡

- 一次**行为变更**：税率菜单、收入构成、可支配收入口径都变。与 GDP 脱钩后，税不再随产出自动涨落，AI/玩家须显式调整税基。
- `Σ buildingProfits.profit` 与宏观利润 `realGdp×(1−laborShare)` 不是同一口径（逐建筑利润含中间品重复计价），故利润税基大于宏观利润；这鼓励扩张，符合设计意图，已在 ADR 0021 说明。
- `tariff` 镜像与 `econ.tariff` 需同步；`tax` 与 `tariff` 两个 action 都写这两个值。

## 不变量（全部保持）

- `C+I+G+NX === GDP`；全部金币守恒恒等式；贸易路线金币恒等式。
- 60/120 月确定性；鸦片危机门（§4.1 的 ≥2 单位/月、≥20% 来自英国）。
- 关税到岸价、`settleTrade` / `deriveBalance` / 路线逻辑未改。

## 测试

- 新增 `tests/tax-bases.test.ts`：土地税基 = farmland × 常数；企业税基 = 逐建筑正利润之和（保留逐类贡献）；消费税基只用最终消费（抬高中间品需求不改变它）；内部税基税额 = 税基量 × 税率 × 征收效率 × 合规；改动单一税率只改该基税额；关税税额 = 既有 duty。
- `tests/fiscal.test.ts` 的「税是 GDP 份额」断言按设计失效，迁移为「税来自四真实税基、与 GDP 无关」。
- `tests/economic-loop-*.test.ts` 的「高税侵蚀税基」改为逐基（profit 40% vs 60%）。
