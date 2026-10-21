# 配置分层与修正块（config + modifier blocks）

- Status: accepted
- Supersedes: `0004-modifier-stacking.md`（叠算规则原样保留并折入本文；0004 标记为 superseded）
- Depends on: `docs/plans/0009-config-refactor.md`、ADR 0002/0003（政策数值与边界）、ADR 0021（配方单一真源）、ADR 0022（利用率）、ADR 0023（四税基）
- Scope: 把散落在各 `engine/*.ts` 里的可调数值与乘数机制，收进一层按域划分的**配置模块**，并给所有「乘数机制」一个统一的**配置块**声明格式。本 ADR 只定结构契约，不改任何引擎代码、不迁移任何现有数值。

## 背景

今天的可调数值与乘数机制散在很多地方，彼此没有统一词汇：

- 全局常数（基价、配方系数、税率初值、门控系数）与**业务数据**（国家种子、商品、建筑、科技、领袖、事件模板）混在同一个 `engine/data.ts`（1964 行）里，改一个数字要在上千行里找。
- `engine/thresholds.ts` 自有一套规则格式（`mode: 'while' | 'once'`、`conditions`、`modifiers`），与政策、事件、法案各自提交的效果条目**形状不同**；同样是「满足条件就给修正」，却要写三份解析。
- 不少**乘数**根本不是修正引擎条目，而是各自公式里的硬编码特判：债务压力（`engine/fiscal.ts` 的 `debtPressure`）、配方门控（`data.ts` 的 `RecipeGates`）、科技乘数（`internal.ts` 的 `techMultiplier`）、威望/合法性公式、战争目标的直接效果。它们无法用 `applyModifiers` 统一叠算，也读不到统一来源。

EU5 式做法的启发是：**把「可调数值」和「触发条件 → 效果」都变成声明式数据**，引擎只负责求值。这样新增政策、事件、法则、战争目标是「加一条数据」，而不是「改一个公式」。本 ADR 把这件事的两层钉死：**配置分层**（数字放哪）与**配置块**（机制怎么写）。

## 决定

### 1. 配置分层（layered-hybrid layout）

数值分两类，各归其位：

- **全局可调数字** → `engine/config/{balance,economy,tax,trade,construction,diplomacy,military,society,tech,blocks}.ts`。
- **按域的业务数据** → `engine/data/{goods,buildings,tech,events,leaders,countries,pops,regions}.ts`。
- 今天的 `engine/data.ts` 变成**桶文件**：`engine/data/index.ts` 把上面这些域模块**原样再导出**，因此既有的 `import ... from './data'` 路径**全部不变**。

`engine/*.ts` 模块按域 `import` config，不再从一个大杂烩里取常数。

### 2. 纯 TypeScript（无 JSON/YAML）

config 一律是 `export const X: Type = {...}` 的 TS 模块。**不使用 JSON/YAML**；早先设想的「JSON 覆盖层」目标**已放弃**。因此**不**启用 `resolveJsonModule`。

好处是：类型即校验，编辑器可跳转，非法值在编译期就报；代价是不支持运行时热改外部文件（见「代价」）。

### 3. 标准块（ConfigBlock）

每一个**乘数机制**都是一个块，统一为：

```ts
type ConfigBlock = {
  id: string            // 带命名空间：'threshold:stability'、'policy:<name>'、'event:<id>' ...
  kind: 'threshold' | 'policy' | 'event' | 'situation' | 'tech' | 'war' | 'law'
  label: string
  description?: string
  potential_trigger: Condition[]   // 声明式条件列表，AND 相连
  lifecycle: 'while' | 'once' | 'duration'
  months?: number                   // lifecycle === 'duration' 时必填
  scales_with: ScaleSpec[]          // 曲线输出之积，缩放效果幅度
  effects: EffectSpec[]             // 每条 effect 可自带 potential_trigger
}
type Condition = { stat: ModifierStat; op: '>' | '>=' | '<' | '<=' | '==' | '!=' ; value: number }
type ScaleSpec = { stat: ModifierStat; curve: Curve }
type Curve =
  | { kind: 'linear'; slope: number; offset?: number; min?: number; max?: number }
  | { kind: 'steps'; points: { at: number; value: number }[]; min?: number; max?: number }
type EffectSpec = { stat: ModifierStat; stack: ModifierStack; value: number; label?: string; months?: number; potential_trigger?: Condition[] }
```

- 块的 `potential_trigger` 与每条 effect 的 `potential_trigger` **AND 相连**：两者都成立，该 effect 才生效。
- `scales_with` **缩放效果的幅度**（各条曲线的输出取积）；曲线各自的 `min`/`max` 是可选钳位，用来防止数值爆炸。

### 4. 生命周期

三种 `lifecycle`：

- `while`：条件成立期间持有，条件消失即移除。
- `once`：首次触发即**永久**保留。
- `duration`：持续 N 个月（`months` 必填）。

这套语义**统一并取代** `engine/thresholds.ts` 现有的 `while` / `once` 规则。

### 5. 求值

- 块的生命周期**每月求值一次**（与今天的 `evaluateThresholds` 同节奏），落成 `Modifier`，其 `source = <block.id>`。
- `scales_with` 在**消费该 stat 的那一层**应用（即现有 `applyModifiers` 的接缝），不做逐月缓存。
- **不做跨月缓存**：确定性优先，每次读取都从当前世界状态算出结果。

### 6. 缩放依据的 stat 词表

`scales_with.stat` 与 `potential_trigger.stat`、`effects[].stat` 共用同一个 `ModifierStat` 联合类型（`types/index.d.ts`）。**效果入口与缩放依据共用一套词表**，不新建平行枚举。

### 7. 域注册表

每个域一个注册表，其中的块用 `kind` 与带命名空间的 `id` 标注。另提供一个**全局聚合**（把各域注册表并起来），专供**校验**使用（唯一 id、stat 合法、曲线参数有序等）。

### 8. 工具契约不变

`v3_policy` / `v3_action` / 事件效果的**对外入口形状维持现状**：仍是 `{stat, stack, value, months}`。引擎内部把这些条目**编译成块**；GM 与玩家面向的契约保持稳定，不随内部重构而变。

### 9. 叠算语义保留

ADR 0004 的叠算顺序**原样保留**，只是折入本文：

```
(base + Σflat) × (1 + Σpercent / 100) × Π(1 + multiply / 100)
```

`flat` 相加、`percent` 相加成一个乘数、`multiply` 逐个相乘；同 `id` 覆盖。ADR 0004 的其余规则（存量/流量口径、来源审计）继续有效。**ADR 0004 标记为 superseded**，其 Status 行指向本文。

### 10. 迁移策略（增量、TDD）

增量迁移，每一步测试全绿：

1. 第一刀 = `thresholds` + `policies` 迁到块，配**迁移等价测试**（触发的块集合与最终修正值必须与旧系统一致）。
2. 之后依次：`events` → `situations` → `tech` → `war goals` → `laws`。
3. **每一步一个独立提交**，测试全绿再进下一步。

### 11. 护栏

- TypeScript 类型。
- **配置不变量测试**：id 唯一；每个 `stat` 都是合法的 `ModifierStat`；曲线参数合理且有序（`steps.points` 按 `at` 递增）；每个 `scales_with.stat` 都是真实存在的来源。
- **迁移等价测试**（第一刀起）。

### 12. 世界版本

第一刀是**行为保持**的：**不**提升 `WorldState.version`，除非**世界状态结构**真的改变。这是明确意图：结构迁移不该触发存档版本升级（ADR 0005）。

## 代价与权衡

- **无 JSON 覆盖层**：放弃运行时用外部文件覆盖数值的能力；改数值要改 TS 并重编译/热重载。换来的是编译期校验与可跳转。
- **多一层间接**：常数从「就地一个数字」变成「`config/` 里一个具名导出」，读代码要跳一次；但换来的是按域内聚与唯一真源。
- **块格式先立后用**：本 ADR 只定契约，`situation` / `tech` / `war` / `law` 的适配器尚未落地；在新格式真正吃下这些域之前，`ConfigBlock` 是**目标形态**而非既成事实（见下节）。
- **`data.ts` 变桶**：`engine/data/index.ts` 只是再导出，短期看似多一层；但保证了 `./data` 导入路径不变，迁移不必同时改所有 import。

## 本 ADR 未覆盖（NOT covered yet）

以下**今天已是「乘数」但并非修正引擎条目**的东西，不属本 ADR 的机械迁移，而是**行为迁移**，留待计划 0009 的后期切片单独处理，每条要么有等价测试、要么显式记录行为变更：

- 债务压力 `debtPressure`（`engine/fiscal.ts`）。
- 配方门控 `gates`（`engine/data.ts` 的 `RecipeGates`）。
- 科技乘数 `techMultiplier`（`engine/internal.ts`）。
- 威望 / 合法性公式。
- 战争目标的直接效果。

尚未在本 ADR 定死、需在后续切片中定夺的事项（计划 0009 标为「待定」）：

- `situation` / `tech` / `war` / `law` 各自的块适配器细节。
- 块在 `v3_inspect` 中的只读展示形态。
- `duration` 到期移除的日志口径是否沿用 `tickModifiers` 的编年史写法。
- 曲线 `steps` 缺失 `at` 时的默认取值。
