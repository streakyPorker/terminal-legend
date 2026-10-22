# GM ⇄ 引擎接口：查询与预测全部走 MCP

- Status: implemented（`v3_inspect` 十六个只读分区、`v3_forecast` 与 `v3_manual` 均已落地；ADR 0016 落地七分区，其余九分区在 GM 接口补全中补齐，现为 16 分区）。每个事实只在一个分区出现：逐建筑行在 `buildings`（不在 `economy`）、贸易路线在 `routes`（不在 `trade`）、各国对比在 `rankings`（不在 `v3_status`）。
- Depends on: ADR 0003（确定性引擎 / LLM 判断边界）、ADR 0005（不做存档兼容）
- Scope: 让主模型（GM）与引擎的所有交互都通过 `$.tool.register` 暴露的 MCP 工具完成；`save.json` 只用于持久化，不再作为 GM 的数据源。世界版本不变。

## 0. 问题

- 当前 GM 在每个回合为了拿到贸易流、供需、建造队列明细，会直接读 `.terminal-legend/save.json`。
- 违反 ADR 0003：存档是引擎内部表示（World v7），GM 不应耦合其字段；世界升级（例如 v8 科技树）会直接打断 GM 的读法。
- 读写可能不一致：GM 读到的可能是一份旧副本，而不是 `$.state` 中的当前世界；并发推进时尤其危险。
- 上下文成本高：一次存档 JSON 很大，GM 需要自己裁剪，容易漏字段或误读。
- 工具边界不完整：`v3_status` 只给摘要，详细数据没有接口，实际上逼着 GM 去读档。

## 1. 原则

1. **GM 不读存档**：`.terminal-legend/*.json` 只由 `engine/save.ts` 读写。
2. **所有查询有工具**：凡是 GM 决策需要的数字，都必须能通过 MCP 工具拿到；工具返回结构化数据 + 简短文本渲染。
3. **所有写入有工具**：保持现有 `v3_action` / `v3_policy` / `v3_diplomacy` 等；GM 不直接改 `$.state`。
4. **世界版本无关**：工具输出是稳定契约（`types/index.d.ts`），存档结构变化不影响 GM。

## 2. 查询接口（建议）

`v3_inspect`：`section` 必填，`country` 可选（默认玩家），`limit` 可选。

| section | 内容 |
| --- | --- |
| `trade` | 本月双边流（exports/imports：good/from/to/quantity/unitPrice/value）、出口收入、进口账单、关税、贸易缺口、支付能力分解（出口收入 + 私人资本 + GDP×3%）、软容量 |
| `market` | 逐商品 production / demand / 有效供给 / 价格 / 进口资源加成 |
| `fiscal` | 收入与支出拆分、净资产与利率、当月净额与实际变动 |
| `construction` | 国有/私人队列、进度、月成本、剩余工期、预算与现金约束 |
| `pops` | 人口结构、识字率、生活水平、激进/忠诚、失业 |
| `diplomacy` | 关系、盟友、对手、禁运、贸易张力、局势 |
| `military` | 陆军/海军、质量、士气、人力、战争 |
| `tech` | 科技等级、点数、研究项、科技速度分解 |
| `modifiers` | 当前修正（来源、stat、stack、值、到期） |
| `log` | 最近日志（可按 kind / country 过滤） |

返回结构：`{ data, text }`；`data` 供 GM 精确计算，`text` 用于对话渲染。

`v3_forecast`：基于当前状态与已排队项目，预估下月收入、常规支出、建设现金需求、贸易缺口与净资产路径（至少 1 个月），并标注瓶颈是现金、预算还是支付能力。

## 3. 系统提示与文档

- `prompt.compose` 注入规则：**不要读取 `.terminal-legend/save.json`；所有状态查询用 `v3_status` / `v3_inspect`。**
- README 工具表新增 `v3_inspect` / `v3_forecast`。
- 测试：
  - 各 section 的 `data` 字段齐全、数值与 `v3_status` 一致；
  - 完整推进一个月，GM 只用工具即可完成决策；
  - 工具输出不依赖存档版本（用内存世界跑）。

## 4. 验收

- 完整跑一个月，GM 不打开任何存档文件。
- `claude plugin validate .` 与 `claude plugin test .` 通过。
- 世界版本升级时，GM 侧工具契约不变。

## 5. 暂不做

- 流式推送 / 订阅；第一期只做按需查询。
- 把引擎拆成独立进程或独立 MCP server；当前 function-hooks 内注册工具即可满足。
- 历史序列的完整导出；先覆盖当月与最近 N 月。

## 6. 后续需求（2026-10-22 试玩新增）

### 6.1 `v3_inspect rankings` 增加「建造力」维度

- **背景**：试玩 QING 时，玩家要求对比“世界强国的建筑力与 GDP”。GDP 可由
  `rankings` 的经济维度直接回答；**建造力却没有分国数据**——只有本国的
  `v3_inspect construction` 可见，GM 无法横向比较，也不允许编造。
- **需求**：在 `rankings` 中新增一维（建议置于「经济」之后）：
  - 各国 `constructionCapacity`（建造点/月）、`idle`（闲置点数）、
    `workshops`（营造所座数）、`subsidy`（建设补贴等级）；
  - 按建造力从高到低排序；
  - 与各国的 `construction` 分区数值一致。
- **验收**：
  - 七国建造力可按序读出，数值与逐国 `v3_inspect construction` 完全一致；
  - 不新增存档字段（全部由既有世界状态派生）。
- **关联**：PT-039、`engine/inspect/rankings.ts`
