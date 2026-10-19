# 终末传奇 · Terminal Legend

一个运行在 **Claude Code 终端里**的维多利亚 3 式大战略模拟。它不是一个独立游戏，
而是 Claude Code 的一个 function-hooks mod：

- **硬编码的确定性模拟**：经济、商品市场、人口阶层、财政、科技、军事、外交、战争、
  事件，全部是 TypeScript 里的纯函数，带 seeded RNG，同一个种子会得到同一个世界。
- **AI 做关键处理**：非玩家国家每 3 个回合用 `$.model.complete`（默认 haiku）批量
  做一次领袖决策；决策提示里带领袖人格、特质、议程与当前国情。模型失败时自动退回
  确定性政策，世界不会停摆。
- **主模型扮演主要大国**：插件通过 `prompt.compose` 把世界快照、领袖人格和工具规则
  注入系统提示。你在对话里直接和“维多利亚女王”“尼古拉一世”谈判，Claude 用他们的
  口吻回应，并调用 `v3_leader` / `v3_diplomacy` 把结果写回世界。
- **三层界面**：
  1. `$.ui.status` —— 最底部的单行 HUD（日期、国库、GDP、合法性、激进、科技、战争）；
  2. `AbovePrompt` —— 输入框上方的常驻仪表盘（经济走势、列强关系、待决事件、控制按钮）；
  3. `Pane` —— `/v3 panel` 打开的完整面板，八个标签页（概览/经济/人口/外交/军事/科技/事件/日志）。
  另外 `/v3 ...` 命令的输出会在对话里渲染成富文本报告。
- **自动屏蔽 claude-hud**：游戏激活期间，状态行调度器让 claude-hud 让位；游戏未激活时
  原样转交给 claude-hud，其他项目完全不受影响。

## 快速开始

在本 mod 所在的 Claude Code 会话里（或 `claude --plugin-dir <这个目录>`）：

```text
/v3 new            以大清开局（1836 年 1 月）
/v3 new FRA        以法国开局（GBR, FRA, PRU, RUS, AUS, USA, JAP, OTT, SPA 均可）
/v3 panel          打开完整面板
/v3 next 6         推进六个月
/v3 auto 60        每 60 秒自动推进一个月
/v3 pause          暂停自动推进
/v3 status         查看世界状态
/v3 events         查看待决事件
/v3 save           保存（默认 .terminal-legend/save.json）
/v3 load           读取
/v3 play RUS       切换扮演俄国
/v3 end            结束本局并恢复 claude-hud
```

也可以直接用自然语言：

> 在广东再建两座工厂，把关税提到 15%，然后问问英国的维多利亚女王愿不愿意签一份
> 贸易协定。

Claude 会先调用 `v3_status` 核对数字，再调用 `v3_action` / `v3_diplomacy`，
必要时用 `v3_advance` 推进时间。

## 工具（模型可调用）

| 工具 | 用途 |
| --- | --- |
| `v3_status` | 完整世界状态、各国对比、待决事件、战争 |
| `v3_advance` | 让 AI 领袖决策并推进 N 个月 |
| `v3_action` | 建造、税率、关税、支出、研究、征兵、法案 |
| `v3_diplomacy` | 改善/交恶/结盟/设对手/赠礼/宣战/停战 |
| `v3_event` | 列出或处理待决事件 |
| `v3_leader` | 记录与某国领袖的交流，调整情绪与关系，暂停该国后台 AI |
| `v3_play` | 切换玩家国家 |
| `v3_save` | 保存 |

## 世界模型（第一版）

- 10 个国家、12 种商品、7 种建筑、6 类支出、10 级科技。
- 每月结算：商品供需与价格 → GDP/财政 → 人口增长与城市化 → 生活水平/激进/合法性
  → 科技 → 军力与人力 → 外交关系漂移 → 战争 → 随机事件。
- 战争以双方陆军质量、士气、科技计算的战争分数推进，75 分或 60 个月结束。
- 事件有多个选项，选项效果包括国库、激进、合法性、威望、军队、人口、科技点与双边关系。
- 存档是项目目录下的 `.terminal-legend/save.json`（纯 JSON），`save.<name>.json` 为命名存档。

## claude-hud 屏蔽原理

`~/.claude/plugins/terminal-legend/statusline.mjs` 是一个状态行调度器：

1. 读取 Claude Code 通过 stdin 传入的 `session_id` / `cwd`；
2. 读取 `active.json`（由插件在游戏激活时写入，12 小时过期）；
3. 命中当前会话 → 不输出，claude-hud 隐藏，游戏自己的状态行接管；
4. 未命中 → 执行 `delegate.txt` 里保存的原始命令（即 claude-hud 的 statusline）。

安装/修复：

```bash
node statusline/install.mjs
```

它会把当前 `~/.claude/settings.json` 的 `statusLine.command` 备份到 `delegate.txt`，
然后把状态行指向调度器。设置改动对**新启动的会话**生效；当前会话可能需要重启 Claude Code。

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
.claude-plugin/plugin.json   清单、userConfig（AI 模型、自动推进秒数）
hooks/hooks.json             单个 hooks 模块
hooks/register.tsx           命令、工具、状态、自动推进、系统提示、三层渲染
types/index.d.ts             PluginState 契约与世界模型类型
engine/data.ts               国家/商品/建筑/科技/领袖/事件模板
engine/sim.ts                确定性月度模拟与玩家行动
engine/ai.ts                 批量 AI 领袖决策提示与解析
engine/save.ts               存档与状态行激活文件
view/format.ts               数字、进度条、火花线、状态行
view/panels.tsx              概览/经济/人口/外交/军事/科技/事件/日志面板 + Band + Report
statusline/install.mjs       状态行调度器安装脚本
tests/game.test.tsx          引擎与渲染测试
```
