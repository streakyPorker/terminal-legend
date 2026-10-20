# 贸易与外交最小闭环（v6）

- Status: implemented（T1a–T4 已实现，World v6；校准见 §11.1/§11.2）
- Depends on: `0003-economic-loop.md`、ADR 0001（月度会议/秘书）、ADR 0002（自由数值及修订）、ADR 0003（引擎/LLM 边界）、ADR 0004（修正叠算）、ADR 0005（不做兼容）
- Scope: 双边贸易与 NX → 敏感商品关系效应 → 外交局势（首个：鸦片危机）→ 最小战争目标。世界版本升到 **v6**。
- 后续：ADR 0006（World v7）把贸易缺口直接并入国库净资产，不再有独立的 `debt` 字段；赔款改为一次性 + 分期日程。

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
| 贸易账户（critic P0-1） | **家庭/企业对外账户**：进口从家庭可支配收入/企业利润支付，出口进利润/私人资本；国库只收关税与国营贸易毛利 |
| NX 口径（critic P0-2） | **进口进入有效供给，出口从国内供给扣除**；GDP 用基期价，金币/关税用当期价；两阶段月度结算 |
| 鸦片校准（critic P0-3） | 大清**必须是净进口国**：降低大清 `outputFactor`、提高人口需求；触发用进口量/消费占比，不用绝对金额 |
| 战争赔款（critic P0-5） | **实际转移给胜方**；战争目标效果**替换**现有通用威望/合法性效果，不叠加、不销毁金币 |
| 实施顺序（critic P0-6） | **T1a 数量/核算 → T1b 金币/关税/容量 → T2 → T4 → T3**；T3 复用已测试的战争目标 |

## 1. 新增商品与数据模型

### 1.1 鸦片（`opium`）

- 加入 `GoodId` 与 `GOODS`，基础价草案 `2.5`。
- **不进入 Stone-Geary 主篮子**，单独需求，避免破坏已调平的消费结构：

```
opiumDemand = popFactor × opiumDemandFactor × (0.5 + supernumerary / 10)
```

- 每国 `opium: { outputFactor, demandFactor }`（草案，按 1836–1839 基线校准）：
  - 大清：`outputFactor 0.15`、`demandFactor 0.20`（人口多但本土产量低，必须净进口）
  - 英国：`outputFactor 3.0`（代表英属印度）、`demandFactor 0.02`
  - 奥斯曼：`outputFactor 0.5`、`demandFactor 0.05`
  - 其他国家：`outputFactor 0.1`、`demandFactor 0.03`
- 产出走农场：

```
opiumProduction = farms^0.98 × 0.004 × tech × infra × access × outputFactor
```

- 目标：大清每月净进口 **2–5 单位**；低于此区间则危机条件无法成立，高于此区间则白银外流过猛。每轮调参记录在本文件 §11。

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
  tariffPaid: number    // 进口国政府收到的关税
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
  /** 缺省永久；到期自动解除。 */
  months?: number
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

### 2.1 两阶段月度结算

贸易与国内需求互相依赖，必须分两阶段，不能边算边进口：

**阶段 A：国内快照**
1. 计算各国国内产出（production）。
2. 用上月工资、利润、贸易余额计算本月消费需求；加上中间/投资/政府需求。
3. 国内优先：`domesticUsed = min(supply, demand)`。
4. 进口缺口 `importNeed = max(0, demand - supply)`；出口盈余 `exportSurplus = max(0, supply - demand)`。

**阶段 B：全局贸易清算**
5. 按 §2.2 的 offer/bid 算法做全局匹配，得到每国每商品的进口/出口流量。
6. 计算关税、金币支付、软容量削减；写入 `TradeFlow`。

**阶段 C：用有效供给重算**
7. `effectiveSupply[g] = production[g] + imports[g] - exports[g]`。
8. 用 `effectiveSupply` 重算 C/I/G 的填充比例、价格目标与稀缺度。
9. `NX = Σ(exportValue × basePrice) − Σ(importValue × basePrice)`，进入 GDP 的 `components.nx`；GDP 用基期价。

**阶段 D：收入与关系**
10. 关税进国库；贸易收支进家庭/企业对外账户（下月可支配收入与利润）。
11. 资源进口折算为可用资源加成（只影响下月，不写回禀赋）。
12. 关系漂移与 `tradeTension` 落账；更新贸易汇总历史。

- 本月贸易结果只影响**下月**需求与产出；同一月内不迭代，避免循环。
- 所有排序必须有 tie-break（进口国 id、出口国 id、商品 id），保证确定性。

### 2.2 清算算法（critic P0-4）

对每种可贸易商品独立清算：

1. **报价（offer）**：每个出口国的 `exportSurplus`。
2. **出价（bid）**：每个进口国的 `importNeed`，以及候选出口国列表（Top-6）。
3. 候选按到岸成本升序；低于关系 -50、战争、禁运的伙伴剔除。
4. 所有 (进口国, 出口国) 对按 `landedPrice` 升序、再按 `importer.id`、`exporter.id` 排序。
5. 逐笔成交 `quantity = min(bid.remaining, offer.remaining)`；同时扣减双方余量。
6. Top-6 只限制候选，不限制成交笔数；每国每商品的进口来源最多 6 个。
7. 全部成交后，按 §2.3 的软容量检查进口总额；超出容量时对所有进口**等比例削减**，未满足需求保留。
8. 不跨月欠单；没有“先结算国家”的先手，所有国家在同一商品上同时匹配。

### 2.3 软容量

```
capacityGold = 50 + ports × 8 + marketAccess × 200 + transportInfrastructure × 1
```

- 每国每月进口总额上限为 `capacityGold`；超出部分按比例削减，未满足需求保留。
- 正常年份容量远高于贸易额；战争/封锁/禁运会先削减容量，再削减流量。
- 不设商品级配额；容量是宽松上限，不是精细分配器。

### 2.4 金币结算（家庭/企业对外账户）

Critic P0-1：不能让出口价值同时进 GDP 和国库。贸易走家庭/企业对外账户：

- **进口支付**：进口国企业/家庭支付 `unitPrice × quantity + tariff`。
  - 先从家庭可支配收入（工资 + 利润的消费部分）扣；不足时从 `privateCapital` 扣；仍不足的差额进 `econ.debt`（外债），并记录 `tradeDeficit`。
  - 进口支付**不直接扣国库**；国库只在关税项收款。
- **出口收入**：出口国收到 `unitPrice × quantity`，进入企业利润（下一月可支配收入）或 `privateCapital`（按利润分配规则）。
- **关税**：进口国国库收到 `tariff × quantity`；替换现有抽象 `tradeVolume × 关税 × 0.12`。
- **运输摩擦**：只进入 `landedPrice` 的排序，不作为金币流；实际支付 = 出口价 + 关税。避免“运输摩擦销毁金币”造成的通缩漏损。
- **单一货币**：全局只有一种虚拟货币「金」，不做多币种/汇率/货币供给；跨境金币 = 进口国对外账户（私人资本/外债）对出口国私人部门，从不凭空创造或销毁金币。
- **国营贸易毛利**：可选，按 `ports × 0.01` 进国库；第一版先不做，避免与关税重复。
- 新增 Economy 字段：`lastImportBill`、`lastExportRevenue`、`lastTariffRevenue`、`lastTradeBalance`（出口 − 进口，下一月进入家庭可支配收入/利润）。
- HUD/AI 简报显示“贸易收支”，不再把出口算进国库。
- 债务重组后，进口能力受 GDP/信用约束：违约后 12 个月内进口容量减半，且新外债上限为 GDP×0.2。

### 2.5 NX 与 GDP

- `components.nx = Σ(exportValue × basePrice) − Σ(importValue × basePrice)`。
- C/I/G 用 `effectiveSupply = production + imports − exports` 重算；进口消费品进入 C、进口投资品进入 I、进口政府用品进入 G；出口从国内供给扣除。
- `gdp = C + I + G + NX`（报告口径按基期价；`gdp` 修正只缩放报告，不进入工资/利润）。
- 金币/关税按当期价结算；GDP 与 NX 按基期价，二者不混用。
- NX 可以为负；负 NX 直接压低 GDP 与税基。
- 贸易平衡不再强制为 0；60 个月测试要求数值有限、可解释。

### 2.6 资源进口

- 每月记录 `resourceImports: Record<ResourceId, number>`。
- 进口煤/铁/木材按**进口占总可用量的比例**折算，避免小产国进口 1 单位就吃满加成：

```
importShare = imports / max(1, domesticProduction + imports)
importBonus = clamp(importShare × 20, 0, 15)   // 最多 +15 禀赋点
effectiveEndowment = clamp(endowment + importBonus, 0, 100)
```

- `effectiveEndowment` 只是**当月派生值**，不写回 `econ.resources` 基值；战争/禁运切断进口时乘数自然回落。
- 粮食进口不折算成农田禀赋，直接增加当月粮食有效供给（进入 §2.1 的 `effectiveSupply`）。
- 贸易未接入前的 v5 存档不再兼容，无需旧逻辑。

### 2.7 关系效应

- **自动基础**：双边贸易占一国贸易的比重越高，关系每月向正向漂移，最多 `+2`。
- **敏感商品基础张力**（已按 §11.2 校准，不再是固定 `-0.5`）：进口鸦片/军械/粮食的拖拽
  随「敏感进口占比」缩放，并与伙伴贸易份额的暖意共用同一份额：

  ```
  delta(from → partner) =
      TRADE_WARMTH_MAX × (1 − sensitiveShare) × partnerShare
    − SENSITIVE_DRAG × sensitiveShare
    + Σ(agent tradeTension deltas)
  ```

  其中 `partnerShare = 双边贸易额 / 本国贸易总额`、`sensitiveShare = 自该伙伴的敏感商品
  （鸦片/军械/粮食）进口额 / 本国进口总额`（分母为 0 时取 0）。伙伴贸易份额带来每月最多
  `TRADE_WARMTH_MAX = 2` 的暖意，但敏感部分的暖意被 `(1 − sensitiveShare)` 抵消，并按
  `SENSITIVE_DRAG` 反向下拉；两者与 agent 张力求和后夹在 `±10`（`TRADE_RELATION_ENVELOPE`）。
  固定 `-0.5` 草案在 60 个月基线上被校准掉：GBR 是大清的独家伙伴，其份额暖意饱和到
  +2/月、淹没固定惩罚，§4.1 的关系门槛（中英关系 ≤ −10）永远无法达成（见 §11.2）。
- **贸易拖拽底线**（`TRADE_RELATION_FLOOR = −45`）：自动的「暖意 − 拖拽」不得把一对国家
  压到 −45 以下；跨过贸易切断线 `−50` 只由外交动作（`tradeTension`/禁运/宣战）达成。
  没有它会形成「拖过 −50 → 切断 → 回归抬升 → 复交只剩鸦片（sensitiveShare→1）→ 再被
  打下」的极限环（见 §11.2）。agent `tradeTension` 不受此底线约束，其下限仍为 −100。
- **agent `tradeTension`**：AI 批量或玩家主模型可提交：

```ts
{ good: GoodId, partner: string, relationDelta: number, reason: string }
```

- 引擎校验：商品在白名单（鸦片、军械、粮食）、`|delta| ≤ 10`、关系下限 -100；每对每月总变化（自动 + tension）夹在 ±10。
- 写入编年史；`tradeTensions` 只保留最近 24 个月用于 UI/审计。

## 3. 禁运与战争

- 新增外交动作 `embargo` / `unembargo`：
  - `embargo`：`target` + 可选 `good`（缺省为全部商品）+ 可选 `months`（缺省永久）。
  - 立即切断对应贸易；关系 -15；写入 `embargoes`，带 `until` 或在 `months` 到期时自动解除并记日志。
  - `unembargo`：解除并关系 +5。
- 战争自动切断交战双方贸易；盟友是否参战沿用现有 `alliances`。
- 封锁（blockade）不在本切片；留到事件树/海军切片。
- 禁运会改变资源进口与价格，从而影响产出和民生。
- 关系低于 -50 时贸易硬切断，但**外交/基础关系漂移仍然生效**，避免贸易归零后永远无法恢复；`unembargo`、赠礼、改善关系都能把关系拉回阈值以上。

## 4. 外交局势：鸦片危机

### 4.1 触发

- 日期窗口：**1839.01–1842.12**。
- 条件（同时满足）：
  - 大清与英国不在战争中；
  - 大清从英国进口鸦片 ≥ 2 单位/月，或英国鸦片占大清鸦片消费 ≥ 20%（用数量/份额，不用绝对金额）；
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
- **提案只作仲裁上下文，不直接落账**；只有 §4.3 的结果包效果生效，避免“提案效果 + 结果包效果”重复结算。
- `stance` 固定枚举：`crackdown`（禁烟）、`compromise`（妥协）、`war`（开战）、`aid`（求援/调停）、`neutral`（观望）；叙事文本另存 `narrative`。
- 玩家入口：新增 `v3_situation`（`submit` / `abstain`），或复用 `v3_event`；秘书在外交授权下可提交，但宣战/和约仍由玩家决定。
- 局势开启后 **3 个月**未收齐提案，自动按已收到的提案 + 确定性兜底结算，不让会议永久挂起。

### 4.3 四个结果包

| id | 标题 | 效果 | 战争 |
| --- | --- | --- | --- |
| `qing-crackdown` | 禁烟成功 | 大清合法性 +6、权威 +8、威望 +8；英国威望 -5、关系 -15；大清对英鸦片禁运 **24 个月**（`Embargo.months = 24`） | 无 |
| `compromise` | 妥协通商 | 大清关税 -8（24 个月修正）、市场接入 +0.10（24 个月）、合法性 -4、激进 +5；英国收入 +5% 24 个月、关系 +10 | 无 |
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
- **赔款实际转移**：败方支付的金币进入胜方国库，不足部分进败方债务；不再“扣了败方但不给胜方”，金币守恒。
- **目标效果替换通用效果**：现有 `endWar` 的 +12/-15 威望、+6 激进被目标效果取代；只保留战争疲劳恢复、关系下降等非目标逻辑，避免羞辱目标叠加成 +27 威望。
- 开放市场/势力范围用限时修正与 `sphere` 数组；所有限时效果写 `months`，到期由 `tickModifiers` 处理。

## 6. AI 与秘书

- AI 批量新增可返回的外交动作：`embargo`、`unembargo`、`tension`（通过 `diplomacy` action 的 `move`/`good`/`amount`/`months`/`reason`）。
- **工具 schema 同步**：`v3_diplomacy` 的 move 枚举加 `embargo`/`unembargo`/`tension`，新增 `good`、`months` 参数；`engine/ai.ts` 的 `DIPLOMACY_MOVES` 与 `validParams` 同步校验。
- `tradeTension` 只允许白名单商品（鸦片/军械/粮食），每对每月总变化夹在 ±10；AI 月度批量每月一次（`world.ai.intervalTicks = 1`，缺省也改为 1），不跨月累积额度。
- AI 月度提示补充：贸易收支、**Top-3** 伙伴、鸦片依赖、关税收入、资源进口、局势状态；不要给每国列 6 个伙伴，避免提示词膨胀。
- AI 兜底：债务 >GDP 时加税；被禁运时寻找替代伙伴；危机中按人格选择立场。
- 秘书：外交授权下可提交危机提案、禁运/解除禁运、trade tension；宣战/和约仍由玩家决定；越权照旧审计。

## 7. UI

- **经济页**：Top-6 伙伴、进口/出口值、关税收入、NX、贸易容量、资源进口、鸦片依存度。
- **外交页**：贸易依赖、禁运列表、双边贸易额、tension 记录、局势卡片（各方立场/倒计时/结果）。
- **御前**：局势提案与仲裁结果；战争目标与和约条款摘要。
- 不新增页签；沿用现有 10 个页签。

## 8. 测试与验收

1. **T1a 数量/核算**：短缺国从最便宜伙伴进口；`effectiveSupply` 进入 C/I/G；NX 按基期价；C+I+G+NX 与 `gdpComponents` 对账；60 个月数值有限。
2. **T1b 金币/关税/容量**：进口/出口/关税/债务金币守恒（运输摩擦不进金币流）；软容量等比例削减；资源进口不写回禀赋。
3. **T2 敏感商品**：白名单外拒绝；`tradeTension` ±10 信封；禁运切断流量并改变资源进口；禁运到期自动解除。
4. **T3 鸦片危机**：窗口/条件触发；4 个结果包均可由 mock 仲裁选中；提案只作上下文、不重复落账；确定性兜底；提案与结果可复现。
5. **T4 战争目标**：四种目标宣战→停战→效果落账；赔款实际转移；目标效果不叠加通用威望/合法性；白和无目标效果。
6. **确定性**：同种子同决策 60 个月后贸易/NX/关系一致；所有排序有 tie-break。
7. **渲染**：经济页/外交页/御前局势在 terminal/desktop 可绘制。

## 9. 里程碑

| 里程碑 | 内容 | 完成标准 |
| --- | --- | --- |
| T1a | 鸦片商品、区域、Top-6 双边数量清算、`effectiveSupply`、NX 核算 | 60 个月数量/价格/NX 可解释；C+I+G+NX 对账 |
| T1b | 金币/关税/债务/软容量/资源进口；家庭/企业对外账户 | 金币守恒；逆差进债务；资源进口不写回禀赋 |
| T2 | 敏感商品自动漂移 + `tradeTension` + 禁运/到期 | 鸦片类贸易使关系恶化且可审计 |
| T4 | 四种战争目标与和约；赔款实际转移 | 宣战→胜利→条款落账；白和正确；不叠加通用效果 |
| T3 | 局势/提案/4 结果包/仲裁 + 鸦片危机 | 一条可玩危机闭环；T3 复用已测试的 T4 |

## 10. 风险

| 风险 | 缓解 |
| --- | --- |
| 贸易流计算量（10 国 × 12 可贸易商品 × 6 伙伴） | 每月一次；只存最近一月；Top-6 截断 |
| 金币结算导致国库/债务爆炸 | 宽松容量 + 进口按支付能力削减 + 债务重组（已实现） |
| 鸦片逆差过强/过弱 | 先跑 60 个月基线，再调 `opiumDemandFactor` 与产出 |
| 仲裁不可复现 | 只允许 4 个 id；记录提案与选择；确定性兜底 |
| 危机必然开战 | 4 个结果包包含妥协与禁烟成功；玩家立场影响兜底 |
| 存档膨胀 | 贸易只存最近一月 + 汇总历史；已解决局势只存摘要 |

## 11. 实施时校准的参数（草案，先跑 60 个月再改）

- `opium` 基础价、`outputFactor`/`demandFactor`、鸦片进口触发阈值。
- 区域运输系数、`accessFactor`、`relationRisk`。
- `capacityGold` 公式与系数。
- `TRADE_WARMTH_MAX`（伙伴份额暖意上限，固定 2）、`SENSITIVE_DRAG`（敏感进口拖拽，
  §11.2 已定 7）、`TRADE_RELATION_FLOOR`（自动拖拽底线，§11.2 已定 −45）。
- 4 个结果包的具体数值与月数。
- 战争目标效果的数值与月数。

### 11.1 校准日志 · T1b 余额校准（2026-10-20，seed 9100，QING，60→84 月，无决策）

**两个旋钮**：`GBR.opium.outputFactor`（Fix A，供给端，`engine/data.ts`）、
`MAX_MONTHLY_DEFICIT_SHARE`（Fix B，`engine/trade.ts`，新增支付能力削减）。

**Fix A · GBR `outputFactor` = 8**（原 3.0）。需求端不动（QING `demandFactor` 仍 0.2），
供给是绑定约束。窗口 m37–84 内每月 QING 进口（几乎全部来自 GBR，`gbr≈imp`）：

```
m37-48 imp: 4.42 4.39 4.37 4.34 4.31 4.29 4.27 4.24 4.22 4.20 4.20 4.36
m49-60 imp: 4.64 4.61 4.57 4.54 4.52 4.50 4.47 4.45 4.44 4.41 4.39 4.38
m61-72 imp: 4.36 4.33 4.31 4.29 4.26 4.30 4.28 4.26 4.23 4.20 4.16 4.15
m73-84 imp: 4.12 4.10 4.08 4.06 4.03 4.03 4.00 3.96 3.94 3.93 3.92 4.09
```

- 窗口统计：avg 4.27、min 3.92、max 4.64；GBR 占消费（进口+自产≈1.0）份额 **0.79–0.81**。
- 两条 gate（§4.1：进口 ≥2、GBR 份额 ≥20%）逐月成立，且落在 §1.1 的 2–5 目标带内。
- 扫描（同 seed，含 Fix B）：`outputFactor` 6→min 2.44（余量仅 22%）、7→3.20、
  **8→3.92**、9→4.66（avg 5.05 已出带）、12/18/24/30→6.9/9.6/9.6/9.6（远超目标带，
  18 以上需求近乎饱和）。取满足两 gate 且留在 2–5 带内、最小月进口余量最大者 **8**。

**Fix B · `MAX_MONTHLY_DEFICIT_SHARE` = 0.03**。
`paymentCapacity = exportRevenue + max(0, privateCapital) + gdp × 0.03`，在软容量之后
单次确定性削减（共享 `TradeFlow` → 出口镜像同步缩小，守恒恒等）。

| 月 | 基线（无削减，F=3）debt | 校准后（F=8 + 0.03）debt / tradeBalance |
| --- | --- | --- |
| m6 | — | 116 / −55.5 |
| m12 | 698 | 251 / −70.4 |
| m24 | 853 | 359 / −41.3 |
| m36 | 978 | 455 / −64.7 |
| m42 | 1029 | **465（峰值）** / −39.0 |
| m48 | 1062 | 444 / −33.2 |
| m60 | 1124 | 391 / −41.8 |
| m72 | 1181 | 318 / −10.4 |
| m84 | **1259（仍在涨）** | **242 / −10.2** |

- 校准后赤字有界：债务在 m42 见顶后回落，m84 低于 m60；国库由长期 0 恢复到 ≈72。
- 削减只限制“付不起的部分”，正常贸易仍在流动（m84 进口账单仍 ≈10 金/月）。
- 未下调 share：0.03 已让债务见顶回落，再低会连带压低鸦片进口、危及 Fix A 的 gate。

**确定性**：同 seed（9100）两次 84 月运行逐国 `trade`/`econ` 完全一致；所有排序仍
带 tie-break（`clearGood` 的 landed→importer.id→exporter.id）；无 `Math.random`。

### 11.2 校准日志 · T2 关系拖拽与底线（2026-10-20，seed 9100，QING，84 月，无决策）

**旋钮**：`SENSITIVE_DRAG`、`TRADE_RELATION_FLOOR`（`engine/sim.ts`）；`TRADE_WARMTH_MAX = 2` 固定。

**验收**：84 月基线上 QING→GBR 关系在 m37–84（1839.01–1842.12）**每月 ≤ −10** 且留有余量，
使 §4.1 的鸦片危机可触发；鸦片贸易在整个窗口**存在**（否则 §4.1 的数量/份额门槛不成立）；
无敏感贸易的伙伴仍能升温；且两种 RNG 用法都满足。

**发现 1 · 拖拽过强会形成极限环**：`SENSITIVE_DRAG = 5` 时关系在 m71 跌破
`RELATION_CUTOFF = −50`（贸易硬切断），此后「切断 → 无贸易 → 关系回归抬升 → 复交时只剩
鸦片（`sensitiveShare → 1`）→ 再被打下」自我循环：48 个月里有 10 个月鸦片为零、开关切换
11 次，**1840–42 的鸦片贸易实际死亡**。
**修复**：新增 `TRADE_RELATION_FLOOR = −45`——自动效果（暖意 − 拖拽）不得把一对国家压到
−45 以下，跨过 −50 只留给外交动作（`tradeTension`/禁运/宣战）。底线不约束 agent tension。

**发现 2 · 拖拽过弱会贴着阈值**：`DRAG = 5` 时窗口峰值只有 −8.96（每月新建 rng）/ −11.05
（复用同一 rng），正压在 §4.1 的 −10 门槛上，不可靠。故上调拖拽。

**扫描**（`TRADE_RELATION_FLOOR = −45` 生效；窗口 m37–84 峰值；两种 rng 用法）：

| `SENSITIVE_DRAG` | 每月新建 rng max | 复用同一 rng max | 窗口 min | 鸦片为零月 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 5 | −8.96 | −11.05 | −45.00 | 0 | 压在 −10 线上，不可靠 |
| **7** | **−19.34** | **−26.33** | **−45.00** | **0** | **两条门槛均满足，余量 ≥ 6 点** |

选定 **`SENSITIVE_DRAG = 7`**、**`TRADE_RELATION_FLOOR = −45`**。

**为何末值停在 −45 而非继续下探**：`Fix B` 让大清进口账单随债务收缩，m60 后鸦片近乎唯一
进口，`sensitiveShare → 1`、自动 delta 趋于 `−SENSITIVE_DRAG`；此时底线 −45 生效，关系停在
−45，贸易不再被切断，鸦片流量因此全程维持（这正是 §4.1 需要的状态）。

**基准扰动说明**：`advance` 的随机事件流依赖世界状态，贸易改动会让后期轨迹整体分岔，
故本表同时给出「每月新建 `makeRngForWorld`」与「复用同一 rng」两种用法的结果——两者都须达标。

**确定性**：同 seed 同决策两次 84 月运行逐国 `trade`/`econ`/`relations` 完全一致；所有排序
带 tie-break；无 `Math.random`。

## 12. Critic 修正记录（2026-10-20）

本轮设计审查的 P0 已在本文件解决：

| P0 | 解决方式 |
| --- | --- |
| 金币流与 GDP/收入重复计算 | 家庭/企业对外账户；国库只收关税；贸易收支只在下月进入可支配收入/利润（§2.4） |
| 进口不进入供给、NX 口径断裂 | 两阶段结算 + `effectiveSupply` 重算 C/I/G/价格；GDP 基期价、金币当期价（§2.1/§2.5） |
| 鸦片参数使大清净出口 | 大清 `outputFactor 0.15`、`demandFactor 0.20`；触发按数量/份额；目标净进口 2–5 单位（§1.1/§4.1） |
| 贸易清算算法未定义 | 全局 offer/bid 匹配、Top-6 候选、确定性 tie-break、容量等比例削减（§2.2） |
| 提案效果与结果包重复 | 提案只作仲裁上下文，只有结果包落账；`v3_situation` + 3 个月超时（§4.2） |
| T3 前向依赖 T4 | 实施顺序改为 T1a → T1b → T2 → T4 → T3（§9） |

P1 修正：资源进口按份额折算、外债上限与违约后进口压缩、运输摩擦只进定价不进金币流、赔款实际转移、目标效果替换通用效果、禁运 `months` 到期、关系 -50 后仍可外交恢复、工具/AI schema 同步、AI 提示只列 Top-3。

仍可在实施时调参的项见 §11。
