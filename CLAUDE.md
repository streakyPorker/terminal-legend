# terminal-legend 项目约定

## 试玩问题记录（必须）

- 每次试玩（包括 GM 会话）发现**不合理、反直觉、无法解释或明显失衡**的现象，**立即**追加到
  `docs/playtest-issues.md`，不要只留在对话里。
- 每条包含：日期、游戏内日期、存档/种子、现象、数据、判断、关联计划、状态。
- 修好后把状态改为 `fixed` 并注明提交哈希；经济系统问题关联
  `docs/plans/0007-economy-polish.md` 的 E1–E5。

## GM 与引擎的边界

- GM **不得读取** `.terminal-legend/save.json`；状态查询与操作一律通过 MCP 工具
  （`v3_status`、`v3_action`、`v3_diplomacy` 等）。存档是引擎内部表示。
- GM 的**游玩决策**只依据工具返回的状态与世界内信息，不通过阅读引擎源码来推断规则；
  源码只在用户明确要求开发/修复时阅读。
- 需要更多明细时，按 `docs/plans/0006-gm-engine-interface.md` 补 `v3_inspect` /
  `v3_forecast`，而不是绕过工具读档。

## 开发

- 引擎是纯 TypeScript，不依赖渲染层；`view/` 只读世界状态。
- 提交前跑：

```bash
claude plugin validate .
claude plugin test .
```

- 每轮有意义的修改提交后立即推送 `origin/main`（GitCode）。
