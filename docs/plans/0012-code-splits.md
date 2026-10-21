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

### S1 `hooks/register.tsx` → `hooks/`
- `hooks/tools.ts` — `TOOL_SPECS` + `tool.call` handlers + 白名单。
- `hooks/council.ts` — `advanceGame` / 御前 / 托管 / 中断 / 秘书 spawn。
- `hooks/render.tsx` — `ui.render` 挂载（Band / Report / Pane）。
- `hooks/prompt.ts` — `prompt.compose` 与系统提示拼装。
- `register.tsx` → 入口 + 桶重导出（保持 `register` 导出）。

### S2 `engine/data.ts` → `engine/data/`（与计划 0009 §1 一致）
- `engine/data/{goods,buildings,tech,events,leaders,countries,pops,derivations}.ts`
- `engine/data/index.ts` — 桶，`import ... from './data'` 路径不变。

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
