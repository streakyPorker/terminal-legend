# 建造面板与队列编排

- Status: accepted（World v11，纯 UI/接口，不升版本）
- **部分被取代**：ADR 0031 移除建造面板的**下单按钮**（`建×1` / `5×1` / `⇤`），
  下单改走对话 / GM 工具；面板定位改为只读仪表盘。**队列管理（取消 / ↑ / ↓ / 置顶）保留**。
  本 ADR 中关于「面板下单」的条款自 World v14 起失效，其余（队列编排接口、`#index`/`projectId`）仍有效。
- Fixes: **PT-037**（国有建造队列不暴露 `projectId`，无法取消）
- Depends on: `docs/plans/0013-construction-ui.md`、ADR 0010/0012/0013/0015（建造能力与队列顺位）、ADR 0017（私人项目节奏与不可取消）、ADR 0016（GM 明细接口）

## 背景

1836 年头几局的试玩里，建造全靠自然语言下单，语义反复被误读：

- 玩家说「兴建营造 5×1」「煤矿 1×5」——**`x*y` = 每槽 x 座、共 y 个槽位**。GM 必须
  **连调 y 次** `v3_action build { count: x }`；一次 `count = x*y` 会把所有座数打包进单槽
  （5 的上限还会被拒）。每局都要口头确认一遍语义，误读两次以上。
- `v3_inspect construction` 只显示「国有 营造所×5：剩余 225/225 点，进度 0%」，
  **不列项目 id**；而 `v3_action cancel` 的唯一入参正是 `projectId`。玩家因此**无法取消或
  调整已下的国有订单**（PT-037）——手滑下一次大单，预算就被锁死数个月。
- 队列的**顺序**就是建造力的分配顺序（ADR 0013：严格按队列次序取用闲置建造点），
  但玩家没有任何手段**插队**或**重排**：想让港口先于矿厂建，只能把矿厂全撤了重下。

结论：**建造不该走自然语言**，应该在面板上直接看、直接点、直接排。

## 决定

### 1. 共享 `ConstructionPanel`（view 层，只读）

新增 `view/panels/construction.tsx`，渲染两个区块，**同时挂载在御前面板与经济面板**，
是建造交互的唯一实现（面板注册表在 `view/panels/panel.tsx` 分发）。它**不写世界状态**，
只通过 `onControl(control, payload)` 抛出意图，由 `hooks/` 落成 `applyDecision`。

- **「可建建筑」清单**：列出**全部 22 类建筑**（存量 0 也列），按 6 族分组——
  采掘（农场/煤矿/铁矿/伐木场）、轻工（纺织/家具/酿酒/奢侈）、重工（机械/钢铁）、
  服务（学校/大学/官署）、军事（兵工厂/兵营/要塞/船坞）、基建（铁路/港口/运河/电报/营造所）。
  每行显示：名称、当前存量、单座工程量、单座月度建造点需求、单座造价、**单座经营利润**
  （取自 `econ.buildingProfits`，绿/红着色）、未解锁时的科技门槛。
  分组表在 `construction.tsx` 内是**常量**；分组漏掉的建筑会落进兜底「其他」组，
  保证新增建筑**不会从清单里掉出去**。
- **x\*y 直点下单**：每行三个按钮——`建 1×1`（尾插 1 槽 1 座）、`建 5×1`（尾插 1 槽 5 座）、
  `⇤1×1`（**队首**插 1 槽 1 座）。`x`（每槽座数）限 **1..5**（与 `MAX_BUILDINGS_PER_SLOT`
  一致），`y`（槽位数）限 **1..10**（`MAX_SLOTS_PER_ORDER`，防误下大单）。
- **队列区块**：逐条列出 **`#index`**（1-based）、**`id:<projectId>`**、类型×座数、
  剩余工程量/总量、进度条与百分比、本月投入点数、**预计回合**、造价；国有条目带
  `取消` / `↑` / `↓` / `置顶` 四个按钮。**私人条目照常显示，但不带任何控制按钮**
  （可见但锁定，呼应 ADR 0017「私人项目不可取消」）。

### 2. 载荷类型 `ControlPayload`

`onControl` 的第二参数从无类型升级为 `ControlPayload`（`types/index.d.ts`）：

```ts
type ControlPayload = {
  building?: BuildingId
  perSlot?: number    // x，1..5
  slots?: number      // y
  projectId?: string
  index?: number      // 1-based 队列序号
  position?: 'head' | 'tail' | 'before' | 'after'
  before?: string     // before/after 的锚点项目 id
}
```

`hooks/council.ts` 的 `controlGame` 按 `build` / `cancel` / `reorder` 分发：`build` 走
`panelBuild`（把 `x*y` 展开为 y 次 `v3_action build`），`cancel` / `reorder` 走
`panelDecision`（调 `applyDecision`）。托管进行中（`isDelegatedRun`）面板拒绝一切写操作。

### 3. GM 侧：id/序号暴露、`position`/`before`、`reorder`

- **`v3_inspect construction`** 每行携带 **`#index`** 与 **`id=<projectId>`**，
  与面板一一对应（PT-037 的引擎侧收敛）。
- **`v3_action cancel`** 接受 **`projectId` 或 1-based `index`**（两者都给时 `projectId` 优先）；
  **未命中时错误信息列出「可用项目」**（`1=proj-…（营造所×5）、…`），不再是干巴巴的「没有找到」。
- **`v3_action build`** 新增 **`position`（head/tail/before/after，默认 tail）**
  与 **`before`**（before/after 的锚点 id）。队首/锚点插入让玩家能把基建排到矿厂之前。
- **新增 `v3_action reorder`**：`{ projectId | index, position, before? }`，把既有条目移到
  指定位置。**私人项目不可重排**（与不可取消同源）。

### 4. 重排**保留进度**

`engine/actions/build.ts` 的 `actionReorder` 用 `splice` **取出再插回同一个项目对象**，
从不重建条目，因此 `progress` / `startedAt` / `lastSpend` 等字段原样保留。
把一条已经砌了一半的项目上移/下移，**已投入的工程量不退回、不重算**——只改它后面的
分配次序（plan 0013 §4 的建议即按此落地）。

### 5. **引擎分配逻辑不变**

本 ADR 是**纯 UI + 接口变更**。队列仍按**条目顺序**贪心分配建造力
（`take = min(剩余建造力, 剩余工程量)`，ADR 0013），没有每槽月度上限，没有新的调度器。
面板与 `reorder` 只是**编排顺序**；顺序一改，下一月的分配自然跟着改，`constructionSchedule`
的预计回合随之更新。世界版本**不升**（无结构变化）。

## 代价

- 面板在终端里比一行文字长得多，22 类建筑 + 每个 3 个按钮会占屏；靠分组与
  小宽度按钮缓解。`width` 参数已保留，后续可按列宽折行。
- `x` 限 5、`y` 限 10 意味着一次点单最多 50 座；更大的订单仍需连点或走 GM。
- 重排只改顺序、不改进度，所以「把半成品挪到队首」会**立刻吃满**后续建造力——
  这是设计意图（玩家就是要它先完工），但可能挤占其他条目的进度。
- `#index` 是**当下队列的位置**，条目被删/被移后序号会变；跨交互请以 `id` 为准。

## 暂不覆盖

- **私人建造的交互**：私人项目仍不可取消/不可重排（ADR 0017），面板只做只读展示。
- **建筑升级/拆除**：不在本切片。
- **科技门槛的实际生效**：`unlock.techLevel` 仍是前向占位（plan 0005 / ADR 0026 F6），
  面板只是**显示**门槛，当前 22 类全部缺省、永远可点。
- **自由文本 `x*y` 输入框**：首版只做按钮，不做键入解析。

## 不变量（要求保持）

- 队列顺序 → 建造力分配 → 工期 的既有贪心语义（ADR 0013）**逐字不变**。
- 私人项目**不可取消、不可重排**；面板对私人条目**只读**。
- 面板只读世界状态，写操作一律经 `applyDecision` 落账。
- `x*y` 展开为 y 个**各含 x 座**的条目（不是 1 个 `count = x*y` 的条目）。
