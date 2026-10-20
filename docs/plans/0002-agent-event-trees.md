# 下一步：国家国策/事件树 → 多国交互事件树

- Status: **paused**（2026-10-20 决定：经济系统打磨完成前，暂缓多国交互与事件开发；见 `0007-economy-polish.md`）
- Depends on: ADR 0001（秘书子代理）、ADR 0002（自由数值）、ADR 0003（引擎/LLM 边界）、ADR 0004（修正叠算）
- Sequencing: `0003` 经济循环已完成 → `0004` 贸易/外交（v6）→ **`0007` 经济打磨（当前）** → `0005` 科技树 → 本计划的事件树（S1–S4）。科技是横切层，会与事件树的触发条件与效果互相引用。

## 目标

1. **主要大国专属国策/事件树**：每个大国围绕自己的历史议程，拥有一条由「局势 → 提案 → 决策 → 修正」组成的树。
2. **多国交互事件树**：同一局势（东方问题、1848 革命、鸦片贸易、德意志/意大利统一）同时喂给多个国家，各国 agent 分别判断、站队、交易或对抗，引擎合并结果。
3. **不做死模板**：树只定义触发条件、参与者、可用的效果信封与历史上下文；具体选项文本、数值与叙事由各国 agent 根据当前史实生成，引擎校验后落账。

## 非目标

- 固定分支的视觉小说式事件。
- 由 LLM 直接改世界状态（仍走 `applyPolicy` / `addModifier` / `applyDecision`）。
- 在本计划内完成全部树的内容；先做机制与 1–2 条样板线。

## 机制设计

### 1. 局势（Situation）

```ts
export type Situation = {
  id: string
  title: string
  /** 触发：日期窗口、国家状态、已有事件、其他局势的结果。 */
  triggers: ThresholdCondition[]
  participants: string[]
  /** 提供给 agent 的历史上下文（引擎生成，不是模板台词）。 */
  context: (world: WorldState) => string
  /** 允许提交的效果入口与软边界。 */
  envelope: {
    stats: ModifierStat[]
    maxEffects: number
    monthsRange: [number, number]
  }
  /** 回合结构：同时提交、顺序提交，或由某一方发起。 */
  order: 'simultaneous' | 'sequential'
  resolve: 'engine' | 'arbiter-agent'
}
```

### 2. 提案（Proposal）

沿用 `PolicyProposal` 的形状，增加立场与对象：

```ts
export type SituationProposal = {
  countryId: string
  stance: string          // 由 agent 决定，例如「支持」「中立」「趁火打劫」
  narrative: string
  effects: PolicyEffect[] // 对本国
  pressure?: PolicyEffect[] // 对他国/全局，由引擎映射
}
```

- 每个参与国由各自的 agent（玩家用主模型，AI 国家用批量决策模型，或复用秘书）收到同一局势的**本国视角**上下文，输出一份提案。
- 引擎用 `applyPolicy` 同样的校验规则结算；越界、未知 stat、非有限数值直接拒绝并退回确定性兜底。
- `resolve: 'arbiter-agent'` 时，再由一个仲裁 agent 根据各方提案生成结果，但只能选择引擎预置的结果包（`OutcomeId`），不能直接写数值。

### 3. 持久化

```ts
WorldState.situations: {
  id: string
  situationId: string
  date: GameDate
  participants: Record<string, SituationProposal>
  outcome?: string
  isResolved: boolean
}[]
```

### 4. 与现有系统的接口

- **修正**：提案只产出 `Modifier`，经 `applyModifier`（ADR 0004）进入数值；不新增公式特判。
- **阈值**：局势触发可复用 `engine/thresholds.ts` 的条件读取；阈值 buff 与局势 buff 使用不同的 `source` 前缀（`threshold:` / `situation:`）。
- **秘书**：秘书可代表玩家参与授权领域内的局势提案；军事/战争仍由玩家决定。
- **UI**：新增「局势」区域（可并入御前标签），显示各方提案、倒计时与结果；提案到达前不阻塞月度会议。

## 里程碑

| 里程碑 | 内容 | 完成标准 |
| --- | --- | --- |
| S1 | 局势/提案类型、触发与结算、LLM 提案 schema、确定性兜底 | 一场合成局势可由 mock agent 提出提案并结算出修正 |
| S2 | 主要大国各 1 条专属线（优先 GBR、QING、RUS、PRU） | 历史议程推进，产出可叠算修正 |
| S3 | 多国同时提交与冲突结算 | 两个国家在同一局势中站到对立面，结果正确落账 |
| S4 | 事件树 UI 与编年史 | 御前可见提案、结果与来源 |

## 风险

| 风险 | 缓解 |
| --- | --- |
| LLM 提案越界或幻觉数值 | 引擎 schema 校验 + 效果信封 + 确定性兜底 |
| 每局势多次调用导致成本/延迟 | 只在关键节点调用；批量国家共用一次请求；异步到达 |
| 历史感漂移 | 上下文由引擎提供日期、领袖人格、议程、关系与近期事件；叙事由 agent 生成 |
| 存档膨胀 | 已结算局势只保留 id、结果与提案摘要 |
