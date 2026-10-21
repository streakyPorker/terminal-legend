# 持久化双边贸易航线（软闸门）

- Status: accepted（World v8）
- Fixes: PT-030（贸易刚性：每月全局重新撮合，无记忆）
- Depends on: `docs/plans/0004-trade-diplomacy.md`、ADR 0005（不做存档兼容）

## 背景

原贸易是**一次性全局撮合**：每月对每种可贸易商品做一次 Top-6 offer/bid 匹配，
进口国保留最便宜的 6 个出口国，月末流量即被丢弃。没有“航线”概念，因此：

- 一对国家无法把贸易关系固化下来；下月价格一变，伙伴就可能整体换掉。
- 无法表达“这条商路已经经营多年、比现货更便宜/更稳”。
- 玩家没有可操作的贸易经营维度（只能设关税与禁运）。

试玩记录 PT-030 记录了这种刚性。

## 决定

新增**持久化双边贸易航线**，存在 `WorldState.tradeRoutes: TradeRoute[]`，作为唯一事实来源
（与 `world.wars` / `world.indemnities` 同构）；`Country.trade` 仍只是当月派生汇总，不存重复状态。

```ts
type TradeRoute = {
  id: string          // route-<good>-<from>-<to>
  good: GoodId
  from: string        // 出口国
  to: string          // 进口国
  level: number
  owner: 'state' | 'private'
  openedAt: GameDate
  lastQty: number
  lastMargin: number
}
```

### 软闸门（soft gate），不是硬闸门

**没有航线也能贸易**。每月清算分两遍：

1. **航线遍**（先）：按 `(good, from, to)` 确定性排序遍历 `world.tradeRoutes`。
   端点交战 / 该商品被禁运 / 进口方关系低于 `RELATION_CUTOFF=-50` → 跳过，供给留给现货。
   航线运量 `qty = min(出口余量, 进口余量, 容量)`，容量
   `= level × ROUTE_UNIT_VOLUME × 港口/交通系数`。航线到岸价 `routeLandedPrice` **不含关系风险、
   且乘航线折扣**（长期关系，无现货摩擦）。每条航线产出**一个共享 `TradeFlow` 对象**，两端引用同一对象
   ——这正是金币守恒恒等式仍然逐字成立的原因。
2. **现货残差遍**（后）：用剩余 offer/bid 跑原有 `clearGood`，到岸价乘 `ROUTE_RESIDUAL_FRICTION`，
   候选出口国上限 `ROUTE_RESIDUAL_TOP_PARTNERS`。这保证 1836 起局经济与鸦片基线不被掐死。

随后 `applyCapacity` / `applyPaymentCapacity` / `settleTrade` **完全不变**；航线流与现货流同在
一个列表、同为共享对象，故 `Σ进口账单 === Σ出口收入 + Σ出口关税`、`value === quantity×unitPrice`、
`tariffPaid === (value+exportDuty)×tariff` 全部精确成立。

### 常量（`engine/trade.ts`，校准用）

| 常量 | 值 | 含义 |
| --- | --- | --- |
| `ROUTE_UNIT_VOLUME` | 2 | 1 级航线每月运量（再乘港口/交通系数） |
| `ROUTE_MAX_LEVEL` | 5 | 航线最大等级 |
| `ROUTE_GROW_UTILIZATION` | 0.8 | 达到容量 80% 且有利可图才成长 |
| `ROUTE_RESIDUAL_FRICTION` | 1.15 | 现货残差到岸价摩擦 |
| `ROUTE_RESIDUAL_TOP_PARTNERS` | 3 | 残差候选出口国上限 |
| `ROUTE_SPOT_DISCOUNT` | 0.9 | 航线到岸价折扣 |
| `ROUTE_MAX_PER_COUNTRY` | 12 | 单国航线上限 |
| `ROUTE_SEED_PER_PAIR` | 3 | 开局每个（进口国, 商品）种子航线数 |

`ROUTE_UNIT_VOLUME` 从 6 下调到 2：更大的容量会显著扰动 120 个月私人投资节奏基线
（`tests/economic-loop.test.ts` 的零投资窗口上限）。容量小、随等级自增，反而让航线在
“能填满容量”处自平衡。

### 成长 / 衰退（每月结算后一次，确定性，无 RNG）

- `margin = 进口国国内价 − 航线到岸价`（进口方收益）。
- `margin > 0` 且**已匹配运量 ≥ 容量 80%** 且未被切断 → `level += 1`（封顶 `ROUTE_MAX_LEVEL`）。
- 否则 `level -= 1`；`level ≤ 0` 则删除。
- 用**匹配量（扣减前）**判断成败，使偿付能力削减不会误杀结构性健康的航线；
  `lastQty` 仍记录当月实际交付量，`lastMargin` 记录收益。
- 交战 / 禁运 / 关系低于阈值的航线被暂停（当月运量 0）并衰退。

### AI 自动开通

每月每个国家最多自动开通 1 条航线（进口方配额，`ROUTE_MAX_PER_COUNTRY` 封顶），
在“进口国缺口 × 出口国盈余”的互补对上按 `margin` 降序、`(good, importer, exporter)` 显式 tie-break
排名确定。所有者按 `world.tick` 奇偶在 private/state 间确定性切换，以覆盖两种所有者。

### 玩家动作

`v3_action` 新增 `action: 'route'`，参数 `op ∈ {open, raise, lower, close}`、`good`、`partner`。
方向由两端净盈余决定（盈余更大者出口，平局按较小 id 出口）。校验：商品可贸易、伙伴存在、
非本国、非交战、非禁运。`open` 建 1 级、国有；`raise`/`lower` ±1（封顶/删除）；`close` 删除。
工具 schema 与 handler 白名单**同时**登记 `op` / `good` / `partner`（历史 bug 教训：漏登记会被静默丢弃）。

### 开局种子

`newWorld` 在 `calibrateWorld` 后跑一次无航线清算，对每个（进口国, 商品）按货值取前
`ROUTE_SEED_PER_PAIR` 条，建成 1 级种子航线。1836 年因此自带一套贸易网络。

### 世界版本

升到 **v8**（`createWorld` 的 `version` 与 `save.ts` 的 `CURRENT_WORLD_VERSION`）。
按 ADR 0005 不做兼容，旧 v7 存档直接拒绝。

## 代价

- 航线会“锁定”初始配对，比纯现货市场略欠效率；这是设计意图（贸易关系有粘性）。
- 小额商品（奢侈品、机械等）常因填不满容量而衰退、退回现货；只有能自平衡的航线留存。
- `tests/economic-loop.test.ts` 的私人投资节奏对贸易结构极敏感，`ROUTE_UNIT_VOLUME` 与
  种子数因此被刻意压低；若未来放宽，必须同时重跑 120 个月基线。
- 航线流与现货流并存，Monthly clearing 的流量条数增加，但仍在可控范围内（10 国规模）。
