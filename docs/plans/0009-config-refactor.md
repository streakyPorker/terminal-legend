# config + 修正块 重构（配置分层与统一乘数机制）

- Status: proposed
- Depends on: ADR 0024（配置分层与修正块，取代 ADR 0004）、ADR 0002/0003（政策数值与边界）、ADR 0021（配方单一真源）、ADR 0022（利用率）、ADR 0023（四税基）、`0008-economy-remake.md`
- Scope: 把散落在各 `engine/*.ts` 的可调数值收进 `engine/config/`，把按域业务数据收进 `engine/data/`，并给所有乘数机制一个统一的 `ConfigBlock` 声明格式。**只做结构与契约迁移**；第一刀行为保持，不升 `WorldState.version`。
- 来源：本轮 grilling 会话已定的 12 条决定（见 ADR 0024）。

## 0. 现状

- `engine/data.ts`（1964 行）同时装着全局常数与业务数据，改一个数字从头翻到尾。
- `engine/thresholds.ts` 有独立的规则格式（`mode`/`conditions`/`modifiers`），与政策、事件、法案各自的效果条目形状不同，同一件事要写多份解析。
- 债务压力、配方门控、科技乘数、威望/合法性公式、战争目标直接效果这些**乘数**都硬编码在各自公式里，绕过 `applyModifiers`，无统一来源。

## 1. 目标与非目标

**目标**

- 可调数字按域内聚；业务数据按域拆分；`./data` 导入路径不变。
- 每个乘数机制 = 一个声明式 `ConfigBlock`，由引擎统一求值。
- 迁移**增量、TDD、每步一个提交**；第一刀（thresholds + policies）用**迁移等价测试**锁死行为。

**非目标**

- 不做 JSON/YAML 覆盖层（已放弃；ADR 0024 §2）。
- 不改 `v3_policy` / `v3_action` / 事件效果的对外 `{stat, stack, value, months}` 形状（引擎内部编译成块）。
- 不在本计划第一刀之内碰债务压力、配方门控等**非修正入口**的乘数（列为 C7）。
- 不升世界版本，除非世界状态结构真的改变。

## 2. 配置分层：文件清单

**全局可调数字 → `engine/config/`**

| 文件 | 收纳的常数（示例，最终以迁移时清点为准） |
| --- | --- |
| `balance.ts` | 全局平衡常数、平滑/钳位系数 |
| `economy.ts` | 需求/消费/工资/利润相关常数 |
| `tax.ts` | 税基税率初值、征收效率与合规参数 |
| `trade.ts` | 贸易摩擦、航线成长/衰退、运输与接入参数 |
| `construction.ts` | 建造点、工程量、造价、补贴参数 |
| `diplomacy.ts` | 关系漂移、恶名、禁运参数 |
| `military.ts` | 陆军/海军、士气、人力参数 |
| `society.ts` | 人口、识字、生活水平、激进/忠诚、合法性参数 |
| `tech.ts` | 科技成本曲线、扩散与溢出参数 |
| `blocks.ts` | 域注册表的聚合与块校验入口 |

**按域业务数据 → `engine/data/`**

| 文件 | 内容 |
| --- | --- |
| `goods.ts` | 商品、基价、消费品、生存量、收入弹性 |
| `buildings.ts` | 建筑、配方、建造时间、造价 |
| `tech.ts` | 科技表与命名 |
| `events.ts` | 事件模板 |
| `leaders.ts` | 领袖模板 |
| `countries.ts` | 国家种子、政府类型 |
| `pops.ts` | 人口/阶层派生参数 |
| `regions.ts` | 区域、运输矩阵、资源禀赋 |

**桶文件**：`engine/data/index.ts` 把以上域模块**原样再导出**，`import ... from './data'` 不变。

## 3. 配置块契约

块的字段、`Condition` / `ScaleSpec` / `Curve` / `EffectSpec` 的形状、生命周期与求值规则，**以 ADR 0024 §3–§6 为准**，本计划不重复。要点：

- 块 `potential_trigger` 与 effect `potential_trigger` **AND 相连**。
- `scales_with` **缩放效果幅度**（曲线输出取积，带可选钳位）。
- 生命周期 `while` / `once` / `duration`；`duration` 必填 `months`。
- 每月求值一次；`scales_with` 在消费层（`applyModifiers` 接缝）应用；**不跨月缓存**。
- `source = <block.id>`；`scales_with.stat` 与效果入口共用 `ModifierStat`。

## 4. 迁移里程碑（TDD）

每步一个独立提交，测试全绿再进下一步。「行为保持？」列指该切片是否要求**逐位等价**；不等价的必须列明变更点。

| 里程碑 | 内容 | 行为保持？ | 护栏测试 |
| --- | --- | --- | --- |
| **C1** ✅ | 立块引擎（`ConfigBlock` 类型 + 求值器 + 域注册表 + 全局聚合）；把 `engine/thresholds.ts` 的规则迁成块，拆除旧 `while`/`once` 路径 | 是 | 迁移等价测试：对多个种子 × 月的**触发块集合**与**最终修正值**逐位等于旧 `evaluateThresholds`；配置不变量测试（id 唯一、stat 合法、曲线有序、`scales_with.stat` 真实） |
| **C2** | `policies` 迁到块；`v3_policy` 的 `{stat, stack, value, months}` 入口编译成块 | 是 | 迁移等价：相同政策提议产生相同的 `country.modifiers` 集合与 `applyModifiers` 结果；权威计价/维护费/同 id 覆盖行为不变（ADR 0002） |
| **C3** | `events` 的 `effects.modifiers` 迁到块 | 是 | 迁移等价：事件选项结算产生的修正与旧路径一致；重复触发不无限叠加 |
| **C4** | `situations` 迁到块 | 是 | 迁移等价：局势结果包的效果落账一致 |
| **C5** | `tech` 迁到块 | 是 | 迁移等价：科技解锁/加成路径产生的修正一致 |
| **C6** | `war`（战争目标）与 `laws` 迁到块 | 是 | 迁移等价：宣战/停战/法案各自安装的修正集合一致 |
| **C7** | **非修正入口的乘数迁移**（见下） | **混合**（见下） | 逐项：能等价则等价测试；若有行为变更则记录并加新基线 |

**C7 明细（必须是谨慎的、单独测试的迁移）**

| 对象 | 位置 | 迁移性质 | 处理 |
| --- | --- | --- | --- |
| 债务压力 `debtPressure` | `engine/fiscal.ts` | **行为迁移**（不是修正入口） | 用等价测试锁死 `severity`/`penalty` 数值；若纳入块，须先证明平台值不变 |
| 配方门控 `gates` | `engine/data.ts` 的 `RecipeGates` | **行为迁移** | 先立等价测试复现旧门控乘数，再决定是否块化 |
| 科技乘数 `techMultiplier` | `engine/internal.ts` | **行为迁移** | 同上，逐位等价优先 |
| 威望 / 合法性公式 | `engine/*.ts` | **行为迁移** | 若必须改口径，显式记录行为变更并加新基线 |
| 战争目标直接效果 | `engine/diplomacy.ts` | **行为迁移** | 区分「已是修正」与「直接改数」两种，前者机械迁移、后者记行为变更 |

**C1 的首要动作**：先写迁移等价测试（红），再实现块引擎到绿，最后删旧路径。测试断言「旧规则集」与「块求值结果」在固定种子上一一对应。

**C1 完成记录（本切片）**

- 新增类型 `ConditionStat` / `Condition` / `Curve` / `ScaleSpec` / `EffectSpec` / `ConfigBlock`（`types/index.d.ts`）。
- 块引擎 `engine/blocks.ts`：`evaluateBlocks`（`while`/`once`/`duration`）、`validateBlockConfig`、`testCondition`；域注册表 `engine/config/blocks.ts` + `engine/config/blocks/thresholds.ts`（9 条，1:1，`source` 仍为 `threshold:<id>`）。
- `scales_with` 消费接缝在 `engine/scale.ts`（`curveOutput` / `scaleProduct` / `effectiveModifierValue`），由 `engine/modifiers.ts` 的 `totalsFor` 调用；ADR-0004 叠算公式未改。`engine/thresholds.ts` 退化为瘦适配器（`evaluateThresholds` / `logThresholds` 保持）。
- `WorldState.version` **未**提升。测试 `tests/config-blocks.test.ts`（13 例）全绿，`claude plugin test .` 254 pass / 0 fail。
- 行为保持要点：触发块集合与最终修正值用**冻结的旧算法副本**逐位比对（合成状态 + 3 种子 × 18 月 × 全国家）。

## 5. 验收

- `engine/config/` 与 `engine/data/` 按 §2 就位；`engine/data/index.ts` 为桶文件，`./data` 导入路径不变。
- C1–C6 的迁移等价测试全绿；C7 每项有等价测试或显式记录的行为变更。
- 配置不变量测试全绿（id 唯一、stat 合法、曲线有序、`scales_with.stat` 真实）。
- `v3_policy` / `v3_action` / 事件效果对外形状未变。
- 第一刀未升 `WorldState.version`；`claude plugin test .` 与 `claude plugin validate .` 全绿。

## 6. 风险

| 风险 | 缓解 |
| --- | --- |
| 块格式装不下某些机制的边角 | 先用 C1 的等价测试暴露差距；装不下的留 C7 精处理，不硬塞 |
| `scales_with` 每层求值开销 | 无缓存是确定性取舍；先测性能，必要时在**单月内**局部 memo，不跨月 |
| 迁移等价测试掩盖顺序差异 | 断言**触发块集合**与**最终修正值**两者，不只看最终值 |
| `data.ts` 拆桶破坏导入 | 桶文件保证路径不变；一次只搬一个域，逐提交验证 |
| 非修正乘数被误当机械迁移 | C7 单列，强制「等价测试或记录行为变更」二选一 |
| 曲线上界缺失导致数值爆炸 | `Curve` 的 `min`/`max` 可选钳位；配置不变量测试覆盖参数合理性 |

## 7. 待定

以下未在 ADR 0024 定死，迁移中再定夺，**不预先猜**：

- **ConditionStat（C1 已决定）**：ADR 0024 §6 说条件与效果共用 `ModifierStat`，但阈值条件实际要读非 `ModifierStat` 的原始读数（`debtRatio`、`factories`、`treasury`、`debt`、`army`、`navy`、`techLevel`）。C1 新增小联合 `ConditionStat = ModifierStat | 上述额外读数`，不做有损映射，**不静默丢条件**。`scales_with.stat` 与 `effects[].stat` 仍严格用 `ModifierStat`。后续若 `ModifierStat` 扩充到覆盖这些读数，可把 `ConditionStat` 收敛回 `ModifierStat`。
- `situation` / `tech` / `war` / `law` 各自的块适配器细节。
- 块在 `v3_inspect` 中的只读展示形态。
- `duration` 到期移除的编年史日志口径（是否沿用 `tickModifiers` 写法）。
- `Curve` 的 `steps` 在 `at` 缺失时的默认取值。
- C7 各项「是否真的块化」，还是仅收敛到 `config/` 模块但不进 `ConfigBlock`。

## 8. 暂缓

- `0005-tech-tree.md` 科技树 v8、`0002-agent-event-trees.md` 事件树：仍按既有计划排期，本重构只提供底层词汇，不改其内容。
