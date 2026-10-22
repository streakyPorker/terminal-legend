# 基础设施建筑合并（infrastructure merge）

- Status: accepted（World **v12**：铁路/港口/电报合并为单一建筑 `infrastructure`、删除运河，名册 22→19）
- Fixes: 四类基础设施建筑**同供一池却造价/供给各异**，玩家每次要手算「每金净供给」才知道建哪个（plan 0014 §0 的诊断）
- Depends on: `docs/plans/0014-infrastructure-merge.md`、ADR 0026（统一基础设施池与建筑扩张）、ADR 0021（建筑配方单一真源）、ADR 0022（利用率与利润投资）、ADR 0005（不做存档兼容）
- Supersedes: ADR 0026 §1/§3 里「铁路/港口/运河/电报各自供给」的四类模型（**运河整体删除**）

## 背景

plan 0011 F5 / ADR 0026 把「交通基础设施」升级成**统一池**：铁路（2.5/座）、港口（1.1）、运河（1.6）、
电报（0.7）分别**供给**，全部建筑按 `infrastructureNeed` **需求**，`ratio < 1` 时线性 debuff。
问题在 plan 0014 §0 讲清了：四类建筑供同一池，但**造价、工程量、供给量各不相同**，玩家每次要
手算「每金净供给」才知道该建哪个；1836 试玩里 QING 的 ratio 从 1.10 跌到 0.79，玩家问
「再建多少才够、哪个值得」——**选择成本高于选择本身的价值**。

plan 0014 §2 评估了三案（A 完全合并 / B 合并+升级档 / C 仅 UI 合并），倾向 **A**：最简单、最符合
统一池的设计意图。本 ADR 落地 A，并**删除运河**（其供给并入基础设施，语义上运河本就与铁路/港口同族）。

## 决定

### 1. 名册：三个合并、一个删除（World v12）

- **删除 `canals`**（建筑类型不再存在）。
- **`railroads` + `ports` + `telegraphs` → `infrastructure`（显示名「基础设施」）**：一座建筑承载
  三者的全部职能——**统一基础设施供给 + 市场接入 + 港口关税效应**（港口税入、进口/航线容量、威望）。
- `types/index.d.ts` 的 `BuildingId` 联合类型、`BUILDINGS`、`BUILDING_RECIPES`、`BUILDING_TIME`（经
  `CAPACITY_COST`）、`INVESTMENT_DEMAND`、`BUILDING_OUTPUT`、`BUILDING_COST_MULTIPLIER/ADDEND`、
  `COUNTRY_SEEDS`、AI 建造候选、面板分组全部按 **19 类**重写。
- 名册（19）：农场、煤矿、铁矿、伐木场、纺织厂、家具厂、酿酒厂、机械厂、钢铁厂、兵工厂、
  奢侈品厂、学校、要塞、船坞、**基础设施**、大学、兵营、官署、营造所。

### 2. 可重拆的接缝（**数据面即可拆回**）

计划的核心约束：这次合并**将来只靠改数据就能拆回**多座建筑。为此引入**唯一真源**：

```ts
// engine/data/buildings.ts
export const INFRA_BUILDING_IDS: BuildingId[] = ['infrastructure']
```

- **所有基建逻辑**——供给求和、维护（`INFRA_UPKEEP`）、市场接入（`INFRA_MARKET_ACCESS`）、
  面板「基建」分组、`completeBuilding` 的「是不是基建」判断、「港口效应」（税入/进口容量/
  航线容量/威望）读数——**一律遍历 `INFRA_BUILDING_IDS` 或读逐建筑系数表**
  （`INFRA_SUPPLY`、`INFRA_MARKET_ACCESS`），**绝不硬编码单一建筑**。
- **逐建筑系数表 + 遗留映射**（写在 `engine/data/buildings.ts` 的注释里，便于将来机械拆回）：

  | 旧建筑 | 供给/座 | 市场接入/座 |
  | --- | --- | --- |
  | `railroads` | 2.5 | 0.02 |
  | `ports` | 1.1 | 0.01 |
  | `canals` | 1.6 | 0.01 |
  | `telegraphs` | 0.7 | 0.005 |

  将来拆回时，只需把 `INFRA_BUILDING_IDS` 改回 `['railroads','ports',...]` 并给每 id 填回上表系数，
  所有消费点自动跟随。

### 3. 系数校准

- **`INFRA_SUPPLY = { infrastructure: 2.16 }`**：按**供给等价**折算四类（`rail×2.5 + port×1.1 +
  canal×1.6 + tel×0.7`），使总供给与合并前相当。
- **`infrastructureNeed = 0.165`**：合并建筑自身也要计入需求（它取代了原四类各自的 `infrastructureNeed`）。
  选 2.16 + 0.165 是**联合校准**的结果：1836 十国 `ratio` 与合并前（v11）相差**最大 2.63%、全部 <5%**
  （见 §4 与 `tests/infrastructure.test.ts` 的护栏）。
- 配方：`output: {}`（成本中心）、`input: { steel: 0.2, wood: 0.16 }`、`labor: 0.54`。输入把唯一
  消耗货物者（铁路：steel 0.5 / wood 0.4）的需求折到新建筑上；0.2/0.16 略高于精确折算值 0.175/0.14，
  使参考点（7 大国产量加权毛利、私人投资连续性）保持中性。**运行维护仍是统一 `INFRA_UPKEEP`**
  （wood/coal/services，按供给缩放），不是这条配方输入。
- 造价 5、`CAPACITY_COST` 3、`INFRA_MARKET_ACCESS = { infrastructure: 0.019 }`（市场接入总量守恒：
  旧 60 铁路×0.02 + 202 港口×0.01 = 3.22，折到 172 座基建 ≈ 0.019/座）。
- **港口关税效应**（`PORT_INCOME_PER_BUILDING`、`IMPORT_CAPACITY_PORT`、`ROUTE_CAPACITY_PORT_COEF`、
  `PRESTIGE_PORT`）改为对 `infrastructureCount()`（遍历 `INFRA_BUILDING_IDS`）生效，系数不变。
  逐国效应与合并前的港口数**并非逐一相等**（新计数不等于旧港口数），但这是合并的固有序数代价。

### 4. 种子折算（供给等价）

每国 `newCount = round((railroads×2.5 + ports×1.1 + canals×1.6 + telegraphs×0.7) / 2.16)`：

| 国 | 铁路 | 港口 | → 基建 |
| --- | --- | --- | --- |
| QING | 0 | 16 | 8 |
| GBR | 25 | 60 | 59 |
| FRA | 8 | 30 | 25 |
| PRU | 7 | 12 | 14 |
| RUS | 5 | 14 | 13 |
| AUS | 7 | 9 | 13 |
| USA | 6 | 25 | 20 |
| JAP | 0 | 10 | 5 |
| OTT | 0 | 12 | 6 |
| SPA | 2 | 14 | 9 |

（运河/电报各国均为 0。）**1836 十国 ratio 与合并前偏差 <5%**（实测最大 2.63%）。

### 5. 成本中心与折旧

基础设施**无货产出**（成本中心），其回报是基础设施流、市场接入与港口关税。因此：

- `BUILDING_OUTPUT.infrastructure = {}`——**私人投资不自动投建**（与合并前的铁路/港口一致）。
- 折旧时**豁免「深度亏损萎缩」**（`engine/country.ts`）：零营收的成本中心若带非空配方输入会被
  误判为深度亏损而以 `SHRINK_MAX` 速度被拆；豁免后仅按基准折旧率磨损（与旧港口的慢折旧一致）。

### 6. 世界版本 → v12

名册与基础设施口径变，按 **ADR 0005** 旧存档直接拒绝；`createWorld` 的 `version` 与 `save.ts` 的
`CURRENT_WORLD_VERSION` 一并升到 **v12**。

## 代价

- **种子折算**：每国四类座数按供给等价折算成一类，`ratio` 有小幅漂移（<5%，护栏在测试里）。
- **港口效应的逐国序数差**：进口容量/航线容量/税入/威望现按基建座数计，与旧港口数不逐一相等。
- **存档断裂**：v11 及更旧存档不可用，需 `/v3 new`。
- 名册变小（22→19），面板「基建」族只剩基础设施 + 营造所。

## 暂不覆盖

- **建筑升级档**（plan 0014 方案 B）：港口→运河→铁路的档位升级未做（当前无升级系统）。
- **地域约束**（港口沿海、铁路内陆）：引擎当前无地域模型（plan 0014 §3）。
- **电报的信息属性**：电报并入基础设施，不再单列信息类建筑。

## 不变量（要求保持）

- `C+I+G+NX === GDP`；全部金币守恒恒等式；贸易路线金币恒等式。
- 60/120 月确定性；鸦片危机门（≥2 单位/月、≥20% 来自英国）。
- `wages + profits` 在 `[0.5, 1.5] × realGdp` 内；`Σ buildingProfits.wages === 全国 wages`。
- **1836 十国基础设施 `ratio` 与合并前偏差 <5%**（`tests/infrastructure.test.ts`）。
