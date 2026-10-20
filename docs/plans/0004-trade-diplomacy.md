# 贸易与外交最小闭环（v6）

- Status: planned（决策已定，待实施）
- Depends on: `0003-economic-loop.md`、ADR 0001（月度会议/秘书）、ADR 0002（自由数值及修订）、ADR 0003（引擎/LLM 边界）、ADR 0004（修正叠算）、ADR 0005（不做兼容）
- Scope: 双边贸易与 NX → 敏感商品关系效应 → 外交局势（首个：鸦片危机）→ 最小战争目标。世界版本升到 **v6**。

## 0. 已定决策（grilling 结果）

| 问题 | 决定 |
| --- | --- |
| 切片范围 | **T1–T4 一体推进**，按 T1→T2→T3→T4 分成四个可验证提交，中间不停下等确认 |
| 贸易粒度 | **每国每商品 Top-6 双边流** |
| 可贸易商品 | **除服务外全部可贸易**；服务仅国内 |
| 鸦片 | **新增 `opium` 商品**；普通消费品 + 禁烟修正；后期可加军用/药用需求 |
| 鸦片供给 | **英国殖民地高产 + 大清少量**（英国代表英属印度） |
| 贸易定价 | **伙伴国内价 × (1+关税) × 运输/接入/风险系数** |
| 贸易结算 | **金币实际移动**；进口国库不足时差额转债务（白银外流可发生） |
| 关税 | **全国单一税率**；敏感商品差别用政策/禁运表达 |
| 贸易容量 | **宽松成交量上限**：港口/交通/市场接入影响容量，但正常年份远高于需求 |
| 关系与贸易 | **风险溢价 + 低关系阻断**；关系低于 -50 基本不交易 |
| 禁运 | **新增 `embargo` 外交动作**；可全面禁运，也可按商品禁运 |
| 关系效应 | **自动基础漂移 + agent 额外 `tradeTension`**；白名单（鸦片/军械/粮食），每月 ±10 信封 |
| 危机触发 | **1839–1842 历史窗口 + 条件**（鸦片贸易存在、中英关系低于阈值） |
| 危机提案 | **参与者一次批量 + 仲裁单独一次**；玩家由主模型/秘书提交 |
| 危机裁决 | **仲裁 agent 从 4 个预置结果包中选**；失败走确定性兜底 |
| 危机结果 | **4 个固定结果包**：禁烟成功 / 妥协通商 / 战争—开放市场 / 战争—赔款；可包含宣战 + 战争目标 |
| 战争目标 | **四种全做**：赔款、开放市场、势力范围、威望羞辱 |
| 秘书权限 | 外交授权下**可提交危机提案**；宣战/和约仍由玩家决定 |
| 贸易 UI | **并入经济页 + 外交页**，不新增页签 |
| 世界版本 | 贸易 **v6**；科技树下一期 **v7** |

## 1. 新增商品与数据模型

### 1.1 鸦片（`opium`）

- 加入 `GoodId` 与 `GOODS`，基础价草案 `2.5`。
- **不进入 Stone-Geary 主篮子**，单独需求，避免破坏已调平的消费结构：

```
opiumDemand = popFactor × opiumDemandFactor × (0.5 + supernumerary / 10)
```

- 每国 `opium: { outputFactor, demandFactor }`：
  - 大清：`outputFactor 1.0`、`demandFactor 0.15`
  - 英国：`outputFactor 3.0`（代表英属印度）、`demandFactor 0.02`
  - 奥斯曼：`outputFactor 0.5`、`demandFactor 0.05`
  - 其他国家：`outputFactor 0.1`、`demandFactor 0.03`
- 产出走农场：

```
opiumProduction = farms^0.98 × 0.004 × tech × infra × access × outputFactor
```

- 新增修正入口 `opiumOutput`、`opiumDemand`；禁烟政策挂 `opiumDemand` 负修正。
- 后期：军用/药用需求作为额外需求块，不改变本切片的贸易结构。

### 1.2 区域与运输

- 每国 `region: 'europe' | 'eastAsia' | 'americas' | 'middleEast'`。
- 区域对基础运输系数（草案）：

| | 欧洲 | 东亚 | 美洲 | 中东 |
| --- | --- | --- | --- | --- |
| 欧洲 | 1.00 | 1.25 | 1.15 | 1.08 |
| 东亚 | 1.25 | 1.00 | 1.30 | 1.20 |
| 美洲 | 1.15 | 1.30 | 1.00 | 1.25 |
| 中东 | 1.08 | 1.20 | 1.25 | 1.00 |

- 到岸成本：

```
accessFactor   = 1.15 - marketAccess × 0.25
transportFactor = 1.20 - transportInfrastructure / 500
relationRisk   = 1 + max(0, -relation) / 200
landedPrice    = partnerPrice × (1 + tariff / 100) × regionCost × accessFactor × transportFactor × relationRisk
```

- `relation < -50`：该伙伴不进入候选；战争/禁运直接切断。

### 1.3 贸易状态

```ts
export type TradeFlow = {
  good: GoodId
  from: string          // 出口国
  to: string            // 进口国
  quantity: number
  unitPrice: number     // 出口国国内价
  landedPrice: number   // 进口国到岸价
  tariff: number        // 进口国政府收到的关税
  value: number         // quantity × unitPrice
}

export type TradeState = {
  exports: TradeFlow[]  // 只保留最近一月
  imports: TradeFlow[]
  exportValue: number
  importValue: number
  tariffRevenue: number
  nx: number
  capacity: number
  history: {
    exportValue: number[]
    importValue: number[]
    nx: number[]
    tariffRevenue: number[]
  }
}

export type Embargo = {
  target: string
  goods: GoodId[] | 'all'
  since: GameDate
  reason?: string
}
```

- 国家新增 `trade: TradeState`、`embargoes: Embargo[]`、`region`、`opium`。
- `WorldState` 新增 `situations: SituationRecord[]`、`tradeTensions: TradeTension[]`（只保留最近 24 个月）。
- `War` 新增 `goal: WarGoal`、`goalOwner: string`。

### 1.4 World v6

- 世界版本升到 **6**；按 ADR 0005 不做迁移，旧 v5 存档删除。
- `save.ts` 的 `CURRENT_WORLD_VERSION = 6`。

## 2. 双边贸易

### 2.1 月度顺序

1. 计算国内产出与需求（复用 0003 的 C/I/G 与中间需求）。
2. 国内优先：`domesticUsed = min(supply, demand)`。
3. 进口缺口：`importNeed = max(0, demand - supply)`。
4. 出口盈余：`exportSurplus = max(0, supply - demand)`。
5. 进口国按到岸成本排序候选出口国，取 Top-6；出口国按进口国支付能力/到岸价排序。
6. 成交、扣金币、收关税、记贸易流。
7. 资源进口折算为可用资源加成。
8. 关系漂移与 `tradeTension` 落账。
9. `NX = exportValue - importValue`，进入 GDP 的 `components.nx`。
10. 更新贸易汇总历史。

### 2.2 软容量

```
capacityGold = 50 + ports × 8 + marketAccess × 200 + transportInfrastructure × 1
```

- 每国每月进口总额上限为 `capacityGold`；超出部分按比例削减，未满足需求保留。
- 正常年份容量远高于贸易额；战争/封锁/禁运会先削减容量，再削减流量。
- 不设商品级配额；容量是宽松上限，不是精细分配器。

### 2.3 金币结算

- 进口国支付 `landedPrice × quantity`；出口国收到 `unitPrice × quantity`；差额（关税 + 运输摩擦）中，关税进进口国国库，运输摩擦消失。
- 进口国国库不足：先付可用国库，差额进债务。
- 出口国收到的金币进国库；出口不产生额外税。
- 现有抽象 `tradeVolume × tariff × 0.12` 关税项删除，改为实际 `tariffRevenue`。

### 2.4 NX 与 GDP

- `components.nx = exportValue - importValue`。
- `gdp = C + I + G + NX`（报告口径仍按基期价；`gdp` 修正只缩放报告，不进入工资/利润）。
- NX 可以为负；负 NX 直接压低 GDP 与税基。
- 贸易平衡不再强制为 0；60 个月测试要求数值有限、可解释。

### 2.5 资源进口

- 每月记录 `resourceImports: Record<ResourceId, number>`。
- 进口煤/铁/木材/粮食折算为“可用资源加成”：

```
importBonus = clamp(importedQuantity / max(1, domesticProduction) × 50, 0, 50)
effectiveEndowment = clamp(endowment + importBonus, 0, 100)
```

- `resourceMultiplier` 使用 `effectiveEndowment`；战争/禁运切断进口时乘数回落。
- 贸易未接入前的 v5 存档不再兼容，无需旧逻辑。

### 2.6 关系效应

- **自动基础**：双边贸易占一国贸易的比重越高，关系每月向正向漂移，最多 `+2`。
- **敏感商品基础张力**：进口鸦片/军械/粮食时，与出口国关系每月 `-0.5`（粮食可改为 0 或正向，实施时按 60 个月基线调）。
- **agent `tradeTension`**：AI 批量或玩家主模型可提交：

```ts
{ good: GoodId, partner: string, relationDelta: number, reason: string }
```

- 引擎校验：商品在白名单（鸦片、军械、粮食）、`|delta| ≤ 10`、关系下限 -100；每对每月总变化（自动 + tension）夹在 ±10。
- 写入编年史；`tradeTensions` 只保留最近 24 个月用于 UI/审计。

## 3. 禁运与战争

- 新增外交动作 `embargo` / `unembargo`：
  - `embargo`：`target` + 可选 `good`（缺省为全部商品）。
  - 立即切断对应贸易；关系 -15；写入 `embargoes`。
  - `unembargo`：解除并关系 +5。
- 战争自动切断交战双方贸易；盟友是否参战沿用现有 `alliances`。
- 封锁（blockade）不在本切片；留到事件树/海军切片。
- 禁运会改变资源进口与价格，从而影响产出和民生。

## 4. 外交局势：鸦片危机

### 4.1 触发

- 日期窗口：**1839.01–1842.12**。
- 条件（同时满足）：
  - 大清与英国不在战争中；
  - 大清从英国进口鸦片，且最近一月鸦片进口值 ≥ 阈值（草案 10 金）；
  - 中英关系 ≤ -10；
  - 该局势尚未触发过。
- 触发后写入 `world.situations`，御前/外交页出现「局势」卡片；月度会议不因此阻塞。

### 4.2 提案

- 参与者：**QING、GBR**。
- AI 参与者共用一次 `model.complete` 批量提交提案；玩家由主模型提交；外交授权下秘书可提交，但宣战/和约仍由玩家决定。
- 提案形状沿用 0002：

```ts
type SituationProposal = {
  countryId: string
  stance: string          // 禁烟 / 妥协 / 开战 / 求援 / 观望 ...
  narrative: string
  effects: PolicyEffect[] // 对本国
  pressure?: PolicyEffect[]
}
```

- 引擎校验效果信封（stat、数值、月数），非法条目拒绝并走确定性兜底。

### 4.3 四个结果包

| id | 标题 | 效果 | 战争 |
| --- | --- | --- | --- |
| `qing-crackdown` | 禁烟成功 | 大清合法性 +6、权威 +8、威望 +8；英国威望 -5、关系 -15；大清对英鸦片禁运 24 个月 | 无 |
| `compromise` | 妥协通商 | 大清关税 -8、市场接入 +0.10、合法性 -4、激进 +5；英国收入 +5% 24 个月、关系 +10 | 无 |
| `war-open-market` | 战争：开放市场 | 英国以 `openMarket` 为目标对大清宣战；双方关系 -40 | 有 |
| `war-reparations` | 战争：赔款 | 英国以 `reparations` 为目标对大清宣战；双方关系 -40 | 有 |

- 结果包只包含引擎可校验的效果条目；战争包复用 T4 的战争目标。
- 仲裁 agent 只能返回上述 4 个 id 之一；返回其他内容视为失败。

### 4.4 仲裁与兜底

- 仲裁 prompt：日期、双方提案、关系、贸易额、军力对比、领袖人格、近期编年史；要求只输出结果 id。
- 确定性兜底（按优先级）：
  1. 大清提案为妥协/开放 → `compromise`；
  2. 大清提案为禁烟且英国提案不激进 → `qing-crackdown`；
  3. 英国提案为战争且大清不妥协 → `war-open-market`（若英国更弱则 `war-reparations`）；
  4. 其余 → `compromise`。
- 记录各方提案与仲裁选择，保证存档可复现；测试 mock 仲裁。

### 4.5 存档与 UI

- `SituationRecord` 保存：id、类型、日期、参与者、提案摘要、结果 id、是否解决。
- 已解决局势只保留摘要，不保留完整上下文，控制存档大小。
- 御前/外交页显示：局势标题、各方立场、倒计时、结果；提案未到齐时显示「等待各方」。

## 5. 最小战争目标

宣战时选择目标；停战按战争分数与目标结算：

| 目标 | 胜利效果 | 失败效果 |
| --- | --- | --- |
| `reparations` 赔款 | 战败方支付 `min(国库, GDP×10%)`；胜方威望 +10；败方合法性 -5、债务上升 | 进攻方威望 -10、合法性 -3 |
| `openMarket` 开放市场 | 战败方关税 -10、市场接入 +0.15（24 个月）；胜方收入 +5%（24 个月）；败方合法性 -4 | 进攻方关系 -10、威望 -5 |
| `sphere` 势力范围 | 战败方进入胜方 `sphere`；胜方市场接入 +0.05（24 个月）；双方关系 -10 | 进攻方威望 -8、合法性 -2 |
| `humiliation` 威望羞辱 | 胜方威望 +15；败方威望 -15、合法性 -8 | 进攻方威望 -8、合法性 -3 |

- `War` 记录 `goal` 与 `goalOwner`；白和/超时（60 个月）不触发目标效果。
- 宣战工具参数新增 `goal`；AI 宣战必须给目标，缺省 `reparations`。
- 赔款与债务复用现有财政逻辑；开放市场/势力范围用限时修正与 `sphere` 数组。

## 6. AI 与秘书

- AI 批量新增可返回的外交动作：`embargo`、`unembargo`、`tension`（通过 `diplomacy` action 的 `move`/`good`/`amount`/`reason`）。
- AI 月度提示补充：贸易收支、Top-6 伙伴、鸦片依赖、关税收入、资源进口、局势状态。
- AI 兜底：债务 >GDP 时加税；被禁运时寻找替代伙伴；危机中按人格选择立场。
- 秘书：外交授权下可提交危机提案、禁运/解除禁运、trade tension；宣战/和约仍由玩家决定；越权照旧审计。

## 7. UI

- **经济页**：Top-6 伙伴、进口/出口值、关税收入、NX、贸易容量、资源进口、鸦片依存度。
- **外交页**：贸易依赖、禁运列表、双边贸易额、tension 记录、局势卡片（各方立场/倒计时/结果）。
- **御前**：局势提案与仲裁结果；战争目标与和约条款摘要。
- 不新增页签；沿用现有 10 个页签。

## 8. 测试与验收

1. **T1 贸易流**：短缺国从最便宜伙伴进口；金币、关税、NX、容量守恒；60 个月数值有限。
2. **T2 敏感商品**：白名单外拒绝；`tradeTension` ±10 信封；禁运切断流量并改变资源进口。
3. **T3 鸦片危机**：窗口/条件触发；4 个结果包均可由 mock 仲裁选中；确定性兜底；提案与结果可复现。
4. **T4 战争目标**：四种目标宣战→停战→效果落账；白和无目标效果。
5. **确定性**：同种子同决策 60 个月后贸易/NX/关系一致。
6. **渲染**：经济页/外交页/御前局势在 terminal/desktop 可绘制。

## 9. 里程碑

| 里程碑 | 内容 | 完成标准 |
| --- | --- | --- |
| T1 | 鸦片商品、区域、Top-6 双边流、金币/关税/NX、容量、资源进口 | 60 个月贸易收支平衡且可解释 |
| T2 | 敏感商品自动漂移 + `tradeTension` + 禁运 | 鸦片类贸易使关系恶化且可审计 |
| T3 | 局势/提案/4 结果包/仲裁 + 鸦片危机 | 一条可玩危机闭环 |
| T4 | 四种战争目标与和约 | 宣战→胜利→条款落账；白和正确 |

## 10. 风险

| 风险 | 缓解 |
| --- | --- |
| 贸易流计算量（10 国 × 11 商品 × 6 伙伴） | 每月一次；只存最近一月；Top-6 截断 |
| 金币结算导致国库/债务爆炸 | 宽松容量 + 进口按支付能力削减 + 债务重组（已实现） |
| 鸦片逆差过强/过弱 | 先跑 60 个月基线，再调 `opiumDemandFactor` 与产出 |
| 仲裁不可复现 | 只允许 4 个 id；记录提案与选择；确定性兜底 |
| 危机必然开战 | 4 个结果包包含妥协与禁烟成功；玩家立场影响兜底 |
| 存档膨胀 | 贸易只存最近一月 + 汇总历史；已解决局势只存摘要 |

## 11. 实施时校准的参数（草案，先跑 60 个月再改）

- `opium` 基础价、`outputFactor`/`demandFactor`、鸦片进口触发阈值。
- 区域运输系数、`accessFactor`、`relationRisk`。
- `capacityGold` 公式与系数。
- 自动关系漂移上限、敏感商品基础张力。
- 4 个结果包的具体数值与月数。
- 战争目标效果的数值与月数。
