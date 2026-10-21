import type { Country, GameDate, GoodId, WorldState } from '../types'
import { BUILDING_IDS, BUILDINGS, GOODS, GOOD_IDS } from './data'
import {
  CONSTRUCTION_SUBSIDY_POINTS_PER_LEVEL,
  fiscalLedger,
  nationalDebt,
} from './fiscal'
import {
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
 */
export const INSPECT_SECTIONS = [
  'economy',
  'market',
  'fiscal',
  'labor',
  'trade',
  'construction',
  'military',
  'history',
] as const

export type InspectSection = (typeof INSPECT_SECTIONS)[number]

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
  lines.push(`逐建筑经营利润（产出 − 投入 − 工资 = 利润，毛利率；本月价）：`)
  for (const id of BUILDING_IDS) {
    const row = snap.buildingProfits[id]
    const margin = row.revenue > 0 ? row.profit / row.revenue : 0
    lines.push(
      `- ${BUILDINGS[id].name}：产出 ${n(row.revenue)} − 中间投入 ${n(row.inputCost)} − 工资 ${n(row.wages)} = 利润 ${signed(row.profit)}（毛利 ${pct(margin)}，${signed(row.profitPerBuilding, 2)} 金/座）`,
    )
  }
  return lines
}

function fiscalSection(world: WorldState, country: Country): string[] {
  const ledger = fiscalLedger(country, {
    atWar: warFor(world, country.id),
    tick: world.tick,
  })
  const pressure = ledger.debtPressure
  return [
    `财政收入 ${n(ledger.income.total)} = 税入 ${n(ledger.income.taxes)} + 关税 ${n(ledger.income.tariffs)} + 港口 ${n(ledger.income.ports)} + 基金收益 ${n(ledger.income.sovereignIncome)} + 赔款 ${n(ledger.income.reparations)} + 其他 ${n(ledger.income.other)}`,
    `财政支出 ${n(ledger.expense.total)} = 陆军 ${n(ledger.expense.army)} + 海军 ${n(ledger.expense.navy)} + 行政 ${n(ledger.expense.administration)} + 教育 ${n(ledger.expense.education)} + 福利 ${n(ledger.expense.welfare)} + 债息 ${n(ledger.expense.debtInterest)} + 市场损耗 ${n(ledger.expense.marketLoss)} + 维护 ${n(ledger.expense.upkeep)} + 赔款 ${n(ledger.expense.reparations)} + 国有建设 ${n(ledger.expense.construction)} + 建设补贴 ${n(ledger.expense.constructionSubsidy)}`,
    `净额 ${signed(ledger.net)} 金/月；国库 ${signed(country.econ.treasury)}（${ledger.debt > 0 ? `国债 ${n(ledger.debt)}，月息 ${pct(ledger.debtRate, 2)}` : `主权基金 ${n(ledger.fund)}，月息 ${pct(ledger.fundRate, 2)}`}）`,
    `债务压力 ${pressure.label}：债务/GDP ${pct(pressure.ratio, 0)}，收入 −${pct(pressure.incomePenalty, 0)}，建设速度 −${pct(pressure.constructionPenalty, 0)}，合法性目标 −${n(pressure.legitimacyPenalty)}，月息 +${pct(pressure.interestSpread, 2)}`,
    `私人贸易逆差 ${n(ledger.tradeGap)}（私人外债 ${n(ledger.privateDebt)}，不影响国库）；建造力租金收入 ${n(ledger.rentalIncome)}`,
    `税率 ${n(country.econ.taxRate, 0)}%，进口关税 ${n(country.econ.tariff, 0)}% / 出口关税 ${n(country.econ.exportTariff ?? country.econ.tariff, 0)}%`,
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
  const routes = world.tradeRoutes
    .filter(route => route.from === country.id || route.to === country.id)
    .sort(
      (a, b) =>
        b.lastQty - a.lastQty ||
        (a.good < b.good ? -1 : a.good > b.good ? 1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .slice(0, 8)
  lines.push(
    routes.length > 0
      ? `贸易路线（${routes.length} 条）：${routes.map(route => `${GOODS[route.good].name} ${route.from}→${route.to} L${route.level} ${n(route.lastQty, 1)}（利 ${signed(route.lastMargin, 2)}）`).join('，')}`
      : '贸易路线：无',
  )
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
export function inspectWorld(world: WorldState, section: string): string {
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
    case 'construction':
      body = constructionSection(country)
      break
    case 'military':
      body = militarySection(world, country)
      break
    case 'history':
      body = historySection(world, country)
      break
    default:
      return `未知的 inspect 分区「${section}」。可用：${INSPECT_SECTIONS.join(' / ')}`
  }
  return [header, ...body].join('\n')
}
