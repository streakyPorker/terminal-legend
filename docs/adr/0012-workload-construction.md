# 工程量制建造：每槽 5 座、工程量 ÷ 每月投入 = 工期、每点固定资金

- Status: accepted（World v7，增量规则，不升版本）；“每槽每月只拿自身需求”与
  “工程量 ×10”部分由 ADR 0013 取代
- Supersedes: ADR 0011 的“15 座/满额 1 月”部分

## 背景

ADR 0011 把每槽上限定为 15 座，并规定满额 1 个月完工。试玩后发现：

1. 1 个月太快，营造所完工后建造力暴涨，工程几乎瞬建；
2. 固定 `monthsLeft` 不是好模型：真正的工期应由**工程量**和**每月投入建造点**决定；
3. 金币应是“每点工程量”的固定投入，而不是一次性总价。

用户最终规则：

- 每槽最多 **5 座**建筑；
- 工程量是存储值，工期 = 工程量 ÷ 每月投入建造点；
- 每点工程量的基础资金固定；每类建筑有资金乘数与加数，第一版乘数全 1、加数全 0。

## 决定

### 1. 槽位与工程量

- `MAX_BUILDINGS_PER_SLOT = 5`，`v3_action build` 的 `count` 上限为 5。
- 单槽每月满额投入（建造点）：

```
capacityCost(project) = CAPACITY_COST[building] × count
maxSlotCapacity = 5 × CAPACITY_COST[building]
```

- 项目总工程量：

```
workload = capacityCost(project) × WORKLOAD_MULTIPLIER    // WORKLOAD_MULTIPLIER = 10
```

- 每月投入 `take` 点，进度增加 `take / workload`；`progress ≥ 1` 时完工。
- **工期 = workload / 每月 take**，不再有固定 `monthsLeft`；`monthsLeft` 仅保留为兼容字段（固定 1）。

### 2. 资金

- 每点工程量的基础资金：

```
CONSTRUCTION_COST_PER_POINT = 0.2 金/点
goldPerPoint(building) = 0.2 × BUILDING_COST_MULTIPLIER[building]
                        + BUILDING_COST_ADDEND[building] / workload
```

- 第一版：所有 `BUILDING_COST_MULTIPLIER = 1`，所有 `BUILDING_COST_ADDEND = 0`。
- 项目总造价 = `workload × goldPerPoint`。
- 每月满额资金 = `capacityCost(project) × goldPerPoint`；本月实际支付 = 每月满额 × 本月投入比例。
- 总造价与工期无关：工期拉长时，每月付得更少，但总量不变。
- 国有项目可赤字融资到 3× GDP 底线；私人项目受私人资本约束。
- **闲置建造力出租**：国有与私人项目分配完后，剩余点数按 0.3 金/点出租给私人部门，
  租金从私人资本扣除，记入财政收入「其他（建造力出租）」，下月随收入结算入国库；
  私人资本不足时只能租用可负担的部分，剩余点数才真正闲置。

### 3. 队列与估算

- 每槽的顺序、单槽点数上限不变；国有优先，私人自建 50% 并可租用闲置点。
- 状态与面板显示：
  - `工程量 剩余/总量 点`
  - `已完成 X%`
  - `本月投入 a/b 点`
  - `预计 N 回合`
  - `每月造价 X 金`
- `constructionSchedule` 每回合都用**当前总建造力**，不把未完工营造所的产能提前计入；槽位只拿剩余工程量，快完成的槽位不会多占点数。
- 估值是计划参考，不是承诺；金币不足/产能变化会让实际更慢。

### 4. 兼容

- 世界版本仍为 v7。
- `normalizeConstructionQueue` 把旧项目：
  - 超过 5 座的槽位拆成 5 座一块；
  - `monthsLeft = 1`（不再使用）；
  - `monthlyCost = capacityCost(project) × goldPerPoint`；
  - 保留已有 `progress`。
- 不拒绝旧存档。

## 代价

- 营造所 5 座槽位的工程量 = 7.5 × 10 = 75 点；满额 7.5 点/月时约 10 轮完成，半速则 20 轮。
- 大型槽位（5 座铁路 = 20 点/月、200 点工程量）需要长期占用建造力，必须排队或增加营造所。
- 资金乘数/加数目前全是 1/0，后续可按建筑类型调整而无需改公式。
- `BUILDING_TIME` 不再参与建造结算，仅作为数据参考。
