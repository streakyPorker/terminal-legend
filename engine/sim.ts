import type {
  BuildingId,
  Country,
  ConstructionProject,
  EventOption,
  GameDate,
  GameEvent,
  GdpComponents,
  GoodId,
  LogEntry,
  LogKind,
  PolicyEffect,
  PolicyProposal,
  War,
  WorldState,
} from '../types'
import type { LaborStats } from './data'
import {
  BUILDINGS,
  BUILDING_IDS,
  BUILDING_OUTPUT,
  BUILDING_TIME,
  CONSUMPTION_PROPENSITY,
  CONSUMER_GOODS,
  GOODS,
  GOOD_IDS,
  GOVERNMENT_DEMAND,
  INCOME_ELASTICITY,
  INVESTMENT_DEMAND,
  SUBSISTENCE,
  buildOf,
  createWorld,
  deriveBureaucracy,
  deriveLabor,
  deriveUnemployment,
  effectiveCount,
  makeRngForWorld,
  resourceMultiplier,
  spawnEvent,
  successorFor,
  techCost,
  techName,
} from './data'
import type { Rng } from './rng'
import {
  MODIFIER_STATS,
  MODIFIER_STAT_NAMES,
  addModifier,
  applyModifiers,
  tickModifiers,
  totalsFor,
} from './modifiers'
import { evaluateThresholds, logThresholds } from './thresholds'

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
  components: GdpComponents
  laborShare: number
  wages: number
  profits: number
  labor: LaborStats
}

export const clamp = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min

/** Numeric parameter with a finite fallback; model output can be a string. */
const num = (value: unknown, fallback: number): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

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

/** Resource multipliers for every good, for display and price formation. */
export function resourceFactors(country: Country): Record<GoodId, number> {
  const out = zeroGoods()
  for (const id of GOOD_IDS) out[id] = resourceMultiplier(country.econ.resources, id)
  return out
}

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
  const resources = resourceFactors(country)
  // Coal and iron are industrial inputs: a country poor in both runs its
  // factories less efficiently. This is what lets endowments reach GDP, not
  // just raw material output (round-1 playtest finding P1-4).
  const industrial = clamp((resources.coal + resources.iron) / 2, 0.7, 1.3)
  const out = zeroGoods()
  // Scale diminishing returns: capacity grows as count^0.98 (plan 0003 §0.1).
  const cap = (count: number): number => effectiveCount(count)
  // Every good reads through the generic `production` buff and its own
  // per-good buff, so policies can target either scale.
  const output = (id: GoodId, value: number): number =>
    applyModifiers(
      country,
      'production',
      applyModifiers(country, `${id}Output`, value * resources[id]),
    )
  const farm = (value: number): number => applyModifiers(country, 'farmOutput', value)
  const mine = (value: number): number => applyModifiers(country, 'mineOutput', value)
  const factory = (value: number): number => applyModifiers(country, 'factoryOutput', value)

  out.grain = output('grain', farm(cap(b.farms) * 1.05 * tech * infra * access))
  out.wood = output('wood', farm(cap(b.farms) * 0.16) + mine(cap(b.mines) * 0.06))
  out.coal = output('coal', mine(cap(b.mines) * 0.5 * tech))
  out.iron = output('iron', mine(cap(b.mines) * 0.42 * tech))
  out.fabric = output('fabric', factory(cap(b.factories) * 0.6 * tech * industrial))
  // Artisans supply the bottom of the consumer market before factories do;
  // without them an agrarian country reads as permanently short of clothes.
  out.clothes = output(
    'clothes',
    factory(cap(b.factories) * 0.38 * tech * industrial) + country.pops.artisans * 0.035,
  )
  out.liquor = output(
    'liquor',
    factory(cap(b.factories) * 0.2 * industrial) + country.pops.artisans * 0.01,
  )
  out.furniture = output(
    'furniture',
    factory(cap(b.factories) * 0.22 * tech * industrial) + country.pops.artisans * 0.006,
  )
  out.machinery = output('machinery', factory(cap(b.factories) * 0.09 * tech * industrial))
  out.arms = output(
    'arms',
    factory(cap(b.factories) * 0.07 * tech * industrial) + cap(b.barracks) * 0.05,
  )
  out.luxury = output('luxury', factory(cap(b.factories) * 0.035 * tech * industrial))
  out.services = output(
    'services',
    (country.pops.total / 1000) * 0.5 * access +
      country.pops.artisans * 0.01 +
      cap(b.offices) * 0.8 +
      cap(b.universities) * 0.2,
  )
  return out
}

type DemandBreakdown = {
  demand: Record<GoodId, number>
  /** Final-use quantities by block; GDP values them only up to supply. */
  consumer: Record<GoodId, number>
  investment: Record<GoodId, number>
  government: Record<GoodId, number>
}

/**
 * Share of profits saved for investment. The country profile sets the base,
 * investment confidence and the `privateInvestment` modifier move it
 * (plan 0003 §3/§4).
 */
export function effectiveSavingsRate(country: Country): number {
  const confidence = 1 + country.econ.investmentConfidence / 100
  return clamp(
    applyModifiers(
      country,
      'privateInvestment',
      country.politicalEconomy.savingsRate * confidence,
    ),
    0,
    0.9,
  )
}

function computeDemand(country: Country): DemandBreakdown {
  const popFactor = Math.max(0.1, country.pops.total / 1000)
  const prices = country.econ.prices
  const b = country.econ.buildings
  const sp = country.econ.spending
  const demand = (id: GoodId, value: number): number =>
    applyModifiers(country, 'demand', applyModifiers(country, `${id}Demand`, value))
  const out = zeroGoods()
  const consumer = zeroGoods()

  // ---- consumer demand: Stone-Geary (plan 0003 §2.1) ----
  // The household budget is wages plus the unsaved share of profits, less
  // taxes, plus welfare transfers. Last month's bills are the best available
  // reading; the first month falls back to seed GDP.
  const wages =
    country.econ.wages > 0
      ? country.econ.wages
      : country.econ.gdp * country.politicalEconomy.laborShareBase
  const profits =
    country.econ.profits > 0
      ? country.econ.profits
      : country.econ.gdp * (1 - country.politicalEconomy.laborShareBase)
  const savingsRate = effectiveSavingsRate(country)
  const welfareTransfer = sp.welfare * popFactor * 0.03
  const taxEfficiency = 0.5 + country.government.legitimacy / 200
  const taxTake = (wages + profits) * (country.econ.taxRate / 100) * 0.4 * taxEfficiency
  const disposable = Math.max(0, wages + profits * (1 - savingsRate) - taxTake) + welfareTransfer
  const incomePerCapita = disposable / popFactor
  let subsistenceCost = 0
  for (const id of CONSUMER_GOODS) subsistenceCost += SUBSISTENCE[id] * prices[id]
  const supernumerary =
    Math.max(0, incomePerCapita - subsistenceCost) * CONSUMPTION_PROPENSITY
  for (const id of CONSUMER_GOODS) {
    const subsistence = popFactor * SUBSISTENCE[id]
    const discretionary =
      (popFactor * INCOME_ELASTICITY[id] * supernumerary) / Math.max(0.05, prices[id])
    // `consumption` scales discretionary spending, never the survival floor.
    consumer[id] = demand(
      id,
      subsistence + applyModifiers(country, 'consumption', discretionary),
    )
  }

  // Idle profits held back last month that were released as luxury spending.
  if (country.econ.idlePurchases > 0) {
    consumer.luxury += country.econ.idlePurchases / Math.max(0.1, prices.luxury)
  }

  for (const id of GOOD_IDS) out[id] = consumer[id]
  const investment = zeroGoods()
  const government = zeroGoods()

  // ---- intermediate demand: industrial inputs, not part of GDP ----
  out.coal += demand('coal', popFactor * 1.2 + b.factories * 0.35)
  out.iron += demand('iron', popFactor * 0.8 + b.factories * 0.4 + b.railroads * 0.5)
  out.fabric += demand('fabric', b.factories * 0.45 + popFactor * 0.5)
  out.wood += demand('wood', b.factories * 0.2 + b.railroads * 0.4 + popFactor * 0.3)
  out.machinery += demand('machinery', b.factories * 0.18)
  out.arms += demand('arms', country.military.army * 0.02 + country.military.navy * 0.01)

  // ---- investment demand from last month's actual construction spend ----
  // A project that received no money produces no investment demand (and no
  // GDP): this closes the "phantom investment" loophole where a giant queue
  // raised GDP without a single funded month.
  for (const project of country.econ.constructionQueue) {
    const coefficients = INVESTMENT_DEMAND[project.building]
    const funded = clamp(
      (project.lastSpend ?? 0) / Math.max(0.01, project.monthlyCost),
      0,
      1,
    )
    if (funded <= 0) continue
    for (const [id, coefficient] of Object.entries(coefficients) as [GoodId, number][]) {
      const quantity = coefficient * project.count * funded
      investment[id] += quantity
      out[id] += quantity
    }
  }

  // ---- government demand from appropriations (plan 0003 §2.3) ----
  const militaryBase =
    country.military.army * 0.05 * (1 + country.military.quality) +
    country.military.navy * 0.04
  const governmentGold: Record<keyof typeof sp, number> = {
    army: sp.army * 0.5 + militaryBase * 0.7,
    navy: sp.navy * 0.5 + militaryBase * 0.3,
    bureaucracy: sp.bureaucracy * popFactor * 0.02,
    education: sp.education * popFactor * 0.03,
    // Welfare is a transfer to households (counted in C); construction is
    // investment (counted in I when actually paid). Counting either as
    // government purchases would double-count it.
    welfare: 0,
    construction: 0,
  }
  for (const [category, gold] of Object.entries(governmentGold) as [
    keyof typeof sp,
    number,
  ][]) {
    const shares = GOVERNMENT_DEMAND[category]
    for (const [id, share] of Object.entries(shares) as [GoodId, number][]) {
      const quantity = (gold * share) / Math.max(0.1, prices[id])
      government[id] += quantity
      out[id] += quantity
    }
  }

  // Every goods demand still reads through the generic per-good demand buffs
  // for the intermediate blocks above; consumer demand is already wrapped.
  return { demand: out, consumer, investment, government }
}

/** Production and demand for display, with no side effects. */
export function inspectEconomy(country: Country): {
  production: Record<GoodId, number>
  demand: Record<GoodId, number>
  resources: Record<GoodId, number>
} {
  return {
    production: computeProduction(country),
    demand: computeDemand(country).demand,
    resources: resourceFactors(country),
  }
}

export function computeEconomy(country: Country): EconomySnapshot {
  const production = computeProduction(country)
  const breakdown = computeDemand(country)
  const demand = breakdown.demand

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

  // With NX fixed at 0, only what domestic supply can actually deliver is
  // transacted. Each final-use block is filled in proportion to its demand,
  // so a shortage lowers GDP instead of inflating it through unmet orders.
  // GDP is valued at base prices (real GDP): valuing at current prices makes
  // nominal GDP fall whenever new capacity pushes consumer prices down.
  const components: GdpComponents = { c: 0, i: 0, g: 0, nx: 0 }
  for (const id of GOOD_IDS) {
    const fill = clamp(production[id] / Math.max(0.01, demand[id]), 0, 1)
    const price = GOODS[id].basePrice
    components.c += breakdown.consumer[id] * price * fill
    components.i += breakdown.investment[id] * price * fill
    components.g += breakdown.government[id] * price * fill
  }
  const gdp = applyModifiers(country, 'gdp', components.c + components.i + components.g)

  const gross = (() => {
    let total = 0
    for (const id of GOOD_IDS) total += production[id] * country.econ.prices[id]
    return total
  })()
  // Tariffs still ride on the abstract trade volume until the trade slice
  // replaces it with real import flows (plan 0004).
  const tradeVolume = gross * 0.35
  const taxEfficiency = applyModifiers(
    country,
    'taxEfficiency',
    0.5 + country.government.legitimacy / 200,
  )
  const income = applyModifiers(
    country,
    'income',
    gdp * (country.econ.taxRate / 100) * 0.45 * taxEfficiency +
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

  const labor = deriveLabor(country)
  const rawShare =
    country.politicalEconomy.laborShareBase - (country.econ.unemployment - 5) * 0.01
  const laborShare = clamp(applyModifiers(country, 'laborShare', rawShare), 0.35, 0.7)
  const wages = gdp * laborShare
  const profits = gdp * (1 - laborShare)

  return {
    production,
    demand,
    gdp,
    income,
    expense: applyModifiers(country, 'expense', expense),
    components,
    laborShare,
    wages,
    profits,
    labor,
  }
}

export function calibrateWorld(world: WorldState): void {
  for (const country of Object.values(world.countries)) {
    // Two passes: the first seeds wages/profits from GDP, the second lets
    // Stone-Geary demand read that income.
    let snap = computeEconomy(country)
    country.econ.wages = snap.wages
    country.econ.profits = snap.profits
    snap = computeEconomy(country)
    country.econ.gdp = snap.gdp
    country.econ.income = snap.income
    country.econ.expense = snap.expense
    country.econ.goods = snap.production
    country.econ.gdpComponents = snap.components
    country.econ.laborShare = snap.laborShare
    country.econ.wages = snap.wages
    country.econ.profits = snap.profits
    country.econ.laborDemand = snap.labor.demand
    country.econ.laborForce = snap.labor.force
    country.econ.laborUtilization = snap.labor.utilization
    country.econ.laborRawUtilization = snap.labor.raw
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
  // Negative counts remove buildings (天命); never go below zero.
  country.econ.buildings[building] = Math.max(0, country.econ.buildings[building] + count)
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
): number {
  const queue = country.econ.constructionQueue
  if (queue.length === 0) {
    country.econ.lastConstructionSpend = 0
    country.econ.lastStateConstructionSpend = 0
    country.econ.lastPrivateConstructionSpend = 0
    return 0
  }
  let stateBudget = country.econ.spending.construction * 0.8
  let privateBudget = Math.max(0, country.econ.privateCapital)
  const remaining: ConstructionProject[] = []
  let stateSpent = 0
  let privateSpent = 0
  // Private builders are a little more efficient than the state's, but the
  // bureaucracy still limits how fast their money turns into progress.
  const privateEfficiency = clamp(0.75 + country.bureaucracy.score / 400, 0.75, 1)

  // Complete the oldest/near-finish projects first so a small budget does not
  // starve the whole queue forever.
  const ordered = [...queue].sort((a, b) => a.monthsLeft - b.monthsLeft)
  for (const project of ordered) {
    const owner = project.owner ?? 'state'
    // Fund a full month's bill where the budget allows; bureaucratic leakage
    // then decides how much of it becomes progress. (Capping the spend at the
    // remaining progress would approach 1 asymptotically and never finish.)
    const spend =
      owner === 'private'
        ? Math.min(privateBudget, project.monthlyCost)
        : Math.min(stateBudget, project.monthlyCost, Math.max(0, country.econ.treasury))
    project.lastSpend = spend
    if (spend > 0) {
      if (owner === 'private') {
        privateBudget -= spend
        privateSpent += spend
      } else {
        stateBudget -= spend
        stateSpent += spend
        country.econ.treasury -= spend
      }
      const efficiency =
        owner === 'private'
          ? applyModifiers(country, 'constructionSpeed', privateEfficiency)
          : applyModifiers(country, 'constructionSpeed', country.bureaucracy.fundEfficiency)
      const effective = spend * efficiency
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
          text:
            owner === 'private'
              ? `[${country.flag}] ${country.name}的私人资本建成 ${project.count} 座${BUILDINGS[project.building].name}`
              : `[${country.flag}] ${country.name}建成 ${project.count} 座${BUILDINGS[project.building].name}`,
        })
        continue
      }
    }
    remaining.push(project)
  }

  country.econ.constructionQueue = remaining
  country.econ.privateCapital = privateBudget
  country.econ.lastConstructionSpend = stateSpent + privateSpent
  country.econ.lastStateConstructionSpend = stateSpent
  country.econ.lastPrivateConstructionSpend = privateSpent
  // Unused appropriations are not spent at all: the appropriation is a monthly
  // cap, not a charge. This keeps the displayed budget equal to the treasury.
  return stateSpent
}

/**
 * Expected-return proxy for one building at current prices and demand. It
 * compares the current price basket with base prices and weights it by the
 * demand/supply pressure of the goods the building makes. The capital
 * threshold (4%/year + debt ratio × 2%) is expressed as a markup on 1
 * (plan 0003 §0.1/§4).
 */
export function investmentScore(
  country: Country,
  building: BuildingId,
  demand: Record<GoodId, number>,
  production: Record<GoodId, number>,
): number {
  const outputs = BUILDING_OUTPUT[building]
  const industrial = clamp(
    (resourceMultiplier(country.econ.resources, 'coal') +
      resourceMultiplier(country.econ.resources, 'iron')) /
      2,
    0.7,
    1.3,
  )
  let weightSum = 0
  let pressureSum = 0
  let potentialSum = 0
  for (const [id, quantity] of Object.entries(outputs) as [GoodId, number][]) {
    const resource = resourceMultiplier(country.econ.resources, id)
    const potential = building === 'factories' ? resource * industrial : resource
    const weight = quantity * GOODS[id].basePrice
    const ratio = clamp(demand[id] / Math.max(0.01, production[id]), 0.3, 2)
    weightSum += weight
    pressureSum += weight * ratio
    potentialSum += weight * potential
  }
  if (weightSum <= 0) return 0
  // Unmet demand is the primary signal; resource/industrial potential decides
  // whether this country is a good place to add the capacity.
  return (pressureSum / weightSum) * (potentialSum / weightSum)
}

function capitalThreshold(country: Country): number {
  const debtRatio = country.econ.debt / Math.max(1, country.econ.gdp)
  // 4%/year + debt ratio × 2%/year, expressed as a monthly markup. Confidence
  // policies lower the hurdle rate, so `privateInvestment` boosts both savings
  // and the range of projects that clear it.
  const confidence = 1 + totalsFor(country, 'privateInvestment').percent / 100
  return (1 + (0.04 + debtRatio * 0.02) / 12) / Math.max(0.5, confidence)
}

/** Monthly depreciation of the building stock; replacement investment keeps
 *  the private-investment loop alive after the initial industrialisation. */
const DEPRECIATION_PER_MONTH = 0.0015

/**
 * Allocates this month's private savings to at most one new private project.
 * Private projects are visible in the queue but cannot be cancelled
 * (plan 0003 §4). Returns the savings that stayed idle.
 */
function investPrivateCapital(
  world: WorldState,
  country: Country,
  snap: EconomySnapshot,
  savingsThisMonth: number,
  log: LogEntry[],
): void {
  const ownProjects = country.econ.constructionQueue.filter(
    project => (project.owner ?? 'state') === 'private',
  )
  const activePrivateCost = ownProjects.reduce(
    (sum, project) => sum + project.monthlyCost,
    0,
  )
  const threshold = capitalThreshold(country)
  let best: { building: BuildingId; score: number } | undefined
  for (const building of Object.keys(BUILDINGS) as BuildingId[]) {
    if (Object.keys(BUILDING_OUTPUT[building]).length === 0) continue
    const score = investmentScore(country, building, snap.demand, snap.production)
    if (best === undefined || score > best.score) best = { building, score }
  }

  // Keep three months of working capital for everything already under
  // construction; new starts only use the headroom above that reserve.
  const headroom = Math.max(0, country.econ.privateCapital / 3 - activePrivateCost)
  const canStart = ((): { months: number; affordable: number } | undefined => {
    if (best === undefined) return undefined
    const months = BUILDING_TIME[best.building]
    const fullMonthly = BUILDINGS[best.building].cost / months
    if (fullMonthly <= 0) return undefined
    return { months, affordable: Math.floor((headroom * months) / BUILDINGS[best.building].cost) }
  })()
  let started = false
  if (
    best !== undefined &&
    canStart !== undefined &&
    best.score > threshold &&
    ownProjects.length < 10 &&
    canStart.affordable >= 1
  ) {
    const { months } = canStart
    const count = clamp(canStart.affordable, 1, 10)
    const monthlyCost = (BUILDINGS[best.building].cost * count) / months
    if (monthlyCost <= country.econ.privateCapital) {
      country.econ.constructionQueue.push({
        id: `proj-${world.tick}-${country.id}-priv-${country.econ.constructionQueue.length}`,
        building: best.building,
        count,
        owner: 'private',
        monthsLeft: months,
        monthlyCost,
        lastSpend: 0,
        progress: 0,
        startedAt: { ...world.date },
      })
      log.push({
        date: { ...world.date },
        kind: 'economy',
        countryId: country.id,
        text: `[${country.flag}] ${country.name}的私人资本投建 ${count} 座${BUILDINGS[best.building].name}`,
      })
      started = true
    }
  }

  // Replacement investment: when no expansion clears the capital threshold,
  // a healthy existing stock (score > 0.7) still needs one-for-one renewal.
  // This keeps private construction and I from freezing for years after the
  // initial industrialisation (round-2 P1-1).
  if (
    !started &&
    ownProjects.length === 0 &&
    best !== undefined &&
    best.score > 0.7 &&
    country.econ.buildings[best.building] > 0
  ) {
    const months = BUILDING_TIME[best.building]
    const monthlyCost = BUILDINGS[best.building].cost / months
    if (monthlyCost <= headroom && monthlyCost <= country.econ.privateCapital) {
      country.econ.constructionQueue.push({
        id: `proj-${world.tick}-${country.id}-renew-${country.econ.constructionQueue.length}`,
        building: best.building,
        count: 1,
        owner: 'private',
        monthsLeft: months,
        monthlyCost,
        lastSpend: 0,
        progress: 0,
        startedAt: { ...world.date },
      })
      log.push({
        date: { ...world.date },
        kind: 'economy',
        countryId: country.id,
        text: `[${country.flag}] ${country.name}的私人资本更新 1 座${BUILDINGS[best.building].name}`,
      })
      started = true
    }
  }

  // Working capital reserved for active private projects; anything above it
  // is idle. The retained share stays in the pool, the rest is released as
  // luxury purchases next month (plan 0003 §4).
  const totalPrivateCost = country.econ.constructionQueue
    .filter(project => (project.owner ?? 'state') === 'private')
    .reduce((sum, project) => sum + project.monthlyCost, 0)
  const reserve = Math.max(10, totalPrivateCost * 3)
  const idle = Math.max(0, country.econ.privateCapital - reserve)
  const released = idle * (1 - country.politicalEconomy.idleRetained)
  if (released > 0) {
    country.econ.privateCapital = Math.max(0, country.econ.privateCapital - released)
    country.econ.idlePurchases += released
  }
  country.econ.idleProfits = idle
}

function simulateCountry(
  world: WorldState,
  country: Country,
  rng: Rng,
  log: LogEntry[],
): void {
  const oldPops = Math.max(1, country.pops.total)
  const snap = computeEconomy(country)
  // The demand computed above consumed last month's released idle capital.
  country.econ.idlePurchases = 0

  // Market scarcity feeds unrest.
  let scarcity = 0
  for (const id of GOOD_IDS) {
    const demand = snap.demand[id]
    if (demand <= 0) continue
    const shortage = Math.max(0, demand - snap.production[id])
    scarcity += (shortage / demand) * (id === 'grain' || id === 'clothes' ? 1.6 : 0.5)
  }
  scarcity = clamp(scarcity, 0, 8)

  country.econ.gdp = snap.gdp
  country.econ.gdpComponents = snap.components
  country.econ.income = snap.income
  country.econ.expense = snap.expense
  country.econ.goods = snap.production
  country.econ.laborShare = snap.laborShare
  country.econ.wages = snap.wages
  country.econ.profits = snap.profits
  country.econ.laborDemand = snap.labor.demand
  country.econ.laborForce = snap.labor.force
  country.econ.laborUtilization = snap.labor.utilization
  country.econ.laborRawUtilization = snap.labor.raw

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

  // Income distribution: profits fund private savings, and this month's
  // savings may start one private project (plan 0003 §3/§4).
  const savings = snap.profits * effectiveSavingsRate(country)
  country.econ.privateCapital += savings
  investPrivateCapital(world, country, snap, savings, log)

  // The construction queue pays from the appropriation; only the money that
  // actually reached a project counts as government spending.
  const stateConstructionSpent = settleConstruction(world, country, rng, log)
  country.econ.expense = snap.expense + stateConstructionSpent

  // Capital wears out slowly. Without this the private investment loop stops
  // permanently once the capital stock satisfies demand (round-2 P1-1).
  for (const id of BUILDING_IDS) {
    country.econ.buildings[id] = Math.max(
      0,
      country.econ.buildings[id] * (1 - DEPRECIATION_PER_MONTH),
    )
  }

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
        country.pops.radicals * 0.08 +
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
  // Low labour utilisation (a vast idle peasantry) adds a modest penalty;
  // full utilisation removes it (plan 0003 §0.1).
  const laborPenalty = (1 - snap.labor.utilization) * 2
  const unemploymentTarget = clamp(
    applyModifiers(country, 'unemployment', deriveUnemployment(country) + laborPenalty),
    0,
    30,
  )
  // Smooth the stock and cap the monthly move so the factory-absorption
  // threshold cannot swing unemployment from 6% to 29% in a year.
  const unemploymentStep = clamp(
    (unemploymentTarget - country.econ.unemployment) * 0.25,
    -1.5,
    1.5,
  )
  country.econ.unemployment = clamp(
    country.econ.unemployment + unemploymentStep,
    0,
    30,
  )

  const radicalPressure =
    Math.max(0, country.econ.taxRate - 10) * 0.08 +
    Math.max(0, country.econ.tariff - 10) * 0.03 +
    Math.max(0, 40 - country.pops.sol) * 0.03 +
    country.military.exhaustion * 0.06 +
    country.econ.unemployment * 0.03 +
    scarcity * 0.12
  const relief =
    0.3 +
    (country.government.legitimacy / 100) * 0.35 +
    country.econ.spending.welfare * 0.2 +
    country.econ.spending.education * 0.08 +
    country.pops.loyalists * 0.015
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

  // Authority recovers in proportion to legitimacy; a discredited regime
  // loses it (round-2 P1-6).
  const authorityFlow =
    country.government.legitimacy * 0.03 -
    (country.government.legitimacy < 30 ? 1.5 : 0)
  country.government.authority = clamp(
    country.government.authority + applyModifiers(country, 'authority', authorityFlow),
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

  // State thresholds grant or lift buffs after the month's numbers settle.
  logThresholds(world, country, evaluateThresholds(country), log)

  pushHistory(country.econ.history.gdp, snap.gdp)
  pushHistory(country.econ.history.treasury, country.econ.treasury)
  pushHistory(country.econ.history.sol, country.pops.sol)
  pushHistory(country.econ.history.legitimacy, country.government.legitimacy)
  pushHistory(country.econ.history.radicals, country.pops.radicals)

  if (
    country.econ.treasury <= 0 &&
    snap.income - country.econ.expense < 0 &&
    country.econ.debt > country.econ.gdp * 0.5 &&
    rng.chance(0.03)
  ) {
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

  // One decision per AI country, plus the player's own actions.
  for (const decision of decisions.slice(0, 12)) {
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
      const count = clamp(Math.floor(num(params.count, 1)), 1, 20)
      const months = BUILDING_TIME[building]
      const monthlyCost = (BUILDINGS[building].cost * count) / months
      const stateProjects = country.econ.constructionQueue.filter(
        project => (project.owner ?? 'state') === 'state',
      )
      if (stateProjects.length >= 8) {
        return {
          ok: false,
          text: `${tag} 国有建造队列已满（最多 8 个项目），先等现有项目完成`,
        }
      }
      const constructionBudget = country.econ.spending.construction * 0.8
      if (constructionBudget > 0 && monthlyCost > constructionBudget * 3) {
        return {
          ok: false,
          text: `${tag} 建设拨款不足（每月 ${monthlyCost.toFixed(1)} 金，预算 ${constructionBudget.toFixed(1)}），先提高建设支出`,
        }
      }
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
        owner: 'state',
        monthsLeft: months,
        monthlyCost,
        lastSpend: 0,
        progress: 0,
        startedAt: { ...world.date },
      })
      return {
        ok: true,
        text: `${tag} 将 ${count} 座${BUILDINGS[building].name}列入建造队列（${months} 个月，每月 ${monthlyCost.toFixed(1)} 金）`,
      }
    }
    case 'tax': {
      const rate = clamp(num(params.rate, country.econ.taxRate), 0, 60)
      country.econ.taxRate = rate
      return { ok: true, text: `${tag} 将税率调整为 ${rate.toFixed(0)}%` }
    }
    case 'tariff': {
      const rate = clamp(num(params.rate, country.econ.tariff), 0, 60)
      country.econ.tariff = rate
      return { ok: true, text: `${tag} 将关税调整为 ${rate.toFixed(0)}%` }
    }
    case 'spending': {
      const category = String(params.category ?? '') as keyof Country['econ']['spending']
      if (!(category in country.econ.spending)) {
        return { ok: false, text: `${tag} 未知支出类别 ${category}` }
      }
      const amount = clamp(num(params.amount, country.econ.spending[category]), 0, 50)
      country.econ.spending[category] = amount
      return { ok: true, text: `${tag} 将 ${category} 支出调整为 ${amount.toFixed(1)}` }
    }
    case 'research': {
      const name = String(params.tech ?? techName(country.tech.level + 1))
      country.tech.researching = name
      return { ok: true, text: `${tag} 将研究方向定为「${name}」` }
    }
    case 'invest': {
      // AI investment confidence, bounded to ±10 around the country's base
      // and ±3 per month (plan 0003 §4/§6).
      const base = country.politicalEconomy.investmentConfidence
      const delta = clamp(num(params.amount, 1), -3, 3)
      const next = clamp(country.econ.investmentConfidence + delta, base - 10, base + 10)
      country.econ.investmentConfidence = next
      return {
        ok: true,
        text: `${tag} 将投资信心调整为 ${next >= 0 ? '+' : ''}${next.toFixed(0)}`,
      }
    }
    case 'conscript': {
      const wanted = clamp(num(params.amount, 1), 1, 20)
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
          const amount = clamp(num(params.amount, 8), 1, 30)
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
          const amount = clamp(num(params.amount, 3), 1, 20)
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

/**
 * Validates and applies a policy proposal from the model or the secretary.
 * Magnitudes are free (ADR 0002); the engine checks shapes, costs authority,
 * and turns each effect entry into a modifier (ADR 0003/0004).
 */
export function applyPolicy(
  world: WorldState,
  countryId: string,
  proposal: PolicyProposal,
): { ok: boolean; text: string } {
  const country = world.countries[countryId]
  if (country === undefined) return { ok: false, text: `未知国家 ${countryId}` }
  const name = String(proposal.name ?? '').trim().slice(0, 40)
  if (name === '') return { ok: false, text: '政策需要一个名称。' }
  const effects = Array.isArray(proposal.effects) ? proposal.effects.slice(0, 12) : []
  if (effects.length === 0) return { ok: false, text: '政策至少需要一个效果条目。' }

  const parsed: PolicyEffect[] = []
  for (const effect of effects) {
    if (!MODIFIER_STATS.includes(effect.stat)) {
      return { ok: false, text: `未知修正对象 ${String(effect.stat)}` }
    }
    const value = Number(effect.value)
    if (!Number.isFinite(value)) return { ok: false, text: '效果数值必须是有限数字。' }
    if (Math.abs(value) > 200) {
      return { ok: false, text: '单个效果数值不能超过 200（防止无界政策）' }
    }
    const stack = effect.stack ?? 'flat'
    if (stack !== 'flat' && stack !== 'percent' && stack !== 'multiply') {
      return { ok: false, text: '效果单位必须是 flat / percent / multiply。' }
    }
    const months =
      effect.months === undefined
        ? undefined
        : Math.max(1, Math.round(Number(effect.months)))
    if (months !== undefined && !Number.isFinite(months)) {
      return { ok: false, text: '持续月数必须是数字。' }
    }
    parsed.push({
      stat: effect.stat,
      stack,
      value,
      months,
      label: effect.label,
    })
  }

  // Authority cost scales with the effect's magnitude and duration. This keeps
  // a permanent +50% GDP policy from costing the same 5 points as a +2% one
  // (round-2 playtest P0-3).
  const weight = parsed.reduce((sum, effect) => {
    const months = effect.months ?? 12
    const magnitude = Math.min(Math.abs(effect.value), 100)
    return sum + magnitude * (effect.stack === 'flat' ? 0.5 : 1) * (months / 12)
  }, 0)
  const required = clamp(Math.round(weight * 0.2), 0, 40)
  const requested = clamp(Math.round(num(proposal.authorityCost, 5)), 0, 40)
  const cost = Math.max(required, requested)
  if (country.government.authority < cost) {
    return {
      ok: false,
      text: `权威不足，无法推行「${name}」（需要 ${cost}，现有 ${Math.round(country.government.authority)}）`,
    }
  }
  country.government.authority = clamp(country.government.authority - cost, 0, 100)

  parsed.forEach((effect, index) => {
    // A permanent policy replaces an earlier permanent policy on the same
    // stat/stack instead of stacking with it; timed policies keep their own
    // slots and expire normally.
    const id =
      effect.months === undefined
        ? `policy:${effect.stat}:${effect.stack ?? 'flat'}`
        : `policy:${name}:${index}`
    addModifier(country, {
      id,
      label: effect.label ?? name,
      stat: effect.stat,
      stack: effect.stack ?? 'flat',
      value: effect.value,
      monthsLeft: effect.months,
      source: `policy:${name}`,
    })
  })

  const summary = parsed
    .map(
      effect =>
        `${MODIFIER_STAT_NAMES[effect.stat]} ${effect.value >= 0 ? '+' : ''}${effect.value}${effect.stack === 'flat' ? '' : '%'}${effect.months === undefined ? '' : `（${effect.months} 月）`}`,
    )
    .join('；')
  const text = `[${country.flag}] ${country.name} 推行政策「${name}」：${summary}（权威 -${cost}）`
  world.log.push({
    date: { ...world.date },
    kind: 'politics',
    countryId: country.id,
    text,
  })
  if (world.log.length > 400) world.log.splice(0, world.log.length - 400)
  return { ok: true, text }
}

export function randomDecision(world: WorldState, country: Country, rng: Rng): Decision | undefined {
  const atWar = world.wars.some(
    war => war.attackers.includes(country.id) || war.defenders.includes(country.id),
  )
  // Confidence drifts with the fiscal mood when the model is unavailable.
  if (rng.chance(0.15)) {
    const mood = country.econ.income - country.econ.expense > 0 ? 1 : -1
    return {
      countryId: country.id,
      action: 'invest',
      params: { amount: mood },
      narrative: `${country.name}调整投资信心`,
    }
  }
  // A tiny construction appropriation starves the queue; raise it first.
  if (
    country.econ.spending.construction < 2 &&
    country.econ.treasury > 4 &&
    rng.chance(0.25)
  ) {
    return {
      countryId: country.id,
      action: 'spending',
      params: { category: 'construction', amount: country.econ.spending.construction + 1 },
      narrative: `${country.name}增加建设拨款`,
    }
  }
  if (
    !atWar &&
    country.econ.treasury > 8 &&
    country.econ.constructionQueue.length < 6 &&
    rng.chance(0.45)
  ) {
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
  // Any unresolved player event stops a run, whether it was already open or
  // arrived this month (plan §4.5).
  if (pendingOf(after) > 0) return '有待决事件'

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
