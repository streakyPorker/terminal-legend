# 科技细化：建筑分级、新建筑与制海权（tech tiers & sea control）

- Status: **planned**（决策见 `docs/adr/0031-tech-tiers-and-sea-control.md`；目标 World **v14**）
- Depends on: ADR 0021（配方单一真源）、ADR 0022（利用率与利润）、ADR 0026（建筑扩张）、ADR 0030（科技树）
- Supersedes: ADR 0027 的「面板下单」部分；ADR 0030 的 16 节点表

## 0. 目标与边界

**目标**：让科技**真正改变可建造物、军队形态与需求结构**，而不是只给一串 +X%。

**本轮做**：

- 科技树 16 → **20 节点**，效果全部重写，新增五类「解锁型」效果；
- **建筑分级**（同 id 内 1–3 级，混级共存，按座加权）；
- **升级项目**（队列新类型，按座、可大批量、占建造力）；
- **三座新建筑 + 三个新商品**（化工厂/发电厂/机车厂；化工品/电力/机车）；
- **海军接上战争**（`navalQuality` + 制海权五档 + 每月分数累加 + 封锁）；
- **面板改为只读仪表盘**（移除下单按钮，建筑页只显示等级比例条）。

**本轮不做**：

- 第五时代（1900）——留作后续；
- 政策模板库——只做解锁门控，模板本身不建；
- 完整 PT-068（需求随生活水平/识字率演进）——只做节点级 `demandShift`；
- 陆海兵种/舰种细分——只做质量系数，不做编成。

## 1. 切片

六个垂直切片，每片**可独立验收**、可单独提交。切片之间尽量走桶文件重导出，避免大面积改 import。

### S1 数据与版本：建筑分级表 + 20 节点骨架 + v14

**做**

1. `types/index.d.ts`：`CURRENT_WORLD_VERSION = 14`；新增 `BuildingTierDef`、`Country.econ.buildingTiers`、
   `ConstructionProject.kind: 'build' | 'upgrade'`、`military.navalQuality`、三个新 `GoodId`、三个新 `BuildingId`。
2. `engine/data/buildings.ts`：为覆盖范围内的建筑写 `tiers: BuildingTierDef[]`；其余建筑保留单级（隐式 I 级）。
3. `engine/data/goods.ts`：新增 `chemicals` / `electricity` / `locomotives` 的 `name` / `basePrice`；
   `chemicals` 进 `CONSUMER_GOODS` / `SUBSISTENCE` / `INCOME_ELASTICITY`。
4. `engine/data/tech.ts`：20 节点表（效果先占位为 `modifier` 也行，但**结构**必须是新的）。
5. `engine/save.ts` + `engine/data/world.ts`：v14 写盘，v13 拒绝。

**验收**

- `world.version === 14`；v13 存档被拒且报错文本明确；
- 新建世界时每国 `buildingTiers` 全为 `[count, 0, 0]`（存量 === 建筑数）；
- 每个 `GoodId` 有 price/production 初值；`CONSUMER_GOODS` 含 `chemicals`；
- 20 个节点的 id 唯一、前置存在、无环（新增一条**表完整性测试**）；
- 全量测试通过（此切片只加数据，经济数值应几乎不动）。

### S2 建筑分级结算：按座加权

**做**

1. `computeProduction` / `computeDemand` 改读 `buildingTiers`：每类建筑的产出、投入、劳动需求
   按各级座数加权求和（同级内仍是 `count × coefficient`）。
2. `buildingProfits` 快照按级拆分（每类仍给一行，但内部按级加权；必要时新增逐级行）。
3. `utilization` 门控按**类**生效（不按级），保持 ADR 0022 的语义。
4. 私人投资 / 深度萎缩按**类**判断，不按级。

**验收**

- 全 I 级时，产出与 v13 **逐位等价**（用冻结的 v13 oracle 对照）；
- 混合等级（如 5 座 I + 3 座 II）的产出 === 各级加权和；
- 劳动需求、工资分摊、`Σ buildingProfits.wages === 全国 wages` 仍成立；
- 60/120 月确定性与金币守恒不破。

### S3 升级项目与科技解锁（钢铁链贯通）

**做**

1. `ConstructionProject.kind = 'upgrade'`：`building`、`fromTier`、`toTier`、`count`；
   工程量 = `count × 升级单价`，**无材料投入**，造价 = 工程量 × 0.2 金。
2. 建造力分配与普通项目同池；同月混合时按队列顺序。
3. `v3_action upgrade`（新动作）：`building`、`fromTier`、`toTier`、`count`；
   校验：等级上限已由科技解锁、`fromTier` 座数足够。
4. 科技效果 `unlockTier` 安装：提升该国该类建筑的等级上限。
5. **钢铁链垂直验收**：`industry-*` 节点解锁 `steelMills` II/III；升级后钢铁厂产出上升。

**验收**

- 钢铁厂从 I 升 II：产出提升符合配方表，投入按新配方；
- 未解锁 II 级时 `upgrade` 被拒且给出中文原因；
- 不可升级超过该国库存座数；
- 升级占用建造力、当月扣费正确；存档往返后升级项目可继续；
- 一条端到端测试：研究节点 → 解锁 → 升级 → 产出变化。

### S4 三座新建筑与三个新商品

**做**

1. `chemicalWorks`（1865）、`powerPlants`（1880）、`locomotiveWorks`（1880）；
   配方、造价、工程量、`infrastructureNeed`、`unlock`。
2. `chemicals` 进篮子后的 Stone-Geary 重校准（生存线、收入弹性）。
3. `electricity` 作为若干建筑的中间投入 + 全局产出加成（系数待定）。
4. `locomotives` 作为 III 级 `infrastructure` 的升级投入。
5. AI 建造候选表更新（新建筑可被 AI 选择）。

**验收**

- 三个商品在市场中双向可交易（若设计为单侧，须在测试里显式断言）；
- 化工厂进篮子后，1836 十国的生存线与生活水平**无跳变**（回归测试）；
- 三座建筑在解锁前不可建、解锁后可建；
- F7 毛利带对新增建筑有断言。

### S5 科技效果类型学与 20 节点落值

**做**

1. 实现 `unlockTier` / `unlockBuilding` / `unlockLaw` / `policyGate` / `demandShift` 的安装与消费。
2. 20 个节点的最终效果落值（每节点至少一项解锁类效果）。
3. `v3_action law` 校验科技前置；`v3_policy` 校验 `policyGate`。
4. 面板显示节点效果（新效果类型的中文文本）。

**验收**

- 每个节点至少有一项 `unlock*` / `policyGate` / `demandShift`（表完整性测试）；
- 法案与政策的解锁校验有正反用例；
- `demandShift` 作用到需求后，价格与贸易有可解释的变化；
- AI 科技选择在 20 节点下仍确定、仍按分支优先。

### S6 海军：舰船质量与制海权

**做**

1. `navalQuality` 字段：种子初始值、科技节点提升、存档往返。
2. `seaPower = navy × navalQuality × (1 + techTier × 系数)`；`navyStrength` 修正接上消费者。
3. 制海权五档（全球比值），每月写入战争记录。
4. 战争分数每月累加（优势 +0.4、完全控制 +0.8）。
5. 封锁：默认切交战国海上贸易；可指定国家（含中立国）。
6. `v3_inspect military` 显示 `seaPower`、`navalQuality`、当前制海权档位。

**验收**

- 1839 基线（英 120 艘 vs 清 48.9 艘）下，英国取得制海权，分数按档位累加；
- 同等海军但质量差悬殊时，结果按 `seaPower` 而非数量；
- 封锁切断指定航线的当月运量，解除后恢复；
- 海军不再"只有数字"：一场没有陆战、只有封锁的战争也能因分数累加结束；
- 存档往返后制海权状态一致。

### S7 界面：面板只读

**做**

1. 建造页移除三个下单按钮，保留取消 / ↑ / ↓ / 置顶；说明文字改为「下单请在对话中下令」。
2. 建筑页改为**等级比例条**（每类一行：名称 + 比例条 + 经营利润简项）。
3. 队列行显示升级项目（`钢铁厂 I→II ×12`）。
4. 面板其余页签保持可读，但**操作入口**统一改走对话（税率/研究/法案等按钮一并移除或改为提示）。

**验收**

- 面板上不存在任何写状态的下单按钮；队列管理按钮仍工作；
- 建筑页比例条与 `buildingTiers` 一致；
- 旧的面板测试（`panel-build.test.tsx` 等）按新定位改写，不再断言下单按钮。

## 2. 迁移与兼容

- **不做兼容层**（ADR 0005）：v13 存档拒绝载入，当前 1839 年活档作废。
- `ensureGoodsFields` / `ensureConstructionFields` 仍保留（未来再加字段时用），但 v14 的**结构变动**
  （`buildingTiers`、`project.kind`、`navalQuality`）不靠它们填补。

## 3. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 分级使产出/需求/劳动/利润四处按座加权，回归面巨大 | S2 用「全 I 级逐位等价 v13 oracle」守住基准，再测混合等级 |
| `chemicals` 进篮子扰动 Stone-Geary | S4 必须跑 1836 十国生存线与生活水平回归 |
| 制海权过强，1839 年战争一边倒 | S6 用 1839 基线校准五档阈值；必要时把封锁收益分期 |
| 面板去操作后，新玩家不知道能下什么令 | 面板每页保留一行「可用的对话命令」提示；README 与手册同步 |
| 20 节点 + 分级 + 新建筑在同一版本落地，迁移混乱 | 严格按 S1→S7 顺序提交，每片单独推送并跑全量 |

## 4. 文档同步

- `GLOSSARY.md`：新增「建筑等级」「建筑升级」「制海权」「舰船质量」「政策门控」；更新「时代」「科技节点」。
- `docs/gm-handbook.md`：§4.3 配方表加分级说明；§6/§8 补制海权；§3 工具表加 `upgrade`。
- `README.md`：面板定位改为仪表盘。
- `docs/playtest-issues.md`：PT-068 标注「节点级需求修正已做，完整演进待定」。
