# 第一刀实现计划：官僚效能 → 秘书子代理 → 御前会议

- Status: proposed
- Depends on: ADR 0001（月度御前会议 + 子代理秘书）、ADR 0002（自由数值）、ADR 0003（引擎/LLM 边界）
- Scope: 把“实时自动推进”改成“每月御前会议 + 可托管”；引入官僚效能、秘书子代理、建造队列；修掉已知经济矛盾。
- 后续切片：轻量双边贸易（Slice B）、外交博弈 + 战争目标（Slice C）。

## 1. 目标与非目标

**目标**

1. 每月暂停在御前会议；玩家确认后推进一个月，或托管 N 月。
2. 官僚效能成为四条约束的唯一来源：行动预算、资金效率、执行延迟、信息失真。
3. 秘书是一个便宜档（haiku）子代理，能读状态、在授权领域执行、提交报告；军事与战争永远由玩家决定。
4. 建造改为有工期的队列，由建设预算与官僚效能共同驱动。
5. 修掉：军费/海军支出不计入支出、建设支出无产出、失业率静态。

**非目标（本刀不做）**

- 国家间贸易（Slice B）。
- 外交博弈、战争目标、和平条款（Slice C）。
- 利益集团与内部政治。
- 完整的天命面板（只做最小工具与铁人开关）。
- 重写现有渲染层；在现有 Band / Pane / Report 上增量扩展。

## 2. 当前代码地图

| 文件 | 现在的职责 | 本刀改动 |
| --- | --- | --- |
| `types/index.d.ts` | 世界、国家、UI、状态契约 | 加官僚、建造队列、秘书、会议、铁人；世界版本升到 2 |
| `engine/data.ts` | 国家模板、商品、建筑、事件 | 加 `offices` 建筑；新世界初始化官僚与秘书 |
| `engine/sim.ts` | 月度模拟、行动、事件、战争 | 官僚派生；建造队列结算；军费/失业修正；会议中断检测 |
| `engine/ai.ts` | AI 国家批量决策 | 不变（秘书是独立路径） |
| `engine/save.ts` | 存档、状态行激活 | 加 v1 → v2 迁移 |
| `hooks/register.tsx` | 命令、工具、系统提示、自动推进、渲染 | 去时钟；注册秘书子代理；会议流程；新命令与工具 |
| `view/panels.tsx` | Band / 八标签 Pane / Report | 加“御前”标签、秘书报告、官僚面板、建造队列 |
| `view/format.ts` | 数字与图表 | 加工期/效率格式 |
| `tests/game.test.tsx` | 10 项测试 | 更新即时建造假设；加官僚/队列/会议/迁移测试 |

## 3. 数据模型

### 3.1 官僚效能

```ts
export type Bureaucracy = {
  score: number          // 0..100，平滑后的实际效能
  ceiling: number        // 0..100，由 offices 与政体决定的上限
  actionBudget: number   // 每月秘书可执行的政策数（玩家不受此限）
  fundEfficiency: number // 0.5..1.0，资金到账比例
  delayChance: number    // 0..0.35，项目完成时额外延迟一月的概率
  infoDistortion: number // 0..0.30，月报/事件信息失真概率
}
```

`Country` 增加 `bureaucracy: Bureaucracy`。

官僚效能使用独立的 **行政能力（`administrativeCapacity`）**，不再复用 `infrastructure`。旧的 `infrastructure` 拆成两个标量：

- `transportInfrastructure`（0–100）：铁路每座 +3；影响生产乘数 `0.6 + transportInfrastructure / 160`。
- `administrativeCapacity`（0–100）：官署每座 +1、大学每座 +0.5；进入官僚效能原始分。
- 港口只加市场接入，不加这两个值；旧 `infrastructure` 字段移除。

每月派生（在 `simulateCountry` 末尾、与合法性同批）：

```ts
const govBonus =
  type === '专制君主制' ? -5 :
  type === '君主立宪制' ? 8 :
  type === '共和制' ? 10 :
  type === '民主制' ? 12 :
  type === '寡头制' ? -2 : 0

const raw =
  0.30 * (spending.bureaucracy * 10) +
  0.28 * (literacy * 100) +
  0.18 * administrativeCapacity +
  0.14 * govBonus +
  0.10 * (100 - radicals)

const ceiling = clamp(20 + offices * 3 + govCeilingBonus, 20, 100)
// 专制 +10、君主立宪 +20、共和 +25、民主 +30、寡头 +12、神权 +15

score += (clamp(raw, 0, ceiling) - score) * 0.15
actionBudget = clamp(1 + Math.floor(score / 25), 1, 5)
fundEfficiency = clamp(0.5 + score / 200, 0.5, 1)
delayChance = clamp(0.35 - score / 300, 0, 0.35)
infoDistortion = clamp(0.30 - score / 350, 0, 0.30)
```

初值由 `createWorld` 用同一公式算一次；`offices` 初始：清 4、英 14、法 10、普 8、俄 6、奥 7、美 8、日 4、土 4、西 4。`administrativeCapacity` 初值 = `clamp(20 + literacy * 40 + spending.bureaucracy * 2, 0, 100)`，随后随官署与大学增长。

### 3.2 建造队列

```ts
export type ConstructionProject = {
  id: string
  building: BuildingId
  count: number
  monthsLeft: number
  monthlyCost: number   // 已计入官僚损耗前的账面成本
  progress: number      // 0..1，当月资金完成度
  startedAt: GameDate
}
```

`Country.econ` 增加 `constructionQueue: ConstructionProject[]`。

```ts
export const BUILDING_TIME: Record<BuildingId, number> = {
  farms: 2, mines: 3, factories: 4, railroads: 8,
  ports: 3, universities: 5, barracks: 2, offices: 3,
}
```

`applyDecision('build')` 从“立即落成”改为“入队”：

1. `totalCost = BUILDINGS[id].cost * count`，`months = BUILDING_TIME[id]`。
2. `monthlyCost = totalCost / months`。
3. 若 `treasury < monthlyCost` 拒绝。
4. 推入队列；不立即扣全款。

每月结算（在 `simulateCountry` 中）：

```ts
let budget = spending.construction * 0.8   // 与现有支出公式一致
for (project of queue) {
  const spend = Math.min(budget, project.monthlyCost * (1 - project.progress))
  const effective = spend * bureaucracy.fundEfficiency
  budget -= spend
  treasury -= spend                        // 已花掉，损耗也是真花
  project.progress += effective / project.monthlyCost
  if (project.progress >= 1) {
    project.monthsLeft -= 1
    project.progress = 0
    if (project.monthsLeft <= 0) {
      if (rng.chance(bureaucracy.delayChance)) project.monthsLeft = 1
      else completeProject(...)             // 加建筑、铁路/港口/官署的附带效果
    }
  }
}
```

`offices` 落成时 `administrativeCapacity += 1`，并抬高官僚上限；铁路落成时 `transportInfrastructure += 3`；大学落成时 `administrativeCapacity += 0.5`（不再加交通基础设施）。

### 3.3 秘书与会议

```ts
export type Delegation = {
  internal: boolean    // 预算/税率/建造/科研/事件
  diplomacy: boolean   // 改善/结盟/设对手/赠礼；不含宣战与和约
  months: number       // 本次托管月数
}

export type SecretaryState = {
  delegation: Delegation
  lastReport: string
  lastPlan: string
  isRunning: boolean
  lastRunTick: number
}

export type CouncilState = {
  isOpen: boolean
  report: string
  secretaryReport: string
  isRunning: boolean
}
```

`WorldState` 增加 `secretary: SecretaryState`、`ironman: boolean`；`UiState` 增加 `council: CouncilState`；`TabId` 增加 `'council'`。

## 4. 月度循环（核心流程）

```
[会议打开] → 玩家/秘书下旨 → 玩家批准 → 推进一月 → [会议重新打开]
                         ↘ 托管 N 月 → 连续推进，遇中断才停
```

1. **会议打开**：`advanceGame` 跑完一个月后，若不在托管中，设置 `ui.council.isOpen = true`，写入本月月报；时钟不再存在。
2. **下旨**：玩家通过对话/命令/工具执行行动；秘书在授权领域执行。行动立即写入世界。
3. **批准推进**：关闭会议 → `advanceMonth(world)` → 打开下一次会议。
4. **托管 N 月**：关闭会议，循环推进；每次推进后检查中断条件。
5. **中断条件**（任一命中即停并打开会议）：
   - 玩家有待决事件；
   - 新的战争涉及玩家；
   - 玩家的战争结束；
   - 历史议程达成；
   - 秘书报错、超时或越权审计命中。
6. **移除实时时钟**：删除 `startAuto` / `tickOnce` / `$.clock.every`；`auto.*` 字段保留但不再驱动主循环，只用于兼容旧存档。

## 5. 秘书子代理

### 5.1 注册与调用

在 `session.start`：

```ts
await $.agent.register({
  name: 'secretary',
  description: '终末传奇月度秘书：起草并执行御前会议计划。',
  prompt: SECRETARY_PROMPT,
  tools: [
    'mcp__terminal-legend__v3_status',
    'mcp__terminal-legend__v3_action',
    'mcp__terminal-legend__v3_diplomacy',
    'mcp__terminal-legend__v3_event',
    'mcp__terminal-legend__v3_leader',
    'mcp__terminal-legend__v3_save',
  ],
  model: 'haiku',
  omitClaudeMd: true,
})
```

- 用 `on('agent.offer', { agent: 'terminal-legend:secretary' }, () => ({ isOffered: false }))`
  只隐藏给主模型，插件自己仍可 `$.agent.spawn`。
- 调用：

```ts
const { agentId, deny } = await $.agent.spawn({
  subagentType: 'terminal-legend:secretary',
  prompt: monthlyBriefing(world),
  description: '月度秘书',
})
if (deny) return
const report = await answerOf(agentId)   // turn.complete 的 text，带 240s 超时
```

- `answerOf` 用一个 `Map<agentId, resolve>`，在 `turn.complete` 里结算；超时用 `$.clock.after`。
- 不阻塞会议：会议先打开，秘书报告到了再 `$.ui.toast` 并写入 `ui.council.secretaryReport`。

### 5.2 提示词约束（全量工具 + 提示约束，见 ADR 0001）

`SECRETARY_PROMPT` 必须包含：

1. 你是谁的秘书、当前委托领域（内政/外交）与未委托领域。
2. **禁止**：宣战、停战、推进时间、使用天命、修改存档。
3. 授权内政时：可调税率/支出、排建造、定研究方向、代选事件。
4. 授权外交时：可改善关系、结盟、设对手、赠礼；**不得**宣战或和约。
5. 未授权领域只写建议，不调用工具。
6. 报告用中文，列出“已执行 / 建议 / 风险”三段，简短。
7. 不知道的数字先 `v3_status`，不得编造。

**审计**：所有游戏工具的处理函数里，若 `e.agentId` 非空且调用的是 `v3_advance` / `v3_cheat` / `v3_diplomacy(move=war|peace)`：

1. 向 `world.log` 写一条 `[秘书越权]` 记录；
2. 用 `$.ui.toast` 提示玩家（`秘书越权：<动作>`），会议面板同步显示；
3. **不拒绝调用**（遵守 Q17 的全量工具 + 提示约束）。

若同一局连续出现越权（例如 3 次），再改为运行时拒绝，并记入 ADR 0001 的后续修订。

## 6. 御前会议界面

### 6.1 Band

会议打开时，Band 第一行追加：

```
御前会议 · 待议    [批准并推进] [托管 3 月] [打开议事]
```

未打开时维持现有摘要；状态行追加 `· 待议` 或 `· 已批`。

### 6.2 Pane 新标签 `council`

1. **月报**：最近 8 条编年史。
2. **待决事件**：标题 + 选项按钮（复用现有 `EventsPanel`）。
3. **秘书报告**：`ui.council.secretaryReport`；为空时显示“秘书尚未呈报”。
4. **官僚效能**：`score/ceiling` 进度条；行动预算、资金效率、延迟、失真四项数值。
5. **委托**：内政 / 外交 两个开关；托管月数（1/3/6/12）。
6. **控制**：[批准并推进一月] [托管 N 月] [重新拟旨]。
7. **建造队列**：项目、剩余月数、当月进度条、资金效率。

### 6.3 命令与工具

| 入口 | 行为 |
| --- | --- |
| `/v3 next` | 批准并推进一月 |
| `/v3 council` | 打开御前会议标签 |
| `/v3 delegate internal on|off` | 切换内政委托 |
| `/v3 delegate diplomacy on|off` | 切换外交委托 |
| `/v3 run N` | 托管 N 月 |
| `/v3 secretary` | 立即让秘书拟旨并回报 |
| `v3_advance` 工具 | 仅玩家可调；推进一月并打开会议 |
| `v3_cheat` 工具 | 天命；铁人模式下拒绝 |
| `/v3 cheat ...` | 同上 |

## 7. 经济修正（本刀内完成）

1. 把 `infrastructure` 拆成 `transportInfrastructure` 与 `administrativeCapacity`：生产用前者，官僚用后者；大学不再加交通基础设施。UI 把前者显示为“交通基础设施”、后者显示为“行政能力”。
2. 支出公式加入 `sp.army * 0.5 + sp.navy * 0.5`；军费不再免费。
3. `sp.construction` 由建造队列消费；无项目时作为行政损耗。
4. 失业率动态：
   ```ts
   unemployment = clamp(
     4 + (1 - factories / max(1, popFactor * 3)) * 30 + radicals * 0.15 - literacy * 10,
     0, 30,
   )
   ```
5. `infamy`：每点降低所有国家关系漂移目标 0.1；超过 25 时 AI 更倾向设对手。
6. `authority`：法案通过消耗 5–15 权威，低于 0 时无法通过新法案；每月按合法性恢复。
7. `sphere` 在 Slice C 启用；本刀只在数据层保留。

## 8. 天命与铁人（最小版）

- `v3_cheat` 支持：`treasury`、`techPoints`、`building`、`relations`、`warScore`、`date`、`event`、`leader`。
- `/v3 cheat <action> <args>` 与工具同源。
- `world.ironman`：为真时：
  - `v3_cheat` 返回拒绝；
  - 只允许自动存档 `save.json`，命名存档与 `load` 返回拒绝；
  - 状态行显示 `铁人`。
- `/v3 ironman on|off` 仅在开局第一个月可切换。

## 9. 迁移（v1 → v2）

`migrateWorld(raw)`：

1. `version = 2`。
2. 每国：
   - `transportInfrastructure = economy.infrastructure ?? 25`；
   - `administrativeCapacity = clamp(20 + literacy * 40 + spending.bureaucracy * 2, 0, 100)`；
   - 删除旧 `infrastructure` 字段；
   - `buildings.offices ??= 0`；
   - `econ.constructionQueue ??= []`；
   - `bureaucracy ??= deriveBureaucracy(country)`；
   - `pops.unemployment` 若缺失，按新公式算一次。
3. `world.secretary ??= { delegation: { internal:false, diplomacy:false, months:1 }, lastReport:'', lastPlan:'', isRunning:false, lastRunTick:0 }`。
4. `world.ironman ??= false`。
5. `ui.council ??= { isOpen:false, report:'', secretaryReport:'', isRunning:false }`。
6. 旧 `auto` 字段保留但不驱动循环；旧存档载入后直接进入第一次御前会议。

`loadGame` 先 `JSON.parse`，再 `migrateWorld`，然后校验版本。

## 10. 测试计划

**引擎**

- 官僚：低支出/低识字 → `score` 低、`actionBudget=1`、`fundEfficiency≈0.5`；建官署后 `ceiling` 与 `administrativeCapacity` 上升。
- 基础设施拆分：铁路只加 `transportInfrastructure`；官署/大学只加 `administrativeCapacity`；生产乘数不被官署影响。
- 建造：入队后不立即加建筑；按工期与预算逐月推进；资金不足时暂停；官僚延迟命中时多一月。
- 经济修正：军费计入支出；失业率随工厂/识字变化。
- 会议中断：玩家事件、对玩家宣战、议程达成三种情况各一条。
- 迁移：构造 v1 存档，载入后字段齐全、数值可继续推进。

**渲染**

- `council` 标签在 terminal/desktop 两表面可绘制。
- Band 在会议打开时显示“御前会议 · 待议”。
- 官僚面板与建造队列进度条可绘制。

**端到端**

- `/v3 new` → 第一次会议打开。
- `/v3 next` → 推进一月并重新打开会议。
- `/v3 run 3` → 连续三月或遇中断停止。
- 秘书（mock `$.agent.spawn`）在授权内政时执行一个建造；未授权时不调用行动工具；越权时日志出现 `[秘书越权]`。

## 11. 里程碑

| 里程碑 | 内容 | 完成标准 |
| --- | --- | --- |
| M1 | 类型、数据、迁移、官僚派生 | 新旧存档都能载入；官僚四项约束可见 |
| M2 | 建造队列 + 经济修正 | 建造按工期推进；军费/失业修正生效 |
| M3 | 秘书子代理 + 提示词 + 审计 | 秘书能拟旨/执行；越权有日志 |
| M4 | 御前会议状态 + Band/Pane | 每月暂停；批准/托管可用 |
| M5 | 托管 N 月 + 中断 | 连续推进与自动停止正确 |
| M6 | 天命 + 铁人最小版 | 作弊可用；铁人拒绝 |

Slice B（轻量双边贸易）与 Slice C（外交博弈 + 战争目标）另出计划，依赖本刀的官僚、会议与经济修正。

## 12. 风险与待定

| 风险 | 缓解 |
| --- | --- |
| 秘书全量工具可能越权 | 提示词 + 日志 + toast 提示；连续越权后改运行时拒绝 |
| 自由数值失衡 | 天命/重开；后续按 ADR 0002 引入按幅度计价 |
| 子代理每月调用的成本/延迟 | 便宜档 + 短提示；会议不阻塞；240s 超时 |
| 旧存档字段缺失 | 迁移函数 + 迁移测试 |
| 移除实时时钟改变体验 | 首次会议给出说明；托管 N 月保留“连续感” |
| 建造队列与现有即时建造测试冲突 | 更新测试，明确“入队”语义 |

**待定（实现时确认）**

- 秘书子代理 240s 超时（已定）；会议先开、报告后到，超时则显示“秘书未按时呈报”。
- 越权审计已定：记录日志 + toast 提示，不拒绝；连续 3 次越权再改为运行时拒绝。
- 已定：基础设施拆成 `transportInfrastructure` 与 `administrativeCapacity`；官署 +1 行政能力/座并抬官僚上限，大学 +0.5 行政能力/座，铁路 +3 交通基础设施/座。
