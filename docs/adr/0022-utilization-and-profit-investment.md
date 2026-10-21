# 利用率与利润驱动的私人投资（B3 决策联动）

- Status: accepted（World v9，增量规则，不升版本）
- Fixes: PT-031 的决策侧（逐建筑利润已由 ADR 0021 计算，但无人消费）
- Depends on: `docs/plans/0008-economy-remake.md`、ADR 0017（私人投资节奏）、ADR 0021（建筑配方与逐建筑利润）

## 背景

ADR 0021（B1+B2）加入了逐建筑经营利润快照 `econ.buildingProfits`，但它是**纯信息**：
利用率恒为 1，没有任何决策读取。私人投资仍用启发式 `investmentScore`（基于
`BUILDING_OUTPUT` 的短缺代理），产能一旦建成便永远满负荷生产——**「这类建筑按当前物价
赚不赚钱」不产生任何后果**。B3 把这张快照接进经济：亏损的产能闲置并萎缩，私人资本只
投有利润的产能。

## 决定

### 1. 利用率门控，带一个月滞后

`computeProduction` 逐建筑类的产出乘以其**上月存储**的
`country.econ.buildingProfits[b].utilization`：

```
有效座数[b] = effectiveCount(count_b) × utilization_prev[b]
```

在 `computeEconomy` 末尾，用**本月**利润写入**下月**的利用率：

```
target       = profitPerBuilding > 0 ? 1 : UTIL_IDLE_FLOOR
utilization  = clamp(utilization_prev + (target − utilization_prev) × UTIL_SMOOTHING, 0, 1)
```

因此本月写入快照的 `utilization` 正是下月生产读取的值。**价格 → 利润 → 产能 → 价格**
的环永远滞后一个月，不会在同月闭合——这是确定性与稳定性的关键不变量（同 ADR 0021 的
产出不读当月价）。

常数（`engine/sim.ts`，导出）：

```
UTIL_IDLE_FLOOR = 0.5    // 亏损类目闲置下界（不会归零，价格回升可复活）
UTIL_SMOOTHING  = 0.25   // 一阶平滑，每月向目标走 1/4
```

### 2. 深度亏损的额外萎缩

月末折旧步骤在原 `DEPRECIATION_PER_MONTH`（0.0015/月）之上，按每座亏损额叠加一次
**确定性的额外折旧**，上限 `SHRINK_MAX`：

```
deepLoss = clamp(max(0, −profitPerBuilding) / (revenue + 1), 0, SHRINK_MAX)
count[b] = max(0, count[b] × (1 − DEPRECIATION_PER_MONTH − deepLoss))
```

```
SHRINK_MAX = 0.02        // 每月额外折旧上限（叠加后最坏每月 −2.15%）
```

无 RNG；`max(0, …)` 保证计数永不为负。亏损越深萎缩越快，直到价格或成本回到盈亏平衡。

### 3. 利润门槛约束的私人投资

`investPrivateCapital` 的候选类型必须 **`profitPerBuilding > 0`**（**绑定条件**）才会被
建造；不盈利的类型既不扩张也不更新（renewal）。在此门槛之上，仍用既有的短缺信号
`investmentScore` 在**已盈利**的类型间分配投资，并以 `profitPerBuilding / 建设资本成本`
（`returnOnCapital`）与建筑 id 作为确定性 tie-break。ADR 0017 的节奏
（`MAX_PRIVATE_PROJECTS=3`、`PRIVATE_START_INTERVAL=2`）原样保留。

- **为何不使用纯利润排序**：以纯利润率排序会让所有国家的私人资本涌向当期利润率最高的
  矿场，`GBR` 的农场（相对优势即鸦片产地）被挤出，48 个月窗口内 QING 的鸦片进口跌破
  计划 §4.1 的 ≥2 单位/月门槛，并连带打掉 PT-003 的机械贸易链路。因此本 ADR 采用
  「利润门槛绑定 + 短缺信号分配」：**只建盈利产能**（B3 的核心），同时保住比较优势与
  贸易结构。纯利润率的再平衡属于 B5。
- `investmentScore` 因此**保留导出、语义不变**（`tests/economic-loop-*.test.ts` 的
  短缺/过剩断言不动），并被重新定位为「盈利类目之间的分配器」。
- `BUILDING_OUTPUT` 仍是 `investmentScore` 的输入，**不退役**（与 ADR 0021 的预告不同），
  原因同上。

### 4. 暴露

`v3_inspect economy` 的逐建筑行扩展为：

```
- 农场：产出 … = 利润 …（毛利 …，… 金/座，开工率 87%，闲置）
```

「开工率」即快照写入的**下月**利用率；`< 100%` 时标注「闲置」。

## 代价与权衡

- 这是一次**行为变更**（B1+B2 的 A/B 逐位相同不再成立）：利用率 < 1 直接压低产出，
  私人投资目标改变。
- 工厂多为不盈利（PT-002 消费品过剩 + 工资分摊），B3 令其闲置，**机械供给随之减少**，
  0007 的 24 个月「机械两侧都有市场」基线从 ~24 个月降到 6 个月。该基线不属于结构性
  不变量；已按计划 §5 的**过渡门槛**（每 12 个月至少一次两侧）放宽，待 B5 重新校准
  工厂毛利率后恢复。
- 工资按 `labor × count` 分摊，不随利用率缩放；闲置类目仍承担全额工资份额，故
  `Σ buildingProfits.wages === 全国 wages` 的精确恒等式不变。
- 不变量未动：`C+I+G+NX === GDP`、全部金币守恒恒等式、贸易路线金币恒等式、
  60 月确定性、鸦片危机门（§4.1 的 ≥2 单位/月与 ≥20% 来自英国）全部保持。

## 生产顺序（月度，`computeEconomy`）

1. 物理产出读**上月** `utilization`（不读当月价）；
2. 价格按 `basePrice × clamp(√(demand/supply), 0.35, 3)`、30% 平滑（不变）；
3. 用本月产出与本月价算逐建筑利润（B2 口径）；
4. 写**下月** `utilization`（目标 1 或 `UTIL_IDLE_FLOOR`）；
5. `simulateCountry` 折旧步骤叠加 `deepLoss` 萎缩；
6. `investPrivateCapital` 只建 `profitPerBuilding > 0` 的类型。
