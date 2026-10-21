# 代码拆分计划（code splits）

- Status: proposed（大 feature 后维护性重构，按 `CLAUDE.md` 的「文件膨胀与拆分」约定）
- Depends on: ADR 0005（不做存档兼容）、`docs/plans/0009-config-refactor.md`（配置分层）、ADR 0024
- 原则: **行为零改动**；拆分**保留桶文件重导出**，既有 import 路径不变；**单独提交**，跑全量测试 + 校验。阈值：**~600 行软警、~900 行硬拆**。

## 0. 现状（2026-10-21，F2 后）

| 文件 | 行数 | 问题 |
| --- | ---: | --- |
| `hooks/register.tsx` | 2153 | 工具 schema + handler + 御前/秘书 + 渲染挂载 + 命令 + 系统提示全挤一起 |
| `engine/data.ts` | 2147 | 所有 catalog 同文件（商品/建筑/科技/事件/领袖/国家/派生） |
| `view/panels.tsx` | 1594 | 十余个面板 + Band + Report 同文件 |
| `engine/actions.ts` | 945 | `applyDecision` 全家桶 + policy + randomDecision |
| `engine/inspect.ts` | 729 | 16 个 inspect 分区同文件 |
| `tests/first-slice.test.ts` | 916 | 承担多个关注点 |
| `tests/economic-loop.test.ts` | 844 | 同上 |
| `engine/trade.ts` 639 / `construction.ts` 644 / `economy.ts` 620 / `liveEvents.ts` 593 | ~600 | 软警，观察 |

## 1. 拆分目标（每项 = 一个独立提交）

### S1 ✅ `hooks/register.tsx` → `hooks/`
- 实际布局：`hooks/{register.tsx,internal.ts,tools.ts,council.ts,render.tsx,prompt.ts,commands.ts}`。
- `hooks/internal.ts` — 共享插件状态与 UI 管线：`getWorld/setWorld/getUi/setUi/patchUi/activeWorld`、`refreshStatus/openPane`、`readProjectDoc`、`pendingOf`、常量（`PANE`/`SECRETARY_AGENT`/超时）、共享标志（`secretaryAnswers`、托管运行标志 getter/setter）。作为各关注点模块的最小依赖层（对应 `engine/internal.ts` 的角色），避免循环依赖。
- `hooks/tools.ts` — `TOOL_SPECS`（14 个 `v3_*` schema，与原文件逐字节相同）+ `tool.call` 处理器 + 白名单（`SECRETARY_TOOLS` 与各 handler 参数 allow-list，**schema 与白名单同文件**，避免历史上「参数漏加白名单」的回归）。
- `hooks/council.ts` — `advanceGame` / `resolveEvent` / 御前与托管循环（`startDelegated`/`runDelegated`/`interruptReason`）/ 秘书 spawn（`askSecretary`/`startSecretary`/`finishSecretary`）/ 越权审计 / `controlGame`/`councilAction`。
- `hooks/render.tsx` — 三个 `ui.render` 挂载（`Panel`/`Band`/`Report`）。
- `hooks/prompt.ts` — `narratorPrompt`（系统提示拼装）与 `statusText`/`statusHint`。
- `hooks/commands.ts` — `/v3` 命令分发（`runV3Command`，约 330 行）。
- `register.tsx`（186 行）— 入口：**所有 `on(...)` 注册仍物理保留在本文件**，从各模块导入处理器接线，保持 `register` 导出；`agent.offer`/`ui.render{Pane}` 的 matcher 字面量内联，使 `claude plugin validate` 仍能解析（导入常量会退化为 `?`）。
- 完成后：`claude plugin test .` 388 pass / 0 fail，`validate` 通过（hook 集与 `.catch` 警告与拆分前一致），注册顺序/工具名/schema/handler 逻辑零改动；迁移函数体经规范化 diff 逐字节一致。
- 软警例外：`hooks/tools.ts` 832 行（>600 软警、<900 硬拆）——schema 与白名单必须同文件（MUST），故不再拆。

### S2 ✅ `engine/data.ts` → `engine/data/`（与计划 0009 §1 一致）
- 实际布局：`engine/data/{goods,buildings,tech,leaders,countries,events,derivations,world}.ts`；**无 `pops.ts`**（原文件无独立人口目录，人口数值在 `COUNTRY_SEEDS`、人口派生在 `derivations.ts`），`createWorld` 归 `world.ts`。
- `engine/data/index.ts` — 桶，**显式具名再导出**旧 `data.ts` 的全部 72 个公共符号（60 值 + 12 类型），`import ... from './data'` 路径不变；原 `engine/data.ts` 已删除。
- 完成后：`claude plugin test .` 388 pass / 0 fail，`validate` 通过，World 仍 v11，行为零改动。最大文件 `countries.ts` 669 行（纯种子数据，未超 900 硬拆线）。

### S3 `view/panels.tsx` → `view/panels/`
- 按面板拆分（overview / council / market / economy / pops / diplomacy / military / tech / events / log / rankings / band / report），`view/panels/index.tsx` 桶。

### S4 `engine/actions.ts` → `engine/actions/`
- 按 action 拆（build / tax / tariff / spending / research / conscript / law / route …）+ `policy` / `randomDecision`；桶重导出。

### S5 `engine/inspect.ts` → `engine/inspect/`
- 每分区一个文件 + `engine/inspect/index.ts` 桶（`INSPECT_SECTIONS` / `inspectWorld` 保留）。

### S6 测试拆分
- `tests/first-slice.test.ts` / `tests/economic-loop.test.ts` 按关注点拆分（引擎/命令/渲染分开）。

## 2. 顺序与依赖

- **等当前功能切片稳定后再做**：F3–F7（建筑扩展）与 E2–E7（实时事件）都可能改 `engine/data.ts`、`hooks/register.tsx`、`engine/actions.ts`、`engine/inspect.ts`——**并发拆分必然冲突**。
- 推荐顺序：**F 系列与 E 系列收口后**，再 S1→S2→S3→S4→S5→S6，每步独立提交、全量测试绿。
- 拆分完成后，后续功能改动落在小文件上，回归面显著缩小。

## 3. 验收

- 每个拆分提交：`claude plugin test .` 全绿、`claude plugin validate .` 通过、**零行为改动**（既有测试断言不变）。
- 拆分后无单文件 > 900 行（软警例外须注明）。
- 桶文件重导出覆盖所有既有公共导出（用 grep 核对调用方 import 不变）。
