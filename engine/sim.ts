import type {
  BuildingId,
  Country,
  ConstructionProject,
  EventOption,
  GameDate,
  GameEvent,
  GoodId,
  LogEntry,
  LogKind,
  War,
  WorldState,
} from '../types'
import {
  BUILDINGS,
  BUILDING_TIME,
  GOODS,
  GOOD_IDS,
  buildOf,
  createWorld,
  deriveBureaucracy,
  deriveUnemployment,
  makeRngForWorld,
  spawnEvent,
  successorFor,
  techCost,
  techName,
} from './data'
import type { Rng } from './rng'
import { addModifier, applyModifiers, tickModifiers } from './modifiers'

export type Decision = {
  countryId: string
  action: string
  params: Record<string, string | number | boolean | undefined>
  narrative?: string
}

export type AdvanceReport = {
  start: GameDate
  end: GameDate
  log: LogEntry[]
  events: GameEvent[]
}

export type EconomySnapshot = {
  production: Record<GoodId, number>
  demand: Record<GoodId, number>
  gdp: number
  income: number
  expense: number
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function advanceDate(date: GameDate): GameDate {
  const month = date.month === 12 ? 1 : date.month + 1
  const year = date.month === 12 ? date.year + 1 : date.year
  return { year, month }
}

export function dateDistance(a: GameDate, b: GameDate): number {
  return (a.year - b.year) * 12 + (a.month - b.month)
}

const zeroGoods = (): Record<GoodId, number> => {
  const out = {} as Record<GoodId, number>
  for (const id of GOOD_IDS) out[id] = 0
  return out
}

const techMultiplier = (country: Country): number => 1 + country.tech.level * 0.07

function computeProduction(country: Country): Record<GoodId, number> {
  const tech = techMultiplier(country)
  const marketAccess = applyModifiers(country, 'marketAccess', country.econ.marketAccess)
  const access = 0.55 + marketAccess * 0.9
  const transport = applyModifiers(
    country,
    'transportInfrastructure',
    country.econ.transportInfrastructure,
  )
  const infra = 0.6 + transport / 160
  const b = country.econ.buildings
  const out = zeroGoods()
  // Every good reads through the generic `production` buff and its own
  // per-good buff, so policies can target either scale.
  const output = (id: GoodId, value: number): number =>
    applyModifiers(country, 'production', applyModifiers(country, `${id}Output`, value))

  out.grain = output('grain', b.farms * 1.05 * tech * infra * access)
  out.wood = output('wood', b.farms * 0.16 + b.mines * 0.06)
  out.coal = output('coal', b.mines * 0.5 * tech)
  out.iron = output('iron', b.mines * 0.42 * tech)
  out.fabric = output('fabric', b.factories * 0.6 * tech)
  out.clothes = output('clothes', b.factories * 0.38 * tech)
  out.liquor = output('liquor', b.factories * 0.2)
  out.furniture = output('furniture', b.factories * 0.22 * tech)
  out.machinery = output('machinery', b.factories * 0.09 * tech)
  out.arms = output('arms', b.factories * 0.07 * tech + b.barracks * 0.05)
  out.luxury = output('luxury', b.factories * 0.035 * tech)
  out.services = output('services', (country.pops.total / 1000) * 0.5 * access)
  return out
}

function computeDemand(country: Country): Record<GoodId, number> {
  const popFactor = Math.max(0.1, country.pops.total / 1000)
  const solFactor = 0.7 + country.pops.sol / 100
  const b = country.econ.buildings
  const out = zeroGoods()

  out.grain = popFactor * 9 * solFactor
  out.clothes = popFactor * 2.2 * solFactor
  out.furniture = popFactor * 0.7 * solFactor
  out.liquor = popFactor * 1.1 * solFactor
  out.services = popFactor * 2.0 * solFactor
  out.luxury =
    popFactor *
    0.18 *
    solFactor *
    (0.5 + (country.pops.capitalists / Math.max(1, country.pops.total)) * 8)
  out.coal = popFactor * 1.2 + b.factories * 0.35
  out.iron = popFactor * 0.8 + b.factories * 0.4 + b.railroads * 0.5
  out.fabric = b.factories * 0.45 + popFactor * 0.5
  out.wood = b.factories * 0.2 + b.railroads * 0.4 + popFactor * 0.3
  out.machinery = b.factories * 0.18
  out.arms = country.military.army * 0.02 + country.military.navy * 0.01
  return out
}

/** Production and demand for display, with no side effects. */
export function inspectEconomy(country: Country): {
  production: Record<GoodId, number>
  demand: Record<GoodId, number>
} {
  return { production: computeProduction(country), demand: computeDemand(country) }
}

export function computeEconomy(country: Country): EconomySnapshot {
  const production = computeProduction(country)
  const demand = computeDemand(country)

  for (const id of GOOD_IDS) {
    const produced = Math.max(0.01, production[id])
    const ratio = demand[id] / produced
    const target = GOODS[id].basePrice * clamp(Math.sqrt(ratio), 0.35, 3)
    const floor = GOODS[id].basePrice * 0.25
    const ceiling = GOODS[id].basePrice * 4
    country.econ.prices[id] = clamp(
      country.econ.prices[id] + (target - country.econ.prices[id]) * 0.3,
      floor,
      ceiling,
    )
  }

  let gross = 0
  for (const id of GOOD_IDS) gross += production[id] * country.econ.prices[id]
  const gdp = gross * 0.36 + country.pops.total * 0.008

  const tradeVolume = gross * 0.35
  const taxEfficiency = applyModifiers(
    country,
    'taxEfficiency',
    0.5 + country.government.legitimacy / 200,
  )
  const income = applyModifiers(
    country,
    'income',
    gdp * (country.econ.taxRate / 100) * 0.25 * taxEfficiency +
      tradeVolume * (country.econ.tariff / 100) * 0.12 +
      country.econ.buildings.ports * 0.02,
  )

  const b = country.econ.buildings
  const sp = country.econ.spending
  const popFactor = Math.max(0.1, country.pops.total / 1000)
  const expense =
    country.military.army * 0.05 * (1 + country.military.quality) +
    country.military.navy * 0.04 +
    // Standing appropriations: armies and fleets are no longer free.
    sp.army * 0.5 +
    sp.navy * 0.5 +
    popFactor * 0.12 +
    sp.bureaucracy * popFactor * 0.02 +
    sp.education * popFactor * 0.03 +
    sp.welfare * popFactor * 0.03 +
    // Construction is spent by the queue in simulateCountry, and folded into
    // the displayed expense there.
    country.econ.debt * 0.004 +
    gdp * (1 - applyModifiers(country, 'marketAccess', country.econ.marketAccess)) * 0.02 +
    (b.universities + b.barracks) * 0.01

  return {
    production,
    demand,
    gdp,
    income,
    expense: applyModifiers(country, 'expense', expense),
  }
}

export function calibrateWorld(world: WorldState): void {
  for (const country of Object.values(world.countries)) {
    const snap = computeEconomy(country)
    country.econ.gdp = snap.gdp
    country.econ.income = snap.income
    country.econ.expense = snap.expense
    country.econ.goods = snap.production
    country.econ.history = {
      gdp: [snap.gdp],
      treasury: [country.econ.treasury],
      sol: [country.pops.sol],
      legitimacy: [country.government.legitimacy],
      radicals: [country.pops.radicals],
    }
    country.diplo.prestige = computePrestige(country)
  }
}

function computePrestige(country: Country): number {
  return clamp(
    applyModifiers(
      country,
      'prestige',
      country.econ.gdp * 0.05 +
        country.military.army * 0.18 +
        country.military.navy * 0.22 +
        country.tech.level * 4 +
        country.econ.buildings.ports * 0.2,
    ),
    0,
    240,
  )
}

function pushHistory(list: number[], value: number): void {
  list.push(Math.round(value * 100) / 100)
  if (list.length > 36) list.shift()
}

/** Adds built structures and their side effects. */
export function completeBuilding(country: Country, building: BuildingId, count: number): void {
  country.econ.buildings[building] += count
  if (building === 'railroads') {
    country.econ.transportInfrastructure = clamp(
      country.econ.transportInfrastructure + count * 3,
      0,
      100,
    )
    country.econ.marketAccess = clamp(country.econ.marketAccess + count * 0.02, 0, 1)
  }
  if (building === 'ports') {
    country.econ.marketAccess = clamp(country.econ.marketAccess + count * 0.01, 0, 1)
  }
  if (building === 'universities') {
    country.econ.administrativeCapacity = clamp(
      country.econ.administrativeCapacity + count * 0.5,
      0,
      100,
    )
  }
  if (building === 'offices') {
    country.econ.administrativeCapacity = clamp(
      country.econ.administrativeCapacity + count,
      0,
      100,
    )
  }
  country.bureaucracy = deriveBureaucracy(country, true)
}

/**
 * Spends the month's construction budget on queued projects. Money is
 * deducted as it is spent; whatever no project absorbs is administrative
 * waste (plan §7.3). Projects whose cash or budget runs out keep their
 * progress and wait for a better month.
 */
function settleConstruction(
  world: WorldState,
  country: Country,
  rng: Rng,
  log: LogEntry[],
): void {
  const queue = country.econ.constructionQueue
  if (queue.length === 0) return
  let budget = country.econ.spending.construction * 0.8
  const remaining: ConstructionProject[] = []

  for (const project of queue) {
    // Fund a full month's bill where the budget allows; bureaucratic leakage
    // then decides how much of it becomes progress. (Capping the spend at the
    // remaining progress would approach 1 asymptotically and never finish.)
    const spend = Math.min(budget, project.monthlyCost, Math.max(0, country.econ.treasury))
    if (spend > 0) {
      budget -= spend
      country.econ.treasury -= spend
      const effective =
        spend *
        applyModifiers(country, 'constructionSpeed', country.bureaucracy.fundEfficiency)
      project.progress = Math.min(
        1,
        project.progress + effective / Math.max(0.0001, project.monthlyCost),
      )
    }

    if (project.progress >= 1) {
      project.monthsLeft -= 1
      project.progress = 0
      if (project.monthsLeft <= 0) {
        if (rng.chance(country.bureaucracy.delayChance)) {
          project.monthsLeft = 1
          remaining.push(project)
          continue
        }
        completeBuilding(country, project.building, project.count)
        log.push({
          date: { ...world.date },
          kind: 'economy',
          countryId: country.id,
          text: `[${country.flag}] ${country.name}建成 ${project.count} 座${BUILDINGS[project.building].name}`,
        })
        continue
      }
    }
    remaining.push(project)
  }

  country.econ.constructionQueue = remaining
  // Unused appropriations evaporate into the administration.
  const waste = Math.min(Math.max(0, budget), Math.max(0, country.econ.treasury))
  country.econ.treasury -= waste
}

function simulateCountry(
  world: WorldState,
  country: Country,
  rng: Rng,
  log: LogEntry[],
): void {
  const oldPops = Math.max(1, country.pops.total)
  const snap = computeEconomy(country)

  // Market scarcity feeds unrest.
  let scarcity = 0
  for (const id of GOOD_IDS) {
    const demand = snap.demand[id]
    if (demand <= 0) continue
    const shortage = Math.max(0, demand - snap.production[id])
    scarcity += (shortage / demand) * (id === 'grain' || id === 'clothes' ? 1.6 : 0.5)
  }
  scarcity = clamp(scarcity, 0, 8)

  const constructionBudget = country.econ.spending.construction * 0.8
  country.econ.gdp = snap.gdp
  country.econ.income = snap.income
  country.econ.expense = snap.expense + constructionBudget
  country.econ.goods = snap.production

  const balance = snap.income - snap.expense
  country.econ.treasury += balance
  if (country.econ.treasury < 0) {
    country.econ.debt += -country.econ.treasury
    country.econ.treasury = 0
  } else if (country.econ.debt > 0 && country.econ.treasury > 2) {
    const repay = Math.min(country.econ.debt, country.econ.treasury * 0.08)
    country.econ.debt -= repay
    country.econ.treasury -= repay
  }

  // The construction queue pays from the appropriation, including its waste.
  settleConstruction(world, country, rng, log)

  // Pops: growth, urbanisation, standard of living.
  const growthRate = applyModifiers(
    country,
    'growth',
    0.0012 +
      (country.pops.sol - 40) / 20000 -
      country.pops.radicals / 50000 -
      country.military.exhaustion / 100000,
  )
  country.pops.growth = growthRate
  const newTotal = Math.max(1, oldPops * (1 + growthRate))
  const scale = newTotal / oldPops
  country.pops.total = newTotal
  country.pops.peasants *= scale
  country.pops.workers *= scale
  country.pops.artisans *= scale
  country.pops.clergy *= scale
  country.pops.aristocrats *= scale
  country.pops.capitalists *= scale

  const urbanPull = Math.min(
    country.pops.peasants * 0.0008,
    country.econ.buildings.factories * 0.015 * (1 + country.tech.level * 0.05),
  )
  country.pops.peasants -= urbanPull
  country.pops.workers += urbanPull

  const artisanShift = Math.min(
    country.pops.artisans * 0.0006,
    country.econ.buildings.factories * 0.003,
  )
  country.pops.artisans -= artisanShift
  country.pops.workers += artisanShift

  country.pops.sol = clamp(
    applyModifiers(
      country,
      'sol',
      20 +
        (snap.gdp / Math.max(1, country.pops.total)) * 250 +
        country.tech.level * 1.2 -
        country.pops.radicals * 0.2 +
        country.econ.spending.welfare * 2,
    ),
    5,
    95,
  )

  const literacyGain =
    (country.econ.spending.education * 0.0008 +
      country.econ.buildings.universities * 0.0002) *
    (1 - country.pops.literacy)
  country.pops.literacy = clamp(
    country.pops.literacy + applyModifiers(country, 'literacy', literacyGain),
    0,
    1,
  )

  // Industry absorbs labour; literacy and unrest move the rate the other way.
  country.econ.unemployment = clamp(
    applyModifiers(country, 'unemployment', deriveUnemployment(country)),
    0,
    30,
  )

  const radicalPressure =
    Math.max(0, country.econ.taxRate - 10) * 0.12 +
    Math.max(0, country.econ.tariff - 10) * 0.04 +
    Math.max(0, 40 - country.pops.sol) * 0.06 +
    country.military.exhaustion * 0.08 +
    country.econ.unemployment * 0.04 +
    scarcity * 0.2
  const relief =
    (country.government.legitimacy / 100) * 0.25 +
    country.econ.spending.welfare * 0.15 +
    country.econ.spending.education * 0.05 +
    country.pops.loyalists * 0.01
  // Radicals and loyalists are stocks updated by a monthly flow; modifiers
  // scale the flow, not the stock, so a percent buff cannot compound monthly.
  country.pops.radicals = clamp(
    country.pops.radicals + applyModifiers(country, 'radicals', radicalPressure - relief),
    0,
    100,
  )
  country.pops.loyalists = clamp(
    country.pops.loyalists +
      applyModifiers(
        country,
        'loyalists',
        country.government.legitimacy * 0.01 - radicalPressure * 0.3,
      ),
    0,
    100,
  )

  const govBonus =
    country.government.type === '专制君主制'
      ? -4
      : country.government.type === '君主立宪制'
        ? 8
        : country.government.type === '共和制'
          ? 10
          : country.government.type === '民主制'
            ? 12
            : country.government.type === '寡头制'
              ? -2
              : 0
  const legitimacyTarget = clamp(
    applyModifiers(
      country,
      'legitimacy',
      50 +
        govBonus -
        country.pops.radicals * 0.5 +
        (country.econ.treasury > 0 ? 4 : -6) +
        (country.econ.debt > snap.gdp ? -10 : 0) -
        country.military.exhaustion * 0.2 +
        country.econ.spending.welfare * 2,
    ),
    0,
    100,
  )
  country.government.legitimacy +=
    (legitimacyTarget - country.government.legitimacy) * 0.08

  // Authority recovers in proportion to legitimacy.
  country.government.authority = clamp(
    country.government.authority +
      applyModifiers(country, 'authority', country.government.legitimacy * 0.03),
    0,
    100,
  )

  // Bureaucratic effectiveness and the four constraints it feeds.
  country.bureaucracy = deriveBureaucracy(country, true)

  // Technology.
  country.tech.pointsPerMonth =
    country.econ.buildings.universities *
    0.9 *
    (0.4 + country.pops.literacy) *
    (1 + country.econ.spending.education * 0.03) *
    (1 + country.tech.level * 0.02)
  country.tech.points += applyModifiers(
    country,
    'techPoints',
    country.tech.pointsPerMonth,
  )
  const nextCost = techCost(country.tech.level + 1)
  if (country.tech.level < 10 && country.tech.points >= nextCost) {
    country.tech.points -= nextCost
    country.tech.level += 1
    const unlocked = techName(country.tech.level)
    country.tech.unlocked.push(unlocked)
    country.tech.researching = techName(country.tech.level + 1)
    log.push({
      date: { ...world.date },
      kind: 'tech',
      countryId: country.id,
      text: `[${country.flag}] ${country.name}解锁了「${unlocked}」`,
    })
  }

  // Military.
  country.military.manpower = clamp(
    country.military.manpower +
      applyModifiers(
        country,
        'manpower',
        country.pops.total * 0.0004 - country.military.army * 0.0006,
      ),
    0,
    country.pops.total * 0.06,
  )
  // Morale is a stock fed by a monthly flow; scale the flow.
  country.military.morale = clamp(
    country.military.morale +
      applyModifiers(country, 'morale', country.econ.spending.army > 1 ? 0.15 : -0.15),
    20,
    100,
  )

  country.diplo.prestige = computePrestige(country)

  // Leaders age; an old one eventually gives way to the next generation.
  country.leader.age += 1 / 12
  if (
    country.leader.age >= 82 ||
    (country.leader.age >= 70 && rng.chance(0.002))
  ) {
    const oldName = `${country.leader.title}${country.leader.name}`
    country.leader = successorFor(country, rng)
    country.government.legitimacy = clamp(country.government.legitimacy - 5, 0, 100)
    log.push({
      date: { ...world.date },
      kind: 'leader',
      countryId: country.id,
      text: `[${country.flag}] ${country.name}：${oldName}逝世，${country.leader.title}${country.leader.name}继位`,
    })
  }

  // Timed buffs and debuffs age one month.
  for (const label of tickModifiers(country)) {
    log.push({
      date: { ...world.date },
      kind: 'politics',
      countryId: country.id,
      text: `[${country.flag}] ${country.name}：「${label}」到期`,
    })
  }

  pushHistory(country.econ.history.gdp, snap.gdp)
  pushHistory(country.econ.history.treasury, country.econ.treasury)
  pushHistory(country.econ.history.sol, country.pops.sol)
  pushHistory(country.econ.history.legitimacy, country.government.legitimacy)
  pushHistory(country.econ.history.radicals, country.pops.radicals)

  if (country.econ.treasury <= 0 && snap.income - country.econ.expense < 0 && rng.chance(0.2)) {
    log.push({
      date: { ...world.date },
      kind: 'economy',
      countryId: country.id,
      text: `[${country.flag}] ${country.name}财政告急，国债升至 ${country.econ.debt.toFixed(1)}`,
    })
  }
}

function driftRelations(world: WorldState): void {
  for (const country of Object.values(world.countries)) {
    for (const other of Object.values(world.countries)) {
      if (other.id === country.id) continue
      const current = country.diplo.relations[other.id] ?? 0
      // Infamy drags every relationship's resting point down.
      const infamyDrag = country.diplo.infamy * 0.1
      const target =
        (country.diplo.alliances.includes(other.id)
          ? 55
          : country.diplo.rivals.includes(other.id)
            ? -35
            : 0) - infamyDrag
      country.diplo.relations[other.id] = current + (target - current) * 0.012
    }
  }
}

function strength(world: WorldState, ids: string[]): number {
  let total = 0
  for (const id of ids) {
    const country = world.countries[id]
    if (country === undefined) continue
    total += applyModifiers(
      country,
      'armyStrength',
      country.military.army *
        country.military.quality *
        (country.military.morale / 60) *
        (1 + country.tech.level * 0.03),
    )
  }
  return total
}

function endWar(
  world: WorldState,
  war: War,
  winner: 'attackers' | 'defenders' | 'white',
  log: LogEntry[],
): void {
  const attackerIds = war.attackers
  const defenderIds = war.defenders
  const winnerIds = winner === 'attackers' ? attackerIds : winner === 'defenders' ? defenderIds : []
  const loserIds = winner === 'attackers' ? defenderIds : winner === 'defenders' ? attackerIds : []

  for (const id of winnerIds) {
    const country = world.countries[id]
    if (country === undefined) continue
    country.diplo.prestige = clamp(country.diplo.prestige + 12, 0, 240)
    country.military.exhaustion = clamp(country.military.exhaustion - 15, 0, 100)
    country.military.morale = clamp(country.military.morale + 10, 20, 100)
    country.leader.memory.push(`${war.name}以胜利告终`)
    if (country.leader.memory.length > 8) country.leader.memory.shift()
  }
  for (const id of loserIds) {
    const country = world.countries[id]
    if (country === undefined) continue
    const reparations = Math.min(country.econ.treasury, country.econ.gdp * 0.08)
    country.econ.treasury -= reparations
    country.diplo.prestige = clamp(country.diplo.prestige - 15, 0, 240)
    country.military.exhaustion = clamp(country.military.exhaustion + 5, 0, 100)
    country.pops.radicals = clamp(country.pops.radicals + 6, 0, 100)
    country.leader.memory.push(`${war.name}以失败告终`)
    if (country.leader.memory.length > 8) country.leader.memory.shift()
  }

  for (const id of [...attackerIds, ...defenderIds]) {
    const country = world.countries[id]
    if (country === undefined) continue
    for (const otherId of [...attackerIds, ...defenderIds]) {
      if (otherId === id) continue
      const current = country.diplo.relations[otherId] ?? 0
      country.diplo.relations[otherId] = clamp(current - 20, -100, 100)
    }
  }

  world.wars = world.wars.filter(one => one.id !== war.id)
  log.push({
    date: { ...world.date },
    kind: 'war',
    text:
      winner === 'white'
        ? `《${war.name}》以白和告终`
        : `《${war.name}》结束：${winner === 'attackers' ? '进攻方' : '防守方'}获胜`,
  })
}

function resolveWars(world: WorldState, rng: Rng, log: LogEntry[]): void {
  for (const war of [...world.wars]) {
    war.months += 1
    war.battles += 1
    const attack = strength(world, war.attackers) / Math.max(1, war.attackers.length)
    const defend = strength(world, war.defenders) / Math.max(1, war.defenders.length)
    const delta = clamp(((attack - defend) / Math.max(1, attack + defend)) * 12, -12, 12)
    war.warScore = clamp(war.warScore + delta + rng.range(-2, 2), -100, 100)
    war.lastEvent =
      delta > 3
        ? '进攻方在战场上占了上风'
        : delta < -3
          ? '防守方稳住了阵线'
          : '双方在战线上僵持'

    for (const id of [...war.attackers, ...war.defenders]) {
      const country = world.countries[id]
      if (country === undefined) continue
      country.military.exhaustion = clamp(country.military.exhaustion + 1.2, 0, 100)
      country.military.morale = clamp(country.military.morale - 0.4, 20, 100)
      country.pops.radicals = clamp(country.pops.radicals + 0.5, 0, 100)
    }

    if (war.warScore >= 75) {
      endWar(world, war, 'attackers', log)
    } else if (war.warScore <= -75) {
      endWar(world, war, 'defenders', log)
    } else if (war.months >= 60) {
      endWar(world, war, 'white', log)
    }
  }
}

function aiEventChoice(country: Country, options: EventOption[], rng: Rng): EventOption {
  const aggressive = country.leader.traits.some(trait =>
    ['扩张', '军事', '专制', '民粹', '海权'].includes(trait),
  )
  const reformist = country.leader.traits.some(trait =>
    ['改革', '贸易', '务实', '维新'].includes(trait),
  )
  if (aggressive && rng.chance(0.65)) return options[0] as EventOption
  if (reformist && options.length > 1 && rng.chance(0.65)) return options[1] as EventOption
  return rng.pick(options)
}

export function applyEventOption(
  world: WorldState,
  event: GameEvent,
  optionId: string,
  log?: LogEntry[],
  rng?: Rng,
): string {
  if (event.isResolved) return '该事件已经处理过了。'
  const option = event.options.find(one => one.id === optionId)
  if (option === undefined) return `没有找到选项 ${optionId}。`
  const country = world.countries[event.countryId]
  if (country === undefined) return '事件所属国家不存在。'

  const effects = option.effects
  if (effects.treasury !== undefined) {
    country.econ.treasury += effects.treasury
    if (country.econ.treasury < 0) {
      country.econ.debt += -country.econ.treasury
      country.econ.treasury = 0
    }
  }
  if (effects.radicals !== undefined) {
    country.pops.radicals = clamp(country.pops.radicals + effects.radicals, 0, 100)
  }
  if (effects.legitimacy !== undefined) {
    country.government.legitimacy = clamp(
      country.government.legitimacy + effects.legitimacy,
      0,
      100,
    )
  }
  if (effects.prestige !== undefined) {
    country.diplo.prestige = clamp(country.diplo.prestige + effects.prestige, 0, 240)
  }
  if (effects.army !== undefined) {
    country.military.army = Math.max(0, country.military.army + effects.army)
  }
  if (effects.popsPercent !== undefined) {
    country.pops.total = Math.max(1, country.pops.total * (1 + effects.popsPercent / 100))
  }
  if (effects.techPoints !== undefined) {
    country.tech.points += effects.techPoints
  }
  if (effects.relationTarget !== undefined && effects.relationAmount !== undefined) {
    const target = world.countries[effects.relationTarget]
    if (target !== undefined) {
      const current = country.diplo.relations[target.id] ?? 0
      country.diplo.relations[target.id] = clamp(current + effects.relationAmount, -100, 100)
      const back = target.diplo.relations[country.id] ?? 0
      target.diplo.relations[country.id] = clamp(back + effects.relationAmount * 0.6, -100, 100)
    }
  }
  if (effects.modifiers !== undefined) {
    effects.modifiers.forEach((one, index) => {
      addModifier(country, {
        id: `event:${event.id}:${index}`,
        label: one.label ?? event.title,
        stat: one.stat,
        stack: one.stack ?? 'flat',
        value: one.value,
        monthsLeft: one.months,
        source: `event:${event.id}`,
      })
    })
  }
  if (effects.succeed === true) {
    const oldName = `${country.leader.title}${country.leader.name}`
    country.leader = successorFor(country, rng ?? makeRngForWorld(world))
    if (log !== undefined) {
      log.push({
        date: { ...world.date },
        kind: 'leader',
        countryId: country.id,
        text: `[${country.flag}] ${country.name}：${oldName}退位，${country.leader.title}${country.leader.name}继位`,
      })
    }
  }

  event.isResolved = true
  event.resolvedOption = option.id
  country.leader.memory.push(`「${event.title}」：${option.label}`)
  if (country.leader.memory.length > 8) country.leader.memory.shift()

  const line: LogEntry = {
    date: { ...world.date },
    kind: 'event',
    countryId: country.id,
    text: `[${country.flag}] ${event.title}：${option.result}`,
  }
  if (log !== undefined) log.push(line)

  return `${event.title}：${option.result}`
}

function tickEvents(world: WorldState, rng: Rng, log: LogEntry[]): GameEvent[] {
  const pending: GameEvent[] = []
  for (const country of Object.values(world.countries)) {
    const chance = 0.055 + country.pops.radicals / 1200
    if (!rng.chance(chance)) continue
    if (country.isPlayer) {
      const open = world.events.filter(
        event => event.countryId === country.id && !event.isResolved,
      )
      if (open.length >= 3) continue
    }
    const event = spawnEvent(world, country, rng)
    if (event === undefined) continue
    if (country.isPlayer) {
      pending.push(event)
      log.push({
        date: { ...world.date },
        kind: 'event',
        countryId: country.id,
        text: `[${country.flag}] 新事件：${event.title} — ${event.text}`,
      })
    } else {
      const option = aiEventChoice(country, event.options, rng)
      applyEventOption(world, event, option.id, log)
    }
  }
  return pending
}

export function advance(
  world: WorldState,
  months: number,
  decisions: Decision[],
  rng: Rng,
): AdvanceReport {
  const start = { ...world.date }
  const log: LogEntry[] = []
  const pending: GameEvent[] = []

  for (const decision of decisions.slice(0, 8)) {
    const result = applyDecision(world, decision, rng)
    if (result.ok) {
      log.push({
        date: { ...world.date },
        kind: 'politics',
        countryId: decision.countryId,
        text: result.text,
      })
    }
  }

  const total = clamp(Math.floor(months), 1, 120)
  for (let index = 0; index < total; index += 1) {
    world.date = advanceDate(world.date)
    world.tick += 1
    for (const country of Object.values(world.countries)) {
      simulateCountry(world, country, rng, log)
    }
    driftRelations(world)
    resolveWars(world, rng, log)
    pending.push(...tickEvents(world, rng, log))
  }

  world.log.push(...log)
  if (world.log.length > 400) world.log.splice(0, world.log.length - 400)
  world.events.push(...pending)
  if (world.events.length > 80) world.events.splice(0, world.events.length - 80)

  return { start, end: { ...world.date }, log, events: pending }
}

function relationLine(country: Country, other: Country): string {
  const value = Math.round(country.diplo.relations[other.id] ?? 0)
  return `[${other.flag}]${other.name} ${value >= 0 ? '+' : ''}${value}`
}

/** Political capital each law consumes (plan §7.6). */
const LAW_AUTHORITY_COST: Record<string, number> = {
  教育改革: 8,
  福利改革: 10,
  自由贸易: 12,
  保护关税: 10,
  征兵制: 15,
  宗教宽容: 5,
}

export function applyDecision(
  world: WorldState,
  decision: Decision,
  rng: Rng,
): { ok: boolean; text: string } {
  const country = world.countries[decision.countryId]
  if (country === undefined) return { ok: false, text: `未知国家 ${decision.countryId}` }
  const params = decision.params
  const tag = `[${country.flag}] ${country.name}`

  switch (decision.action) {
    case 'build': {
      const id = String(params.building ?? '')
      const building = buildOf(id)
      if (building === undefined) return { ok: false, text: `${tag} 未知建筑 ${id}` }
      const count = clamp(Math.floor(Number(params.count ?? 1)), 1, 20)
      const months = BUILDING_TIME[building]
      const monthlyCost = (BUILDINGS[building].cost * count) / months
      if (country.econ.treasury < monthlyCost) {
        return {
          ok: false,
          text: `${tag} 国库不足以启动${BUILDINGS[building].name}（首月需 ${monthlyCost.toFixed(1)}）`,
        }
      }
      country.econ.constructionQueue.push({
        id: `proj-${world.tick}-${country.id}-${country.econ.constructionQueue.length}`,
        building,
        count,
        monthsLeft: months,
        monthlyCost,
        progress: 0,
        startedAt: { ...world.date },
      })
      return {
        ok: true,
        text: `${tag} 将 ${count} 座${BUILDINGS[building].name}列入建造队列（${months} 个月，每月 ${monthlyCost.toFixed(1)}）`,
      }
    }
    case 'tax': {
      const rate = clamp(Number(params.rate ?? country.econ.taxRate), 0, 60)
      country.econ.taxRate = rate
      return { ok: true, text: `${tag} 将税率调整为 ${rate.toFixed(0)}%` }
    }
    case 'tariff': {
      const rate = clamp(Number(params.rate ?? country.econ.tariff), 0, 60)
      country.econ.tariff = rate
      return { ok: true, text: `${tag} 将关税调整为 ${rate.toFixed(0)}%` }
    }
    case 'spending': {
      const category = String(params.category ?? '') as keyof Country['econ']['spending']
      if (!(category in country.econ.spending)) {
        return { ok: false, text: `${tag} 未知支出类别 ${category}` }
      }
      const amount = clamp(Number(params.amount ?? country.econ.spending[category]), 0, 50)
      country.econ.spending[category] = amount
      return { ok: true, text: `${tag} 将 ${category} 支出调整为 ${amount.toFixed(1)}` }
    }
    case 'research': {
      const name = String(params.tech ?? techName(country.tech.level + 1))
      country.tech.researching = name
      return { ok: true, text: `${tag} 将研究方向定为「${name}」` }
    }
    case 'conscript': {
      const wanted = clamp(Number(params.amount ?? 1), 1, 20)
      const possible = Math.min(wanted, country.military.manpower / 2)
      if (possible <= 0.1) return { ok: false, text: `${tag} 没有可用的人力` }
      country.military.army += possible
      country.military.manpower -= possible * 2
      country.pops.radicals = clamp(country.pops.radicals + possible * 0.4, 0, 100)
      country.pops.total = Math.max(1, country.pops.total - possible * 0.4)
      return { ok: true, text: `${tag} 征召了 ${possible.toFixed(1)} 万兵力` }
    }
    case 'law': {
      const name = String(params.name ?? params.law ?? '')
      if (name === '') return { ok: false, text: `${tag} 未知法案` }
      const legal: Record<string, () => string> = {
        教育改革: () => {
          country.pops.literacy = clamp(country.pops.literacy + 0.04, 0, 1)
          country.econ.spending.education += 0.5
          addModifier(country, {
            id: 'law:教育改革',
            label: '教育改革',
            stat: 'literacy',
            stack: 'percent',
            value: 10,
            source: 'law:教育改革',
          })
          return `${tag} 推行教育改革，识字率上升`
        },
        福利改革: () => {
          country.pops.radicals = clamp(country.pops.radicals - 6, 0, 100)
          country.econ.spending.welfare += 0.5
          addModifier(country, {
            id: 'law:福利改革',
            label: '福利改革',
            stat: 'radicals',
            stack: 'flat',
            value: -2,
            source: 'law:福利改革',
          })
          return `${tag} 推行福利改革，民怨稍减`
        },
        自由贸易: () => {
          country.econ.tariff = clamp(country.econ.tariff - 8, 0, 60)
          country.econ.marketAccess = clamp(country.econ.marketAccess + 0.08, 0, 1)
          addModifier(country, {
            id: 'law:自由贸易:income',
            label: '自由贸易',
            stat: 'income',
            stack: 'percent',
            value: 8,
            source: 'law:自由贸易',
          })
          return `${tag} 推行自由贸易，市场接入提高`
        },
        保护关税: () => {
          country.econ.tariff = clamp(country.econ.tariff + 8, 0, 60)
          country.econ.marketAccess = clamp(country.econ.marketAccess - 0.04, 0, 1)
          addModifier(country, {
            id: 'law:保护关税:factory',
            label: '保护关税',
            stat: 'factoryOutput',
            stack: 'percent',
            value: 12,
            source: 'law:保护关税',
          })
          return `${tag} 推行保护关税，国库与工厂受益`
        },
        征兵制: () => {
          country.military.manpower = clamp(country.military.manpower + 10, 0, country.pops.total * 0.06)
          country.pops.radicals = clamp(country.pops.radicals + 3, 0, 100)
          addModifier(country, {
            id: 'law:征兵制',
            label: '征兵制',
            stat: 'armyStrength',
            stack: 'percent',
            value: 10,
            source: 'law:征兵制',
          })
          return `${tag} 推行征兵制，人力池扩大`
        },
        宗教宽容: () => {
          country.pops.radicals = clamp(country.pops.radicals - 4, 0, 100)
          country.government.legitimacy = clamp(country.government.legitimacy + 2, 0, 100)
          addModifier(country, {
            id: 'law:宗教宽容',
            label: '宗教宽容',
            stat: 'legitimacy',
            stack: 'flat',
            value: 2,
            source: 'law:宗教宽容',
          })
          return `${tag} 推行宗教宽容，社会稳定`
        },
      }
      const apply = legal[name]
      if (apply === undefined) return { ok: false, text: `${tag} 未知法案 ${name}` }
      const cost = LAW_AUTHORITY_COST[name] ?? 8
      if (country.government.authority < cost) {
        return {
          ok: false,
          text: `${tag} 权威不足，无法通过${name}（需要 ${cost}，现有 ${Math.round(country.government.authority)}）`,
        }
      }
      country.government.authority = clamp(country.government.authority - cost, 0, 100)
      return { ok: true, text: apply() }
    }
    case 'diplomacy': {
      const targetId = String(params.target ?? '')
      const target = world.countries[targetId]
      if (target === undefined) return { ok: false, text: `${tag} 未知目标 ${targetId}` }
      const move = String(params.move ?? params.action ?? '')
      const current = country.diplo.relations[target.id] ?? 0
      switch (move) {
        case 'improve': {
          const amount = clamp(Number(params.amount ?? 8), 1, 30)
          country.diplo.relations[target.id] = clamp(current + amount, -100, 100)
          target.diplo.relations[country.id] = clamp(
            (target.diplo.relations[country.id] ?? 0) + amount * 0.6,
            -100,
            100,
          )
          return { ok: true, text: `${tag} 改善了与${target.name}的关系（${relationLine(country, target)}）` }
        }
        case 'insult': {
          country.diplo.relations[target.id] = clamp(current - 15, -100, 100)
          target.diplo.relations[country.id] = clamp(
            (target.diplo.relations[country.id] ?? 0) - 12,
            -100,
            100,
          )
          return { ok: true, text: `${tag} 与${target.name}交恶` }
        }
        case 'alliance': {
          if (country.diplo.rivals.includes(target.id) || current < 30) {
            return { ok: false, text: `${tag} 与${target.name}的关系不足以结盟` }
          }
          if (!country.diplo.alliances.includes(target.id)) country.diplo.alliances.push(target.id)
          if (!target.diplo.alliances.includes(country.id)) target.diplo.alliances.push(country.id)
          return { ok: true, text: `${tag} 与${target.name}缔结同盟` }
        }
        case 'rival': {
          if (!country.diplo.rivals.includes(target.id)) country.diplo.rivals.push(target.id)
          country.diplo.relations[target.id] = clamp(current - 30, -100, 100)
          return { ok: true, text: `${tag} 将${target.name}列为竞争对手` }
        }
        case 'gift': {
          const amount = clamp(Number(params.amount ?? 3), 1, 20)
          if (country.econ.treasury < amount) return { ok: false, text: `${tag} 国库不足以赠礼` }
          country.econ.treasury -= amount
          country.diplo.relations[target.id] = clamp(current + amount * 2, -100, 100)
          target.diplo.relations[country.id] = clamp(
            (target.diplo.relations[country.id] ?? 0) + amount * 1.6,
            -100,
            100,
          )
          return { ok: true, text: `${tag} 向${target.name}赠送了价值 ${amount.toFixed(1)} 的礼物` }
        }
        case 'war': {
          const existing = world.wars.find(
            war =>
              (war.attackers.includes(country.id) && war.defenders.includes(target.id)) ||
              (war.defenders.includes(country.id) && war.attackers.includes(target.id)),
          )
          if (existing !== undefined) return { ok: false, text: `${tag} 与${target.name}已经在战争中` }
          const defenders = [target.id, ...target.diplo.alliances.filter(id => id !== country.id)]
          world.wars.push({
            id: `war-${world.tick}-${country.id}-${target.id}`,
            name: `${country.name}—${target.name}战争`,
            attackers: [country.id],
            defenders,
            started: { ...world.date },
            months: 0,
            warScore: 0,
            battles: 0,
            reason: String(params.reason ?? '边境争端'),
            lastEvent: '战争爆发',
          })
          country.diplo.relations[target.id] = clamp(current - 50, -100, 100)
          target.diplo.relations[country.id] = clamp(
            (target.diplo.relations[country.id] ?? 0) - 50,
            -100,
            100,
          )
          country.diplo.infamy = clamp(country.diplo.infamy + 10, 0, 100)
          return { ok: true, text: `${tag} 向${target.name}宣战（${defenders.length} 国应战）` }
        }
        case 'peace': {
          const war = world.wars.find(
            one =>
              (one.attackers.includes(country.id) && one.defenders.includes(target.id)) ||
              (one.defenders.includes(country.id) && one.attackers.includes(target.id)),
          )
          if (war === undefined) return { ok: false, text: `${tag} 与${target.name}并未交战` }
          endWar(
            world,
            war,
            war.warScore > 10
              ? war.attackers.includes(country.id)
                ? 'attackers'
                : 'defenders'
              : war.warScore < -10
                ? war.attackers.includes(country.id)
                  ? 'defenders'
                  : 'attackers'
                : 'white',
            [],
          )
          return { ok: true, text: `${tag} 与${target.name}停战` }
        }
        default:
          return { ok: false, text: `${tag} 未知外交动作 ${move}` }
      }
    }
    case 'event': {
      const eventId = String(params.eventId ?? '')
      const optionId = String(params.optionId ?? '')
      const event = world.events.find(one => one.id === eventId)
      if (event === undefined) return { ok: false, text: `未知事件 ${eventId}` }
      const result = applyEventOption(world, event, optionId)
      return { ok: true, text: result }
    }
    case 'play': {
      const targetId = String(params.country ?? '')
      const target = world.countries[targetId]
      if (target === undefined) return { ok: false, text: `未知国家 ${targetId}` }
      const oldPlayer = world.countries[world.playerId]
      if (oldPlayer !== undefined) oldPlayer.isPlayer = false
      target.isPlayer = true
      world.playerId = target.id
      return { ok: true, text: `你现在扮演${target.name}` }
    }
    default:
      return { ok: false, text: `未知行动 ${decision.action}` }
  }
}

export function randomDecision(world: WorldState, country: Country, rng: Rng): Decision | undefined {
  const atWar = world.wars.some(
    war => war.attackers.includes(country.id) || war.defenders.includes(country.id),
  )
  if (!atWar && country.econ.treasury > 8 && rng.chance(0.45)) {
    const options = ['factories', 'farms', 'mines', 'railroads', 'universities'] as const
    const building = rng.pick(options)
    return {
      countryId: country.id,
      action: 'build',
      params: { building, count: 1 },
      narrative: `${country.name}扩建${building}`,
    }
  }
  if (country.pops.radicals > 30 && country.econ.treasury > 4 && rng.chance(0.4)) {
    return {
      countryId: country.id,
      action: 'law',
      params: { name: '福利改革' },
      narrative: `${country.name}以福利安抚民怨`,
    }
  }
  const others = Object.values(world.countries).filter(one => one.id !== country.id)
  const infamous = others.filter(
    one => one.diplo.infamy > 25 && !country.diplo.rivals.includes(one.id),
  )
  if (!atWar && infamous.length > 0 && rng.chance(0.08)) {
    const target = rng.pick(infamous)
    return {
      countryId: country.id,
      action: 'diplomacy',
      params: { target: target.id, move: 'rival' },
      narrative: `${country.name}对声名狼藉的${target.name}提高警惕`,
    }
  }
  if (!atWar && rng.chance(0.12)) {
    const target = rng.pick(others)
    const current = country.diplo.relations[target.id] ?? 0
    if (current > -60 && rng.chance(0.4)) {
      return {
        countryId: country.id,
        action: 'diplomacy',
        params: { target: target.id, move: 'improve' },
        narrative: `${country.name}向${target.name}示好`,
      }
    }
  }
  if (
    !atWar &&
    rng.chance(0.03) &&
    country.leader.traits.some(trait => ['扩张', '军事', '海权', '民粹'].includes(trait))
  ) {
    const targets = Object.values(world.countries).filter(
      one => one.id !== country.id && (country.diplo.relations[one.id] ?? 0) < -20,
    )
    if (targets.length > 0) {
      const target = rng.pick(targets)
      return {
        countryId: country.id,
        action: 'diplomacy',
        params: { target: target.id, move: 'war', reason: '宿怨与野心' },
        narrative: `${country.name}对${target.name}发出最后通牒`,
      }
    }
  }
  return undefined
}

/**
 * Why a managed run should stop after the month that just passed, or '' to
 * keep going (plan §4.5). The secretary-overreach check lives in the hooks
 * layer, where the audit flag is.
 */
export function councilInterrupt(before: WorldState, after: WorldState): string {
  const pendingOf = (world: WorldState): number =>
    world.events.filter(event => event.countryId === world.playerId && !event.isResolved).length
  if (pendingOf(after) > pendingOf(before)) return '有新的待决事件'

  const atWar = (world: WorldState, id: string): boolean =>
    world.wars.some(
      war =>
        war.id === id &&
        (war.attackers.includes(world.playerId) || war.defenders.includes(world.playerId)),
    )
  const newWar = after.wars.some(war => !before.wars.some(one => one.id === war.id) && atWar(after, war.id))
  if (newWar) return '新的战争'
  const warEnded = before.wars.some(war => atWar(before, war.id) && !after.wars.some(one => one.id === war.id))
  if (warEnded) return '战争结束'
  return ''
}

export function newWorld(seed: number, playerId: string): WorldState {
  const world = createWorld(seed, playerId)
  calibrateWorld(world)
  return world
}
