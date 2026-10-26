# 科技细化：建筑分级、新建筑与制海权（tech tiers & sea control）

- Status: **implemented**（决策见 `docs/adr/0031-tech-tiers-and-sea-control.md`；World **v14**；切片 S0 `88f14f4`/`3b991b9` … S6 `539d7be`）
- Depends on: ADR 0021（配方单一真源）、ADR 0022（利用率与利润）、ADR 0026（建筑扩张）、ADR 0030（科技树）
- Supersedes: ADR 0027 的「面板下单」部分；ADR 0030 的 16 节点表
- 评审：本计划已按 `critic` 评审修订（F1–F6 / M1–M16），修订点在各切片内标 **〔评审〕**。

## 0. 目标与边界

**目标**：让科技**真正改变可建造物、军队形态与需求结构**，而不是只给一串 +X%。

**本轮做**：

- 科技树 16 → **20 节点**，效果全部重写，新增四类「解锁型」效果；
- **建筑分级**（同 id 内 1–3 级，混级共存，按座加权；`BUILDING_RECIPES` 即 I 级）；
- **新建可选等级 + 升级项目**（升级省工程量、单价同新建、计入投资）；
- **三座新建筑 + 三个新商品**（化工厂/发电厂/机车厂；化工品/电力/机车）；
- **海军最简版**（`navalQuality` + 制海权五档 + 可结束战争的分数 + 封锁）；
- **面板改为只读仪表盘**（移除下单按钮）。

**本轮不做**：

- 第五时代（1900）；
- 政策模板库与 `policyGate`（没有可门控的注册表；评审 F5/M5）；
- 完整 PT-068（只做节点级 `demandShift`）；
- 完整战争线（海战损耗、海域分区、封锁外交代价）——本轮海军只到「最简可玩」。

## 1. 切片

七个切片，**按顺序提交**。S0 先让世界能编译、能存档、能跑全量测试。

### S0 结构片：v14 骨架一次到位 〔评审 F6〕

**做**

1. `CURRENT_WORLD_VERSION = 14`；v13 拒绝。
2. 所有新字段与占位一次加完（即使语义未启用）：
   `Country.econ.buildingTiers`、`ConstructionProject.kind`、
   `BuildTierDef`、`military.navalQuality`、`War.seaControl?`；
   `GoodId += chemicals/electricity/locomotives`；`BuildingId += chemicalWorks/powerPlants/locomotiveWorks`。
3. 所有 `Record<BuildingId, …>` / `Record<GoodId, …>` 补占位（`BUILDING_RECIPES`、`CAPACITY_COST`、
   `INVESTMENT_DEMAND`、`BUILDING_OUTPUT`、`GOODS`、`SUBSISTENCE` 等），新建筑先给**空配方**。
4. `view/panels/tech.tsx` 的 `effectText` 改为按 `effect.kind` 分支（否则新联合类型编译不过）。
5. 工具 schema 的建筑枚举改为从 `BUILDING_IDS` 生成。

**验收**

- 全量测试通过；`world.version === 14`；v13 存档被拒；
- 新建筑在 v14 中**不可建**（空配方 + 未解锁），市场里三个新商品价格为基价、供需为 0；
- 每国 `buildingTiers[id] === [buildings[id]]`（全部 I 级）。

### S1 单一真源与分级结算 〔评审 F2/F3/M1/M2〕

**做**

1. `recipeAt(id, tier)` 访问器：`tier === 0` 返回 `BUILDING_RECIPES[id]`，`tier ≥ 1` 返回 `tiers[tier-1]`。
2. 全部消费方改读 `recipeAt`（`economy.ts`、`derivations.ts`、`inspect/buildings.ts`、`investment.ts`）。
3. `buildingTiers` 作为**座数分布**，与 `buildings` 恒等；四条写路径（建成/升级/折旧/天命）
   走同一个 mutator `applyBuildingDelta(country, id, tier, delta)`。
4. **口径写死**（评审 M1）：在生产、利润收入/投入、中间需求、劳动需求、基础设施需求、工资权重
   六处，分别明确用「原始座数」还是 `effectiveCount` 后的座数，并在代码注释与测试里标明。
5. `buildingProfits` **保持每类一行**（评审 M2）；逐级明细另开只读 `tierProfits?`，本轮可不做。

**验收**

- 全 I 级时输出与 v13 **冻结 oracle 逐位一致**；
- 混合级（5 I + 3 II）的产出、投入、劳动需求等于**独立手算值**（不调用引擎 helper）；
- 每次变更后 `Σ tiers === buildings`；60/120 月确定性与金币守恒不破。

### S2 升级项目与钢铁链贯通 〔评审 M6/M7〕

**做**

1. `kind === 'upgrade'` 在**全链路**分支：`normalizeConstructionQueue`（不按 5 座拆槽）、
   `projectWorkload`、`settleConstruction` 的投资需求、`runProject` 完成、`completeUpgrade`
   （**不调用 `completeBuilding`**，不触发市场接入/识字等副作用）、`cheat.finishProjects`、
   `inspect/construction` 展示。
2. `v3_action upgrade`：`building`、`fromTier`、`toTier`、`count`（无 5 上限）；`v3_action build` 增加 `tier`。
3. **座数预约**：下单时校验「库存 − 已预约」，完成时再校验；不足则部分完成并回写剩余订单。
4. 升级工程量 = 同级新建的 **≤60%**；单价与新建一致（0.2 金/点）；**计入投资**。
5. **营造所不可升级**；升级项目不提高建造力。

**验收**

- 钢铁厂 I→II 的产出、投入、利润符合 `recipeAt('steelMills', 1)`；
- 未解锁 II 级时 `upgrade` 被拒；超过库存座数被拒；重复下单不超额；
- 升级项目不触发建成副作用（市场接入不涨、学校识字不涨）；
- 存档往返后可继续施工；端到端：研究节点 → 解锁 → 升级 → 产出变化。

### S3 20 节点与四类效果 〔评审 F1/M3/M16〕

**做**

1. 实现 `unlockTier` / `unlockBuilding` / `unlockLaw` / `demandShift` 的安装与消费。
2. 20 个节点按**附录 A** 落值；每个节点至少一项解锁类效果。
3. **种子节点安装效果**：世界创建时对 `tech.unlocked` 逐个安装（评审 M3）。
4. 通用线第 5 个节点 era 明确（附录 A：1/1/2/3/4），完成路径加 `clampEra`。
5. `v3_action law` 校验科技前置；面板显示新效果类型的中文文本。

**验收**

- 节点表完整性：id 唯一、前置存在、无环、每节点至少一项解锁效果（**表驱动测试**）；
- 开局国家的已解锁节点效果已生效（GBR 的 era 2 节点有实际差异）；
- 法案解锁正反用例；`demandShift` 作用后价格与贸易有可解释变化。

### S4 三座新建筑与三个新商品 〔评审 M4/M12/M13/M14〕

**做**

1. `chemicalWorks`（1865）、`powerPlants`（1880）、`locomotiveWorks`（1880）：按附录 B 落配方。
2. `chemicals` **1865 前需求为 0**；III 时代节点用 `demandShift` 开启需求（评审 M4）。
3. `electricity` 加入 `NON_TRADABLE`；自产电力给全局产出乘数（进口不计）。
4. `locomotives` 作为 III 级 `infrastructure` 的**持续投入**，并提高 III 级供给系数。
5. `INFRA_SUPPLY` 与 `navalBases` 编练率改为**按级系数**（评审 M9）。
6. AI 建筑列表、`isBuildingUnlocked`、私人投资解锁检查（ADR §9.2）。

**验收**

- 化工品在 1865 前需求为 0，`demandShift` 后进入篮子且 `Σ INCOME_ELASTICITY === 1`；
- 电力不可贸易；进口电力不给产出加成；
- III 级基础设施供给 > II 级 > I 级；海军营地编练率同理；
- 新建筑解锁前不可建（玩家、AI、私人投资三条路径都拒绝）；
- 新建筑毛利用**解锁后的稳态 fixture** 断言（评审 M13）。

### S5 海军最简版 〔评审 F5/M11/M15〕

**做**

1. `military.navalQuality` 种子值、`immediate` 提升、存档往返。
2. `seaPower = navy × navalQuality × (1 + navyStrength/100)`；**不再乘 `techTier`**。
3. 制海权五档（≥2.0 完全控制 / ≥1.25 优势 / 0.8–1.25 均势 / 其余劣势或丧失）。
4. 分数：**优势 +0.75/月，完全控制 +1.5/月**；在贸易清算**之前**计算，当月生效。
5. 封锁：切断**敌国与第三方**贸易；可指定国家（含中立国），附带关系与恶名代价。
6. `v3_action blockade`（或 `v3_diplomacy move=blockade`）；`v3_inspect military` 显示 `seaPower` 与档位。

**验收**

- 1839 基线用**可复现 fixture**（`newWorld(seed,'QING')` + 手工设定双方舰队与 `navalQuality`），
  不依赖当前活档（评审 M15）；
- 完全控制 50 个月可打到 75 分（纯封锁能结束战争）；
- 数量相同、质量悬殊时按 `seaPower` 判定；
- 封锁切断指定航线且当月生效；解除后恢复；和平时清理封锁记录。

### S6 界面：面板只读

**做**

1. 建造页移除三个下单按钮，保留取消 / ↑ / ↓ / 置顶；`inspect`/提示改为「下单请在对话中下令」。
2. **经济页「建筑与基础设施」段**改为等级比例条（无独立建筑页签——评审次要项）。
3. 科技页研究按钮一并移除（面板只读），研究改走 `v3_action research`。
4. 队列行显示升级项目（`钢铁厂 I→II ×12`）。

**验收**

- 面板上不存在任何写状态的按钮；队列管理仍工作；
- 比例条与 `buildingTiers` 一致；
- `panel-build.test.tsx`、`construction-layout.test.ts`、`game.test.tsx` 按新定位改写。

## 附录 A：20 节点表（已落值）

> 评审 F1：数值先冻结。本表是 **S3 的唯一真源**，并做成 `tests/tech-nodes.fixture.ts`。
> 每节点至少一项解锁类效果；纯乘数只允许出现在 `general-1836` 这类垫底位。
> 成本沿用 `TECH_ERA_COSTS`（160 / 360 / 720 / 1280），表内不重复写。

### 通用线（general，5 个）

| id | era | 名称 | 前置 | 效果 |
| --- | ---: | --- | --- | --- |
| `general-1836` | 1 | 传统农业 | — | `unlockTier` farms 2 |
| `general-1840` | 1 | 度量衡与驿传 | general-1836 | modifier `marketAccess` percent +8 |
| `general-1850` | 2 | 蒸汽时代 | general-1840 | modifier `techPoints` percent +5 |
| `general-1865` | 3 | 工业时代 | general-1850；任一分支 ≥2 | `unlockTier` infrastructure 2 |
| `general-1880` | 4 | 电气时代 | general-1865；任一分支 ≥3 | `unlockTier` infrastructure 3 |

**era 序列 1 / 1 / 2 / 3 / 4**；`general-1840` 是新增的第二个 era 1 节点，完成路径必须 `clampEra`。

### 工业线（industry，5 个）

| id | era | 名称 | 前置 | 效果 |
| --- | ---: | --- | --- | --- |
| `industry-1` | 1 | 纺织机械化 | general-1836 | `unlockTier` textileMills 2、furnitureWorks 2、distilleries 2；modifier `fabricOutput` percent +10 |
| `industry-2` | 2 | 蒸汽动力 | industry-1, general-1850 | `unlockTier` coalMines 2、ironMines 2、lumberMills 2；modifier `mineOutput` percent +10 |
| `industry-3` | 3 | 钢铁工业 | industry-2, general-1865 | `unlockTier` steelMills 2、machineryWorks 2、luxuryWorks 2；modifier `factoryOutput` percent +8 |
| `industry-5` | 3 | 化工合成 | industry-3 | `unlockBuilding` chemicalWorks；`demandShift` chemicals +100% |
| `industry-4` | 4 | 电气化 | industry-5, general-1880 | `unlockTier` steelMills 3、machineryWorks 3、textileMills 3、furnitureWorks 3、distilleries 3、luxuryWorks 3、coalMines 3、ironMines 3、lumberMills 3；`unlockBuilding` powerPlants、locomotiveWorks |

### 行政线（admin，5 个）

| id | era | 名称 | 前置 | 效果 |
| --- | ---: | --- | --- | --- |
| `admin-1` | 1 | 文官制度 | general-1836 | modifier `bureaucracy` flat +5；`taxEfficiency` percent +5 |
| `admin-2` | 2 | 公共教育 | admin-1, general-1850 | `unlockLaw` 教育改革；modifier `literacy` percent +5 |
| `admin-3` | 3 | 财政改革 | admin-2, general-1865 | `unlockLaw` 保护关税、自由贸易；modifier `taxEfficiency` percent +8 |
| `admin-5` | 3 | 统计与普查 | admin-3 | modifier `bureaucracy` flat +5；`income` percent +5 |
| `admin-4` | 4 | 大众政治 | admin-5, general-1880 | `unlockLaw` 福利改革、宗教宽容；immediate `legitimacy` +3、`loyalists` +2、`radicals` -2 |

### 军事线（military，5 个）

| id | era | 名称 | 前置 | 效果 |
| --- | ---: | --- | --- | --- |
| `military-1` | 1 | 线膛枪 | general-1836 | modifier `armyStrength` percent +10 |
| `military-2` | 2 | 铁路动员 | military-1, general-1850 | `unlockLaw` 征兵制；modifier `manpower` percent +10 |
| `military-3` | 3 | 后装火炮 | military-2, general-1865 | `unlockTier` arsenals 2；modifier `armyStrength` percent +12 |
| `military-5` | 3 | 铁甲舰队 | military-3 | `unlockTier` navalYards 2、navalBases 2；immediate `navalQuality` +0.10 |
| `military-4` | 4 | 总参谋部 | military-5, general-1880 | `unlockTier` arsenals 3、navalYards 3、navalBases 3；immediate `navalQuality` +0.10、`morale` +5；modifier `armyStrength` percent +10 |

### 覆盖检查（表驱动测试必须断言）

- **六项法案**全部有解锁节点：教育改革（admin-2）、保护关税 / 自由贸易（admin-3）、
  征兵制（military-2）、福利改革 / 宗教宽容（admin-4）。
- **13 类分级建筑**的 II 级与 III 级都有解锁来源（见上表逐项）。
- **3 座新建筑**：chemicalWorks（industry-5）、powerPlants / locomotiveWorks（industry-4）。
- **每个节点至少一项解锁类效果**；`general-1840 / general-1850 / admin-1 / admin-5 / military-1 / military-2`
  等以 modifier 为主的节点仍各自带至少一项 `unlockTier` / `unlockLaw` / `unlockBuilding` / `demandShift`。

## 附录 B：分级配方（已落值）

> I 级 = 现有 `BUILDING_RECIPES`，**不动**。以下只定义 II / III 级。
> 系数按统一规则生成后取 3 位小数；表格给的是**乘数规则**，`recipeAt` 的 fixture 由规则展开，
> 展开结果入库到 `engine/data/buildings.ts` 的 `tiers`。

### 规则

| 族 | II 级 | III 级 |
| --- | --- | --- |
| 重工业（steelMills / machineryWorks / arsenals） | output ×1.35，input ×1.15，labor ×1.10 | output ×1.35，input ×1.12，labor ×1.05 |
| 采掘（coalMines / ironMines / lumberMills） | output ×1.30，input —，labor ×1.15 | output ×1.30，labor ×1.10 |
| 轻工业（textileMills / furnitureWorks / distilleries / luxuryWorks） | output ×1.30，input ×1.12，labor ×1.10 | output ×1.30，input ×1.10，labor ×1.05 |
| 船坞（navalYards） | ships ×1.25，machinery ×1.10，input ×1.10，labor ×1.10 | ships ×1.50，input ×1.08，labor ×1.05 |
| 基础设施（infrastructure） | `INFRA_SUPPLY` ×1.30，input ×1.15 | `INFRA_SUPPLY` ×1.60，input ×1.20 + `locomotives` 0.4/座/月 |
| 海军营地（navalBases） | 编练率 ×1.25，input ×1.10 | 编练率 ×1.50，input ×1.15 |

### 关键校验值（基价下，用于 S1/S2 的 oracle）

| 建筑 | I 级增值 | II 级增值 | III 级增值 |
| --- | ---: | ---: | ---: |
| steelMills | 5.08 | 7.92 | 12.10 |
| machineryWorks | 1.35 | 2.39 | 3.97 |
| arsenals | 3.26 | 4.84 | 7.13 |
| textileMills | 2.26 | 3.35 | 4.89 |
| furnitureWorks | 1.04 | 1.56 | 2.30 |
| luxuryWorks | −0.03 | 0.83 | 2.16 |

> 计算口径：基价、单座、每月。`增值 = Σ(产出×价) − Σ(投入×价)`，未扣工资。
> 工资按 `WAGE_ALLOCATION='valueAdded'` 分摊，类内增值上升即毛利上升。

> `luxuryWorks` 的 I 级在基价下略为负值——这正是「升级把不赚钱的厂变赚钱」的证据；
> 实际价格偏离基价，验收以当期价为口径。

> 2026-10-25 于 S1 实施时校正：`textileMills` II 级按附录 B 规则展开为 3.3547 → 3.35（原表 3.36 系笔误，已按规则修正）。

### 升级工程量

- 单位座数的升级工程量 = 同级新建工程量的 **50%**（规则值，落在 60% 上限内）。
- 升级单价与新建一致（0.2 金/点）；升级计入 GDP 投资项。
- 升级不消耗材料；营造所不可升级；升级不提高建造力。

## 2. 迁移与兼容

- **不做兼容层**（ADR 0005）：v13 存档拒绝载入，当前 1839 年活档作废。
- 保留 `ensureGoodsFields` / `ensureConstructionFields` 作为未来加字段的工具；v14 的结构变动不靠它们。

## 3. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 分级使产出/需求/劳动/利润四处按座加权，回归面巨大 | S1 用「全 I 级逐位等价 v13 oracle」+ 独立手算混合级 |
| 升级不消耗材料形成正反馈 | 营造所不可升级、升级不提高建造力、工程量 ≤60% |
| 化工品进篮子扰动生存线 | 1865 前需求为 0，用 `demandShift` 开启 |
| 制海权一边倒 | 用可复现 fixture 校准；完全控制 50 月可结束战争 |
| 中间切片编译失败 | **S0 一次铺完结构**，后续切片只启用语义 |
| 面板去操作后玩家不知道能下什么令 | 每页保留「可用对话命令」提示 |

## 4. 文档同步

- `GLOSSARY.md`：建筑等级、建筑升级、舰船质量、制海权、海上贸易（政策门控**不做**，已移除）。
- `docs/gm-handbook.md`：§4.3 配方表加分级；§6/§8 补制海权；§3 工具表加 `upgrade` / `blockade`。
- `README.md`：面板定位改为仪表盘。
- `hooks/prompt.ts`：GM 提示词补 `upgrade` / `tier` / `blockade` 的用法。
- `docs/playtest-issues.md`：PT-068 标注「节点级需求修正已做，完整演进待定」。
