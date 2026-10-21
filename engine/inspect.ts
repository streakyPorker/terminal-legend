import type { Country, GameDate, GoodId, WorldState } from '../types'
import {
  BUILDING_IDS,
  BUILDINGS,
  BUILDING_RECIPES,
  GOODS,
  GOOD_IDS,
  techCost,
  techName,
  type RecipeIO,
} from './data'
import {
  CONSTRUCTION_SUBSIDY_POINTS_PER_LEVEL,
  fiscalLedger,
  nationalDebt,
} from './fiscal'
import { MODIFIER_STAT_NAMES } from './modifiers'
import {
  OPIUM_CRISIS_TITLE,
  SITUATION_TIMEOUT_MONTHS,
  resultName,
  stanceSummary,
} from './situations'
import {
  CAPACITY_COST,
  WORKLOAD_MULTIPLIER,
  constructionLoad,
  constructionSchedule,
  computeEconomy,
  inspectEconomy,
  projectWorkload,
} from './sim'

/**
 * Read-only detail views for the GM (plan 0006). The status line is a
 * summary; when a player asks "why did this move", the answer should come from
 * an inspect section rather than from reading the save or the engine source.
 *
 * Context economy: facts live in exactly one section. Per-building lines sit
 * in `buildings` (not `economy`); trade routes sit in `routes` (not `trade`);
 * the cross-country comparison sits in `rankings` (not `v3_status`).
 */
export const INSPECT_SECTIONS = [
  'economy',
  'market',
  'fiscal',
  'labor',
  'trade',
  'routes',
  'buildings',
  'construction',
  'military',
  'pops',
  'diplomacy',
  'tech',
  'modifiers',
  'rankings',
  'log',
  'history',
] as const

export type InspectSection = (typeof INSPECT_SECTIONS)[number]

/** Optional filters, currently only used by the `log` section. */
export type InspectOptions = {
  /** `log`: only entries of this log kind (e.g. `war`, `tech`, `economy`). */
  kind?: string
  /** `log`: only entries whose `countryId` matches this id. */
  country?: string
  /** `log`: how many trailing entries to return (default 20, clamped 1..100). */
  limit?: number
}

const n = (value: number, digits = 1): string => {
  if (!Number.isFinite(value)) return '—'
  const rounded = Number(value.toFixed(digits))
  return `${rounded}`
}

const signed = (value: number, digits = 1): string =>
  `${value >= 0 ? '+' : ''}${n(value, digits)}`

const pct = (value: number, digits = 1): string => `${n(value * 100, digits)}%`

const monthsBefore = (date: GameDate, months: number): GameDate => {
  const index = date.year * 12 + (date.month - 1) - months
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

const fmtDate = (date: GameDate): string =>
  `${date.year}.${String(date.month).padStart(2, '0')}`

const warFor = (world: WorldState, id: string): boolean =>
  world.wars.some(war => war.attackers.includes(id) || war.defenders.includes(id))

const warBetween = (world: WorldState, a: string, b: string): boolean =>
  world.wars.some(
    war =>
      (war.attackers.includes(a) && war.defenders.includes(b)) ||
      (war.defenders.includes(a) && war.attackers.includes(b)),
  )

/** `粮食 0.3、木材 0.04` — a recipe basket, or `无` when empty. */
const basket = (io: RecipeIO): string => {
  const parts = GOOD_IDS.filter(id => (io[id] ?? 0) !== 0).map(
    id => `${GOODS[id].name} ${n(io[id] ?? 0, 3)}`,
  )
  return parts.length === 0 ? '无' : parts.join('、')
}

function economySection(world: WorldState, country: Country): string[] {
  const snap = computeEconomy(country, { atWar: warFor(world, country.id), tick: world.tick })
  const lines: string[] = []
  const nx = snap.components.nx
  lines.push(`GDP ${n(snap.gdp)} 金/月 = 消费 ${n(snap.components.c)} + 投资 ${n(snap.components.i)} + 政府 ${n(snap.components.g)} + 净出口 ${signed(nx)}`)
  lines.push(`价格（现值 / 基准，↑ 短缺 ↓ 过剩）：`)
  for (const id of GOOD_IDS) {
    const price = country.econ.prices[id] ?? GOODS[id].basePrice
    const base = GOODS[id].basePrice
    const ratio = base > 0 ? price / base : 1
    const mark = ratio > 1.05 ? '↑' : ratio < 0.95 ? '↓' : '·'
    lines.push(`- ${GOODS[id].name} ${n(price, 2)} / ${n(base, 2)} ${mark} ${n(ratio * 100, 0)}%`)
  }
  const gaps = GOOD_IDS.map(id => {
    const demand = snap.demand[id] ?? 0
    const supply = snap.supply[id] ?? 0
    return { id, gap: demand - supply }
  })
  const deficits = gaps.filter(row => row.gap > 0.01).sort((a, b) => b.gap - a.gap).slice(0, 5)
  const surpluses = gaps.filter(row => row.gap < -0.01).sort((a, b) => a.gap - b.gap).slice(0, 5)
  if (deficits.length > 0) {
    lines.push(`最大缺口：${deficits.map(row => `${GOODS[row.id].name} ${n(row.gap, 2)}`).join('，')}`)
  }
  if (surpluses.length > 0) {
    lines.push(`最大盈余：${surpluses.map(row => `${GOODS[row.id].name} ${n(-row.gap, 2)}`).join('，')}`)
  }
  lines.push(`工资 ${n(country.econ.wages)} / 利润 ${n(country.econ.profits)}，劳动份额 ${pct(country.econ.laborShare)}`)
  // Per-building profit lines moved to `v3_inspect buildings` (context economy).
  lines.push('逐建筑经营利润见 v3_inspect buildings。')
  return lines
}

function fiscalSection(world: WorldState, country: Country): string[] {
  const ledger = fiscalLedger(country, {
    atWar: warFor(world, country.id),
    tick: world.tick,
  })
  const pressure = ledger.debtPressure
  const qty = country.econ.taxBaseQty
  const rates = country.econ.taxes
  const bases = ledger.income.taxBases
  return [
    `财政收入 ${n(ledger.income.total)} = 税入 ${n(ledger.income.taxes)} + 港口 ${n(ledger.income.ports)} + 基金收益 ${n(ledger.income.sovereignIncome)} + 赔款 ${n(ledger.income.reparations)} + 其他 ${n(ledger.income.other)}`,
    `四税基（税基量 × 税率 = 税额）：土地税 ${n(qty.land)} × ${n(rates.land, 0)}% = ${n(bases.land)}；企业所得税 ${n(qty.profit)} × ${n(rates.profit, 0)}% = ${n(bases.profit)}；消费税 ${n(qty.consumption)} × ${n(rates.consumption, 0)}% = ${n(bases.consumption)}；关税 ${n(qty.tariff)} × ${n(country.econ.tariff, 0)}% = ${n(bases.tariff)}`,
    `财政支出 ${n(ledger.expense.total)} = 陆军 ${n(ledger.expense.army)} + 海军 ${n(ledger.expense.navy)} + 行政 ${n(ledger.expense.administration)} + 教育 ${n(ledger.expense.education)} + 福利 ${n(ledger.expense.welfare)} + 债息 ${n(ledger.expense.debtInterest)} + 市场损耗 ${n(ledger.expense.marketLoss)} + 维护 ${n(ledger.expense.upkeep)} + 赔款 ${n(ledger.expense.reparations)} + 国有建设 ${n(ledger.expense.construction)} + 建设补贴 ${n(ledger.expense.constructionSubsidy)}`,
    `净额 ${signed(ledger.net)} 金/月；国库 ${signed(country.econ.treasury)}（${ledger.debt > 0 ? `国债 ${n(ledger.debt)}，月息 ${pct(ledger.debtRate, 2)}` : `主权基金 ${n(ledger.fund)}，月息 ${pct(ledger.fundRate, 2)}`}）`,
    `债务压力 ${pressure.label}：债务/GDP ${pct(pressure.ratio, 0)}，收入 −${pct(pressure.incomePenalty, 0)}，建设速度 −${pct(pressure.constructionPenalty, 0)}，合法性目标 −${n(pressure.legitimacyPenalty)}，月息 +${pct(pressure.interestSpread, 2)}`,
    `私人贸易逆差 ${n(ledger.tradeGap)}（私人外债 ${n(ledger.privateDebt)}，不影响国库）；建造力租金收入 ${n(ledger.rentalIncome)}`,
    `税率：土地 ${n(rates.land, 0)}% / 企业 ${n(rates.profit, 0)}% / 消费 ${n(rates.consumption, 0)}%，进口关税 ${n(country.econ.tariff, 0)}% / 出口关税 ${n(country.econ.exportTariff ?? country.econ.tariff, 0)}%（GDP 是产出，不作税基）`,
  ]
}

function laborSection(country: Country): string[] {
  const econ = country.econ
  const rawGap = Math.max(0, (1 - econ.laborRawUtilization) * 100)
  const structural = Math.max(0, econ.unemployment - rawGap)
  return [
    `失业 ${n(econ.unemployment)}%：原始需求/劳动力 ${pct(econ.laborRawUtilization)}（对应缺口 ${n(rawGap)} 个点），结构性部分约 ${n(structural)} 个点`,
    `劳动需求 ${n(econ.laborDemand)} 万 / 劳动力 ${n(econ.laborForce)} 万；工资 ${n(econ.wages)}，劳动份额 ${pct(econ.laborShare)}`,
    `就业基础：农田 ${n(econ.buildings.farms, 0)}、矿场 ${n(econ.buildings.mines, 0)}、工厂 ${n(econ.buildings.factories, 0)}、营造所 ${n(econ.buildings.workshops, 0)}、铁路 ${n(econ.buildings.railroads, 0)}、港口 ${n(econ.buildings.ports, 0)}`,
    `说明：失业率是结构性指标，除了当月的需求缺口，还含工厂吸纳能力、进口竞争与在职不足；原始利用率只反映前者。`,
  ]
}

function popsSection(country: Country): string[] {
  const pops = country.pops
  const total = Math.max(1, pops.total)
  const classes: [string, number][] = [
    ['农民', pops.peasants],
    ['工人', pops.workers],
    ['手工业者', pops.artisans],
    ['教士', pops.clergy],
    ['贵族', pops.aristocrats],
    ['资本家', pops.capitalists],
  ]
  const lines: string[] = [
    `总人口 ${n(pops.total, 0)} 万；识字率 ${pct(pops.literacy)}，生活水平 ${n(pops.sol, 0)}，激进 ${n(pops.radicals, 0)}，忠诚 ${n(pops.loyalists, 0)}，月增长 ${pct(pops.growth, 2)}`,
    '阶级结构（万人 / 占比）：',
  ]
  for (const [name, value] of classes) {
    lines.push(`- ${name} ${n(value, 0)}（${pct(value / total)}）`)
  }
  lines.push(`失业 ${n(country.econ.unemployment)}%（就业与工资分解见 v3_inspect labor）`)
  return lines
}

function tradeSection(world: WorldState, country: Country): string[] {
  const trade = country.trade
  const lines: string[] = []
  lines.push(
    `出口 ${n(trade.exportValue)} / 进口 ${n(trade.importValue)}，净出口（基准价） ${signed(trade.nx)}；关税 ${n(trade.tariffRevenue)}；进口容量 ${n(trade.capacity)}`,
  )
  const byGood = (flows: typeof trade.imports): { id: GoodId; qty: number; value: number }[] => {
    const map = new Map<GoodId, { id: GoodId; qty: number; value: number }>()
    for (const flow of flows) {
      const row = map.get(flow.good) ?? { id: flow.good, qty: 0, value: 0 }
      row.qty += flow.quantity
      row.value += flow.value
      map.set(flow.good, row)
    }
    return [...map.values()].sort((a, b) => b.value - a.value)
  }
  const imports = byGood(trade.imports).slice(0, 6)
  const exports = byGood(trade.exports).slice(0, 6)
  lines.push(
    imports.length > 0
      ? `进口（按货值）：${imports.map(row => `${GOODS[row.id].name} ${n(row.qty, 1)}（${n(row.value)} 金）`).join('，')}`
      : '进口：无',
  )
  lines.push(
    exports.length > 0
      ? `出口（按货值）：${exports.map(row => `${GOODS[row.id].name} ${n(row.qty, 1)}（${n(row.value)} 金）`).join('，')}`
      : '出口：无',
  )
  const partners = new Map<string, number>()
  for (const flow of trade.imports) partners.set(flow.from, (partners.get(flow.from) ?? 0) + flow.value)
  for (const flow of trade.exports) partners.set(flow.to, (partners.get(flow.to) ?? 0) + flow.value)
  const top = [...partners.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  if (top.length > 0) {
    lines.push(`主要伙伴：${top.map(([id, value]) => `${id} ${n(value)} 金`).join('，')}`)
  }
  // Route lines moved to `v3_inspect routes` (context economy).
  lines.push('贸易路线明细见 v3_inspect routes。')
  return lines
}

function routesSection(world: WorldState, country: Country): string[] {
  const routes = world.tradeRoutes
    .filter(route => route.from === country.id || route.to === country.id)
    .sort(
      (a, b) =>
        b.lastQty - a.lastQty ||
        (a.good < b.good ? -1 : a.good > b.good ? 1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
  if (routes.length === 0) return ['贸易路线：无']
  const lines = [
    `贸易路线（${routes.length} 条；商品 from→to 等级 上月运量 进口方单位利差）：`,
  ]
  for (const route of routes) {
    lines.push(
      `- ${GOODS[route.good].name} ${route.from}→${route.to} L${route.level} 运量 ${n(route.lastQty, 1)} 利差 ${signed(route.lastMargin, 2)}（${route.owner === 'state' ? '国有' : '私人'}）`,
    )
  }
  return lines
}

function marketSection(country: Country): string[] {
  const snap = inspectEconomy(country)
  const lines: string[] = ['商品市场（价格 / 基准，↑ 短缺 ↓ 过剩）：']
  for (const id of GOOD_IDS) {
    const price = country.econ.prices[id] ?? GOODS[id].basePrice
    const base = GOODS[id].basePrice
    const ratio = base > 0 ? price / base : 1
    const mark = ratio > 1.05 ? '↑' : ratio < 0.95 ? '↓' : '·'
    const production = snap.production[id] ?? 0
    const demand = snap.demand[id] ?? 0
    const balance = demand <= 0 ? 2 : production / demand
    const state = balance >= 1.15 ? '盈余' : balance >= 0.9 ? '平衡' : '短缺'
    lines.push(
      `- ${GOODS[id].name} 价格 ${n(price, 2)} / ${n(base, 2)} ${mark} 产出 ${n(production)} 需求 ${n(demand)} 状态 ${state}`,
    )
  }
  const trade = country.trade
  lines.push(
    `对外贸易：出口 ${n(trade.exportValue)} / 进口 ${n(trade.importValue)}，净出口（基准价） ${signed(trade.nx)}；关税收入 ${n(trade.tariffRevenue)}；进口容量 ${n(trade.capacity)}`,
  )
  const partners = new Map<string, { imports: number; exports: number }>()
  for (const flow of trade.imports) {
    const row = partners.get(flow.from) ?? { imports: 0, exports: 0 }
    row.imports += flow.value
    partners.set(flow.from, row)
  }
  for (const flow of trade.exports) {
    const row = partners.get(flow.to) ?? { imports: 0, exports: 0 }
    row.exports += flow.value
    partners.set(flow.to, row)
  }
  const top = [...partners.entries()]
    .map(([id, row]) => ({
      id,
      imports: row.imports,
      exports: row.exports,
      total: row.imports + row.exports,
    }))
    .sort((a, b) => b.total - a.total || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, 6)
  lines.push(
    top.length > 0
      ? `主要伙伴（按贸易总额）：${top.map(row => `${row.id} 进口 ${n(row.imports)} / 出口 ${n(row.exports)} / 合计 ${n(row.total)} 金`).join('，')}`
      : '主要伙伴：本月暂无贸易往来',
  )
  return lines
}

function buildingsSection(country: Country): string[] {
  const lines = ['建筑类型（配方为每座每月；经营利润按本月价，开工率为下月）：']
  for (const id of BUILDING_IDS) {
    const meta = BUILDINGS[id] as {
      name: string
      cost: number
      note: string
      unlock?: string
      infrastructureNeed?: number
    }
    const recipe = BUILDING_RECIPES[id]
    const count = country.econ.buildings[id] ?? 0
    const capacity = CAPACITY_COST[id] ?? 1
    const workload = capacity * WORKLOAD_MULTIPLIER
    const extra: string[] = []
    if (meta.unlock !== undefined) extra.push(`解锁 ${meta.unlock}`)
    if (meta.infrastructureNeed !== undefined) {
      extra.push(`基础设施需求 ${n(meta.infrastructureNeed)}`)
    }
    lines.push(
      `- ${meta.name}×${n(count, 0)}：产出 ${basket(recipe.output)}；投入 ${basket(recipe.input)}；造价 ${n(meta.cost)} 金/座，工程量 ${n(workload)} 点/座，建造点 ${n(capacity)}/月${extra.length > 0 ? `；${extra.join('，')}` : ''}`,
    )
    const row = country.econ.buildingProfits?.[id]
    if (row !== undefined) {
      const margin = row.revenue > 0 ? row.profit / row.revenue : 0
      const idle = row.utilization < 0.999
      lines.push(
        `  经营：产出 ${n(row.revenue)} − 投入 ${n(row.inputCost)} − 工资 ${n(row.wages)} = 利润 ${signed(row.profit)}（毛利 ${pct(margin)}，${signed(row.profitPerBuilding, 2)} 金/座，开工率 ${pct(row.utilization, 0)}${idle ? '，闲置' : ''}）`,
      )
    }
  }
  lines.push(
    '说明：本版 9 类建筑均开局解锁；`unlock`（F2–F7）与 `infrastructureNeed`（F5）字段待后续落地。',
  )
  return lines
}

function constructionSection(country: Country): string[] {
  const load = constructionLoad(country)
  const schedule = constructionSchedule(country)
  const state = country.econ.constructionQueue.filter(
    project => (project.owner ?? 'state') !== 'private',
  )
  const privateProjects = country.econ.constructionQueue.filter(
    project => (project.owner ?? 'state') === 'private',
  )
  const subsidy = Math.max(0, country.econ.spending.construction)
  const lines: string[] = [
    `建造力 ${n(load.capacity)} 点/月 = 营造所 ${n(country.econ.buildings.workshops, 0)} 座的产出 + 建设补贴 ${n(subsidy, 0)} 级 × ${n(CONSTRUCTION_SUBSIDY_POINTS_PER_LEVEL)} 点（补贴另花 ${n(subsidy * 0.45)} 金/月）`,
    `私人资本 ${n(country.econ.privateCapital)} 金，按 0.3 金/点可负担约 ${n(Math.max(0, country.econ.privateCapital) / 0.3, 0)} 点租金；能否租到取决于国有闲置点`,
    `队列剩余工程量 ${n(load.requested)}，已分配 ${n(load.allocated)}，闲置 ${n(load.remaining)}；私人自有 ${n(load.privateOwn)}，租用国有 ${n(load.privateRented)}，市场 ${n(load.privateMarket)}（租金 ${n((load.privateRented + load.privateMarket) * 0.3)} 金/月）`,
  ]
  for (const project of state.slice(0, 12)) {
    lines.push(
      `- 国有 ${BUILDINGS[project.building].name}×${project.count}：剩余 ${n(projectWorkload(project) * (1 - project.progress))}/${n(projectWorkload(project))} 点，进度 ${n(project.progress * 100, 0)}%，本月 ${n(load.byProject[project.id] ?? 0)} 点，预计 ${schedule[project.id]?.turns ?? '—'} 回合`,
    )
  }
  for (const project of privateProjects.slice(0, 8)) {
    lines.push(
      `- 私人 ${BUILDINGS[project.building].name}×${project.count}：进度 ${n(project.progress * 100, 0)}%，自有 ${n(load.privateByProject[project.id]?.own ?? 0)} / 租用 ${n(load.privateByProject[project.id]?.rented ?? 0)} 点`,
    )
  }
  if (state.length + privateProjects.length === 0) lines.push('- 队列：空')
  return lines
}

function militarySection(world: WorldState, country: Country): string[] {
  const wars = world.wars.filter(
    war => war.attackers.includes(country.id) || war.defenders.includes(country.id),
  )
  return [
    `陆军 ${n(country.military.army)} 万，海军 ${n(country.military.navy)}，士气 ${n(country.military.morale, 0)}，战争疲劳 ${n(country.military.exhaustion, 0)}，人力 ${n(country.military.manpower)}，质量 ${pct(country.military.quality, 0)}`,
    `军费：陆军 ${n(country.econ.spending.army)} 级 / 海军 ${n(country.econ.spending.navy)} 级；另有按兵力计算的基本维持费（见 fiscal），砍到 0 级也不会消失`,
    `战争：${wars.length === 0 ? '无' : wars.map(war => `${war.name}（分数 ${n(war.warScore, 0)}）`).join('，')}`,
  ]
}

function techSection(country: Country): string[] {
  const tech = country.tech
  const nextCost = techCost(tech.level + 1)
  const literacy = country.pops.literacy
  const bureaucracy = country.bureaucracy.score
  const base = 2 + literacy * 3 + bureaucracy * 0.06
  const education = country.econ.spending.education
  const universities = country.econ.buildings.universities
  const universityPart =
    universities *
    0.9 *
    (0.4 + literacy) *
    (1 + education * 0.03) *
    (1 + tech.level * 0.02)
  return [
    `科技等级 ${tech.level}（${techName(tech.level)}）；点数 ${n(tech.points)} / 下一级 ${nextCost > 0 ? n(nextCost) : '—'}；研究「${tech.researching}」`,
    `月产出 ${n(tech.pointsPerMonth)} 点 = 基础 ${n(base)}（2 + 识字 ${pct(literacy)}×3 + 官僚 ${n(bureaucracy)}×0.06）+ 大学 ${n(universityPart)}（大学 ${n(universities, 0)} 座 × 0.9 × (0.4 + 识字) × (1 + 教育支出 ${n(education, 2)}×0.03) × (1 + 等级 ${tech.level}×0.02)）`,
    `已解锁：${tech.unlocked.length > 0 ? tech.unlocked.join('、') : '无'}`,
    '说明：月产出为结算前的基础值；生效中的 techPoints 修正会在结算时另乘（见 v3_inspect modifiers）。',
  ]
}

function modifiersSection(world: WorldState): string[] {
  const countries = Object.values(world.countries).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )
  const lines: string[] = []
  for (const country of countries) {
    const modifiers = country.modifiers ?? []
    if (modifiers.length === 0) continue
    lines.push(`[${country.flag}]${country.name}(${country.id}) 修正 ${modifiers.length} 项：`)
    for (const modifier of modifiers) {
      const value = `${signed(modifier.value, 2)}${modifier.stack === 'flat' ? '' : '%'}`
      const months = modifier.monthsLeft === undefined ? '长期' : `${modifier.monthsLeft} 月`
      lines.push(
        `- ${modifier.label}｜stat=${MODIFIER_STAT_NAMES[modifier.stat]}｜stack=${modifier.stack}｜value=${value}｜到期=${months}｜来源=${modifier.source}`,
      )
    }
  }
  if (lines.length === 0) return ['无生效中的修正。']
  return lines
}

function diplomacySection(world: WorldState, country: Country): string[] {
  const diplo = country.diplo
  const lines: string[] = [
    `威望 ${n(diplo.prestige, 0)}，恶名 ${n(diplo.infamy, 0)}；盟友 ${diplo.alliances.length}，对手 ${diplo.rivals.length}，势力范围 ${diplo.sphere.length}`,
  ]
  const others = Object.values(world.countries)
    .filter(other => other.id !== country.id)
    .map(other => ({ other, value: Math.round(diplo.relations[other.id] ?? 0) }))
    .sort(
      (a, b) =>
        b.value - a.value ||
        (a.other.id < b.other.id ? -1 : a.other.id > b.other.id ? 1 : 0),
    )
  lines.push('关系（对本国，正值友好）：')
  for (const { other, value } of others) {
    const marks = [
      warBetween(world, country.id, other.id) ? '战' : '',
      diplo.alliances.includes(other.id) ? '盟' : '',
      diplo.rivals.includes(other.id) ? '敌' : '',
    ]
      .filter(mark => mark !== '')
      .join('')
    lines.push(`- [${other.flag}]${other.name}(${other.id}) ${signed(value, 0)}${marks === '' ? '' : ` ${marks}`}`)
  }
  const nameOf = (id: string): string => {
    const target = world.countries[id]
    return target === undefined ? id : `${target.name}(${id})`
  }
  lines.push(`盟友：${diplo.alliances.length > 0 ? diplo.alliances.map(nameOf).join('、') : '无'}`)
  lines.push(`对手：${diplo.rivals.length > 0 ? diplo.rivals.map(nameOf).join('、') : '无'}`)

  const embargoes = country.embargoes ?? []
  if (embargoes.length === 0) {
    lines.push('本国禁运：无')
  } else {
    lines.push('本国禁运：')
    for (const embargo of embargoes) {
      const scope =
        embargo.goods === 'all'
          ? '全部商品'
          : embargo.goods.map(good => GOODS[good].name).join('、')
      const duration = embargo.months === undefined ? '永久' : `剩 ${embargo.months} 月`
      const reason = embargo.reason === undefined ? '' : `（${embargo.reason}）`
      lines.push(`- 对 ${nameOf(embargo.target)}：${scope}，${duration}${reason}`)
    }
  }
  const against = Object.values(world.countries).filter(other =>
    (other.embargoes ?? []).some(embargo => embargo.target === country.id),
  )
  if (against.length > 0) {
    lines.push(`被禁运：${against.map(other => nameOf(other.id)).join('、')}`)
  }

  const tensions = (world.tradeTensions ?? []).filter(
    tension => tension.from === country.id || tension.partner === country.id,
  )
  if (tensions.length === 0) {
    lines.push('贸易张力：无')
  } else {
    lines.push(`贸易张力（近 ${Math.min(5, tensions.length)} 条）：`)
    for (const tension of tensions.slice(-5).reverse()) {
      lines.push(
        `- ${fmtDate(tension.date)} ${nameOf(tension.from)}→${nameOf(tension.partner)} ${GOODS[tension.good].name} ${signed(tension.relationDelta, 0)} ${tension.reason}`,
      )
    }
  }

  if (world.situations.length === 0) {
    lines.push('局势：无')
  } else {
    lines.push('局势：')
    for (const situation of world.situations) {
      const state = situation.resolved
        ? `已解决：${resultName(situation.resultId) || '—'}`
        : situation.months >= SITUATION_TIMEOUT_MONTHS
          ? '待仲裁'
          : `等待各方（${situation.months}/${SITUATION_TIMEOUT_MONTHS} 月）`
      lines.push(`- ${OPIUM_CRISIS_TITLE} ${state}｜${stanceSummary(situation)}`)
    }
  }
  return lines
}

function rankingsSection(world: WorldState): string[] {
  const all = Object.values(world.countries)
  const majors = all.filter(country => country.isMajor)
  const countries = majors.length >= 3 ? majors : all
  const by = (key: (country: Country) => number): Country[] =>
    [...countries].sort(
      (a, b) => key(b) - key(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
  const lines: string[] = [
    `列强排名（${countries.length} 国 · 各维度从高到低；单位 金/万/%）：`,
  ]
  const table = (
    title: string,
    rows: Country[],
    columns: [string, (country: Country) => string][],
  ): void => {
    lines.push(`${title}：`)
    for (const country of rows) {
      const cells = columns.map(([label, value]) => `${label} ${value(country)}`).join('，')
      lines.push(`- [${country.flag}]${country.name}(${country.id}) ${cells}`)
    }
  }
  table('经济（按 GDP 排序）', by(country => country.econ.gdp), [
    ['GDP', country => n(country.econ.gdp)],
    ['净资产', country => n(country.econ.treasury)],
    ['收入', country => n(country.econ.income)],
    ['国债', country => n(nationalDebt(country))],
  ])
  table('人口与社会（按人口排序）', by(country => country.pops.total), [
    ['人口', country => `${n(country.pops.total, 0)}万`],
    ['识字率', country => pct(country.pops.literacy)],
    ['生活水平', country => n(country.pops.sol, 0)],
    ['失业', country => `${n(country.econ.unemployment)}%`],
    ['激进', country => n(country.pops.radicals, 0)],
  ])
  table(
    '军事（按陆军战力排序）',
    by(country => country.military.army * country.military.quality),
    [
      ['陆军', country => `${n(country.military.army)}万`],
      ['海军', country => n(country.military.navy)],
      ['士气', country => n(country.military.morale, 0)],
      ['陆军战力', country => n(country.military.army * country.military.quality)],
    ],
  )
  table('科技与行政（按科技等级排序）', by(country => country.tech.level), [
    ['科技', country => `${country.tech.level}级`],
    ['官僚效能', country => `${Math.round(country.bureaucracy.score)}/${Math.round(country.bureaucracy.ceiling)}`],
    ['合法性', country => n(country.government.legitimacy, 0)],
    ['权威', country => n(country.government.authority, 0)],
  ])
  table('外交与威望（按威望排序）', by(country => country.diplo.prestige), [
    ['威望', country => n(country.diplo.prestige, 0)],
    ['恶名', country => n(country.diplo.infamy, 0)],
    ['盟友', country => String(country.diplo.alliances.length)],
    ['对手', country => String(country.diplo.rivals.length)],
    [
      '战争',
      country =>
        String(
          world.wars.filter(
            war => war.attackers.includes(country.id) || war.defenders.includes(country.id),
          ).length,
        ),
    ],
  ])
  return lines
}

function logSection(world: WorldState, options?: InspectOptions): string[] {
  let entries = world.log
  const filters: string[] = []
  if (options?.kind !== undefined) {
    entries = entries.filter(entry => entry.kind === options.kind)
    filters.push(`kind=${options.kind}`)
  }
  if (options?.country !== undefined) {
    entries = entries.filter(entry => entry.countryId === options.country)
    filters.push(`country=${options.country}`)
  }
  const limit = Math.min(100, Math.max(1, Math.floor(options?.limit ?? 20)))
  const shown = entries.slice(-limit)
  const desc = filters.length === 0 ? `最近 ${shown.length} 条` : `${filters.join('，')}，最近 ${shown.length} 条`
  const lines = [`编年史（${desc}）：`]
  if (shown.length === 0) {
    lines.push('- 无匹配的日志条目')
    return lines
  }
  for (const entry of shown) {
    const country = entry.countryId === undefined ? '' : `(${entry.countryId})`
    lines.push(`- ${fmtDate(entry.date)} [${entry.kind}]${country} ${entry.text}`)
  }
  return lines
}

function historySection(world: WorldState, country: Country): string[] {
  const history = country.econ.history
  const length = Math.min(
    12,
    history.gdp.length,
    history.unemployment.length,
    history.income.length,
  )
  if (length === 0) return ['（还没有月度历史）']
  const lines: string[] = ['日期　　GDP　消费　投资　政府　失业　收入　支出　关税　国债']
  for (let index = length - 1; index >= 0; index -= 1) {
    const date = monthsBefore(world.date, index)
    const at = (series: number[] | undefined, fallback: number): number => {
      const value = series?.[series.length - length + index]
      return value ?? fallback
    }
    lines.push(
      `${fmtDate(date)}　${n(at(history.gdp, country.econ.gdp))}　${n(at(history.c, 0))}　${n(at(history.i, 0))}　${n(at(history.g, 0))}　${n(at(history.unemployment, country.econ.unemployment))}%　${n(at(history.income, country.econ.income))}　${n(at(history.expense, country.econ.expense))}　${n(at(history.tariff, country.econ.lastTariffRevenue))}　${n(at(history.debt, nationalDebt(country)))}`,
    )
  }
  return lines
}

/**
 * Next-month cash sketch (plan 0006): last settled income/expense, with the
 * construction block replaced by this month's points and the rent that will be
 * booked next month. It is a plan, not a promise: trade and events move.
 */
export function forecastWorld(world: WorldState): string {
  const country = world.countries[world.playerId]
  if (country === undefined) return '还没有进行中的游戏。'
  const ledger = fiscalLedger(country, {
    atWar: warFor(world, country.id),
    tick: world.tick,
  })
  const load = constructionLoad(country)
  const subsidy = Math.max(0, country.econ.spending.construction) * 0.45
  const construction = load.allocated * 0.2
  const rent =
    (load.privateRented + load.privateMarket) * 0.3
  const income =
    ledger.income.total - ledger.income.other + rent
  const expense =
    ledger.expense.total -
    ledger.expense.construction -
    ledger.expense.constructionSubsidy +
    construction +
    subsidy
  const net = income - expense
  const treasury = country.econ.treasury + net
  const lines = [
    `[${country.flag}] ${country.name} · 下月现金流预估（${world.date.year}.${String(world.date.month).padStart(2, '0')} 结算后）`,
    `收入约 ${n(income)} = 上月的 ${n(ledger.income.total)} − 上月「其他」${n(ledger.income.other)} + 预计租金 ${n(rent)}`,
    `支出约 ${n(expense)} = 上月 ${n(ledger.expense.total)} − 上月国有建设 ${n(ledger.expense.construction)} − 补贴 ${n(ledger.expense.constructionSubsidy)} + 本月建造点 ${n(load.allocated)}×0.2 + 补贴 ${n(subsidy)}`,
    `净额约 ${signed(net)} 金；结算后国库约 ${signed(treasury)}${treasury < 0 ? '（转国债）' : treasury > 0 ? '（主权基金）' : ''}`,
    `建造力 ${n(load.capacity)}，已分配 ${n(load.allocated)}，私人租用 ${n(load.privateRented + load.privateMarket)}，闲置 ${n(load.remaining)}`,
    '这是计划值：贸易量、事件、关税与私人租金都会让它偏移。',
  ]
  return lines.join('\n')
}

/** Build one inspect report for the player country. */
export function inspectWorld(
  world: WorldState,
  section: string,
  options?: InspectOptions,
): string {
  const country = world.countries[world.playerId]
  if (country === undefined) return '还没有进行中的游戏。'
  const key = section.toLowerCase() as InspectSection
  const header = `[${country.flag}] ${country.name} · ${world.date.year}.${String(world.date.month).padStart(2, '0')}`
  let body: string[]
  switch (key) {
    case 'economy':
      body = economySection(world, country)
      break
    case 'market':
      body = marketSection(country)
      break
    case 'fiscal':
      body = fiscalSection(world, country)
      break
    case 'labor':
      body = laborSection(country)
      break
    case 'trade':
      body = tradeSection(world, country)
      break
    case 'routes':
      body = routesSection(world, country)
      break
    case 'buildings':
      body = buildingsSection(country)
      break
    case 'construction':
      body = constructionSection(country)
      break
    case 'military':
      body = militarySection(world, country)
      break
    case 'pops':
      body = popsSection(country)
      break
    case 'diplomacy':
      body = diplomacySection(world, country)
      break
    case 'tech':
      body = techSection(country)
      break
    case 'modifiers':
      body = modifiersSection(world)
      break
    case 'rankings':
      body = rankingsSection(world)
      break
    case 'log':
      body = logSection(world, options)
      break
    case 'history':
      body = historySection(world, country)
      break
    default:
      return `未知的 inspect 分区「${section}」。可用：${INSPECT_SECTIONS.join(' / ')}`
  }
  return [header, ...body].join('\n')
}
