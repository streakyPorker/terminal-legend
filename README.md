# 终末传奇 · Terminal Legend

一个运行在 **Claude Code 终端里**的维多利亚 3 式大战略模拟。它不是独立游戏，而是 Claude Code
的一个 function-hooks mod：引擎是种子化的纯 TypeScript，负责可计算的数值（经济、市场、人口、
财政、科技、军事、外交、战争、事件）；LLM 负责不可计算的判断与叙事（非玩家国家每月一次领袖
决策，主模型扮演主要大国与你谈判）。月度御前会议是节奏开关，秘书子代理可代你起草并执行内政/
外交。三重界面：底部 HUD、输入框上方的仪表盘、`/v3 panel` 的完整面板。

> 门面即本 README。**「模拟如何运转」的实现细节集中在 `docs/architecture.md`**（单一真源）；
> 术语以 `GLOSSARY.md` 为准；GM 机制参考见 `docs/gm-handbook.md`；决策背景见 `docs/adr/`。

## 快速开始

**全局安装（可一键开关）**：

```text
/plugin install terminal-legend --marketplace https://gitcode.com/streakyPorker/terminal-legend.git
```

装好后用 `/plugin disable terminal-legend` / `/plugin enable terminal-legend`
（或 `claude plugin disable|enable terminal-legend`）在任意会话里开关；本地开发仍可用 dev-mods 热重载。

在本 mod 所在的 Claude Code 会话里（或 `claude --plugin-dir <这个目录>`）：

```text
/v3 new            以大清开局（1836 年 1 月），御前会议立即开始
/v3 new FRA        以法国开局（GBR, FRA, PRU, RUS, AUS, USA, JAP, OTT, SPA 均可）
/v3 next           批准并推进一月
/v3 run 6          后台托管六个月，遇中断即停
/v3 stop           手动停下正在进行的托管（本月结束后生效）
/v3 council        打开御前议事
/v3 rankings       查看列强经济/人口/军事/科技/外交排名
/v3 secretary      让秘书拟旨（命令立即返回，报告稍后到达）
/v3 delegate internal on     授权秘书处理内政（diplomacy 同理）
/v3 panel          打开完整面板
/v3 status         查看世界状态
/v3 events         查看待决事件
/v3 cheat treasury 100       天命（铁人模式禁用）
/v3 ironman on     铁人模式（仅开局第一个月）
/v3 save           保存（默认 .terminal-legend/save.json）
/v3 load           读取
/v3 play RUS       切换扮演俄国
/v3 end            结束本局
```

也可以直接用自然语言：

> 在广东再建两座工厂，把关税提到 15%，然后问问英国的维多利亚女王愿不愿意签一份贸易协定。

Claude 会先调用 `v3_status` 核对数字，再调用 `v3_action` / `v3_diplomacy`；推进时间需要你明确
批准（或者托管）。面板是只读仪表盘（ADR 0031 §8）：建造、升级、研究、税率等操作都通过对话下令
（`v3_action` 等工具），面板只保留建造队列的取消/重排。

## 工具（模型可调用）

| 工具 | 用途 |
| --- | --- |
| `v3_status` | 完整世界状态、本国财政/人口/军力/科技、待决事件、战争、官僚与建造队列（各国对比见 `v3_inspect rankings`） |
| `v3_inspect` | 只读明细：economy/market/fiscal/labor/trade/routes/buildings/construction/military/pops/diplomacy/tech/modifiers/rankings/log/history |
| `v3_forecast` | 下月现金流预估（收入、支出、净额、结算后国库） |
| `v3_manual` | 返回 GM 机制手册（`docs/gm-handbook.md`），无需打开文件 |
| `v3_advance` | 批准推进一月；months>1 视为托管并检测中断 |
| `v3_control` | 运行控制：`action=stop` 当前月结束后打断托管；`action=save` 存档（**秘书无此授权**） |
| `v3_cheat` | 天命：金钱/科技点/建筑/关系/战争分数/日期/事件/领袖（铁人禁用） |
| `v3_action` | 建造（`build building/count`，可带 `position`/`before`）、取消（`cancel projectId` 或 `index`）、重排（`reorder`）、税基税率（`tax base`）、关税、支出、研究、征兵、法案、贸易航线 |
| `v3_policy` | 提交政策提议：一组效果条目变成可叠算的 buff/debuff |
| `v3_diplomacy` | 改善/交恶/结盟/设对手/赠礼/宣战/停战（胜方停战时可声明赔款总额与最长分期月数） |
| `v3_event` | 列出或处理待决事件 |
| `v3_leader` | 记录与某国领袖的交流，调整情绪与关系，暂停该国后台 AI |
| `v3_play` | 切换玩家国家 |
| `v3_save` | 保存 |

**建造编排（ADR 0027，面板自 ADR 0031 §8 起只读）**：御前面板与经济面板共享一个建造面板——
「可建建筑」清单按 6 族只读列出全部 23 类建筑，下单一律在对话中下令（`v3_action build` /
`upgrade`）；「建造队列」逐条给出 `#index`、`id`、进度与 `取消`/`↑`/`↓`/`置顶`（私人条目
可见但无控制）。GM 侧对应 `v3_action build` 的
`position`(head/tail/before/after)+`before`、`v3_action cancel` 按 `projectId` **或** 1-based
`index`、以及 `v3_action reorder`；重排**保留已投入进度**，引擎分配逻辑不变。

## 世界模型（摘要）

- 10 个国家、18 种商品、23 种建筑（生产建筑分 **I–V** 级、IV/V 级消耗电力）、6 类支出、**4 时代 / 22 节点科技树**（通用 5 + 工业 7 + 行政 5 + 军事 5）；每月一次结算，逐月原地推进。
- GDP 按支出法 C+I+G+NX 核算；税收来自四个真实税基（土地/企业利润/消费/关税），GDP 只作派生指标。
- 建造靠营造所产出的建造点，队列顺位施工；贸易有持久航线与双向关税；国库是带符号的净资产。
- 世界结构变化会提升 `WorldState.version`，旧存档直接拒绝（ADR 0005）；当前 **v14**。

> 结算流水线、建筑配方与逐建筑利润、建造能力公式、到岸价与航线、净资产财政与债务压力、
> 四税基公式、修正叠算、完整文件树——全部细节见 **[`docs/architecture.md`](docs/architecture.md)**。

## 项目结构（顶层）

```
/home/developer/gaming/terminal-legend/
├── .claude-plugin/plugin.json   ← 插件清单
├── hooks/register.tsx           ← 热重载入口
├── engine/  view/  types/  tests/  statusline/
└── .terminal-legend/save.json   ← 存档（已 gitignore）
```

会话热重载入口是 `~/.claude/dev-mods/<session>/terminal-legend`（指向本目录的符号链接）——
直接改本目录文件即可热重载。逐文件说明见
[`docs/architecture.md` §11 文件结构](docs/architecture.md#11-文件结构)。

## 路线图 / 当前状态

| 内容 | 状态 |
| --- | --- |
| 0001 第一刀：御前会议、秘书、官僚、建造、天命、铁人 | ✅ 已实现 |
| 0003 经济循环 E1–E5（支出法 GDP、Stone-Geary、私人投资、资源禀赋） | ✅ 已实现（World v5） |
| 0004 贸易与外交 T1–T4（Top-6 双边流、NX、鸦片危机、战争目标） | ✅ 已实现（World v6） |
| ADR 0006–0015 财政净资产化、债务压力、双关税、建造能力/工程量/队列/补贴 | ✅ 已实现（World v7） |
| ADR 0016–0019 GM 明细接口、私人投资节奏、研究基础率、饥荒触发 | ✅ 已实现（World v7） |
| ADR 0020 持久化贸易航线（软闸门） | ✅ 已实现（World v8） |
| ADR 0021/0022 建筑配方单一真源、逐建筑利润与利用率/投资联动 | ✅ 已实现（World v9） |
| ADR 0023 四税基（GDP 退为派生指标） | ✅ 已实现（World v10） |
| plan 0009 / ADR 0024 配置分层与修正块 | ✅ 已实现（C1–C7 + D1/D2） |
| plan 0010 / ADR 0025 逐回合实时事件 | ✅ 已实现（E1–E7，World v13） |
| plan 0011 / ADR 0026 建筑扩张与统一基础设施（World v11） | ✅ 已实现（F1–F7；四类基础设施模型已由 plan 0014 合并取代） |
| plan 0014 / ADR 0029 基础设施合并（铁路/港口/电报→单一「基础设施」，删运河，World v12） | ✅ 已实现（`f751a0e`） |
| plan 0012 代码拆分（hooks/engine/view 拆桶、测试分文件） | ✅ 已实现（S1–S6） |
| plan 0013 建造面板 + 队列编排（ADR 0027）、v3_control 停止托管（ADR 0028） | ✅ 已实现（`5f78f77` 引擎 / `f390a14` 面板 / `175d9de` 控制） |
| 0006 GM ⇄ 引擎接口（全走 MCP，禁止读存档） | ✅ 已实现（v3_inspect 16 分区 + v3_forecast + v3_manual） |
| 0007 经济打磨（贸易校准、可见化、建造队列、GDP/科技/劳动力） | ✅ E1–E8 已完成（E6/E7 提前完成；E8 劳动需求×利用率 `d346b12`）；PT-040/041/042 显示口径已收敛（`58e3e7b`）；待下一轮试玩校准 |
| plan 0005 / ADR 0005 / ADR 0030 科技树 K0–K4（4 时代 / 16 节点起，`techTier` 代理，World v13） | ✅ 已实现（K2 效果/溢出/扩散、K3 AI 确定性选择 + 树形 UI、K4 调平 + 回归测试；plan 0015/0016 续扩至 22 节点） |
| plan 0015 / ADR 0031 科技分级 + 建筑三级（20 节点，World v14） | ✅ 已实现（`techTier`、`buildingTiers`、升级项目、三分支重写） |
| plan 0016 / ADR 0032 建筑 **I–V** 分级 + IV/V 电气化投入 + 营造所分级（World v14） | ✅ 已实现（S0–S8：退役全局电力乘数、`industry-6`/`industry-7` 解锁 IV/V、营造所可升级且更多更便宜、22 节点） |
| plan 0002 事件树 S1–S4（数据驱动局势/提案/多国交互 + GBR/QING 样板线） | ✅ 机制已实现（World v13；内容扩充待续） |
| 0008/0011 经济 remake 与建筑扩张后的试玩验证（PT-033/034/035） | 🔬 待试玩 |

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | **模拟如何运转的单一真源**：世界模型、经济循环、建筑配方/利润、建造能力、贸易、财政、四税基、修正、文件树 |
| [`docs/plans/`](docs/plans/) | 工作包与路线（0001–0016） |
| [`docs/adr/`](docs/adr/) | 架构决策记录（0001–0032） |
| [`docs/gm-handbook.md`](docs/gm-handbook.md) | GM 机制手册（工具、经济、贸易、财政、口径 FAQ） |
| [`docs/playtest-issues.md`](docs/playtest-issues.md) | 试玩问题记录（未结）|
| [`docs/playtest-issues-archive.md`](docs/playtest-issues-archive.md) | 已修复/无效条目归档 |
| [`GLOSSARY.md`](GLOSSARY.md) | 术语表 |

## 开发

```bash
claude plugin validate .
claude plugin test .
```

类型契约在 `types/index.d.ts`，`$.state` 的两个值（`world`、`ui`）都在那里声明。
引擎是纯 TypeScript，不依赖渲染层；`view/panels/` 只读世界状态，不写状态。
