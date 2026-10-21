# 终末传奇 · Terminal Legend

一个运行在 **Claude Code 终端里**的维多利亚 3 式大战略模拟。它不是一个独立游戏，
而是 Claude Code 的一个 function-hooks mod：

- **硬编码的确定性模拟**：经济、商品市场、人口阶层、财政、科技、军事、外交、战争、
  事件，全部是 TypeScript 里的纯函数，带 seeded RNG，同一个种子会得到同一个世界。
- **AI 做关键处理**：非玩家国家每个月用 `$.model.complete`（默认 haiku）批量
  做一次领袖决策；决策提示里带领袖人格、特质、议程、GDP 构成、资源与私人资本。
  模型失败时自动退回确定性政策，世界不会停摆。
- **主模型扮演主要大国**：插件通过 `prompt.compose` 把世界快照、领袖人格和工具规则
  注入系统提示。你在对话里直接和“维多利亚女王”“尼古拉一世”谈判，Claude 用他们的
  口吻回应，并调用 `v3_leader` / `v3_diplomacy` 把结果写回世界。
- **月度御前会议**：没有实时时钟。每月推进后停在御前会议，玩家审阅月报、处理事件、
  批准推进一月，或托管 N 月（遇待决事件、新的战争、战争结束、秘书越权即中断）。
- **秘书子代理**：每月可召见一个 haiku 档子代理担任秘书，在玩家授权的内政/外交范围内
  起草并执行计划，提交「已执行 / 建议 / 风险」报告；越权（推进时间、宣战、停战、天命）
  会被记录并提示，但不会被打断。
- **官僚效能**：0–100 的派生分数，决定每月行动预算、资金效率、工期延迟与信息失真；
  官署抬高上限，交通基础设施与行政能力各管一摊。
- **修正叠算**：政策、法案、事件、阈值与天命都通过 `engine/modifiers.ts` 给同一批
  数值入口挂 buff/debuff；按 flat → percent → multiply 固定顺序结算，支持持续时间与
  来源，同一 `id` 覆盖而不是无限叠加（ADR 0004）。
  - **政策**：`v3_policy` 接受一组效果条目，引擎校验、消耗权威后落成修正。
  - **阈值**：`engine/thresholds.ts` 的规则在每月结算后检查状态（如激进 ≥50 → 民怨沸腾，
    识字率 ≥60% → 启蒙时代）；`while` 规则条件消失即移除，`once` 规则永久保留。
  - **事件**：事件选项的 `effects.modifiers` 直接携带限时 buff。
- **支出法经济循环**：每月按 C+I+G+NX 核算 GDP（NX 为净出口，已接入双边贸易）；Stone-Geary
  消费需求、劳动份额与利润分配（全国工资再按 `WAGE_ALLOCATION` 摊到各建筑类型的经营利润）、
  私人储蓄与自动投资、建造队列（国有/私人，按建造点推进）、国家级资源禀赋
  （农田/林地/煤矿/铁矿）与 0.7–1.3 的软乘数共同构成增长螺旋。私人项目可见但不可取消。
- **建筑配方（单一真源）**：`engine/data.ts` 的 `BUILDING_RECIPES` 逐类声明每座每月的
  产出与中间投入（含副产品）与用工，是产出与投入的**唯一来源**；`computeProduction` 只读该表，
  中间投入按 `Σ 建筑数 × 配方投入` 汇总。同时每月算出**逐建筑经营利润**快照
  `econ.buildingProfits`（产出价 − 投入价 − 分摊工资），`v3_inspect economy` 可读。
  全国工资按 `WAGE_ALLOCATION`（`basis: 'labor' | 'valueAdded' | 'capitalPlusLabor'`，当前
  `valueAdded`）分摊到各建筑类型，`weights?` 可按类型再加权；三种 basis 都精确满足
  `Σ buildingProfits.wages === 全国工资`（plan 0008 B5；plan 0009 将迁到 `engine/config/economy.ts`）。
  利用率门控产能、亏损类目闲置萎缩、私人投资只看盈利类目（ADR 0021/0022，World v9）；
  企业税按逐类利润累加（ADR 0023，World v10）。B5 重定工厂配方（调轻材料单、下调成衣/酒/家具
  产出）使其可盈利（7 大国产量加权聚合毛利 ≈ 15.8%）；成衣/酒/家具/军械按设计为**本地自给**
  （手工匠与本地军供），不做全球双向贸易。World v11（plan 0011 F1）把 `iron` 重命名为**铁矿石**
  （保留 id、改低价），新增 **`steel`（钢铁）**：工厂消耗铁矿石 + 煤炼钢，铁路、建设投资与
  政府建设改用钢铁；工厂/矿场的单产拆分（`steelMills` 等）是后续 F2–F4。
- **双向关税与到岸价**：`tariff` 是进口税率，`exportTariff` 可选、缺省与进口同率（旧行为）。
  到岸价 = 出口国国内价 × (1 + 出口关税) × (1 + 进口关税) × 运输 / 接入 / 风险；进口国私人付
  边境价 + 进口税，出口国国库收出口税，进口国国库收进口税。`v3_action tariff` 可用 `rate`
  与 `exportRate` 分开设定；自由贸易把两个税率都降到 **5% 下限**（ADR 0009、ADR 0014）。
- **持久化贸易航线（软闸门）**：一对国家就某种商品建立**持久贸易航线**，存在 `world.tradeRoutes`，
  有等级与所有者（国有/私人）。每月清算**先走航线、再走现货残差**：航线按折扣到岸价优先成交，
  现货残差加摩擦、候选更窄，因此**没有航线也能贸易**。航线运量达容量 80% 且有利可图则升级，
  否则衰退至删除；交战/禁运/关系低于 -50 的航线暂停并衰退。1836 开局自带一套种子航线，
  AI 每月最多自动开通 1 条。`v3_action route` 可 `open`/`raise`/`lower`/`close`；
  `v3_inspect trade` 与「市场」页显示航线（ADR 0020，World v8）。
- **国库 = 净资产**：`engine/fiscal.ts` 把国库抽象成一个带符号的净资产余额——正数是主权基金
  （按基金月息生息），负数是国债（按国债月息付息），不再有独立的债务存量和还本步骤。
  两个月息都受合法性、威望、战争、市场接入、重组窗口与民怨影响（ADR 0006）。
- **债务压力**：小幅负净资产不再冻结国有建设，现金上限是 3× GDP 的重组底线；债务/GDP
  超过 25% 后，收入、建设速度、合法性目标与借债月息随比例持续恶化，直到 3× GDP 重组
  （ADR 0007）。`v3_status`、HUD 与财政账本都会显示当前的债务压力档位。
- **建造能力**：新增「营造所」，消耗木材 1、粮食 0.6、铁 0.3（每座每月），产出 4 建造点；
  每槽最多 **5 座**，项目有**工程量 = 单座月度建造点 × 30**（1 座营造所 = 45 点）。
  **没有每槽月度点数上限**：国有队列按入队顺序取用闲置建造力，每个 entry 每月可拿到
  `min(剩余建造力, 剩余工程量)`，小工程在空闲期可以一次做完；**工期 = 剩余工程量 ÷ 每月实际投入**。
  每点工程量造价固定 0.2 金，各建筑的资金乘数/加数第一版全为 1/0。每月订单数量不限。
  私人项目自建 50%、可租用国有闲置建造点；分配完后剩余点按 0.3 金/点出租给私人部门，
  租金从私人资本扣除并记入财政收入「其他」；两栏队列分开显示（ADR 0010、ADR 0012、ADR 0013）。
  「建设补贴」支出每级每月 **+1.5 建造点、花费 0.45 金**，补贴点同样受原料可得性约束
  （ADR 0015）。
- **四税基（不按 GDP 比例）**：税入改由**四个真实税基**累加（ADR 0023）：**土地税**（农田禀赋 × 地价系数）、
  **企业所得税**（逐建筑经营利润「只取正项」逐类累加）、**消费税**（Stone-Geary 的**最终消费**，不含中间投入）、
  **关税**（进出口货值，沿用 `tariff` / `exportTariff`）。每基 `税额 = 税基量 × 税率 × 征收效率 × 合规 × 债务削减`，
  其中征收效率 = `clamp(0.35 + 官僚/200 + 合法/400, 0.3, 1.1)`，高税率逐基侵蚀税基。**GDP 只作派生产出指标，
  永不作税基**。可支配收入按私人税负（土+企+消，不含关税）扣减以免重复计征。`Economy.taxes` 为四基税率菜单
  （`land/profit/consumption/tariff`），`v3_action tax { base, rate }` 调整；`v3_inspect fiscal` 显示每基
  税基量 / 税率 / 税额。
- **国库收支账**：收入按四税基税入、港口、基金收益、赔款收入拆分；支出按陆军、海军、行政、教育、福利、债息、
  市场损耗、设施维护、赔款支出、国有建设拆分。**私人部门的进口逆差由私人资本/私人外债承担，不再扣减国家净资产**
  （ADR 0008）；国库只经手关税。状态报告、HUD、AbovePrompt 与经济页都显示「收入 / 支出 / 净额」与私人外债，
  并注明 GDP 是产出而非国库收入。
- **战争赔款**：胜方声明总额与最长分期月数，败方自行决定一次付清多少、余款分几期；分期部分
  每月计入付款方支出与收款方收入，日程存在 `world.indemnities`。
- **货币单位**：所有金钱与产出价值统一用抽象单位「金」，显示为「金」「金/月」；
  GDP 是月度流量。
- **三层界面**：
  1. `$.ui.status` —— 最底部的单行 HUD（日期、国库净资产与净额、收入/支出、国债或主权基金、GDP、合法性、激进、科技、战争、铁人）；
  2. `AbovePrompt` —— 输入框上方的常驻仪表盘；会议打开时第一行是「御前会议 · 待议」；
  3. `Pane` —— `/v3 panel` 打开的完整面板，十一个标签页（御前/概览/排名/市场/经济/人口/外交/军事/科技/事件/日志）。
   「市场」只包含商品供需与对外贸易伙伴（贸易航路），其余经济内容留在「经济」。
     「排名」按经济、人口与社会、军事、科技与行政、外交与威望五个维度列出列强。
  另外 `/v3 ...` 命令的输出会在对话里渲染成富文本报告。
- **与 claude-hud 共存**：状态行调度器始终把输出转交给 claude-hud，游戏自己的 Band 与
  状态行叠加在上面，不再互相屏蔽。

## 快速开始

**全局安装（可一键开关）**：

```text
/plugin install terminal-legend --marketplace https://gitcode.com/streakyPorker/terminal-legend.git
```

装好后用 `/plugin disable terminal-legend` / `/plugin enable terminal-legend`（或 `claude plugin disable|enable terminal-legend`）
在任意会话里开关；本地开发仍可用 dev-mods 热重载。

在本 mod 所在的 Claude Code 会话里（或 `claude --plugin-dir <这个目录>`）：

```text
/v3 new            以大清开局（1836 年 1 月），御前会议立即开始
/v3 new FRA        以法国开局（GBR, FRA, PRU, RUS, AUS, USA, JAP, OTT, SPA 均可）
/v3 next           批准并推进一月
/v3 run 6          后台托管六个月，遇中断即停
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

> 在广东再建两座工厂，把关税提到 15%，然后问问英国的维多利亚女王愿不愿意签一份
> 贸易协定。

Claude 会先调用 `v3_status` 核对数字，再调用 `v3_action` / `v3_diplomacy`；
推进时间需要你明确批准（或者托管）。

## 工具（模型可调用）

| 工具 | 用途 |
| --- | --- |
| `v3_status` | 完整世界状态、本国财政/人口/军力/科技、待决事件、战争、官僚与建造队列（各国对比见 `v3_inspect rankings`） |
| `v3_inspect` | 只读明细：economy/market/fiscal/labor/trade/routes/buildings/construction/military/pops/diplomacy/tech/modifiers/rankings/log/history |
| `v3_forecast` | 下月现金流预估（收入、支出、净额、结算后国库） |
| `v3_manual` | 返回 GM 机制手册（`docs/gm-handbook.md`），无需打开文件 |
| `v3_advance` | 批准推进一月；months>1 视为托管并检测中断 |
| `v3_cheat` | 天命：金钱/科技点/建筑/关系/战争分数/日期/事件/领袖（铁人禁用） |
| `v3_action` | 建造（入队）、税基税率（`tax base`）、关税、支出、研究、征兵、法案 |
| `v3_policy` | 提交政策提议：一组效果条目变成可叠算的 buff/debuff |
| `v3_diplomacy` | 改善/交恶/结盟/设对手/赠礼/宣战/停战（胜方停战时可声明赔款总额与最长分期月数） |
| `v3_event` | 列出或处理待决事件 |
| `v3_leader` | 记录与某国领袖的交流，调整情绪与关系，暂停该国后台 AI |
| `v3_play` | 切换玩家国家 |
| `v3_save` | 保存 |

## 世界模型（第一版）

- 10 个国家、14 种商品、9 种建筑、6 类支出、10 级科技。
- 每月结算：商品供需与价格 → GDP/财政 → 建造队列 → 人口增长与城市化 → 生活水平/激进/合法性
  → 官僚效能与权威 → 科技 → 军力与人力 → 外交关系漂移（受恶名拖累） → 战争 → 随机事件。
- 战争以双方陆军质量、士气、科技计算的战争分数推进，75 分或 60 个月结束。
- 事件有多个选项，选项效果包括国库、激进、合法性、威望、军队、人口、科技点与双边关系。
- 存档是项目目录下的 `.terminal-legend/save.json`（纯 JSON），命名存档为 `.terminal-legend/<名字>.json`。
- 早期开发不做存档兼容：世界结构变化时提升 `WorldState.version`，旧存档直接拒绝载入（ADR 0005）。

## 与 claude-hud 共存

`~/.claude/plugins/terminal-legend/statusline.mjs` 是一个状态行调度器：它始终执行
`delegate.txt` 里保存的原始命令（即 claude-hud 的 statusline），不再按游戏是否激活
屏蔽对方。游戏的状态文字与 `AbovePrompt` Band 叠加在同一屏上，两者共存。
插件不再写入 `active.json`，也不再判断游戏是否激活。

安装/修复：

```bash
node statusline/install.mjs
```

它会把当前 `~/.claude/settings.json` 的 `statusLine.command` 备份到 `delegate.txt`，
然后把状态行指向调度器。设置改动对**新启动的会话**生效；当前会话可能需要重启 Claude Code。

## 下一步

1. **`docs/plans/0007-economy-polish.md`（当前优先）**：世界贸易校准（农产品没有全球
   bid）、支付能力可见化、建造队列公平、GDP/科技/劳动力口径。先让经济可解释、可操作。
2. `docs/plans/0006-gm-engine-interface.md`：GM 与引擎的交互**全部走 MCP 工具**，禁止读
   `.terminal-legend/save.json`。`v3_inspect` 的 16 个分区（economy/market/fiscal/labor/
   trade/routes/buildings/construction/military/pops/diplomacy/tech/modifiers/rankings/
   log/history）、`v3_forecast` 与 `v3_manual` 均已实现（ADR 0016）；每个事实只在一个分区
   出现（逐建筑行在 `buildings`、路线在 `routes`、各国对比在 `rankings`）。
   GM 的机制参考（工具、经济、贸易、财政、口径 FAQ）见 `docs/gm-handbook.md`。
3. `docs/plans/0005-tech-tree.md`：科技树 v8：工业/行政/军事三分支 + 通用时代线、跨分支
   溢出、国际扩散。**等 0007-E5 校准后再排期。**
4. `docs/plans/0002-agent-event-trees.md`：主要大国专属国策/事件树，再到多国交互事件树。
   **⏸ 暂停**，等经济系统打磨完成后再恢复。其「逐回合事件」部分已由
   `docs/plans/0010-live-events.md`（ADR 0025）承接。
5. `docs/plans/0009-config-refactor.md`（ADR 0024，取代 ADR 0004）：配置分层（`engine/config/` + `engine/data/`）与统一「配置块」乘数机制，增量 TDD、第一刀行为保持。
6. `docs/plans/0010-live-events.md`（ADR 0025）：AI 生成的逐回合实时事件，引擎按经济/政治/外交/民生挑显著题材，LLM 现场生成 0 至 2 个可交互事件，效果编译回既有事件结构并持久化。**proposed，待批准实现。**
7. `docs/plans/0011-building-expansion.md`（ADR 0026）：建筑扩张与统一基础设施——矿场拆成煤矿/铁矿/伐木场、工厂拆成七个单产工业建筑、加学校/运河/电报/要塞/船坞，新增 `steel` 商品（`iron` 转为「铁矿石」），把「交通基础设施」升级为统一的「基础设施」（供给/需求/线性短缺 debuff/维护），建筑加 `unlock` 前向字段。**proposed，待批准实现（World v11）。**

已完成、作为参考：`0003-economic-loop.md`（World v5）、`0004-trade-diplomacy.md`（World v6）、
ADR 0006（World v7 净资产财政）、ADR 0020（World v8 持久贸易航线）、
ADR 0021/0022（World v9 建筑配方、逐建筑利润与利用率/投资联动）、
ADR 0023（World v10 四税基）。

## 开发

这个仓库本身就是插件目录：

```
/home/developer/gaming/terminal-legend/
├── .claude-plugin/plugin.json   ← 插件清单
├── hooks/register.tsx           ← 热重载入口
├── engine/  view/  types/  tests/  statusline/
└── .terminal-legend/save.json   ← 存档（已 gitignore）
```

会话热重载入口是 `~/.claude/dev-mods/<session>/terminal-legend`，它是指向本目录的
符号链接——所以直接改本目录的文件即可热重载，不需要再往 dev-mods 里写代码。

```bash
claude plugin validate .
claude plugin test .
```

类型契约在 `types/index.d.ts`，`$.state` 的两个值（`world`、`ui`）都在那里声明。
引擎是纯 TypeScript，不依赖渲染层；`view/panels.tsx` 只读世界状态，不写状态。

## 文件结构

```
.claude-plugin/plugin.json   清单、userConfig（AI 模型）
hooks/hooks.json             单个 hooks 模块
hooks/register.tsx           命令、工具、御前会议、秘书、系统提示、三层渲染
types/index.d.ts             PluginState 契约与世界模型类型（world v11：建筑配方、逐建筑利润与四税基、铁矿石/钢铁；科技树规划中）
engine/data.ts               国家/商品/建筑/科技/领袖/事件模板、官僚与失业派生
engine/sim.ts                门面（barrel）：原样再导出下列模块，保持公共导入面不变
engine/internal.ts           跨模块共享的小工具：clamp、日期、GOOD 校验、v7 建造字段补齐
engine/economy.ts            产出/需求/价格形成、支出法 GDP、逐建筑利润、税基量与利用率反馈
engine/construction.ts       建造能力、工程量/造价、队列排程与负载、完工与结算
engine/investment.ts         私人资本投资评分、资本门槛与私人项目节奏
engine/diplomacy.ts          关系漂移、贸易冷暖/敏感拖累、禁运到期、宣战/停战与战争目标
engine/events.ts             事件选项结算与月度事件抽取（AI 自动抉择 / 玩家待决）
engine/country.ts            单国月度结算：人口/就业/生活水平/合法性/科技/军力
engine/actions.ts            玩家与 AI 行动：v3_action 处理、政策、随机决策、托管中断
engine/world.ts              世界创建与校准、航线引导、月度 advance 主循环
engine/fiscal.ts             国库收支账：收入来源与支出用途拆分（GDP ≠ 财政）
engine/trade.ts              区域运输矩阵、Top-6 双边数量清算、有效供给
engine/ai.ts                 批量 AI 领袖决策提示与解析
engine/secretary.ts          秘书系统提示与月度简报
engine/modifiers.ts          buff/debuff 叠算入口与到期结算
engine/thresholds.ts         状态阈值触发的修正规则
engine/cheat.ts              天命工具
engine/save.ts               存档、版本校验与状态行激活文件
view/format.ts               数字、进度条、火花线、状态行
view/panels.tsx              御前/概览/市场/经济/人口/外交/军事/科技/事件/日志面板 + Band + Report
statusline/install.mjs       状态行调度器安装脚本
tests/game.test.tsx          引擎、命令与渲染测试
tests/first-slice.test.ts    第一刀（M1–M6）引擎与命令测试
```

## 路线图

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 0001 | 第一刀 M1–M6：御前会议、秘书、官僚、建造、天命、铁人 | ✅ 已实现 |
| 0003 | 经济循环 E1–E5：支出法 GDP、Stone-Geary、私人投资、资源禀赋 | ✅ 已实现（World v5） |
| 0004 | 贸易与外交 T1–T4：Top-6 双边流、NX、鸦片危机、战争目标 | ✅ 已实现（World v6） |
| ADR 0006 | 国库净资产化：单一余额、双向利率、贸易缺口并入、分期赔款 | ✅ 已实现（World v7；贸易缺口部分由 ADR 0008 修订） |
| ADR 0007 | 债务压力：赤字建设、25% 起的连续 debuff、3× GDP 重组底线 | ✅ 已实现（World v7） |
| ADR 0008 | 私人贸易逆差归私人资本/私人外债，不记国家国债 | ✅ 已实现（World v7） |
| ADR 0009 | 双向关税：进出口同税率、税后到岸价、自由贸易 5% 下限 | ✅ 已实现（World v7） |
| ADR 0010 | 建造能力：营造所、资源投入、队列槽位、私人租用 | ✅ 已实现（World v7） |
| ADR 0011 | 建造槽位：每槽 15 座、15×单座建造点、满额 1 月、订单不限量 | ↪ 由 ADR 0012 取代 |
| ADR 0012 | 工程量制建造：每槽 5 座、工程量÷月投入=工期、每点 0.2 金 | ✅ 已实现（World v7；每槽月度上限由 0013 取代） |
| ADR 0013 | 队列顺位建造：不设每槽月度上限、可吃满闲置建造力、工程量 ×30 | ✅ 已实现（World v7） |
| ADR 0014 | 进出口关税拆分：进口税率与可选出口税率，缺省同率 | ✅ 已实现（World v7） |
| ADR 0015 | 建设补贴：每级 +1.5 建造点、0.45 金，重新启用建设支出旋钮 | ✅ 已实现（World v7） |
| ADR 0016 | GM 明细接口：v3_inspect 七个分区 + v3_forecast 下月现金流 | ✅ 已实现（World v7） |
| ADR 0017 | 私人投资节奏：每两月最多开工一次、最多三单在途 | ✅ 已实现（World v7） |
| ADR 0018 | 科技基础研究率：无大学也按月产出，识字与官僚加成 | ✅ 已实现（World v7） |
| ADR 0019 | 饥荒触发条件：生活水平 <45 且粮价高于基准 5% | ✅ 已实现（World v7） |
| ADR 0020 | 持久化贸易航线：软闸门（航线遍 + 现货残差遍）、成长衰退、自动开通、玩家航线动作 | ✅ 已实现（World v8） |
| ADR 0021 | 建筑配方单一真源：`BUILDING_RECIPES`（产出+中间投入+用工）、逐建筑经营利润快照 | ✅ 已实现（World v9） |
| ADR 0022 | 利用率与利润驱动的私人投资：上月利用率门控、深度亏损萎缩、投资利润门槛 | ✅ 已实现（World v9） |
| ADR 0023 | 四税基：土地 / 逐建筑企业利润 / 最终消费 / 关税，GDP 退为派生指标 | ✅ 已实现（World v10，0008 B4） |
| 0005 | 科技树 K1–K4：三分支 + 通用时代线、跨分支溢出、国际扩散 | 📝 已规划（等经济打磨后） |
| 0002 | 事件树 S1–S4：局势/提案/多国交互 | ⏸ 暂缓（先打磨经济） |
| 0006 | GM ⇄ 引擎接口：查询/预测全部走 MCP，禁止读存档 | ✅ 已实现（v3_inspect 16 分区 + v3_forecast + v3_manual；ADR 0016） |
| 0007 | 经济打磨：世界贸易校准、支付能力可见化、建造队列、GDP/科技/劳动力 | 🔧 当前优先（E1 第一轮已校准，32e624b） |
| ADR 0026 / 0011 | 建筑扩张与统一基础设施：拆矿场/工厂为单产建筑、加学校/运河/电报/要塞/船坞、`steel` 商品、统一基础设施（供给/需求/线性 debuff/维护）、`unlock` 前向字段 | 🔧 进行中（F1 已实现：`iron`→铁矿石、新增 `steel`、World v11；F2–F7 待做） |

规划文档在 `docs/plans/`；架构决策在 `docs/adr/`；术语以 `GLOSSARY.md` 为准；GM 机制参考见 `docs/gm-handbook.md`。
