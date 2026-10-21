# 代码拆分计划（code splits）

- Status: done（S1–S6 全落地：`hooks/register.tsx`、`engine/data.ts`、`view/panels.tsx`、`engine/actions.ts`、`engine/inspect.ts` 拆桶，测试按关注点分文件；行为零改动、桶重导出，388 测试 / 41 文件）
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
| `tests/first-slice-*.test.ts` | 916（拆分前为单文件） | 承担多个关注点 |
| `tests/economic-loop-*.test.ts` | 844（拆分前为单文件） | 同上 |
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

### S3 ✅ `view/panels.tsx` → `view/panels/`
- 实际布局：`view/panels/{shared,overview,council,market,economy,pops,diplomacy,military,tech,events,log,rankings,band,report,panel}.tsx` + `index.tsx` 桶；原 `view/panels.tsx` 已删除（`moduleResolution: bundler` 下 `./panels` 解析到 `panels/index.tsx`）。
- 按面板拆分：overview / council / market / economy / pops / diplomacy / military / tech / events / log / rankings 各一文件；`band.tsx`（`Band`）、`report.tsx`（`Report` + `TurnReport`）、`panel.tsx`（`Panel` 标签分发 + `TABS`）。
- `view/panels/shared.tsx` — 叶共享模块：类型（`UiKit`/`ControlAction`/`CouncilAction`/`CouncilHandlers`/`PanelProps`/`BandProps`/`ReportProps`）+ 共享 UI 原语（`Heading`/`StatLine`/`Meter`/`TableRow`）+ 共享助手（`playerOf`/`pendingOf`/`partnerTotals`）+ 御前与外交复用的 `SituationCard` + `PanePlaceholder`/`helpText`。各面板只依赖 `shared`、`view/format` 与 `engine/*`，无循环。
- `view/panels/index.tsx` — 桶，重导出旧 `panels.tsx` 的全部 14 个公共符号（7 类型 + `Panel`/`Band`/`Report`/`PanePlaceholder`/`helpText` + 从 `view/format` 转出的 `eventSummary`/`clampText`），`import ... from '../view/panels'` 路径不变。
- 完成后：`claude plugin test .` 388 pass / 0 fail（含 11 标签 × 2 surface 的渲染测试），`validate` 通过（警告与拆分前一致）；24 个具名函数体 + `TABS` + `playerOf` 经规范化 diff 与旧文件逐字节一致，导出集无缺无多，渲染零改动。最大文件 `economy.tsx` 240 行（远低于 600 软警）。

### S4 ✅ `engine/actions.ts` → `engine/actions/`
- 实际布局：`engine/actions/{types,build,tax,tariff,spending,research,invest,conscript,law,diplomacy,route,situation,event,play,policy,random,interrupt,decision}.ts` + `index.ts` 桶；原 `engine/actions.ts` 已删除（`moduleResolution: bundler` 下 `./actions` 解析到 `actions/index.ts`）。
- 按 action 拆分：build（含 cancel）/ tax（含 `taxMenuText`）/ tariff / spending / research / invest / conscript / law（含 `installLawModifier`、`LAW_AUTHORITY_COST`）/ diplomacy（含 `relationLine`）/ route / situation / event / play；`policy.ts`（`applyPolicy` + `POLICY_FLAT_SCALE`/`flatScale`）、`random.ts`（`randomDecision`）、`interrupt.ts`（`councilInterrupt`）。
- `decision.ts` — `applyDecision` 调度器（保留 `country === undefined` 守卫与未知行动兜底），逐 action 转发到对应处理器；`types.ts` 为叶模块（处理器共享的 `ActionResult`/`ActionParams`）。
- `index.ts` — 桶，重导出旧 `actions.ts` 的全部 6 个公共符号（`FREE_TRADE_TARIFF_FLOOR`/`taxMenuText`/`applyDecision`/`applyPolicy`/`randomDecision`/`councilInterrupt`），`import ... from './actions'` 路径不变。
- 完成后：`claude plugin test .` 388 pass / 0 fail，`validate` 通过（警告与拆分前一致）；14 个 action case body 经「去缩进 + 剔除重算的 tag 行」规范化 diff 与旧文件逐字节一致，`relationLine`/`installLawModifier`/`taxMenuText`/`applyPolicy`/`flatScale`/`randomDecision`/`councilInterrupt` 与 `LAW_AUTHORITY_COST`/`POLICY_FLAT_SCALE` 逐字节一致（`applyPolicy` 仅返回类型标注由 `{ ok: boolean; text: string }` 改为等价别名 `ActionResult`），导出集无缺无多，World 仍 v11，行为零改动。

### S5 ✅ `engine/inspect.ts` → `engine/inspect/`
- 实际布局：`engine/inspect/{shared,economy,fiscal,labor,trade,market,construction,military,history,pops,diplomacy,tech,modifiers,log,buildings,routes,rankings,forecast}.ts` + `index.ts`；原 `engine/inspect.ts` 已删除（`./inspect` 解析到 `inspect/index.ts`）。
- 每分区一个文件（16 个 `v3_inspect` 分区各一）；`shared.ts` 为叶共享层（`n`/`signed`/`pct`/`monthsBefore`/`fmtDate`/`warFor`/`warBetween`/`basket` 与 `InspectOptions`）；`forecast.ts` 承载 `forecastWorld`。
- `index.ts` — 保留 `INSPECT_SECTIONS` / `InspectSection` 与 `inspectWorld` 调度器，并重导出 `forecastWorld` / `InspectOptions`；旧 `inspect.ts` 的全部 5 个公共符号（`INSPECT_SECTIONS`/`InspectSection`/`InspectOptions`/`forecastWorld`/`inspectWorld`）导出集无缺无多，`import ... from '../engine/inspect'` 路径不变。
- 完成后：`claude plugin test .` 388 pass / 0 fail，`validate` 通过（警告与拆分前一致）；16 个 section 函数 + `forecastWorld` + `inspectWorld` + 8 个 `shared` 助手经规范化 diff 与旧文件逐字节一致，World 仍 v11，行为零改动。最大文件 `index.ts` 121 行（远低于 600 软警）。

### S6 ✅ 测试拆分
- `tests/first-slice-*.test.ts`（拆分前为单文件 930 行）→ 4 个按关注点分文件，原文件删除：
  - `first-slice-data.test.ts` — M1 类型 / 数据 / 存档迁移（5 用例）。
  - `first-slice-engine.test.ts` — M2 建造队列与经济、M3 简报、M4/M5 中断判定、M6 天命动作等纯引擎用例（16 用例）。
  - `first-slice-modifiers.test.ts` — buff/debuff 叠算、政策 / 阈值 / 事件修正来源、存量/流量语义（10 用例）。
  - `first-slice-commands.test.ts` — M3 秘书、M4/M5 托管、M6 铁人与 `v3_manual` 的命令/hook 面用例（9 用例），并携带 `setupSurface` / `startCampaign` 脚手架。
- `tests/economic-loop-*.test.ts`（拆分前为单文件 856 行）→ 4 个按关注点分文件，原文件删除：
  - `economic-loop-gdp.test.ts` — 支出法 GDP / Stone-Geary / 要素份额 + 需求冲击回路（5 用例）。
  - `economic-loop-investment.test.ts` — 私人资本、私人项目节奏与投资评分（4 用例）。
  - `economic-loop-resources.test.ts` — 资源禀赋与 0.7–1.3 乘数带（2 用例）。
  - `economic-loop-regressions.test.ts` — E4/E5 AI 批处理与确定性 + Round 1–3 回归守卫（29 用例）。
- 完成后：`claude plugin test .` 388 pass / 0 fail（跨 41 个文件，原 35 + 6），`validate` 通过（警告与拆分前一致）；被搬运的 80 个用例（first-slice 40 + economic-loop 40）逐字节原样迁移，仅调整各文件的 import 头与（跨 describe 拆分处的）describe 归并，断言零改动；World 仍 v11。最大文件 `economic-loop-regressions.test.ts` 597 行（<600 软警）。

## 2. 顺序与依赖

- **等当前功能切片稳定后再做**：F3–F7（建筑扩展）与 E2–E7（实时事件）都可能改 `engine/data.ts`、`hooks/register.tsx`、`engine/actions.ts`、`engine/inspect.ts`——**并发拆分必然冲突**。
- 推荐顺序：**F 系列与 E 系列收口后**，再 S1→S2→S3→S4→S5→S6，每步独立提交、全量测试绿。
- 拆分完成后，后续功能改动落在小文件上，回归面显著缩小。

## 3. 验收

- 每个拆分提交：`claude plugin test .` 全绿、`claude plugin validate .` 通过、**零行为改动**（既有测试断言不变）。
- 拆分后无单文件 > 900 行（软警例外须注明）。
- 桶文件重导出覆盖所有既有公共导出（用 grep 核对调用方 import 不变）。
